import type { SweepCoordinate } from "./types";

export interface SweepPointMetrics {
  readonly returnPct: number;
  readonly maxDrawdownPct: number;
  readonly sharpeRatio: number;
  readonly winRatePct: number;
  readonly maxLeverage?: number;
  readonly liquidationCount: number;
  readonly netPnl: number;
  readonly finalEquity: number;
  readonly tradeCount: number;
}

export interface SweepMetricsSource {
  readonly returnPct: number;
  readonly maxDrawdownPct: number;
  readonly sharpeRatio: number;
  readonly winRatePct: number;
  readonly maxLeverage?: number;
  readonly liquidationCount?: number;
  readonly liquidated?: boolean;
  readonly netPnl: number;
  readonly finalEquity: number;
  readonly tradeCount: number;
}

export interface SweepPoint {
  readonly coordinate: SweepCoordinate;
  readonly status: "ok" | "failed";
  readonly metrics?: SweepPointMetrics;
  readonly error?: string;
}

export type IslandRiskLevel = "low" | "low_medium" | "medium" | "high";

export interface SweepMetricPoint {
  readonly value: number;
  readonly returnPct: number;
  readonly maxDrawdownPct: number;
  readonly liquidationCount: number;
}

export interface ScoredSweepPoint extends SweepMetricPoint {
  readonly isCenter: boolean;
  readonly islandScore: number;
  readonly riskLevel: IslandRiskLevel;
}

export interface IslandCounterexample {
  readonly counterValue: number;
  readonly centerReturnPct: number;
  readonly counterReturnPct: number;
  readonly centerLiquidationCount: number;
  readonly counterLiquidationCount: number;
}

export interface IslandWarning {
  readonly centerValue: number;
  readonly islandScore: number;
  readonly riskLevel: IslandRiskLevel;
  readonly counterexamples: readonly IslandCounterexample[];
}

export interface IslandAnalysis {
  readonly points: readonly ScoredSweepPoint[];
  readonly warning: IslandWarning | null;
  readonly overallScore: number;
  readonly overallRiskLevel: IslandRiskLevel;
}

export function extractSweepMetrics(
  source: SweepMetricsSource
): SweepPointMetrics {
  return {
    returnPct: source.returnPct,
    maxDrawdownPct: source.maxDrawdownPct,
    sharpeRatio: source.sharpeRatio,
    winRatePct: source.winRatePct,
    ...(source.maxLeverage === undefined
      ? {}
      : { maxLeverage: source.maxLeverage }),
    liquidationCount:
      typeof source.liquidationCount === "number" &&
      Number.isFinite(source.liquidationCount)
        ? source.liquidationCount
        : source.liquidated
          ? 1
          : 0,
    netPnl: source.netPnl,
    finalEquity: source.finalEquity,
    tradeCount: source.tradeCount,
  };
}

export function selectBestNonLiquidatedPoint(points: readonly SweepPoint[]): {
  readonly coordinate: SweepCoordinate;
  readonly returnPct: number;
} | null {
  const candidates = points.filter(isOkNonLiquidatedPoint);
  if (candidates.length === 0) {
    return null;
  }
  const best = candidates.reduce((leader, point) =>
    point.metrics.returnPct > leader.metrics.returnPct ? point : leader
  );
  return {
    coordinate: best.coordinate,
    returnPct: best.metrics.returnPct,
  };
}

export function resolveIslandRiskLevel(score: number): IslandRiskLevel {
  if (score >= 80) {
    return "high";
  }
  if (score >= 50) {
    return "medium";
  }
  if (score >= 30) {
    return "low_medium";
  }
  return "low";
}

/**
 * Score each swept point by how sharply it deviates from its neighbors, then
 * flag the point closest to `centerValue` when it sits on a fragile island.
 */
export function analyzeSweepIsland(
  points: readonly SweepMetricPoint[],
  centerValue: number
): IslandAnalysis {
  const rows = [...points].sort((left, right) => left.value - right.value);
  if (rows.length === 0) {
    return {
      points: [],
      warning: null,
      overallScore: 0,
      overallRiskLevel: "low",
    };
  }

  const returnStd = populationStd(rows.map((row) => row.returnPct));
  const drawdownStd = populationStd(rows.map((row) => row.maxDrawdownPct));
  const centerIndex = rows.reduce(
    (bestIndex, row, index) =>
      Math.abs(row.value - centerValue) <
      Math.abs(rows[bestIndex].value - centerValue)
        ? index
        : bestIndex,
    0
  );

  const scored: ScoredSweepPoint[] = rows.map((row, index) => {
    const neighbors = [index - 1, index + 1]
      .filter((i) => i >= 0 && i < rows.length)
      .map((i) => rows[i]);
    const score = scoreNeighborhood(row, neighbors, returnStd, drawdownStd);
    return {
      ...row,
      isCenter: index === centerIndex,
      islandScore: Number(score.toFixed(2)),
      riskLevel: resolveIslandRiskLevel(score),
    };
  });

  const center = scored[centerIndex];
  const centerNeighbors = [centerIndex - 1, centerIndex + 1]
    .filter((i) => i >= 0 && i < scored.length)
    .map((i) => scored[i]);
  const hasLiquidationJump =
    center.liquidationCount === 0 &&
    centerNeighbors.some((row) => row.liquidationCount > 0);
  const warning: IslandWarning | null =
    hasLiquidationJump || center.islandScore >= 50
      ? {
          centerValue: center.value,
          islandScore: center.islandScore,
          riskLevel: center.riskLevel,
          counterexamples: centerNeighbors
            .filter((row) => row.liquidationCount > center.liquidationCount)
            .map((row) => ({
              counterValue: row.value,
              centerReturnPct: center.returnPct,
              counterReturnPct: row.returnPct,
              centerLiquidationCount: center.liquidationCount,
              counterLiquidationCount: row.liquidationCount,
            })),
        }
      : null;

  const overallScore = scored.reduce(
    (highest, row) => Math.max(highest, row.islandScore),
    0
  );

  return {
    points: scored,
    warning,
    overallScore,
    overallRiskLevel: resolveIslandRiskLevel(overallScore),
  };
}

function isOkNonLiquidatedPoint(
  point: SweepPoint
): point is SweepPoint & { readonly metrics: SweepPointMetrics } {
  return (
    point.status === "ok" &&
    point.metrics !== undefined &&
    Number.isFinite(point.metrics.returnPct) &&
    Number.isFinite(point.metrics.liquidationCount) &&
    point.metrics.liquidationCount === 0
  );
}

function scoreNeighborhood(
  row: SweepMetricPoint,
  neighbors: readonly SweepMetricPoint[],
  returnStd: number,
  drawdownStd: number
): number {
  if (neighbors.length === 0) {
    return 0;
  }
  const neighborReturn = average(neighbors.map((n) => n.returnPct));
  const neighborDrawdown = average(neighbors.map((n) => n.maxDrawdownPct));
  const neighborLiquidations = average(
    neighbors.map((n) => n.liquidationCount)
  );
  const returnAdvantage =
    (Math.min(
      Math.max(row.returnPct - neighborReturn, 0) / Math.max(returnStd, 0.5),
      2
    ) /
      2) *
    100;
  const drawdownAdvantage =
    (Math.min(
      Math.max(neighborDrawdown - row.maxDrawdownPct, 0) /
        Math.max(drawdownStd, 0.1),
      2
    ) /
      2) *
    100;
  const liquidationJump =
    (Math.min(Math.max(neighborLiquidations - row.liquidationCount, 0), 3) /
      3) *
    100;
  return (
    0.35 * returnAdvantage + 0.3 * drawdownAdvantage + 0.25 * liquidationJump
  );
}

function average(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function populationStd(values: readonly number[]): number {
  if (values.length < 2) {
    return 0;
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length
  );
}
