export const TAPE_SERIES_COLUMNS: readonly string[];

export function encodeOhlcvColumns(
  rows: ReadonlyArray<readonly [number, number, number, number, number, number]>
): ArrayBuffer;

export const DEFAULT_EXECUTION_MODEL: {
  readonly pricePath: "ohlc_path_4";
  readonly makerFeeRate: 0.0002;
  readonly takerFeeRate: 0.0005;
  readonly slippageRate: 0.0001;
};

export type TapeQuoteAsset = "USDT" | "USDC";
export type TapeCcxtId =
  | "binanceusdm"
  | "okx"
  | "bybit"
  | "bitget"
  | "hyperliquid";
export type TapeExchangeId =
  | "binance_perp_usdt"
  | "okx_perp_usdt"
  | "bybit_perp_usdt"
  | "bitget_perp_usdt"
  | "hyperliquid_perp_usdc";

export interface TapeExchangeDefinition {
  readonly id: TapeExchangeId | string;
  readonly label: string;
  readonly ccxtId: TapeCcxtId | string;
  readonly marketType: "swap";
  readonly quoteAsset: TapeQuoteAsset;
}

export const TAPE_EXCHANGES: readonly TapeExchangeDefinition[];
export const PUBLIC_MARKET_EXCHANGE_BINANCE: "binance_perp_usdt";
export const PUBLIC_MARKET_EXCHANGE_OKX: "okx_perp_usdt";
export const PUBLIC_MARKET_EXCHANGE_BYBIT: "bybit_perp_usdt";
export const PUBLIC_MARKET_EXCHANGE_BITGET: "bitget_perp_usdt";
export const PUBLIC_MARKET_EXCHANGE_HYPERLIQUID: "hyperliquid_perp_usdc";
export const HYPERLIQUID_PUBLIC_MARKET_DEXES: readonly string[];

export function resolveTapeExchange(
  exchangeId: string | TapeExchangeDefinition
): TapeExchangeDefinition;

export interface TapeExchangeRuntimeConfig {
  readonly ohlcvPageLimit: number;
  readonly fundingPageLimit: number;
  readonly requestParams: Readonly<Record<string, unknown>>;
  readonly constructorOptions?: Readonly<Record<string, unknown>>;
  readonly unsupportedTimeframes?: readonly string[];
}

export function tapeExchangeRuntimeConfig(
  exchange: TapeExchangeDefinition
): TapeExchangeRuntimeConfig;

export const DEFAULT_TAPE_CACHE_DIR: string;
export const CACHE_KEY_VERSION: "closed-series-v2";
export const CACHE_MAX_AGE_MS: number;

export type CachedOhlcvRow = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
];

export interface CachedOhlcvRange {
  readonly sinceMs: number;
  readonly untilMs: number;
  readonly rows: CachedOhlcvRow[];
}

export interface OhlcvRangeSegment {
  readonly sinceMs: number;
  readonly untilMs: number;
}

export interface FileTapeCache {
  readonly disabled: boolean;
  readonly rootDir?: string;
  read(key: string): Promise<CachedOhlcvRange | null>;
  write(key: string, range: CachedOhlcvRange): Promise<void>;
}

export function ohlcvSeriesCacheKey(
  exchangeId: string,
  symbol: string,
  timeframe: string
): string;
export function missingCachedOhlcvRanges(
  cached: CachedOhlcvRange | null,
  sinceMs: number,
  untilMs: number
): OhlcvRangeSegment[];
export function mergeCachedOhlcvRanges(
  cached: CachedOhlcvRange | null,
  addition: CachedOhlcvRange
): CachedOhlcvRange;
export function createFileTapeCache(
  rootDir?: string,
  options?: { maxAgeMs?: number; nowMs?: number }
): FileTapeCache;
export function createDisabledTapeCache(): FileTapeCache;

export type TapeDataQualityMode = "strict" | "basic";
export const DEFAULT_TAPE_DATA_QUALITY_MODE: TapeDataQualityMode;
export type TapeDataIssueCode =
  | "market_missing"
  | "ohlcv_missing"
  | "invalid_ohlcv"
  | "non_monotonic"
  | "internal_gap"
  | "prefix_gap"
  | "suffix_gap"
  | "warmup_insufficient"
  | "load_failed"
  | "coverage_insufficient";

export interface TapeDataIssue {
  readonly code: TapeDataIssueCode;
  readonly symbol: string;
  readonly timeframe: string;
  readonly expected?: number;
  readonly actual?: number;
  readonly timestamp?: number;
  readonly message?: string;
}

export class TapeDataUnavailableError extends Error {
  readonly issues: readonly TapeDataIssue[];
  constructor(issues: readonly TapeDataIssue[]);
}

export function isTapeDataUnavailableError(
  value: unknown
): value is TapeDataUnavailableError;

export function summarizeTapeCoverageIssues(issues: readonly TapeDataIssue[]): {
  readonly prefix: TapeDataIssue[];
  readonly internal: TapeDataIssue[];
  readonly other: TapeDataIssue[];
};

export function formatCoverageSoftWarning(
  issues: readonly TapeDataIssue[],
  coverageRatio: number
): string;

export type EngineBacktestPrecisionMode = "DECIMAL_PLACES" | "TICK_SIZE";
export type EngineBacktestSubscriptionTier = "free" | "pro" | "pro_max";
export type EngineBacktestPricePath = "ohlc_path_4" | "close_only";

export interface EngineBacktestExecutionModel {
  readonly pricePath: EngineBacktestPricePath;
  readonly makerFeeRate: number;
  readonly takerFeeRate: number;
  readonly slippageRate: number;
}

export interface EngineBacktestTapeMarket {
  readonly id: string;
  readonly symbol: string;
  readonly base?: string;
  readonly quote?: string;
  readonly settle?: string;
  readonly contractSize: number;
  readonly linear: boolean;
  readonly precisionMode: EngineBacktestPrecisionMode;
  readonly precisionAmount?: number;
  readonly precisionPrice?: number;
  readonly amountMin?: number;
  readonly amountMax?: number;
  readonly priceMin?: number;
  readonly costMin?: number;
}

export interface EngineBacktestTapeSeriesRef {
  readonly symbol: string;
  readonly timeframe: string;
  readonly buffer: string;
  readonly rows: number;
}

export interface EngineBacktestFundingSample {
  readonly timestamp: number;
  readonly rate: number;
  readonly interval: string;
}

export interface EngineBacktestTapeInput {
  readonly from: string;
  readonly to: string;
  readonly baseTimeframe: string;
  readonly markets: Readonly<Record<string, EngineBacktestTapeMarket>>;
  readonly series: readonly EngineBacktestTapeSeriesRef[];
  readonly fundingRates?: Readonly<
    Record<string, readonly EngineBacktestFundingSample[]>
  >;
  readonly lowLiquiditySymbols?: readonly string[];
}

export interface EngineBacktestScenarioTrader {
  readonly id?: string;
  readonly name?: string;
  readonly strategyDefinitionId: string;
  readonly configSchemaVersion: number;
  readonly subscriptionTier: EngineBacktestSubscriptionTier;
  readonly config: unknown;
}

export interface EngineBacktestScenario {
  readonly version: 1;
  readonly runId: string;
  readonly trader: EngineBacktestScenarioTrader;
  readonly exchange: {
    readonly positionSideDual: boolean;
    readonly initialEquity: number;
  };
  readonly executionModel: EngineBacktestExecutionModel;
  readonly tape: EngineBacktestTapeInput;
}

export interface EngineBacktestSeriesRequirement {
  readonly symbol: string;
  readonly timeframe: string;
  readonly minWarmupCandles: number;
}

export interface EngineBacktestAuxiliaryDataRequirement {
  readonly kind: string;
  readonly parameters?: Record<string, unknown>;
}

export interface TapeLoadProgress {
  readonly stage: "markets" | "ohlcv" | "validation";
  readonly detail: string;
  readonly fraction: number;
}

export interface TapeMarketsSnapshot {
  readonly markets: Readonly<Record<string, TapeSymbolMarket>>;
  readonly precisionMode?: number;
  readonly nowMs?: number;
}

export interface TapeSymbolMarket {
  readonly id?: string;
  readonly symbol?: string;
  readonly created?: number;
  readonly base?: string;
  readonly quote?: string;
  readonly settle?: string;
  readonly active?: boolean;
  readonly type?: string;
  readonly swap?: boolean;
  readonly linear?: boolean;
  readonly inverse?: boolean;
  readonly contractSize?: number;
  readonly precision?: { readonly amount?: number; readonly price?: number };
  readonly limits?: {
    readonly amount?: { readonly min?: number; readonly max?: number };
    readonly price?: { readonly min?: number };
    readonly cost?: { readonly min?: number };
  };
}

export type TapeOhlcvFetcher = (
  symbol: string,
  timeframe: string,
  since?: number,
  limit?: number,
  params?: Record<string, unknown>
) => Promise<ReadonlyArray<readonly number[]>>;

export type TapeFundingFetcher = (
  symbol: string,
  since?: number,
  limit?: number,
  params?: Record<string, unknown>
) => Promise<ReadonlyArray<{ timestamp?: number; fundingRate?: number }>>;

export interface TapeLoadRequest {
  readonly exchangeId?: string;
  readonly exchange?: TapeExchangeDefinition;
  readonly symbols: readonly string[];
  readonly baseTimeframe?: string;
  readonly timeframes: readonly string[];
  readonly seriesRequirements?: readonly EngineBacktestSeriesRequirement[];
  readonly needsFunding?: boolean;
  readonly auxiliaryDataRequirements?: readonly EngineBacktestAuxiliaryDataRequirement[];
  readonly fromMs: number;
  readonly toMs: number;
  readonly dataQualityMode?: TapeDataQualityMode;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: TapeLoadProgress) => void;
  readonly nowMs?: number;
  readonly cacheDir?: string;
  readonly seriesConcurrency?: number;
  readonly ohlcvFetcher?: TapeOhlcvFetcher;
  readonly fundingFetcher?: TapeFundingFetcher;
  readonly marketsLoader?: () => Promise<TapeMarketsSnapshot>;
}

export interface TapeProxyOptions {
  readonly httpsProxy?: string;
  readonly httpProxy?: string;
  readonly agent?: unknown;
}

export interface TapeLoadOptions extends TapeProxyOptions {
  readonly cache?: FileTapeCache | false | "disable";
  readonly cacheDir?: string;
  /** Independent series fetches; default 4, hard cap 8. Pagination stays serial. */
  readonly seriesConcurrency?: number;
  readonly nowMs?: number;
  readonly onProgress?: (progress: TapeLoadProgress) => void;
  readonly createExchange?: (
    exchange: TapeExchangeDefinition,
    constructorOptions: Record<string, unknown>
  ) => Promise<TapeRuntimeExchange> | TapeRuntimeExchange;
}

export interface TapeRuntimeExchange {
  markets?: Readonly<Record<string, TapeSymbolMarket>>;
  precisionMode?: number;
  loadMarkets(): Promise<Readonly<Record<string, TapeSymbolMarket>>>;
  fetchTime(): Promise<number>;
  fetchOHLCV: TapeOhlcvFetcher;
  fetchFundingRateHistory?: TapeFundingFetcher;
}

export interface TapeChartSeries {
  readonly symbol: string;
  readonly timeframe: string;
  readonly rows: number;
  readonly buffer: ArrayBuffer;
}

export interface TapeLoadResult {
  readonly tape: EngineBacktestTapeInput;
  readonly buffers: Record<string, ArrayBuffer>;
  readonly coverageWarnings: readonly string[];
  readonly coverageIssues: readonly TapeDataIssue[];
  readonly chartData?: {
    readonly exchangeId: string;
    readonly series: readonly TapeChartSeries[];
  };
}

export const DEFAULT_TAPE_SERIES_CONCURRENCY: 4;
export const MAX_TAPE_SERIES_CONCURRENCY: 8;

export function resolveTapeSeriesConcurrency(value?: number): number;

export function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]>;

export function loadTape(
  request: TapeLoadRequest,
  options?: TapeLoadOptions
): Promise<TapeLoadResult>;

export interface AssembleScenarioInput {
  readonly runId: string;
  readonly definitionId: string;
  readonly configSchemaVersion: number;
  readonly config: unknown;
  readonly subscriptionTier: EngineBacktestSubscriptionTier;
  readonly initialEquity: number;
  readonly traderName?: string;
  readonly traderId?: string;
  readonly tape?: EngineBacktestTapeInput;
  readonly preparedTape?: { readonly tape: EngineBacktestTapeInput };
  readonly prepared?: { readonly tape: EngineBacktestTapeInput };
  readonly executionModel?: Partial<EngineBacktestExecutionModel>;
}

export function assembleScenario(
  input: AssembleScenarioInput
): EngineBacktestScenario;

export const TIMEFRAME_MS: Readonly<Record<string, number>>;
export const ENGINE_BACKTEST_BASE_TIMEFRAME: string;
export const ENGINE_BACKTEST_WARMUP_CANDLES: number;

export function resolvePlanBaseTimeframe(input: {
  readonly baseTimeframe?: string | null;
  readonly timeframes?: readonly string[] | null;
}): string;

export function abortable<T>(
  operation: Promise<T>,
  signal?: AbortSignal
): Promise<T>;

export function resolveCcxtProxyOptions(
  options?: TapeProxyOptions,
  env?: NodeJS.ProcessEnv
): { httpsProxy?: string; httpProxy?: string; agent?: unknown };

export function buildCcxtConstructorOptions(
  exchange: TapeExchangeDefinition,
  options?: TapeProxyOptions & { runtimeConfig?: TapeExchangeRuntimeConfig }
): Record<string, unknown>;

export function isClosedCandle(
  timestampMs: number,
  timeframe: string,
  toMs: number
): boolean;

export function ohlcvSeriesStartMs(
  fromMs: number,
  timeframe: string,
  market?: Pick<TapeSymbolMarket, "created">
): number;

export function effectiveTapeEndMs(
  requestedToMs: number,
  nowMs?: number,
  baseTimeframe?: string
): number;

export function inferFundingIntervals(
  samples: readonly Omit<EngineBacktestFundingSample, "interval">[]
): EngineBacktestFundingSample[];

export function classifyTapeSymbolsForPreflight(
  symbols: readonly string[],
  markets: Readonly<Record<string, TapeSymbolMarket>>,
  quoteAsset: TapeQuoteAsset
): {
  readonly availableSymbols: readonly string[];
  readonly missingSymbols: readonly string[];
};

export function resolveEngineBacktestPrecisionMode(
  precisionMode: number | undefined,
  exchangeLabel: string
): EngineBacktestPrecisionMode;

export function resolveTapeCache(options?: TapeLoadOptions): FileTapeCache;
