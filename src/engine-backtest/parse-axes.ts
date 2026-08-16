import { EngineBacktestError } from "./errors";
import type { SweepAxisInput } from "./sweep-kernel";
import type { SweepMode } from "./types";

const NEIGHBORHOOD_STEPS = 3;

function usage(message: string, subtype: string): never {
  throw new EngineBacktestError({
    type: "usage",
    subtype,
    message,
    hint: "Each --axes entry needs an explicit config path and either values or min/max/step.",
    status: 400,
  });
}

export function parseSweepAxesDocument(
  raw: unknown,
  config: unknown,
  mode: SweepMode
): SweepAxisInput[] {
  const list = listAxes(raw);
  if (list.length === 0) {
    usage("--axes must contain at least one axis", "invalid_axes");
  }
  return list.map((item, index) => parseSweepAxis(item, config, mode, index));
}

function listAxes(raw: unknown): unknown[] {
  if (Array.isArray(raw)) {
    return raw;
  }
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const axes = (raw as { axes?: unknown }).axes;
    if (Array.isArray(axes)) {
      return axes;
    }
  }
  usage("--axes must be a JSON array or {\"axes\": [...]}", "invalid_axes");
}

function parseSweepAxis(
  raw: unknown,
  config: unknown,
  mode: SweepMode,
  index: number
): SweepAxisInput {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    usage(`Axis ${index} must be an object`, "invalid_axis");
  }
  const row = raw as Record<string, unknown>;
  const path = parseAxisPath(row.path, index);
  const current = readNumericCurrent(config, path, index);
  const values = parseOptionalNumberList(row.values, `Axis ${index} values`);
  const min = optionalFiniteNumber(row.min, `Axis ${index} min`);
  const max = optionalFiniteNumber(row.max, `Axis ${index} max`);
  const step = optionalFiniteNumber(row.step, `Axis ${index} step`);
  const hasWindow = min !== undefined && max !== undefined && step !== undefined;
  if (!values && !hasWindow) {
    usage(
      `Axis ${index} must set values or min/max/step`,
      "invalid_axis_window"
    );
  }
  if (hasWindow && !(step! > 0)) {
    usage(`Axis ${index} step must be > 0`, "invalid_axis_window");
  }
  const isInteger =
    typeof row.isInteger === "boolean"
      ? row.isInteger
      : inferInteger(current, values, step);
  const axis: SweepAxisInput = {
    path,
    current,
    isInteger,
    ...(min === undefined ? {} : { min }),
    ...(max === undefined ? {} : { max }),
    ...(typeof row.minExclusive === "boolean"
      ? { minExclusive: row.minExclusive }
      : {}),
    ...(typeof row.maxExclusive === "boolean"
      ? { maxExclusive: row.maxExclusive }
      : {}),
    ...(values ? { values } : {}),
    ...(values || step === undefined
      ? {}
      : {
          window:
            mode === "neighborhood"
              ? {
                  min: current - NEIGHBORHOOD_STEPS * step,
                  max: current + NEIGHBORHOOD_STEPS * step,
                  step,
                }
              : { min: min as number, max: max as number, step },
        }),
  };
  return axis;
}

function parseAxisPath(raw: unknown, index: number): readonly string[] {
  if (typeof raw === "string") {
    const path = raw.split(".").filter((segment) => segment.length > 0);
    if (path.length === 0) {
      usage(`Axis ${index} path must not be empty`, "invalid_axis_path");
    }
    return path;
  }
  if (Array.isArray(raw)) {
    if (
      raw.length === 0 ||
      raw.some((segment) => typeof segment !== "string" || segment.length === 0)
    ) {
      usage(
        `Axis ${index} path must be a non-empty array of segments`,
        "invalid_axis_path"
      );
    }
    return raw as string[];
  }
  usage(
    `Axis ${index} must identify an explicit config path`,
    "invalid_axis_path"
  );
}

function readNumericCurrent(
  config: unknown,
  path: readonly string[],
  index: number
): number {
  const value = getValueAtPath(config, path);
  if (typeof value !== "number" || !Number.isFinite(value)) {
    usage(
      `Axis ${index} current value at ${path.join(".")} must be a finite number in --config`,
      "invalid_axis_current"
    );
  }
  return value;
}

function parseOptionalNumberList(
  raw: unknown,
  label: string
): readonly number[] | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!Array.isArray(raw) || raw.length === 0) {
    usage(`${label} must be a non-empty number array`, "invalid_axis_values");
  }
  const values = raw.map((value, valueIndex) => {
    const n = Number(value);
    if (!Number.isFinite(n)) {
      usage(
        `${label}[${valueIndex}] must be a finite number`,
        "invalid_axis_values"
      );
    }
    return n;
  });
  return values;
}

function optionalFiniteNumber(raw: unknown, label: string): number | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    usage(`${label} must be a finite number`, "invalid_axis_window");
  }
  return n;
}

function inferInteger(
  current: number,
  values: readonly number[] | undefined,
  step: number | undefined
): boolean {
  const candidates = [
    current,
    ...(values ?? []),
    ...(step === undefined ? [] : [step]),
  ];
  return candidates.every((value) => Number.isInteger(value));
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
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
