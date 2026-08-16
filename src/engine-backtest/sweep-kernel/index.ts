/**
 * Pure Sweep domain kernel shared with alphafox-web.
 * Copied from alphafox-web/features/engine-backtest/domain/sweep-kernel.
 * Keep this folder and the matching tests/sweep-kernel.*.test.ts aligned
 * with the Web copy. No DOM, IndexedDB, React, or WASM host dependencies.
 */
export {
  DEFAULT_SWEEP_CONCURRENCY,
  FREE_MAX_SWEEP_COMBINATIONS,
  FREE_MAX_SWEEP_PARAMS,
  MAX_SWEEP_CONCURRENCY,
  PRO_MAX_SWEEP_COMBINATIONS,
  resolveMaxSweepCombinations,
  resolveMaxSweepParams,
  resolveSweepConcurrency,
  SWEEP_CONCURRENCY_OPTIONS,
  SWEEP_SERIAL_CONCURRENCY,
  type SweepConcurrency,
} from "./caps";
export {
  applySweepCoordinate,
  buildSweepAxisValues,
  estimateFastSweepCombinationCount,
  planSweep,
  planSweepFastRefinement,
} from "./plan";
export {
  analyzeSweepIsland,
  extractSweepMetrics,
  resolveIslandRiskLevel,
  selectBestNonLiquidatedPoint,
} from "./results";
export {
  createSweepSessionState,
  reduceSweepSession,
} from "./session";
export type {
  SweepCloudSaveState,
  SweepExecutionState,
  SweepSessionEvent,
  SweepSessionState,
} from "./session";
export type {
  IslandAnalysis,
  IslandCounterexample,
  IslandRiskLevel,
  IslandWarning,
  ScoredSweepPoint,
  SweepMetricPoint,
  SweepMetricsSource,
  SweepPoint,
  SweepPointMetrics,
} from "./results";
export type {
  SweepAxisInput,
  SweepAxisWindow,
  SweepConfigRecord,
  SweepCoordinate,
  SweepPlan,
  SweepPlanAxis,
  SweepSearchMode,
  SweepSubscriptionTier,
} from "./types";
