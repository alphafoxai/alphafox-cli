/**
 * Interactive Authorization Code + PKCE with a loopback callback.
 * The CLI listens on 127.0.0.1, opens the system browser, exchanges the
 * code with the in-memory verifier, and stores tokens in the OS keychain.
 */

import { randomUUID } from "node:crypto";
import type { ProfileConfig } from "../config/profiles";
import { apiRequest } from "../http/client";
import { saveTokens, tokenFingerprint } from "../keychain/store";
import { startLoopbackCallbackServer } from "./loopback-callback";
import { openSystemBrowser, type OpenBrowserResult } from "./open-browser";
import { buildAuthorizeUrl, generatePkcePair } from "./pkce";

export const DEFAULT_BROWSER_LOGIN_TIMEOUT_MS = 300_000;

export type BrowserLoginResult =
  | {
      readonly status: "authenticated";
      readonly accessTokenFingerprint: string;
      readonly expiresIn: number;
      readonly requestId?: string;
    }
  | {
      readonly status: "failed";
      readonly reason:
        | "listen_failed"
        | "browser_open_failed"
        | "timeout"
        | "state_mismatch"
        | "oauth_error"
        | "missing_code"
        | "token_exchange_failed";
      readonly message: string;
      readonly authorizeUrl?: string;
      readonly oauthError?: string;
    };

export type OpenBrowserFn = (
  url: string
) => OpenBrowserResult | Promise<OpenBrowserResult>;

export function browserLoginTimeoutMs(
  env: NodeJS.ProcessEnv = process.env
): number {
  const raw = env.ALPHAFOX_BROWSER_LOGIN_TIMEOUT_MS?.trim();
  if (!raw) return DEFAULT_BROWSER_LOGIN_TIMEOUT_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_BROWSER_LOGIN_TIMEOUT_MS;
}

export function resolveOpenBrowser(
  env: NodeJS.ProcessEnv = process.env
): OpenBrowserFn {
  if (env.ALPHAFOX_TEST_BROWSER_OPEN === "fail") {
    return () => ({ ok: false, reason: "test_browser_open_disabled" });
  }
  return openSystemBrowser;
}

export async function runBrowserPkceLogin(input: {
  readonly profile: ProfileConfig;
  readonly env?: NodeJS.ProcessEnv;
  readonly timeoutMs?: number;
  readonly openBrowser?: OpenBrowserFn;
  readonly fetchImpl?: typeof fetch;
}): Promise<BrowserLoginResult> {
  const env = input.env ?? process.env;
  const openBrowser = input.openBrowser ?? resolveOpenBrowser(env);
  const timeoutMs = input.timeoutMs ?? browserLoginTimeoutMs(env);
  const state = randomUUID();
  const pkce = generatePkcePair();

  let loopback: Awaited<ReturnType<typeof startLoopbackCallbackServer>>;
  try {
    loopback = await startLoopbackCallbackServer({
      expectedState: state,
      timeoutMs,
    });
  } catch (err) {
    return {
      status: "failed",
      reason: "listen_failed",
      message:
        err instanceof Error
          ? `Could not bind loopback callback server: ${err.message}`
          : "Could not bind loopback callback server.",
    };
  }

  const authorizeUrl = buildAuthorizeUrl({
    issuer: input.profile.issuer,
    clientId: input.profile.clientId,
    redirectUri: loopback.redirectUri,
    codeChallenge: pkce.codeChallenge,
    state,
  });

  try {
    let opened: OpenBrowserResult;
    try {
      opened = await openBrowser(authorizeUrl);
    } catch (err) {
      return {
        status: "failed",
        reason: "browser_open_failed",
        message:
          err instanceof Error
            ? `Could not open the system browser (${err.message}).`
            : "Could not open the system browser.",
        authorizeUrl,
      };
    }
    if (!opened.ok) {
      return {
        status: "failed",
        reason: "browser_open_failed",
        message: `Could not open the system browser (${opened.reason}).`,
        authorizeUrl,
      };
    }

    const callback = await loopback.wait();
    if (callback.status === "timeout") {
      return {
        status: "failed",
        reason: "timeout",
        message: "Browser login timed out waiting for the localhost callback.",
      };
    }
    if (callback.status === "state_mismatch") {
      return {
        status: "failed",
        reason: "state_mismatch",
        message: "OAuth callback state did not match the login attempt.",
      };
    }
    if (callback.status === "oauth_error") {
      return {
        status: "failed",
        reason: "oauth_error",
        message: `Authorization server returned ${callback.error}.`,
        oauthError: callback.error,
      };
    }
    if (callback.status === "missing_code") {
      return {
        status: "failed",
        reason: "missing_code",
        message: "OAuth callback did not include an authorization code.",
      };
    }

    let res;
    try {
      res = await apiRequest(
        {
          method: "POST",
          path: "/api/auth/oauth/token",
          profile: input.profile,
          skipAuth: true,
          body: {
            grant_type: "authorization_code",
            code: callback.code,
            redirect_uri: loopback.redirectUri,
            client_id: input.profile.clientId,
            code_verifier: pkce.codeVerifier,
          },
        },
        env,
        input.fetchImpl ?? fetch
      );
    } catch (err) {
      return {
        status: "failed",
        reason: "token_exchange_failed",
        message:
          err instanceof Error
            ? `Token exchange failed (${err.message}).`
            : "Token exchange failed.",
      };
    }
    if (res.status >= 400) {
      return {
        status: "failed",
        reason: "token_exchange_failed",
        message: `Token exchange failed (HTTP ${res.status}).`,
      };
    }
    const tokens = parseTokenPair(res.json);
    if (!tokens) {
      return {
        status: "failed",
        reason: "token_exchange_failed",
        message: "Token response missing access_token/refresh_token.",
      };
    }

    saveTokens(
      input.profile,
      {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: Date.now() + (tokens.expires_in ?? 600) * 1000,
        environment: input.profile.name,
        issuer: input.profile.issuer,
        audience: input.profile.audience,
        clientId: input.profile.clientId,
        scopes: (tokens.scope ?? "openid profile").split(/\s+/).filter(Boolean),
      },
      env
    );

    return {
      status: "authenticated",
      accessTokenFingerprint: tokenFingerprint(tokens.access_token),
      expiresIn: tokens.expires_in ?? 600,
      requestId: res.requestId,
    };
  } finally {
    await loopback.close();
  }
}

function parseTokenPair(json: unknown): {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  scope?: string;
} | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  const access = o.access_token ?? o.accessToken;
  const refresh = o.refresh_token ?? o.refreshToken;
  if (typeof access !== "string" || typeof refresh !== "string") return null;
  return {
    access_token: access,
    refresh_token: refresh,
    expires_in:
      typeof o.expires_in === "number"
        ? o.expires_in
        : typeof o.expiresIn === "number"
          ? o.expiresIn
          : undefined,
    scope: typeof o.scope === "string" ? o.scope : undefined,
  };
}
