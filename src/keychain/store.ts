/**
 * OS keychain token storage. Config files never receive tokens.
 * Test injection: ALPHAFOX_TEST_ACCESS_TOKEN / ALPHAFOX_TEST_REFRESH_TOKEN
 * (local unit tests only; not a production automation path — ADR 0004).
 */

import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fchmodSync,
  fstatSync,
  ftruncateSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import {
  linuxSecretServiceAvailable,
  linuxSecretServiceDelete,
  linuxSecretServiceRead,
  linuxSecretServiceWrite,
} from "./linux-secret-service";
import {
  windowsCredentialAvailable,
  windowsCredentialDelete,
  windowsCredentialRead,
  windowsCredentialWrite,
} from "./windows-credential";

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

export type OsKeychainKind =
  | "macos-security"
  | "linux-secret-service"
  | "windows-credential-manager"
  | "none";

export interface TokenStorageResult {
  readonly backend: TokenStorageBackend;
  readonly kind?: OsKeychainKind;
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

export function keychainServiceName(profile: string): string {
  return `alphafox-cli.${profile}`;
}

export function keychainAccountName(): string {
  return "oauth-tokens";
}

function serviceName(profile: string): string {
  return keychainServiceName(profile);
}

function accountName(): string {
  return keychainAccountName();
}

/** Test-only override. Production code uses process.platform. */
export function keychainPlatform(
  env: NodeJS.ProcessEnv = process.env
): NodeJS.Platform {
  const raw = env.ALPHAFOX_KEYCHAIN_PLATFORM?.trim();
  if (raw === "darwin" || raw === "linux" || raw === "win32") {
    return raw;
  }
  return process.platform;
}

export function probeOsKeychain(
  env: NodeJS.ProcessEnv = process.env
): { readonly kind: OsKeychainKind; readonly available: boolean } {
  const platform = keychainPlatform(env);
  if (platform === "darwin") {
    return { kind: "macos-security", available: true };
  }
  if (platform === "linux") {
    return {
      kind: "linux-secret-service",
      available: linuxSecretServiceAvailable(env),
    };
  }
  if (platform === "win32") {
    return {
      kind: "windows-credential-manager",
      available: windowsCredentialAvailable(env),
    };
  }
  return { kind: "none", available: false };
}

/** File fallback under secure mode 0600 when OS keychain is unavailable (CI/Linux headless). */
function fileFallbackPath(profile: string, env: NodeJS.ProcessEnv): string {
  const base =
    env.ALPHAFOX_KEYCHAIN_DIR?.trim() ||
    join(homedir(), ".config", "alphafox", "keychain");
  return join(base, `${profile}.tokens.json`);
}

function assertKeychainPolicy(env: NodeJS.ProcessEnv): void {
  if (env.ALPHAFOX_REQUIRE_OS_KEYCHAIN !== "1") return;
  if (
    env.ALPHAFOX_FORCE_FILE_KEYCHAIN === "1" ||
    env.ALPHAFOX_TEST_ACCESS_TOKEN?.trim() ||
    env.ALPHAFOX_TEST_REFRESH_TOKEN?.trim()
  ) {
    throw Object.assign(new Error(
      "ALPHAFOX_REQUIRE_OS_KEYCHAIN=1 conflicts with ALPHAFOX_FORCE_FILE_KEYCHAIN=1 and test token injection. Unset the conflicting override."
    ), { type: "credential_storage", subtype: "keychain_policy_conflict" });
  }
}

export function saveTokens(
  profile: string,
  tokens: StoredTokens,
  env: NodeJS.ProcessEnv = process.env
): TokenStorageResult {
  lastSaveResult = null;
  assertKeychainPolicy(env);
  const payload = JSON.stringify(tokens);
  if (tryKeychainWrite(profile, payload, env)) {
    lastSaveResult = {
      backend: "keychain",
      kind: probeOsKeychain(env).kind,
      degraded: false,
    };
    return lastSaveResult;
  }
  if (env.ALPHAFOX_REQUIRE_OS_KEYCHAIN === "1") {
    throw Object.assign(new Error(
      "OS keychain save failed; ALPHAFOX_REQUIRE_OS_KEYCHAIN=1 forbids plaintext fallback. Unlock/configure the OS keychain and retry login."
    ), { type: "credential_storage", subtype: "os_keychain_required" });
  }
  const path = fileFallbackPath(profile, env);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileFallback(path, payload);
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

function writeFileFallback(path: string, payload: string): void {
  const notRegular = () => Object.assign(new Error(
    "Refusing to store credentials in a symlink or non-regular file."
  ), { type: "credential_storage", subtype: "unsafe_fallback_file" });
  const existing = lstatSync(path, { throwIfNoEntry: false });
  if (existing && !existing.isFile()) throw notRegular();
  // Do not truncate on open: existing permissions must be repaired first.
  // O_NOFOLLOW closes the final-component symlink race on POSIX; O_NONBLOCK
  // avoids blocking on a raced FIFO before fstat can reject it.
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT |
    (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0), 0o600);
  try {
    if (!fstatSync(fd).isFile()) throw notRegular();
    if (process.platform !== "win32") fchmodSync(fd, 0o600);
    ftruncateSync(fd, 0);
    writeFileSync(fd, payload);
  } finally {
    closeSync(fd);
  }
}

export function loadTokens(
  profile: string,
  env: NodeJS.ProcessEnv = process.env
): StoredTokens | null {
  assertKeychainPolicy(env);
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
  if (env.ALPHAFOX_REQUIRE_OS_KEYCHAIN === "1") {
    // Inspect metadata only, including dangling links; never read plaintext.
    if (!lstatSync(path, { throwIfNoEntry: false })) return null;
    throw Object.assign(new Error(
      `Legacy plaintext credentials exist at ${path}; ALPHAFOX_REQUIRE_OS_KEYCHAIN=1 refuses to read them. Revoke the old session and remove the file explicitly; strict mode does not migrate or delete it.`
    ), { type: "credential_storage", subtype: "plaintext_credentials_disallowed" });
  }
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
  const platform = keychainPlatform(env);
  if (platform === "linux") {
    return linuxSecretServiceWrite(
      serviceName(profile),
      accountName(),
      payload,
      env
    );
  }
  if (platform === "win32") {
    return windowsCredentialWrite(profile, payload, env);
  }
  if (platform === "darwin") {
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
  const platform = keychainPlatform(env);
  if (platform === "linux") {
    return linuxSecretServiceRead(serviceName(profile), accountName(), env);
  }
  if (platform === "win32") {
    return windowsCredentialRead(profile, env);
  }
  if (platform === "darwin") {
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
  const platform = keychainPlatform(env);
  if (platform === "linux") {
    linuxSecretServiceDelete(serviceName(profile), accountName(), env);
    return;
  }
  if (platform === "win32") {
    windowsCredentialDelete(profile, env);
    return;
  }
  if (platform === "darwin") {
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
