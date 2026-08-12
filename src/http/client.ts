import { newRequestId } from "../envelope";
import type { ProfileConfig } from "../config/profiles";
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
}

export interface ApiResponse {
  readonly status: number;
  readonly headers: Headers;
  readonly bodyText: string;
  readonly requestId: string;
  readonly json: unknown;
}

export async function apiRequest(
  options: ApiRequestOptions,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch
): Promise<ApiResponse> {
  const path = normalizeApiPath(options.path);
  if (isInternalDisallowedPath(path)) {
    throw Object.assign(new Error(`Path is internal and not allowed: ${path}`), {
      status: 403,
      type: "authorization",
      subtype: "internal_path_forbidden",
    });
  }
  // Product raw API: /api/v1 only. Auth AS paths under /api/auth/oauth are allowed.
  const isOAuthAsPath = path.startsWith("/api/auth/oauth");
  if (
    !isOAuthAsPath &&
    !isFacadeAllowlistedPath(path) &&
    path.startsWith("/api/") &&
    !path.startsWith("/api/v1")
  ) {
    throw Object.assign(
      new Error(`Path is outside Public API facade: ${path}`),
      {
        status: 403,
        type: "authorization",
        subtype: "facade_only",
      }
    );
  }

  const requestId = options.requestId ?? newRequestId();
  const base = options.profile.apiBaseUrl.replace(/\/$/, "");
  // path may be full /api/v1/... while base already ends with /api/v1
  let url: string;
  if (path.startsWith("/api/v1")) {
    const origin = base.replace(/\/api\/v1$/, "");
    url = `${origin}${path}`;
  } else if (path.startsWith("/api/auth")) {
    const origin = base.replace(/\/api\/v1$/, "");
    url = `${origin}${path}`;
  } else {
    url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
    "X-Request-Id": requestId,
    "X-Alphafox-Client": "alphafox-cli",
    "X-Alphafox-Client-Version": env.ALPHAFOX_CLI_VERSION ?? "0.1.0",
    ...(options.headers ?? {}),
  };

  if (!options.skipAuth) {
    const tokens = loadTokens(options.profile.name, env);
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
    // Follow redirects ourselves so Authorization is re-attached after apex→www.
    // fetch()'s automatic redirect drops Authorization on cross-origin hops.
    redirect: "manual",
  };
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(options.body);
  }

  const response = await fetchFollowingAuthRedirects(fetchImpl, url, init);
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

  return {
    status: response.status,
    headers: response.headers,
    bodyText,
    requestId: responseRequestId,
    json,
  };
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * Re-issue requests on same-site redirects while keeping Authorization.
 * Needed because alphafox.app → www.alphafox.app is a cross-origin hop for fetch.
 */
async function fetchFollowingAuthRedirects(
  fetchImpl: typeof fetch,
  startUrl: string,
  init: RequestInit,
  maxHops = 5
): Promise<Response> {
  let url = startUrl;
  let method = (init.method ?? "GET").toUpperCase();
  let body = init.body;
  let response = await fetchImpl(url, { ...init, method, body, redirect: "manual" });

  for (let hop = 0; hop < maxHops && REDIRECT_STATUSES.has(response.status); hop++) {
    const location = response.headers.get("location");
    if (!location) {
      break;
    }
    const nextUrl = new URL(location, url).toString();
    if (!sameAuthSite(originOf(url), originOf(nextUrl))) {
      break;
    }
    // 303 switches to GET without body; 301/302 historically do for non-GET.
    if (
      response.status === 303 ||
      ((response.status === 301 || response.status === 302) && method !== "GET" && method !== "HEAD")
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
