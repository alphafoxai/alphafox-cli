import assert from "node:assert/strict";
import test from "node:test";

import { createSweepSessionState, reduceSweepSession } from "../src/engine-backtest/sweep-kernel";

test("a completed local search stays successful when cloud save fails", () => {
  const succeeded = reduceSweepSession(
    reduceSweepSession(createSweepSessionState(), {
      type: "execution-started",
      total: 4,
    }),
    { type: "execution-succeeded", resultId: "local-1" }
  );

  const saveFailed = reduceSweepSession(
    reduceSweepSession(succeeded, { type: "cloud-save-started" }),
    { type: "cloud-save-failed", message: "network" }
  );

  assert.deepEqual(saveFailed.execution, {
    status: "succeeded",
    resultId: "local-1",
  });
  assert.deepEqual(saveFailed.cloudSave, {
    status: "failed",
    message: "network",
  });
  assert.equal(saveFailed.execution.status, "succeeded");
});

test("retrying a failed cloud save does not clear the local execution result", () => {
  const saveFailed = reduceSweepSession(
    reduceSweepSession(
      reduceSweepSession(createSweepSessionState(), {
        type: "execution-succeeded",
        resultId: "local-2",
      }),
      { type: "cloud-save-started" }
    ),
    { type: "cloud-save-failed", message: "timeout" }
  );

  const retrying = reduceSweepSession(saveFailed, { type: "cloud-save-retry" });
  const saved = reduceSweepSession(retrying, {
    type: "cloud-save-succeeded",
    sweepId: "sweep-9",
  });

  assert.deepEqual(retrying.execution, {
    status: "succeeded",
    resultId: "local-2",
  });
  assert.equal(retrying.cloudSave.status, "saving");
  assert.deepEqual(saved.execution, {
    status: "succeeded",
    resultId: "local-2",
  });
  assert.deepEqual(saved.cloudSave, {
    status: "saved",
    sweepId: "sweep-9",
  });
});

test("cloud-save events are ignored until local execution has succeeded", () => {
  const running = reduceSweepSession(createSweepSessionState(), {
    type: "execution-started",
    total: 2,
  });
  const ignored = reduceSweepSession(running, {
    type: "cloud-save-failed",
    message: "too-early",
  });

  assert.equal(ignored.execution.status, "running");
  assert.equal(ignored.cloudSave.status, "idle");
});
