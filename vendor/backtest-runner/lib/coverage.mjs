export class TapeDataUnavailableError extends Error {
  /**
   * @param {readonly import("../index.d.ts").TapeDataIssue[]} issues
   */
  constructor(issues) {
    super(formatTapeDataIssues(issues));
    this.name = "TapeDataUnavailableError";
    this.issues = issues;
  }
}

const HARD_ISSUE_CODES = new Set([
  "market_missing",
  "ohlcv_missing",
  "invalid_ohlcv",
  "non_monotonic",
  "load_failed",
]);

export function isHardTapeDataIssue(code) {
  return HARD_ISSUE_CODES.has(code);
}

export function isTapeDataUnavailableError(value) {
  return value instanceof TapeDataUnavailableError;
}

export function analyzeOhlcvCoverage(input) {
  const issues = [];
  const expectedReplayCandles = Math.max(
    0,
    Math.floor((input.toMs - input.fromMs) / input.stepMs)
  );

  if (input.rows.length === 0) {
    issues.push(issue(input, "ohlcv_missing"));
    return {
      symbol: input.symbol,
      timeframe: input.timeframe,
      rowCount: 0,
      warmupCandles: 0,
      expectedReplayCandles,
      actualReplayCandles: 0,
      coverageRatio: 0,
      issues,
    };
  }

  let previousTimestamp;
  for (const row of input.rows) {
    const [timestamp, open, high, low, close, volume] = row;
    if (
      ![timestamp, open, high, low, close, volume].every(Number.isFinite) ||
      timestamp <= 0 ||
      !Number.isInteger(timestamp) ||
      open <= 0 ||
      high <= 0 ||
      low <= 0 ||
      close <= 0 ||
      volume < 0 ||
      high < Math.max(open, close, low) ||
      low > Math.min(open, close, high)
    ) {
      issues.push(issue(input, "invalid_ohlcv", { timestamp }));
      break;
    }
    if (previousTimestamp !== undefined) {
      const delta = timestamp - previousTimestamp;
      if (delta <= 0) {
        issues.push(
          issue(input, "non_monotonic", {
            expected: previousTimestamp + input.stepMs,
            actual: timestamp,
            timestamp,
          })
        );
        break;
      }
      if (delta !== input.stepMs) {
        issues.push(
          issue(input, "internal_gap", {
            expected: previousTimestamp + input.stepMs,
            actual: timestamp,
            timestamp,
          })
        );
        break;
      }
    }
    previousTimestamp = timestamp;
  }

  const warmupCandles = input.rows.filter(
    (row) => row[0] + input.stepMs <= input.fromMs
  ).length;
  if (warmupCandles < input.minWarmupCandles) {
    issues.push(
      issue(input, "warmup_insufficient", {
        expected: input.minWarmupCandles,
        actual: warmupCandles,
      })
    );
  }

  const replayRows = input.rows.filter(
    (row) => row[0] >= input.fromMs && row[0] < input.toMs
  );
  const actualReplayCandles = replayRows.length;
  const coverageRatio =
    expectedReplayCandles > 0
      ? actualReplayCandles / expectedReplayCandles
      : actualReplayCandles > 0
        ? 1
        : 0;

  if (input.requireFullReplayCoverage) {
    const alignmentTimestamp = input.rows.find((row) =>
      Number.isInteger(row?.[0])
    )?.[0];
    const expectedStart =
      alignmentTimestamp === undefined
        ? input.fromMs
        : alignmentTimestamp +
          Math.ceil(
            (input.fromMs - alignmentTimestamp) / input.stepMs
          ) *
            input.stepMs;
    const firstReplayTimestamp = replayRows[0]?.[0];
    const lastReplayTimestamp = replayRows.at(-1)?.[0];
    if (
      firstReplayTimestamp === undefined ||
      firstReplayTimestamp > expectedStart
    ) {
      issues.push(
        issue(input, "prefix_gap", {
          expected: expectedStart,
          actual: firstReplayTimestamp,
        })
      );
    }
    if (
      lastReplayTimestamp === undefined ||
      lastReplayTimestamp + input.stepMs < input.toMs
    ) {
      issues.push(
        issue(input, "suffix_gap", {
          expected: input.toMs - input.stepMs,
          actual: lastReplayTimestamp,
        })
      );
    }
  } else {
    const lastTimestamp = input.rows.at(-1)?.[0];
    if (
      lastTimestamp === undefined ||
      lastTimestamp + input.stepMs * 2 <= input.toMs
    ) {
      issues.push(
        issue(input, "suffix_gap", {
          expected: input.toMs - input.stepMs,
          actual: lastTimestamp,
        })
      );
    }
  }

  return {
    symbol: input.symbol,
    timeframe: input.timeframe,
    firstTimestamp: input.rows[0]?.[0],
    lastTimestamp: input.rows.at(-1)?.[0],
    rowCount: input.rows.length,
    warmupCandles,
    expectedReplayCandles,
    actualReplayCandles,
    coverageRatio,
    issues,
  };
}

export const DEFAULT_TAPE_DATA_QUALITY_MODE = "basic";

export function evaluateOhlcvCoverage(input) {
  const report = analyzeOhlcvCoverage(input);

  if (input.mode === "strict" || report.issues.length === 0) {
    return {
      report,
      accepted: report.issues.length === 0,
      blockingIssues: report.issues,
      acceptedSoftIssues: [],
    };
  }

  const hardIssues = report.issues.filter((item) =>
    isHardTapeDataIssue(item.code)
  );
  if (hardIssues.length > 0) {
    return {
      report,
      accepted: false,
      blockingIssues: hardIssues,
      acceptedSoftIssues: [],
    };
  }

  return {
    report,
    accepted: true,
    blockingIssues: [],
    acceptedSoftIssues: report.issues,
  };
}

export function summarizeTapeCoverageIssues(issues) {
  const prefix = [];
  const internal = [];
  const other = [];
  for (const item of issues) {
    if (item.code === "prefix_gap") {
      prefix.push(item);
    } else if (item.code === "internal_gap") {
      internal.push(item);
    } else {
      other.push(item);
    }
  }
  return { prefix, internal, other };
}

export function formatCoverageSoftWarning(issues, coverageRatio) {
  const sample = issues[0];
  const symbol = sample?.symbol ?? "unknown";
  const timeframe = sample?.timeframe ?? "*";
  const codes = [...new Set(issues.map((item) => item.code))];
  const summary = summarizeTapeCoverageIssues(issues);
  const parts = [];
  if (summary.prefix.length > 0) {
    parts.push("missing start candles (less severe)");
  }
  if (summary.internal.length > 0) {
    parts.push("missing mid-range candles (more severe)");
  }
  if (summary.other.length > 0) {
    parts.push(
      `other soft gaps (${summary.other.map((item) => item.code).join(", ")})`
    );
  }
  const detail =
    parts.length > 0
      ? parts.join("; ")
      : `accepted soft data issues (${codes.join(", ")})`;
  return `${symbol} ${timeframe}: ${detail} with ${(coverageRatio * 100).toFixed(1)}% replay coverage`;
}

function issue(input, code, detail = {}) {
  return {
    code,
    symbol: input.symbol,
    timeframe: input.timeframe,
    ...detail,
  };
}

function formatTapeDataIssues(issues) {
  if (issues.length === 0) {
    return "Backtest market data is unavailable.";
  }
  const first = issues[0];
  const suffix =
    issues.length > 1 ? ` (+${issues.length - 1} more issues)` : "";
  return `${first.symbol} ${first.timeframe}: ${first.code}${suffix}`;
}
