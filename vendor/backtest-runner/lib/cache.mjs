import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const CACHE_KEY_VERSION = "closed-series-v2";
export const CACHE_MAX_AGE_MS = 30 * 86_400_000;
export const DEFAULT_TAPE_CACHE_DIR = path.join(
  os.homedir(),
  ".alphafox",
  "cache",
  "engine-backtest"
);

export function ohlcvSeriesCacheKey(exchangeId, symbol, timeframe) {
  return `${CACHE_KEY_VERSION}|${exchangeId}|${symbol}|${timeframe}`;
}

export function missingCachedOhlcvRanges(cached, sinceMs, untilMs) {
  if (untilMs <= sinceMs) return [];
  if (!cached || cached.untilMs < sinceMs || cached.sinceMs > untilMs) {
    return [{ sinceMs, untilMs }];
  }

  const missing = [];
  if (sinceMs < cached.sinceMs) {
    missing.push({ sinceMs, untilMs: Math.min(untilMs, cached.sinceMs) });
  }
  if (untilMs > cached.untilMs) {
    missing.push({ sinceMs: Math.max(sinceMs, cached.untilMs), untilMs });
  }
  return missing.filter((range) => range.untilMs > range.sinceMs);
}

export function mergeCachedOhlcvRanges(cached, addition) {
  if (
    !cached ||
    addition.untilMs < cached.sinceMs ||
    addition.sinceMs > cached.untilMs
  ) {
    return addition;
  }

  const rowsByTimestamp = new Map();
  for (const row of cached.rows) rowsByTimestamp.set(row[0], row);
  for (const row of addition.rows) rowsByTimestamp.set(row[0], row);
  return {
    sinceMs: Math.min(cached.sinceMs, addition.sinceMs),
    untilMs: Math.max(cached.untilMs, addition.untilMs),
    rows: [...rowsByTimestamp.values()].sort(
      (left, right) => left[0] - right[0]
    ),
  };
}

export function createDisabledTapeCache() {
  return {
    disabled: true,
    async read() {
      return null;
    },
    async write() {},
  };
}

/**
 * Filesystem closed-series cache. Semantics match the web IndexedDB cache:
 * one rolling range per exchange+symbol+timeframe; hits only fetch gaps.
 *
 * @param {string} [rootDir]
 * @param {{ maxAgeMs?: number, nowMs?: number }} [options]
 */
export function createFileTapeCache(
  rootDir = DEFAULT_TAPE_CACHE_DIR,
  options = {}
) {
  const resolvedRoot = path.resolve(rootDir);
  const maxAgeMs = options.maxAgeMs ?? CACHE_MAX_AGE_MS;
  const now = () => options.nowMs ?? Date.now();

  return {
    disabled: false,
    rootDir: resolvedRoot,
    async read(key) {
      try {
        const raw = await fs.readFile(filePathForKey(resolvedRoot, key), "utf8");
        const record = JSON.parse(raw);
        const fresh =
          record &&
          Number.isFinite(record.storedAt) &&
          now() - record.storedAt <= maxAgeMs;
        if (
          !fresh ||
          !Number.isFinite(record.sinceMs) ||
          !Number.isFinite(record.untilMs) ||
          record.untilMs <= record.sinceMs ||
          !Array.isArray(record.rows) ||
          !record.rows.every(isBasicOhlcvRow)
        ) {
          return null;
        }
        return {
          sinceMs: record.sinceMs,
          untilMs: record.untilMs,
          rows: record.rows,
        };
      } catch (error) {
        if (error && error.code === "ENOENT") {
          return null;
        }
        // Cache unavailability must not block a run.
        return null;
      }
    },
    async write(key, range) {
      try {
        const filePath = filePathForKey(resolvedRoot, key);
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        const record = {
          key,
          sinceMs: range.sinceMs,
          untilMs: range.untilMs,
          rows: range.rows,
          storedAt: now(),
        };
        const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
        await fs.writeFile(tmp, JSON.stringify(record), "utf8");
        await fs.rename(tmp, filePath);
      } catch {
        // Best-effort cache; ignore write failures.
      }
    },
  };
}

function isBasicOhlcvRow(row) {
  return (
    Array.isArray(row) &&
    row.length === 6 &&
    row.every(Number.isFinite)
  );
}

export function filePathForKey(rootDir, key) {
  const parts = key.split("|");
  if (parts.length >= 4) {
    const version = parts[0];
    const exchangeId = parts[1];
    const timeframe = parts[parts.length - 1];
    const symbol = parts.slice(2, -1).join("|");
    return path.join(
      rootDir,
      version,
      exchangeId,
      encodeURIComponent(symbol),
      `${timeframe}.json`
    );
  }
  return path.join(rootDir, `${encodeURIComponent(key)}.json`);
}
