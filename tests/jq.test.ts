import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { applyJqFilter, successEnvelope } from "../src/envelope";

const cliPath = join(__dirname, "..", "..", "dist", "cli.js");
const fakeJq = join(__dirname, "..", "..", "tests", "fixtures", "fake-jq.cjs");

describe("jq output filter", () => {
  it("applyJqFilter runs jq -c against the envelope", () => {
    chmodSync(fakeJq, 0o755);
    const prev = process.env.ALPHAFOX_JQ;
    process.env.ALPHAFOX_JQ = fakeJq;
    try {
      const out = applyJqFilter(successEnvelope({ name: "alphafox" }), ".data.name");
      assert.equal(JSON.parse(out), "alphafox");
    } finally {
      if (prev === undefined) delete process.env.ALPHAFOX_JQ;
      else process.env.ALPHAFOX_JQ = prev;
    }
  });

  it("fails closed when jq is missing", () => {
    const prev = process.env.ALPHAFOX_JQ;
    process.env.ALPHAFOX_JQ = join(__dirname, "fixtures", "jq-does-not-exist");
    try {
      assert.throws(
        () => applyJqFilter({ ok: true }, ".data"),
        /jq is not installed|ENOENT|jq_not_installed|not installed/
      );
    } finally {
      if (prev === undefined) delete process.env.ALPHAFOX_JQ;
      else process.env.ALPHAFOX_JQ = prev;
    }
  });

  it("alphafox version --jq .data.name prints the filtered value", () => {
    chmodSync(fakeJq, 0o755);
    const r = spawnSync(process.execPath, [cliPath, "version", "--jq", ".data.name"], {
      encoding: "utf8",
      env: {
        ...process.env,
        ALPHAFOX_JQ: fakeJq,
        ALPHAFOX_FORCE_FILE_KEYCHAIN: "1",
      },
    });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout), "alphafox");
    assert.equal(r.stdout.includes("contractVersion"), false);
  });

  it("refuses --token on argv", () => {
    const r = spawnSync(
      process.execPath,
      [cliPath, "whoami", "--token", "secret-value"],
      {
        encoding: "utf8",
        env: { ...process.env, ALPHAFOX_FORCE_FILE_KEYCHAIN: "1" },
      }
    );
    assert.notEqual(r.status, 0);
    const err = JSON.parse(r.stderr || r.stdout);
    assert.equal(err.ok, false);
    assert.equal(err.error.subtype, "token_argv_forbidden");
    assert.equal(`${r.stdout}${r.stderr}`.includes("secret-value"), false);
  });
});
