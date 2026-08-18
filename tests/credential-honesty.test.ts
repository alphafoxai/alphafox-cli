import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  accessTokenNeedsRefresh,
  clearRefreshInflightForTests,
  refreshStoredTokens,
} from "../src/auth/refresh";
import { runCli } from "../src/commands/run";
import type { ProfileConfig } from "../src/config/profiles";
import {
  getLastTokenSaveResult,
  loadTokens,
  saveTokens,
} from "../src/keychain/store";

const profile: ProfileConfig = {
  name: "local",
  apiBaseUrl: "http://127.0.0.1:3000/api/v1",
  issuer: "http://127.0.0.1:3000/api/auth",
  audience: "http://127.0.0.1:3000/api/v1",
  clientId: "alphafox-cli-local",
};

function sampleTokens(overrides: Partial<ReturnType<typeof loadTokens>> = {}) {
  return {
    accessToken: "access-1",
    refreshToken: "refresh-1",
    expiresAt: Date.now() + 60_000,
    environment: "local",
    issuer: profile.issuer,
    audience: profile.audience,
    clientId: profile.clientId,
    scopes: ["openid", "profile"],
    ...overrides,
  };
}

describe("credential honesty", () => {
  it("file keychain save reports backend and degraded flag", () => {
    const dir = mkdtempSync(join(tmpdir(), "alphafox-cli-cred-"));
    const env = {
      ALPHAFOX_FORCE_FILE_KEYCHAIN: "1",
      ALPHAFOX_KEYCHAIN_DIR: dir,
    };
    try {
      const result = saveTokens(profile, sampleTokens(), env);
      assert.equal(result.backend, "file");
      assert.equal(result.degraded, false); // intentional force-file
      assert.ok(result.path?.includes(profile.name));
      assert.equal(getLastTokenSaveResult()?.backend, "file");
      assert.equal(loadTokens(profile, env)?.accessToken, "access-1");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails closed when the OS keychain is unavailable", () => {
    const dir = mkdtempSync(join(tmpdir(), "alphafox-cli-cred-deg-"));
    const env: NodeJS.ProcessEnv = {
      ALPHAFOX_KEYCHAIN_PLATFORM: "linux",
      ALPHAFOX_SECRET_TOOL: join(dir, "missing-secret-tool"),
      ALPHAFOX_KEYCHAIN_DIR: dir,
    };
    try {
      assert.throws(
        () => saveTokens(profile, sampleTokens(), env),
        (error: Error & { subtype?: string }) =>
          error.subtype === "keychain_unavailable"
      );
      assert.equal(getLastTokenSaveResult()?.degraded ?? false, false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refresh returns failed outcome on HTTP error — not success tokens", async () => {
    clearRefreshInflightForTests();
    const dir = mkdtempSync(join(tmpdir(), "alphafox-cli-refresh-fail-"));
    const env = {
      ALPHAFOX_FORCE_FILE_KEYCHAIN: "1",
      ALPHAFOX_KEYCHAIN_DIR: dir,
    };
    try {
      saveTokens(profile, sampleTokens({ expiresAt: Date.now() - 1 }), env);
      const outcome = await refreshStoredTokens(
        profile,
        env,
        async () =>
          new Response(JSON.stringify({ error: "invalid_grant" }), {
            status: 400,
          }),
        { force: true }
      );
      assert.equal(outcome.status, "failed");
      assert.equal(outcome.reason, "http_400");
      // Must not report refreshed/unchanged success.
      assert.notEqual(outcome.status, "refreshed");
      assert.ok(
        outcome.status === "failed" &&
          outcome.tokens?.accessToken === "access-1"
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
      clearRefreshInflightForTests();
    }
  });

  it("refresh returns failed on network throw", async () => {
    clearRefreshInflightForTests();
    const dir = mkdtempSync(join(tmpdir(), "alphafox-cli-refresh-net-"));
    const env = {
      ALPHAFOX_FORCE_FILE_KEYCHAIN: "1",
      ALPHAFOX_KEYCHAIN_DIR: dir,
    };
    try {
      saveTokens(profile, sampleTokens({ expiresAt: 0 }), env);
      const outcome = await refreshStoredTokens(
        profile,
        env,
        async () => {
          throw new Error("ECONNREFUSED");
        },
        { force: true }
      );
      assert.equal(outcome.status, "failed");
      assert.ok(String(outcome.reason).includes("ECONNREFUSED"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
      clearRefreshInflightForTests();
    }
  });

  it("refresh returns no_session without refresh token", async () => {
    clearRefreshInflightForTests();
    const dir = mkdtempSync(join(tmpdir(), "alphafox-cli-refresh-none-"));
    const env = {
      ALPHAFOX_FORCE_FILE_KEYCHAIN: "1",
      ALPHAFOX_KEYCHAIN_DIR: dir,
    };
    try {
      saveTokens(profile, sampleTokens({ refreshToken: "" }), env);
      const outcome = await refreshStoredTokens(profile, env, async () => {
        throw new Error("should not fetch");
      });
      assert.equal(outcome.status, "no_session");
      assert.equal(outcome.tokens, null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      clearRefreshInflightForTests();
    }
  });

  it("accessTokenNeedsRefresh stays false without RT", () => {
    assert.equal(
      accessTokenNeedsRefresh(
        sampleTokens({ refreshToken: "", expiresAt: 0 }),
        Date.now()
      ),
      false
    );
  });

  it("logout does not claim clean remote logout when revoke fails", async () => {
    const dir = mkdtempSync(join(tmpdir(), "alphafox-cli-logout-"));
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ALPHAFOX_FORCE_FILE_KEYCHAIN: "1",
      ALPHAFOX_SKIP_UPDATE_CHECK: "1",
      ALPHAFOX_KEYCHAIN_DIR: dir,
      ALPHAFOX_CONFIG_DIR: join(dir, "cfg"),
    };
    const originalFetch = globalThis.fetch;
    const chunks: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((
      chunk: string | Uint8Array,
      ...args: unknown[]
    ) => {
      chunks.push(String(chunk));
      return (origWrite as (...a: unknown[]) => boolean)(chunk, ...args);
    }) as typeof process.stdout.write;
    try {
      saveTokens(profile, sampleTokens(), env);
      globalThis.fetch = (async () =>
        new Response(JSON.stringify({ error: "server_error" }), {
          status: 500,
        })) as typeof fetch;

      const code = await runCli(
        ["auth", "logout", "--profile", "local"],
        env
      );
      assert.equal(code, 1);
      const out = chunks.join("");
      const json = JSON.parse(out.trim().split("\n").pop()!);
      assert.equal(json.ok, true);
      assert.equal(json.data.localCleared, true);
      assert.equal(json.data.remoteRevoke, "failed");
      assert.equal(json.data.fullyLoggedOut, false);
      assert.equal(json.data.loggedOut, false);
      assert.equal(loadTokens(profile, env), null);
    } finally {
      globalThis.fetch = originalFetch;
      process.stdout.write = origWrite;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("logout reports fullyLoggedOut when no refresh token", async () => {
    const dir = mkdtempSync(join(tmpdir(), "alphafox-cli-logout-skip-"));
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ALPHAFOX_FORCE_FILE_KEYCHAIN: "1",
      ALPHAFOX_SKIP_UPDATE_CHECK: "1",
      ALPHAFOX_KEYCHAIN_DIR: dir,
      ALPHAFOX_CONFIG_DIR: join(dir, "cfg"),
    };
    const chunks: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((
      chunk: string | Uint8Array,
      ...args: unknown[]
    ) => {
      chunks.push(String(chunk));
      return (origWrite as (...a: unknown[]) => boolean)(chunk, ...args);
    }) as typeof process.stdout.write;
    try {
      // no tokens at all → remoteRevoke skipped
      const code = await runCli(
        ["auth", "logout", "--profile", "local"],
        env
      );
      assert.equal(code, 0);
      const json = JSON.parse(chunks.join("").trim().split("\n").pop()!);
      assert.equal(json.data.remoteRevoke, "skipped");
      assert.equal(json.data.fullyLoggedOut, true);
      assert.equal(json.data.loggedOut, true);
    } finally {
      process.stdout.write = origWrite;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
