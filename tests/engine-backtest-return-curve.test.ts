import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ENGINE_BACKTEST_RETURN_CURVE_MAX_POINTS,
  compressEngineBacktestReturnCurve,
  downsampleEvenlySpacedPoints,
} from "../src/engine-backtest/return-curve";

describe("engine-backtest return curve", () => {
  it("compresses engine equity points to [[unix_ms, cumulative_return]]", () => {
    assert.deepEqual(
      compressEngineBacktestReturnCurve({
        initialEquity: 10_000,
        equityCurve: [
          { t: 1_775_808_000_000, equity: 10_000 },
          { t: 1_775_808_060_000, equity: 11_000 },
          { t: 1_775_808_120_000, equity: 9_500 },
        ],
      }),
      [
        [1_775_808_000_000, 0],
        [1_775_808_060_000, 0.1],
        [1_775_808_120_000, -0.05],
      ]
    );
  });

  it("keeps short curves unchanged and even-samples longer ones", () => {
    const short = [
      [1, 0],
      [2, 0.1],
      [3, 0.2],
    ] as const;
    assert.deepEqual(downsampleEvenlySpacedPoints(short, 8), [
      [1, 0],
      [2, 0.1],
      [3, 0.2],
    ]);
    const long = Array.from(
      { length: 11 },
      (_, index) => [index * 1000, index / 10] as const
    );
    assert.deepEqual(downsampleEvenlySpacedPoints(long, 5), [
      [0, 0],
      [3000, 0.3],
      [5000, 0.5],
      [8000, 0.8],
      [10_000, 1],
    ]);
  });

  it("downsamples oversized equity curves to the shared point cap", () => {
    const equityCurve = Array.from({ length: 8001 }, (_, index) => ({
      t: 1_775_808_000_000 + index * 60_000,
      equity: 10_000 + index,
    }));
    const curve = compressEngineBacktestReturnCurve({
      initialEquity: 10_000,
      equityCurve,
    });
    assert.equal(curve?.length, ENGINE_BACKTEST_RETURN_CURVE_MAX_POINTS);
    assert.equal(curve?.[0]?.[0], equityCurve[0]?.t);
    assert.equal(curve?.at(-1)?.[0], equityCurve.at(-1)?.t);
  });

  it("omits a curve when the local result has no usable equity series", () => {
    assert.equal(
      compressEngineBacktestReturnCurve({
        initialEquity: 10_000,
        equityCurve: [],
      }),
      undefined
    );
    assert.equal(
      compressEngineBacktestReturnCurve({
        initialEquity: 10_000,
        equityCurve: [{ t: "bad", equity: 1 }],
      }),
      undefined
    );
  });
});
