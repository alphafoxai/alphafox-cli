import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { EngineBacktestError } from "../src/engine-backtest/errors";
import { parseEngineBacktestRunArgs } from "../src/engine-backtest/parse-args";
import {
  ENGINE_BACKTEST_DEFAULT_REPLAY_TIMEFRAME,
  mergeReplayTimeframeWithPlan,
} from "../src/engine-backtest/replay-timeframe";

const REQUIRED_FLAGS = [
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
] as const;

describe("engine-backtest replay timeframe", () => {
  it("defaults --replay-timeframe to 1m", () => {
    const parsed = parseEngineBacktestRunArgs([...REQUIRED_FLAGS]);
    assert.equal(parsed.replayTimeframe, ENGINE_BACKTEST_DEFAULT_REPLAY_TIMEFRAME);
  });

  it("accepts an allowed replay timeframe", () => {
    const parsed = parseEngineBacktestRunArgs([
      ...REQUIRED_FLAGS,
      "--replay-timeframe",
      "4h",
    ]);
    assert.equal(parsed.replayTimeframe, "4h");
  });

  it("rejects a finer or unknown replay timeframe", () => {
    assert.throws(
      () =>
        parseEngineBacktestRunArgs([
          ...REQUIRED_FLAGS,
          "--replay-timeframe",
          "10s",
        ]),
      (err: unknown) => {
        assert.ok(err instanceof EngineBacktestError);
        assert.equal(err.subtype, "invalid_replay_timeframe");
        return true;
      }
    );
  });

  it("merges 1m replay into a 4h-only plan without dropping indicator series", () => {
    const merged = mergeReplayTimeframeWithPlan({
      replayTimeframe: "1m",
      planTimeframes: ["4h"],
      seriesRequirements: [
        { symbol: "NBIS/USDT:USDT", timeframe: "4h", minWarmupCandles: 200 },
      ],
      symbols: ["NBIS/USDT:USDT"],
    });
    assert.equal(merged.baseTimeframe, "1m");
    assert.deepEqual(merged.timeframes, ["1m", "4h"]);
    assert.deepEqual(merged.seriesRequirements, [
      { symbol: "NBIS/USDT:USDT", timeframe: "4h", minWarmupCandles: 200 },
      { symbol: "NBIS/USDT:USDT", timeframe: "1m", minWarmupCandles: 0 },
    ]);
  });
});
