/**
 * Drive shipped web OAuth client-allow + Bearer authenticate (from MVP bundle).
 */
import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it, before } from "node:test";

const jsRoot = join(__dirname, "..", "..", "dist-mvp-web", "js");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const req = (rel: string) => require(join(jsRoot, rel));

const USER_ID = "22222222-2222-2222-2222-222222222222";

describe("OAuth client env isolation + Bearer client/scope", () => {
  before(() => {
    process.env.NODE_ENV = "test";
    process.env.ALPHAFOX_OAUTH_USE_MEMORY = "1";
    process.env.ALPHAFOX_OAUTH_ALLOW_TEST_APPROVE = "1";
    process.env.ALPHAFOX_DEPLOY_ENV = "local";
    process.env.BETTER_AUTH_URL = "http://127.0.0.1:3000";
    process.env.ALPHAFOX_PUBLIC_API_USE_MVP_HANDLERS = "1";
  });

  it("isAllowedCliClient only accepts env-matching client_id", () => {
    const { isAllowedCliClient } = req("lib/auth/oauth/clients.js");
    const localEnv = {
      ALPHAFOX_DEPLOY_ENV: "local",
      BETTER_AUTH_URL: "http://127.0.0.1:3000",
    };
    assert.equal(
      isAllowedCliClient("alphafox-cli-local", localEnv),
      true
    );
    assert.equal(
      isAllowedCliClient("alphafox-cli-prod", localEnv),
      false,
      "prod client must not be accepted on local"
    );
    assert.equal(
      isAllowedCliClient("alphafox-cli-staging", localEnv),
      false
    );

    const prodEnv = {
      ALPHAFOX_DEPLOY_ENV: "production",
      BETTER_AUTH_URL: "https://alphafox.app",
    };
    assert.equal(isAllowedCliClient("alphafox-cli-prod", prodEnv), true);
    assert.equal(isAllowedCliClient("alphafox-cli-local", prodEnv), false);
    assert.equal(isAllowedCliClient("alphafox-cli-staging", prodEnv), false);
  });

  it("authenticateBearer rejects wrong client_id and missing scopes", async () => {
    const tokenModel = req("lib/auth/oauth/token-model.js");
    const { authenticateBearer } = req("lib/auth/oauth/bearer.js");
    const { mintTokenPair } = tokenModel;
    const { getProcessOAuthTokenStore } = req("lib/auth/oauth/memory-store.js");

    process.env.ALPHAFOX_OAUTH_USE_MEMORY = "1";
    process.env.ALPHAFOX_DEPLOY_ENV = "local";
    process.env.BETTER_AUTH_URL = "http://127.0.0.1:3000";

    (
      globalThis as { __alphafoxOAuthTokenStore?: unknown }
    ).__alphafoxOAuthTokenStore = tokenModel.createMemoryTokenStore();

    const store = getProcessOAuthTokenStore();
    const good = mintTokenPair(store, {
      userId: USER_ID,
      clientId: "alphafox-cli-local",
      environment: "local",
      issuer: "http://127.0.0.1:3000/api/auth",
      audience: "http://127.0.0.1:3000/api/v1",
      scopes: ["openid", "profile"],
    });

    const ok = await authenticateBearer(
      new Request("http://127.0.0.1:3000/api/v1/me", {
        headers: { authorization: `Bearer ${good.accessToken}` },
      }),
      process.env
    );
    assert.equal(ok.ok, true);
    if (ok.ok) {
      assert.equal(ok.auth.userId, USER_ID);
      assert.equal(ok.auth.clientId, "alphafox-cli-local");
    }

    // Foreign client token (prod client on local env) → client_mismatch
    const foreign = mintTokenPair(store, {
      userId: USER_ID,
      clientId: "alphafox-cli-prod",
      environment: "local",
      issuer: "http://127.0.0.1:3000/api/auth",
      audience: "http://127.0.0.1:3000/api/v1",
      scopes: ["openid", "profile"],
    });
    const badClient = await authenticateBearer(
      new Request("http://127.0.0.1:3000/api/v1/me", {
        headers: { authorization: `Bearer ${foreign.accessToken}` },
      }),
      process.env
    );
    assert.equal(badClient.ok, false);
    if (!badClient.ok) {
      assert.equal(badClient.status, 403);
      assert.equal(badClient.code, "client_mismatch");
    }

    // Missing required scopes → scope_missing
    const missingScope = await authenticateBearer(
      new Request("http://127.0.0.1:3000/api/v1/me", {
        headers: { authorization: `Bearer ${good.accessToken}` },
      }),
      process.env,
      { requiredScopes: ["openid", "profile", "trading:write"] }
    );
    assert.equal(missingScope.ok, false);
    if (!missingScope.ok) {
      assert.equal(missingScope.status, 403);
      assert.equal(missingScope.code, "scope_missing");
    }

  });
});
