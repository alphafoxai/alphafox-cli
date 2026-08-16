import { resolveMaxSweepCombinations, resolveMaxSweepParams } from "./caps";
import type {
  SweepAxisInput,
  SweepAxisWindow,
  SweepConfigRecord,
  SweepCoordinate,
  SweepPlan,
  SweepPlanAxis,
  SweepSearchMode,
  SweepSubscriptionTier,
} from "./types";

const MAX_RANGE_POINTS = 21;
const NEIGHBORHOOD_STEPS = 3;
const FAST_SWEEP_AXIS_POINTS = 3;
const EPSILON = 1e-9;

export function buildSweepAxisValues(axis: SweepAxisInput): number[] {
  if (axis.values) {
    return normalizeExplicitValues(axis, axis.values);
  }
  const window = axis.window ?? defaultNeighborhoodWindow(axis);
  return buildWindowValues(axis, window);
}

export function planSweep(input: {
  readonly axes: readonly SweepAxisInput[];
  readonly searchMode?: SweepSearchMode;
  readonly subscriptionTier?: SweepSubscriptionTier;
  readonly maxCombinations?: number;
}): SweepPlan {
  const searchMode = input.searchMode ?? "standard";
  const maxParams = resolveMaxSweepParams(input.subscriptionTier);
  const selectedAxes =
    maxParams === null ? [...input.axes] : input.axes.slice(0, maxParams);
  const rawAxes: SweepPlanAxis[] = selectedAxes.map((axis) => ({
    path: axis.path,
    current: axis.current,
    values: buildSweepAxisValues(axis),
  }));
  if (
    rawAxes.length === 0 ||
    rawAxes.some((axis) => axis.values.length === 0)
  ) {
    return {
      axes: rawAxes,
      coordinates: [],
      requestedCombinationCount: 0,
      sampled: false,
    };
  }
  const requestedCombinationCount = product(
    rawAxes.map((axis) => axis.values.length)
  );
  const combinationCap =
    input.maxCombinations ??
    resolveMaxSweepCombinations(input.subscriptionTier);
  const targetSizes = rawAxes.map((axis) => axis.values.length);
  if (searchMode === "fast" && rawAxes.length > 1) {
    for (let index = 0; index < targetSizes.length; index += 1) {
      targetSizes[index] = Math.min(
        targetSizes[index] ?? FAST_SWEEP_AXIS_POINTS,
        FAST_SWEEP_AXIS_POINTS
      );
    }
  } else {
    while (product(targetSizes) > combinationCap) {
      const axisIndex = targetSizes.reduce(
        (largestIndex, size, index) =>
          size > (targetSizes[largestIndex] ?? 0) ? index : largestIndex,
        0
      );
      targetSizes[axisIndex] = Math.max(2, (targetSizes[axisIndex] ?? 2) - 1);
    }
  }
  const axes = rawAxes.map((axis, index) => ({
    path: axis.path,
    current: axis.current,
    values: downsample(
      axis.values,
      targetSizes[index] ?? axis.values.length,
      axis.current
    ),
  }));
  return {
    axes,
    coordinates: cartesianCoordinates(axes.map((axis) => axis.values)),
    requestedCombinationCount,
    sampled: requestedCombinationCount > product(targetSizes),
  };
}

/**
 * Build the second-stage local Cartesian grid around the best coarse point.
 * Keeping a complete grid preserves the per-axis robustness slices used by the
 * result analyzer, unlike sparse Latin-hypercube sampling.
 */
export function planSweepFastRefinement(input: {
  readonly coarsePlan: SweepPlan;
  readonly standardPlan: SweepPlan;
  readonly center: SweepCoordinate;
}): SweepCoordinate[] {
  if (
    input.coarsePlan.axes.length <= 1 ||
    input.coarsePlan.axes.length !== input.standardPlan.axes.length ||
    input.center.values.length !== input.standardPlan.axes.length
  ) {
    return [];
  }
  const localAxes = input.standardPlan.axes.map((axis, index) =>
    localWindow(axis.values, input.center.values[index] ?? axis.current)
  );
  if (localAxes.some((values) => values.length === 0)) {
    return [];
  }
  const coarseKeys = new Set(input.coarsePlan.coordinates.map(coordinateKey));
  return cartesianCoordinates(localAxes).filter(
    (coordinate) => !coarseKeys.has(coordinateKey(coordinate))
  );
}

export function estimateFastSweepCombinationCount(
  coarsePlan: SweepPlan,
  standardPlan: SweepPlan
): number {
  if (coarsePlan.axes.length <= 1) {
    return coarsePlan.coordinates.length;
  }
  const largestRefinement = coarsePlan.coordinates.reduce(
    (largest, center) =>
      Math.max(
        largest,
        planSweepFastRefinement({
          coarsePlan,
          standardPlan,
          center,
        }).length
      ),
    0
  );
  return coarsePlan.coordinates.length + largestRefinement;
}

export function applySweepCoordinate(
  config: SweepConfigRecord,
  axes: readonly { readonly path: readonly string[] }[],
  coordinate: SweepCoordinate
): SweepConfigRecord {
  return axes.reduce(
    (nextConfig, axis, index) =>
      setValueAtPath(
        nextConfig,
        axis.path,
        coordinate.values[index] ?? getValueAtPath(nextConfig, axis.path)
      ),
    config
  );
}

function defaultNeighborhoodWindow(axis: SweepAxisInput): SweepAxisWindow {
  const step = resolveStep(axis);
  return {
    min: axis.current - NEIGHBORHOOD_STEPS * step,
    max: axis.current + NEIGHBORHOOD_STEPS * step,
    step,
  };
}

function resolveStep(axis: SweepAxisInput): number {
  if (axis.window && axis.window.step > 0) {
    return axis.window.step;
  }
  const span =
    axis.min !== undefined && axis.max !== undefined && axis.max > axis.min
      ? (axis.max - axis.min) / (MAX_RANGE_POINTS - 1)
      : Math.abs(axis.current) > 0
        ? Math.abs(axis.current) * 0.1
        : 1;
  if (axis.isInteger) {
    return Math.max(1, Math.round(span));
  }
  const rounded = Number(span.toPrecision(2));
  return rounded > 0 ? rounded : 0.1;
}

function normalizeExplicitValues(
  axis: SweepAxisInput,
  values: readonly number[]
): number[] {
  return [
    ...new Set(
      values
        .filter((value) => Number.isFinite(value))
        .map((value) => roundValue(value, axis.isInteger))
        .filter(
          (value) =>
            (!axis.isInteger || Number.isInteger(value)) &&
            isWithinBounds(value, axis)
        )
    ),
  ].sort((left, right) => left - right);
}

function buildWindowValues(
  axis: SweepAxisInput,
  window: SweepAxisWindow
): number[] {
  const step = window.step;
  if (!(step > 0) || !Number.isFinite(step)) {
    return [];
  }
  let min = window.min;
  let max = window.max;
  if (min > max) {
    [min, max] = [max, min];
  }
  const raw: number[] = [];
  const maxPoints = MAX_RANGE_POINTS * 20;
  for (
    let value = min, guard = 0;
    value <= max + EPSILON && guard < maxPoints;
    value += step, guard += 1
  ) {
    raw.push(roundValue(value, axis.isInteger));
  }
  const current = roundValue(axis.current, axis.isInteger);
  if (isWithinDraftWindow(current, min, max)) {
    raw.push(current);
  }
  const unique = [
    ...new Set(
      raw
        .map((value) => clamp(value, axis.min, axis.max))
        .filter(
          (value) =>
            Number.isFinite(value) &&
            (!axis.isInteger || Number.isInteger(value)) &&
            isWithinDraftWindow(value, min, max) &&
            isWithinBounds(value, axis)
        )
    ),
  ].sort((left, right) => left - right);
  return unique.length > MAX_RANGE_POINTS
    ? downsample(unique, MAX_RANGE_POINTS, axis.current)
    : unique;
}

function roundValue(value: number, isInteger: boolean): number {
  return isInteger ? Math.round(value) : Number(value.toFixed(6));
}

function clamp(
  value: number,
  min: number | undefined,
  max: number | undefined
): number {
  let next = value;
  if (min !== undefined) {
    next = Math.max(min, next);
  }
  if (max !== undefined) {
    next = Math.min(max, next);
  }
  return next;
}

function isWithinDraftWindow(value: number, min: number, max: number): boolean {
  return value + EPSILON >= min && value - EPSILON <= max;
}

function isWithinBounds(value: number, axis: SweepAxisInput): boolean {
  if (
    axis.min !== undefined &&
    (axis.minExclusive ? value <= axis.min : value < axis.min)
  ) {
    return false;
  }
  if (
    axis.max !== undefined &&
    (axis.maxExclusive ? value >= axis.max : value > axis.max)
  ) {
    return false;
  }
  return true;
}

function downsample(
  values: readonly number[],
  limit: number,
  keep: number
): number[] {
  if (values.length <= limit) {
    return [...values];
  }
  const safeLimit = Math.max(2, Math.min(limit, values.length));
  const selectedIndices = new Set<number>();
  for (let slot = 0; slot < safeLimit; slot += 1) {
    selectedIndices.add(
      Math.round((slot * (values.length - 1)) / (safeLimit - 1))
    );
  }
  const keepIndex = values.indexOf(keep);
  if (keepIndex >= 0 && !selectedIndices.has(keepIndex)) {
    const replaceable = [...selectedIndices]
      .filter((index) => index !== 0 && index !== values.length - 1)
      .sort(
        (left, right) =>
          Math.abs(left - keepIndex) - Math.abs(right - keepIndex)
      )[0];
    if (replaceable !== undefined) {
      selectedIndices.delete(replaceable);
    }
    selectedIndices.add(keepIndex);
  }
  for (let index = 0; selectedIndices.size < safeLimit; index += 1) {
    selectedIndices.add(index);
  }
  return [...selectedIndices]
    .sort((left, right) => left - right)
    .slice(0, safeLimit)
    .map((index) => values[index]);
}

function cartesianCoordinates(
  axes: readonly (readonly number[])[]
): SweepCoordinate[] {
  return axes.reduce<SweepCoordinate[]>(
    (coordinates, values) =>
      coordinates.flatMap((coordinate) =>
        values.map((value) => ({
          values: [...coordinate.values, value],
        }))
      ),
    [{ values: [] }]
  );
}

function localWindow(values: readonly number[], center: number): number[] {
  if (values.length <= FAST_SWEEP_AXIS_POINTS) {
    return [...values];
  }
  const exactIndex = values.indexOf(center);
  const centerIndex =
    exactIndex >= 0
      ? exactIndex
      : values.reduce(
          (nearest, value, index) =>
            Math.abs(value - center) <
            Math.abs((values[nearest] ?? center) - center)
              ? index
              : nearest,
          0
        );
  const start = Math.max(
    0,
    Math.min(centerIndex - 1, values.length - FAST_SWEEP_AXIS_POINTS)
  );
  return values.slice(start, start + FAST_SWEEP_AXIS_POINTS);
}

function coordinateKey(coordinate: SweepCoordinate): string {
  return coordinate.values.join("\u0000");
}

function product(values: readonly number[]): number {
  return values.reduce((total, value) => total * value, 1);
}

function isPlainRecord(value: unknown): value is SweepConfigRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseArrayIndex(segment: string): number | null {
  if (!/^\d+$/.test(segment)) {
    return null;
  }
  const index = Number(segment);
  return Number.isInteger(index) && index >= 0 ? index : null;
}

function getValueAtPath(root: unknown, path: readonly string[]): unknown {
  let current: unknown = root;
  for (const segment of path) {
    if (Array.isArray(current)) {
      const index = parseArrayIndex(segment);
      if (index === null) {
        return undefined;
      }
      current = current[index];
      continue;
    }
    if (!isPlainRecord(current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

function containerForPathTail(
  existing: unknown,
  nextSegment: string | undefined
): unknown {
  if (Array.isArray(existing) || isPlainRecord(existing)) {
    return existing;
  }
  return parseArrayIndex(nextSegment ?? "") !== null ? [] : {};
}

function setValueAtPathNode(
  root: unknown,
  path: readonly string[],
  value: unknown
): unknown {
  if (path.length === 0) {
    return value;
  }
  const [head, ...tail] = path;
  if (!head) {
    throw new Error("Sweep config path segment must not be empty.");
  }
  if (Array.isArray(root)) {
    const index = parseArrayIndex(head);
    if (index === null) {
      throw new Error(`Expected array index path segment, got "${head}".`);
    }
    const next = root.slice();
    if (tail.length === 0) {
      while (next.length <= index) {
        next.push(null);
      }
      next[index] = value;
      return next;
    }
    const child = containerForPathTail(next[index], tail[0]);
    while (next.length <= index) {
      next.push(null);
    }
    next[index] = setValueAtPathNode(child, tail, value);
    return next;
  }
  if (!isPlainRecord(root)) {
    return setValueAtPathNode(
      containerForPathTail(undefined, head),
      path,
      value
    );
  }
  const nextRoot: Record<string, unknown> = { ...root };
  if (tail.length === 0) {
    nextRoot[head] = value;
    return nextRoot;
  }
  nextRoot[head] = setValueAtPathNode(
    containerForPathTail(nextRoot[head], tail[0]),
    tail,
    value
  );
  return nextRoot;
}

function setValueAtPath(
  root: SweepConfigRecord,
  path: readonly string[],
  value: unknown
): SweepConfigRecord {
  if (path.length === 0) {
    if (!isPlainRecord(value)) {
      throw new Error("Root config must be an object.");
    }
    return value;
  }
  return setValueAtPathNode(root, path, value) as SweepConfigRecord;
}
