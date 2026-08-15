import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
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
    assert.equal(parsed.tier, "pro");
    assert.equal(parsed.dataQualityMode, "strict");
    assert.equal(parsed.persist, true);
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
  it("returns a clear error envelope when nothing resolves", () => {
    assert.throws(
      () =>
        resolveBacktestPackagePath("wasm", {}, {
          requireResolve: () => {
            throw new Error("not installed");
          },
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
            requireResolve: () => {
              throw new Error("not installed");
            },
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
      "exchange:binance",
      `tape:BTC/USDT:USDT:${Date.parse("2026-08-01T00:00:00Z")}:${Date.parse("2026-08-09T00:00:00Z")}:strict`,
      "assemble:grid",
      "wasm:00000000-0000-0000-0000-000000000001",
      "api:POST:/api/v1/engine-backtest/experiments/11111111-1111-1111-1111-111111111111/runs",
      "terminate",
    ]);
    const body = apiBodies[0] as {
      snapshot: { rangeEnd: string; executionModel: unknown; exchangeId: string };
      clientRunId: string;
    };
    assert.equal(body.snapshot.rangeEnd, "2026-08-08");
    assert.equal(body.snapshot.exchangeId, "binance_perp_usdt");
    assert.deepEqual(body.snapshot.executionModel, DEFAULT_EXECUTION_MODEL);
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
      ]),
      FLAGS,
      { ALPHAFOX_CONFIG_DIR: mkdtempSync(join(tmpdir(), "alphafox-cfg-")) },
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

  it("POSTs experiments.create then skips runs.create when creating + no-persist", async () => {
    const apiCalls: string[] = [];
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

  it("fails closed when plan is unsupported and does not load tape", async () => {
    let tapeCalls = 0;
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
  });

  it("fails with a package_unresolved envelope instead of hanging", async () => {
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
            "--no-persist",
          ]),
          FLAGS,
          { ALPHAFOX_CONFIG_DIR: mkdtempSync(join(tmpdir(), "alphafox-cfg-")) },
          {
            resolveHooks: {
              requireResolve: () => {
                throw new Error("not installed");
              },
              exists: () => false,
              cliRoot: join(tmpdir(), "alphafox-cli-missing-root"),
              callerFilename: join(tmpdir(), "no-such-cli", "src", "x.js"),
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
