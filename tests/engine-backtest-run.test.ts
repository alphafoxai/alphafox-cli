import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { EngineBacktestError } from "../src/engine-backtest/errors";
import {
  parseEngineBacktestRunArgs,
  parseInclusiveUtcDateRange,
  parseRangeFlag,
} from "../src/engine-backtest/parse-args";
import {
  buildCreateRunRequest,
  DEFAULT_EXECUTION_MODEL,
  exclusiveTapeEndToRangeEnd,
  experimentPageUrl,
  SNAPSHOT_SCHEMA_VERSION,
} from "../src/engine-backtest/persist";
import {
  ensureBlobRuntime,
  parseEngineBacktestBlobManifest,
  resolveRuntimeCacheDir,
} from "../src/engine-backtest/fetch-runtime";
import {
  resolveBacktestPackagePath,
} from "../src/engine-backtest/resolve-packages";
import {
  executeEngineBacktestRun,
  loadConfigValue,
  type EngineBacktestCliFlags,
} from "../src/engine-backtest/run-command";
import type {
  BacktestClientLike,
  EngineBacktestMetrics,
  EngineBacktestScenario,
  EngineSupportedBacktestPlan,
  TapeLoadResult,
} from "../src/engine-backtest/types";
import type { ApiRequestOptions, ApiResponse } from "../src/http/client";
import type { ProfileConfig } from "../src/config/profiles";

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
  effectiveConfig: { common: { symbols: ["BTC/USDT:USDT"] } },
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

function sampleScenario(runId = "run-1"): EngineBacktestScenario {
  return {
    version: 1,
    runId,
    trader: {
      strategyDefinitionId: "grid",
      configSchemaVersion: 4,
      subscriptionTier: "pro",
      config: { common: { symbols: ["BTC/USDT:USDT"] } },
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

function sampleTape(): TapeLoadResult {
  const scenario = sampleScenario();
  return {
    tape: scenario.tape,
    buffers: { k0: new ArrayBuffer(8) },
    coverageWarnings: [],
  };
}

function fakeClient(overrides: Partial<BacktestClientLike> = {}): BacktestClientLike {
  return {
    init: async () => "test-engine",
    version: async () => "test-engine",
    strategyDefinitions: async () => ({
      engineVersion: "test-engine",
      definitions: [
        {
          id: "grid",
          configSchemaVersion: 4,
          supportedByBacktest: true,
        },
      ],
    }),
    planBacktest: async () => PLAN,
    runBacktest: async (scenario) => ({
      runId: scenario.runId,
      status: "completed",
      engineVersion: "test-engine",
      metrics: METRICS,
      equityCurve: [],
      orders: [],
      openPositions: [],
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

const localProfile: ProfileConfig = {
  name: "local",
  apiBaseUrl: "http://127.0.0.1:3000/api/v1",
  issuer: "http://127.0.0.1:3000/api/auth",
  audience: "http://127.0.0.1:3000/api/v1",
  clientId: "alphafox-cli-local",
};

describe("engine-backtest parse", () => {
  it("parses inclusive --range into exclusive toMs", () => {
    const range = parseRangeFlag("2026-08-01..2026-08-08");
    assert.equal(range.rangeStart, "2026-08-01");
    assert.equal(range.rangeEnd, "2026-08-08");
    assert.equal(range.fromMs, Date.parse("2026-08-01T00:00:00Z"));
    assert.equal(range.toMs, Date.parse("2026-08-09T00:00:00Z"));
  });

  it("parses --from/--to the same as --range", () => {
    const a = parseInclusiveUtcDateRange("2026-08-01", "2026-08-08");
    const parsed = parseEngineBacktestRunArgs([
      "--experiment",
      "11111111-1111-1111-1111-111111111111",
      "--definition",
      "grid",
      "--config",
      "{}",
      "--exchange",
      "binance",
      "--from",
      "2026-08-01",
      "--to",
      "2026-08-08",
      "--initial-equity",
      "10000",
    ]);
    assert.deepEqual(parsed.range, a);
    assert.equal(parsed.tier, undefined);
    assert.equal(parsed.dataQualityMode, "strict");
    assert.equal(parsed.persist, true);
    assert.equal(parsed.replayTimeframe, "1m");
  });

  it("rejects calendar dates that Date.parse would normalize", () => {
    assert.throws(
      () => parseRangeFlag("2026-02-30..2026-03-02"),
      (err: unknown) => {
        assert.ok(err instanceof EngineBacktestError);
        assert.equal(err.subtype, "invalid_range");
        return true;
      }
    );
  });

  it("fails when --experiment and --create-experiment are both missing", () => {
    assert.throws(
      () =>
        parseEngineBacktestRunArgs([
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
        ]),
      (err: unknown) => {
        assert.ok(err instanceof EngineBacktestError);
        assert.equal(err.subtype, "missing_experiment");
        return true;
      }
    );
  });

  it("fails when --config is missing", () => {
    assert.throws(
      () =>
        parseEngineBacktestRunArgs([
          "--experiment",
          "11111111-1111-1111-1111-111111111111",
          "--definition",
          "grid",
          "--exchange",
          "binance",
          "--range",
          "2026-08-01..2026-08-08",
          "--initial-equity",
          "10000",
        ]),
      (err: unknown) => {
        assert.ok(err instanceof EngineBacktestError);
        assert.equal(err.subtype, "missing_config");
        return true;
      }
    );
  });

  it("accepts --create-experiment --name and --no-persist", () => {
    const parsed = parseEngineBacktestRunArgs([
      "--create-experiment",
      "--name",
      "grid-aug",
      "--definition",
      "grid",
      "--config",
      "@./grid.json",
      "--exchange",
      "binance",
      "--range",
      "2026-08-01..2026-08-08",
      "--initial-equity",
      "10000",
      "--no-persist",
      "--tier",
      "free",
    ]);
    assert.equal(parsed.createExperiment, true);
    assert.equal(parsed.name, "grid-aug");
    assert.equal(parsed.persist, false);
    assert.equal(parsed.tier, "free");
  });
});

describe("engine-backtest persist", () => {
  it("maps exclusive tape.to minus 1ms to inclusive rangeEnd", () => {
    assert.equal(
      exclusiveTapeEndToRangeEnd("2026-08-09T00:00:00.000Z"),
      "2026-08-08"
    );
    assert.equal(
      exclusiveTapeEndToRangeEnd("2024-02-01T00:00:00.000Z"),
      "2024-01-31"
    );
  });

  it("builds snapshot fields aligned with web persist", () => {
    const body = buildCreateRunRequest({
      clientRunId: "22222222-2222-2222-2222-222222222222",
      scenario: sampleScenario(),
      metrics: METRICS,
      exchangeId: "binance",
      dataQualityMode: "strict",
      engineVersion: "test-engine",
    });
    assert.equal(body.clientRunId, "22222222-2222-2222-2222-222222222222");
    assert.equal(body.snapshot.snapshotSchemaVersion, SNAPSHOT_SCHEMA_VERSION);
    assert.equal(body.snapshot.strategyDefinitionId, "grid");
    assert.equal(body.snapshot.configSchemaVersion, 4);
    assert.equal(body.snapshot.exchangeId, "binance");
    assert.equal(body.snapshot.rangeStart, "2026-08-01");
    assert.equal(body.snapshot.rangeEnd, "2026-08-08");
    assert.equal(body.snapshot.initialEquity, 10_000);
    assert.equal(body.snapshot.subscriptionTier, "pro");
    assert.equal(body.snapshot.dataQualityMode, "strict");
    assert.deepEqual(body.snapshot.symbols, ["BTC/USDT:USDT"]);
    assert.deepEqual(body.snapshot.timeframes, ["1m"]);
    assert.equal(body.snapshot.baseTimeframe, "1m");
    assert.deepEqual(body.snapshot.executionModel, DEFAULT_EXECUTION_MODEL);
    assert.equal(body.snapshot.positionSideDual, true);
    assert.equal(body.snapshot.engineVersion, "test-engine");
    assert.equal(body.engineVersion, "test-engine");
    assert.equal(body.configSchemaVersion, 4);
    assert.deepEqual(body.metrics, METRICS);
    assert.equal(body.returnCurve, undefined);
  });

  it("includes a compressed return curve from the local equity series", () => {
    const body = buildCreateRunRequest({
      clientRunId: "22222222-2222-2222-2222-222222222222",
      scenario: sampleScenario(),
      metrics: METRICS,
      exchangeId: "binance",
      dataQualityMode: "strict",
      engineVersion: "test-engine",
      equityCurve: [
        { t: 1_775_808_000_000, equity: 10_000 },
        { t: 1_775_808_060_000, equity: 11_000 },
      ],
    });
    assert.deepEqual(body.returnCurve, [
      [1_775_808_000_000, 0],
      [1_775_808_060_000, 0.1],
    ]);
  });

  it("defaults executionModel to runner/web values", () => {
    assert.deepEqual(DEFAULT_EXECUTION_MODEL, {
      pricePath: "ohlc_path_4",
      makerFeeRate: 0.0002,
      takerFeeRate: 0.0005,
      slippageRate: 0.0001,
    });
  });

  it("builds profile-specific experiment URLs without locale prefix", () => {
    const id = "exp-1";
    assert.equal(
      experimentPageUrl("production", id),
      "https://alphafox.app/dashboard/traders/backtest/exp-1"
    );
    assert.equal(
      experimentPageUrl("staging", id),
      "https://staging.alphafox.app/dashboard/traders/backtest/exp-1"
    );
    assert.equal(
      experimentPageUrl("local", id),
      "http://127.0.0.1:3000/dashboard/traders/backtest/exp-1"
    );
  });
});

describe("engine-backtest resolve-packages", () => {
  it("returns a clear error envelope when nothing local resolves", () => {
    assert.throws(
      () =>
        resolveBacktestPackagePath("wasm", {}, {
          exists: () => false,
          cliRoot: join(tmpdir(), "alphafox-cli-missing-root"),
          callerFilename: join(tmpdir(), "no-such-cli", "src", "x.js"),
        }),
      (err: unknown) => {
        assert.ok(err instanceof EngineBacktestError);
        assert.equal(err.subtype, "package_unresolved");
        assert.match(err.message, /@alphafoxai\/backtest-wasm\/node/);
        assert.ok(err.hint);
        const details = err.details as { tried?: string[] };
        assert.ok(Array.isArray(details.tried));
        assert.ok(details.tried!.length > 0);
        return true;
      }
    );
  });

  it("fails closed when ALPHAFOX_BACKTEST_WASM_DIR is set but empty", () => {
    const empty = mkdtempSync(join(tmpdir(), "alphafox-wasm-empty-"));
    assert.throws(
      () =>
        resolveBacktestPackagePath(
          "wasm",
          { ALPHAFOX_BACKTEST_WASM_DIR: empty },
          {
            exists: (p) => p === empty,
          }
        ),
      (err: unknown) => {
        assert.ok(err instanceof EngineBacktestError);
        assert.equal(err.subtype, "package_unresolved");
        assert.match(err.message, /ALPHAFOX_BACKTEST_WASM_DIR/);
        return true;
      }
    );
  });

  it("loads real runner and wasm .mjs files from the CommonJS build", async () => {
    const runnerDir = mkdtempSync(join(tmpdir(), "alphafox-runner-mjs-"));
    writeFileSync(
      join(runnerDir, "package.json"),
      JSON.stringify({
        name: "@alphafoxai/backtest-runner",
        type: "module",
        exports: { ".": "./index.mjs" },
      })
    );
    writeFileSync(
      join(runnerDir, "index.mjs"),
      [
        "export async function loadTape() { return { tape: {}, buffers: {}, coverageWarnings: [] }; }",
        "export function assembleScenario(input) { return input; }",
        "export function resolveTapeExchange(id) { return { id }; }",
        "export const DEFAULT_EXECUTION_MODEL = { pricePath: 'close_only' };",
      ].join("\n")
    );

    const wasmDir = mkdtempSync(join(tmpdir(), "alphafox-wasm-mjs-"));
    writeFileSync(
      join(wasmDir, "package.json"),
      JSON.stringify({
        name: "@alphafoxai/backtest-wasm",
        type: "module",
        exports: { "./node": "./node.mjs" },
      })
    );
    writeFileSync(
      join(wasmDir, "node.mjs"),
      "export function createNodeBacktestClient() { return { from: 'real-mjs' }; }\n"
    );

    const builtResolver = require(
      join(__dirname, "..", "..", "dist", "engine-backtest", "resolve-packages.js")
    ) as typeof import("../src/engine-backtest/resolve-packages");
    const runner = await builtResolver.loadBacktestRunner({
      ALPHAFOX_BACKTEST_RUNNER_DIR: runnerDir,
    });
    const wasm = await builtResolver.loadBacktestWasm({
      ALPHAFOX_BACKTEST_WASM_DIR: wasmDir,
    });

    assert.equal(typeof runner.module.loadTape, "function");
    assert.equal(runner.module.DEFAULT_EXECUTION_MODEL.pricePath, "close_only");
    assert.equal(runner.resolved.source, "env_dir");
    assert.equal(typeof wasm.module.createNodeBacktestClient, "function");
    assert.equal(wasm.resolved.source, "env_dir");
  });

  it("loads the vendored runner without a private npm package", async () => {
    const builtResolver = require(
      join(__dirname, "..", "..", "dist", "engine-backtest", "resolve-packages.js")
    ) as typeof import("../src/engine-backtest/resolve-packages");
    const runner = await builtResolver.loadBacktestRunner({});
    assert.equal(runner.resolved.source, "vendor");
    assert.equal(typeof runner.module.loadTape, "function");
    assert.ok(runner.module.DEFAULT_EXECUTION_MODEL);
  });

  it("downloads the Node runtime from the Blob manifest", async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), "alphafox-blob-runtime-"));
    const manifest = {
      version: "0.1.1148",
      hash: "testhash",
      protocol: 1,
      wasm: "https://example.test/tradingfox-backtest.wasm",
      wasmExec: "https://example.test/wasm_exec.js",
      worker: "https://example.test/worker.mjs",
      client: "https://example.test/index.mjs",
      node: "https://example.test/node.mjs",
      nodeWorker: "https://example.test/worker-node.mjs",
      nodeWorkerPath: "https://example.test/worker-node-path.mjs",
    };
    const bodies: Record<string, string> = {
      "https://example.test/latest.json": JSON.stringify(manifest),
      "https://example.test/tradingfox-backtest.wasm": "wasm",
      "https://example.test/wasm_exec.js": "exec",
      "https://example.test/worker.mjs": "worker",
      "https://example.test/index.mjs": "client",
      "https://example.test/node.mjs":
        "export function createNodeBacktestClient() { return { from: 'blob' }; }\n",
      "https://example.test/worker-node.mjs": "node-worker",
      "https://example.test/worker-node-path.mjs": "node-worker-path",
    };
    const fetchImpl = (async (url: string | URL) => {
      const href = String(url);
      const body = bodies[href];
      if (!body) {
        return new Response("missing", { status: 404 });
      }
      return new Response(body, { status: 200 });
    }) as typeof fetch;

    const builtResolver = require(
      join(__dirname, "..", "..", "dist", "engine-backtest", "resolve-packages.js")
    ) as typeof import("../src/engine-backtest/resolve-packages");
    const wasm = await builtResolver.loadBacktestWasm(
      { ALPHAFOX_BACKTEST_WASM_MANIFEST_URL: "https://example.test/latest.json" },
      { fetch: fetchImpl, cacheDir }
    );
    assert.equal(wasm.resolved.source, "blob");
    assert.equal(
      (wasm.module.createNodeBacktestClient() as unknown as { from: string }).from,
      "blob"
    );
  });
});

describe("engine-backtest fetch-runtime", () => {
  const validManifest = {
    version: "0.1.1148",
    hash: "323e65c3d57eb8c0",
    protocol: 1,
    wasm: "https://example.test/tradingfox-backtest.wasm",
    wasmExec: "https://example.test/wasm_exec.js",
    worker: "https://example.test/worker.mjs",
    client: "https://example.test/index.mjs",
    node: "https://example.test/node.mjs",
    nodeWorker: "https://example.test/worker-node.mjs",
    nodeWorkerPath: "https://example.test/worker-node-path.mjs",
  };

  it("accepts a protocol-1 Node runtime manifest", () => {
    const parsed = parseEngineBacktestBlobManifest(validManifest);
    assert.equal(parsed.protocol, 1);
    assert.equal(parsed.hash, "323e65c3d57eb8c0");
    assert.equal(parsed.node, validManifest.node);
  });

  it("refuses a protocol mismatch or missing Node host URL", () => {
    assert.throws(
      () => parseEngineBacktestBlobManifest({ ...validManifest, protocol: 2 }),
      (err: unknown) => {
        assert.ok(err instanceof EngineBacktestError);
        assert.equal(err.subtype, "runtime_protocol_mismatch");
        return true;
      }
    );
    assert.throws(
      () => parseEngineBacktestBlobManifest({ ...validManifest, node: "" }),
      (err: unknown) => {
        assert.ok(err instanceof EngineBacktestError);
        assert.equal(err.subtype, "runtime_manifest_invalid");
        return true;
      }
    );
  });

  it("rejects manifest hashes that escape the runtime cache root", () => {
    const root = mkdtempSync(join(tmpdir(), "alphafox-runtime-root-"));
    for (const hash of ["../../outside", "..", "."]) {
      assert.throws(
        () =>
          resolveRuntimeCacheDir(hash, {
            ALPHAFOX_BACKTEST_RUNTIME_CACHE_DIR: root,
          }),
        (err: unknown) => {
          assert.ok(err instanceof EngineBacktestError);
          assert.equal(err.subtype, "runtime_manifest_invalid");
          return true;
        }
      );
    }
    assert.equal(existsSync(join(root, "..", "..", "outside")), false);
  });

  it("rejects an unsafe cache key even when a test cache directory is injected", async () => {
    await assert.rejects(
      ensureBlobRuntime(
        { ALPHAFOX_BACKTEST_WASM_MANIFEST_URL: "https://example.test/latest.json" },
        {
          cacheDir: mkdtempSync(join(tmpdir(), "alphafox-runtime-injected-")),
          fetch: async () =>
            new Response(JSON.stringify({ ...validManifest, hash: "../../outside" }), {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
        }
      ),
      (err: unknown) => {
        assert.ok(err instanceof EngineBacktestError);
        assert.equal(err.subtype, "runtime_manifest_invalid");
        return true;
      }
    );
  });
});

describe("engine-backtest orchestration", () => {
  it("plans, loads tape, runs wasm, and POSTs persist body in order", async () => {
    const calls: string[] = [];
    const apiBodies: unknown[] = [];
    const client = fakeClient({
      planBacktest: async (req) => {
        calls.push(`plan:${req.definitionId}:${req.configSchemaVersion}`);
        return PLAN;
      },
      runBacktest: async (scenario, _buffers, onProgress) => {
        calls.push(`wasm:${scenario.runId}`);
        onProgress?.(1);
        return {
          runId: scenario.runId,
          status: "completed",
          engineVersion: "test-engine",
          metrics: METRICS,
          equityCurve: [
            { t: 1_775_808_000_000, equity: 10_000 },
            { t: 1_775_808_060_000, equity: 11_000 },
          ],
        };
      },
      terminate: () => {
        calls.push("terminate");
      },
    });

    const result = await executeEngineBacktestRun(
      parseEngineBacktestRunArgs([
        "--experiment",
        "11111111-1111-1111-1111-111111111111",
        "--definition",
        "grid",
        "--config",
        '{"k":1}',
        "--exchange",
        "binance",
        "--range",
        "2026-08-01..2026-08-08",
        "--initial-equity",
        "10000",
        "--tier",
        "pro_max",
      ]),
      FLAGS,
      {
        ALPHAFOX_PROFILE: "local",
        ALPHAFOX_CONFIG_DIR: mkdtempSync(join(tmpdir(), "alphafox-cfg-")),
      },
      {
        createNodeBacktestClient: () => client,
        loadTape: async (req) => {
          calls.push(
            `tape:${req.symbols.join(",")}:${req.fromMs}:${req.toMs}:${req.dataQualityMode}`
          );
          assert.equal(req.exchangeId, "binance_perp_usdt");
          assert.equal(req.baseTimeframe, "1m");
          assert.deepEqual(req.timeframes, PLAN.timeframes);
          assert.deepEqual(req.seriesRequirements, PLAN.seriesRequirements);
          assert.equal(req.needsFunding, false);
          return sampleTape();
        },
        assembleScenario: (input) => {
          calls.push(`assemble:${input.definitionId}`);
          return {
            ...sampleScenario(input.runId),
            trader: {
              ...sampleScenario().trader,
              config: input.config,
              subscriptionTier: input.subscriptionTier,
              configSchemaVersion: input.configSchemaVersion,
            },
            exchange: {
              positionSideDual: true,
              initialEquity: input.initialEquity,
            },
            executionModel: {
              ...DEFAULT_EXECUTION_MODEL,
              ...input.executionModel,
            },
            tape: input.tape ?? sampleScenario().tape,
          };
        },
        resolveTapeExchange: (id) => {
          calls.push(`exchange:${String(id)}`);
          return {
            id: "binance_perp_usdt",
            label: "Binance",
            ccxtId: "binanceusdm",
            marketType: "swap",
            quoteAsset: "USDT",
          };
        },
        defaultExecutionModel: DEFAULT_EXECUTION_MODEL,
        loadTokens: () => ({
          accessToken: "test-access",
          refreshToken: "test-refresh",
          expiresAt: Date.now() + 60_000,
          environment: "local",
          issuer: localProfile.issuer,
          audience: localProfile.audience,
          clientId: localProfile.clientId,
          scopes: ["openid", "profile"],
        }),
        apiRequest: async (options: ApiRequestOptions) => {
          calls.push(`api:${options.method}:${options.path}`);
          if (options.method === "GET") {
            return jsonResponse(200, { subscriptionTier: "pro_max" });
          }
          apiBodies.push(options.body);
          return jsonResponse(201, { id: "run-persisted-1" });
        },
        randomUUID: (() => {
          let n = 0;
          return () => {
            n += 1;
            return `00000000-0000-0000-0000-00000000000${n}`;
          };
        })(),
      }
    );

    assert.deepEqual(calls, [
      "plan:grid:4",
      "api:GET:/api/v1/subscriptions/me",
      "exchange:binance",
      `tape:BTC/USDT:USDT:${Date.parse("2026-08-01T00:00:00Z")}:${Date.parse("2026-08-09T00:00:00Z")}:strict`,
      "assemble:grid",
      "wasm:00000000-0000-0000-0000-000000000001",
      "api:POST:/api/v1/engine-backtest/experiments/11111111-1111-1111-1111-111111111111/runs",
      "terminate",
    ]);
    const body = apiBodies[0] as {
      snapshot: {
        rangeEnd: string;
        executionModel: unknown;
        exchangeId: string;
        subscriptionTier: string;
      };
      clientRunId: string;
      returnCurve?: ReadonlyArray<readonly [number, number]>;
    };
    assert.equal(body.snapshot.rangeEnd, "2026-08-08");
    assert.equal(body.snapshot.exchangeId, "binance_perp_usdt");
    assert.equal(body.snapshot.subscriptionTier, "pro_max");
    assert.deepEqual(body.snapshot.executionModel, DEFAULT_EXECUTION_MODEL);
    assert.deepEqual(body.returnCurve, [
      [1_775_808_000_000, 0],
      [1_775_808_060_000, 0.1],
    ]);
    assert.equal(result.persisted, true);
    assert.equal(result.runId, "run-persisted-1");
    assert.equal(result.experimentId, "11111111-1111-1111-1111-111111111111");
    assert.equal(
      result.experimentUrl,
      "http://127.0.0.1:3000/dashboard/traders/backtest/11111111-1111-1111-1111-111111111111"
    );
    assert.equal(result.engineVersion, "test-engine");
    assert.deepEqual(result.metrics, METRICS);
  });

  it("does not persist a non-completed runtime result", async () => {
    const writes: ApiRequestOptions[] = [];
    const client = fakeClient({
      runBacktest: async (scenario) =>
        ({
          runId: scenario.runId,
          status: "cancelled",
          metrics: METRICS,
        }) as never,
    });

    await assert.rejects(
      executeEngineBacktestRun(
        parseEngineBacktestRunArgs([
          "--experiment",
          "11111111-1111-1111-1111-111111111111",
          "--definition",
          "grid",
          "--config",
          '{"k":1}',
          "--exchange",
          "binance",
          "--range",
          "2026-08-01..2026-08-08",
          "--initial-equity",
          "10000",
        ]),
        FLAGS,
        { ALPHAFOX_PROFILE: "local" },
        {
          createNodeBacktestClient: () => client,
          loadTape: async () => sampleTape(),
          assembleScenario: (input) => sampleScenario(input.runId),
          resolveTapeExchange: () => ({
            id: "binance_perp_usdt",
            label: "Binance",
            ccxtId: "binanceusdm",
            marketType: "swap",
            quoteAsset: "USDT",
          }),
          loadTokens: () => ({
            accessToken: "test-access",
            refreshToken: "test-refresh",
            expiresAt: Date.now() + 60_000,
            environment: "local",
            issuer: localProfile.issuer,
            audience: localProfile.audience,
            clientId: localProfile.clientId,
            scopes: ["openid"],
          }),
          apiRequest: async (options) => {
            writes.push(options);
            return jsonResponse(200, { subscriptionTier: "pro" });
          },
        }
      ),
      (err: unknown) => {
        assert.ok(err instanceof EngineBacktestError);
        assert.equal(err.subtype, "backtest_failed");
        assert.match(err.message, /status=cancelled/);
        return true;
      }
    );
    assert.equal(writes.filter((call) => call.method === "POST").length, 0);
  });

  it("defaults tape replay to 1m when the plan only has a coarser indicator", async () => {
    const fourHourPlan: EngineSupportedBacktestPlan = {
      ...PLAN,
      timeframes: ["4h"],
      seriesRequirements: [
        { symbol: "BTC/USDT:USDT", timeframe: "4h", minWarmupCandles: 200 },
      ],
    };
    let tapeRequest: {
      readonly baseTimeframe?: string;
      readonly timeframes: readonly string[];
      readonly seriesRequirements?: readonly {
        readonly symbol: string;
        readonly timeframe: string;
        readonly minWarmupCandles: number;
      }[];
    } | undefined;
    await executeEngineBacktestRun(
      parseEngineBacktestRunArgs([
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
        "--tier",
        "pro",
      ]),
      FLAGS,
      { ALPHAFOX_CONFIG_DIR: mkdtempSync(join(tmpdir(), "alphafox-cfg-")) },
      {
        createNodeBacktestClient: () =>
          fakeClient({ planBacktest: async () => fourHourPlan }),
        loadTape: async (req) => {
          tapeRequest = req;
          return sampleTape();
        },
        assembleScenario: (input) => sampleScenario(input.runId),
        resolveTapeExchange: () => ({
          id: "binance_perp_usdt",
          label: "Binance",
          ccxtId: "binanceusdm",
          marketType: "swap",
          quoteAsset: "USDT",
        }),
        defaultExecutionModel: DEFAULT_EXECUTION_MODEL,
      }
    );
    assert.equal(tapeRequest?.baseTimeframe, "1m");
    assert.deepEqual(tapeRequest?.timeframes, ["1m", "4h"]);
    assert.deepEqual(tapeRequest?.seriesRequirements, [
      { symbol: "BTC/USDT:USDT", timeframe: "4h", minWarmupCandles: 200 },
      { symbol: "BTC/USDT:USDT", timeframe: "1m", minWarmupCandles: 0 },
    ]);
  });

  it("does not POST runs.create with --no-persist", async () => {
    const apiCalls: string[] = [];
    const client = fakeClient();
    const result = await executeEngineBacktestRun(
      parseEngineBacktestRunArgs([
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
        "--tier",
        "free",
      ]),
      FLAGS,
      { ALPHAFOX_CONFIG_DIR: mkdtempSync(join(tmpdir(), "alphafox-cfg-")) },
      {
        createNodeBacktestClient: () => client,
        loadTape: async () => sampleTape(),
        assembleScenario: (input) => {
          assert.equal(input.subscriptionTier, "free");
          return {
            ...sampleScenario(input.runId),
            trader: {
              ...sampleScenario(input.runId).trader,
              subscriptionTier: input.subscriptionTier,
            },
          };
        },
        resolveTapeExchange: () => ({
          id: "binance_perp_usdt",
          label: "Binance",
          ccxtId: "binanceusdm",
          marketType: "swap",
          quoteAsset: "USDT",
        }),
        apiRequest: async (options) => {
          apiCalls.push(`${options.method} ${options.path}`);
          return jsonResponse(500, { message: "should not be called" });
        },
      }
    );
    assert.deepEqual(apiCalls, []);
    assert.equal(result.persisted, false);
    assert.equal(result.runId, undefined);
  });

  it("creates an experiment after the local run and skips runs.create with --no-persist", async () => {
    const apiCalls: string[] = [];
    let runCompleted = false;
    const result = await executeEngineBacktestRun(
      parseEngineBacktestRunArgs([
        "--create-experiment",
        "--name",
        "grid-aug",
        "--definition",
        "grid",
        "--definition-label-zh",
        "网格",
        "--definition-label-en",
        "Grid",
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
      FLAGS,
      { ALPHAFOX_CONFIG_DIR: mkdtempSync(join(tmpdir(), "alphafox-cfg-")) },
      {
        createNodeBacktestClient: () =>
          fakeClient({
            runBacktest: async (scenario) => {
              runCompleted = true;
              return {
                runId: scenario.runId,
                status: "completed",
                engineVersion: "test-engine",
                metrics: METRICS,
              };
            },
          }),
        loadTape: async () => sampleTape(),
        assembleScenario: (input) => {
          assert.equal(input.subscriptionTier, "pro");
          return sampleScenario(input.runId);
        },
        resolveTapeExchange: () => ({
          id: "binance_perp_usdt",
          label: "Binance",
          ccxtId: "binanceusdm",
          marketType: "swap",
          quoteAsset: "USDT",
        }),
        loadTokens: () => ({
          accessToken: "test-access",
          refreshToken: "",
          expiresAt: Date.now() + 60_000,
          environment: "local",
          issuer: localProfile.issuer,
          audience: localProfile.audience,
          clientId: localProfile.clientId,
          scopes: ["openid"],
        }),
        apiRequest: async (options) => {
          assert.equal(runCompleted, true);
          apiCalls.push(`${options.method} ${options.path}`);
          assert.deepEqual(options.body, {
            name: "grid-aug",
            strategyDefinitionId: "grid",
            strategyDefinitionDisplay: { zh: "网格", en: "Grid" },
          });
          return jsonResponse(201, { id: "exp-created-1" });
        },
      }
    );
    assert.deepEqual(apiCalls, ["POST /api/v1/engine-backtest/experiments"]);
    assert.equal(result.experimentId, "exp-created-1");
    assert.equal(result.persisted, false);
  });

  it("does not create an experiment when planning fails", async () => {
    let tapeCalls = 0;
    const apiCalls: string[] = [];
    await assert.rejects(
      () =>
        executeEngineBacktestRun(
          parseEngineBacktestRunArgs([
            "--create-experiment",
            "--name",
            "must-not-exist",
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
          FLAGS,
          { ALPHAFOX_CONFIG_DIR: mkdtempSync(join(tmpdir(), "alphafox-cfg-")) },
          {
            createNodeBacktestClient: () =>
              fakeClient({
                planBacktest: async () => ({
                  definitionId: "grid",
                  configSchemaVersion: 4,
                  support: {
                    status: "unsupported",
                    reason: {
                      code: "not_supported",
                      message: "grid config cannot be planned",
                    },
                  },
                  needsFunding: false,
                  auxiliaryDataRequirements: [],
                }),
              }),
            loadTape: async () => {
              tapeCalls += 1;
              return sampleTape();
            },
            assembleScenario: (input) => sampleScenario(input.runId),
            resolveTapeExchange: () => ({
              id: "binance_perp_usdt",
              label: "Binance",
              ccxtId: "binanceusdm",
              marketType: "swap",
              quoteAsset: "USDT",
            }),
            loadTokens: () => ({
              accessToken: "test-access",
              refreshToken: "",
              expiresAt: Date.now() + 60_000,
              environment: "local",
              issuer: localProfile.issuer,
              audience: localProfile.audience,
              clientId: localProfile.clientId,
              scopes: ["openid"],
            }),
            apiRequest: async (options) => {
              apiCalls.push(`${options.method} ${options.path}`);
              return jsonResponse(500, { message: "must not create" });
            },
          }
        ),
      (err: unknown) => {
        assert.ok(err instanceof EngineBacktestError);
        assert.equal(err.subtype, "plan_unsupported");
        assert.match(err.message, /cannot be planned/);
        assert.equal(
          (err.details as { reason?: { code?: string } }).reason?.code,
          "not_supported"
        );
        return true;
      }
    );
    assert.equal(tapeCalls, 0);
    assert.deepEqual(apiCalls, []);
  });

  it("does not create an experiment when packages are unresolved", async () => {
    const apiCalls: string[] = [];
    await assert.rejects(
      () =>
        executeEngineBacktestRun(
          parseEngineBacktestRunArgs([
            "--create-experiment",
            "--name",
            "must-not-exist",
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
          FLAGS,
          {
            ALPHAFOX_CONFIG_DIR: mkdtempSync(join(tmpdir(), "alphafox-cfg-")),
            ALPHAFOX_USE_LOCAL_BACKTEST: "1",
          },
          {
            resolveHooks: {
              exists: () => false,
              cliRoot: join(tmpdir(), "alphafox-cli-missing-root"),
              callerFilename: join(tmpdir(), "no-such-cli", "src", "x.js"),
            },
            loadTokens: () => ({
              accessToken: "test-access",
              refreshToken: "",
              expiresAt: Date.now() + 60_000,
              environment: "local",
              issuer: localProfile.issuer,
              audience: localProfile.audience,
              clientId: localProfile.clientId,
              scopes: ["openid"],
            }),
            apiRequest: async (options) => {
              apiCalls.push(`${options.method} ${options.path}`);
              return jsonResponse(500, { message: "must not create" });
            },
          }
        ),
      (err: unknown) => {
        assert.ok(err instanceof EngineBacktestError);
        assert.equal(err.subtype, "package_unresolved");
        assert.ok(err.message.includes("@alphafoxai/"));
        return true;
      }
    );
    assert.deepEqual(apiCalls, []);
  });

  it("rejects an explicit persisted tier that differs from the account tier", async () => {
    const apiCalls: string[] = [];
    await assert.rejects(
      () =>
        executeEngineBacktestRun(
          parseEngineBacktestRunArgs([
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
            "--tier",
            "free",
          ]),
          FLAGS,
          { ALPHAFOX_CONFIG_DIR: mkdtempSync(join(tmpdir(), "alphafox-cfg-")) },
          {
            createNodeBacktestClient: () => fakeClient(),
            loadTape: async () => sampleTape(),
            assembleScenario: (input) => sampleScenario(input.runId),
            resolveTapeExchange: () => ({
              id: "binance_perp_usdt",
              label: "Binance",
              ccxtId: "binanceusdm",
              marketType: "swap",
              quoteAsset: "USDT",
            }),
            loadTokens: () => ({
              accessToken: "test-access",
              refreshToken: "",
              expiresAt: Date.now() + 60_000,
              environment: "local",
              issuer: localProfile.issuer,
              audience: localProfile.audience,
              clientId: localProfile.clientId,
              scopes: ["openid"],
            }),
            apiRequest: async (options) => {
              apiCalls.push(`${options.method} ${options.path}`);
              return jsonResponse(200, {
                data: { subscriptionTier: "pro" },
              });
            },
          }
        ),
      (err: unknown) => {
        assert.ok(err instanceof EngineBacktestError);
        assert.equal(err.subtype, "subscription_tier_mismatch");
        assert.match(err.message, /free.*pro/);
        return true;
      }
    );
    assert.deepEqual(apiCalls, ["GET /api/v1/subscriptions/me"]);
  });

  it("fails like whoami when persist is requested without tokens", async () => {
    await assert.rejects(
      () =>
        executeEngineBacktestRun(
          parseEngineBacktestRunArgs([
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
          ]),
          FLAGS,
          { ALPHAFOX_CONFIG_DIR: mkdtempSync(join(tmpdir(), "alphafox-cfg-")) },
          {
            createNodeBacktestClient: () => fakeClient(),
            loadTape: async () => sampleTape(),
            assembleScenario: (input) => sampleScenario(input.runId),
            resolveTapeExchange: () => ({
              id: "binance_perp_usdt",
              label: "Binance",
              ccxtId: "binanceusdm",
              marketType: "swap",
              quoteAsset: "USDT",
            }),
            loadTokens: () => null,
          }
        ),
      (err: unknown) => {
        assert.ok(err instanceof EngineBacktestError);
        assert.equal(err.status, 401);
        assert.equal(err.type, "http");
        return true;
      }
    );
  });

  it("does not steal catalog CRUD for engine-backtest experiments list", () => {
    const cliPath = join(__dirname, "..", "..", "dist", "cli.js");
    const r = spawnSync(
      process.execPath,
      [
        cliPath,
        "engine-backtest",
        "experiments",
        "list",
        "--dry-run",
        "--format",
        "json",
      ],
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
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const json = JSON.parse(r.stdout);
    assert.equal(json.ok, true);
    assert.equal(json.data.dryRun, true);
    assert.equal(json.data.operationId, "engine_backtest.experiments.list");
  });

  it("reads @config files from cwd", () => {
    const dir = mkdtempSync(join(tmpdir(), "alphafox-cfgjson-"));
    const file = join(dir, "grid.json");
    writeFileSync(file, JSON.stringify({ grid: true }));
    assert.deepEqual(loadConfigValue("@./grid.json", {
      cwd: dir,
      readFile: (p) => {
        assert.equal(p, file);
        return JSON.stringify({ grid: true });
      },
    }), { grid: true });
  });
});
