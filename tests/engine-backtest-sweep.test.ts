import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { EngineBacktestError } from "../src/engine-backtest/errors";
import {
  parseEngineBacktestRunArgs,
  parseEngineBacktestSweepArgs,
} from "../src/engine-backtest/parse-args";
import { parseSweepAxesDocument } from "../src/engine-backtest/parse-axes";
import type { ProfileConfig } from "../src/config/profiles";
import {
  DEFAULT_EXECUTION_MODEL,
  ENGINE_BACKTEST_SWEEP_ERROR_MAX_UTF8_BYTES,
  ENGINE_BACKTEST_SWEEP_MAX_UTF8_BYTES,
  SNAPSHOT_SCHEMA_VERSION,
  buildCreateSweepRequest,
  buildSweepBaseSnapshot,
  experimentSweepPageUrl,
  mintClientSweepId,
  shouldPersistSweepCompletion,
  sweepsPath,
} from "../src/engine-backtest/persist";
import {
  cmdEngineBacktest,
  engineBacktestHelpData,
  type EngineBacktestCliFlags,
} from "../src/engine-backtest/run-command";
import {
  cloneTapeBuffers,
  executeEngineBacktestSweep,
  MAX_ENGINE_BACKTEST_BATCH_VARIANTS,
  splitBatchChunk,
  SWEEP_WASM_BATCH_VARIANTS,
} from "../src/engine-backtest/sweep-command";
import {
  planSweep,
  type SweepAxisInput,
} from "../src/engine-backtest/sweep-kernel";
import type {
  BacktestClientLike,
  EngineBacktestBatchRequest,
  EngineBacktestMetrics,
  EngineBacktestScenario,
  EngineSupportedBacktestPlan,
  TapeLoadResult,
} from "../src/engine-backtest/types";
import type { ApiResponse } from "../src/http/client";

const FLAGS: EngineBacktestCliFlags = {
  format: "json",
  yes: false,
  dryRun: false,
  noInput: true,
  profile: "local",
};

const METRICS: EngineBacktestMetrics = {
  initialEquity: 10_000,
  finalEquity: 11_000,
  netPnl: 1_000,
  returnPct: 10,
  maxDrawdownPct: 5,
  sharpeRatio: 1.2,
  orderCount: 4,
  filledOrderCount: 4,
  canceledOrderCount: 0,
  tradeCount: 3,
  winningTrades: 2,
  losingTrades: 1,
  winRatePct: 66.6,
  feesPaid: 1,
  slippagePaid: 0,
  liquidated: false,
};

const PLAN: EngineSupportedBacktestPlan = {
  definitionId: "grid",
  configSchemaVersion: 4,
  support: { status: "supported" },
  effectiveConfig: { strategy: { period: 10 } },
  universe: { kind: "fixed", symbols: ["BTC/USDT:USDT"] },
  symbols: ["BTC/USDT:USDT"],
  timeframes: ["1m"],
  seriesRequirements: [
    { symbol: "BTC/USDT:USDT", timeframe: "1m", minWarmupCandles: 0 },
  ],
  needsFunding: false,
  auxiliaryDataRequirements: [],
  configFingerprint: "sha256:test",
};

const BASE_CONFIG = { strategy: { period: 10, spacing: 0.6 } };

function sampleScenario(runId = "run-1"): EngineBacktestScenario {
  return {
    version: 1,
    runId,
    trader: {
      strategyDefinitionId: "grid",
      configSchemaVersion: 4,
      subscriptionTier: "pro",
      config: BASE_CONFIG,
    },
    exchange: { positionSideDual: true, initialEquity: 10_000 },
    executionModel: DEFAULT_EXECUTION_MODEL,
    tape: {
      from: "2026-08-01T00:00:00.000Z",
      to: "2026-08-09T00:00:00.000Z",
      baseTimeframe: "1m",
      markets: {},
      series: [
        { symbol: "BTC/USDT:USDT", timeframe: "1m", buffer: "k0", rows: 10 },
      ],
    },
  };
}

function sampleTape(buffer = new ArrayBuffer(8)): TapeLoadResult {
  return {
    tape: sampleScenario().tape,
    buffers: { k0: buffer },
    coverageWarnings: [],
    coverageIssues: [],
  };
}

function metricsFor(returnPct: number, liquidated = false): EngineBacktestMetrics {
  return {
    ...METRICS,
    returnPct,
    netPnl: returnPct * 100,
    finalEquity: 10_000 + returnPct * 100,
    liquidated,
  };
}

function fakeClient(overrides: Partial<BacktestClientLike> = {}): BacktestClientLike {
  return {
    init: async () => "test-engine",
    version: async () => "test-engine",
    strategyDefinitions: async () => ({
      engineVersion: "test-engine",
      definitions: [{ id: "grid", configSchemaVersion: 4 }],
    }),
    planBacktest: async () => PLAN,
    runBacktest: async (scenario) => ({
      runId: scenario.runId,
      status: "completed",
      engineVersion: "test-engine",
      metrics: METRICS,
    }),
    runBacktestBatch: async (batch) => ({
      batchId: batch.batchId,
      status: "completed",
      results: batch.variants.map((variant) => ({
        runId: variant.runId,
        status: "completed" as const,
        metrics: METRICS,
      })),
    }),
    terminate: () => undefined,
    ...overrides,
  };
}

function jsonResponse(status: number, json: unknown): ApiResponse {
  return {
    status,
    headers: new Headers(),
    bodyText: JSON.stringify(json),
    requestId: "rid-test",
    json,
  };
}

function sweepArgv(extra: string[] = []): string[] {
  return [
    "--experiment",
    "11111111-1111-1111-1111-111111111111",
    "--definition",
    "grid",
    "--config",
    JSON.stringify(BASE_CONFIG),
    "--axes",
    JSON.stringify({
      axes: [
        {
          path: ["strategy", "period"],
          min: 8,
          max: 12,
          step: 2,
        },
      ],
    }),
    "--exchange",
    "binance",
    "--range",
    "2026-08-01..2026-08-08",
    "--initial-equity",
    "10000",
    ...extra,
  ];
}

function isolatedEnv(): NodeJS.ProcessEnv {
  return { ALPHAFOX_CONFIG_DIR: mkdtempSync(join(tmpdir(), "alphafox-cfg-")) };
}

function runnerDeps(overrides: {
  readonly client?: BacktestClientLike;
  readonly createClient?: () => BacktestClientLike;
  readonly loadTape?: (req: {
    readonly seriesRequirements?: readonly {
      readonly symbol: string;
      readonly timeframe: string;
      readonly minWarmupCandles: number;
    }[];
  }) => Promise<TapeLoadResult> | TapeLoadResult;
  readonly apiRequest?: (
    options: { readonly method: string; readonly path: string; readonly body?: unknown }
  ) => Promise<ApiResponse>;
  readonly loadTokens?: () => {
    readonly accessToken: string;
    readonly refreshToken: string;
    readonly expiresAt: number;
    readonly environment: string;
    readonly issuer: string;
    readonly audience: string;
    readonly clientId: string;
    readonly scopes: readonly string[];
  } | null;
  readonly assembleScenario?: (input: {
    readonly runId: string;
    readonly config: unknown;
    readonly subscriptionTier: string;
  }) => EngineBacktestScenario;
} = {}) {
  return {
    createNodeBacktestClient:
      overrides.createClient ?? (() => overrides.client ?? fakeClient()),
    loadTape: async (req: {
      readonly seriesRequirements?: readonly {
        readonly symbol: string;
        readonly timeframe: string;
        readonly minWarmupCandles: number;
      }[];
    }) =>
      overrides.loadTape
        ? await overrides.loadTape(req)
        : sampleTape(),
    assembleScenario: (input: {
      readonly runId: string;
      readonly config: unknown;
      readonly subscriptionTier: string;
    }) =>
      overrides.assembleScenario
        ? overrides.assembleScenario(input)
        : {
            ...sampleScenario(input.runId),
            trader: {
              ...sampleScenario(input.runId).trader,
              config: input.config,
              subscriptionTier: input.subscriptionTier as "pro",
            },
          },
    resolveTapeExchange: () => ({
      id: "binance_perp_usdt",
      label: "Binance",
      ccxtId: "binanceusdm",
      marketType: "swap",
      quoteAsset: "USDT",
    }),
    defaultExecutionModel: DEFAULT_EXECUTION_MODEL,
    apiRequest:
      overrides.apiRequest ??
      (async () => jsonResponse(500, { message: "should not be called" })),
    loadTokens: overrides.loadTokens,
  };
}

const LOCAL_PROFILE: ProfileConfig = {
  name: "local",
  apiBaseUrl: "http://127.0.0.1:3000/api/v1",
  issuer: "http://127.0.0.1:3000/api/auth",
  audience: "http://127.0.0.1:3000/api/v1",
  clientId: "alphafox-cli-local",
};

function authedTokens() {
  return {
    accessToken: "test-access",
    refreshToken: "test-refresh",
    expiresAt: Date.now() + 60_000,
    environment: "local",
    issuer: LOCAL_PROFILE.issuer,
    audience: LOCAL_PROFILE.audience,
    clientId: LOCAL_PROFILE.clientId,
    scopes: ["openid", "profile"],
  };
}

function sampleSweepSnapshot() {
  return buildSweepBaseSnapshot({
    definitionId: "grid",
    configSchemaVersion: 4,
    config: BASE_CONFIG,
    exchangeId: "binance_perp_usdt",
    rangeStart: "2026-08-01",
    rangeEnd: "2026-08-08",
    initialEquity: 10_000,
    subscriptionTier: "pro",
    dataQualityMode: "strict",
    symbols: ["BTC/USDT:USDT"],
    timeframes: ["1m"],
    baseTimeframe: "1m",
    executionModel: DEFAULT_EXECUTION_MODEL,
    positionSideDual: true,
    engineVersion: "test-engine",
  });
}

const CLIENT_SWEEP_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function okSweepPoint(value: number, returnPct: number) {
  return {
    coordinate: { values: [value] },
    status: "ok" as const,
    metrics: {
      returnPct,
      maxDrawdownPct: 5,
      sharpeRatio: 1,
      winRatePct: 50,
      maxLeverage: 2,
      liquidationCount: 0,
      netPnl: returnPct,
      finalEquity: 10_000 + returnPct,
      tradeCount: 4,
    },
  };
}

function hydrateSweepDetailFromCreate(
  body: ReturnType<typeof buildCreateSweepRequest>,
  ids: { readonly id: string; readonly experimentId: string }
) {
  const createdAt = "2026-08-16T00:00:00.000Z";
  const expiresAt = "2026-08-23T00:00:00.000Z";
  return {
    id: ids.id,
    experimentId: ids.experimentId,
    clientSweepId: body.clientSweepId,
    searchMetadata: body.searchMetadata,
    aggregateSummary: body.aggregateSummary,
    createdAt,
    expiresAt,
    baseInputSnapshot: body.baseInputSnapshot,
    axes: body.axes,
    pointSummaries: body.pointSummaries,
    engineVersion: body.engineVersion,
    configSchemaVersion: body.configSchemaVersion,
  };
}

describe("engine-backtest sweep parse", () => {
  it("reuses run flags and requires --axes; persist is the default", () => {
    const parsed = parseEngineBacktestSweepArgs(sweepArgv(["--no-persist"]));
    assert.equal(parsed.help, false);
    assert.equal(parsed.persist, false);
    assert.equal(parsed.definitionId, "grid");
    assert.equal(parsed.exchange, "binance");
    assert.equal(parsed.initialEquity, 10_000);
    assert.equal(parsed.dataQualityMode, "basic");
    assert.equal(parsed.replayTimeframe, "1m");
    assert.equal(parsed.mode, "neighborhood");
    assert.equal(parsed.searchMode, "standard");
    assert.equal(parsed.concurrency, 2);
    assert.ok(parsed.axesRaw?.includes("strategy"));
  });

  it("accepts neighborhood/range and standard/fast plus concurrency", () => {
    const parsed = parseEngineBacktestSweepArgs(
      sweepArgv([
        "--no-persist",
        "--mode",
        "range",
        "--search-mode",
        "fast",
        "--concurrency",
        "4",
        "--tier",
        "pro",
        "--replay-timeframe",
        "5m",
        "--data-quality",
        "basic",
      ])
    );
    assert.equal(parsed.mode, "range");
    assert.equal(parsed.searchMode, "fast");
    assert.equal(parsed.concurrency, 4);
    assert.equal(parsed.tier, "pro");
    assert.equal(parsed.replayTimeframe, "5m");
    assert.equal(parsed.dataQualityMode, "basic");
  });

  it("does not let run parse --axes", () => {
    assert.throws(
      () =>
        parseEngineBacktestRunArgs([
          "--experiment",
          "11111111-1111-1111-1111-111111111111",
          "--definition",
          "grid",
          "--config",
          "{}",
          "--axes",
          "@./axes.json",
          "--exchange",
          "binance",
          "--range",
          "2026-08-01..2026-08-08",
          "--initial-equity",
          "10000",
        ]),
      (err: unknown) => {
        assert.ok(err instanceof EngineBacktestError);
        assert.equal(err.subtype, "unknown_flag");
        return true;
      }
    );
  });

  it("fails when --axes is missing", () => {
    assert.throws(
      () =>
        parseEngineBacktestSweepArgs([
          "--experiment",
          "11111111-1111-1111-1111-111111111111",
          "--definition",
          "grid",
          "--config",
          "{}",
          "--exchange",
          "binance",
          "--range",
          "2026-08-01..2026-08-08",
          "--initial-equity",
          "10000",
          "--no-persist",
        ]),
      (err: unknown) => {
        assert.ok(err instanceof EngineBacktestError);
        assert.equal(err.subtype, "missing_axes");
        return true;
      }
    );
  });
});

describe("engine-backtest sweep axes", () => {
  it("reads current from an explicit path and builds a neighborhood window", () => {
    const axes = parseSweepAxesDocument(
      {
        axes: [
          {
            path: ["strategy", "period"],
            min: 0,
            max: 20,
            step: 1,
          },
        ],
      },
      BASE_CONFIG,
      "neighborhood"
    );
    assert.deepEqual(axes[0]?.path, ["strategy", "period"]);
    assert.equal(axes[0]?.current, 10);
    assert.equal(axes[0]?.isInteger, true);
    assert.deepEqual(axes[0]?.window, { min: 7, max: 13, step: 1 });
    assert.deepEqual(planSweep({ axes, subscriptionTier: "pro" }).axes[0]?.values, [
      7, 8, 9, 10, 11, 12, 13,
    ]);
  });

  it("uses min/max/step as the range window and accepts dotted paths", () => {
    const axes = parseSweepAxesDocument(
      [
        {
          path: "strategy.period",
          min: 8,
          max: 12,
          step: 2,
        },
      ],
      BASE_CONFIG,
      "range"
    );
    assert.deepEqual(axes[0]?.path, ["strategy", "period"]);
    assert.deepEqual(axes[0]?.window, { min: 8, max: 12, step: 2 });
    assert.deepEqual(planSweep({ axes, subscriptionTier: "pro" }).axes[0]?.values, [
      8, 10, 12,
    ]);
  });

  it("accepts explicit values and does not invent a path", () => {
    const axes = parseSweepAxesDocument(
      {
        axes: [
          {
            path: ["strategy", "spacing"],
            values: [0.4, 0.6, 0.8],
          },
        ],
      },
      BASE_CONFIG,
      "range"
    );
    assert.deepEqual(axes[0]?.values, [0.4, 0.6, 0.8]);
    assert.equal(axes[0]?.current, 0.6);
    assert.equal(axes[0]?.isInteger, false);
    assert.equal(axes[0]?.window, undefined);
  });

  it("rejects axes that omit path, window, or a numeric current", () => {
    assert.throws(
      () =>
        parseSweepAxesDocument(
          { axes: [{ min: 1, max: 3, step: 1 }] },
          BASE_CONFIG,
          "range"
        ),
      (err: unknown) =>
        err instanceof EngineBacktestError && err.subtype === "invalid_axis_path"
    );
    assert.throws(
      () =>
        parseSweepAxesDocument(
          { axes: [{ path: ["strategy", "period"] }] },
          BASE_CONFIG,
          "range"
        ),
      (err: unknown) =>
        err instanceof EngineBacktestError &&
        err.subtype === "invalid_axis_window"
    );
    assert.throws(
      () =>
        parseSweepAxesDocument(
          {
            axes: [
              { path: ["strategy", "missing"], min: 1, max: 3, step: 1 },
            ],
          },
          BASE_CONFIG,
          "range"
        ),
      (err: unknown) =>
        err instanceof EngineBacktestError &&
        err.subtype === "invalid_axis_current"
    );
  });
});

describe("engine-backtest sweep buffers", () => {
  it("clones transferable tape buffers with slice(0)", () => {
    const source = new ArrayBuffer(8);
    new Uint8Array(source).set([1, 2, 3, 4, 5, 6, 7, 8]);
    const cloned = cloneTapeBuffers({ k0: source });
    assert.notEqual(cloned.k0, source);
    assert.equal(cloned.k0?.byteLength, 8);
    assert.equal(source.byteLength, 8);
    assert.deepEqual([...new Uint8Array(cloned.k0!)], [1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("chunks worker shares at the Engine batch cap", () => {
    assert.equal(MAX_ENGINE_BACKTEST_BATCH_VARIANTS, 256);
    assert.equal(SWEEP_WASM_BATCH_VARIANTS, 32);
    const parts = splitBatchChunk(
      Array.from({ length: 70 }, (_, index) => index),
      32
    );
    assert.deepEqual(
      parts.map((part) => part.length),
      [32, 32, 6]
    );
    assert.ok(
      splitBatchChunk(Array.from({ length: 300 }, (_, index) => index)).every(
        (part) => part.length <= MAX_ENGINE_BACKTEST_BATCH_VARIANTS
      )
    );
  });
});

describe("engine-backtest sweep persist payload", () => {
  it("only persists completed non-cancelled searches", () => {
    assert.equal(
      shouldPersistSweepCompletion({ completed: true, cancelled: false }),
      true
    );
    assert.equal(
      shouldPersistSweepCompletion({ completed: true, cancelled: true }),
      false
    );
    assert.equal(
      shouldPersistSweepCompletion({ completed: false, cancelled: false }),
      false
    );
  });

  it("mints a stable UUID clientSweepId for retry", () => {
    const first = mintClientSweepId(() => "11111111-1111-4111-8111-111111111111");
    const second = mintClientSweepId();
    assert.equal(first, "11111111-1111-4111-8111-111111111111");
    assert.match(second, CLIENT_SWEEP_ID_RE);
  });

  it("builds a Web-hydrateable summary payload without tape, curves, or runs", () => {
    const clientSweepId = "22222222-2222-4222-8222-222222222222";
    const body = buildCreateSweepRequest({
      clientSweepId,
      snapshot: sampleSweepSnapshot(),
      axes: [{ path: ["strategy", "period"], current: 10, values: [8, 10, 12] }],
      mode: "range",
      searchMode: "standard",
      concurrency: 2,
      requestedCombinationCount: 3,
      sampled: false,
      points: [
        okSweepPoint(8, 8),
        { coordinate: { values: [10] }, status: "failed", error: "planner rejected" },
        okSweepPoint(12, 20),
      ],
      successfulCount: 2,
      failedCount: 1,
      liquidatedCount: 0,
      elapsedMs: 1234.6,
      best: { coordinate: { values: [12] }, returnPct: 20 },
      engineVersion: "test-engine",
    });
    assert.equal(body.clientSweepId, clientSweepId);
    assert.equal(body.baseInputSnapshot.snapshotSchemaVersion, SNAPSHOT_SCHEMA_VERSION);
    assert.equal(body.pointSummaries.length, 3);
    assert.equal(body.aggregateSummary.failedCount, 1);
    assert.equal(body.aggregateSummary.elapsedMs, 1235);
    assert.equal(body.aggregateSummary.best?.returnPct, 20);
    assert.equal(body.searchMetadata.concurrency, 2);
    const serialized = JSON.stringify(body);
    assert.equal(serialized.includes("islandScore"), false);
    assert.equal(serialized.includes("equityCurve"), false);
    assert.equal(serialized.includes("tape"), false);
    assert.equal("tape" in body, false);
    assert.equal("clientRunId" in body, false);

    const hydrated = hydrateSweepDetailFromCreate(body, {
      id: "33333333-3333-4333-8333-333333333333",
      experimentId: "11111111-1111-1111-1111-111111111111",
    });
    assert.equal(hydrated.pointSummaries.length, 3);
    assert.deepEqual(hydrated.axes[0]?.path, ["strategy", "period"]);
    assert.equal(hydrated.searchMetadata.mode, "range");
    assert.equal(hydrated.aggregateSummary.successfulCount, 2);
    assert.ok(hydrated.expiresAt > hydrated.createdAt);
  });

  it("keeps a zero-success diagnostic result and truncates point errors", () => {
    const longError = "x".repeat(ENGINE_BACKTEST_SWEEP_ERROR_MAX_UTF8_BYTES + 80);
    const body = buildCreateSweepRequest({
      clientSweepId: "22222222-2222-4222-8222-222222222222",
      snapshot: sampleSweepSnapshot(),
      axes: [{ path: ["strategy", "period"], current: 10, values: [8] }],
      mode: "neighborhood",
      searchMode: "standard",
      concurrency: 1,
      requestedCombinationCount: 1,
      sampled: false,
      points: [{ coordinate: { values: [8] }, status: "failed", error: longError }],
      successfulCount: 0,
      failedCount: 1,
      liquidatedCount: 0,
      elapsedMs: 10,
      best: null,
      engineVersion: "test-engine",
    });
    assert.equal(body.aggregateSummary.best, null);
    assert.equal(body.pointSummaries[0]?.status, "failed");
    assert.ok((body.pointSummaries[0]?.error?.length ?? 0) <= ENGINE_BACKTEST_SWEEP_ERROR_MAX_UTF8_BYTES);
    assert.ok((body.pointSummaries[0]?.error?.length ?? 0) > 0);
  });

  it("rejects an oversized create request as sweep_too_large", () => {
    const snapshot = sampleSweepSnapshot();
    assert.throws(
      () =>
        buildCreateSweepRequest({
          clientSweepId: "22222222-2222-4222-8222-222222222222",
          snapshot: {
            ...snapshot,
            config: { pad: "x".repeat(ENGINE_BACKTEST_SWEEP_MAX_UTF8_BYTES) },
          },
          axes: [{ path: ["strategy", "period"], current: 10, values: [8] }],
          mode: "range",
          searchMode: "standard",
          concurrency: 1,
          requestedCombinationCount: 1,
          sampled: false,
          points: [okSweepPoint(8, 1)],
          successfulCount: 1,
          failedCount: 0,
          liquidatedCount: 0,
          elapsedMs: 1,
          best: { coordinate: { values: [8] }, returnPct: 1 },
          engineVersion: "test-engine",
        }),
      (err: unknown) =>
        err instanceof EngineBacktestError && err.subtype === "sweep_too_large"
    );
  });

  it("keeps Sweep persist off web backtests and per-coordinate runs.create", () => {
    const persist = readFileSync(
      join(__dirname, "..", "..", "src", "engine-backtest", "persist.ts"),
      "utf8"
    );
    const command = readFileSync(
      join(__dirname, "..", "..", "src", "engine-backtest", "sweep-command.ts"),
      "utf8"
    );
    assert.equal(persist.includes("backtests."), false);
    assert.equal(command.includes("backtests."), false);
    assert.equal(command.includes("/runs"), false);
    assert.equal(command.includes("runs.create"), false);
    assert.ok(command.includes("sweepsPath"));
  });

  it("opens the Experiment Sweep tab", () => {
    assert.equal(
      experimentSweepPageUrl("local", "11111111-1111-1111-1111-111111111111"),
      "http://127.0.0.1:3000/dashboard/traders/backtest/11111111-1111-1111-1111-111111111111?tab=sweep"
    );
    assert.equal(
      sweepsPath("11111111-1111-1111-1111-111111111111"),
      "/api/v1/engine-backtest/experiments/11111111-1111-1111-1111-111111111111/sweeps"
    );
  });
});

describe("engine-backtest sweep execute", () => {
  it("persists once after every coordinate finishes and never creates a Run", async () => {
    const apiCalls: string[] = [];
    const bodies: unknown[] = [];
    const progress: Array<{ stage: string; fraction: number }> = [];
    const result = await executeEngineBacktestSweep(
      parseEngineBacktestSweepArgs(
        sweepArgv(["--mode", "range", "--concurrency", "1"])
      ),
      { ...FLAGS, format: "jsonl" },
      isolatedEnv(),
      {
        ...runnerDeps({
          loadTokens: authedTokens,
          apiRequest: async (options) => {
            apiCalls.push(`${options.method} ${options.path}`);
            if (options.method === "GET" && options.path === "/api/v1/subscriptions/me") {
              return jsonResponse(200, { subscriptionTier: "pro" });
            }
            if (
              options.method === "POST" &&
              options.path ===
                "/api/v1/engine-backtest/experiments/11111111-1111-1111-1111-111111111111/sweeps"
            ) {
              bodies.push(options.body);
              return jsonResponse(201, { id: "sweep-persisted-1" });
            }
            return jsonResponse(500, { message: `unexpected ${options.method} ${options.path}` });
          },
        }),
        randomUUID: (() => {
          let n = 0;
          return () => {
            n += 1;
            return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
          };
        })(),
        writeLine: (value) => {
          const row = value as { event?: string; stage?: string; fraction?: number };
          if (row.event === "progress" && row.stage) {
            progress.push({ stage: row.stage, fraction: row.fraction ?? 0 });
          }
        },
      }
    );

    assert.deepEqual(
      apiCalls.filter((call) => call.startsWith("POST")),
      [
        "POST /api/v1/engine-backtest/experiments/11111111-1111-1111-1111-111111111111/sweeps",
      ]
    );
    assert.equal(apiCalls.some((call) => call.includes("/runs")), false);
    assert.equal(apiCalls.some((call) => call.includes("/backtests")), false);
    assert.equal(result.persisted, true);
    assert.equal(result.sweepId, "sweep-persisted-1");
    assert.match(result.clientSweepId ?? "", CLIENT_SWEEP_ID_RE);
    assert.equal(
      result.experimentUrl,
      "http://127.0.0.1:3000/dashboard/traders/backtest/11111111-1111-1111-1111-111111111111?tab=sweep"
    );
    const body = bodies[0] as { clientSweepId: string; pointSummaries: unknown[] };
    assert.equal(body.clientSweepId, result.clientSweepId);
    assert.equal(body.pointSummaries.length, 3);
    assert.ok(progress.some((row) => row.stage === "persist" && row.fraction === 0));
    assert.ok(progress.some((row) => row.stage === "persist" && row.fraction === 1));
    const retried = buildCreateSweepRequest({
      clientSweepId: result.clientSweepId!,
      snapshot: sampleSweepSnapshot(),
      axes: result.axes,
      mode: result.mode,
      searchMode: result.searchMode,
      concurrency: 1,
      requestedCombinationCount: result.requestedCombinationCount,
      sampled: result.sampled,
      points: result.points,
      successfulCount: result.successfulCount,
      failedCount: result.failedCount,
      liquidatedCount: result.liquidatedCount,
      elapsedMs: result.elapsedMs,
      best: result.best
        ? { coordinate: result.best.coordinate, returnPct: result.best.returnPct }
        : null,
      engineVersion: result.engineVersion,
    });
    assert.equal(retried.clientSweepId, body.clientSweepId);
  });

  it("does not claim success when Sweep create returns no id", async () => {
    await assert.rejects(
      () =>
        executeEngineBacktestSweep(
          parseEngineBacktestSweepArgs(sweepArgv(["--mode", "range"])),
          FLAGS,
          isolatedEnv(),
          runnerDeps({
            loadTokens: authedTokens,
            apiRequest: async (options) => {
              if (options.method === "GET") {
                return jsonResponse(200, { subscriptionTier: "pro" });
              }
              return jsonResponse(201, { ok: true });
            },
          })
        ),
      (err: unknown) => {
        assert.ok(err instanceof EngineBacktestError);
        assert.equal(err.subtype, "create_sweep_no_id");
        return true;
      }
    );
  });

  it("fails like whoami when persist is requested without tokens", async () => {
    let tapeCalls = 0;
    await assert.rejects(
      () =>
        executeEngineBacktestSweep(
          parseEngineBacktestSweepArgs(sweepArgv(["--mode", "range"])),
          FLAGS,
          isolatedEnv(),
          {
            ...runnerDeps({
              loadTokens: () => null,
              loadTape: async () => {
                tapeCalls += 1;
                return sampleTape();
              },
            }),
          }
        ),
      (err: unknown) => {
        assert.ok(err instanceof EngineBacktestError);
        assert.equal(err.subtype, "unauthenticated");
        assert.equal(err.status, 401);
        return true;
      }
    );
    assert.equal(tapeCalls, 0);
  });

  it("does not persist when a coordinate batch is cancelled mid-search", async () => {
    const apiCalls: string[] = [];
    await assert.rejects(
      () =>
        executeEngineBacktestSweep(
          parseEngineBacktestSweepArgs(sweepArgv(["--mode", "range"])),
          FLAGS,
          isolatedEnv(),
          runnerDeps({
            loadTokens: authedTokens,
            client: fakeClient({
              runBacktestBatch: async () => {
                throw new EngineBacktestError({
                  type: "runtime",
                  subtype: "cancelled",
                  message: "search cancelled",
                });
              },
            }),
            apiRequest: async (options) => {
              apiCalls.push(`${options.method} ${options.path}`);
              if (options.method === "GET") {
                return jsonResponse(200, { subscriptionTier: "pro" });
              }
              return jsonResponse(201, { id: "should-not-exist" });
            },
          })
        ),
      (err: unknown) =>
        err instanceof EngineBacktestError && err.subtype === "cancelled"
    );
    assert.equal(
      apiCalls.some((call) => call.startsWith("POST")),
      false
    );
  });

  it("runs --no-persist with one broad tape, cloned buffers, and zero writes", async () => {
    const source = new ArrayBuffer(8);
    const seenBuffers: ArrayBuffer[] = [];
    const batches: EngineBacktestBatchRequest[] = [];
    const apiCalls: string[] = [];
    let tapeCalls = 0;
    let maxWarmup = -1;
    const client = fakeClient({
      planBacktest: async ({ config }) => {
        const period =
          config &&
          typeof config === "object" &&
          "strategy" in config &&
          typeof (config as { strategy?: { period?: unknown } }).strategy
            ?.period === "number"
            ? (config as { strategy: { period: number } }).strategy.period
            : 10;
        return {
          ...PLAN,
          seriesRequirements: [
            {
              symbol: "BTC/USDT:USDT",
              timeframe: "1m",
              minWarmupCandles: period === 12 ? 200 : 10,
            },
          ],
        };
      },
      runBacktestBatch: async (batch, buffers) => {
        batches.push(batch);
        seenBuffers.push(buffers.k0 as ArrayBuffer);
        return {
          batchId: batch.batchId,
          status: "completed",
          results: batch.variants.map((variant, index) => {
            const period = (
              variant.config as { strategy: { period: number } }
            ).strategy.period;
            return {
              runId: variant.runId,
              status: "completed" as const,
              metrics: metricsFor(period === 12 ? 20 : period),
            };
          }),
        };
      },
    });
    const progress: Array<{ stage: string; fraction: number }> = [];
    const result = await executeEngineBacktestSweep(
      parseEngineBacktestSweepArgs(
        sweepArgv([
          "--no-persist",
          "--mode",
          "range",
          "--tier",
          "pro",
          "--concurrency",
          "1",
        ])
      ),
      { ...FLAGS, format: "jsonl" },
      isolatedEnv(),
      {
        ...runnerDeps({
          client,
          loadTape: async (req) => {
            tapeCalls += 1;
            maxWarmup = Math.max(
              0,
              ...(req.seriesRequirements ?? []).map(
                (requirement) => requirement.minWarmupCandles
              )
            );
            return sampleTape(source);
          },
          apiRequest: async (options) => {
            apiCalls.push(`${options.method} ${options.path}`);
            return jsonResponse(500, { message: "no writes" });
          },
        }),
        writeLine: (value) => {
          const row = value as { event?: string; stage?: string; fraction?: number };
          if (row.event === "progress" && row.stage) {
            progress.push({ stage: row.stage, fraction: row.fraction ?? 0 });
          }
        },
      }
    );

    assert.equal(tapeCalls, 1);
    assert.equal(maxWarmup, 200);
    assert.equal(apiCalls.length, 0);
    assert.equal(result.persisted, false);
    assert.equal(result.points.length, 3);
    assert.equal(result.successfulCount, 3);
    assert.equal(result.failedCount, 0);
    assert.equal(result.liquidatedCount, 0);
    assert.ok(result.elapsedMs >= 0);
    assert.deepEqual(result.best?.coordinate.values, [12]);
    assert.equal(result.best?.returnPct, 20);
    assert.deepEqual(result.best?.config, { strategy: { period: 12, spacing: 0.6 } });
    assert.equal(seenBuffers.length, 1);
    assert.notEqual(seenBuffers[0], source);
    assert.equal(source.byteLength, 8);
    assert.ok(progress.some((row) => row.stage === "planning"));
    assert.ok(progress.some((row) => row.stage === "sweep"));
    assert.ok(
      result.points.every((point) => point.status === "ok" && point.metrics)
    );
  });

  it("keeps Free serial and Pro concurrency between 1 and 8", async () => {
    async function maxInFlight(tier: "free" | "pro", requested: string) {
      let inFlight = 0;
      let max = 0;
      let clients = 0;
      const createClient = () => {
        clients += 1;
        return fakeClient({
          runBacktestBatch: async (batch) => {
            inFlight += 1;
            max = Math.max(max, inFlight);
            await new Promise((resolve) => setTimeout(resolve, 15));
            inFlight -= 1;
            return {
              batchId: batch.batchId,
              status: "completed",
              results: batch.variants.map((variant) => ({
                runId: variant.runId,
                status: "completed" as const,
                metrics: METRICS,
              })),
            };
          },
        });
      };
      await executeEngineBacktestSweep(
        parseEngineBacktestSweepArgs(
          sweepArgv([
            "--no-persist",
            "--mode",
            "range",
            "--tier",
            tier,
            "--concurrency",
            requested,
            "--axes",
            JSON.stringify({
              axes: [
                {
                  path: ["strategy", "period"],
                  values: [8, 9, 10, 11, 12, 13],
                },
              ],
            }),
          ])
        ),
        FLAGS,
        isolatedEnv(),
        {
          ...runnerDeps({ createClient }),
          maxVariantsPerBatch: 1,
        }
      );
      return { max, clients };
    }

    const free = await maxInFlight("free", "8");
    assert.equal(free.max, 1);
    assert.equal(free.clients, 1);

    const pro = await maxInFlight("pro", "3");
    assert.equal(pro.max, 3);
    assert.ok(pro.clients >= 3 && pro.clients <= 8);
  });

  it("plans fast searches with the shared kernel and returns every executed point", async () => {
    const axes: SweepAxisInput[] = [
      {
        path: ["strategy", "period"],
        current: 10,
        isInteger: true,
        min: 0,
        max: 20,
        window: { min: 0, max: 20, step: 1 },
      },
      {
        path: ["strategy", "spacing"],
        current: 0.6,
        isInteger: false,
        values: [0.4, 0.5, 0.6, 0.7, 0.8],
      },
    ];
    const coarse = planSweep({
      axes,
      searchMode: "fast",
      subscriptionTier: "pro",
    });
    const result = await executeEngineBacktestSweep(
      parseEngineBacktestSweepArgs(
        sweepArgv([
          "--no-persist",
          "--search-mode",
          "fast",
          "--tier",
          "pro",
          "--axes",
          JSON.stringify({
            axes: [
              {
                path: ["strategy", "period"],
                min: 0,
                max: 20,
                step: 1,
              },
              {
                path: ["strategy", "spacing"],
                values: [0.4, 0.5, 0.6, 0.7, 0.8],
              },
            ],
          }),
        ])
      ),
      FLAGS,
      isolatedEnv(),
      runnerDeps({
        client: fakeClient({
          runBacktestBatch: async (batch) => ({
            batchId: batch.batchId,
            status: "completed",
            results: batch.variants.map((variant) => {
              const cfg = variant.config as {
                strategy: { period: number; spacing: number };
              };
              return {
                runId: variant.runId,
                status: "completed" as const,
                metrics: metricsFor(cfg.strategy.period + cfg.strategy.spacing),
              };
            }),
          }),
        }),
      })
    );
    assert.equal(result.searchMode, "fast");
    assert.ok(result.points.length >= coarse.coordinates.length);
    assert.equal(result.points.length, result.successfulCount + result.failedCount);
    assert.ok(result.best);
    assert.deepEqual(
      (result.best?.config as { strategy: { period: number; spacing: number } })
        .strategy,
      {
        period: result.best?.coordinate.values[0],
        spacing: result.best?.coordinate.values[1],
      }
    );
  });

  it("help documents sweep persist and the command accepts sweep", async () => {
    const help = engineBacktestHelpData();
    assert.ok(
      help.usage.some((line) => line.includes("engine-backtest sweep"))
    );
    assert.ok(
      help.notes.some((line) => line.includes("sweeps.create"))
    );
    const code = await cmdEngineBacktest(["sweep", "--help"], FLAGS, isolatedEnv());
    assert.equal(code, 0);

    const cliPath = join(__dirname, "..", "..", "dist", "cli.js");
    const launched = spawnSync(
      process.execPath,
      [cliPath, "engine-backtest", "sweep", "--help", "--format", "json"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          ALPHAFOX_FORCE_FILE_KEYCHAIN: "1",
          ALPHAFOX_SKIP_UPDATE_CHECK: "1",
          ALPHAFOX_CONFIG_DIR: mkdtempSync(join(tmpdir(), "alphafox-cfg-")),
        },
      }
    );
    assert.equal(launched.status, 0, launched.stderr + launched.stdout);
    const json = JSON.parse(launched.stdout);
    assert.equal(json.ok, true);
    assert.ok(
      json.data.usage.some((line: string) =>
        line.includes("engine-backtest sweep")
      )
    );
  });
});
