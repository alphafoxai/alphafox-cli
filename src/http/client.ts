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
      // Never send tokens to a different origin than the profile audience.
      const tokenAudienceOrigin = originOf(tokens.audience);
      const targetOrigin = originOf(url);
      if (
        tokens.audience &&
        tokenAudienceOrigin &&
        targetOrigin &&
        tokenAudienceOrigin !== targetOrigin
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
  };
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(options.body);
  }

  const response = await fetchImpl(url, init);
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

function originOf(value: string): string | null {
  try {
    if (value.startsWith("http://") || value.startsWith("https://")) {
      return new URL(value).origin;
    }
    return null;
  } catch {
    return null;
  }
}
