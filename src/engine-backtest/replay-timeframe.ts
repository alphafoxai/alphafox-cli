import type { EngineBacktestSeriesRequirement } from "./types";

export const ENGINE_BACKTEST_REPLAY_TIMEFRAMES = [
  "1m",
  "3m",
  "5m",
  "15m",
  "30m",
  "1h",
  "4h",
] as const;

export type EngineBacktestReplayTimeframe =
  (typeof ENGINE_BACKTEST_REPLAY_TIMEFRAMES)[number];

export const ENGINE_BACKTEST_DEFAULT_REPLAY_TIMEFRAME = "1m";

export function isEngineBacktestReplayTimeframe(
  value: string
): value is EngineBacktestReplayTimeframe {
  return (ENGINE_BACKTEST_REPLAY_TIMEFRAMES as readonly string[]).includes(
    value
  );
}

export function parseReplayTimeframe(
  value: unknown
): EngineBacktestReplayTimeframe {
  return typeof value === "string" && isEngineBacktestReplayTimeframe(value)
    ? value
    : ENGINE_BACKTEST_DEFAULT_REPLAY_TIMEFRAME;
}

export function mergeReplayTimeframeWithPlan(input: {
  readonly replayTimeframe: string;
  readonly planTimeframes: readonly string[];
  readonly seriesRequirements: readonly EngineBacktestSeriesRequirement[];
  readonly symbols: readonly string[];
}): {
  readonly baseTimeframe: EngineBacktestReplayTimeframe;
  readonly timeframes: readonly string[];
  readonly seriesRequirements: readonly EngineBacktestSeriesRequirement[];
} {
  const replay = parseReplayTimeframe(input.replayTimeframe);
  const timeframes = input.planTimeframes.includes(replay)
    ? [...input.planTimeframes]
    : [replay, ...input.planTimeframes];
  const requirements = [...input.seriesRequirements];
  const seen = new Set(
    requirements.map(
      (requirement) => `${requirement.symbol}\u0000${requirement.timeframe}`
    )
  );
  for (const symbol of input.symbols) {
    const key = `${symbol}\u0000${replay}`;
    if (seen.has(key)) continue;
    requirements.push({
      symbol,
      timeframe: replay,
      minWarmupCandles: 0,
    });
    seen.add(key);
  }
  return {
    baseTimeframe: replay,
    timeframes,
    seriesRequirements: requirements,
  };
}
