import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  accessTokenNeedsRefresh,
  clearRefreshInflightForTests,
} from "../src/auth/refresh";
import type { ProfileConfig } from "../src/config/profiles";
import { apiRequest } from "../src/http/client";
import { CATALOG_SOURCE, COMPATIBILITY_RANGE } from "../src/catalog/operations";
import { loadTokens, saveTokens } from "../src/keychain/store";

const profile: ProfileConfig = {
  name: "production",
  apiBaseUrl: "https://alphafox.app/api/v1",
  issuer: "https://alphafox.app/api/auth",
  audience: "https://alphafox.app/api/v1",
  clientId: "alphafox-cli-prod",
};

function deployedMetadata(): Response {
  return new Response(
    JSON.stringify({
      environment: "production",
      contractVersion: COMPATIBILITY_RANGE.contractVersion,
      registryVersion: COMPATIBILITY_RANGE.registryVersion,
      openapi: COMPATIBILITY_RANGE.openapi,
      minCliVersion: COMPATIBILITY_RANGE.minCliVersion,
      maxCliVersion: COMPATIBILITY_RANGE.maxCliVersion,
      contractsSha: CATALOG_SOURCE.contractsSha,
    }),
    { status: 200 }
  );
}

function fileKeychainEnv(): NodeJS.ProcessEnv {
  const dir = mkdtempSync(join(tmpdir(), "alphafox-cli-refresh-"));
  return {
    ALPHAFOX_FORCE_FILE_KEYCHAIN: "1",
    ALPHAFOX_KEYCHAIN_DIR: dir,
  };
}

test("accessTokenNeedsRefresh is true within skew window", () => {
  const now = 1_000_000;
  assert.equal(
    accessTokenNeedsRefresh(
      {
        accessToken: "a",
        refreshToken: "r",
        expiresAt: now + 30_000,
        environment: "production",
        issuer: profile.issuer,
        audience: profile.audience,
        clientId: profile.clientId,
        scopes: ["openid"],
      },
      now
    ),
    true
  );
  assert.equal(
    accessTokenNeedsRefresh(
      {
        accessToken: "a",
        refreshToken: "r",
        expiresAt: now + 120_000,
        environment: "production",
        issuer: profile.issuer,
        audience: profile.audience,
        clientId: profile.clientId,
        scopes: ["openid"],
      },
      now
    ),
    false
  );
  assert.equal(
    accessTokenNeedsRefresh(
      {
        accessToken: "a",
        refreshToken: "",
        expiresAt: now,
        environment: "production",
        issuer: profile.issuer,
        audience: profile.audience,
        clientId: profile.clientId,
        scopes: ["openid"],
      },
      now
    ),
    false
  );
});

test("apiRequest proactively refreshes near-expiry access tokens", async () => {
  clearRefreshInflightForTests();
  const env = fileKeychainEnv();
  try {
    saveTokens(profile, {
      accessToken: "old-access",
      refreshToken: "old-refresh",
      expiresAt: Date.now() - 1_000,
      environment: "production",
      issuer: profile.issuer,
      audience: profile.audience,
      clientId: profile.clientId,
      scopes: ["openid", "profile", "offline_access"],
    },
    env);

    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.endsWith("/api/v1/meta")) return deployedMetadata();
      if (url.endsWith("/api/auth/oauth/token")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          grant_type?: string;
          refresh_token?: string;
        };
        assert.equal(body.grant_type, "refresh_token");
        assert.equal(body.refresh_token, "old-refresh");
        return new Response(
          JSON.stringify({
            access_token: "new-access",
            refresh_token: "new-refresh",
            token_type: "Bearer",
            expires_in: 600,
            scope: "openid profile offline_access",
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      if (url.endsWith("/api/v1/me") || url.includes("/api/v1/me")) {
        const auth = new Headers(init?.headers).get("authorization");
        assert.equal(auth, "Bearer new-access");
        return new Response(JSON.stringify({ userId: "u1" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("nope", { status: 404 });
    };

    const res = await apiRequest(
      { method: "GET", path: "/api/v1/me", profile },
      env,
      fetchImpl
    );
    assert.equal(res.status, 200);
    assert.equal((res.json as { userId: string }).userId, "u1");
    assert.ok(calls.some((c) => c.includes("/api/auth/oauth/token")));
    const stored = loadTokens(profile, env);
    assert.equal(stored?.accessToken, "new-access");
    assert.equal(stored?.refreshToken, "new-refresh");
  } finally {
    rmSync(env.ALPHAFOX_KEYCHAIN_DIR!, { recursive: true, force: true });
    clearRefreshInflightForTests();
  }
});

test("apiRequest retries once after 401 via refresh_token", async () => {
  clearRefreshInflightForTests();
  const env = fileKeychainEnv();
  try {
    saveTokens(profile, {
      accessToken: "stale-access",
      refreshToken: "live-refresh",
      // Still "fresh" by clock so proactive path skips; server returns 401.
      expiresAt: Date.now() + 10 * 60_000,
      environment: "production",
      issuer: profile.issuer,
      audience: profile.audience,
      clientId: profile.clientId,
      scopes: ["openid", "profile", "offline_access"],
    },
    env);

    let meHits = 0;
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith("/api/v1/meta")) return deployedMetadata();
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
        meHits += 1;
        const auth = new Headers(init?.headers).get("authorization");
        if (meHits === 1) {
          assert.equal(auth, "Bearer stale-access");
          return new Response(JSON.stringify({ code: "unauthorized" }), {
            status: 401,
            headers: { "content-type": "application/json" },
          });
        }
        assert.equal(auth, "Bearer fresh-access");
        return new Response(JSON.stringify({ userId: "u2" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("nope", { status: 404 });
    };

    const res = await apiRequest(
      { method: "GET", path: "/api/v1/me", profile },
      env,
      fetchImpl
    );
    assert.equal(res.status, 200);
    assert.equal((res.json as { userId: string }).userId, "u2");
    assert.equal(meHits, 2);
    assert.equal(loadTokens(profile, env)?.accessToken, "fresh-access");
  } finally {
    rmSync(env.ALPHAFOX_KEYCHAIN_DIR!, { recursive: true, force: true });
    clearRefreshInflightForTests();
  }
});

test("mutation 401 does not replay without keyed catalog idempotency", async () => {
  clearRefreshInflightForTests();
  const env = fileKeychainEnv();
  try {
    saveTokens(
      profile,
      {
        accessToken: "stale-access",
        refreshToken: "live-refresh",
        expiresAt: Date.now() + 10 * 60_000,
        environment: "production",
        issuer: profile.issuer,
        audience: profile.audience,
        clientId: profile.clientId,
        scopes: ["openid", "profile", "offline_access"],
      },
      env
    );
    let calls = 0;
    const res = await apiRequest(
      {
        method: "POST",
        path: "/api/v1/engine-backtest/experiments",
        body: { name: "x" },
        profile,
      },
      env,
      async () => {
        calls += 1;
        return new Response(JSON.stringify({ code: "unauthorized" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        });
      }
    );
    assert.equal(res.status, 401);
    assert.equal(calls, 1);
  } finally {
    rmSync(env.ALPHAFOX_KEYCHAIN_DIR!, { recursive: true, force: true });
    clearRefreshInflightForTests();
  }
});

test("keyed catalog-idempotent mutation refreshes once and replays with same key", async () => {
  clearRefreshInflightForTests();
  const env = fileKeychainEnv();
  try {
    saveTokens(
      profile,
      {
        accessToken: "stale-access",
        refreshToken: "live-refresh",
        expiresAt: Date.now() + 10 * 60_000,
        environment: "production",
        issuer: profile.issuer,
        audience: profile.audience,
        clientId: profile.clientId,
        scopes: ["openid", "profile", "offline_access"],
      },
      env
    );
    const seen: Array<{ url: string; key: string | null }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      if (url.includes("/api/auth/oauth/token")) {
        return new Response(
          JSON.stringify({
            access_token: "fresh-access",
            refresh_token: "rotated-refresh",
            expires_in: 600,
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      seen.push({ url, key: headers.get("idempotency-key") });
      if (seen.length === 1) {
        return new Response(JSON.stringify({ code: "unauthorized" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ id: "experiment-1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const res = await apiRequest(
      {
        method: "POST",
        path: "/api/v1/engine-backtest/experiments",
        body: { name: "x" },
        profile,
        catalogIdempotent: true,
        operationId: "engine_backtest.experiments.create",
        idempotencyKey: "stable-key",
      },
      env,
      fetchImpl
    );
    assert.equal(res.status, 200);
    assert.deepEqual(seen.map((item) => item.key), ["stable-key", "stable-key"]);
  } finally {
    rmSync(env.ALPHAFOX_KEYCHAIN_DIR!, { recursive: true, force: true });
    clearRefreshInflightForTests();
  }
});
