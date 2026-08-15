import type { ProfileName } from "../config/profiles";
import { EngineBacktestError } from "./errors";
import type {
  CreateRunRequestBody,
  DataQualityMode,
  EngineBacktestMetrics,
  EngineBacktestScenario,
  ExecutionModel,
  PersistedSnapshot,
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

  return {
    clientRunId: input.clientRunId,
    snapshot,
    metrics: input.metrics,
    engineVersion,
    configSchemaVersion: snapshot.configSchemaVersion,
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
