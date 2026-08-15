export const ENGINE_BACKTEST_BASE_TIMEFRAME = "1m";
export const ENGINE_BACKTEST_WARMUP_CANDLES = 500;

/** Timeframes the tape loader can fetch natively. */
export const TIMEFRAME_MS = Object.freeze({
  "1m": 60_000,
  "3m": 180_000,
  "5m": 300_000,
  "15m": 900_000,
  "30m": 1_800_000,
  "1h": 3_600_000,
  "2h": 7_200_000,
  "4h": 14_400_000,
  "6h": 21_600_000,
  "8h": 28_800_000,
  "12h": 43_200_000,
  "1d": 86_400_000,
  "3d": 259_200_000,
  "1w": 604_800_000,
});

/** Plan resolution also accepts 1M; series fetch still rejects it. */
const PLAN_TIMEFRAME_MS = Object.freeze({
  ...TIMEFRAME_MS,
  "1M": 2_592_000_000,
});

export function resolvePlanBaseTimeframe(input) {
  const explicit = input.baseTimeframe?.trim();
  if (explicit && PLAN_TIMEFRAME_MS[explicit]) {
    return explicit;
  }
  const candidates = (input.timeframes ?? [])
    .map((value) => value.trim())
    .filter((value) => PLAN_TIMEFRAME_MS[value]);
  if (candidates.length === 0) {
    return ENGINE_BACKTEST_BASE_TIMEFRAME;
  }
  let best = candidates[0];
  for (const timeframe of candidates) {
    const bestMs = PLAN_TIMEFRAME_MS[best];
    const nextMs = PLAN_TIMEFRAME_MS[timeframe];
    if (nextMs < bestMs || (nextMs === bestMs && timeframe < best)) {
      best = timeframe;
    }
  }
  return best;
}

export function baseTimeframeStepMs(baseTimeframe) {
  return (
    PLAN_TIMEFRAME_MS[baseTimeframe] ??
    PLAN_TIMEFRAME_MS[ENGINE_BACKTEST_BASE_TIMEFRAME]
  );
}
