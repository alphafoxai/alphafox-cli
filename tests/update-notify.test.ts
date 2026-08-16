import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  formatUpdateNotice,
  maybeNotifyCliUpdate,
  shouldSkipUpdateCheck,
} from "../src/update/notify";

describe("CLI update notice", () => {
  it("skips background checks for update, install, and the opt-out env", () => {
    assert.equal(shouldSkipUpdateCheck("update"), true);
    assert.equal(shouldSkipUpdateCheck("install"), true);
    assert.equal(shouldSkipUpdateCheck("version"), false);
    assert.equal(
      shouldSkipUpdateCheck("version", { ALPHAFOX_SKIP_UPDATE_CHECK: "1" }),
      true
    );
  });

  it("checks npm once and writes a stderr notice when a newer version exists", async () => {
    const root = mkdtempSync(join(tmpdir(), "alphafox-update-notice-"));
    const notices: string[] = [];
    let fetches = 0;

    const first = await maybeNotifyCliUpdate({
      env: { ALPHAFOX_CONFIG_DIR: root },
      currentVersion: "0.3.5",
      now: new Date("2026-08-16T10:00:00.000Z"),
      fetchLatest: async () => {
        fetches += 1;
        return "0.3.6";
      },
      writeNotice: (line) => {
        notices.push(line);
      },
    });

    assert.equal(first.checked, true);
    assert.equal(first.notified, true);
    assert.equal(first.latestVersion, "0.3.6");
    assert.equal(notices.length, 1);
    assert.equal(notices[0], formatUpdateNotice("0.3.5", "0.3.6"));
    assert.match(notices[0]!, /alphafox update --format json --no-input/);

    const second = await maybeNotifyCliUpdate({
      env: { ALPHAFOX_CONFIG_DIR: root },
      currentVersion: "0.3.5",
      now: new Date("2026-08-16T18:00:00.000Z"),
      fetchLatest: async () => {
        fetches += 1;
        return "0.3.7";
      },
      writeNotice: (line) => {
        notices.push(line);
      },
    });

    assert.equal(second.checked, false);
    assert.equal(second.notified, false);
    assert.equal(fetches, 1);
    assert.equal(notices.length, 1);
    const state = JSON.parse(
      readFileSync(join(root, "update-check.json"), "utf8")
    );
    assert.equal(state.latestVersion, "0.3.6");
    rmSync(root, { recursive: true, force: true });
  });

  it("rechecks after 24 hours and stays silent when already current", async () => {
    const root = mkdtempSync(join(tmpdir(), "alphafox-update-current-"));
    writeFileSync(
      join(root, "update-check.json"),
      JSON.stringify({
        schemaVersion: 1,
        checkedAt: "2026-08-15T09:00:00.000Z",
        currentVersion: "0.3.5",
        latestVersion: "0.3.5",
        updateAvailable: false,
      })
    );
    const notices: string[] = [];
    const result = await maybeNotifyCliUpdate({
      env: { ALPHAFOX_CONFIG_DIR: root },
      currentVersion: "0.3.6",
      now: new Date("2026-08-16T10:00:00.000Z"),
      fetchLatest: async () => "0.3.6",
      writeNotice: (line) => {
        notices.push(line);
      },
    });
    assert.equal(result.checked, true);
    assert.equal(result.notified, false);
    assert.deepEqual(notices, []);
    rmSync(root, { recursive: true, force: true });
  });

  it("does not fail the caller when npm view fails", async () => {
    const root = mkdtempSync(join(tmpdir(), "alphafox-update-fail-"));
    const result = await maybeNotifyCliUpdate({
      env: { ALPHAFOX_CONFIG_DIR: root },
      currentVersion: "0.3.5",
      now: new Date("2026-08-16T10:00:00.000Z"),
      fetchLatest: async () => {
        throw new Error("ENOTFOUND");
      },
      writeNotice: () => {
        throw new Error("should not notify");
      },
    });
    assert.equal(result.checked, true);
    assert.equal(result.notified, false);
    rmSync(root, { recursive: true, force: true });
  });
});
