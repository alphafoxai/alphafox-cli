import { newRequestId } from "../envelope";
import type { ProfileConfig } from "../config/profiles";
import { CLI_VERSION } from "../version";
import {
  accessTokenNeedsRefresh,
  refreshStoredTokens,
} from "../auth/refresh";
import { loadTokens } from "../keychain/store";
import {
  isFacadeAllowlistedPath,
  isInternalDisallowedPath,
  normalizeApiPath,
} from "../catalog/allowlist";

export interface ApiRequestOptions {
  readonly method: string;
  readonly path: string;
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
  readonly profile: ProfileConfig;
  readonly requestId?: string;
  readonly skipAuth?: boolean;
  readonly idempotencyKey?: string;
  /** Catalog metadata gates the single reactive replay for mutations. */
  readonly operationId?: string;
  readonly catalogIdempotent?: boolean;
  /** Internal: already attempted one silent refresh+retry for this call. */
  readonly _refreshRetried?: boolean;
}

export interface ApiResponse {
  readonly status: number;
  readonly headers: Headers;
  readonly bodyText: string;
  readonly requestId: string;
  readonly json: unknown;
  readonly outcome?: "outcome_unknown";
}

export async function apiRequest(
  options: ApiRequestOptions,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch
): Promise<ApiResponse> {
  // Keep query string for endpoints like /traders/performance?ids=...
  const { path, query } = splitPathAndQuery(options.path);
  if (isInternalDisallowedPath(path)) {
    throw Object.assign(new Error(`Path is internal and not allowed: ${path}`), {
      status: 403,
      type: "authorization",
      subtype: "internal_path_forbidden",
    });
  }
  // Product raw API: /api/v1 only. Auth AS paths under /api/auth/oauth are allowed.
  const isOAuthAsPath = path.startsWith("/api/auth/oauth");
  if (!isOAuthAsPath && path.startsWith("/api/")) {
    // Unknown /api/v1/* is denied (finite facility/catalog allowlist).
    if (!isFacadeAllowlistedPath(path)) {
      throw Object.assign(
        new Error(`Path is outside Public API facade: ${path}`),
        {
          status: 403,
          type: "authorization",
          subtype: "facade_only",
        }
      );
    }
  }

  const requestId = options.requestId ?? newRequestId();
  const base = options.profile.apiBaseUrl.replace(/\/$/, "");
  // path may be full /api/v1/... while base already ends with /api/v1
  let url: string;
  if (path.startsWith("/api/v1")) {
    const origin = base.replace(/\/api\/v1$/, "");
    url = `${origin}${path}${query}`;
  } else if (path.startsWith("/api/auth")) {
    const origin = base.replace(/\/api\/v1$/, "");
    url = `${origin}${path}${query}`;
  } else {
    url = `${base}${path.startsWith("/") ? path : `/${path}`}${query}`;
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
    "X-Request-Id": requestId,
    "X-Alphafox-Client": "alphafox-cli",
    "X-Alphafox-Client-Version": env.ALPHAFOX_CLI_VERSION ?? CLI_VERSION,
    ...(options.headers ?? {}),
  };

  if (!options.skipAuth) {
    let tokens = loadTokens(options.profile.name, env);
    // Proactive refresh before the access token expires (or once already expired).
    if (tokens && accessTokenNeedsRefresh(tokens)) {
      const outcome = await refreshStoredTokens(
        options.profile,
        env,
        fetchImpl,
        { force: true }
      );
      if (outcome.status === "refreshed" || outcome.status === "unchanged") {
        tokens = outcome.tokens;
      }
      // On failed refresh keep prior tokens only for the request; do not treat
      // failure as a successful renewal.
    }
    if (tokens) {
      // Never send tokens to a different site than the profile audience.
      // Apex/www (and trailing host variants) of the same registrable domain
      // are treated as equivalent so production domain redirects do not break CLI.
      const tokenAudienceOrigin = originOf(tokens.audience);
      const targetOrigin = originOf(url);
      if (
        tokens.audience &&
        tokenAudienceOrigin &&
        targetOrigin &&
        !sameAuthSite(tokenAudienceOrigin, targetOrigin)
      ) {
        throw Object.assign(
          new Error(
            "Refusing to send stored tokens to a different origin than token audience (fail-closed)."
          ),
          {
            status: 403,
            type: "authorization",
            subtype: "cross_origin_token",
          }
        );
      }
      headers.Authorization = `Bearer ${tokens.accessToken}`;
    }
  }

  if (options.idempotencyKey) {
    headers["Idempotency-Key"] = options.idempotencyKey;
  }

  const init: RequestInit = {
    method: options.method.toUpperCase(),
    headers,
    redirect: "manual",
  };
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await fetchFollowingAuthRedirects(fetchImpl, url, init);
  } catch (err) {
    if (!isReadMethod(init.method)) {
      throw Object.assign(
        new Error(
          `Mutation outcome is unknown: ${err instanceof Error ? err.message : String(err)}`
        ),
        {
          type: "http",
          subtype: "outcome_unknown",
          requestId,
          details: {
            method: init.method,
            path: options.path,
            reason: err instanceof Error ? err.message : String(err),
          },
        }
      );
    }
    throw err;
  }
  const bodyText = await response.text();
  let json: unknown = null;
  try {
    json = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    json = { raw: bodyText };
  }
  const responseRequestId =
    response.headers.get("x-request-id") ??
    response.headers.get("X-Request-Id") ??
    requestId;

  // Reactive: one silent refresh+retry on 401 for authenticated product calls.
  // Reactive refresh is safe for reads and explicitly idempotent, keyed catalog mutations.
  if (
    response.status === 401 &&
    !options.skipAuth &&
    !options._refreshRetried &&
    !isOAuthAsPath &&
    (isReadMethod(init.method) ||
      (options.catalogIdempotent === true && Boolean(options.idempotencyKey)))
  ) {
    const tokens = loadTokens(options.profile.name, env);
    if (tokens?.refreshToken?.trim()) {
      const outcome = await refreshStoredTokens(
        options.profile,
        env,
        fetchImpl,
        { force: true }
      );
      if (outcome.status === "refreshed") {
        return apiRequest(
          { ...options, requestId, _refreshRetried: true },
          env,
          fetchImpl
        );
      }
    }
  }

  return {
    status: response.status,
    headers: response.headers,
    bodyText,
    requestId: responseRequestId,
    json,
    ...(isMutationMethod(init.method) && REDIRECT_STATUSES.has(response.status)
      ? { outcome: "outcome_unknown" as const }
      : {}),
  };
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function isReadMethod(method: string | undefined): boolean {
  const normalized = (method ?? "GET").toUpperCase();
  return normalized === "GET" || normalized === "HEAD";
}

function isMutationMethod(method: string | undefined): boolean {
  return !isReadMethod(method);
}

/** Follow only exact-origin redirects for reads; never replay mutations. */
async function fetchFollowingAuthRedirects(
  fetchImpl: typeof fetch,
  startUrl: string,
  init: RequestInit,
  maxHops = 5
): Promise<Response> {
  let url = startUrl;
  const method = (init.method ?? "GET").toUpperCase();
  if (!isReadMethod(method)) {
    return fetchImpl(url, { ...init, method, redirect: "manual" });
  }

  let response = await fetchImpl(url, { ...init, method, redirect: "manual" });
  for (let hop = 0; hop < maxHops && REDIRECT_STATUSES.has(response.status); hop++) {
    const location = response.headers.get("location");
    if (!location) break;
    let nextUrl: string;
    try {
      nextUrl = new URL(location, url).toString();
    } catch {
      break;
    }
    if (originOf(url) !== originOf(nextUrl)) break;
    url = nextUrl;
    response = await fetchImpl(url, { ...init, method, redirect: "manual" });
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

/** Apex and www hosts of the same site share auth tokens. */
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

/** Split raw path so allowlist uses path-only while fetch keeps query. */
function splitPathAndQuery(raw: string): {
  readonly path: string;
  readonly query: string;
} {
  const trimmed = raw.trim();
  const q = trimmed.indexOf("?");
  if (q < 0) {
    return { path: normalizeApiPath(trimmed), query: "" };
  }
  return {
    path: normalizeApiPath(trimmed.slice(0, q)),
    query: trimmed.slice(q),
  };
}
