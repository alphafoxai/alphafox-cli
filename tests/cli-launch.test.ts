import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { join } from "node:path";

// Works from both source (tests/) and compiled (dist-test/tests/) layouts.
const cliPath = join(__dirname, "..", "..", "dist", "cli.js");

function run(args: string[], extraEnv: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      ALPHAFOX_FORCE_FILE_KEYCHAIN: "1",
      ...extraEnv,
    },
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
    assert.ok(json.data.operations.length > 24);
    assert.equal(json.data.contractVersion, "2026-08-13");
  });

  it("schema for an operation includes registry input/output contracts", () => {
    const r = run(["schema", "chats.create"]);
    assert.equal(r.status, 0, r.stderr);
    const json = JSON.parse(r.stdout);
    assert.equal(json.ok, true);
    assert.equal(json.data.operationId, "chats.create");
    assert.equal(json.data.request.contentType, "application/json");
    assert.equal(json.data.error.contentType, "application/problem+json");
    assert.ok(json.data.request.body);
    assert.ok(json.data.response.success);
    assert.ok(String(json.data.examples?.typed ?? "").includes("chats create"));
  });

  it("typed command tree resolves registry operationIds", () => {
    const r = run(["trading", "traders", "list", "--dry-run"]);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const json = JSON.parse(r.stdout);
    assert.equal(json.ok, true);
    assert.equal(json.data.dryRun, true);
    assert.equal(json.data.operationId, "trading.traders.list");
    assert.equal(json.data.method, "GET");
    assert.equal(json.data.path, "/api/v1/trading/traders");
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

  it("raw api rejects unknown /api/v1 paths", () => {
    const r = run(["api", "GET", "/api/v1/totally-unknown-endpoint"]);
    assert.notEqual(r.status, 0);
    const err = JSON.parse(r.stderr || r.stdout);
    assert.equal(err.ok, false);
    assert.ok(
      String(err.error?.subtype ?? "").includes("facade") ||
        String(err.error?.message ?? "")
          .toLowerCase()
          .includes("facade")
    );
  });

  it("raw api rejects path-traversal smuggle via facility prefix", () => {
    for (const path of [
      "/api/v1/me/../totally-unknown-endpoint",
      "/api/v1/me/../../totally-unknown",
      "/api/v1/me/%2e%2e/totally-unknown-endpoint",
    ]) {
      const r = run(["api", "GET", path, "--dry-run"]);
      assert.notEqual(r.status, 0, path);
      assert.equal(r.status, 77, path);
      const err = JSON.parse(r.stderr || r.stdout);
      assert.equal(err.ok, false, path);
      assert.ok(
        String(err.error?.subtype ?? "").includes("facade") ||
          String(err.error?.type ?? "").includes("authorization") ||
          String(err.error?.message ?? "")
            .toLowerCase()
            .includes("facade"),
        path + " " + (r.stderr || r.stdout)
      );
    }
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

  it("uncataloged mutating raw api without --yes is blocked", () => {
    // POST /api/v1/me is allowlisted (GET me.whoami) but has no catalog write
    // operation → unknown risk → confirmation required.
    const r = run(["api", "POST", "/api/v1/me", "--body", "{}"]);
    assert.equal(r.status, 10, r.stderr + r.stdout);
    const err = JSON.parse(r.stderr);
    assert.equal(err.ok, false);
    assert.equal(err.error.type, "confirmation");
  });

  it("auth login --browser fails closed without leaking a verifier", () => {
    const r = run(["auth", "login", "--browser", "--profile", "local"], {
      ALPHAFOX_TEST_BROWSER_OPEN: "fail",
      ALPHAFOX_BROWSER_LOGIN_TIMEOUT_MS: "2000",
    });
    assert.notEqual(r.status, 0, r.stdout + r.stderr);
    const blob = `${r.stdout}${r.stderr}`;
    assert.equal(blob.includes("code_verifier"), false);
    assert.equal(blob.toLowerCase().includes("refresh_token"), false);
    const err = JSON.parse(r.stderr);
    assert.equal(err.ok, false);
    assert.equal(err.error.subtype, "browser_open_failed");
    assert.equal(typeof err.error.details?.authorizeUrl, "string");
    assert.match(
      err.error.details.authorizeUrl,
      /^http:\/\/127\.0\.0\.1:3000\/api\/auth\/oauth\/authorize\?/
    );
  });

  it("uncataloged mutation with --yes passes confirmation (dry-run)", () => {
    const r = run([
      "api",
      "POST",
      "/api/v1/me",
      "--body",
      "{}",
      "--yes",
      "--dry-run",
    ]);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const json = JSON.parse(r.stdout);
    assert.equal(json.ok, true);
    assert.equal(json.data.dryRun, true);
    assert.equal(json.data.risk, "unknown");
  });
});
