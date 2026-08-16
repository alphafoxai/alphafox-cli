export type SweepSubscriptionTier = "free" | "pro" | "pro_max";
export type SweepSearchMode = "standard" | "fast";

export interface SweepCoordinate {
  readonly values: readonly number[];
}

export interface SweepAxisWindow {
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

/** Explicit values, or a min/max/step window around the current value. */
export interface SweepAxisInput {
  readonly path: readonly string[];
  readonly current: number;
  readonly isInteger: boolean;
  readonly min?: number;
  readonly max?: number;
  readonly minExclusive?: boolean;
  readonly maxExclusive?: boolean;
  readonly values?: readonly number[];
  readonly window?: SweepAxisWindow;
}

export interface SweepPlanAxis {
  readonly path: readonly string[];
  readonly current: number;
  readonly values: readonly number[];
}

export interface SweepPlan {
  readonly axes: readonly SweepPlanAxis[];
  readonly coordinates: readonly SweepCoordinate[];
  readonly requestedCombinationCount: number;
  readonly sampled: boolean;
}

export type SweepConfigRecord = {
  readonly [key: string]: unknown;
};
