import { EngineBacktestError } from "./errors";
import type { TapeCoverageIssue, TapeCoverageNotice } from "./types";

function symbolLabel(issue: TapeCoverageIssue): string {
  const timeframe = issue.timeframe && issue.timeframe !== "*" ? ` ${issue.timeframe}` : "";
  return `${issue.symbol}${timeframe}`;
}

function uniqueIssues(
  issues: readonly TapeCoverageIssue[]
): readonly TapeCoverageIssue[] {
  const seen = new Set<string>();
  const unique: TapeCoverageIssue[] = [];
  for (const issue of issues) {
    const key = `${issue.code}\u0000${issue.symbol}\u0000${issue.timeframe}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(issue);
  }
  return unique;
}

export function summarizeTapeCoverageNotice(
  issues: readonly TapeCoverageIssue[]
): TapeCoverageNotice {
  const prefix: TapeCoverageIssue[] = [];
  const internal: TapeCoverageIssue[] = [];
  const other: TapeCoverageIssue[] = [];
  for (const item of issues) {
    if (item.code === "prefix_gap") {
      prefix.push(item);
    } else if (item.code === "internal_gap") {
      internal.push(item);
    } else {
      other.push(item);
    }
  }

  const uniquePrefix = uniqueIssues(prefix);
  const uniqueInternal = uniqueIssues(internal);
  const uniqueOther = uniqueIssues(other);
  const severity =
    uniqueInternal.length > 0
      ? "warning"
      : uniquePrefix.length + uniqueOther.length > 0
        ? "notice"
        : "none";
  const messages: string[] = [];
  if (uniqueInternal.length > 0) {
    messages.push(
      `WARNING: missing mid-range candles (more severe): ${uniqueInternal
        .map(symbolLabel)
        .join(", ")}`
    );
  }
  if (uniquePrefix.length > 0) {
    messages.push(
      `NOTICE: missing start candles (less severe): ${uniquePrefix
        .map(symbolLabel)
        .join(", ")}`
    );
  }
  if (uniqueOther.length > 0) {
    messages.push(
      `NOTICE: other soft coverage gaps: ${uniqueOther
        .map((issue) => `${symbolLabel(issue)} (${issue.code})`)
        .join(", ")}`
    );
  }

  return {
    severity,
    prefix: uniquePrefix,
    internal: uniqueInternal,
    other: uniqueOther,
    messages,
  };
}

/** Must match alphafox-web `engineBacktestPersistedSnapshotSchema.coverageIssues`. */
const PERSISTED_COVERAGE_ISSUE_CODES = new Set([
  "market_missing",
  "ohlcv_missing",
  "invalid_ohlcv",
  "non_monotonic",
  "internal_gap",
  "prefix_gap",
  "suffix_gap",
  "warmup_insufficient",
  "load_failed",
  "coverage_insufficient",
]);

export function snapshotCoverageIssues(
  issues: readonly TapeCoverageIssue[] | undefined
): TapeCoverageIssue[] | undefined {
  if (!issues || issues.length === 0) return undefined;
  return issues.map((issue) => {
    if (!PERSISTED_COVERAGE_ISSUE_CODES.has(issue.code)) {
      throw new EngineBacktestError({
        type: "runtime",
        subtype: "invalid_coverage_issue",
        message: `Cannot persist unknown tape coverage issue code: ${issue.code}`,
      });
    }
    return {
      code: issue.code,
      symbol: issue.symbol,
      timeframe: issue.timeframe,
      ...(issue.expected === undefined ? {} : { expected: issue.expected }),
      ...(issue.actual === undefined ? {} : { actual: issue.actual }),
      ...(issue.timestamp === undefined ? {} : { timestamp: issue.timestamp }),
      ...(issue.message === undefined ? {} : { message: issue.message }),
    };
  });
}
