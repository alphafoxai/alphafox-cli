import type { ProfileName } from "../config/profiles";
import { EngineBacktestError } from "./errors";
import { compressEngineBacktestReturnCurve } from "./return-curve";
import type {
  CreateRunRequestBody,
  CreateSweepPointSummary,
  CreateSweepRequestBody,
  DataQualityMode,
  EngineBacktestMetrics,
  EngineBacktestScenario,
  EngineBacktestSweepPointRow,
  ExecutionModel,
  PersistedSnapshot,
  SweepMode,
  SweepSearchMode,
} from "./types";

/** Aligned with `@alphafoxai/backtest-runner` DEFAULT_EXECUTION_MODEL. */
export const DEFAULT_EXECUTION_MODEL: ExecutionModel = {
  pricePath: "ohlc_path_4",
  makerFeeRate: 0.0002,
  takerFeeRate: 0.0005,
  slippageRate: 0.0001,
};

export const SNAPSHOT_SCHEMA_VERSION = 1 as const;

/**
 * Web persist uses tape.to as an exclusive end, then subtracts 1ms and
 * slices to YYYY-MM-DD so an inclusive calendar last-day is recovered.
 */
export function exclusiveTapeEndToRangeEnd(tapeTo: string): string {
  const exclusiveEndMs = Date.parse(tapeTo);
  if (!Number.isFinite(exclusiveEndMs)) {
    throw new EngineBacktestError({
      type: "usage",
      subtype: "invalid_tape_end",
      message: `Cannot derive rangeEnd from tape.to "${tapeTo}"`,
      status: 400,
    });
  }
  return new Date(exclusiveEndMs - 1).toISOString().slice(0, 10);
}

export function uniqueSeriesField(
  series: readonly { readonly symbol: string; readonly timeframe: string }[],
  field: "symbol" | "timeframe"
): string[] {
  return [...new Set(series.map((item) => item[field]))];
}

/**
 * Build POST .../runs body from a completed WASM run.
 * Field set matches web `buildCreateRunRequestFromCompleted`.
 */
export function buildCreateRunRequest(input: {
  readonly clientRunId: string;
  readonly scenario: EngineBacktestScenario;
  readonly metrics: EngineBacktestMetrics;
  readonly exchangeId: string;
  readonly dataQualityMode: DataQualityMode;
  readonly engineVersion: string;
  readonly equityCurve?: unknown;
}): CreateRunRequestBody {
  const { scenario } = input;
  const rangeStart = scenario.tape.from.slice(0, 10);
  const rangeEnd = exclusiveTapeEndToRangeEnd(scenario.tape.to);
  const symbols = uniqueSeriesField(scenario.tape.series, "symbol");
  if (symbols.length === 0) {
    throw new EngineBacktestError({
      type: "runtime",
      subtype: "persist_no_symbols",
      message: "Completed run has no symbols to persist.",
    });
  }
  const timeframes = uniqueSeriesField(scenario.tape.series, "timeframe");
  const engineVersion = input.engineVersion.trim() || "node-wasm";
  const snapshot: PersistedSnapshot = {
    snapshotSchemaVersion: SNAPSHOT_SCHEMA_VERSION,
    strategyDefinitionId: scenario.trader.strategyDefinitionId,
    configSchemaVersion: scenario.trader.configSchemaVersion,
    config: scenario.trader.config,
    exchangeId: input.exchangeId.trim() || "binance",
    rangeStart,
    rangeEnd,
    initialEquity: scenario.exchange.initialEquity,
    subscriptionTier: scenario.trader.subscriptionTier,
    dataQualityMode: input.dataQualityMode,
    symbols,
    timeframes: timeframes.length > 0 ? timeframes : ["1m"],
    baseTimeframe: scenario.tape.baseTimeframe || "1m",
    executionModel: scenario.executionModel ?? DEFAULT_EXECUTION_MODEL,
    positionSideDual: scenario.exchange.positionSideDual,
    engineVersion,
  };

  const returnCurve = compressEngineBacktestReturnCurve({
    initialEquity: snapshot.initialEquity,
    equityCurve: input.equityCurve,
  });

  return {
    clientRunId: input.clientRunId,
    snapshot,
    metrics: input.metrics,
    engineVersion,
    configSchemaVersion: snapshot.configSchemaVersion,
    ...(returnCurve ? { returnCurve } : {}),
  };
}

/**
 * Experiment detail URL. Locale prefix (`/zh`, `/en`) is optional — web
 * `[locale]/dashboard/traders/backtest/[experimentId]` also serves the
 * unprefixed `/dashboard/traders/backtest/{id}` path.
 */
export function experimentPageUrl(
  profile: ProfileName,
  experimentId: string
): string {
  const path = `/dashboard/traders/backtest/${encodeURIComponent(experimentId)}`;
  if (profile === "staging") {
    return `https://staging.alphafox.app${path}`;
  }
  if (profile === "local") {
    return `http://127.0.0.1:3000${path}`;
  }
  return `https://alphafox.app${path}`;
}

/** Web experiment workspace opens the Sweep tab with `?tab=sweep`. */
export function experimentSweepPageUrl(
  profile: ProfileName,
  experimentId: string
): string {
  return `${experimentPageUrl(profile, experimentId)}?tab=sweep`;
}

export const ENGINE_BACKTEST_SWEEP_MAX_UTF8_BYTES = 4 * 1024 * 1024;
export const ENGINE_BACKTEST_SWEEP_ERROR_MAX_UTF8_BYTES = 4 * 1024;

const CLIENT_SWEEP_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function shouldPersistSweepCompletion(input: {
  readonly completed: boolean;
  readonly cancelled: boolean;
}): boolean {
  return input.completed && !input.cancelled;
}

export function mintClientSweepId(
  randomUuid: () => string = () =>
    globalThis.crypto.randomUUID()
): string {
  const allocated = randomUuid();
  if (!CLIENT_SWEEP_ID_RE.test(allocated)) {
    throw new EngineBacktestError({
      type: "runtime",
      subtype: "invalid_client_sweep_id",
      message: "clientSweepId must be a UUID.",
    });
  }
  return allocated;
}

export function sweepsPath(experimentId: string): string {
  return `/api/v1/engine-backtest/experiments/${encodeURIComponent(experimentId)}/sweeps`;
}

export function buildSweepBaseSnapshot(input: {
  readonly definitionId: string;
  readonly configSchemaVersion: number;
  readonly config: unknown;
  readonly exchangeId: string;
  readonly rangeStart: string;
  readonly rangeEnd: string;
  readonly initialEquity: number;
  readonly subscriptionTier: PersistedSnapshot["subscriptionTier"];
  readonly dataQualityMode: DataQualityMode;
  readonly symbols: readonly string[];
  readonly timeframes: readonly string[];
  readonly baseTimeframe: string;
  readonly executionModel: ExecutionModel;
  readonly positionSideDual: boolean;
  readonly engineVersion: string;
}): PersistedSnapshot {
  const symbols = [...new Set(input.symbols.map((item) => item.trim()).filter(Boolean))];
  if (symbols.length === 0) {
    throw new EngineBacktestError({
      type: "runtime",
      subtype: "persist_no_symbols",
      message: "Completed sweep has no symbols to persist.",
    });
  }
  const timeframes = [
    ...new Set(input.timeframes.map((item) => item.trim()).filter(Boolean)),
  ];
  return {
    snapshotSchemaVersion: SNAPSHOT_SCHEMA_VERSION,
    strategyDefinitionId: input.definitionId,
    configSchemaVersion: input.configSchemaVersion,
    config: input.config,
    exchangeId: input.exchangeId.trim() || "binance",
    rangeStart: input.rangeStart,
    rangeEnd: input.rangeEnd,
    initialEquity: input.initialEquity,
    subscriptionTier: input.subscriptionTier,
    dataQualityMode: input.dataQualityMode,
    symbols,
    timeframes: timeframes.length > 0 ? timeframes : ["1m"],
    baseTimeframe: input.baseTimeframe.trim() || "1m",
    executionModel: input.executionModel,
    positionSideDual: input.positionSideDual,
    engineVersion: input.engineVersion.trim() || "node-wasm",
  };
}

/**
 * Build POST .../sweeps body from a completed local search.
 * Field set matches web `buildCreateSweepRequestFromCompleted`.
 */
export function buildCreateSweepRequest(input: {
  readonly clientSweepId: string;
  readonly snapshot: PersistedSnapshot;
  readonly axes: ReadonlyArray<{
    readonly path: readonly string[];
    readonly current: number;
    readonly values: readonly number[];
  }>;
  readonly mode: SweepMode;
  readonly searchMode: SweepSearchMode;
  readonly concurrency: number;
  readonly requestedCombinationCount: number;
  readonly sampled: boolean;
  readonly points: readonly EngineBacktestSweepPointRow[];
  readonly successfulCount: number;
  readonly failedCount: number;
  readonly liquidatedCount: number;
  readonly elapsedMs: number;
  readonly best: {
    readonly coordinate: { readonly values: readonly number[] };
    readonly returnPct: number;
  } | null;
  readonly engineVersion: string;
}): CreateSweepRequestBody {
  const clientSweepId = mintClientSweepId(() => input.clientSweepId);
  const axes = input.axes.map((axis, axisIndex) => ({
    path: [...axis.path],
    current: axis.current,
    values: uniqueFiniteNumbers(
      input.points.map((point) => point.coordinate.values[axisIndex]),
      axis.current
    ),
  }));
  const pointSummaries = input.points.map((point) => toPointSummary(point));
  const body: CreateSweepRequestBody = {
    clientSweepId,
    baseInputSnapshot: input.snapshot,
    axes,
    searchMetadata: {
      mode: input.mode,
      searchMode: input.searchMode,
      concurrency: input.concurrency,
      requestedCombinationCount: input.requestedCombinationCount,
      sampled: input.sampled,
    },
    aggregateSummary: {
      successfulCount: input.successfulCount,
      failedCount: input.failedCount,
      liquidatedCount: input.liquidatedCount,
      elapsedMs: Math.max(0, Math.round(input.elapsedMs)),
      best: input.best
        ? {
            coordinate: { values: [...input.best.coordinate.values] },
            returnPct: input.best.returnPct,
          }
        : null,
    },
    pointSummaries,
    engineVersion: input.engineVersion.trim() || input.snapshot.engineVersion,
    configSchemaVersion: input.snapshot.configSchemaVersion,
  };
  assertSweepCreateRequestSize(body);
  return body;
}

function toPointSummary(
  row: EngineBacktestSweepPointRow
): CreateSweepPointSummary {
  const coordinate = { values: [...row.coordinate.values] };
  if (row.status === "ok" && row.metrics) {
    return {
      coordinate,
      status: "ok",
      metrics: {
        returnPct: row.metrics.returnPct,
        maxDrawdownPct: row.metrics.maxDrawdownPct,
        sharpeRatio: row.metrics.sharpeRatio,
        winRatePct: row.metrics.winRatePct,
        liquidationCount: row.metrics.liquidationCount,
        netPnl: row.metrics.netPnl,
        finalEquity: row.metrics.finalEquity,
        tradeCount: row.metrics.tradeCount,
        ...(typeof row.metrics.maxLeverage === "number" &&
        Number.isFinite(row.metrics.maxLeverage)
          ? { maxLeverage: row.metrics.maxLeverage }
          : {}),
      },
    };
  }
  return {
    coordinate,
    status: "failed",
    error: truncateUtf8(
      row.error?.trim() || "Point failed",
      ENGINE_BACKTEST_SWEEP_ERROR_MAX_UTF8_BYTES
    ),
  };
}

function uniqueFiniteNumbers(
  values: readonly (number | undefined)[],
  fallback: number
): number[] {
  const unique = new Set<number>();
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      unique.add(value);
    }
  }
  if (unique.size === 0) {
    unique.add(fallback);
  }
  return [...unique].sort((left, right) => left - right);
}

function truncateUtf8(value: string, maxBytes: number): string {
  const bytes = new TextEncoder().encode(value);
  if (bytes.length <= maxBytes) {
    return value;
  }
  return new TextDecoder("utf-8", { fatal: false })
    .decode(bytes.slice(0, maxBytes))
    .replace(/\uFFFD$/u, "");
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

export function assertSweepCreateRequestSize(body: CreateSweepRequestBody): void {
  let serialized: string;
  try {
    serialized = JSON.stringify(body);
  } catch {
    throw new EngineBacktestError({
      type: "usage",
      subtype: "sweep_invalid",
      message: "Sweep create request is not JSON-serializable.",
      status: 400,
    });
  }
  if (utf8ByteLength(serialized) > ENGINE_BACKTEST_SWEEP_MAX_UTF8_BYTES) {
    throw new EngineBacktestError({
      type: "usage",
      subtype: "sweep_too_large",
      message: `Sweep create request exceeds ${ENGINE_BACKTEST_SWEEP_MAX_UTF8_BYTES} UTF-8 bytes.`,
      status: 400,
    });
  }
  for (const [index, point] of body.pointSummaries.entries()) {
    if (
      point.error !== undefined &&
      utf8ByteLength(point.error) > ENGINE_BACKTEST_SWEEP_ERROR_MAX_UTF8_BYTES
    ) {
      throw new EngineBacktestError({
        type: "usage",
        subtype: "sweep_too_large",
        message: `Sweep point error text at index ${index} exceeds ${ENGINE_BACKTEST_SWEEP_ERROR_MAX_UTF8_BYTES} UTF-8 bytes.`,
        status: 400,
      });
    }
  }
}
