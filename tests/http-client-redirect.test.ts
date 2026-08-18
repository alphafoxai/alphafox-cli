import assert from "node:assert/strict";
import test from "node:test";

import type { ProfileConfig } from "../src/config/profiles";
import { apiRequest } from "../src/http/client";

const profile: ProfileConfig = {
  name: "production",
  apiBaseUrl: "https://alphafox.app/api/v1",
  issuer: "https://alphafox.app/api/auth",
  audience: "https://alphafox.app/api/v1",
  clientId: "alphafox-cli-prod",
};

test("apiRequest never hops cross-origin redirects with bearer auth", async () => {
  const seen: Array<{ url: string; authorization: string | null }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    seen.push({
      url,
      authorization: headers.get("authorization"),
    });
    return new Response(null, {
      status: 308,
      headers: { location: "https://www.alphafox.app/api/v1/me" },
    });
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

  assert.equal(res.status, 308);
  assert.equal(seen.length, 1);
  assert.equal(seen[0]?.url, "https://alphafox.app/api/v1/me");
  assert.equal(seen[0]?.authorization, "Bearer test-access-token");
});

test("mutation redirects are outcome_unknown after one fetch", async () => {
  for (const status of [301, 302, 303, 307, 308]) {
    let calls = 0;
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
      async () => {
        calls += 1;
        return new Response(null, {
          status,
          headers: { location: "https://alphafox.app/other" },
        });
      }
    );
    assert.equal(calls, 1);
    assert.equal(res.status, status);
    assert.equal(res.outcome, "outcome_unknown");
  }
});

test("mutation transport errors are outcome_unknown after one fetch", async () => {
  let calls = 0;
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
        async () => {
          calls += 1;
          throw new Error("socket closed");
        }
      ),
    (err: Error & { subtype?: string }) => err.subtype === "outcome_unknown"
  );
  assert.equal(calls, 1);
});

test("apiRequest preserves query string on the request URL", async () => {
  const seen: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    seen.push(String(input));
    return new Response(JSON.stringify({ items: [{ traderId: "t1" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const env = {
    ALPHAFOX_TEST_ACCESS_TOKEN: "test-access-token",
    ALPHAFOX_TEST_AUDIENCE: profile.audience,
  };
  const res = await apiRequest(
    {
      method: "GET",
      path: "/api/v1/trading/traders/performance?ids=t1,t2&window=7d&fields=list",
      profile,
    },
    env,
    fetchImpl
  );
  assert.equal(res.status, 200);
  assert.equal(
    seen[0],
    "https://alphafox.app/api/v1/trading/traders/performance?ids=t1,t2&window=7d&fields=list"
  );
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
        async () => new Response("nope", { status: 500 })
      ),
    (err: Error & { subtype?: string }) =>
      err.subtype === "credential_invalid"
  );
});
