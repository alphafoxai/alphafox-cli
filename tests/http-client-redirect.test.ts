import assert from "node:assert/strict";
import test from "node:test";

import { CATALOG_SOURCE, COMPATIBILITY_RANGE } from "../src/catalog/operations";
import type { ProfileConfig } from "../src/config/profiles";
import { apiRequest } from "../src/http/client";

const profile: ProfileConfig = {
  name: "production",
  apiBaseUrl: "https://alphafox.app/api/v1",
  issuer: "https://alphafox.app/api/auth",
  audience: "https://alphafox.app/api/v1",
  clientId: "alphafox-cli-prod",
};

const canonicalProfile: ProfileConfig = {
  ...profile,
  apiBaseUrl: "https://www.alphafox.app/api/v1",
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

test("apiRequest follows the authorized AlphaFox apex-to-www read redirect", async () => {
  const seen: Array<{ url: string; authorization: string | null }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    seen.push({ url, authorization: headers.get("authorization") });
    if (url.endsWith("/api/v1/meta")) return deployedMetadata();
    if (url.startsWith("https://alphafox.app/")) {
      return new Response(null, {
        status: 308,
        headers: { location: "https://www.alphafox.app/api/v1/me" },
      });
    }
    return new Response(JSON.stringify({ userId: "user-1" }), { status: 200 });
  };
  const env = {
    ALPHAFOX_TEST_ACCESS_TOKEN: "test-access-token",
    ALPHAFOX_TEST_REFRESH_TOKEN: "refresh",
    ALPHAFOX_TEST_ISSUER: profile.issuer,
    ALPHAFOX_TEST_AUDIENCE: profile.audience,
    ALPHAFOX_TEST_CLIENT_ID: profile.clientId,
  };

  const res = await apiRequest(
    { method: "GET", path: "/api/v1/me", profile },
    env,
    fetchImpl
  );

  assert.equal(res.status, 200);
  assert.deepEqual(seen.map((call) => call.url), [
    "https://alphafox.app/api/v1/meta",
    "https://alphafox.app/api/v1/me",
    "https://www.alphafox.app/api/v1/me",
  ]);
  assert.equal(seen[0]?.authorization, null);
  assert.equal(seen[1]?.authorization, "Bearer test-access-token");
  assert.equal(seen[2]?.authorization, "Bearer test-access-token");
});

test("apiRequest never follows bearer redirects for arbitrary apex/www hosts", async () => {
  const customProfile = {
    ...profile,
    apiBaseUrl: "https://custom.example/api/v1",
    issuer: "https://custom.example/api/auth",
    audience: "https://custom.example/api/v1",
  };
  let operationalCalls = 0;
  const res = await apiRequest(
    { method: "GET", path: "/api/v1/me", profile: customProfile, skipAuth: true },
    {},
    async (input) => {
      if (String(input).endsWith("/api/v1/meta")) return deployedMetadata();
      operationalCalls += 1;
      return new Response(null, {
        status: 308,
        headers: { location: "https://www.custom.example/api/v1/me" },
      });
    }
  );
  assert.equal(res.status, 308);
  assert.equal(operationalCalls, 1);
});

test("mutation redirects are outcome_unknown after one operational fetch", async () => {
  for (const status of [301, 302, 303, 307, 308]) {
    let operationalCalls = 0;
    const res = await apiRequest(
      {
        method: "POST",
        path: "/api/v1/engine-backtest/experiments",
        body: { name: "x" },
        profile,
        skipAuth: true,
        idempotencyKey: `key-${status}`,
      },
      {},
      async (input) => {
        if (String(input).endsWith("/api/v1/meta")) return deployedMetadata();
        operationalCalls += 1;
        return new Response(null, {
          status,
          headers: { location: "https://alphafox.app/other" },
        });
      }
    );
    assert.equal(operationalCalls, 1);
    assert.equal(res.status, status);
    assert.equal(res.outcome, "outcome_unknown");
  }
});

test("mutation transport errors are outcome_unknown after one operational fetch", async () => {
  let operationalCalls = 0;
  await assert.rejects(
    () =>
      apiRequest(
        {
          method: "POST",
          path: "/api/v1/engine-backtest/experiments",
          body: { name: "x" },
          profile,
          skipAuth: true,
          idempotencyKey: "transport-key",
        },
        {},
        async (input) => {
          if (String(input).endsWith("/api/v1/meta")) return deployedMetadata();
          operationalCalls += 1;
          throw new Error("socket closed");
        }
      ),
    (err: Error & { subtype?: string }) => err.subtype === "outcome_unknown"
  );
  assert.equal(operationalCalls, 1);
});

test("apiRequest preserves query string on the canonical production URL", async () => {
  const seen: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    seen.push(url);
    if (url.endsWith("/api/v1/meta")) return deployedMetadata();
    return new Response(JSON.stringify({ items: [{ traderId: "t1" }] }), { status: 200 });
  };
  const env = {
    ALPHAFOX_TEST_ACCESS_TOKEN: "test-access-token",
    ALPHAFOX_TEST_AUDIENCE: canonicalProfile.audience,
  };
  const res = await apiRequest(
    {
      method: "GET",
      path: "/api/v1/trading/traders/performance?ids=t1,t2&window=7d&fields=list",
      profile: canonicalProfile,
    },
    env,
    fetchImpl
  );
  assert.equal(res.status, 200);
  assert.equal(seen.at(-1), "https://www.alphafox.app/api/v1/trading/traders/performance?ids=t1,t2&window=7d&fields=list");
});

test("canonical production mutations do not encounter an apex redirect", async () => {
  const seen: string[] = [];
  const res = await apiRequest(
    {
      method: "POST",
      path: "/api/v1/trading/traders",
      profile: { ...canonicalProfile, clientId: `canonical-${Date.now()}-${Math.random()}` },
      body: { strategyType: "grid" },
    },
    { ALPHAFOX_CONFIG_DIR: `/tmp/alphafox-canonical-${Date.now()}-${Math.random()}`, ALPHAFOX_KEYCHAIN_DIR: `/tmp/alphafox-canonical-keychain-${Date.now()}-${Math.random()}`, ALPHAFOX_FORCE_FILE_KEYCHAIN: "1" },
    async (input) => {
      const url = String(input);
      seen.push(url);
      if (url.endsWith("/api/v1/meta")) return deployedMetadata();
      return new Response(JSON.stringify({ traderId: "t1" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    }
  );
  assert.equal(res.status, 201);
  assert.deepEqual(seen, [
    "https://www.alphafox.app/api/v1/meta",
    "https://www.alphafox.app/api/v1/trading/traders",
  ]);
});

test("OAuth mutations use the configured issuer rather than the API host", async () => {
  const seen: string[] = [];
  const res = await apiRequest(
    {
      method: "POST",
      path: "/api/auth/oauth/token",
      profile: canonicalProfile,
      skipAuth: true,
      body: { grant_type: "authorization_code" },
    },
    {},
    async (input) => {
      seen.push(String(input));
      return new Response(JSON.stringify({ access_token: "access" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
  );
  assert.equal(res.status, 200);
  assert.deepEqual(seen, ["https://alphafox.app/api/auth/oauth/token"]);
});
test("OAuth mutations preserve a custom issuer path", async () => {
  const seen: string[] = [];
  await apiRequest(
    {
      method: "POST",
      path: "/api/auth/oauth/token",
      profile: {
        ...canonicalProfile,
        issuer: "https://identity.example/tenant/authorization-server",
      },
      skipAuth: true,
    },
    {},
    async (input) => {
      seen.push(String(input));
      return new Response(null, { status: 204 });
    }
  );
  assert.deepEqual(seen, [
    "https://identity.example/tenant/authorization-server/oauth/token",
  ]);
});


test("apiRequest refuses credentials bound to a different authority", async () => {
  const env = {
    ALPHAFOX_TEST_ACCESS_TOKEN: "test-access-token",
    ALPHAFOX_TEST_AUDIENCE: "https://alphafox.app/api/v1",
  };
  await assert.rejects(
    () =>
      apiRequest(
        {
          method: "GET",
          path: "/api/v1/me",
          profile: {
            ...profile,
            apiBaseUrl: "https://evil.example/api/v1",
            audience: "https://evil.example/api/v1",
          },
        },
        env,
        async () => deployedMetadata()
      ),
    (err: Error & { subtype?: string }) =>
      err.subtype === "credential_invalid"
  );
});
