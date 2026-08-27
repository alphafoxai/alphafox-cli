import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { projectDcaFirstOrderAmountForLegacyRuntime } from "../src/engine-backtest/dca-first-order-amount-compat";
import {
  parseEngineBacktestRunArgs,
} from "../src/engine-backtest/parse-args";
import { DEFAULT_EXECUTION_MODEL } from "../src/engine-backtest/persist";
import {
  executeEngineBacktestRun,
  type EngineBacktestCliFlags,
} from "../src/engine-backtest/run-command";
import type {
  BacktestClientLike,
  EngineBacktestMetrics,
  EngineBacktestScenario,
  EngineSupportedBacktestPlan,
  TapeLoadResult,
} from "../src/engine-backtest/types";

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
  orderCount: 0,
  filledOrderCount: 0,
  canceledOrderCount: 0,
  tradeCount: 0,
  winningTrades: 0,
  losingTrades: 0,
  winRatePct: 0,
  feesPaid: 0,
  slippagePaid: 0,
  liquidated: false,
};

const PLAN: EngineSupportedBacktestPlan = {
  definitionId: "dca",
  configSchemaVersion: 4,
  support: { status: "supported" },
  effectiveConfig: {},
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
      strategyDefinitionId: "dca",
      configSchemaVersion: 4,
      subscriptionTier: "pro",
      config: {},
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
  return {
    tape: sampleScenario().tape,
    buffers: { k0: new ArrayBuffer(8) },
    coverageWarnings: [],
    coverageIssues: [],
  };
}

function fakeClient(overrides: Partial<BacktestClientLike> = {}): BacktestClientLike {
  return {
    init: async () => "test-engine",
    version: async () => "test-engine",
    strategyDefinitions: async () => ({
      engineVersion: "test-engine",
      definitions: [{ id: "dca", configSchemaVersion: 4 }],
    }),
    planBacktest: async () => PLAN,
    prepareTape: async () => ({ handle: "tape-1", fingerprint: "fp-1" }),
    runPreparedBacktest: async (_handle, scenario) => ({
      runId: scenario.runId,
      status: "completed",
      engineVersion: "test-engine",
      metrics: METRICS,
    }),
    runPreparedBacktestBatch: async (_handle, batch) => ({
      batchId: batch.batchId,
      status: "completed",
      results: [],
    }),
    releaseTape: async () => ({ released: true as const }),
    terminate: () => undefined,
    ...overrides,
  };
}

describe("engine-backtest dca first-order amount projection", () => {
  it("mirrors equity-percent first order onto initialMarginPercent", () => {
    const config = {
      strategy: {
        longDecisionLogic: {
          id: "simple-long",
          params: {
            firstOrderAmountType: "equityPercent",
            firstOrderAmount: 5,
            takeProfitPercent: 1,
          },
        },
      },
    };
    assert.deepEqual(projectDcaFirstOrderAmountForLegacyRuntime(config), {
      strategy: {
        longDecisionLogic: {
          id: "simple-long",
          params: {
            firstOrderAmountType: "equityPercent",
            firstOrderAmount: 5,
            takeProfitPercent: 1,
            initialMarginPercent: 5,
          },
        },
      },
    });
  });

  it("mirrors fixed first order onto fixedInitialNotional", () => {
    const config = {
      strategy: {
        shortDecisionLogic: {
          id: "simple-short",
          params: {
            firstOrderAmountType: "fixedAmount",
            firstOrderAmount: 250,
          },
        },
      },
    };
    assert.deepEqual(projectDcaFirstOrderAmountForLegacyRuntime(config), {
      strategy: {
        shortDecisionLogic: {
          id: "simple-short",
          params: {
            firstOrderAmountType: "fixedAmount",
            firstOrderAmount: 250,
            fixedInitialNotional: 250,
          },
        },
      },
    });
  });

  it("does not leave a fixed alias that would override equity percent", () => {
    const projected = projectDcaFirstOrderAmountForLegacyRuntime({
      strategy: {
        longDecisionLogic: {
          id: "simple-long",
          params: {
            firstOrderAmountType: "equityPercent",
            firstOrderAmount: 8,
            fixedInitialNotional: 100,
          },
        },
      },
    }) as {
      strategy: { longDecisionLogic: { params: Record<string, unknown> } };
    };
    assert.equal(
      projected.strategy.longDecisionLogic.params.initialMarginPercent,
      8
    );
    assert.equal(
      projected.strategy.longDecisionLogic.params.fixedInitialNotional,
      undefined
    );
  });

  it("projects first-order aliases before planBacktest and the run scenario", async () => {
    const sourceConfig = {
      common: { symbols: ["BTC/USDT:USDT"] },
      strategy: {
        longDecisionLogic: {
          id: "simple-long",
          params: {
            firstOrderAmountType: "equityPercent",
            firstOrderAmount: 5,
          },
        },
      },
    };
    const planned: unknown[] = [];
    const assembled: unknown[] = [];
    await executeEngineBacktestRun(
      parseEngineBacktestRunArgs([
        "--experiment",
        "11111111-1111-1111-1111-111111111111",
        "--definition",
        "dca",
        "--config",
        JSON.stringify(sourceConfig),
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
          fakeClient({
            planBacktest: async (req) => {
              planned.push(req.config);
              return {
                ...PLAN,
                effectiveConfig: req.config as Record<string, unknown>,
              };
            },
          }),
        loadTape: async () => sampleTape(),
        assembleScenario: (input) => {
          assembled.push(input.config);
          return {
            ...sampleScenario(input.runId),
            trader: {
              ...sampleScenario(input.runId).trader,
              config: input.config,
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
        defaultExecutionModel: DEFAULT_EXECUTION_MODEL,
      }
    );
    const expected = projectDcaFirstOrderAmountForLegacyRuntime(sourceConfig);
    assert.deepEqual(planned[0], expected);
    assert.deepEqual(assembled[0], expected);
    const params = (
      expected as {
        strategy: { longDecisionLogic: { params: { initialMarginPercent: number } } };
      }
    ).strategy.longDecisionLogic.params;
    assert.equal(params.initialMarginPercent, 5);
  });
});
