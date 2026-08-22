import { EngineBacktestError } from "./errors";
import {
  ENGINE_BACKTEST_DEFAULT_REPLAY_TIMEFRAME,
  ENGINE_BACKTEST_REPLAY_TIMEFRAMES,
  isEngineBacktestReplayTimeframe,
  type EngineBacktestReplayTimeframe,
} from "./replay-timeframe";
import { DEFAULT_SWEEP_CONCURRENCY } from "./sweep-kernel";
import {
  DEFAULT_DATA_QUALITY_MODE,
  type DataQualityMode,
  type EngineBacktestRunArgs,
  type EngineBacktestSweepArgs,
  type ExecutionModel,
  type InclusiveUtcDateRange,
  type SubscriptionTier,
  type SweepMode,
  type SweepSearchMode,
} from "./types";

const DAY_MS = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIERS = new Set<SubscriptionTier>(["free", "pro", "pro_max"]);
const DATA_QUALITY = new Set<DataQualityMode>(["strict", "basic"]);
const PRICE_PATHS = new Set(["ohlc_path_4", "close_only"]);

export const ENGINE_BACKTEST_RUN_USAGE = [
  "alphafox engine-backtest run --experiment <uuid> --definition <id> --config @file.json --exchange <id> --range YYYY-MM-DD..YYYY-MM-DD --initial-equity N [--replay-timeframe 1m]",
  "alphafox engine-backtest run --create-experiment --name <name> --definition <id> --config @file.json --exchange <id> --from YYYY-MM-DD --to YYYY-MM-DD --initial-equity N",
];

export const ENGINE_BACKTEST_SWEEP_USAGE = [
  "alphafox engine-backtest sweep --experiment <uuid> --definition <id> --config @file.json --axes @axes.json --exchange <id> --range YYYY-MM-DD..YYYY-MM-DD --initial-equity N [--no-persist] [--mode neighborhood|range] [--search-mode standard|fast] [--concurrency N]",
];

const SWEEP_MODES = new Set<SweepMode>(["neighborhood", "range"]);
const SEARCH_MODES = new Set<SweepSearchMode>(["standard", "fast"]);

function usage(
  message: string,
  subtype = "invalid_args",
  hint = ENGINE_BACKTEST_RUN_USAGE[0]
): never {
  throw new EngineBacktestError({
    type: "usage",
    subtype,
    message,
    hint,
    status: 400,
  });
}

function takeValue(
  args: string[],
  i: number,
  flag: string
): { readonly value: string; readonly next: number } {
  const next = args[i + 1];
  if (next === undefined || next.startsWith("--")) {
    usage(`Missing value for ${flag}`, "missing_flag_value");
  }
  return { value: next, next: i + 1 };
}

export function parseInclusiveUtcDateRange(
  rangeStart: string,
  rangeEnd: string
): InclusiveUtcDateRange {
  if (!ISO_DATE.test(rangeStart) || !ISO_DATE.test(rangeEnd)) {
    usage(
      `Dates must be YYYY-MM-DD (got ${rangeStart}..${rangeEnd})`,
      "invalid_range"
    );
  }
  const fromMs = Date.parse(`${rangeStart}T00:00:00Z`);
  const endStartMs = Date.parse(`${rangeEnd}T00:00:00Z`);
  const toMs = endStartMs + DAY_MS;
  if (
    !Number.isFinite(fromMs) ||
    !Number.isFinite(endStartMs) ||
    !Number.isFinite(toMs) ||
    new Date(fromMs).toISOString().slice(0, 10) !== rangeStart ||
    new Date(endStartMs).toISOString().slice(0, 10) !== rangeEnd ||
    endStartMs < fromMs
  ) {
    usage(
      `Invalid inclusive UTC range ${rangeStart}..${rangeEnd}`,
      "invalid_range"
    );
  }
  return { rangeStart, rangeEnd, fromMs, toMs };
}

export function parseRangeFlag(raw: string): InclusiveUtcDateRange {
  const parts = raw.split("..");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    usage(
      `--range must be YYYY-MM-DD..YYYY-MM-DD (got ${raw})`,
      "invalid_range"
    );
  }
  return parseInclusiveUtcDateRange(parts[0], parts[1]);
}

export function parseExecutionModelJson(raw: string): Partial<ExecutionModel> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    usage("--execution-model must be JSON", "invalid_execution_model");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    usage("--execution-model must be a JSON object", "invalid_execution_model");
  }
  const o = parsed as Record<string, unknown>;
  const out: {
    pricePath?: ExecutionModel["pricePath"];
    makerFeeRate?: number;
    takerFeeRate?: number;
    slippageRate?: number;
  } = {};
  if (o.pricePath !== undefined) {
    if (typeof o.pricePath !== "string" || !PRICE_PATHS.has(o.pricePath)) {
      usage(
        `--execution-model.pricePath must be ohlc_path_4|close_only`,
        "invalid_execution_model"
      );
    }
    out.pricePath = o.pricePath as ExecutionModel["pricePath"];
  }
  for (const key of ["makerFeeRate", "takerFeeRate", "slippageRate"] as const) {
    if (o[key] === undefined) continue;
    const n = Number(o[key]);
    if (!Number.isFinite(n)) {
      usage(`--execution-model.${key} must be a finite number`, "invalid_execution_model");
    }
    out[key] = n;
  }
  return out;
}

export function parseEngineBacktestRunArgs(
  args: readonly string[]
): EngineBacktestRunArgs {
  let experimentId: string | undefined;
  let createExperiment = false;
  let name: string | undefined;
  let definitionId: string | undefined;
  let definitionLabelZh: string | undefined;
  let definitionLabelEn: string | undefined;
  let configRaw: string | undefined;
  let exchange: string | undefined;
  let rangeRaw: string | undefined;
  let from: string | undefined;
  let to: string | undefined;
  let initialEquity: number | undefined;
  let tier: SubscriptionTier | undefined;
  let dataQualityMode: DataQualityMode = DEFAULT_DATA_QUALITY_MODE;
  let configSchemaVersion: number | undefined;
  let executionModelOverride: Partial<ExecutionModel> | undefined;
  let persist = true;
  let help = false;
  let replayTimeframe: EngineBacktestReplayTimeframe =
    ENGINE_BACKTEST_DEFAULT_REPLAY_TIMEFRAME;

  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]!;
    if (a === "--help" || a === "-h") {
      help = true;
      continue;
    }
    if (a === "--create-experiment") {
      createExperiment = true;
      continue;
    }
    if (a === "--no-persist") {
      persist = false;
      continue;
    }
    if (!a.startsWith("--")) {
      usage(`Unexpected argument: ${a}`, "unexpected_arg");
    }

    const eq = a.indexOf("=");
    const flag = eq >= 0 ? a.slice(0, eq) : a;
    const inline = eq >= 0 ? a.slice(eq + 1) : undefined;
    const read = (): string => {
      if (inline !== undefined) return inline;
      const taken = takeValue(args as string[], i, flag);
      i = taken.next;
      return taken.value;
    };

    switch (flag) {
      case "--experiment":
        experimentId = read().trim();
        break;
      case "--name":
        name = read();
        break;
      case "--definition":
        definitionId = read().trim();
        break;
      case "--definition-label-zh":
        definitionLabelZh = read();
        break;
      case "--definition-label-en":
        definitionLabelEn = read();
        break;
      case "--config":
        configRaw = read();
        break;
      case "--exchange":
        exchange = read().trim();
        break;
      case "--range":
        rangeRaw = read();
        break;
      case "--from":
        from = read().trim();
        break;
      case "--to":
        to = read().trim();
        break;
      case "--initial-equity": {
        const raw = read();
        const n = Number(raw);
        if (!Number.isFinite(n) || n <= 0) {
          usage("--initial-equity must be a positive number", "invalid_equity");
        }
        initialEquity = n;
        break;
      }
      case "--tier": {
        const raw = read().trim() as SubscriptionTier;
        if (!TIERS.has(raw)) {
          usage("--tier must be free|pro|pro_max", "invalid_tier");
        }
        tier = raw;
        break;
      }
      case "--data-quality": {
        const raw = read().trim() as DataQualityMode;
        if (!DATA_QUALITY.has(raw)) {
          usage("--data-quality must be strict|basic", "invalid_data_quality");
        }
        dataQualityMode = raw;
        break;
      }
      case "--config-schema-version": {
        const n = Number(read());
        if (!Number.isInteger(n) || n <= 0) {
          usage(
            "--config-schema-version must be a positive integer",
            "invalid_config_schema_version"
          );
        }
        configSchemaVersion = n;
        break;
      }
      case "--execution-model":
        executionModelOverride = parseExecutionModelJson(read());
        break;
      case "--replay-timeframe": {
        const raw = read().trim();
        if (!isEngineBacktestReplayTimeframe(raw)) {
          usage(
            `--replay-timeframe must be ${ENGINE_BACKTEST_REPLAY_TIMEFRAMES.join("|")} (got ${raw})`,
            "invalid_replay_timeframe"
          );
        }
        replayTimeframe = raw;
        break;
      }
      default:
        usage(`Unknown flag: ${flag}`, "unknown_flag");
    }
  }

  if (help) {
    return {
      help: true,
      createExperiment: false,
      tier,
      dataQualityMode,
      persist,
      replayTimeframe,
    };
  }

  if (!definitionId) {
    usage("--definition is required", "missing_definition");
  }
  if (!configRaw) {
    usage("--config is required (@file.json or JSON)", "missing_config");
  }
  if (!exchange) {
    usage("--exchange is required", "missing_exchange");
  }
  if (initialEquity === undefined) {
    usage("--initial-equity is required", "missing_equity");
  }

  let range: InclusiveUtcDateRange | undefined;
  if (rangeRaw) {
    if (from || to) {
      usage("Use either --range or --from/--to, not both", "range_conflict");
    }
    range = parseRangeFlag(rangeRaw);
  } else if (from || to) {
    if (!from || !to) {
      usage("--from and --to must be used together", "range_incomplete");
    }
    range = parseInclusiveUtcDateRange(from, to);
  } else {
    usage("--range or --from/--to is required", "missing_range");
  }

  if (!experimentId && !createExperiment) {
    usage(
      "Provide --experiment <uuid> or --create-experiment --name <name>",
      "missing_experiment"
    );
  }
  if (createExperiment && !name?.trim()) {
    usage("--create-experiment requires --name", "missing_experiment_name");
  }
  if (experimentId && createExperiment) {
    usage(
      "Use either --experiment or --create-experiment, not both",
      "experiment_conflict"
    );
  }

  return {
    help: false,
    experimentId,
    createExperiment,
    name: name?.trim(),
    definitionId,
    definitionLabelZh,
    definitionLabelEn,
    configRaw,
    exchange,
    range,
    initialEquity,
    tier,
    dataQualityMode,
    configSchemaVersion,
    executionModelOverride,
    persist,
    replayTimeframe,
  };
}

export function parseEngineBacktestSweepArgs(
  args: readonly string[]
): EngineBacktestSweepArgs {
  let axesRaw: string | undefined;
  let mode: SweepMode = "neighborhood";
  let searchMode: SweepSearchMode = "standard";
  let concurrency = DEFAULT_SWEEP_CONCURRENCY;
  let help = false;
  const rest: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]!;
    if (a === "--help" || a === "-h") {
      help = true;
      continue;
    }
    const eq = a.indexOf("=");
    const flag = eq >= 0 ? a.slice(0, eq) : a;
    const inline = eq >= 0 ? a.slice(eq + 1) : undefined;
    const read = (): string => {
      if (inline !== undefined) return inline;
      const taken = takeValue(args as string[], i, flag);
      i = taken.next;
      return taken.value;
    };
    if (flag === "--axes") {
      axesRaw = read();
      continue;
    }
    if (flag === "--mode") {
      const raw = read().trim() as SweepMode;
      if (!SWEEP_MODES.has(raw)) {
        usage(
          "--mode must be neighborhood|range",
          "invalid_sweep_mode",
          ENGINE_BACKTEST_SWEEP_USAGE[0]
        );
      }
      mode = raw;
      continue;
    }
    if (flag === "--search-mode") {
      const raw = read().trim() as SweepSearchMode;
      if (!SEARCH_MODES.has(raw)) {
        usage(
          "--search-mode must be standard|fast",
          "invalid_search_mode",
          ENGINE_BACKTEST_SWEEP_USAGE[0]
        );
      }
      searchMode = raw;
      continue;
    }
    if (flag === "--concurrency") {
      const n = Number(read());
      if (!Number.isInteger(n) || n < 1) {
        usage(
          "--concurrency must be a positive integer",
          "invalid_concurrency",
          ENGINE_BACKTEST_SWEEP_USAGE[0]
        );
      }
      concurrency = n;
      continue;
    }
    rest.push(a);
  }

  if (help) {
    return {
      help: true,
      createExperiment: false,
      dataQualityMode: DEFAULT_DATA_QUALITY_MODE,
      persist: true,
      replayTimeframe: ENGINE_BACKTEST_DEFAULT_REPLAY_TIMEFRAME,
      axesRaw,
      mode,
      searchMode,
      concurrency,
    };
  }

  if (!axesRaw) {
    usage(
      "--axes is required (@file.json or JSON)",
      "missing_axes",
      ENGINE_BACKTEST_SWEEP_USAGE[0]
    );
  }

  return {
    ...parseEngineBacktestRunArgs(rest),
    axesRaw,
    mode,
    searchMode,
    concurrency,
  };
}
