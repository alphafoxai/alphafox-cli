import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { join } from "node:path";

// Works from both source (tests/) and compiled (dist-test/tests/) layouts.
const cliPath = join(__dirname, "..", "..", "dist", "cli.js");

function run(args: string[]) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    encoding: "utf8",
    env: { ...process.env, ALPHAFOX_FORCE_FILE_KEYCHAIN: "1" },
  });
}

describe("cli launch", () => {
  it("version exits 0 with stable envelope fields", () => {
    const r = run(["version"]);
    assert.equal(r.status, 0, r.stderr);
    const json = JSON.parse(r.stdout);
    assert.equal(json.ok, true);
    assert.equal(json.data.name, "alphafox");
    assert.equal(typeof json.data.version, "string");
    assert.equal(typeof json.data.contractVersion, "string");
    assert.equal(r.stdout.toLowerCase().includes("bearer "), false);
  });

  it("doctor exits 0 and reports profile", () => {
    const r = run(["doctor"]);
    assert.equal(r.status, 0, r.stderr);
    const json = JSON.parse(r.stdout);
    assert.equal(json.ok, true);
    assert.equal(json.data.ok, true);
    assert.ok(Array.isArray(json.data.checks));
  });

  it("schema lists operationIds", () => {
    const r = run(["schema"]);
    assert.equal(r.status, 0, r.stderr);
    const json = JSON.parse(r.stdout);
    assert.equal(json.ok, true);
    assert.ok(json.data.operations.includes("me.whoami"));
  });

  it("raw api rejects internal paths without contacting network", () => {
    const r = run(["api", "GET", "/backend/v1/secret"]);
    assert.notEqual(r.status, 0);
    const err = JSON.parse(r.stderr || r.stdout);
    assert.equal(err.ok, false);
    assert.ok(
      String(err.error?.message ?? "")
        .toLowerCase()
        .includes("facade") ||
        String(err.error?.subtype ?? "").includes("facade") ||
        String(err.error?.message ?? "").includes("internal")
    );
  });

  it("high-risk operation without --yes returns confirmation gate", () => {
    const r = run([
      "api",
      "POST",
      "/api/v1/trading/traders/t1/start",
      "--body",
      "{}",
    ]);
    assert.equal(r.status, 10, r.stderr + r.stdout);
    const err = JSON.parse(r.stderr);
    assert.equal(err.ok, false);
    assert.equal(err.error.type, "confirmation");
  });
});
