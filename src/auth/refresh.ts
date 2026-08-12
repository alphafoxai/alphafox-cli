/**
 * Silent access-token renewal via refresh_token grant.
 * Access tokens are short-lived (~10m); refresh tokens last ~30d (web ADR).
 */

import type { ProfileConfig } from "../config/profiles";
import {
  loadTokens,
  saveTokens,
  type StoredTokens,
} from "../keychain/store";

/** Refresh when access token expires within this window. */
export const ACCESS_TOKEN_REFRESH_SKEW_MS = 60_000;

/** In-flight refresh promises so concurrent API calls share one rotation. */
const inflightByProfile = new Map<string, Promise<StoredTokens | null>>();

export function accessTokenNeedsRefresh(
  tokens: StoredTokens,
  now: number = Date.now()
): boolean {
  if (!tokens.refreshToken?.trim()) {
    return false;
  }
  return tokens.expiresAt <= now + ACCESS_TOKEN_REFRESH_SKEW_MS;
}

/**
 * Exchange refresh_token for a new AT/RT pair and persist to keychain.
 * Returns null if no tokens, no refresh token, or the AS rejects renewal.
 */
export async function refreshStoredTokens(
  profile: ProfileConfig,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
  options: {
    readonly now?: number;
    readonly force?: boolean;
  } = {}
): Promise<StoredTokens | null> {
  const existing = loadTokens(profile.name, env);
  if (!existing?.refreshToken?.trim()) {
    return null;
  }
  if (
    !options.force &&
    !accessTokenNeedsRefresh(existing, options.now ?? Date.now())
  ) {
    return existing;
  }

  const key = profile.name;
  const pending = inflightByProfile.get(key);
  if (pending) {
    return pending;
  }

  const work = performRefresh(profile, existing, env, fetchImpl).finally(() => {
    inflightByProfile.delete(key);
  });
  inflightByProfile.set(key, work);
  return work;
}

async function performRefresh(
  profile: ProfileConfig,
  existing: StoredTokens,
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch
): Promise<StoredTokens | null> {
  const origin = profile.apiBaseUrl.replace(/\/$/, "").replace(/\/api\/v1$/, "");
  const url = `${origin}/api/auth/oauth/token`;
  const body = {
    grant_type: "refresh_token",
    refresh_token: existing.refreshToken,
    client_id: existing.clientId || profile.clientId,
  };

  let response: Response;
  try {
    response = await fetchFollowingSameSiteRedirects(fetchImpl, url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Alphafox-Client": "alphafox-cli",
        "X-Alphafox-Client-Version": env.ALPHAFOX_CLI_VERSION ?? "0.1.0",
      },
      body: JSON.stringify(body),
      redirect: "manual",
    });
  } catch {
    return null;
  }

  if (response.status >= 400) {
    return null;
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return null;
  }
  if (!json || typeof json !== "object") {
    return null;
  }
  const o = json as Record<string, unknown>;
  const access =
    typeof o.access_token === "string"
      ? o.access_token
      : typeof o.accessToken === "string"
        ? o.accessToken
        : null;
  const refresh =
    typeof o.refresh_token === "string"
      ? o.refresh_token
      : typeof o.refreshToken === "string"
        ? o.refreshToken
        : null;
  if (!access || !refresh) {
    return null;
  }
  const expiresIn =
    typeof o.expires_in === "number"
      ? o.expires_in
      : typeof o.expiresIn === "number"
        ? o.expiresIn
        : 600;
  const scopeRaw =
    typeof o.scope === "string"
      ? o.scope
      : existing.scopes.join(" ");

  const next: StoredTokens = {
    accessToken: access,
    refreshToken: refresh,
    expiresAt: Date.now() + expiresIn * 1000,
    environment: existing.environment || profile.name,
    issuer: existing.issuer || profile.issuer,
    audience: existing.audience || profile.audience,
    clientId: existing.clientId || profile.clientId,
    scopes: scopeRaw.split(/\s+/).filter(Boolean),
  };
  saveTokens(profile.name, next, env);
  return next;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

async function fetchFollowingSameSiteRedirects(
  fetchImpl: typeof fetch,
  startUrl: string,
  init: RequestInit,
  maxHops = 5
): Promise<Response> {
  let url = startUrl;
  let method = (init.method ?? "GET").toUpperCase();
  let body = init.body;
  let response = await fetchImpl(url, {
    ...init,
    method,
    body,
    redirect: "manual",
  });

  for (
    let hop = 0;
    hop < maxHops && REDIRECT_STATUSES.has(response.status);
    hop++
  ) {
    const location = response.headers.get("location");
    if (!location) break;
    const nextUrl = new URL(location, url).toString();
    if (!sameAuthSite(originOf(url), originOf(nextUrl))) break;
    if (
      response.status === 303 ||
      ((response.status === 301 || response.status === 302) &&
        method !== "GET" &&
        method !== "HEAD")
    ) {
      method = "GET";
      body = undefined;
    }
    url = nextUrl;
    response = await fetchImpl(url, {
      ...init,
      method,
      body,
      redirect: "manual",
    });
  }
  return response;
}

function originOf(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    if (value.startsWith("http://") || value.startsWith("https://")) {
      return new URL(value).origin;
    }
    return null;
  } catch {
    return null;
  }
}

function sameAuthSite(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    if (ua.protocol !== ub.protocol) return false;
    const ha = ua.hostname.replace(/^www\./i, "").toLowerCase();
    const hb = ub.hostname.replace(/^www\./i, "").toLowerCase();
    return ha === hb && ua.port === ub.port;
  } catch {
    return false;
  }
}

/** Test helper: clear in-flight map between cases. */
export function clearRefreshInflightForTests(): void {
  inflightByProfile.clear();
}
