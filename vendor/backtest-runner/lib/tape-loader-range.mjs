import { abortable } from "./abortable.mjs";
import { TapeDataUnavailableError } from "./coverage.mjs";
import {
  averageProgress,
  createSegmentRequest,
  mergeOhlcvTimeSegments,
  planOhlcvTimeSegments,
} from "./tape-loader-range-plan.mjs";
import { TIMEFRAME_MS } from "./timeframes.mjs";

const BITGET_OHLCV_MAX_REQUEST_SPAN_MS = 89 * 86_400_000;

export function isClosedCandle(timestampMs, timeframe, toMs) {
  return timestampMs + timeframeStepMs(timeframe) <= toMs;
}

export async function fetchClosedOhlcvRange(request) {
  const stepMs = timeframeStepMs(request.timeframe);
  const pageLimit = ohlcvPageLimitForTimeframe(
    request.exchangeDefinition,
    request.runtimeConfig,
    request.timeframe
  );
  const segments = planOhlcvTimeSegments(request, stepMs, pageLimit);
  if (segments.length === 1) {
    return fetchClosedOhlcvTimeSegment(request, pageLimit);
  }

  const progress = new Array(segments.length).fill(0);
  const segmentRows = await Promise.all(
    segments.map((segment, index) =>
      fetchClosedOhlcvTimeSegment(
        createSegmentRequest(request, segment, (fraction) => {
          progress[index] = fraction;
          request.onFraction?.(averageProgress(progress));
        }),
        pageLimit
      )
    )
  );
  const rows = mergeOhlcvTimeSegments(request, segmentRows);
  if (rows.length === 0 && !request.allowEmpty) {
    throw missingOhlcvError(request);
  }
  request.onFraction?.(1);
  return rows;
}

async function fetchClosedOhlcvTimeSegment(request, pageLimit) {
  const stepMs = timeframeStepMs(request.timeframe);
  const rows = [];
  const totalSpan = Math.max(1, request.toMs - request.sinceMs);
  let cursor = request.sinceMs;
  let emptyPrefixLowerMs = null;
  let nonEmptyPrefixUpperMs = null;
  let prefixResolved = false;

  while (cursor < request.toMs) {
    request.signal?.throwIfAborted();
    const fetchSinceMs = resolveFetchSinceMs(request, cursor);
    const page = await fetchOhlcvPage(request, fetchSinceMs, pageLimit, stepMs);
    request.signal?.throwIfAborted();

    const prefix = resolveEmptyPrefix({
      request,
      page,
      rows,
      cursor,
      stepMs,
      emptyPrefixLowerMs,
      nonEmptyPrefixUpperMs,
      prefixResolved,
    });
    if (prefix) {
      ({ cursor, emptyPrefixLowerMs, nonEmptyPrefixUpperMs, prefixResolved } =
        prefix);
      if (prefix.done) break;
      continue;
    }
    if (page.length === 0) break;
    prefixResolved = true;
    appendPageRows(request, rows, page, stepMs);
    const nextCursor = Number(page[page.length - 1][0]) + stepMs;
    if (nextCursor <= cursor) break;
    cursor = nextCursor;
    request.onFraction?.(Math.min(1, (cursor - request.sinceMs) / totalSpan));
  }
  if (rows.length === 0 && !request.allowEmpty) {
    throw missingOhlcvError(request);
  }
  return rows;
}

function resolveEmptyPrefix(input) {
  if (input.prefixResolved || input.rows.length > 0) return null;
  if (input.page.length === 0 && input.cursor >= input.request.fromMs) {
    return { ...input, done: true };
  }
  if (input.page.length > 0 && input.emptyPrefixLowerMs === null) return null;

  const emptyPrefixLowerMs =
    input.page.length === 0 ? input.cursor : input.emptyPrefixLowerMs;
  const nonEmptyPrefixUpperMs =
    input.page.length > 0 ? input.cursor : input.nonEmptyPrefixUpperMs;
  const upperMs = nonEmptyPrefixUpperMs ?? input.request.fromMs;
  const prefixResolved =
    nonEmptyPrefixUpperMs !== null &&
    upperMs - (emptyPrefixLowerMs ?? upperMs) <= input.stepMs;
  return {
    cursor: prefixResolved
      ? upperMs
      : midpointCursorMs(
          emptyPrefixLowerMs ?? input.cursor,
          upperMs,
          input.stepMs
        ),
    emptyPrefixLowerMs,
    nonEmptyPrefixUpperMs,
    prefixResolved,
    done: false,
  };
}

async function fetchOhlcvPage(request, fetchSinceMs, pageLimit, stepMs) {
  const params = { ...request.runtimeConfig.requestParams };
  if (request.exchangeDefinition.ccxtId === "hyperliquid") {
    params.until = Math.min(
      request.toMs,
      fetchSinceMs + (pageLimit - 1) * stepMs
    );
  }
  return abortable(
    request.exchange.fetchOHLCV(
      request.symbol,
      request.timeframe,
      fetchSinceMs,
      pageLimit,
      params
    ),
    request.signal
  );
}

function appendPageRows(request, rows, page, stepMs) {
  for (const raw of page) {
    const timestamp = Number(raw[0]);
    if (raw.length < 6 || !Number.isFinite(timestamp)) {
      throw invalidOhlcvError(request);
    }
    if (!isClosedCandle(timestamp, request.timeframe, request.toMs)) continue;
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
}

function resolveFetchSinceMs(request, cursor) {
  return request.exchangeDefinition.ccxtId === "bitget"
    ? Math.max(0, cursor - 1)
    : cursor;
}

function ohlcvPageLimitForTimeframe(exchange, runtimeConfig, timeframe) {
  if (exchange.ccxtId !== "bitget") return runtimeConfig.ohlcvPageLimit;
  return Math.max(
    1,
    Math.min(
      runtimeConfig.ohlcvPageLimit,
      Math.floor(BITGET_OHLCV_MAX_REQUEST_SPAN_MS / timeframeStepMs(timeframe))
    )
  );
}

function timeframeStepMs(timeframe) {
  const stepMs = TIMEFRAME_MS[timeframe];
  if (!stepMs) throw new Error(`不支持的 timeframe：${timeframe}`);
  return stepMs;
}

function midpointCursorMs(lowerMs, upperMs, stepMs) {
  if (upperMs - lowerMs <= stepMs) return upperMs;
  const midpointMs = lowerMs + Math.floor((upperMs - lowerMs) / 2);
  const alignedMs = Math.floor(midpointMs / stepMs) * stepMs;
  return Math.min(upperMs, Math.max(lowerMs + 1, alignedMs));
}

function invalidOhlcvError(request) {
  return new TapeDataUnavailableError([
    {
      code: "invalid_ohlcv",
      symbol: request.symbol,
      timeframe: request.timeframe,
    },
  ]);
}

function missingOhlcvError(request) {
  return new TapeDataUnavailableError([
    {
      code: "ohlcv_missing",
      symbol: request.symbol,
      timeframe: request.timeframe,
    },
  ]);
}
