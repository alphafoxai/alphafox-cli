import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { isAbsolute, resolve as resolvePath } from "node:path";

import type { ProfileConfig } from "../config/profiles";
import { resolveProfile, type ProfileName } from "../config/profiles";
import { writeError, writeSuccess } from "../envelope";
import type { ApiRequestOptions, ApiResponse } from "../http/client";
import { apiRequest as defaultApiRequest } from "../http/client";
import { loadTokens } from "../keychain/store";
import { EngineBacktestError, isEngineBacktestError } from "./errors";
import {
  ENGINE_BACKTEST_RUN_USAGE,
  parseEngineBacktestRunArgs,
} from "./parse-args";
import {
  buildCreateRunRequest,
  DEFAULT_EXECUTION_MODEL,
  experimentPageUrl,
} from "./persist";
import {
  loadBacktestRunner,
  loadBacktestWasm,
  type ResolvePackageHooks,
} from "./resolve-packages";
import type {
  BacktestClientLike,
  BacktestRunnerModule,
  BacktestWasmModule,
  EngineBacktestPlan,
  EngineBacktestRunArgs,
  EngineBacktestRunSuccess,
  EngineBacktestScenario,
  TapeLoadProgress,
} from "./types";

export interface EngineBacktestCliFlags {
  readonly profile?: string;
  readonly format: "json" | "jsonl" | "text";
  readonly yes: boolean;
  readonly dryRun: boolean;
  readonly noInput: boolean;
  readonly unsafeCustomEndpoint?: string;
  readonly jq?: string;
}

export interface EngineBacktestRunDeps {
  readonly loadTape?: BacktestRunnerModule["loadTape"];
  readonly assembleScenario?: BacktestRunnerModule["assembleScenario"];
  readonly resolveTapeExchange?: BacktestRunnerModule["resolveTapeExchange"];
  readonly defaultExecutionModel?: BacktestRunnerModule["DEFAULT_EXECUTION_MODEL"];
  readonly createNodeBacktestClient?: BacktestWasmModule["createNodeBacktestClient"];
  readonly apiRequest?: (
    options: ApiRequestOptions,
    env?: NodeJS.ProcessEnv
  ) => Promise<ApiResponse>;
  readonly loadTokens?: typeof loadTokens;
  readonly readFile?: (path: string) => string;
  readonly cwd?: string;
  readonly randomUUID?: () => string;
  readonly writeLine?: (value: unknown) => void;
  readonly resolveHooks?: ResolvePackageHooks;
}

const CREATE_EXPERIMENT_PATH = "/api/v1/engine-backtest/experiments";

function runsPath(experimentId: string): string {
  return `/api/v1/engine-backtest/experiments/${encodeURIComponent(experimentId)}/runs`;
}

export function loadConfigValue(
  raw: string,
  options: { readonly cwd?: string; readonly readFile?: (path: string) => string } = {}
): unknown {
  const cwd = options.cwd ?? process.cwd();
  const read = options.readFile ?? ((p: string) => readFileSync(p, "utf8"));
  if (raw.startsWith("@")) {
    const rel = raw.slice(1);
    if (!rel) {
      throw new EngineBacktestError({
        type: "usage",
        subtype: "missing_config",
        message: "--config @path is empty",
        status: 400,
      });
    }
    const abs = isAbsolute(rel) ? rel : resolvePath(cwd, rel);
    try {
      return JSON.parse(read(abs));
    } catch (err) {
      throw new EngineBacktestError({
        type: "usage",
        subtype: "invalid_config",
        message: `Cannot read --config file ${abs}: ${err instanceof Error ? err.message : String(err)}`,
        status: 400,
      });
    }
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new EngineBacktestError({
      type: "usage",
      subtype: "invalid_config",
      message: "--config must be JSON or @path-to.json",
      status: 400,
    });
  }
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

function isSupportedPlan(
  plan: EngineBacktestPlan | { status: "failed"; errors: unknown[] }
): plan is Extract<EngineBacktestPlan, { support: { status: "supported" } }> {
  return (
    !!plan &&
    typeof plan === "object" &&
    !("status" in plan && (plan as { status?: string }).status === "failed") &&
    "support" in plan &&
    (plan as { support?: { status?: string } }).support?.status === "supported"
  );
}

function definitionDisplay(
  args: EngineBacktestRunArgs
): { readonly zh: string; readonly en: string } {
  const fallback = args.definitionId ?? "strategy";
  return {
    zh: args.definitionLabelZh?.trim() || fallback,
    en: args.definitionLabelEn?.trim() || fallback,
  };
}

function requireAuth(
  profile: ProfileConfig,
  env: NodeJS.ProcessEnv,
  loadTokensFn: typeof loadTokens
): void {
  const tokens = loadTokensFn(profile.name, env);
  if (tokens?.accessToken?.trim()) return;
  throw new EngineBacktestError({
    type: "http",
    status: 401,
    message: "Not authenticated. Run alphafox auth login.",
    hint: "Tokens live in the OS keychain. Do not pass --token.",
    subtype: "unauthenticated",
  });
}

async function postJson(
  api: NonNullable<EngineBacktestRunDeps["apiRequest"]>,
  profile: ProfileConfig,
  env: NodeJS.ProcessEnv,
  path: string,
  body: unknown,
  mintId: () => string
): Promise<ApiResponse> {
  const res = await api(
    {
      method: "POST",
      path,
      body,
      profile,
      idempotencyKey: mintId(),
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
  return res;
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

export async function executeEngineBacktestRun(
  args: EngineBacktestRunArgs,
  flags: EngineBacktestCliFlags,
  env: NodeJS.ProcessEnv = process.env,
  deps: EngineBacktestRunDeps = {}
): Promise<EngineBacktestRunSuccess> {
  if (args.help) {
    throw new EngineBacktestError({
      type: "usage",
      message: "internal: help should be handled by the command wrapper",
    });
  }
  if (!args.definitionId || !args.configRaw || !args.exchange || !args.range) {
    throw new EngineBacktestError({
      type: "usage",
      subtype: "invalid_args",
      message: "Missing required run arguments",
      status: 400,
    });
  }

  const profile = resolveProfile(flags.profile, env, {
    unsafeCustomEndpoint: flags.unsafeCustomEndpoint,
  });
  const api = deps.apiRequest ?? defaultApiRequest;
  const tokensFn = deps.loadTokens ?? loadTokens;
  const mintId = deps.randomUUID ?? randomUUID;
  const writeLine =
    deps.writeLine ??
    ((value: unknown) => {
      process.stdout.write(`${JSON.stringify(value)}\n`);
    });
  const persist = args.persist && !flags.dryRun;
  const createExperiment = args.createExperiment && !flags.dryRun;
  const needsApi = persist || createExperiment;

  if (needsApi) {
    requireAuth(profile, env, tokensFn);
  }

  const config = loadConfigValue(args.configRaw, {
    cwd: deps.cwd,
    readFile: deps.readFile,
  });

  let experimentId = args.experimentId;
  if (createExperiment) {
    const body = {
      name: args.name,
      strategyDefinitionId: args.definitionId,
      strategyDefinitionDisplay: definitionDisplay(args),
    };
    const res = await postJson(api, profile, env, CREATE_EXPERIMENT_PATH, body, mintId);
    experimentId = extractEntityId(res.json);
    if (!experimentId) {
      throw new EngineBacktestError({
        type: "runtime",
        subtype: "create_experiment_no_id",
        message: "experiments.create response did not include an id",
        details: res.json,
      });
    }
  }
  if (!experimentId) {
    throw new EngineBacktestError({
      type: "usage",
      subtype: "missing_experiment",
      message: "Provide --experiment <uuid> or --create-experiment --name <name>",
      status: 400,
    });
  }

  let wasm: BacktestWasmModule;
  let runner: BacktestRunnerModule;
  if (
    deps.createNodeBacktestClient &&
    deps.loadTape &&
    deps.assembleScenario &&
    deps.resolveTapeExchange
  ) {
    wasm = { createNodeBacktestClient: deps.createNodeBacktestClient };
    runner = {
      loadTape: deps.loadTape,
      assembleScenario: deps.assembleScenario,
      resolveTapeExchange: deps.resolveTapeExchange,
      DEFAULT_EXECUTION_MODEL:
        deps.defaultExecutionModel ?? DEFAULT_EXECUTION_MODEL,
    };
  } else {
    const [wasmLoaded, runnerLoaded] = await Promise.all([
      loadBacktestWasm(env, deps.resolveHooks),
      loadBacktestRunner(env, deps.resolveHooks),
    ]);
    wasm = wasmLoaded.module;
    runner = runnerLoaded.module;
  }

  const client: BacktestClientLike = wasm.createNodeBacktestClient();
  try {
    if (typeof client.init === "function") {
      await client.init();
    }

    let configSchemaVersion = args.configSchemaVersion;
    if (configSchemaVersion === undefined) {
      const listed = await client.strategyDefinitions();
      const found = listed.definitions.find((d) => d.id === args.definitionId);
      const version = found?.configSchemaVersion;
      if (typeof version !== "number" || !Number.isInteger(version) || version <= 0) {
        throw new EngineBacktestError({
          type: "runtime",
          subtype: "config_schema_version_unresolved",
          message: `strategyDefinitions() has no configSchemaVersion for "${args.definitionId}"`,
          hint: "Pass --config-schema-version explicitly.",
          details: { definitionId: args.definitionId },
        });
      }
      configSchemaVersion = version;
    }

    const plan = await client.planBacktest({
      definitionId: args.definitionId,
      configSchemaVersion,
      config,
    });
    if (!isSupportedPlan(plan)) {
      const reason =
        plan && typeof plan === "object" && "support" in plan
          ? (plan as { support?: { reason?: { code?: string; message?: string } } })
              .support?.reason
          : undefined;
      const errors =
        plan && typeof plan === "object" && "errors" in plan
          ? (plan as { errors?: unknown }).errors
          : undefined;
      throw new EngineBacktestError({
        type: "runtime",
        subtype: "plan_unsupported",
        message:
          reason?.message ??
          `planBacktest does not support definition "${args.definitionId}"`,
        code: reason?.code,
        details: { reason, errors, plan },
      });
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

    let tapeResult;
    try {
      tapeResult = await runner.loadTape({
        exchangeId: exchange.id,
        exchange,
        symbols: plan.symbols,
        timeframes: plan.timeframes,
        seriesRequirements: plan.seriesRequirements,
        needsFunding: plan.needsFunding,
        auxiliaryDataRequirements: plan.auxiliaryDataRequirements,
        fromMs: args.range.fromMs,
        toMs: args.range.toMs,
        dataQualityMode: args.dataQualityMode,
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

    const runId = mintId();
    const executionModel = {
      ...(runner.DEFAULT_EXECUTION_MODEL ?? DEFAULT_EXECUTION_MODEL),
      ...args.executionModelOverride,
    };
    const scenario: EngineBacktestScenario = runner.assembleScenario({
      runId,
      definitionId: args.definitionId,
      configSchemaVersion,
      config: plan.effectiveConfig ?? config,
      subscriptionTier: args.tier,
      initialEquity: args.initialEquity!,
      tape: tapeResult.tape,
      executionModel,
    });

    const result = await client.runBacktest(
      scenario,
      tapeResult.buffers,
      (fraction) => {
        emitProgress(flags, writeLine, "wasm", fraction);
      }
    );
    if (result.status === "failed") {
      throw new EngineBacktestError({
        type: "runtime",
        subtype: "backtest_failed",
        message: "runBacktest returned status=failed",
        details: { errors: result.errors, runId: result.runId },
      });
    }

    const engineVersion =
      result.engineVersion?.trim() ||
      (typeof client.version === "function" ? (await client.version()).trim() : "") ||
      "node-wasm";

    let persistedRunId: string | undefined;
    if (persist) {
      const body = buildCreateRunRequest({
        clientRunId: mintId(),
        scenario,
        metrics: result.metrics,
        exchangeId: exchange.id,
        dataQualityMode: args.dataQualityMode,
        engineVersion,
      });
      const res = await postJson(api, profile, env, runsPath(experimentId), body, mintId);
      persistedRunId = extractEntityId(res.json);
      if (!persistedRunId) {
        throw new EngineBacktestError({
          type: "runtime",
          subtype: "create_run_no_id",
          message: "runs.create response did not include an id",
          details: res.json,
        });
      }
    }

    return {
      metrics: result.metrics,
      engineVersion,
      experimentId,
      runId: persistedRunId,
      experimentUrl: experimentPageUrl(profile.name as ProfileName, experimentId),
      persisted: Boolean(persistedRunId),
      coverageWarnings: tapeResult.coverageWarnings ?? [],
    };
  } finally {
    client.terminate();
  }
}

export function engineBacktestHelpData(): {
  readonly name: string;
  readonly usage: string[];
  readonly notes: string[];
} {
  return {
    name: "engine-backtest",
    usage: [
      ...ENGINE_BACKTEST_RUN_USAGE,
      "Catalog CRUD (underscore domain): alphafox engine_backtest experiments list|create|...",
    ],
    notes: [
      "Local WASM run is hyphenated engine-backtest so it does not steal typed catalog engine_backtest.*",
      "runs.create is write (not high-risk-write); --yes is not required",
      "Do not pass --token; use alphafox auth login",
    ],
  };
}

export async function cmdEngineBacktest(
  args: string[],
  flags: EngineBacktestCliFlags,
  env: NodeJS.ProcessEnv = process.env,
  deps: EngineBacktestRunDeps = {}
): Promise<number> {
  const [sub, ...rest] = args;
  if (
    !sub ||
    sub === "help" ||
    sub === "--help" ||
    sub === "-h"
  ) {
    writeSuccess(engineBacktestHelpData(), {
      format: flags.format,
      jq: flags.jq,
    });
    return 0;
  }
  if (sub !== "run") {
    writeError({
      type: "usage",
      subtype: "unknown_subcommand",
      message: `Unknown engine-backtest subcommand "${sub}"`,
      hint: "Local WASM: alphafox engine-backtest run. Catalog CRUD: alphafox engine_backtest experiments list",
    });
  }

  let parsed: EngineBacktestRunArgs;
  try {
    parsed = parseEngineBacktestRunArgs(rest);
  } catch (err) {
    if (isEngineBacktestError(err)) {
      writeError(
        {
          type: err.type,
          subtype: err.subtype,
          message: err.message,
          hint: err.hint,
          status: err.status,
          details: err.details,
        },
        { exitCode: err.status === 401 || err.status === 403 ? 77 : undefined }
      );
    }
    throw err;
  }

  if (parsed.help) {
    writeSuccess(engineBacktestHelpData(), {
      format: flags.format,
      jq: flags.jq,
    });
    return 0;
  }

  try {
    const result = await executeEngineBacktestRun(parsed, flags, env, deps);
    writeSuccess(result, { format: flags.format, jq: flags.jq });
    return 0;
  } catch (err) {
    if (isEngineBacktestError(err)) {
      writeError(
        {
          type: err.type,
          subtype: err.subtype,
          message: err.message,
          hint: err.hint,
          status: err.status,
          code: err.code,
          details: err.details,
        },
        { exitCode: err.status === 401 || err.status === 403 ? 77 : undefined }
      );
    }
    throw err;
  }
}
