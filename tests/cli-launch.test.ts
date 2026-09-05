import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { describe, it } from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Works from both source (tests/) and compiled (dist-test/tests/) layouts.
const cliPath = join(__dirname, "..", "..", "dist", "cli.js");

function run(args: string[], extraEnv: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      ALPHAFOX_FORCE_FILE_KEYCHAIN: "1",
      ALPHAFOX_SKIP_UPDATE_CHECK: extraEnv.ALPHAFOX_SKIP_UPDATE_CHECK ?? "1",
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

  it("rejects malformed global flags and unknown built-in arguments", () => {
    const invalidFormat = run(["version", "--format", "yaml"]);
    assert.equal(invalidFormat.status, 64, invalidFormat.stderr + invalidFormat.stdout);
    assert.equal(JSON.parse(invalidFormat.stderr).error.subtype, "invalid_format");

    const missingFormat = run(["version", "--format"]);
    assert.equal(missingFormat.status, 64, missingFormat.stderr + missingFormat.stdout);
    assert.equal(JSON.parse(missingFormat.stderr).error.subtype, "missing_flag_value");

    const blankJq = run(["version", "--jq", "   "]);
    assert.equal(blankJq.status, 64, blankJq.stderr + blankJq.stdout);
    assert.equal(JSON.parse(blankJq.stderr).error.subtype, "missing_flag_value");

    const blankEndpoint = run(["version", "--unsafe-custom-endpoint", "   "]);
    assert.equal(blankEndpoint.status, 64, blankEndpoint.stderr + blankEndpoint.stdout);
    assert.equal(
      JSON.parse(blankEndpoint.stderr).error.subtype,
      "missing_flag_value"
    );

    const unknown = run(["version", "--definitely-not-real"]);
    assert.equal(unknown.status, 64, unknown.stderr + unknown.stdout);
    assert.equal(JSON.parse(unknown.stderr).error.subtype, "unexpected_argument");

    const help = run(["doctor", "--help"]);
    assert.equal(help.status, 0, help.stderr + help.stdout);
    assert.equal(JSON.parse(help.stdout).data.name, "doctor");

    const authHelp = run(["auth", "login", "--help"]);
    assert.equal(authHelp.status, 0, authHelp.stderr + authHelp.stdout);
    assert.equal(JSON.parse(authHelp.stdout).data.name, "auth");

    const authUnknown = run(["auth", "login", "--definitely-not-real"]);
    assert.equal(authUnknown.status, 64, authUnknown.stderr + authUnknown.stdout);
    assert.equal(JSON.parse(authUnknown.stderr).error.subtype, "unknown_auth_flag");

    const invalidProfile = run(["version", "--profile", "elsewhere"]);
    assert.equal(invalidProfile.status, 64, invalidProfile.stderr + invalidProfile.stdout);
    assert.equal(JSON.parse(invalidProfile.stderr).error.subtype, "invalid_profile");

    const typedPrefixUnknown = run(["trading", "--definitely-not-real"]);
    assert.equal(
      typedPrefixUnknown.status,
      64,
      typedPrefixUnknown.stderr + typedPrefixUnknown.stdout
    );
    assert.equal(
      JSON.parse(typedPrefixUnknown.stderr).error.subtype,
      "unknown_operation_flag"
    );

    const rootHelp = run(["--help"]);
    assert.equal(rootHelp.status, 0, rootHelp.stderr + rootHelp.stdout);

    const rootHelpUnknown = run(["help", "--definitely-not-real"]);
    assert.equal(
      rootHelpUnknown.status,
      64,
      rootHelpUnknown.stderr + rootHelpUnknown.stdout
    );
    assert.equal(
      JSON.parse(rootHelpUnknown.stderr).error.subtype,
      "unexpected_argument"
    );

    const typedPrefixHelp = run(["trading", "--help"]);
    assert.equal(
      typedPrefixHelp.status,
      0,
      typedPrefixHelp.stderr + typedPrefixHelp.stdout
    );
  });

  it("install --help describes the wizard and skills path", () => {
    const r = run(["install", "--help"]);
    assert.equal(r.status, 0, r.stderr);
    const json = JSON.parse(r.stdout);
    assert.equal(json.ok, true);
    assert.equal(json.data.name, "install");
    assert.ok(
      json.data.usage.some((line: string) =>
        line.includes("npx @alphafox/cli@latest install")
      )
    );
    assert.match(String(json.data.description), /Skills manifest/);
  });

  it("install rejects unknown flags without contacting npm", () => {
    const r = run(["install", "--please-break"]);
    assert.equal(r.status, 64, r.stderr + r.stdout);
    const err = JSON.parse(r.stderr);
    assert.equal(err.ok, false);
    assert.equal(err.error.subtype, "unknown_install_flag");
  });

  it("skills status reports the co-versioned local bundle without mutation", () => {
    const root = mkdtempSync(join(tmpdir(), "alphafox-cli-skills-status-"));
    const r = run(["skills", "status"], {
      ALPHAFOX_CONFIG_DIR: join(root, "config"),
      ALPHAFOX_SKILLS_DIR: join(root, "installed"),
    });
    assert.equal(r.status, 0, r.stderr);
    const json = JSON.parse(r.stdout);
    assert.equal(json.ok, true);
    assert.equal(json.data.bundleVersion, json.data.skills[0].expectedVersion);
    assert.ok(json.data.summary.missing > 0);
    assert.ok(Array.isArray(json.data.agentLinks));
    assert.equal(json.data.agentLinks[0]?.id, "claude-code");
    assert.equal(json.data.restartRequired, true);
    rmSync(root, { recursive: true, force: true });
  });

  it("keeps version JSON clean when a recent update check is already cached", () => {
    const root = mkdtempSync(join(tmpdir(), "alphafox-cli-update-cache-"));
    writeFileSync(
      join(root, "update-check.json"),
      JSON.stringify({
        schemaVersion: 1,
        checkedAt: new Date().toISOString(),
        currentVersion: "0.3.5",
        latestVersion: "0.3.6",
        updateAvailable: true,
      })
    );
    const r = run(["version"], {
      ALPHAFOX_CONFIG_DIR: root,
      ALPHAFOX_SKIP_UPDATE_CHECK: "0",
    });
    assert.equal(r.status, 0, r.stderr);
    const json = JSON.parse(r.stdout);
    assert.equal(json.ok, true);
    assert.equal(json.data.name, "alphafox");
    assert.equal(r.stderr.includes("update available"), false);
    rmSync(root, { recursive: true, force: true });
  });

  it("update help exposes check and pinned-version modes without contacting npm", () => {
    const r = run(["update", "--help"]);
    assert.equal(r.status, 0, r.stderr);
    const json = JSON.parse(r.stdout);
    assert.equal(json.ok, true);
    assert.equal(json.data.name, "update");
    assert.ok(
      json.data.usage.some((line: string) => line.includes("--check"))
    );
    assert.ok(
      json.data.usage.some((line: string) => line.includes("--version"))
    );
  });

  it("doctor exits 0 and reports profile", () => {
    const r = run(["doctor"]);
    assert.equal(r.status, 0, r.stderr);
    const json = JSON.parse(r.stdout);
    assert.equal(json.ok, true);
    assert.equal(json.data.ok, true);
    assert.ok(Array.isArray(json.data.checks));
  });

  it("fails closed before profile commands can serialize nested credentials", () => {
    const root = mkdtempSync(join(tmpdir(), "alphafox-cli-config-secrets-"));
    const secret = "must-not-reach-output";
    writeFileSync(
      join(root, "config.json"),
      JSON.stringify({
        activeProfile: "staging",
        profiles: { staging: { apiKey: secret } },
      })
    );
    try {
      const profile = run(["profile", "list"], { ALPHAFOX_CONFIG_DIR: root });
      assert.notEqual(profile.status, 0, profile.stderr + profile.stdout);
      assert.equal(`${profile.stdout}${profile.stderr}`.includes(secret), false);

      const doctor = run(["doctor"], { ALPHAFOX_CONFIG_DIR: root });
      assert.notEqual(doctor.status, 0, doctor.stderr + doctor.stdout);
      assert.equal(`${doctor.stdout}${doctor.stderr}`.includes(secret), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("schema lists operationIds", () => {
    const r = run(["schema"]);
    assert.equal(r.status, 0, r.stderr);
    const json = JSON.parse(r.stdout);
    assert.equal(json.ok, true);
    assert.ok(json.data.operations.includes("me.whoami"));
    assert.ok(json.data.operations.includes("trading.traders.create"));
    assert.equal(json.data.operations.includes("chats.create"), false);
    assert.equal(json.data.operations.includes("backtests.create"), false);
    assert.equal(
      json.data.operations.includes("strategy_plaza.publications.list"),
      false
    );
    assert.ok(json.data.operations.length > 24);
    assert.equal(json.data.contractVersion, "2026-08-31");
  });

  it("schema rejects omitted chat operations", () => {
    const r = run(["schema", "chats.create"]);
    assert.notEqual(r.status, 0, r.stdout + r.stderr);
    const err = JSON.parse(r.stderr);
    assert.equal(err.ok, false);
    assert.equal(err.error.type, "not_found");
  });

  it("schema for an operation includes registry input/output contracts", () => {
    const r = run(["schema", "trading.traders.byId.start"]);
    assert.equal(r.status, 0, r.stderr);
    const json = JSON.parse(r.stdout);
    assert.equal(json.ok, true);
    assert.equal(json.data.operationId, "trading.traders.byId.start");
    assert.equal(json.data.request.contentType, "application/json");
    assert.equal(json.data.error.contentType, "application/problem+json");
    assert.ok(json.data.request.body);
    assert.ok(json.data.response.success);
    assert.ok(
      String(json.data.examples?.typed ?? "").includes("traders byId start")
    );
  });

  it("typed command tree resolves registry operationIds and query flags", () => {
    const r = run([
      "trading",
      "traders",
      "list",
      "--limit",
      "2",
      "--dry-run",
    ]);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const json = JSON.parse(r.stdout);
    assert.equal(json.ok, true);
    assert.equal(json.data.dryRun, true);
    assert.equal(json.data.operationId, "trading.traders.list");
    assert.equal(json.data.method, "GET");
    assert.equal(json.data.path, "/api/v1/trading/traders?limit=2");
  });

  it("rejects unknown typed write flags before confirmation or HTTP", () => {
    const r = run(
      [
        "trading",
        "traders",
        "start",
        "--traderId",
        "t1",
        "--dry-rnu",
        "--body",
        '{"reason":"resume"}',
        "--yes",
        "--profile",
        "local",
      ],
      { ALPHAFOX_LOCAL_ORIGIN: "http://127.0.0.1:1" }
    );
    assert.equal(r.status, 64, r.stderr + r.stdout);
    assert.equal(JSON.parse(r.stderr).error.subtype, "unknown_operation_flag");
  });

  it("rejects single-dash typed write flags before confirmation or HTTP", () => {
    const r = run([
      "trading",
      "traders",
      "start",
      "-x",
      "--traderId",
      "t1",
      "--yes",
    ]);
    assert.equal(r.status, 64, r.stderr + r.stdout);
    assert.equal(JSON.parse(r.stderr).error.subtype, "unknown_operation_flag");
  });

  it("honors typed help after operation flags without contacting HTTP", () => {
    const r = run([
      "trading",
      "traders",
      "start",
      "--traderId",
      "t1",
      "--help",
    ]);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.equal(JSON.parse(r.stdout).data.operationId, "trading.traders.byId.start");
  });

  it("rejects unknown raw api arguments before routing or HTTP", () => {
    const r = run([
      "api",
      "GET",
      "/api/v1/me",
      "--definitely-not-real",
      "value",
      "--dry-run",
    ]);
    assert.equal(r.status, 64, r.stderr + r.stdout);
    assert.equal(JSON.parse(r.stderr).error.subtype, "unknown_api_flag");
  });

  it("rejects unsupported raw api methods before HTTP", () => {
    const r = run(["api", "TRACE", "/api/v1/me", "--dry-run"]);
    assert.equal(r.status, 64, r.stderr + r.stdout);
    assert.equal(JSON.parse(r.stderr).error.subtype, "invalid_method");
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

  it("direct Passivbot admin write stays uncataloged and high-risk", () => {
    const path = "/api/admin/passivbot-paper-acceptance-traders";
    const body = JSON.stringify({
      name: "Passivbot paper acceptance",
      exchangeConnectorId: "connector-1",
      configSchemaVersion: 1,
      config: {},
      autoStart: true,
    });
    const blocked = run(["api", "POST", path, "--body", body]);
    assert.equal(blocked.status, 10, blocked.stderr + blocked.stdout);
    assert.equal(JSON.parse(blocked.stderr).error.type, "confirmation");

    const preview = run([
      "api",
      "POST",
      path,
      "--body",
      body,
      "--dry-run",
    ]);
    assert.equal(preview.status, 0, preview.stderr + preview.stdout);
    const result = JSON.parse(preview.stdout);
    assert.equal(result.data.path, path);
    assert.deepEqual(result.data.body, JSON.parse(body));

    const facade = run([
      "api",
      "POST",
      "/api/v1/admin/passivbot-paper-acceptance-traders",
      "--body",
      body,
      "--dry-run",
    ]);
    assert.equal(facade.status, 77, facade.stderr + facade.stdout);
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

  it("write body is validated against catalog before dry-run", () => {
    const missing = run([
      "api",
      "POST",
      "/api/v1/trading/traders",
      "--body",
      "{}",
      "--dry-run",
    ]);
    assert.equal(missing.status, 64, missing.stderr + missing.stdout);
    const missingErr = JSON.parse(missing.stderr);
    assert.equal(missingErr.error.subtype, "body_schema");

    const extra = run([
      "trading",
      "traders",
      "start",
      "--traderId",
      "t1",
      "--body",
      '{"startType":"manual_start","invented":1}',
      "--dry-run",
    ]);
    assert.equal(extra.status, 64, extra.stderr + extra.stdout);
    const extraErr = JSON.parse(extra.stderr);
    assert.equal(extraErr.error.subtype, "body_schema");

    const ok = run([
      "trading",
      "traders",
      "start",
      "--traderId",
      "t1",
      "--body",
      "{}",
      "--dry-run",
    ]);
    assert.equal(ok.status, 0, ok.stderr + ok.stdout);
    const json = JSON.parse(ok.stdout);
    assert.equal(json.data.dryRun, true);
    assert.equal(json.data.operationId, "trading.traders.byId.start");
    assert.deepEqual(json.data.body, {});
  });

  it("uncataloged write with a non-empty body fails closed", () => {
    const r = run([
      "api",
      "POST",
      "/api/v1/me",
      "--body",
      '{"invented":true}',
      "--yes",
      "--dry-run",
    ]);
    assert.equal(r.status, 64, r.stderr + r.stdout);
    const err = JSON.parse(r.stderr);
    assert.equal(err.error.subtype, "body_schema_missing");
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
