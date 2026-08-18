/**
 * Access-token renewal via refresh_token grant.
 * Access tokens are short-lived (~10m); refresh tokens last ~30d (web ADR).
 *
 * Outcomes are explicit: callers must not treat a failed refresh as a healthy session.
 */

import {
  closeSync,
  constants,
  mkdirSync,
  openSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

import type { ProfileConfig } from "../config/profiles";
import { profileCredentialSlot } from "../config/profiles";
import { CLI_VERSION } from "../version";
import { loadTokens, saveTokens, type StoredTokens } from "../keychain/store";

/** Refresh when access token expires within this window. */
export const ACCESS_TOKEN_REFRESH_SKEW_MS = 60_000;

/** Drop a stale inter-process refresh lock after this long. */
export const REFRESH_LOCK_STALE_MS = 30_000;

export type RefreshOutcome =
  | {
      readonly status: "refreshed";
      readonly tokens: StoredTokens;
    }
  | {
      readonly status: "unchanged";
      readonly tokens: StoredTokens;
    }
  | {
      readonly status: "failed";
      readonly reason: string;
      readonly tokens: StoredTokens | null;
    }
  | {
      readonly status: "no_session";
      readonly reason: string;
      readonly tokens: null;
    };

/** In-flight refresh promises so concurrent API calls share one rotation. */
const inflightByProfile = new Map<string, Promise<RefreshOutcome>>();

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
 * Returns a discriminated outcome — never a bare success token on failure.
 */
export async function refreshStoredTokens(
  profile: ProfileConfig,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
  options: {
    readonly now?: number;
    readonly force?: boolean;
  } = {}
): Promise<RefreshOutcome> {
  const existing = loadTokens(profile, env);
  if (!existing?.refreshToken?.trim()) {
    return {
      status: "no_session",
      reason: "no_refresh_token",
      tokens: null,
    };
  }
  const now = options.now ?? Date.now();
  if (!options.force && !accessTokenNeedsRefresh(existing, now)) {
    return { status: "unchanged", tokens: existing };
  }

  return withRefreshLock(profile, env, async () => {
    const latest = loadTokens(profile, env) ?? existing;
    if (!latest?.refreshToken?.trim()) {
      return {
        status: "no_session" as const,
        reason: "no_refresh_token",
        tokens: null,
      };
    }
    const someoneElseRefreshed =
      latest.refreshToken !== existing.refreshToken ||
      latest.expiresAt > existing.expiresAt;
    if (someoneElseRefreshed && !accessTokenNeedsRefresh(latest, now)) {
      return { status: "unchanged" as const, tokens: latest };
    }
    if (!options.force && !accessTokenNeedsRefresh(latest, now)) {
      return { status: "unchanged" as const, tokens: latest };
    }

    const key = profileCredentialSlot(profile);
    const pending = inflightByProfile.get(key);
    if (pending) {
      return pending;
    }

    const work = performRefresh(profile, latest, env, fetchImpl).finally(() => {
      inflightByProfile.delete(key);
    });
    inflightByProfile.set(key, work);
    return work;
  });
}

/**
 * Convenience for callers that only need tokens on successful refresh/unchanged.
 * Returns null for no_session and failed — never pretends failure is success.
 */
export async function refreshStoredTokensOrNull(
  profile: ProfileConfig,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
  options: {
    readonly now?: number;
    readonly force?: boolean;
  } = {}
): Promise<StoredTokens | null> {
  const outcome = await refreshStoredTokens(profile, env, fetchImpl, options);
  if (outcome.status === "refreshed" || outcome.status === "unchanged") {
    return outcome.tokens;
  }
  return null;
}

export function refreshLockFilePath(profile: ProfileConfig, env: NodeJS.ProcessEnv = process.env): string {
  const base = env.ALPHAFOX_KEYCHAIN_DIR?.trim() || join(homedir(), ".config", "alphafox", "keychain");
  return join(base, `${profileCredentialSlot(profile)}.refresh.lock`);
}

async function withRefreshLock<T>(profile: ProfileConfig, env: NodeJS.ProcessEnv, work: () => Promise<T>): Promise<T> {
  const path = refreshLockFilePath(profile, env);
  mkdirSync(dirname(path), { recursive: true });
  const started = Date.now();
  while (true) {
    try {
      const fd = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY);
      try {
        writeFileSync(fd, `${process.pid}\n${Date.now()}\n`);
      } finally {
        closeSync(fd);
      }
      try {
        return await work();
      } finally {
        try {
          unlinkSync(path);
        } catch {
          // another process stole a stale lock
        }
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") {
        throw err;
      }
      try {
        if (Date.now() - statSync(path).mtimeMs > REFRESH_LOCK_STALE_MS) {
          unlinkSync(path);
          continue;
        }
      } catch {
        // lock disappeared; retry acquire
      }
      if (Date.now() - started > REFRESH_LOCK_STALE_MS + 5_000) {
        try {
          unlinkSync(path);
        } catch {
          // raced
        }
        continue;
      }
      await sleep(50);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function performRefresh(
  profile: ProfileConfig,
  existing: StoredTokens,
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch
): Promise<RefreshOutcome> {
  const issuer = profile.issuer.replace(/\/$/, "");
  const url = `${issuer}/oauth/token`;
  const body = {
    grant_type: "refresh_token",
    refresh_token: existing.refreshToken,
    client_id: profile.clientId,
  };

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Alphafox-Client": "alphafox-cli",
        "X-Alphafox-Client-Version": env.ALPHAFOX_CLI_VERSION ?? CLI_VERSION,
      },
      body: JSON.stringify(body),
      redirect: "manual",
    });
  } catch (err) {
    return {
      status: "failed",
      reason: err instanceof Error ? err.message : "network_error",
      tokens: existing,
    };
  }

  if (response.status >= 400) {
    return {
      status: "failed",
      reason: `http_${response.status}`,
      tokens: existing,
    };
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return {
      status: "failed",
      reason: "invalid_json",
      tokens: existing,
    };
  }
  if (!json || typeof json !== "object") {
    return {
      status: "failed",
      reason: "invalid_body",
      tokens: existing,
    };
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
    return {
      status: "failed",
      reason: "missing_tokens",
      tokens: existing,
    };
  }
  const expiresIn =
    typeof o.expires_in === "number"
      ? o.expires_in
      : typeof o.expiresIn === "number"
        ? o.expiresIn
        : 600;
  const scopeRaw =
    typeof o.scope === "string" ? o.scope : existing.scopes.join(" ");

  const next: StoredTokens = {
    accessToken: access,
    refreshToken: refresh,
    expiresAt: Date.now() + expiresIn * 1000,
    environment: profile.name,
    issuer: profile.issuer,
    audience: profile.audience,
    clientId: profile.clientId,
    scopes: scopeRaw.split(/\s+/).filter(Boolean),
  };
  saveTokens(profile, next, env);
  return { status: "refreshed", tokens: next };
}


/** Test helper: clear in-flight map between cases. */
export function clearRefreshInflightForTests(): void {
  inflightByProfile.clear();
}
