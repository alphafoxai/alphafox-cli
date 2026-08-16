/**
 * Compact Engine Backtest Run return-curve contract.
 * Must stay aligned with alphafox-web `domains/engine-backtest-return-curve.ts`.
 *
 * Stored shape: [[unix_ms, cumulative_return]]
 * - timestamp: engine equity point `t`, Unix milliseconds
 * - cumulative_return: (equity / initialEquity) - 1 (decimal ratio, not percent),
 *   rounded to 10 decimal places
 * - even-sample when longer than 4000: index = round(i * (n-1) / (limit-1))
 */

export const ENGINE_BACKTEST_RETURN_CURVE_MAX_POINTS = 4_000;
/** Must match alphafox-web `ENGINE_BACKTEST_RETURN_CURVE_RETURN_DECIMALS`. */
export const ENGINE_BACKTEST_RETURN_CURVE_RETURN_DECIMALS = 10;

export function roundCumulativeReturn(value: number): number {
  if (value === 0) {
    return 0;
  }
  const factor = 10 ** ENGINE_BACKTEST_RETURN_CURVE_RETURN_DECIMALS;
  return Math.round(value * factor) / factor;
}

export type EngineBacktestReturnCurvePoint = readonly [number, number];
export type EngineBacktestReturnCurve = readonly EngineBacktestReturnCurvePoint[];

export interface EngineBacktestEquitySample {
  readonly t: number;
  readonly equity: number;
}

export function downsampleEvenlySpacedPoints<T>(
  points: readonly T[],
  limit: number
): T[] {
  if (points.length <= limit) {
    return [...points];
  }
  if (limit <= 1) {
    return points[0] === undefined ? [] : [points[0]];
  }
  const lastIndex = points.length - 1;
  const sampled: T[] = [];
  let previousIndex = -1;
  for (let slot = 0; slot < limit; slot += 1) {
    const index = Math.round((slot * lastIndex) / (limit - 1));
    if (index === previousIndex) {
      continue;
    }
    sampled.push(points[index]!);
    previousIndex = index;
  }
  return sampled;
}

export function readEquitySamples(value: unknown): EngineBacktestEquitySample[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const samples: EngineBacktestEquitySample[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const record = item as Record<string, unknown>;
    const t = Number(record.t);
    const equity = Number(record.equity);
    if (!Number.isFinite(t) || !Number.isFinite(equity)) {
      continue;
    }
    samples.push({ t, equity });
  }
  return samples;
}

export function compressEngineBacktestReturnCurve(input: {
  readonly initialEquity: number;
  readonly equityCurve: unknown;
  readonly maxPoints?: number;
}): EngineBacktestReturnCurve | undefined {
  if (!Number.isFinite(input.initialEquity) || input.initialEquity <= 0) {
    return undefined;
  }
  const samples = readEquitySamples(input.equityCurve);
  if (samples.length === 0) {
    return undefined;
  }
  const points: EngineBacktestReturnCurvePoint[] = samples.map((sample) => [
    sample.t,
    roundCumulativeReturn(sample.equity / input.initialEquity - 1),
  ]);
  return downsampleEvenlySpacedPoints(
    points,
    input.maxPoints ?? ENGINE_BACKTEST_RETURN_CURVE_MAX_POINTS
  );
}
