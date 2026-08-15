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

const WARMUP_CANDLES = ENGINE_BACKTEST_WARMUP_CANDLES;
const BITGET_OHLCV_MAX_REQUEST_SPAN_MS = 89 * 86_400_000;

export { TIMEFRAME_MS };

export function isClosedCandle(timestampMs, timeframe, toMs) {
  const stepMs = TIMEFRAME_MS[timeframe];
  if (!stepMs) {
    throw new Error(`不支持的 timeframe：${timeframe}`);
  }
  return timestampMs + stepMs <= toMs;
}

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

export async function fetchClosedOhlcvRange(request) {
  const stepMs = TIMEFRAME_MS[request.timeframe];
  if (!stepMs) {
    throw new Error(`不支持的 timeframe：${request.timeframe}`);
  }
  const pageLimit = ohlcvPageLimitForTimeframe(
    request.exchangeDefinition,
    request.runtimeConfig,
    request.timeframe
  );
  const rows = [];
  const totalSpan = Math.max(1, request.toMs - request.sinceMs);
  let cursor = request.sinceMs;
  let emptyPrefixLowerMs = null;
  let nonEmptyPrefixUpperMs = null;
  let prefixResolved = false;

  while (cursor < request.toMs) {
    request.signal?.throwIfAborted();
    const fetchSinceMs =
      request.exchangeDefinition.ccxtId === "bitget"
        ? Math.max(0, cursor - 1)
        : cursor;
    const requestParams = {
      ...request.runtimeConfig.requestParams,
    };
    if (request.exchangeDefinition.ccxtId === "hyperliquid") {
      requestParams.until = Math.min(
        request.toMs,
        fetchSinceMs + (pageLimit - 1) * stepMs
      );
    }
    const page = await abortable(
      request.exchange.fetchOHLCV(
        request.symbol,
        request.timeframe,
        fetchSinceMs,
        pageLimit,
        requestParams
      ),
      request.signal
    );
    request.signal?.throwIfAborted();

    if (!prefixResolved && rows.length === 0 && emptyPrefixLowerMs !== null) {
      if (page.length === 0) {
        emptyPrefixLowerMs = cursor;
        if (cursor >= request.fromMs) break;
      } else {
        nonEmptyPrefixUpperMs = cursor;
      }
      const upperMs = nonEmptyPrefixUpperMs ?? request.fromMs;
      if (
        nonEmptyPrefixUpperMs !== null &&
        upperMs - emptyPrefixLowerMs <= stepMs
      ) {
        cursor = upperMs;
        prefixResolved = true;
        continue;
      }
      cursor = midpointCursorMs(emptyPrefixLowerMs, upperMs, stepMs);
      continue;
    }

    if (page.length === 0) {
      if (!prefixResolved && rows.length === 0 && cursor < request.fromMs) {
        emptyPrefixLowerMs = cursor;
        cursor = midpointCursorMs(cursor, request.fromMs, stepMs);
        continue;
      }
      break;
    }
    prefixResolved = true;

    for (const raw of page) {
      if (raw.length < 6) {
        throw new TapeDataUnavailableError([
          {
            code: "invalid_ohlcv",
            symbol: request.symbol,
            timeframe: request.timeframe,
          },
        ]);
      }
      const timestamp = Number(raw[0]);
      if (!Number.isFinite(timestamp)) {
        throw new TapeDataUnavailableError([
          {
            code: "invalid_ohlcv",
            symbol: request.symbol,
            timeframe: request.timeframe,
          },
        ]);
      }
      if (!isClosedCandle(timestamp, request.timeframe, request.toMs)) {
        continue;
      }
      if (rows.length > 0 && timestamp <= rows[rows.length - 1][0]) {
        throw new TapeDataUnavailableError([
          {
            code: "non_monotonic",
            symbol: request.symbol,
            timeframe: request.timeframe,
            expected: rows[rows.length - 1][0] + stepMs,
            actual: timestamp,
            timestamp,
          },
        ]);
      }
      rows.push([
        timestamp,
        Number(raw[1]),
        Number(raw[2]),
        Number(raw[3]),
        Number(raw[4]),
        Number(raw[5]),
      ]);
    }
    const lastTimestamp = Number(page[page.length - 1][0]);
    const nextCursor = lastTimestamp + stepMs;
    if (nextCursor <= cursor) {
      break;
    }
    cursor = nextCursor;
    request.onFraction?.(Math.min(1, (cursor - request.sinceMs) / totalSpan));
  }
  if (rows.length === 0 && !request.allowEmpty) {
    throw new TapeDataUnavailableError([
      {
        code: "ohlcv_missing",
        symbol: request.symbol,
        timeframe: request.timeframe,
      },
    ]);
  }
  return rows;
}

function ohlcvPageLimitForTimeframe(exchange, runtimeConfig, timeframe) {
  if (exchange.ccxtId !== "bitget") {
    return runtimeConfig.ohlcvPageLimit;
  }
  const stepMs = TIMEFRAME_MS[timeframe];
  return Math.max(
    1,
    Math.min(
      runtimeConfig.ohlcvPageLimit,
      Math.floor(BITGET_OHLCV_MAX_REQUEST_SPAN_MS / stepMs)
    )
  );
}

function midpointCursorMs(lowerMs, upperMs, stepMs) {
  if (upperMs - lowerMs <= stepMs) {
    return upperMs;
  }
  const midpointMs = lowerMs + Math.floor((upperMs - lowerMs) / 2);
  const alignedMs = Math.floor(midpointMs / stepMs) * stepMs;
  return Math.min(upperMs, Math.max(lowerMs + 1, alignedMs));
}
