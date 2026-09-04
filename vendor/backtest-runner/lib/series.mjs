import { abortable } from "./abortable.mjs";
import {
  missingCachedOhlcvRanges,
  mergeCachedOhlcvRanges,
  ohlcvSeriesCacheKey,
} from "./cache.mjs";
import {
  evaluateOhlcvCoverage,
  TapeDataUnavailableError,
} from "./coverage.mjs";
import {
  ENGINE_BACKTEST_WARMUP_CANDLES,
  TIMEFRAME_MS,
} from "./timeframes.mjs";
import {
  fetchClosedOhlcvRange,
  isClosedCandle,
} from "./tape-loader-range.mjs";

const WARMUP_CANDLES = ENGINE_BACKTEST_WARMUP_CANDLES;

export { fetchClosedOhlcvRange, isClosedCandle, TIMEFRAME_MS };

export function ohlcvSeriesStartMs(fromMs, timeframe, market) {
  const stepMs = TIMEFRAME_MS[timeframe];
  if (!stepMs) {
    throw new Error(`不支持的 timeframe：${timeframe}`);
  }
  const warmupStartMs = fromMs - WARMUP_CANDLES * stepMs;
  const marketCreatedMs = market?.created;
  return typeof marketCreatedMs === "number" &&
    Number.isFinite(marketCreatedMs) &&
    marketCreatedMs > 0
    ? Math.max(warmupStartMs, marketCreatedMs)
    : warmupStartMs;
}

export async function loadSeriesWithCache(
  exchange,
  exchangeDefinition,
  runtimeConfig,
  symbol,
  timeframe,
  market,
  fromMs,
  toMs,
  minWarmupCandles,
  requireFullReplayCoverage,
  dataQualityMode,
  onFraction,
  cacheUntilMs,
  cache,
  signal
) {
  signal?.throwIfAborted();
  const stepMs = TIMEFRAME_MS[timeframe];
  if (!stepMs) {
    throw new Error(`不支持的 timeframe：${timeframe}`);
  }
  const sinceMs = ohlcvSeriesStartMs(fromMs, timeframe, market);
  const closedEndMs = Math.min(Math.max(cacheUntilMs, sinceMs), toMs);
  const cacheable = closedEndMs > sinceMs;
  const cacheKey = ohlcvSeriesCacheKey(
    exchangeDefinition.ccxtId,
    symbol,
    timeframe
  );
  const totalSpan = Math.max(1, toMs - sinceMs);
  const closedShare = (closedEndMs - sinceMs) / totalSpan;
  const closedSpan = Math.max(1, closedEndMs - sinceMs);

  const evaluate = (rows) =>
    evaluateOhlcvCoverage({
      symbol,
      timeframe,
      rows,
      stepMs,
      fromMs,
      toMs,
      minWarmupCandles,
      requireFullReplayCoverage,
      mode: dataQualityMode,
    });
  const fetchClosedSegment = (range, reportProgress) =>
    fetchClosedOhlcvRange({
      exchange,
      exchangeDefinition,
      runtimeConfig,
      symbol,
      timeframe,
      sinceMs: range.sinceMs,
      fromMs: Math.min(range.untilMs, Math.max(range.sinceMs, fromMs)),
      toMs: range.untilMs,
      allowEmpty: true,
      onFraction: reportProgress
        ? (fraction) =>
            onFraction(
              ((range.sinceMs -
                sinceMs +
                fraction * (range.untilMs - range.sinceMs)) /
                closedSpan) *
                closedShare
            )
        : undefined,
      signal,
    });
  const fetchLiveTail = () =>
    closedEndMs < toMs
      ? fetchClosedOhlcvRange({
          exchange,
          exchangeDefinition,
          runtimeConfig,
          symbol,
          timeframe,
          sinceMs: closedEndMs,
          fromMs: Math.max(fromMs, closedEndMs),
          toMs,
          allowEmpty: true,
          onFraction: (fraction) =>
            onFraction(closedShare + fraction * (1 - closedShare)),
          signal,
        })
      : Promise.resolve([]);

  const cachedRange =
    cacheable && cache && !cache.disabled
      ? await abortable(cache.read(cacheKey), signal)
      : null;
  signal?.throwIfAborted();
  const cachedRangeContributed =
    cachedRange !== null &&
    cachedRange.untilMs >= sinceMs &&
    cachedRange.sinceMs <= closedEndMs;
  const missingRanges = cacheable
    ? missingCachedOhlcvRanges(cachedRange, sinceMs, closedEndMs)
    : [];
  let mergedRange = cachedRange;
  let fetchedClosedRows = false;
  for (const missingRange of missingRanges) {
    onFraction(((missingRange.sinceMs - sinceMs) / closedSpan) * closedShare);
    const fetchedRows = await fetchClosedSegment(missingRange, true);
    mergedRange = mergeCachedOhlcvRanges(mergedRange, {
      ...missingRange,
      rows: fetchedRows,
    });
    fetchedClosedRows = true;
  }
  if (cacheable && missingRanges.length === 0) onFraction(closedShare);

  let closedRows = rowsForClosedRange(
    mergedRange,
    sinceMs,
    closedEndMs,
    timeframe
  );
  const liveRows = await fetchLiveTail();
  signal?.throwIfAborted();

  let rows = concatMonotonicRows(closedRows ?? [], liveRows);
  let decision = evaluate(rows);
  if (!decision.accepted && cachedRangeContributed) {
    const freshRange = { sinceMs, untilMs: closedEndMs };
    closedRows = await fetchClosedSegment(freshRange, false);
    mergedRange = mergeCachedOhlcvRanges(mergedRange, {
      ...freshRange,
      rows: closedRows,
    });
    fetchedClosedRows = true;
    rows = concatMonotonicRows(closedRows, liveRows);
    decision = evaluate(rows);
  }
  if (!decision.accepted) {
    throw new TapeDataUnavailableError(decision.blockingIssues);
  }
  if (
    cacheable &&
    fetchedClosedRows &&
    mergedRange !== null &&
    mergedRange.rows.length > 0 &&
    cache &&
    !cache.disabled
  ) {
    await abortable(cache.write(cacheKey, mergedRange), signal);
  }
  signal?.throwIfAborted();
  onFraction(1);
  return {
    rows,
    softIssues: decision.acceptedSoftIssues,
    coverageRatio: decision.report.coverageRatio,
  };
}

function rowsForClosedRange(range, sinceMs, untilMs, timeframe) {
  return (range?.rows ?? []).filter(
    (row) => row[0] >= sinceMs && isClosedCandle(row[0], timeframe, untilMs)
  );
}

function concatMonotonicRows(head, tail) {
  if (head.length === 0) return [...tail];
  const lastHeadTimestamp = head[head.length - 1][0];
  return [...head, ...tail.filter((row) => row[0] > lastHeadTimestamp)];
}
