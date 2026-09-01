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

test("apiRequest re-attaches Authorization across apex→www redirects", async () => {
  const seen: Array<{ url: string; authorization: string | null }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    seen.push({
      url,
      authorization: headers.get("authorization"),
    });
    if (url === "https://alphafox.app/api/v1/me") {
      return new Response(null, {
        status: 308,
        headers: { location: "https://www.alphafox.app/api/v1/me" },
      });
    }
    if (url === "https://www.alphafox.app/api/v1/me") {
      assert.equal(
        headers.get("authorization"),
        "Bearer test-access-token",
        "Authorization must survive apex→www redirect"
      );
      return new Response(
        JSON.stringify({ userId: "user-1", sessionId: "oauth-access:user-1" }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    return new Response("not found", { status: 404 });
  };

  const env = {
    ALPHAFOX_TEST_ACCESS_TOKEN: "test-access-token",
    ALPHAFOX_TEST_REFRESH_TOKEN: "refresh",
    ALPHAFOX_TEST_ISSUER: profile.issuer,
    ALPHAFOX_TEST_AUDIENCE: profile.audience,
    ALPHAFOX_TEST_CLIENT_ID: profile.clientId,
  };

  const res = await apiRequest(
    {
      method: "GET",
      path: "/api/v1/me",
      profile,
    },
    env,
    fetchImpl
  );

  assert.equal(res.status, 200);
  assert.equal((res.json as { userId: string }).userId, "user-1");
  assert.equal(seen.length, 2);
  assert.equal(seen[0]?.url, "https://alphafox.app/api/v1/me");
  assert.equal(seen[1]?.url, "https://www.alphafox.app/api/v1/me");
  assert.equal(seen[0]?.authorization, "Bearer test-access-token");
  assert.equal(seen[1]?.authorization, "Bearer test-access-token");
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

test("apiRequest sends the direct admin allowlist route to the web origin", async () => {
  const seen: string[] = [];
  const res = await apiRequest(
    {
      method: "POST",
      path: "/api/admin/passivbot-paper-acceptance-traders",
      body: {},
      profile,
      skipAuth: true,
    },
    {},
    async (input) => {
      seen.push(String(input));
      return new Response(JSON.stringify({ trader: { id: "trader-1" } }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    }
  );

  assert.equal(res.status, 201);
  assert.deepEqual(seen, [
    "https://alphafox.app/api/admin/passivbot-paper-acceptance-traders",
  ]);
});

test("apiRequest refuses true cross-site token use", async () => {
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
      err.subtype === "cross_origin_token" ||
      /different origin/.test(err.message)
  );
});
