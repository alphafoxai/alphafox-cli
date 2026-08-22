import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  requireTapeCoverageIssues,
  snapshotCoverageIssues,
  summarizeTapeCoverageNotice,
} from "../src/engine-backtest/coverage-notice";
import { EngineBacktestError } from "../src/engine-backtest/errors";

describe("engine-backtest coverage notice", () => {
  it("treats prefix gaps as notice and internal gaps as warning", () => {
    const notice = summarizeTapeCoverageNotice([
      { code: "prefix_gap", symbol: "BTC/USDT:USDT", timeframe: "1h" },
      { code: "internal_gap", symbol: "ETH/USDT:USDT", timeframe: "1h" },
      { code: "suffix_gap", symbol: "SOL/USDT:USDT", timeframe: "1h" },
    ]);

    assert.equal(notice.severity, "warning");
    assert.deepEqual(
      notice.prefix.map((item) => item.symbol),
      ["BTC/USDT:USDT"]
    );
    assert.deepEqual(
      notice.internal.map((item) => item.symbol),
      ["ETH/USDT:USDT"]
    );
    assert.deepEqual(
      notice.other.map((item) => item.code),
      ["suffix_gap"]
    );
    assert.match(notice.messages[0] ?? "", /WARNING: missing mid-range candles/);
    assert.match(notice.messages[1] ?? "", /NOTICE: missing start candles/);
    assert.match(notice.messages[2] ?? "", /suffix_gap/);
  });

  it("uses notice when only the start of the tape is missing", () => {
    const notice = summarizeTapeCoverageNotice([
      { code: "prefix_gap", symbol: "BTC/USDT:USDT", timeframe: "1h" },
    ]);
    assert.equal(notice.severity, "notice");
    assert.deepEqual(notice.internal, []);
    assert.match(notice.messages[0] ?? "", /less severe/);
  });

  it("keeps unrecognized soft codes visible instead of dropping them", () => {
    const notice = summarizeTapeCoverageNotice([
      { code: "future_soft_gap", symbol: "DOGE/USDT:USDT", timeframe: "1h" },
    ]);
    assert.equal(notice.severity, "notice");
    assert.deepEqual(
      notice.other.map((item) => item.code),
      ["future_soft_gap"]
    );
    assert.match(notice.messages[0] ?? "", /future_soft_gap/);
  });

  it("refuses a missing coverageIssues field instead of treating the tape as clean", () => {
    assert.throws(
      () => requireTapeCoverageIssues(undefined),
      (error: unknown) =>
        error instanceof EngineBacktestError &&
        error.subtype === "missing_coverage_issues"
    );
    assert.deepEqual(requireTapeCoverageIssues([]), []);
  });

  it("refuses to persist unknown coverage issue codes", () => {
    assert.throws(
      () =>
        snapshotCoverageIssues([
          { code: "future_soft_gap", symbol: "DOGE/USDT:USDT", timeframe: "1h" },
        ]),
      (error: unknown) =>
        error instanceof EngineBacktestError &&
        error.subtype === "invalid_coverage_issue"
    );
  });
});
