import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createProgressEmitter } from "../src/engine-backtest/progress";

describe("engine-backtest progress", () => {
  it("emits stage boundaries and ten-percent milestones only", () => {
    const rows: unknown[] = [];
    const emit = createProgressEmitter("jsonl", (value) => rows.push(value));

    for (let percent = 0; percent <= 100; percent += 1) {
      emit("ohlcv", percent / 100, `download ${percent}`);
    }

    assert.equal(rows.length, 11);
    assert.deepEqual(
      rows.map((row) => (row as { fraction: number }).fraction),
      [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]
    );
  });

  it("emits the first update and completion for every stage", () => {
    const rows: Array<Record<string, unknown>> = [];
    const emit = createProgressEmitter("jsonl", (value) => {
      rows.push(value as Record<string, unknown>);
    });

    emit("markets", 0.05, "loading markets");
    emit("markets", 0.06, "still loading markets");
    emit("markets", 1, "markets ready");
    emit("wasm", 0.04);
    emit("wasm", 1);

    assert.deepEqual(rows, [
      {
        event: "progress",
        stage: "markets",
        fraction: 0.05,
        detail: "loading markets",
      },
      {
        event: "progress",
        stage: "markets",
        fraction: 1,
        detail: "markets ready",
      },
      { event: "progress", stage: "wasm", fraction: 0.04 },
      { event: "progress", stage: "wasm", fraction: 1 },
    ]);
  });

  it("does not emit progress outside jsonl output", () => {
    const rows: unknown[] = [];
    const emit = createProgressEmitter("json", (value) => rows.push(value));

    emit("ohlcv", 0);
    emit("ohlcv", 1);

    assert.deepEqual(rows, []);
  });
});
