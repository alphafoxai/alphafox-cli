export type SubscriptionTier = "free" | "pro" | "pro_max";
export type DataQualityMode = "strict" | "basic";
export type PricePath = "ohlc_path_4" | "close_only";

export interface ExecutionModel {
  readonly pricePath: PricePath;
  readonly makerFeeRate: number;
  readonly takerFeeRate: number;
  readonly slippageRate: number;
}

export interface InclusiveUtcDateRange {
  readonly rangeStart: string;
  readonly rangeEnd: string;
  readonly fromMs: number;
  readonly toMs: number;
}

export interface EngineBacktestRunArgs {
  readonly help: boolean;
  readonly experimentId?: string;
  readonly createExperiment: boolean;
  readonly name?: string;
  readonly definitionId?: string;
  readonly definitionLabelZh?: string;
  readonly definitionLabelEn?: string;
  readonly configRaw?: string;
  readonly exchange?: string;
  readonly range?: InclusiveUtcDateRange;
  readonly initialEquity?: number;
  readonly tier: SubscriptionTier;
  readonly dataQualityMode: DataQualityMode;
  readonly configSchemaVersion?: number;
  readonly executionModelOverride?: Partial<ExecutionModel>;
  readonly persist: boolean;
}

export interface EngineBacktestSeriesRequirement {
  readonly symbol: string;
  readonly timeframe: string;
  readonly minWarmupCandles: number;
}

export interface EngineBacktestTapeSeriesRef {
  readonly symbol: string;
  readonly timeframe: string;
  readonly buffer: string;
  readonly rows: number;
}

export interface EngineBacktestTapeInput {
  readonly from: string;
  readonly to: string;
  readonly baseTimeframe: string;
  readonly markets: Readonly<Record<string, unknown>>;
  readonly series: readonly EngineBacktestTapeSeriesRef[];
  readonly fundingRates?: Readonly<Record<string, readonly unknown[]>>;
  readonly lowLiquiditySymbols?: readonly string[];
}

export interface EngineBacktestScenario {
  readonly version: 1;
  readonly runId: string;
  readonly trader: {
    readonly id?: string;
    readonly name?: string;
    readonly strategyDefinitionId: string;
    readonly configSchemaVersion: number;
    readonly subscriptionTier: SubscriptionTier;
    readonly config: unknown;
  };
  readonly exchange: {
    readonly positionSideDual: boolean;
    readonly initialEquity: number;
  };
  readonly executionModel: ExecutionModel;
  readonly tape: EngineBacktestTapeInput;
}

export interface EngineBacktestMetrics {
  readonly initialEquity: number;
  readonly finalEquity: number;
  readonly netPnl: number;
  readonly returnPct: number;
  readonly maxDrawdownPct: number;
  readonly sharpeRatio: number;
  readonly orderCount: number;
  readonly filledOrderCount: number;
  readonly canceledOrderCount: number;
  readonly tradeCount: number;
  readonly winningTrades: number;
  readonly losingTrades: number;
  readonly winRatePct: number;
  readonly feesPaid: number;
  readonly slippagePaid: number;
  readonly liquidated: boolean;
}

export interface EngineBacktestResult {
  readonly runId: string;
  readonly status: "completed" | "failed";
  readonly engineVersion?: string;
  readonly metrics: EngineBacktestMetrics;
  readonly equityCurve?: unknown[];
  readonly orders?: unknown[];
  readonly openPositions?: unknown[];
  readonly errors?: Array<{ code: string; message: string; path?: string }>;
  readonly warnings?: string[];
}

export interface EngineBacktestSupportReason {
  readonly code: string;
  readonly message: string;
}

export interface EngineSupportedBacktestPlan {
  readonly definitionId: string;
  readonly configSchemaVersion: number;
  readonly support: { readonly status: "supported" };
  readonly effectiveConfig: Record<string, unknown>;
  readonly universe: { readonly kind: "fixed"; readonly symbols: string[] };
  readonly symbols: string[];
  readonly timeframes: string[];
  readonly seriesRequirements: EngineBacktestSeriesRequirement[];
  readonly needsFunding: boolean;
  readonly auxiliaryDataRequirements: Array<{
    readonly kind: string;
    readonly parameters?: Record<string, unknown>;
  }>;
  readonly configFingerprint: string;
}

export interface EngineUnsupportedBacktestPlan {
  readonly definitionId: string;
  readonly configSchemaVersion: number;
  readonly support: {
    readonly status: "unsupported";
    readonly reason: EngineBacktestSupportReason;
  };
  readonly needsFunding: false;
}

export interface EngineBacktestFailure {
  readonly status: "failed";
  readonly errors: Array<{ readonly code: string; readonly message: string }>;
}

export type EngineBacktestPlan =
  | EngineSupportedBacktestPlan
  | EngineUnsupportedBacktestPlan;

export interface TapeLoadProgress {
  readonly stage: "markets" | "ohlcv" | "validation" | string;
  readonly detail: string;
  readonly fraction: number;
}

export interface TapeExchangeDefinition {
  readonly id: string;
  readonly label: string;
  readonly ccxtId: string;
  readonly marketType: string;
  readonly quoteAsset: string;
}

export interface TapeLoadResult {
  readonly tape: EngineBacktestTapeInput;
  readonly buffers: Record<string, ArrayBuffer>;
  readonly coverageWarnings: readonly string[];
}

export interface BacktestClientLike {
  init(): Promise<string>;
  version(): Promise<string>;
  strategyDefinitions(): Promise<{
    readonly engineVersion: string;
    readonly definitions: Array<
      Record<string, unknown> & {
        readonly id: string;
        readonly configSchemaVersion?: number;
      }
    >;
  }>;
  planBacktest(request: {
    readonly definitionId: string;
    readonly configSchemaVersion: number;
    readonly config: unknown;
  }): Promise<EngineBacktestPlan | EngineBacktestFailure>;
  runBacktest(
    scenario: EngineBacktestScenario,
    buffers: Record<string, ArrayBuffer>,
    onProgress?: (fraction: number) => void
  ): Promise<EngineBacktestResult>;
  terminate(): void;
}

export interface BacktestWasmModule {
  createNodeBacktestClient(options?: unknown): BacktestClientLike;
}

export interface BacktestRunnerModule {
  loadTape(
    request: {
      readonly exchangeId?: string;
      readonly exchange?: TapeExchangeDefinition;
      readonly symbols: readonly string[];
      readonly timeframes: readonly string[];
      readonly seriesRequirements?: readonly EngineBacktestSeriesRequirement[];
      readonly needsFunding?: boolean;
      readonly auxiliaryDataRequirements?: readonly unknown[];
      readonly fromMs: number;
      readonly toMs: number;
      readonly dataQualityMode?: DataQualityMode;
      readonly onProgress?: (progress: TapeLoadProgress) => void;
    },
    options?: unknown
  ): Promise<TapeLoadResult>;
  assembleScenario(input: {
    readonly runId: string;
    readonly definitionId: string;
    readonly configSchemaVersion: number;
    readonly config: unknown;
    readonly subscriptionTier: SubscriptionTier;
    readonly initialEquity: number;
    readonly tape?: EngineBacktestTapeInput;
    readonly executionModel?: Partial<ExecutionModel>;
  }): EngineBacktestScenario;
  resolveTapeExchange(
    exchangeId: string | TapeExchangeDefinition
  ): TapeExchangeDefinition;
  DEFAULT_EXECUTION_MODEL: ExecutionModel;
}

export interface PersistedSnapshot {
  readonly snapshotSchemaVersion: 1;
  readonly strategyDefinitionId: string;
  readonly configSchemaVersion: number;
  readonly config: unknown;
  readonly exchangeId: string;
  readonly rangeStart: string;
  readonly rangeEnd: string;
  readonly initialEquity: number;
  readonly subscriptionTier: SubscriptionTier;
  readonly dataQualityMode: DataQualityMode;
  readonly symbols: string[];
  readonly timeframes: string[];
  readonly baseTimeframe: string;
  readonly executionModel: ExecutionModel;
  readonly positionSideDual: boolean;
  readonly engineVersion: string;
}

export interface CreateRunRequestBody {
  readonly clientRunId: string;
  readonly snapshot: PersistedSnapshot;
  readonly metrics: EngineBacktestMetrics;
  readonly engineVersion: string;
  readonly configSchemaVersion: number;
}

export interface EngineBacktestRunSuccess {
  readonly metrics: EngineBacktestMetrics;
  readonly engineVersion: string;
  readonly experimentId: string;
  readonly runId?: string;
  readonly experimentUrl: string;
  readonly persisted: boolean;
  readonly coverageWarnings: readonly string[];
}
