/**
 * Integration: device approve → token → whoami → lists → chat → backtest
 * + authorization_code PKCE, driving compiled copies of shipped web handlers
 * (built by scripts/build-mvp-web-bundle.mjs from alphafox-web sources).
 */
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { join } from "node:path";
import { describe, it, before } from "node:test";

// works from tests/ (source) and dist-test/tests/ (compiled)
const jsRoot = join(__dirname, "..", "..", "dist-mvp-web", "js");

// eslint-disable-next-line @typescript-eslint/no-require-imports
const req = (rel: string) => require(join(jsRoot, rel));

const USER_ID = "11111111-1111-1111-1111-111111111111";

function bearerHeaders(accessToken: string, extra: Record<string, string> = {}) {
  return {
    authorization: `Bearer ${accessToken}`,
    "content-type": "application/json",
    "x-request-id": "mvp-test-1",
    ...extra,
  };
}

describe("shipped web OAuth + MVP handlers", () => {
  before(() => {
    process.env.NODE_ENV = "test";
    process.env.ALPHAFOX_OAUTH_USE_MEMORY = "1";
    process.env.ALPHAFOX_PUBLIC_API_USE_MVP_HANDLERS = "1";
    process.env.ALPHAFOX_OAUTH_ALLOW_TEST_APPROVE = "1";
    process.env.ALPHAFOX_DEPLOY_ENV = "local";
    process.env.BETTER_AUTH_URL = "http://127.0.0.1:3000";
  });

  it("device approve mints tokens and MVP product path works", async () => {
    const deviceStore = req("lib/auth/oauth/device-store.js");
    const tokenModel = req("lib/auth/oauth/token-model.js");
    const authCodeStore = req("lib/auth/oauth/authorization-code-store.js");
    const mvp = req("server/public-api/mvp-handlers.js");
    const { POST: deviceCodePost } = req(
      "app/api/auth/oauth/device/code/route.js"
    );
    const { POST: approvePost } = req(
      "app/api/auth/oauth/device/approve/route.js"
    );
    const { POST: deviceTokenPost } = req(
      "app/api/auth/oauth/device/token/route.js"
    );
    const { GET: meGet } = req("app/api/v1/me/route.js");
    const { GET: strategyGet } = req(
      "app/api/v1/trading/strategy-definitions/route.js"
    );
    const { GET: connectorsGet } = req(
      "app/api/v1/exchange-connectors/route.js"
    );
    const { GET: tradersGet } = req("app/api/v1/trading/traders/route.js");
    const { POST: chatsPost } = req("app/api/v1/chats/route.js");
    const { POST: backtestsPost } = req("app/api/v1/backtests/route.js");
    const { GET: backtestGet } = req(
      "app/api/v1/backtests/[backtestId]/route.js"
    );
    const { POST: backtestCancel } = req(
      "app/api/v1/backtests/[backtestId]/cancel/route.js"
    );
    const { getAuthenticatedRequestContext } = req(
      "lib/auth/request-guard.js"
    );

    deviceStore.clearDeviceCodeStoreForTesting();
    authCodeStore.clearAuthorizationCodeStoreForTesting();
    mvp.clearMvpChatStoreForTesting();
    mvp.clearMvpBacktestStoreForTesting();
    (
      globalThis as { __alphafoxOAuthTokenStore?: unknown }
    ).__alphafoxOAuthTokenStore = tokenModel.createMemoryTokenStore();

    const codeRes = await deviceCodePost(
      new Request("http://127.0.0.1:3000/api/auth/oauth/device/code", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ client_id: "alphafox-cli-local" }),
      })
    );
    assert.equal(codeRes.status, 200);
    const codeBody = (await codeRes.json()) as Record<string, string>;
    assert.ok(
      String(codeBody.verification_uri).endsWith("/cli/device"),
      codeBody.verification_uri
    );

    const pending = await deviceTokenPost(
      new Request("http://127.0.0.1:3000/api/auth/oauth/device/token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          device_code: codeBody.device_code,
          client_id: "alphafox-cli-local",
        }),
      })
    );
    assert.equal(pending.status, 400);
    assert.equal(
      ((await pending.json()) as { error: string }).error,
      "authorization_pending"
    );

    const approve = await approvePost(
      new Request("http://127.0.0.1:3000/api/auth/oauth/device/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          user_code: codeBody.user_code,
          user_id: USER_ID,
          action: "approve",
        }),
      })
    );
    assert.equal(approve.status, 200);
    assert.equal(((await approve.json()) as { approved: boolean }).approved, true);

    const tokenRes = await deviceTokenPost(
      new Request("http://127.0.0.1:3000/api/auth/oauth/device/token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          device_code: codeBody.device_code,
          client_id: "alphafox-cli-local",
        }),
      })
    );
    assert.equal(tokenRes.status, 200);
    const tokens = (await tokenRes.json()) as {
      access_token: string;
      refresh_token: string;
    };
    assert.ok(tokens.access_token.length > 20);

    const ctx = await getAuthenticatedRequestContext(
      new Request("http://127.0.0.1:3000/api/v1/me", {
        headers: bearerHeaders(tokens.access_token),
      })
    );
    assert.ok(ctx);
    assert.equal(ctx.userId, USER_ID);

    const me = await meGet(
      new Request("http://127.0.0.1:3000/api/v1/me", {
        headers: bearerHeaders(tokens.access_token),
      })
    );
    assert.equal(me.status, 200);
    assert.equal(((await me.json()) as { userId: string }).userId, USER_ID);

    for (const [label, GET] of [
      ["strategy", strategyGet],
      ["connectors", connectorsGet],
      ["traders", tradersGet],
    ] as const) {
      const res = await GET(
        new Request("http://127.0.0.1:3000/api/v1/x", {
          headers: bearerHeaders(tokens.access_token),
        })
      );
      assert.equal(res.status, 200, label);
      const body = (await res.json()) as {
        items: unknown[];
        meta: { userId: string };
      };
      assert.ok(Array.isArray(body.items));
      assert.equal(body.meta.userId, USER_ID);
    }

    const chatRes = await chatsPost(
      new Request("http://127.0.0.1:3000/api/v1/chats", {
        method: "POST",
        headers: bearerHeaders(tokens.access_token, {
          "idempotency-key": "idem-1",
        }),
        body: JSON.stringify({ strategyGenerationMode: "simple" }),
      })
    );
    assert.equal(chatRes.status, 201);
    const chat = (await chatRes.json()) as {
      chat: { id: string; userId: string };
    };
    assert.equal(chat.chat.userId, USER_ID);

    const chatReplay = await chatsPost(
      new Request("http://127.0.0.1:3000/api/v1/chats", {
        method: "POST",
        headers: bearerHeaders(tokens.access_token, {
          "idempotency-key": "idem-1",
        }),
        body: JSON.stringify({ strategyGenerationMode: "simple" }),
      })
    );
    assert.equal(chatReplay.status, 200);
    assert.equal(
      ((await chatReplay.json()) as { replayed: boolean }).replayed,
      true
    );

    const btCreate = await backtestsPost(
      new Request("http://127.0.0.1:3000/api/v1/backtests", {
        method: "POST",
        headers: bearerHeaders(tokens.access_token),
        body: "{}",
      })
    );
    assert.equal(btCreate.status, 201);
    const btId = ((await btCreate.json()) as { backtest: { id: string } })
      .backtest.id;

    const btGet = await backtestGet(
      new Request("http://127.0.0.1:3000/api/v1/backtests/x", {
        headers: bearerHeaders(tokens.access_token),
      }),
      { params: Promise.resolve({ backtestId: btId }) }
    );
    assert.equal(btGet.status, 200);

    const btCancel = await backtestCancel(
      new Request("http://127.0.0.1:3000/api/v1/backtests/x/cancel", {
        method: "POST",
        headers: bearerHeaders(tokens.access_token),
        body: "{}",
      }),
      { params: Promise.resolve({ backtestId: btId }) }
    );
    assert.equal(btCancel.status, 200);
    assert.equal(
      ((await btCancel.json()) as { backtest: { status: string } }).backtest
        .status,
      "cancelled"
    );

    const unauth = await meGet(new Request("http://127.0.0.1:3000/api/v1/me"));
    assert.equal(unauth.status, 401);
  });

  it("authorization_code PKCE requires challenge and exchanges for AT", async () => {
    const authCodeStore = req("lib/auth/oauth/authorization-code-store.js");
    const tokenModel = req("lib/auth/oauth/token-model.js");
    const { GET: authorizeGet } = req("app/api/auth/oauth/authorize/route.js");
    const { POST: tokenPost } = req("app/api/auth/oauth/token/route.js");
    const { GET: meGet } = req("app/api/v1/me/route.js");

    authCodeStore.clearAuthorizationCodeStoreForTesting();
    (
      globalThis as { __alphafoxOAuthTokenStore?: unknown }
    ).__alphafoxOAuthTokenStore = tokenModel.createMemoryTokenStore();

    const codeVerifier = randomBytes(32).toString("base64url");
    const codeChallenge = createHash("sha256")
      .update(codeVerifier, "utf8")
      .digest("base64url");
    const redirectUri = "http://127.0.0.1:8742/callback";

    const missingChallenge = new URL(
      "http://127.0.0.1:3000/api/auth/oauth/authorize"
    );
    missingChallenge.searchParams.set("response_type", "code");
    missingChallenge.searchParams.set("client_id", "alphafox-cli-local");
    missingChallenge.searchParams.set("redirect_uri", redirectUri);
    missingChallenge.searchParams.set("code_challenge_method", "S256");
    const bad = await authorizeGet(
      new Request(missingChallenge, {
        headers: {
          accept: "application/json",
          "x-alphafox-test-user-id": USER_ID,
        },
      })
    );
    assert.equal(bad.status, 400);

    const authorizeUrl = new URL(
      "http://127.0.0.1:3000/api/auth/oauth/authorize"
    );
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("client_id", "alphafox-cli-local");
    authorizeUrl.searchParams.set("redirect_uri", redirectUri);
    authorizeUrl.searchParams.set("code_challenge", codeChallenge);
    authorizeUrl.searchParams.set("code_challenge_method", "S256");
    authorizeUrl.searchParams.set("state", "s1");
    authorizeUrl.searchParams.set("scope", "openid profile offline_access");

    const authz = await authorizeGet(
      new Request(authorizeUrl, {
        headers: {
          accept: "application/json",
          "x-alphafox-test-user-id": USER_ID,
        },
      })
    );
    assert.equal(authz.status, 200);
    const { code } = (await authz.json()) as { code: string };
    assert.ok(code.length > 10);

    const tok = await tokenPost(
      new Request("http://127.0.0.1:3000/api/auth/oauth/token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
          client_id: "alphafox-cli-local",
          code_verifier: codeVerifier,
        }),
      })
    );
    assert.equal(tok.status, 200);
    const access = ((await tok.json()) as { access_token: string })
      .access_token;
    const me = await meGet(
      new Request("http://127.0.0.1:3000/api/v1/me", {
        headers: bearerHeaders(access),
      })
    );
    assert.equal(me.status, 200);
    assert.equal(((await me.json()) as { userId: string }).userId, USER_ID);
  });
});
