import assert from "node:assert/strict";
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  clearRefreshInflightForTests,
  refreshLockFilePath,
  refreshStoredTokens,
} from "../src/auth/refresh";
import { runCli } from "../src/commands/run";
import type { ProfileConfig } from "../src/config/profiles";
import { loadTokens, saveTokens } from "../src/keychain/store";

const profile: ProfileConfig = {
  name: "local",
  apiBaseUrl: "http://127.0.0.1:3000/api/v1",
  issuer: "http://127.0.0.1:3000/api/auth",
  audience: "http://127.0.0.1:3000/api/v1",
  clientId: "alphafox-cli-local",
};

function testEnv(): NodeJS.ProcessEnv {
  const dir = mkdtempSync(join(tmpdir(), "alphafox-cli-auth-status-"));
  return {
    ALPHAFOX_FORCE_FILE_KEYCHAIN: "1",
    ALPHAFOX_SKIP_UPDATE_CHECK: "1",
    ALPHAFOX_KEYCHAIN_DIR: dir,
    ALPHAFOX_CONFIG_DIR: join(dir, "cfg"),
  };
}

function staleTokens() {
  return {
    accessToken: "stale-access",
    refreshToken: "live-refresh",
    expiresAt: Date.now() - 5_000,
    environment: "local",
    issuer: profile.issuer,
    audience: profile.audience,
    clientId: profile.clientId,
    scopes: ["openid", "profile", "offline_access"],
  };
}

async function captureStatus(
  argv: string[],
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch
): Promise<{ readonly code: number; readonly json: Record<string, unknown> }> {
  const chunks: string[] = [];
  const origWrite = process.stdout.write.bind(process.stdout);
  const originalFetch = globalThis.fetch;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    chunks.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  globalThis.fetch = fetchImpl;
  try {
    const code = await runCli(argv, env);
    const raw = chunks.join("").trim().split("\n").pop() ?? "{}";
    return { code, json: JSON.parse(raw) as Record<string, unknown> };
  } finally {
    process.stdout.write = origWrite;
    globalThis.fetch = originalFetch;
  }
}

function rotatingFetch(): typeof fetch {
  return async (input) => {
    const url = String(input);
    if (url.includes("/api/auth/oauth/token")) {
      return new Response(
        JSON.stringify({
          access_token: "fresh-access",
          refresh_token: "rotated-refresh",
          expires_in: 600,
          scope: "openid profile offline_access",
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    if (url.includes("/api/v1/me")) {
      return new Response(JSON.stringify({ userId: "u-status" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("nope", { status: 404 });
  };
}

describe("auth status after idle", () => {
  it("refreshes a stale access token and reports a future expiresAt", async () => {
    clearRefreshInflightForTests();
    const env = testEnv();
    try {
      saveTokens(profile, staleTokens(), env);
      const { code, json } = await captureStatus(
        ["auth", "status", "--verify", "--profile", "local", "--no-input"],
        env,
        rotatingFetch()
      );
      assert.equal(code, 0);
      assert.equal(json.ok, true);
      const data = json.data as Record<string, unknown>;
      assert.equal(data.authenticated, true);
      assert.equal(data.verified, true);
      assert.equal(data.session, "active");
      assert.equal(data.refresh, "refreshed");
      assert.ok(
        Number(data.expiresAt) > Date.now() + 60_000,
        `expiresAt should be refreshed, got ${String(data.expiresAt)}`
      );
      assert.equal(loadTokens(profile, env)?.accessToken, "fresh-access");
    } finally {
      rmSync(env.ALPHAFOX_KEYCHAIN_DIR!, { recursive: true, force: true });
      clearRefreshInflightForTests();
    }
  });

  it("refreshes on status even without --verify so Agents do not treat expiry as logout", async () => {
    clearRefreshInflightForTests();
    const env = testEnv();
    try {
      saveTokens(profile, staleTokens(), env);
      const { json } = await captureStatus(
        ["auth", "status", "--profile", "local", "--no-input"],
        env,
        rotatingFetch()
      );
      const data = json.data as Record<string, unknown>;
      assert.equal(data.authenticated, true);
      assert.equal(data.session, "active");
      assert.ok(Number(data.expiresAt) > Date.now() + 60_000);
      assert.equal(data.verified, null);
    } finally {
      rmSync(env.ALPHAFOX_KEYCHAIN_DIR!, { recursive: true, force: true });
      clearRefreshInflightForTests();
    }
  });

  it("does not claim an active session when refresh fails", async () => {
    clearRefreshInflightForTests();
    const env = testEnv();
    try {
      saveTokens(profile, staleTokens(), env);
      const { json } = await captureStatus(
        ["auth", "status", "--verify", "--profile", "local", "--no-input"],
        env,
        async () =>
          new Response(JSON.stringify({ error: "invalid_grant" }), {
            status: 400,
            headers: { "content-type": "application/json" },
          })
      );
      const data = json.data as Record<string, unknown>;
      assert.equal(data.authenticated, false);
      assert.equal(data.session, "refresh_failed");
      assert.equal(data.refresh, "failed");
    } finally {
      rmSync(env.ALPHAFOX_KEYCHAIN_DIR!, { recursive: true, force: true });
      clearRefreshInflightForTests();
    }
  });

  it("waits for another process's refresh lock instead of rotating the same refresh token", async () => {
    clearRefreshInflightForTests();
    const env = testEnv();
    try {
      saveTokens(profile, staleTokens(), env);
      const lockPath = refreshLockFilePath(profile, env);
      writeFileSync(lockPath, `${process.pid}\n${Date.now()}\n`);
      let fetchCalls = 0;
      const pending = refreshStoredTokens(
        profile,
        env,
        async () => {
          fetchCalls += 1;
          return new Response("should-not-run", { status: 500 });
        },
        { force: true }
      );
      await new Promise((resolve) => setTimeout(resolve, 80));
      saveTokens(profile, {
        ...staleTokens(),
        accessToken: "from-other-process",
        refreshToken: "already-rotated",
        expiresAt: Date.now() + 600_000,
      },
      env);
      unlinkSync(lockPath);
      const outcome = await pending;
      assert.equal(outcome.status, "unchanged");
      assert.equal(outcome.tokens?.accessToken, "from-other-process");
      assert.equal(fetchCalls, 0);
    } finally {
      rmSync(env.ALPHAFOX_KEYCHAIN_DIR!, { recursive: true, force: true });
      clearRefreshInflightForTests();
    }
  });
});
