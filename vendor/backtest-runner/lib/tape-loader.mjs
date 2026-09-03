import { abortable } from "./abortable.mjs";
import {
  createDisabledTapeCache,
  createFileTapeCache,
  DEFAULT_TAPE_CACHE_DIR,
} from "./cache.mjs";
import {
  DEFAULT_TAPE_DATA_QUALITY_MODE,
  formatCoverageSoftWarning,
  isTapeDataUnavailableError,
  TapeDataUnavailableError,
} from "./coverage.mjs";
import { encodeOhlcvColumns } from "./encode.mjs";
import {
  resolveTapeExchange,
  tapeExchangeRuntimeConfig,
} from "./exchanges.mjs";
import {
  buildCcxtConstructorOptions,
  ccxtExchangeClientCacheKey,
} from "./proxy.mjs";
import { loadSeriesWithCache } from "./series.mjs";
import {
  limitTapeOhlcvConcurrency,
  mapWithConcurrency,
  resolveTapeSeriesConcurrency,
} from "./tape-loader-concurrency.mjs";
import {
  ENGINE_BACKTEST_BASE_TIMEFRAME,
  TIMEFRAME_MS,
  baseTimeframeStepMs,
  resolvePlanBaseTimeframe,
} from "./timeframes.mjs";

const DAY_MS = 86_400_000;
const MARKETS_PROGRESS_END = 0.05;
const OHLCV_PROGRESS_END = 0.95;
const FUNDING_INTERVAL_TOLERANCE_MS = 5 * 60_000;
const CCXT_PRECISION_MODE_DECIMAL_PLACES = 2;
const CCXT_PRECISION_MODE_SIGNIFICANT_DIGITS = 3;
const CCXT_PRECISION_MODE_TICK_SIZE = 4;
const FUNDING_INTERVALS = [
  { interval: "1h", spacingMs: 3_600_000 },
  { interval: "2h", spacingMs: 7_200_000 },
  { interval: "4h", spacingMs: 14_400_000 },
  { interval: "8h", spacingMs: 28_800_000 },
];

const exchangePromises = new Map();

export function effectiveTapeEndMs(
  requestedToMs,
  nowMs = Date.now(),
  baseTimeframe = ENGINE_BACKTEST_BASE_TIMEFRAME
) {
  const baseStepMs = baseTimeframeStepMs(baseTimeframe);
  return Math.min(requestedToMs, Math.floor(nowMs / baseStepMs) * baseStepMs);
}

export function resolveEngineBacktestPrecisionMode(precisionMode, exchangeLabel) {
  if (precisionMode === CCXT_PRECISION_MODE_DECIMAL_PLACES) {
    return "DECIMAL_PLACES";
  }
  if (precisionMode === CCXT_PRECISION_MODE_TICK_SIZE) {
    return "TICK_SIZE";
  }
  const modeLabel =
    precisionMode === CCXT_PRECISION_MODE_SIGNIFICANT_DIGITS
      ? "SIGNIFICANT_DIGITS"
      : String(precisionMode);
  throw new Error(
    `${exchangeLabel} 使用不支持的 CCXT precisionMode：${modeLabel}`
  );
}

export function classifyTapeSymbolsForPreflight(symbols, markets, quoteAsset) {
  const availableSymbols = [];
  const missingSymbols = [];
  for (const symbol of new Set(symbols)) {
    if (isLinearSwapMarket(markets[symbol], quoteAsset)) {
      availableSymbols.push(symbol);
    } else {
      missingSymbols.push(symbol);
    }
  }
  return { availableSymbols, missingSymbols };
}

export function inferFundingIntervals(samples) {
  if (samples.length < 2) {
    return samples.map((sample) => ({ ...sample, interval: "8h" }));
  }

  return samples.map((sample, index) => {
    const nextSample = samples[index + 1];
    const previousSample = samples[index - 1];
    const spacingMs = nextSample
      ? nextSample.timestamp - sample.timestamp
      : previousSample
        ? sample.timestamp - previousSample.timestamp
        : Number.NaN;
    return {
      ...sample,
      interval: fundingIntervalFromSpacing(spacingMs),
    };
  });
}

export function resolveTapeCache(options = {}) {
  if (
    options.cache === false ||
    options.cache === "disable" ||
    options.cache?.disabled === true
  ) {
    return createDisabledTapeCache();
  }
  if (options.cache && typeof options.cache.read === "function") {
    return options.cache;
  }
  if (options.cacheDir) {
    return createFileTapeCache(options.cacheDir);
  }
  return createFileTapeCache(DEFAULT_TAPE_CACHE_DIR);
}

/**
 * Load a closed-candle tape and columnar buffers.
 * Inject `ohlcvFetcher` / `fundingFetcher` / `marketsLoader` to avoid ccxt.
 *
 * @param {import("../index.d.ts").TapeLoadRequest} request
 * @param {import("../index.d.ts").TapeLoadOptions} [options]
 */
export async function loadTape(request, options = {}) {
  request.signal?.throwIfAborted();
  if (!request || request.symbols?.length === 0) {
    throw new Error("回测至少需要一个 symbol");
  }
  if (request.toMs <= request.fromMs) {
    throw new Error("回测区间结束时间必须晚于开始时间");
  }
  if ((request.auxiliaryDataRequirements?.length ?? 0) > 0) {
    throw new Error(
      `Unsupported backtest auxiliary data requirements: ${request.auxiliaryDataRequirements
        .map((requirement) => requirement.kind)
        .join(", ")}`
    );
  }

  const exchangeDefinition = resolveRequestExchange(request);
  const onProgress = request.onProgress ?? options.onProgress;
  const cache = resolveTapeCache({
    ...options,
    cacheDir: options.cacheDir ?? request.cacheDir,
  });
  const seriesConcurrency = resolveTapeSeriesConcurrency(
    options.seriesConcurrency ?? request.seriesConcurrency
  );
  const dataQualityMode =
    request.dataQualityMode ?? DEFAULT_TAPE_DATA_QUALITY_MODE;
  const baseTimeframe = resolvePlanBaseTimeframe({
    baseTimeframe: request.baseTimeframe,
    timeframes: [
      ...request.timeframes,
      ...(request.seriesRequirements ?? []).map(
        (requirement) => requirement.timeframe
      ),
    ],
  });
  const runtimeConfig = tapeExchangeRuntimeConfig(exchangeDefinition);
  const timeframes = normalizeTimeframes(
    [
      ...request.timeframes,
      ...(request.seriesRequirements ?? []).map(
        (requirement) => requirement.timeframe
      ),
    ],
    baseTimeframe,
    runtimeConfig,
    exchangeDefinition.label
  );
  const requirementWarmups = new Map(
    (request.seriesRequirements ?? []).map((requirement) => [
      `${requirement.symbol}\u0000${requirement.timeframe}`,
      requirement.minWarmupCandles,
    ])
  );

  onProgress?.({
    stage: "markets",
    detail: `加载 ${exchangeDefinition.label} 市场元数据`,
    fraction: 0,
  });

  const injected = usesInjectedRuntime(request);
  if (injected) {
    assertInjectedRuntime(request);
  }

  const exchange = injected
    ? createInjectedExchange(request)
    : await abortable(
        getTapeExchange(exchangeDefinition, options),
        request.signal
      );
  const marketsSnapshot = await abortable(
    exchange.loadMarkets(),
    request.signal
  );
  const precisionMode = resolveEngineBacktestPrecisionMode(
    exchange.precisionMode,
    exchangeDefinition.label
  );
  const exchangeNowMs =
    request.nowMs ??
    options.nowMs ??
    (await abortable(exchange.fetchTime(), request.signal));
  const tapeToMs = effectiveTapeEndMs(
    request.toMs,
    exchangeNowMs,
    baseTimeframe
  );
  const cacheUntilMs = Math.min(
    tapeToMs,
    Math.floor(exchangeNowMs / DAY_MS) * DAY_MS
  );
  if (tapeToMs <= request.fromMs) {
    throw new Error("回测区间内还没有已收盘的 K 线");
  }
  request.signal?.throwIfAborted();

  const markets = {};
  for (const symbol of request.symbols) {
    markets[symbol] = tapeMarketFromCcxt(
      symbol,
      exchange.markets?.[symbol] ?? marketsSnapshot?.[symbol],
      exchangeDefinition.label,
      precisionMode,
      exchangeDefinition.quoteAsset
    );
  }
  onProgress?.({
    stage: "markets",
    detail: `${exchangeDefinition.label} 市场元数据已加载`,
    fraction: MARKETS_PROGRESS_END,
  });

  const buffers = {};
  const chartSeries = [];
  const series = [];
  const seriesJobs = request.symbols.flatMap((symbol) =>
    timeframes.map((timeframe) => ({ symbol, timeframe }))
  );
  const totalSeries = seriesJobs.length;
  const dataIssues = [];
  const coverageWarnings = [];
  const coverageIssues = [];
  const ohlcvExchange = limitTapeOhlcvConcurrency(
    exchange,
    seriesConcurrency,
    request.signal
  );
  const seriesFractions = new Array(totalSeries).fill(0);
  let lastOhlcvDetail = "";
  const reportOhlcv = (index, fraction, detail) => {
    seriesFractions[index] = fraction;
    lastOhlcvDetail = detail;
    const completed =
      seriesFractions.reduce((sum, value) => sum + value, 0) / totalSeries;
    onProgress?.({
      stage: "ohlcv",
      detail: lastOhlcvDetail,
      fraction:
        MARKETS_PROGRESS_END +
        (OHLCV_PROGRESS_END - MARKETS_PROGRESS_END) * completed,
    });
  };
  const loadedSeries = await mapWithConcurrency(
    seriesJobs,
    seriesConcurrency,
    async (job, index) => {
      request.signal?.throwIfAborted();
      const { symbol, timeframe } = job;
      const detail = `${symbol} ${timeframe}`;
      try {
        const loaded = await loadSeriesWithCache(
          ohlcvExchange,
          exchangeDefinition,
          runtimeConfig,
          symbol,
          timeframe,
          exchange.markets?.[symbol] ?? marketsSnapshot?.[symbol],
          request.fromMs,
          tapeToMs,
          requirementWarmups.get(`${symbol}\u0000${timeframe}`) ?? 0,
          timeframe === baseTimeframe,
          dataQualityMode,
          (fraction) => reportOhlcv(index, fraction, detail),
          cacheUntilMs,
          cache,
          request.signal
        );
        reportOhlcv(index, 1, detail);
        return { ok: true, job, loaded };
      } catch (error) {
        request.signal?.throwIfAborted();
        reportOhlcv(index, 1, detail);
        return {
          ok: false,
          issues: toTapeDataIssues(error, symbol, timeframe),
        };
      }
    }
  );
  let bufferSequence = 0;
  for (const result of loadedSeries) {
    if (!result.ok) {
      dataIssues.push(...result.issues);
      continue;
    }
    if (result.loaded.softIssues.length > 0) {
      coverageIssues.push(...result.loaded.softIssues);
      coverageWarnings.push(
        formatCoverageSoftWarning(
          result.loaded.softIssues,
          result.loaded.coverageRatio
        )
      );
    }
    const { symbol, timeframe } = result.job;
    const { rows } = result.loaded;
    const bufferKey = `k${bufferSequence++}`;
    const buffer = encodeOhlcvColumns(rows);
    buffers[bufferKey] = buffer;
    if (timeframe === baseTimeframe) {
      chartSeries.push({
        symbol,
        timeframe: baseTimeframe,
        rows: rows.length,
        buffer: buffer.slice(0),
      });
    }
    series.push({ symbol, timeframe, buffer: bufferKey, rows: rows.length });
  }
  if (dataIssues.length > 0) {
    throw new TapeDataUnavailableError(dataIssues);
  }

  let fundingRates;
  if (request.needsFunding) {
    const fundingEntries = await mapWithConcurrency(
      request.symbols,
      seriesConcurrency,
      async (symbol) => {
        request.signal?.throwIfAborted();
        const samples = await loadFundingHistory(
          exchange,
          exchangeDefinition,
          runtimeConfig,
          symbol,
          request.fromMs,
          tapeToMs,
          request.signal
        );
        return [symbol, samples];
      }
    );
    fundingRates = Object.fromEntries(fundingEntries);
  }
  request.signal?.throwIfAborted();
  onProgress?.({
    stage: "validation",
    detail: "行情数据校验完成",
    fraction: 1,
  });

  return {
    tape: {
      from: new Date(request.fromMs).toISOString(),
      to: new Date(tapeToMs).toISOString(),
      baseTimeframe,
      markets,
      series,
      ...(fundingRates ? { fundingRates } : {}),
      lowLiquiditySymbols: [],
    },
    buffers,
    coverageWarnings,
    coverageIssues,
    chartData: {
      exchangeId: exchangeDefinition.id,
      series: chartSeries,
    },
  };
}

function resolveRequestExchange(request) {
  if (request.exchange) {
    return resolveTapeExchange(request.exchange);
  }
  return resolveTapeExchange(request.exchangeId);
}

function usesInjectedRuntime(request) {
  return Boolean(
    request.ohlcvFetcher || request.fundingFetcher || request.marketsLoader
  );
}

function assertInjectedRuntime(request) {
  if (!request.marketsLoader) {
    throw new Error(
      "loadTape requires marketsLoader when using injected fetchers (refusing to construct a live ccxt client)"
    );
  }
  if (!request.ohlcvFetcher) {
    throw new Error(
      "loadTape requires ohlcvFetcher when using injected fetchers (refusing to construct a live ccxt client)"
    );
  }
  if (request.needsFunding && !request.fundingFetcher) {
    throw new Error(
      "loadTape requires fundingFetcher when needsFunding is set with injected fetchers"
    );
  }
}

function createInjectedExchange(request) {
  let markets = {};
  let precisionMode = CCXT_PRECISION_MODE_DECIMAL_PLACES;
  let nowMs;
  return {
    get markets() {
      return markets;
    },
    get precisionMode() {
      return precisionMode;
    },
    async loadMarkets() {
      const snapshot = await request.marketsLoader();
      if (!snapshot || typeof snapshot !== "object" || !snapshot.markets) {
        throw new Error("marketsLoader must return { markets }");
      }
      markets = snapshot.markets;
      if (snapshot.precisionMode !== undefined) {
        precisionMode = snapshot.precisionMode;
      }
      if (snapshot.nowMs !== undefined) {
        nowMs = snapshot.nowMs;
      }
      return markets;
    },
    async fetchTime() {
      return nowMs ?? Date.now();
    },
    async fetchOHLCV(symbol, timeframe, since, limit, params) {
      return request.ohlcvFetcher(symbol, timeframe, since, limit, params);
    },
    async fetchFundingRateHistory(symbol, since, limit, params) {
      if (!request.fundingFetcher) {
        throw new Error("fundingFetcher is required when needsFunding is set");
      }
      return request.fundingFetcher(symbol, since, limit, params);
    },
  };
}

async function getTapeExchange(exchangeDefinition, options) {
  const runtimeConfig = tapeExchangeRuntimeConfig(exchangeDefinition);
  const constructorOptions = buildCcxtConstructorOptions(exchangeDefinition, {
    ...options,
    runtimeConfig,
  });
  if (typeof options.createExchange === "function") {
    const exchange = await options.createExchange(
      exchangeDefinition,
      constructorOptions
    );
    await exchange.loadMarkets();
    return exchange;
  }

  const cacheKey = ccxtExchangeClientCacheKey(exchangeDefinition.id, options);
  const cached = exchangePromises.get(cacheKey);
  if (cached) {
    return cached;
  }

  const pending = (async () => {

    const ccxtModule = await import("ccxt");
    const namespace = (ccxtModule.default ?? ccxtModule);
    const ExchangeCtor = namespace[exchangeDefinition.ccxtId];
    if (typeof ExchangeCtor !== "function") {
      throw new Error(`ccxt 不包含 ${exchangeDefinition.ccxtId} 交易所实现`);
    }
    const exchange = new ExchangeCtor(constructorOptions);
    await exchange.loadMarkets();
    return exchange;
  })().catch((error) => {
    if (exchangePromises.get(cacheKey) === pending) {
      exchangePromises.delete(cacheKey);
    }
    throw error;
  });
  exchangePromises.set(cacheKey, pending);
  return pending;
}

function normalizeTimeframes(
  timeframes,
  baseTimeframe,
  runtimeConfig,
  exchangeLabel
) {
  const set = new Set([baseTimeframe, ...timeframes]);
  const unsupported = new Set(runtimeConfig.unsupportedTimeframes ?? []);
  for (const timeframe of set) {
    if (!TIMEFRAME_MS[timeframe]) {
      throw new Error(`不支持的 timeframe：${timeframe}`);
    }
    if (unsupported.has(timeframe)) {
      throw new Error(
        `${exchangeLabel} 数据源不提供 ${timeframe} K 线，无法回测该周期的策略`
      );
    }
  }
  return [...set].sort(
    (left, right) => (TIMEFRAME_MS[left] ?? 0) - (TIMEFRAME_MS[right] ?? 0)
  );
}

function tapeMarketFromCcxt(
  symbol,
  market,
  exchangeLabel,
  precisionMode,
  quoteAsset
) {
  if (!market) {
    throw new Error(`${exchangeLabel} 不存在市场 ${symbol}`);
  }
  if (!isLinearSwapMarket(market, quoteAsset)) {
    throw new Error(
      `${exchangeLabel} 市场 ${symbol} 不是可交易的 ${quoteAsset} 线性永续合约`
    );
  }
  if (!market.id) {
    throw new Error(`${exchangeLabel} 市场 ${symbol} 缺少交易所 id`);
  }
  return {
    id: market.id,
    symbol,
    base: market.base,
    quote: market.quote,
    settle: market.settle,
    contractSize: market.contractSize ?? 1,
    linear: true,
    precisionMode,
    precisionAmount: market.precision?.amount,
    precisionPrice: market.precision?.price,
    amountMin: market.limits?.amount?.min,
    amountMax: market.limits?.amount?.max,
    priceMin: market.limits?.price?.min,
    costMin: market.limits?.cost?.min,
  };
}

function isLinearSwapMarket(market, quoteAsset) {
  return Boolean(
    market &&
      market.active !== false &&
      (market.type === "swap" || market.swap === true) &&
      market.inverse !== true &&
      (market.linear === true || market.settle === quoteAsset) &&
      (market.quote === quoteAsset || market.settle === quoteAsset) &&
      market.symbol
  );
}

async function loadFundingHistory(
  exchange,
  exchangeDefinition,
  runtimeConfig,
  symbol,
  fromMs,
  toMs,
  signal
) {
  signal?.throwIfAborted();
  const sinceMs = fromMs - TIMEFRAME_MS["8h"];
  const samples = [];
  let cursor = sinceMs;
  while (cursor < toMs) {
    signal?.throwIfAborted();
    const page = await abortable(
      exchange.fetchFundingRateHistory(
        symbol,
        cursor,
        runtimeConfig.fundingPageLimit,
        { ...runtimeConfig.requestParams }
      ),
      signal
    );
    signal?.throwIfAborted();
    if (page.length === 0) {
      break;
    }
    let advanced = false;
    for (const entry of page) {
      const timestamp = entry.timestamp;
      const rate = entry.fundingRate;
      if (typeof timestamp !== "number" || typeof rate !== "number") {
        continue;
      }
      if (timestamp >= toMs) {
        continue;
      }
      if (
        samples.length > 0 &&
        timestamp <= samples[samples.length - 1].timestamp
      ) {
        continue;
      }
      samples.push({ timestamp, rate });
      advanced = true;
    }
    const lastTimestamp = page[page.length - 1]?.timestamp;
    if (
      typeof lastTimestamp !== "number" ||
      lastTimestamp + 1 <= cursor ||
      !advanced
    ) {
      break;
    }
    cursor = lastTimestamp + 1;
  }
  if (samples.length === 0) {
    throw new Error(
      `${exchangeDefinition.label} 区间内没有 ${symbol} funding 历史数据（DCA funding filter 需要该数据）`
    );
  }
  return inferFundingIntervals(samples);
}

function fundingIntervalFromSpacing(spacingMs) {
  const match = FUNDING_INTERVALS.find(
    (candidate) =>
      Math.abs(candidate.spacingMs - spacingMs) <= FUNDING_INTERVAL_TOLERANCE_MS
  );
  return match?.interval ?? "8h";
}

function toTapeDataIssues(error, symbol, timeframe) {
  if (isTapeDataUnavailableError(error)) {
    return [...error.issues];
  }
  return [
    {
      code: "load_failed",
      symbol,
      timeframe,
      message: error instanceof Error ? error.message : String(error),
    },
  ];
}
