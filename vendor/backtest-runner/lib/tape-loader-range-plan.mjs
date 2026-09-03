import { TapeDataUnavailableError } from "./coverage.mjs";
import { MAX_TAPE_SERIES_CONCURRENCY } from "./tape-loader-concurrency.mjs";

export function planOhlcvTimeSegments(request, stepMs, pageLimit) {
  const candleCount = Math.max(
    0,
    Math.ceil((request.toMs - request.sinceMs) / stepMs)
  );
  const segmentCount = Math.min(
    MAX_TAPE_SERIES_CONCURRENCY,
    Math.max(1, Math.ceil(candleCount / pageLimit))
  );
  if (segmentCount === 1) {
    return [{ sinceMs: request.sinceMs, untilMs: request.toMs }];
  }

  const candlesPerSegment = Math.ceil(candleCount / segmentCount);
  return Array.from({ length: segmentCount }, (_, index) => {
    const logicalStartMs = request.sinceMs + index * candlesPerSegment * stepMs;
    return {
      // Overlap preserves bars whose exchange open time is not split-aligned.
      sinceMs:
        index === 0
          ? request.sinceMs
          : Math.max(request.sinceMs, logicalStartMs - stepMs),
      untilMs: Math.min(
        request.toMs,
        request.sinceMs + (index + 1) * candlesPerSegment * stepMs
      ),
    };
  }).filter((segment) => segment.untilMs > segment.sinceMs);
}

export function createSegmentRequest(request, segment, onFraction) {
  return {
    ...request,
    sinceMs: segment.sinceMs,
    toMs: segment.untilMs,
    fromMs: Math.min(
      segment.untilMs,
      Math.max(segment.sinceMs, request.fromMs)
    ),
    allowEmpty: true,
    onFraction,
  };
}

export function mergeOhlcvTimeSegments(request, segments) {
  const rowsByTimestamp = new Map();
  for (const rows of segments) {
    for (const row of rows) {
      if (row[0] < request.sinceMs) continue;
      const existing = rowsByTimestamp.get(row[0]);
      if (existing && !sameOhlcvRow(existing, row)) {
        throw new TapeDataUnavailableError([
          {
            code: "invalid_ohlcv",
            symbol: request.symbol,
            timeframe: request.timeframe,
            timestamp: row[0],
            message: "concurrent OHLCV windows returned conflicting candles",
          },
        ]);
      }
      rowsByTimestamp.set(row[0], row);
    }
  }
  return [...rowsByTimestamp.values()].sort((left, right) => left[0] - right[0]);
}

export function averageProgress(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sameOhlcvRow(left, right) {
  return left.every((value, index) => value === right[index]);
}
