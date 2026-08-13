/**
 * OS keychain token storage. Config files never receive tokens.
 * Test injection: ALPHAFOX_TEST_ACCESS_TOKEN / ALPHAFOX_TEST_REFRESH_TOKEN
 * (local unit tests only; not a production automation path — ADR 0004).
 */

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

export interface StoredTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: number;
  readonly environment: string;
  readonly issuer: string;
  readonly audience: string;
  readonly clientId: string;
  readonly scopes: readonly string[];
}

export type TokenStorageBackend = "keychain" | "file" | "test-injection";

export interface TokenStorageResult {
  readonly backend: TokenStorageBackend;
  /** Absolute path when backend is file. */
  readonly path?: string;
  /** True when OS keychain failed/unavailable and file fallback was used. */
  readonly degraded: boolean;
}

/** Last save outcome — callers/tests can observe silent-fallback without stderr parsing. */
let lastSaveResult: TokenStorageResult | null = null;

export function getLastTokenSaveResult(): TokenStorageResult | null {
  return lastSaveResult;
}

function serviceName(profile: string): string {
  return `alphafox-cli.${profile}`;
}

function accountName(): string {
  return "oauth-tokens";
}

/** File fallback under secure mode 0600 when OS keychain is unavailable (CI/Linux headless). */
function fileFallbackPath(profile: string, env: NodeJS.ProcessEnv): string {
  const base =
    env.ALPHAFOX_KEYCHAIN_DIR?.trim() ||
    join(homedir(), ".config", "alphafox", "keychain");
  return join(base, `${profile}.tokens.json`);
}

export function saveTokens(
  profile: string,
  tokens: StoredTokens,
  env: NodeJS.ProcessEnv = process.env
): TokenStorageResult {
  const payload = JSON.stringify(tokens);
  if (tryKeychainWrite(profile, payload, env)) {
    lastSaveResult = { backend: "keychain", degraded: false };
    return lastSaveResult;
  }
  const path = fileFallbackPath(profile, env);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, payload, { mode: 0o600 });
  const intentionalFile = env.ALPHAFOX_FORCE_FILE_KEYCHAIN === "1";
  lastSaveResult = {
    backend: "file",
    path,
    // Intentional file mode is not a silent degrade.
    degraded: !intentionalFile,
  };
  // Observable signal when OS keychain failed unexpectedly (not force-file).
  if (!intentionalFile) {
    process.emitWarning(
      `OS keychain unavailable for profile "${profile}"; tokens stored in file ${path} (mode 0600). Set ALPHAFOX_FORCE_FILE_KEYCHAIN=1 when file storage is intentional.`,
      {
        code: "ALPHAFOX_KEYCHAIN_FILE_FALLBACK",
        detail: path,
      }
    );
  }
  return lastSaveResult;
}

export function loadTokens(
  profile: string,
  env: NodeJS.ProcessEnv = process.env
): StoredTokens | null {
  // Controlled test injection — never document as prod automation.
  if (env.ALPHAFOX_TEST_ACCESS_TOKEN?.trim()) {
    const expiresAtRaw = env.ALPHAFOX_TEST_EXPIRES_AT?.trim();
    const expiresAt = expiresAtRaw
      ? Number(expiresAtRaw)
      : Date.now() + 3600_000;
    return {
      accessToken: env.ALPHAFOX_TEST_ACCESS_TOKEN.trim(),
      refreshToken: env.ALPHAFOX_TEST_REFRESH_TOKEN?.trim() ?? "",
      expiresAt: Number.isFinite(expiresAt) ? expiresAt : Date.now() + 3600_000,
      environment: profile,
      issuer: env.ALPHAFOX_TEST_ISSUER ?? "",
      audience: env.ALPHAFOX_TEST_AUDIENCE ?? "",
      clientId: env.ALPHAFOX_TEST_CLIENT_ID ?? "",
      scopes: (env.ALPHAFOX_TEST_SCOPES ?? "openid profile").split(/\s+/),
    };
  }

  const fromKc = tryKeychainRead(profile, env);
  if (fromKc) {
    return JSON.parse(fromKc) as StoredTokens;
  }
  const path = fileFallbackPath(profile, env);
  if (!existsSync(path)) {
    return null;
  }
  return JSON.parse(readFileSync(path, "utf8")) as StoredTokens;
}

export function deleteTokens(
  profile: string,
  env: NodeJS.ProcessEnv = process.env
): void {
  tryKeychainDelete(profile, env);
  const path = fileFallbackPath(profile, env);
  if (existsSync(path)) {
    unlinkSync(path);
  }
}

export function tokenFingerprint(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 12);
}

function tryKeychainWrite(
  profile: string,
  payload: string,
  env: NodeJS.ProcessEnv
): boolean {
  if (env.ALPHAFOX_FORCE_FILE_KEYCHAIN === "1") {
    return false;
  }
  if (process.platform === "darwin") {
    try {
      // delete existing silently
      try {
        execFileSync(
          "security",
          [
            "delete-generic-password",
            "-s",
            serviceName(profile),
            "-a",
            accountName(),
          ],
          { stdio: "ignore" }
        );
      } catch {
        // none
      }
      execFileSync(
        "security",
        [
          "add-generic-password",
          "-s",
          serviceName(profile),
          "-a",
          accountName(),
          "-w",
          payload,
          "-U",
        ],
        { stdio: "ignore" }
      );
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

function tryKeychainRead(
  profile: string,
  env: NodeJS.ProcessEnv
): string | null {
  if (env.ALPHAFOX_FORCE_FILE_KEYCHAIN === "1") {
    return null;
  }
  if (process.platform === "darwin") {
    try {
      const out = execFileSync(
        "security",
        [
          "find-generic-password",
          "-s",
          serviceName(profile),
          "-a",
          accountName(),
          "-w",
        ],
        { encoding: "utf8" }
      );
      return out.trim();
    } catch {
      return null;
    }
  }
  return null;
}

function tryKeychainDelete(profile: string, env: NodeJS.ProcessEnv): void {
  if (env.ALPHAFOX_FORCE_FILE_KEYCHAIN === "1") {
    return;
  }
  if (process.platform === "darwin") {
    try {
      execFileSync(
        "security",
        [
          "delete-generic-password",
          "-s",
          serviceName(profile),
          "-a",
          accountName(),
        ],
        { stdio: "ignore" }
      );
    } catch {
      // none
    }
  }
}
