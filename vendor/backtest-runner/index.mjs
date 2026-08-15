export { TAPE_SERIES_COLUMNS, encodeOhlcvColumns } from "./lib/encode.mjs";
export {
  DEFAULT_EXECUTION_MODEL,
  assembleScenario,
} from "./lib/scenario.mjs";
export {
  TAPE_EXCHANGES,
  PUBLIC_MARKET_EXCHANGE_BINANCE,
  PUBLIC_MARKET_EXCHANGE_OKX,
  PUBLIC_MARKET_EXCHANGE_BYBIT,
  PUBLIC_MARKET_EXCHANGE_BITGET,
  PUBLIC_MARKET_EXCHANGE_HYPERLIQUID,
  HYPERLIQUID_PUBLIC_MARKET_DEXES,
  resolveTapeExchange,
  tapeExchangeRuntimeConfig,
} from "./lib/exchanges.mjs";
export {
  DEFAULT_TAPE_CACHE_DIR,
  CACHE_KEY_VERSION,
  CACHE_MAX_AGE_MS,
  ohlcvSeriesCacheKey,
  missingCachedOhlcvRanges,
  mergeCachedOhlcvRanges,
  createFileTapeCache,
  createDisabledTapeCache,
} from "./lib/cache.mjs";
export {
  TapeDataUnavailableError,
  isTapeDataUnavailableError,
  evaluateOhlcvCoverage,
  analyzeOhlcvCoverage,
} from "./lib/coverage.mjs";
export {
  TIMEFRAME_MS,
  ENGINE_BACKTEST_BASE_TIMEFRAME,
  ENGINE_BACKTEST_WARMUP_CANDLES,
  resolvePlanBaseTimeframe,
} from "./lib/timeframes.mjs";
export {
  abortable,
} from "./lib/abortable.mjs";
export {
  resolveCcxtProxyOptions,
  buildCcxtConstructorOptions,
} from "./lib/proxy.mjs";
export {
  isClosedCandle,
  ohlcvSeriesStartMs,
  fetchClosedOhlcvRange,
  loadSeriesWithCache,
} from "./lib/series.mjs";
export {
  loadTape,
  resolveTapeCache,
  effectiveTapeEndMs,
  inferFundingIntervals,
  classifyTapeSymbolsForPreflight,
  resolveEngineBacktestPrecisionMode,
} from "./lib/tape-loader.mjs";
