import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzeSweepIsland,
  extractSweepMetrics,
  selectBestNonLiquidatedPoint,
} from "../src/engine-backtest/sweep-kernel";

test("extractSweepMetrics copies scalars and normalizes liquidation to a count", () => {
  assert.deepEqual(
    extractSweepMetrics({
      returnPct: 12.5,
      maxDrawdownPct: 8,
      sharpeRatio: 1.1,
      winRatePct: 60,
      maxLeverage: 3.2,
      liquidated: true,
      netPnl: 250,
      finalEquity: 1250,
      tradeCount: 9,
    }),
    {
      returnPct: 12.5,
      maxDrawdownPct: 8,
      sharpeRatio: 1.1,
      winRatePct: 60,
      maxLeverage: 3.2,
      liquidationCount: 1,
      netPnl: 250,
      finalEquity: 1250,
      tradeCount: 9,
    }
  );
  assert.equal(
    extractSweepMetrics({
      returnPct: 4,
      maxDrawdownPct: 2,
      sharpeRatio: 0.4,
      winRatePct: 50,
      liquidated: false,
      netPnl: 40,
      finalEquity: 1040,
      tradeCount: 3,
    }).liquidationCount,
    0
  );
  assert.equal(
    extractSweepMetrics({
      returnPct: 4,
      maxDrawdownPct: 2,
      sharpeRatio: 0.4,
      winRatePct: 50,
      liquidationCount: 2,
      liquidated: false,
      netPnl: 40,
      finalEquity: 1040,
      tradeCount: 3,
    }).liquidationCount,
    2
  );
});

test("selectBestNonLiquidatedPoint ignores a higher-return liquidated coordinate", () => {
  const best = selectBestNonLiquidatedPoint([
    {
      coordinate: { values: [12] },
      status: "ok",
      metrics: pointMetrics(80, 1),
    },
    {
      coordinate: { values: [14] },
      status: "ok",
      metrics: pointMetrics(25, 0),
    },
    {
      coordinate: { values: [16] },
      status: "ok",
      metrics: pointMetrics(20, 0),
    },
    {
      coordinate: { values: [18] },
      status: "failed",
      error: "planner rejected",
    },
  ]);

  assert.deepEqual(best, {
    coordinate: { values: [14] },
    returnPct: 25,
  });
});

test("selectBestNonLiquidatedPoint has no winner when every completed point liquidates", () => {
  assert.equal(
    selectBestNonLiquidatedPoint([
      {
        coordinate: { values: [12] },
        status: "ok",
        metrics: pointMetrics(80, 1),
      },
      {
        coordinate: { values: [14] },
        status: "ok",
        metrics: pointMetrics(25, 1),
      },
    ]),
    null
  );
});

test("island analysis flags an isolated strong center and leaves a weak center unmarked", () => {
  const island = analyzeSweepIsland(
    [
      { value: 0, returnPct: -8, maxDrawdownPct: 28, liquidationCount: 1 },
      { value: 1, returnPct: 18, maxDrawdownPct: 6, liquidationCount: 0 },
      { value: 2, returnPct: -6, maxDrawdownPct: 24, liquidationCount: 1 },
    ],
    1
  );
  assert.ok(island.warning);
  assert.ok(island.warning.islandScore >= 50);
  assert.equal(island.warning.counterexamples.length, 2);

  const valley = analyzeSweepIsland(
    [
      { value: 0, returnPct: 10, maxDrawdownPct: 5, liquidationCount: 0 },
      { value: 1, returnPct: -50, maxDrawdownPct: 80, liquidationCount: 0 },
      { value: 2, returnPct: 12, maxDrawdownPct: 6, liquidationCount: 0 },
    ],
    1
  );
  assert.equal(valley.points[1]?.islandScore, 0);
  assert.equal(valley.warning, null);
});

function pointMetrics(returnPct: number, liquidationCount: number) {
  return {
    returnPct,
    maxDrawdownPct: 5,
    sharpeRatio: 1,
    winRatePct: 50,
    liquidationCount,
    netPnl: returnPct,
    finalEquity: 100 + returnPct,
    tradeCount: 10,
  };
}
