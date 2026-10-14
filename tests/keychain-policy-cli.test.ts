import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { it } from "node:test";
import { saveTokens } from "../src/keychain/store";
import { apiRequest } from "../src/http/client";
import { refreshStoredTokens } from "../src/auth/refresh";
import { resolveProfile } from "../src/config/profiles";
import { runBrowserPkceLogin } from "../src/auth/browser-login";

const fixtureSecret = join(__dirname, "../../tests/fixtures/fake-secret-tool");
const cli = join(__dirname, "../../dist/cli.js");
const sample = {
  accessToken: "synthetic-access", refreshToken: "synthetic-refresh",
  expiresAt: Date.now() + 600_000, environment: "local",
  issuer: "http://127.0.0.1:3000/api/auth", audience: "http://127.0.0.1:3000/api/v1",
  clientId: "alphafox-cli-local", scopes: ["openid"],
};
function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), "alphafox-policy-cli-"));
  for (const sub of ["home", "tmp", "config", "fallback"]) mkdirSync(join(dir, sub));
  const env: NodeJS.ProcessEnv = {
    ...process.env, HOME: join(dir, "home"), TMPDIR: join(dir, "tmp"),
    ALPHAFOX_CONFIG_DIR: join(dir, "config"), ALPHAFOX_KEYCHAIN_DIR: join(dir, "fallback"),
    ALPHAFOX_KEYCHAIN_PLATFORM: "linux", ALPHAFOX_SECRET_TOOL: join(dir, "missing-secret-tool"),
    ALPHAFOX_REQUIRE_OS_KEYCHAIN: "1", ALPHAFOX_SKIP_UPDATE_CHECK: "1",
  };
  delete env.ALPHAFOX_FORCE_FILE_KEYCHAIN;
  delete env.ALPHAFOX_TEST_ACCESS_TOKEN;
  delete env.ALPHAFOX_TEST_REFRESH_TOKEN;
  return { dir, env, path: join(env.ALPHAFOX_KEYCHAIN_DIR!, "local.tokens.json"),
    cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
function run(args: string[], env: NodeJS.ProcessEnv) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    execFile(process.execPath, [cli, ...args, "--profile", "local", "--format", "json", "--no-input"],
      { env, timeout: 10_000 }, (error, stdout, stderr) => {
        if (error && typeof error.code !== "number") { reject(error); return; }
        resolve({ code: error ? Number(error.code) : 0, stdout, stderr });
      });
  });
}

async function oauthServer() {
  const calls: string[] = [];
  const server = createServer((req, res) => {
    calls.push(req.url!);
    req.resume();
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(req.url?.endsWith("/device/code") ? {
      device_code: "synthetic-device-code", interval: 0.001, expires_in: 5,
    } : { access_token: "rotated-access", refresh_token: "rotated-refresh", expires_in: 600 }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  return { calls, origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve())) };
}

it("strict doctor reads the OS keychain instead of forcing file mode", async () => {
  const box = sandbox();
  try {
    chmodSync(fixtureSecret, 0o755);
    const env = { ...box.env, ALPHAFOX_SECRET_TOOL: fixtureSecret, ALPHAFOX_FAKE_SECRET_DIR: join(box.dir, "fake-os") };
    saveTokens("local", sample, env);
    const result = await run(["doctor"], env);
    assert.equal(result.code, 0, result.stderr);
    const body = JSON.parse(result.stdout);
    assert.equal(body.data.ok, true);
    assert.match(body.data.checks.find((c: { name: string }) => c.name === "keychain").detail, /token present/);
  } finally { box.cleanup(); }
});

it("strict doctor reports unavailable keychain as failure, never promises fallback", async () => {
  const box = sandbox();
  try {
    const result = await run(["doctor"], box.env);
    assert.equal(result.code, 1);
    const body = JSON.parse(result.stdout);
    assert.equal(body.data.ok, false);
    const check = body.data.checks.find((c: { name: string }) => c.name === "osKeychain");
    assert.equal(check.ok, false);
    assert.match(check.detail, /required/);
    assert.doesNotMatch(check.detail, /file fallback \(0600\) if tokens are saved/);
  } finally { box.cleanup(); }
});

for (const args of [
  ["auth", "login", "--device-code", "synthetic-code"],
  ["auth", "login", "--code", "synthetic-code", "--code-verifier", "synthetic-verifier"],
  ["auth", "login"],
]) {
  it(`CLI ${args.join(" ")} never reports authenticated after strict save failure`, async () => {
    const box = sandbox();
    const server = await oauthServer();
    try {
      const result = await run(args, { ...box.env, ALPHAFOX_LOCAL_ORIGIN: server.origin });
      assert.equal(result.code, 1);
      assert.equal(JSON.parse(result.stderr).error.subtype, "os_keychain_required");
      assert.equal(JSON.parse(result.stderr).error.type, "credential_storage");
      assert.doesNotMatch(result.stdout, /"authenticated":true/);
      assert.doesNotMatch(result.stdout + result.stderr, /rotated-access|rotated-refresh/);
      assert.ok(server.calls.some((url) => url.endsWith("/token")));
      assert.equal(existsSync(box.path), false);
    } finally { await server.close(); box.cleanup(); }
  });
}

it("browser login propagates strict storage failure instead of returning authenticated", async () => {
  const box = sandbox();
  const server = await oauthServer();
  try {
    const env = { ...box.env, ALPHAFOX_LOCAL_ORIGIN: server.origin };
    await assert.rejects(runBrowserPkceLogin({
      profile: resolveProfile("local", env), env, timeoutMs: 5_000,
      openBrowser: async (url) => {
        const parsed = new URL(url);
        await fetch(`${parsed.searchParams.get("redirect_uri")}?code=synthetic-code&state=${parsed.searchParams.get("state")}`);
        return { ok: true };
      },
    }), { type: "credential_storage", subtype: "os_keychain_required" });
    assert.equal(existsSync(box.path), false);
  } finally { await server.close(); box.cleanup(); }
});

it("refresh storage failure rejects and stops product HTTP rather than reusing old access tokens", async () => {
  const box = sandbox();
  const server = await oauthServer();
  try {
    chmodSync(fixtureSecret, 0o755);
    const env = { ...box.env, ALPHAFOX_SECRET_TOOL: fixtureSecret, ALPHAFOX_FAKE_SECRET_DIR: join(box.dir, "fake-os"),
      ALPHAFOX_LOCAL_ORIGIN: server.origin };
    const profile = resolveProfile("local", env);
    saveTokens("local", { ...sample, expiresAt: 0, audience: profile.audience }, env);
    const failing = { ...env, ALPHAFOX_FAKE_SECRET_FAIL_STORE: "1" };
    await assert.rejects(refreshStoredTokens(profile, failing), {
      type: "credential_storage", subtype: "os_keychain_required",
    });
    await assert.rejects(apiRequest({ method: "GET", path: "/api/v1/me", profile }, failing), {
      type: "credential_storage", subtype: "os_keychain_required",
    });
    assert.deepEqual(server.calls, ["/api/auth/oauth/token", "/api/auth/oauth/token"]);
    assert.equal(existsSync(box.path), false);
    assert.equal(existsSync(join(box.env.ALPHAFOX_KEYCHAIN_DIR!, "local.refresh.lock")), false);
  } finally { await server.close(); box.cleanup(); }
});

for (const args of [["auth", "logout"], ["auth", "status"], ["doctor"]]) {
  it(`strict ${args.join(" ")} reports legacy-file refusal, not successful auth/logout`, async () => {
    const box = sandbox();
    const server = await oauthServer();
    try {
      writeFileSync(box.path, "not JSON: must not be read");
      const result = await run(args, { ...box.env, ALPHAFOX_LOCAL_ORIGIN: server.origin });
      assert.equal(result.code, 1);
      assert.equal(result.stdout, "");
      assert.equal(JSON.parse(result.stderr).error.subtype, "plaintext_credentials_disallowed");
      assert.equal(readFileSync(box.path, "utf8"), "not JSON: must not be read");
      assert.deepEqual(server.calls, []);
    } finally { await server.close(); box.cleanup(); }
  });
}

it("strict doctor surfaces explicit force-file conflict rather than hiding it", async () => {
  const box = sandbox();
  try {
    const result = await run(["doctor"], { ...box.env, ALPHAFOX_FORCE_FILE_KEYCHAIN: "1" });
    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    assert.equal(JSON.parse(result.stderr).error.subtype, "keychain_policy_conflict");
  } finally { box.cleanup(); }
});
