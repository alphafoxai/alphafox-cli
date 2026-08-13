import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { runBrowserPkceLogin } from "../src/auth/browser-login";
import type { ProfileConfig } from "../src/config/profiles";
import { loadTokens } from "../src/keychain/store";

const profile: ProfileConfig = {
  name: "local",
  apiBaseUrl: "http://127.0.0.1:3000/api/v1",
  issuer: "http://127.0.0.1:3000/api/auth",
  audience: "http://127.0.0.1:3000/api/v1",
  clientId: "alphafox-cli-local",
};

function fileEnv(): NodeJS.ProcessEnv {
  const dir = mkdtempSync(join(tmpdir(), "alphafox-cli-browser-"));
  return {
    ALPHAFOX_FORCE_FILE_KEYCHAIN: "1",
    ALPHAFOX_KEYCHAIN_DIR: dir,
  };
}

describe("browser PKCE login", () => {
  it("completes login from a simulated HTTP callback", async () => {
    const env = fileEnv();
    try {
      const result = await runBrowserPkceLogin({
        profile,
        env,
        timeoutMs: 5_000,
        openBrowser: async (url) => {
          const parsed = new URL(url);
          assert.equal(
            parsed.pathname,
            "/api/auth/oauth/authorize"
          );
          assert.equal(parsed.searchParams.get("code_challenge_method"), "S256");
          assert.ok(parsed.searchParams.get("code_challenge"));
          const redirectUri = parsed.searchParams.get("redirect_uri");
          const state = parsed.searchParams.get("state");
          assert.ok(redirectUri);
          assert.ok(state);
          const cb = await fetch(
            `${redirectUri}?code=browser-code&state=${state}`
          );
          assert.equal(cb.status, 200);
          return { ok: true };
        },
        fetchImpl: async (input, init) => {
          const url = String(input);
          assert.ok(url.endsWith("/api/auth/oauth/token"));
          const body = JSON.parse(String(init?.body ?? "{}")) as {
            grant_type?: string;
            code?: string;
            code_verifier?: string;
            redirect_uri?: string;
          };
          assert.equal(body.grant_type, "authorization_code");
          assert.equal(body.code, "browser-code");
          assert.ok(body.code_verifier);
          assert.match(
            body.redirect_uri ?? "",
            /^http:\/\/127\.0\.0\.1:\d+\/callback$/
          );
          return new Response(
            JSON.stringify({
              access_token: "access-from-browser",
              refresh_token: "refresh-from-browser",
              expires_in: 600,
              scope: "openid profile offline_access",
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        },
      });
      assert.equal(result.status, "authenticated");
      const stored = loadTokens(profile.name, env);
      assert.equal(stored?.accessToken, "access-from-browser");
      assert.equal(stored?.refreshToken, "refresh-from-browser");
      assert.equal(
        JSON.stringify(result).includes("access-from-browser"),
        false
      );
      assert.equal(JSON.stringify(result).includes("verifier"), false);
    } finally {
      rmSync(env.ALPHAFOX_KEYCHAIN_DIR!, { recursive: true, force: true });
    }
  });

  it("fails closed on state mismatch", async () => {
    const env = fileEnv();
    try {
      const result = await runBrowserPkceLogin({
        profile,
        env,
        timeoutMs: 5_000,
        openBrowser: async (url) => {
          const parsed = new URL(url);
          const redirectUri = parsed.searchParams.get("redirect_uri")!;
          await fetch(`${redirectUri}?code=x&state=not-the-state`);
          return { ok: true };
        },
        fetchImpl: async () => {
          throw new Error("token endpoint must not be called");
        },
      });
      assert.equal(result.status, "failed");
      if (result.status === "failed") {
        assert.equal(result.reason, "state_mismatch");
      }
      assert.equal(loadTokens(profile.name, env), null);
    } finally {
      rmSync(env.ALPHAFOX_KEYCHAIN_DIR!, { recursive: true, force: true });
    }
  });

  it("fails closed on OAuth error callback", async () => {
    const env = fileEnv();
    try {
      const result = await runBrowserPkceLogin({
        profile,
        env,
        timeoutMs: 5_000,
        openBrowser: async (url) => {
          const parsed = new URL(url);
          const redirectUri = parsed.searchParams.get("redirect_uri")!;
          const state = parsed.searchParams.get("state")!;
          await fetch(
            `${redirectUri}?error=access_denied&state=${state}`
          );
          return { ok: true };
        },
        fetchImpl: async () => {
          throw new Error("token endpoint must not be called");
        },
      });
      assert.equal(result.status, "failed");
      if (result.status === "failed") {
        assert.equal(result.reason, "oauth_error");
        assert.equal(result.oauthError, "access_denied");
      }
    } finally {
      rmSync(env.ALPHAFOX_KEYCHAIN_DIR!, { recursive: true, force: true });
    }
  });

  it("fails closed when token exchange fails", async () => {
    const env = fileEnv();
    try {
      const result = await runBrowserPkceLogin({
        profile,
        env,
        timeoutMs: 5_000,
        openBrowser: async (url) => {
          const parsed = new URL(url);
          const redirectUri = parsed.searchParams.get("redirect_uri")!;
          const state = parsed.searchParams.get("state")!;
          await fetch(`${redirectUri}?code=browser-code&state=${state}`);
          return { ok: true };
        },
        fetchImpl: async () =>
          new Response(JSON.stringify({ error: "invalid_grant" }), {
            status: 400,
          }),
      });
      assert.equal(result.status, "failed");
      if (result.status === "failed") {
        assert.equal(result.reason, "token_exchange_failed");
      }
      assert.equal(loadTokens(profile.name, env), null);
    } finally {
      rmSync(env.ALPHAFOX_KEYCHAIN_DIR!, { recursive: true, force: true });
    }
  });

  it("fails closed and returns authorizeUrl when the browser cannot open", async () => {
    const env = fileEnv();
    try {
      const result = await runBrowserPkceLogin({
        profile,
        env,
        timeoutMs: 1_000,
        openBrowser: () => ({ ok: false, reason: "command_not_found" }),
        fetchImpl: async () => {
          throw new Error("must not exchange");
        },
      });
      assert.equal(result.status, "failed");
      if (result.status === "failed") {
        assert.equal(result.reason, "browser_open_failed");
        assert.ok(result.authorizeUrl);
        assert.equal(result.authorizeUrl.includes("code_verifier"), false);
        assert.equal(
          result.authorizeUrl.startsWith(
            "http://127.0.0.1:3000/api/auth/oauth/authorize?"
          ),
          true
        );
      }
    } finally {
      rmSync(env.ALPHAFOX_KEYCHAIN_DIR!, { recursive: true, force: true });
    }
  });

  it("times out when the callback never arrives", async () => {
    const env = fileEnv();
    try {
      const result = await runBrowserPkceLogin({
        profile,
        env,
        timeoutMs: 50,
        openBrowser: () => ({ ok: true }),
        fetchImpl: async () => {
          throw new Error("must not exchange");
        },
      });
      assert.equal(result.status, "failed");
      if (result.status === "failed") {
        assert.equal(result.reason, "timeout");
      }
    } finally {
      rmSync(env.ALPHAFOX_KEYCHAIN_DIR!, { recursive: true, force: true });
    }
  });
});
