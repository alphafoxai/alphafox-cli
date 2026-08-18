import { randomUUID } from "node:crypto";

import type { ProfileConfig } from "../config/profiles";
import { resolveProfile, type ProfileName } from "../config/profiles";
import type { ApiResponse } from "../http/client";
import { apiRequest as defaultApiRequest } from "../http/client";
import { resolveTapeCacheDir } from "../cache/paths";
import { loadTokens } from "../keychain/store";
import { EngineBacktestError, isEngineBacktestError } from "./errors";
import { loadConfigValue } from "./load-config";
import { parseSweepAxesDocument } from "./parse-axes";
import {
  DEFAULT_EXECUTION_MODEL,
  buildCreateSweepRequest,
  buildSweepBaseSnapshot,
  exclusiveTapeEndToRangeEnd,
  experimentSweepPageUrl,
  mintClientSweepId,
  shouldPersistSweepCompletion,
  sweepsPath,
  uniqueSeriesField,
} from "./persist";
import { mergeReplayTimeframeWithPlan } from "./replay-timeframe";
import {
  loadBacktestRunner,
  loadBacktestWasm,
} from "./resolve-packages";
import type {
  EngineBacktestCliFlags,
  EngineBacktestRunDeps,
} from "./run-command";
import {
  applySweepCoordinate,
  extractSweepMetrics,
  planSweep,
  planSweepFastRefinement,
  resolveMaxSweepCombinations,
  resolveSweepConcurrency,
  selectBestNonLiquidatedPoint,
  type SweepCoordinate,
  type SweepPlan,
  type SweepPoint,
} from "./sweep-kernel";
import type {
  BacktestClientLike,
  BacktestRunnerModule,
  BacktestWasmModule,
  EngineBacktestBatchRequest,
  EngineBacktestMetrics,
  EngineBacktestPlan,
  EngineBacktestScenario,
  EngineBacktestSeriesRequirement,
  EngineBacktestSweepArgs,
  EngineBacktestSweepSuccess,
  EngineSupportedBacktestPlan,
  SubscriptionTier,
  TapeLoadProgress,
  TapeLoadResult,
} from "./types";

/** WASM `runBacktestBatch` hard limit. Keep in sync with Engine. */
export const MAX_ENGINE_BACKTEST_BATCH_VARIANTS = 256;
/** Sweep chunk size: below the 256 cap so JSONL can refresh mid-search. */
export const SWEEP_WASM_BATCH_VARIANTS = 32;

const CREATE_EXPERIMENT_PATH = "/api/v1/engine-backtest/experiments";
const SUBSCRIPTION_PATH = "/api/v1/subscriptions/me";
const SUBSCRIPTION_TIERS = new Set<SubscriptionTier>([
  "free",
  "pro",
  "pro_max",
]);

export interface EngineBacktestSweepDeps extends EngineBacktestRunDeps {
  readonly maxVariantsPerBatch?: number;
  readonly now?: () => number;
}

type SweepConfigRecord = {
  readonly [key: string]: unknown;
};

interface PlannedSweepCoordinate {
  readonly coordinate: SweepCoordinate;
  readonly config: SweepConfigRecord;
  readonly plan: EngineSupportedBacktestPlan;
}

export function cloneTapeBuffers(
  sourceBuffers: Readonly<Record<string, ArrayBuffer>>
): Record<string, ArrayBuffer> {
  return Object.fromEntries(
    Object.entries(sourceBuffers).map(([key, buffer]) => [key, buffer.slice(0)])
  );
}

export function splitBatchChunk<T>(
  chunk: readonly T[],
  maxVariants: number = MAX_ENGINE_BACKTEST_BATCH_VARIANTS
): T[][] {
  const limit = Math.max(1, Math.floor(maxVariants));
  if (chunk.length <= limit) return [chunk.slice()];
  const parts: T[][] = [];
  for (let offset = 0; offset < chunk.length; offset += limit) {
    parts.push(chunk.slice(offset, offset + limit));
  }
  return parts;
}

export function capSweepRefinement(
  coarseCount: number,
  refinement: readonly SweepCoordinate[],
  combinationCap: number
): SweepCoordinate[] {
  return refinement.slice(0, Math.max(0, combinationCap - coarseCount));
}

export async function executeEngineBacktestSweep(
  args: EngineBacktestSweepArgs,
  flags: EngineBacktestCliFlags,
  env: NodeJS.ProcessEnv = process.env,
  deps: EngineBacktestSweepDeps = {}
): Promise<EngineBacktestSweepSuccess> {
  if (args.help) {
    throw new EngineBacktestError({
      type: "usage",
      message: "internal: help should be handled by the command wrapper",
    });
  }
  if (!args.definitionId || !args.configRaw || !args.exchange || !args.range || !args.axesRaw) {
    throw new EngineBacktestError({
      type: "usage",
      subtype: "invalid_args",
      message: "Missing required sweep arguments",
      status: 400,
    });
  }

  const startedAt = (deps.now ?? Date.now)();
  const profile = resolveProfile(flags.profile, env, {
    unsafeCustomEndpoint: flags.unsafeCustomEndpoint,
  });
  const api = deps.apiRequest ?? defaultApiRequest;
  const tokensFn = deps.loadTokens ?? loadTokens;
  const persist = args.persist && !flags.dryRun;
  const createExperiment = args.createExperiment && !flags.dryRun;
  const mintId = deps.randomUUID ?? randomUUID;
  const writeLine =
    deps.writeLine ??
    ((value: unknown) => {
      process.stdout.write(`${JSON.stringify(value)}\n`);
    });
  if (persist) {
    requireAuth(profile, env, tokensFn);
  }

  const config = asConfigRecord(
    loadConfigValue(args.configRaw, {
      cwd: deps.cwd,
      readFile: deps.readFile,
    })
  );
  const axisInputs = parseSweepAxesDocument(
    loadConfigValue(args.axesRaw, {
      cwd: deps.cwd,
      readFile: deps.readFile,
    }),
    config,
    args.mode
  );

  const { wasm, runner } = await loadRuntime(deps, env);
  const clients: BacktestClientLike[] = [];
  try {
    const client = wasm.createNodeBacktestClient();
    clients.push(client);
    if (typeof client.init === "function") {
      await client.init();
    }

    const configSchemaVersion = await resolveConfigSchemaVersion(
      client,
      args.definitionId,
      args.configSchemaVersion
    );
    let subscriptionTier: SubscriptionTier = args.tier ?? "pro";
    if (persist) {
      const accountTier = await loadAccountSubscriptionTier(api, profile, env);
      if (args.tier !== undefined && args.tier !== accountTier) {
        throw new EngineBacktestError({
          type: "usage",
          subtype: "subscription_tier_mismatch",
          message: `--tier ${args.tier} does not match account subscription tier ${accountTier}`,
          hint:
            "Remove --tier for persisted sweeps, or use --no-persist to simulate another tier.",
          status: 400,
          details: { requestedTier: args.tier, accountTier },
        });
      }
      subscriptionTier = accountTier;
    }
    const concurrency = resolveSweepConcurrency({
      subscriptionTier,
      requested: args.concurrency,
    });
    const coarsePlan = planSweep({
      axes: axisInputs,
      searchMode: args.searchMode,
      subscriptionTier,
    });
    const standardPlan =
      args.searchMode === "fast"
        ? planSweep({
            axes: axisInputs,
            searchMode: "standard",
            subscriptionTier,
          })
        : coarsePlan;
    if (coarsePlan.coordinates.length === 0) {
      throw new EngineBacktestError({
        type: "usage",
        subtype: "empty_sweep",
        message: "Sweep plan produced no coordinates",
        status: 400,
      });
    }

    emitProgress(flags, writeLine, "planning", 0);
    const plannedByKey = new Map<string, PlannedSweepCoordinate | SweepPoint>();
    const tapePlans: EngineSupportedBacktestPlan[] = [];
    for (const [index, coordinate] of standardPlan.coordinates.entries()) {
      const planned = await planCoordinate({
        client,
        definitionId: args.definitionId,
        configSchemaVersion,
        config,
        axes: coarsePlan.axes,
        coordinate,
      });
      plannedByKey.set(coordinateKey(coordinate), planned);
      if ("plan" in planned) {
        tapePlans.push(planned.plan);
      }
      emitProgress(
        flags,
        writeLine,
        "planning",
        (index + 1) / standardPlan.coordinates.length
      );
    }

    let exchange;
    try {
      exchange = runner.resolveTapeExchange(args.exchange);
    } catch (err) {
      throw new EngineBacktestError({
        type: "usage",
        subtype: "invalid_exchange",
        message: err instanceof Error ? err.message : String(err),
        status: 400,
      });
    }

    const coverage = unionTapePlans(tapePlans);
    const replayPlan = mergeReplayTimeframeWithPlan({
      replayTimeframe: args.replayTimeframe,
      planTimeframes: coverage.timeframes,
      seriesRequirements: coverage.seriesRequirements,
      symbols: coverage.symbols,
    });

    emitProgress(flags, writeLine, "tape", 0);
    let tapeResult: TapeLoadResult = {
      tape: {
        from: "",
        to: "",
        baseTimeframe: replayPlan.baseTimeframe,
        markets: {},
        series: [],
      },
      buffers: {},
      coverageWarnings: [],
    };
    if (tapePlans.length > 0) {
      try {
        tapeResult = await runner.loadTape({
          exchangeId: exchange.id,
          exchange,
          symbols: coverage.symbols,
          baseTimeframe: replayPlan.baseTimeframe,
          timeframes: replayPlan.timeframes,
          seriesRequirements: replayPlan.seriesRequirements,
          needsFunding: coverage.needsFunding,
          auxiliaryDataRequirements: coverage.auxiliaryDataRequirements,
          fromMs: args.range.fromMs,
          toMs: args.range.toMs,
          dataQualityMode: args.dataQualityMode,
          cacheDir: resolveTapeCacheDir(env),
          onProgress: (progress: TapeLoadProgress) => {
            emitProgress(
              flags,
              writeLine,
              progress.stage || "tape",
              progress.fraction,
              progress.detail
            );
          },
        });
      } catch (err) {
        if (isEngineBacktestError(err)) throw err;
        const issues =
          err && typeof err === "object" && "issues" in err
            ? (err as { issues: unknown }).issues
            : undefined;
        throw new EngineBacktestError({
          type: "runtime",
          subtype: issues ? "tape_unavailable" : "tape_load_failed",
          message: err instanceof Error ? err.message : String(err),
          details: issues ? { issues } : undefined,
        });
      }
    }
    emitProgress(flags, writeLine, "tape", 1);

    while (clients.length < concurrency) {
      const extra = wasm.createNodeBacktestClient();
      clients.push(extra);
      if (typeof extra.init === "function") {
        await extra.init();
      }
    }

    const executionModel = {
      ...(runner.DEFAULT_EXECUTION_MODEL ?? DEFAULT_EXECUTION_MODEL),
      ...args.executionModelOverride,
    };
    const maxVariantsPerBatch = Math.min(
      MAX_ENGINE_BACKTEST_BATCH_VARIANTS,
      Math.max(1, deps.maxVariantsPerBatch ?? SWEEP_WASM_BATCH_VARIANTS)
    );

    const runPrepared = async (
      coordinates: readonly SweepCoordinate[],
      onSweepProgress: (done: number, points: readonly SweepPoint[]) => void
    ): Promise<SweepPoint[]> => {
      const failed: SweepPoint[] = [];
      const ready: PlannedSweepCoordinate[] = [];
      for (const coordinate of coordinates) {
        const planned =
          plannedByKey.get(coordinateKey(coordinate)) ??
          (await planCoordinate({
            client,
            definitionId: args.definitionId!,
            configSchemaVersion,
            config,
            axes: coarsePlan.axes,
            coordinate,
          }));
        if ("status" in planned) {
          failed.push(planned);
        } else {
          ready.push(planned);
        }
      }
      onSweepProgress(failed.length, failed);
      const executed = await executeSweepBatches({
        clients,
        runner,
        ready,
        tape: tapeResult.tape,
        buffers: tapeResult.buffers,
        definitionId: args.definitionId!,
        configSchemaVersion,
        subscriptionTier,
        initialEquity: args.initialEquity!,
        executionModel,
        mintId,
        maxVariantsPerBatch,
        onProgress: (done, points) => {
          onSweepProgress(failed.length + done, [...failed, ...points]);
        },
      });
      return [...failed, ...executed];
    };

    const exactTotalEstimate =
      args.searchMode === "fast"
        ? standardPlan.coordinates.length
        : coarsePlan.coordinates.length;
    let sweepPoints: readonly SweepPoint[] = [];
    emitProgress(flags, writeLine, "sweep", 0);
    const coarsePoints = await runPrepared(
      coarsePlan.coordinates,
      (done, points) => {
        sweepPoints = points;
        emitProgress(
          flags,
          writeLine,
          "sweep",
          done / Math.max(exactTotalEstimate, 1)
        );
      }
    );
    sweepPoints = coarsePoints;

    let refinement: SweepCoordinate[] = [];
    if (args.searchMode === "fast") {
      const center = selectBestNonLiquidatedPoint(coarsePoints);
      refinement = center
        ? capSweepRefinement(
            coarsePoints.length,
            planSweepFastRefinement({
              coarsePlan,
              standardPlan,
              center: center.coordinate,
            }),
            resolveMaxSweepCombinations(subscriptionTier)
          )
        : [];
    }

    if (refinement.length > 0) {
      const refinementPoints = await runPrepared(
        refinement,
        (done, points) => {
          sweepPoints = [...coarsePoints, ...points];
          emitProgress(
            flags,
            writeLine,
            "sweep",
            (coarsePlan.coordinates.length + done) /
              (coarsePlan.coordinates.length + refinement.length)
          );
        }
      );
      sweepPoints = [...coarsePoints, ...refinementPoints];
    }
    emitProgress(flags, writeLine, "sweep", 1);

    const engineVersion =
      (typeof client.version === "function"
        ? (await client.version()).trim()
        : "") || "node-wasm";
    const best = selectBestNonLiquidatedPoint(sweepPoints);
    const successful = sweepPoints.filter((point) => point.status === "ok");
    const elapsedMs = Math.max(0, (deps.now ?? Date.now)() - startedAt);
    const sampled =
      standardPlan.requestedCombinationCount >
      coarsePlan.coordinates.length + refinement.length;
    const completed = shouldPersistSweepCompletion({
      completed: true,
      cancelled: false,
    });
    let experimentId = args.experimentId;
    let sweepId: string | undefined;
    let clientSweepId: string | undefined;
    let persisted = false;

    if (persist && completed) {
      emitProgress(flags, writeLine, "persist", 0);
      if (createExperiment) {
        const created = await postJson(
          api,
          profile,
          env,
          CREATE_EXPERIMENT_PATH,
          {
            name: args.name,
            strategyDefinitionId: args.definitionId,
            strategyDefinitionDisplay: {
              zh: args.definitionLabelZh?.trim() || args.definitionId,
              en: args.definitionLabelEn?.trim() || args.definitionId,
            },
          },
          mintId,
          "engine_backtest.experiments.create"
        );
        experimentId = extractEntityId(created.json);
        if (!experimentId) {
          throw new EngineBacktestError({
            type: "runtime",
            subtype: "create_experiment_no_id",
            message: "experiments.create response did not include an id",
            details: created.json,
          });
        }
      }
      if (!experimentId) {
        throw new EngineBacktestError({
          type: "usage",
          subtype: "missing_experiment",
          message:
            "Provide --experiment <uuid> or --create-experiment --name <name>",
          status: 400,
        });
      }
      const tapeSymbols = uniqueSeriesField(tapeResult.tape.series, "symbol");
      const snapshot = buildSweepBaseSnapshot({
        definitionId: args.definitionId,
        configSchemaVersion,
        config,
        exchangeId: exchange.id,
        rangeStart: tapeResult.tape.from
          ? tapeResult.tape.from.slice(0, 10)
          : args.range.rangeStart,
        rangeEnd: tapeResult.tape.to
          ? exclusiveTapeEndToRangeEnd(tapeResult.tape.to)
          : args.range.rangeEnd,
        initialEquity: args.initialEquity!,
        subscriptionTier,
        dataQualityMode: args.dataQualityMode,
        symbols: tapeSymbols.length > 0 ? tapeSymbols : coverage.symbols,
        timeframes: uniqueSeriesField(tapeResult.tape.series, "timeframe"),
        baseTimeframe: tapeResult.tape.baseTimeframe || args.replayTimeframe,
        executionModel,
        positionSideDual: true,
        engineVersion,
      });
      clientSweepId = mintClientSweepId(mintId);
      const body = buildCreateSweepRequest({
        clientSweepId,
        snapshot,
        axes: coarsePlan.axes,
        mode: args.mode,
        searchMode: args.searchMode,
        concurrency,
        requestedCombinationCount: standardPlan.requestedCombinationCount,
        sampled,
        points: sweepPoints,
        successfulCount: successful.length,
        failedCount: sweepPoints.length - successful.length,
        liquidatedCount: successful.filter(
          (point) => (point.metrics?.liquidationCount ?? 0) > 0
        ).length,
        elapsedMs,
        best,
        engineVersion,
      });
      const saved = await postJson(
        api,
        profile,
        env,
        sweepsPath(experimentId),
        body,
        mintId,
        "engine_backtest.experiments.byId.sweeps.create"
      );
      sweepId = extractEntityId(saved.json);
      if (!sweepId) {
        throw new EngineBacktestError({
          type: "runtime",
          subtype: "create_sweep_no_id",
          message: "sweeps.create response did not include an id",
          details: saved.json,
        });
      }
      persisted = true;
      emitProgress(flags, writeLine, "persist", 1);
    }

    return {
      persisted,
      sweepId,
      clientSweepId,
      mode: args.mode,
      searchMode: args.searchMode,
      requestedCombinationCount: standardPlan.requestedCombinationCount,
      sampled,
      combinationCount: sweepPoints.length,
      successfulCount: successful.length,
      failedCount: sweepPoints.length - successful.length,
      liquidatedCount: successful.filter(
        (point) => (point.metrics?.liquidationCount ?? 0) > 0
      ).length,
      elapsedMs,
      best: best
        ? {
            coordinate: best.coordinate,
            returnPct: best.returnPct,
            config: applySweepCoordinate(config, coarsePlan.axes, best.coordinate),
          }
        : null,
      points: sweepPoints,
      engineVersion,
      experimentId,
      experimentUrl: experimentId
        ? experimentSweepPageUrl(profile.name as ProfileName, experimentId)
        : undefined,
      coverageWarnings: tapeResult.coverageWarnings ?? [],
      axes: coarsePlan.axes,
    };
  } finally {
    for (const client of clients) {
      client.terminate();
    }
  }
}

function requireAuth(
  profile: ProfileConfig,
  env: NodeJS.ProcessEnv,
  loadTokensFn: typeof loadTokens
): void {
  const tokens = loadTokensFn(profile, env);
  if (tokens?.accessToken?.trim()) return;
  throw new EngineBacktestError({
    type: "http",
    status: 401,
    message: "Not authenticated. Run alphafox auth login.",
    hint: "Tokens live in the OS keychain. Do not pass --token.",
    subtype: "unauthenticated",
  });
}

function extractErrorMessage(json: unknown, fallback: string): string {
  if (json && typeof json === "object") {
    const o = json as Record<string, unknown>;
    if (typeof o.message === "string") return o.message;
    if (typeof o.detail === "string") return o.detail;
    if (typeof o.error === "string") return o.error;
    if (o.error && typeof o.error === "object") {
      const e = o.error as Record<string, unknown>;
      if (typeof e.message === "string") return e.message;
    }
  }
  return fallback || "Request failed";
}

function extractErrorCode(json: unknown): string | number | undefined {
  if (json && typeof json === "object") {
    const o = json as Record<string, unknown>;
    if (typeof o.code === "string" || typeof o.code === "number") return o.code;
  }
  return undefined;
}
function extractErrorSubtype(json: unknown): string | undefined {
  if (!json || typeof json !== "object") return undefined;
  const o = json as Record<string, unknown>;
  if (typeof o.subtype === "string") return o.subtype;
  if (o.error && typeof o.error === "object") {
    const e = o.error as Record<string, unknown>;
    if (typeof e.subtype === "string") return e.subtype;
  }
  return undefined;
}

function extractErrorDetails(json: unknown): unknown {
  if (!json || typeof json !== "object") return undefined;
  const o = json as Record<string, unknown>;
  if ("details" in o) return o.details;
  if (o.error && typeof o.error === "object" && "details" in o.error) {
    return o.error.details;
  }
  return undefined;
}

function extractEntityId(json: unknown): string | undefined {
  if (!json || typeof json !== "object") return undefined;
  const o = json as Record<string, unknown>;
  if (typeof o.id === "string" && o.id.trim()) return o.id.trim();
  if (o.data && typeof o.data === "object") {
    const d = o.data as Record<string, unknown>;
    if (typeof d.id === "string" && d.id.trim()) return d.id.trim();
  }
  return undefined;
}

function extractSubscriptionTier(json: unknown): SubscriptionTier | undefined {
  if (!json || typeof json !== "object") return undefined;
  const root = json as Record<string, unknown>;
  const nested =
    root.data && typeof root.data === "object"
      ? (root.data as Record<string, unknown>)
      : undefined;
  const value = root.subscriptionTier ?? nested?.subscriptionTier;
  return typeof value === "string" &&
    SUBSCRIPTION_TIERS.has(value as SubscriptionTier)
    ? (value as SubscriptionTier)
    : undefined;
}

async function postJson(
  api: NonNullable<EngineBacktestSweepDeps["apiRequest"]>,
  profile: ProfileConfig,
  env: NodeJS.ProcessEnv,
  path: string,
  body: unknown,
  mintId: () => string,
  operationId: string
): Promise<ApiResponse> {
  const res = await api(
    {
      method: "POST",
      path,
      body,
      profile,
      operationId,
      catalogIdempotent: false,
      idempotencyKey: mintId(),
    },
    env
  );
  if (res.status < 200 || res.status >= 300) {
    throw new EngineBacktestError({
      type: "http",
      status: res.status,
      subtype: res.outcome ?? extractErrorSubtype(res.json),
      message: extractErrorMessage(res.json, res.bodyText),
      code: extractErrorCode(res.json),
      details: extractErrorDetails(res.json),
    });
  }
  return res;
}

async function loadAccountSubscriptionTier(
  api: NonNullable<EngineBacktestSweepDeps["apiRequest"]>,
  profile: ProfileConfig,
  env: NodeJS.ProcessEnv
): Promise<SubscriptionTier> {
  const res = await api(
    {
      method: "GET",
      path: SUBSCRIPTION_PATH,
      profile,
    },
    env
  );
  if (res.status >= 400) {
    throw new EngineBacktestError({
      type: "http",
      status: res.status,
      message: extractErrorMessage(res.json, res.bodyText),
      code: extractErrorCode(res.json),
      details: res.json,
    });
  }
  const tier = extractSubscriptionTier(res.json);
  if (!tier) {
    throw new EngineBacktestError({
      type: "runtime",
      subtype: "subscription_tier_unresolved",
      message:
        "subscriptions.me response did not include a valid subscriptionTier",
      details: res.json,
    });
  }
  return tier;
}

async function loadRuntime(
  deps: EngineBacktestSweepDeps,
  env: NodeJS.ProcessEnv
): Promise<{
  readonly wasm: BacktestWasmModule;
  readonly runner: BacktestRunnerModule;
}> {
  if (
    deps.createNodeBacktestClient &&
    deps.loadTape &&
    deps.assembleScenario &&
    deps.resolveTapeExchange
  ) {
    return {
      wasm: { createNodeBacktestClient: deps.createNodeBacktestClient },
      runner: {
        loadTape: deps.loadTape,
        assembleScenario: deps.assembleScenario,
        resolveTapeExchange: deps.resolveTapeExchange,
        DEFAULT_EXECUTION_MODEL:
          deps.defaultExecutionModel ?? DEFAULT_EXECUTION_MODEL,
      },
    };
  }
  const [wasmLoaded, runnerLoaded] = await Promise.all([
    loadBacktestWasm(env, deps.resolveHooks),
    loadBacktestRunner(env, deps.resolveHooks),
  ]);
  return { wasm: wasmLoaded.module, runner: runnerLoaded.module };
}

async function resolveConfigSchemaVersion(
  client: BacktestClientLike,
  definitionId: string,
  explicit?: number
): Promise<number> {
  if (explicit !== undefined) {
    return explicit;
  }
  const listed = await client.strategyDefinitions();
  const found = listed.definitions.find((d) => d.id === definitionId);
  const version = found?.configSchemaVersion;
  if (typeof version !== "number" || !Number.isInteger(version) || version <= 0) {
    throw new EngineBacktestError({
      type: "runtime",
      subtype: "config_schema_version_unresolved",
      message: `strategyDefinitions() has no configSchemaVersion for "${definitionId}"`,
      hint: "Pass --config-schema-version explicitly.",
      details: { definitionId },
    });
  }
  return version;
}

async function planCoordinate(input: {
  readonly client: BacktestClientLike;
  readonly definitionId: string;
  readonly configSchemaVersion: number;
  readonly config: SweepConfigRecord;
  readonly axes: SweepPlan["axes"];
  readonly coordinate: SweepCoordinate;
}): Promise<PlannedSweepCoordinate | SweepPoint> {
  const nextConfig = applySweepCoordinate(
    input.config,
    input.axes,
    input.coordinate
  );
  try {
    const plan = await input.client.planBacktest({
      definitionId: input.definitionId,
      configSchemaVersion: input.configSchemaVersion,
      config: nextConfig,
    });
    if (!isSupportedPlan(plan)) {
      const reason =
        plan && typeof plan === "object" && "support" in plan
          ? (plan as { support?: { reason?: { message?: string } } }).support
              ?.reason
          : undefined;
      return {
        coordinate: input.coordinate,
        status: "failed",
        error:
          reason?.message ??
          `planBacktest does not support definition "${input.definitionId}"`,
      };
    }
    return {
      coordinate: input.coordinate,
      config: nextConfig,
      plan,
    };
  } catch (err) {
    if (isEngineBacktestError(err)) throw err;
    return {
      coordinate: input.coordinate,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function executeSweepBatches(input: {
  readonly clients: readonly BacktestClientLike[];
  readonly runner: BacktestRunnerModule;
  readonly ready: readonly PlannedSweepCoordinate[];
  readonly tape: EngineBacktestScenario["tape"];
  readonly buffers: Record<string, ArrayBuffer>;
  readonly definitionId: string;
  readonly configSchemaVersion: number;
  readonly subscriptionTier: SubscriptionTier;
  readonly initialEquity: number;
  readonly executionModel: EngineBacktestScenario["executionModel"];
  readonly mintId: () => string;
  readonly maxVariantsPerBatch: number;
  readonly onProgress: (done: number, points: readonly SweepPoint[]) => void;
}): Promise<SweepPoint[]> {
  if (input.ready.length === 0) {
    return [];
  }
  const workers = input.clients.slice(
    0,
    Math.min(input.clients.length, input.ready.length)
  );
  const chunks = partitionRoundRobin(input.ready, workers.length);
  const completed: Array<SweepPoint | undefined> = Array.from({
    length: input.ready.length,
  });

  await Promise.all(
    chunks.map(async (chunk, workerIndex) => {
      const client = workers[workerIndex]!;
      for (const subChunk of splitBatchChunk(chunk, input.maxVariantsPerBatch)) {
        const scenarios = subChunk.map((item) =>
          input.runner.assembleScenario({
            runId: input.mintId(),
            definitionId: input.definitionId,
            configSchemaVersion: input.configSchemaVersion,
            config: item.item.config,
            subscriptionTier: input.subscriptionTier,
            initialEquity: input.initialEquity,
            tape: input.tape,
            executionModel: input.executionModel,
          })
        );
        const first = scenarios[0];
        if (!first) continue;
        const { tape: _tape, ...baseScenario } = first;
        const batch: EngineBacktestBatchRequest = {
          version: 1,
          batchId: input.mintId(),
          baseScenario,
          variants: scenarios.map((scenario) => ({
            runId: scenario.runId,
            config: scenario.trader.config,
          })),
          tape: input.tape,
        };
        const result = await client.runBacktestBatch(
          batch,
          cloneTapeBuffers(input.buffers)
        );
        if (result.results.length !== subChunk.length) {
          throw new EngineBacktestError({
            type: "runtime",
            subtype: "batch_result_count",
            message: "runBacktestBatch returned an unexpected result count",
            details: {
              expected: subChunk.length,
              actual: result.results.length,
            },
          });
        }
        subChunk.forEach((entry, index) => {
          const point = result.results[index]!;
          completed[entry.index] = readBatchPoint(entry.item.coordinate, point);
        });
        const finished = completed.filter(
          (point): point is SweepPoint => point !== undefined
        );
        input.onProgress(finished.length, finished);
      }
    })
  );

  return completed.filter((point): point is SweepPoint => point !== undefined);
}

function readBatchPoint(
  coordinate: SweepCoordinate,
  point: {
    readonly status: "completed" | "failed";
    readonly metrics: EngineBacktestMetrics;
    readonly errors?: Array<{ readonly message: string }>;
  }
): SweepPoint {
  if (point.status === "completed") {
    return {
      coordinate,
      status: "ok",
      metrics: extractSweepMetrics(point.metrics),
    };
  }
  return {
    coordinate,
    status: "failed",
    error: point.errors?.[0]?.message ?? "runBacktestBatch variant failed",
  };
}

function partitionRoundRobin<T>(
  items: readonly T[],
  workerCount: number
): Array<Array<{ readonly index: number; readonly item: T }>> {
  const count = Math.min(Math.max(1, workerCount), items.length);
  const chunks = Array.from(
    { length: count },
    () => [] as Array<{ readonly index: number; readonly item: T }>
  );
  items.forEach((item, index) => {
    chunks[index % count]!.push({ index, item });
  });
  return chunks;
}

function unionTapePlans(plans: readonly EngineSupportedBacktestPlan[]): {
  readonly symbols: string[];
  readonly timeframes: string[];
  readonly seriesRequirements: EngineBacktestSeriesRequirement[];
  readonly needsFunding: boolean;
  readonly auxiliaryDataRequirements: EngineSupportedBacktestPlan["auxiliaryDataRequirements"];
} {
  const symbols = [...new Set(plans.flatMap((plan) => plan.symbols))];
  const timeframes = [...new Set(plans.flatMap((plan) => plan.timeframes))];
  const warmup = new Map<string, EngineBacktestSeriesRequirement>();
  for (const plan of plans) {
    for (const requirement of plan.seriesRequirements) {
      const key = `${requirement.symbol}\u0000${requirement.timeframe}`;
      const previous = warmup.get(key);
      if (
        !previous ||
        requirement.minWarmupCandles > previous.minWarmupCandles
      ) {
        warmup.set(key, requirement);
      }
    }
  }
  const auxiliary = new Map<
    string,
    EngineSupportedBacktestPlan["auxiliaryDataRequirements"][number]
  >();
  for (const plan of plans) {
    for (const item of plan.auxiliaryDataRequirements) {
      auxiliary.set(JSON.stringify(item), item);
    }
  }
  return {
    symbols,
    timeframes,
    seriesRequirements: [...warmup.values()],
    needsFunding: plans.some((plan) => plan.needsFunding),
    auxiliaryDataRequirements: [...auxiliary.values()],
  };
}

function isSupportedPlan(
  plan: EngineBacktestPlan | { status: "failed"; errors: unknown[] }
): plan is EngineSupportedBacktestPlan {
  return (
    !!plan &&
    typeof plan === "object" &&
    !("status" in plan && (plan as { status?: string }).status === "failed") &&
    "support" in plan &&
    (plan as { support?: { status?: string } }).support?.status === "supported"
  );
}

function asConfigRecord(value: unknown): SweepConfigRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new EngineBacktestError({
      type: "usage",
      subtype: "invalid_config",
      message: "--config must be a JSON object",
      status: 400,
    });
  }
  return value as SweepConfigRecord;
}

function coordinateKey(coordinate: SweepCoordinate): string {
  return coordinate.values.join("\u0000");
}

function emitProgress(
  flags: EngineBacktestCliFlags,
  writeLine: (value: unknown) => void,
  stage: string,
  fraction: number,
  detail?: string
): void {
  if (flags.format !== "jsonl") return;
  writeLine({
    event: "progress",
    stage,
    fraction,
    ...(detail ? { detail } : {}),
  });
}
