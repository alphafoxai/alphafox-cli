import type { SweepSubscriptionTier } from "./types";

/** Free tier max simultaneous sweep parameters. */
export const FREE_MAX_SWEEP_PARAMS = 5;
/** Free combination cap (downsample above this). */
export const FREE_MAX_SWEEP_COMBINATIONS = 125;
/** Pro / Pro Max combination cap. */
export const PRO_MAX_SWEEP_COMBINATIONS = 2000;
/** Free tier is forced to serial execution. */
export const SWEEP_SERIAL_CONCURRENCY = 1;
/** Pro default worker count for parameter search. */
export const DEFAULT_SWEEP_CONCURRENCY = 2;
/** Hard cap on simultaneous sweep workers. */
export const MAX_SWEEP_CONCURRENCY = 8;
export const SWEEP_CONCURRENCY_OPTIONS = [
  1, 2, 3, 4, 5, 6, 7, 8,
] as const satisfies readonly number[];
export type SweepConcurrency = (typeof SWEEP_CONCURRENCY_OPTIONS)[number];

function isProTier(
  subscriptionTier: SweepSubscriptionTier | undefined
): boolean {
  return subscriptionTier === "pro" || subscriptionTier === "pro_max";
}

/**
 * Free users always run serially. Pro / Pro Max may pick 1…MAX, defaulting to
 * {@link DEFAULT_SWEEP_CONCURRENCY} when the requested value is invalid.
 */
export function resolveSweepConcurrency(input: {
  readonly subscriptionTier: SweepSubscriptionTier | undefined;
  readonly requested: number;
}): SweepConcurrency {
  if (!isProTier(input.subscriptionTier)) {
    return SWEEP_SERIAL_CONCURRENCY;
  }
  if (
    Number.isInteger(input.requested) &&
    input.requested >= SWEEP_SERIAL_CONCURRENCY &&
    input.requested <= MAX_SWEEP_CONCURRENCY
  ) {
    return input.requested as SweepConcurrency;
  }
  return DEFAULT_SWEEP_CONCURRENCY;
}

/** null = unlimited param count (Pro / Pro Max). */
export function resolveMaxSweepParams(
  subscriptionTier: SweepSubscriptionTier | undefined
): number | null {
  return isProTier(subscriptionTier) ? null : FREE_MAX_SWEEP_PARAMS;
}

export function resolveMaxSweepCombinations(
  subscriptionTier: SweepSubscriptionTier | undefined
): number {
  return isProTier(subscriptionTier)
    ? PRO_MAX_SWEEP_COMBINATIONS
    : FREE_MAX_SWEEP_COMBINATIONS;
}
