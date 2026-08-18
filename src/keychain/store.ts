import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmodSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ProfileConfig } from "../config/profiles";
import { canonicalAuthorityUrl, canonicalProfile, profileCredentialSlot } from "../config/profiles";
import { linuxSecretServiceAvailable, linuxSecretServiceDelete, linuxSecretServiceReadResult, linuxSecretServiceWrite } from "./linux-secret-service";
import { windowsCredentialAvailable, windowsCredentialDelete, windowsCredentialReadResult, windowsCredentialWrite } from "./windows-credential";

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
export type OsKeychainKind = "macos-security" | "linux-secret-service" | "windows-credential-manager" | "none";
export interface TokenStorageResult { readonly backend: TokenStorageBackend; readonly kind?: OsKeychainKind; readonly path?: string; readonly degraded: boolean; }

export class CredentialError extends Error {
  readonly type: "auth" | "runtime";
  readonly subtype: string;
  readonly status: number;
  readonly details?: Readonly<Record<string, unknown>>;
  constructor(input: { readonly type: "auth" | "runtime"; readonly subtype: string; readonly status: number; readonly message: string; readonly details?: Readonly<Record<string, unknown>> }) {
    super(input.message);
    this.name = "CredentialError";
    this.type = input.type;
    this.subtype = input.subtype;
    this.status = input.status;
    this.details = input.details;
  }
}

let lastSaveResult: TokenStorageResult | null = null;
export function getLastTokenSaveResult(): TokenStorageResult | null { return lastSaveResult; }
export function credentialSlot(profile: ProfileConfig): string { return profileCredentialSlot(canonicalProfile(profile)); }
export function keychainServiceName(profile: ProfileConfig): string { return `alphafox-cli.${credentialSlot(profile)}`; }
export function keychainAccountName(): string { return "oauth-tokens"; }

/** Test-only override. Production uses process.platform. */
export function keychainPlatform(env: NodeJS.ProcessEnv = process.env): NodeJS.Platform {
  const raw = env.ALPHAFOX_KEYCHAIN_PLATFORM?.trim();
  return raw === "darwin" || raw === "linux" || raw === "win32" ? raw : process.platform;
}

export function probeOsKeychain(env: NodeJS.ProcessEnv = process.env): { readonly kind: OsKeychainKind; readonly available: boolean } {
  const platform = keychainPlatform(env);
  if (platform === "darwin") return { kind: "macos-security", available: true };
  if (platform === "linux") return { kind: "linux-secret-service", available: linuxSecretServiceAvailable(env) };
  if (platform === "win32") return { kind: "windows-credential-manager", available: windowsCredentialAvailable(env) };
  return { kind: "none", available: false };
}

function filePath(profile: ProfileConfig, env: NodeJS.ProcessEnv): string {
  const base = env.ALPHAFOX_KEYCHAIN_DIR?.trim() || join(homedir(), ".config", "alphafox", "keychain");
  return join(base, `${credentialSlot(profile)}.tokens.json`);
}
function fileMode(path: string): number { return statSync(path).mode & 0o777; }
function keychainFailure(subtype: string, message: string): CredentialError { return new CredentialError({ type: "runtime", subtype, status: 503, message }); }
function invalidCredential(): CredentialError { return new CredentialError({ type: "auth", subtype: "credential_invalid", status: 401, message: "Stored credentials are invalid for this profile. Run alphafox auth login again." }); }

function validateTokens(raw: unknown, profile: ProfileConfig): StoredTokens {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw invalidCredential();
  const value = raw as Record<string, unknown>;
  if (typeof value.accessToken !== "string" || !value.accessToken.trim() || typeof value.refreshToken !== "string" || typeof value.expiresAt !== "number" || !Number.isFinite(value.expiresAt) || typeof value.environment !== "string" || !value.environment || typeof value.issuer !== "string" || !value.issuer || typeof value.audience !== "string" || !value.audience || typeof value.clientId !== "string" || !value.clientId || !Array.isArray(value.scopes) || !value.scopes.every((scope) => typeof scope === "string")) throw invalidCredential();
  const canonical = canonicalProfile(profile);
  let issuer: string;
  let audience: string;
  try { issuer = canonicalAuthorityUrl(value.issuer, "issuer"); audience = canonicalAuthorityUrl(value.audience, "audience"); } catch { throw invalidCredential(); }
  if (value.environment !== canonical.name || issuer !== canonical.issuer || audience !== canonical.audience || value.clientId !== canonical.clientId) throw invalidCredential();
  return { accessToken: value.accessToken, refreshToken: value.refreshToken, expiresAt: value.expiresAt, environment: value.environment, issuer, audience, clientId: value.clientId, scopes: value.scopes as string[] };
}

function parsePayload(payload: string, profile: ProfileConfig): StoredTokens {
  try { return validateTokens(JSON.parse(payload), profile); } catch (error) { if (error instanceof CredentialError) throw error; throw invalidCredential(); }
}

function ensureFileDir(path: string): void {
  const dir = join(path, "..");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  if (fileMode(dir) !== 0o700) throw keychainFailure("file_keychain_insecure", "File credential storage requires a private directory.");
}

function writeSecureFile(path: string, payload: string): void {
  ensureFileDir(path);
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  let fd: number | undefined;
  try {
    fd = openSync(temp, "wx", 0o600);
    writeSync(fd, payload, undefined, "utf8");
    fsyncSync(fd);
    closeSync(fd); fd = undefined;
    chmodSync(temp, 0o600);
    renameSync(temp, path);
    chmodSync(path, 0o600);
    if (fileMode(path) !== 0o600) throw keychainFailure("file_keychain_insecure", "File credential storage requires mode 0600.");
  } catch (error) {
    if (fd !== undefined) closeSync(fd);
    try { unlinkSync(temp); } catch { /* best effort */ }
    if (error instanceof CredentialError) throw error;
    throw keychainFailure("keychain_write_failed", "Unable to persist credentials securely.");
  }
}

function readSecureFile(path: string, profile: ProfileConfig): StoredTokens | null {
  if (!existsSync(path)) return null;
  try {
    if (fileMode(path) !== 0o600) { chmodSync(path, 0o600); if (fileMode(path) !== 0o600) throw invalidCredential(); }
    return parsePayload(readFileSync(path, "utf8"), profile);
  } catch (error) {
    if (error instanceof CredentialError) throw error;
    throw invalidCredential();
  }
}

function requireExplicitFileMode(profile: ProfileConfig, env: NodeJS.ProcessEnv): string {
  if (keychainPlatform(env) === "win32") throw keychainFailure("file_keychain_unsupported", "Explicit file credential storage is unavailable on Windows.");
  return filePath(profile, env);
}

function macRead(profile: ProfileConfig): { readonly status: "found"; readonly value: string } | { readonly status: "missing" } {
  try {
    const value = execFileSync("security", ["find-generic-password", "-s", keychainServiceName(profile), "-a", keychainAccountName(), "-w"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return value ? { status: "found", value } : { status: "missing" };
  } catch (error) {
    const status = error && typeof error === "object" && "status" in error && typeof error.status === "number" ? error.status : undefined;
    if (status === 44) return { status: "missing" };
    throw error;
  }
}

export function saveTokens(profile: ProfileConfig, tokens: StoredTokens, env: NodeJS.ProcessEnv = process.env): TokenStorageResult {
  const canonical = canonicalProfile(profile);
  const checked = validateTokens(tokens, canonical);
  const payload = JSON.stringify(checked);
  if (env.ALPHAFOX_FORCE_FILE_KEYCHAIN === "1") {
    const path = requireExplicitFileMode(canonical, env); writeSecureFile(path, payload);
    lastSaveResult = { backend: "file", path, degraded: false }; return lastSaveResult;
  }
  const probe = probeOsKeychain(env);
  if (!probe.available) throw keychainFailure("keychain_unavailable", "OS credential storage is unavailable. Set up the OS keychain or use explicit POSIX file mode.");
  try {
    if (probe.kind === "linux-secret-service") linuxSecretServiceWrite(keychainServiceName(canonical), keychainAccountName(), payload, env);
    else if (probe.kind === "windows-credential-manager") windowsCredentialWrite(credentialSlot(canonical), payload, env);
    else if (probe.kind === "macos-security") execFileSync("security", ["add-generic-password", "-s", keychainServiceName(canonical), "-a", keychainAccountName(), "-w", payload, "-U"], { stdio: "ignore" });
    else throw keychainFailure("keychain_unavailable", "OS credential storage is unavailable.");
  } catch (error) {
    if (error instanceof CredentialError) throw error;
    throw keychainFailure("keychain_write_failed", "OS credential storage failed while saving credentials.");
  }
  lastSaveResult = { backend: "keychain", kind: probe.kind, degraded: false }; return lastSaveResult;
}

export function loadTokens(profile: ProfileConfig, env: NodeJS.ProcessEnv = process.env): StoredTokens | null {
  const canonical = canonicalProfile(profile);
  if (env.ALPHAFOX_TEST_ACCESS_TOKEN?.trim()) {
    const expires = env.ALPHAFOX_TEST_EXPIRES_AT?.trim();
    const injected: StoredTokens = { accessToken: env.ALPHAFOX_TEST_ACCESS_TOKEN.trim(), refreshToken: env.ALPHAFOX_TEST_REFRESH_TOKEN ?? "", expiresAt: expires ? Number(expires) : Date.now() + 3_600_000, environment: env.ALPHAFOX_TEST_ENVIRONMENT ?? canonical.name, issuer: env.ALPHAFOX_TEST_ISSUER ?? canonical.issuer, audience: env.ALPHAFOX_TEST_AUDIENCE ?? "", clientId: env.ALPHAFOX_TEST_CLIENT_ID ?? canonical.clientId, scopes: (env.ALPHAFOX_TEST_SCOPES ?? "openid profile").split(/\s+/).filter(Boolean) };
    return validateTokens(injected, canonical);
  }
  if (env.ALPHAFOX_FORCE_FILE_KEYCHAIN === "1") return readSecureFile(requireExplicitFileMode(canonical, env), canonical);
  const probe = probeOsKeychain(env);
  if (!probe.available) throw keychainFailure("keychain_unavailable", "OS credential storage is unavailable. Set up the OS keychain or use explicit POSIX file mode.");
  let result: { readonly status: "found"; readonly value: string } | { readonly status: "missing" };
  try {
    if (probe.kind === "linux-secret-service") result = linuxSecretServiceReadResult(keychainServiceName(canonical), keychainAccountName(), env);
    else if (probe.kind === "windows-credential-manager") result = windowsCredentialReadResult(credentialSlot(canonical), env);
    else if (probe.kind === "macos-security") result = macRead(canonical);
    else throw keychainFailure("keychain_unavailable", "OS credential storage is unavailable.");
  } catch (error) { if (error instanceof CredentialError) throw error; throw keychainFailure("keychain_read_failed", "OS credential storage failed while reading credentials."); }
  return result.status === "found" ? parsePayload(result.value, canonical) : null;
}

export function deleteTokens(profile: ProfileConfig, env: NodeJS.ProcessEnv = process.env): void {
  const canonical = canonicalProfile(profile);
  if (env.ALPHAFOX_FORCE_FILE_KEYCHAIN === "1") {
    const path = requireExplicitFileMode(canonical, env); try { unlinkSync(path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw keychainFailure("keychain_delete_failed", "Unable to remove file credentials securely."); } return;
  }
  const probe = probeOsKeychain(env);
  if (!probe.available) throw keychainFailure("keychain_unavailable", "OS credential storage is unavailable. Set up the OS keychain or use explicit POSIX file mode.");
  try {
    if (probe.kind === "linux-secret-service") linuxSecretServiceDelete(keychainServiceName(canonical), keychainAccountName(), env);
    else if (probe.kind === "windows-credential-manager") windowsCredentialDelete(credentialSlot(canonical), env);
    else if (probe.kind === "macos-security") { try { execFileSync("security", ["delete-generic-password", "-s", keychainServiceName(canonical), "-a", keychainAccountName()], { stdio: "ignore" }); } catch (error) { const status = error && typeof error === "object" && "status" in error && typeof error.status === "number" ? error.status : undefined; if (status !== 44) throw error; } }
  } catch (error) { if (error instanceof CredentialError) throw error; throw keychainFailure("keychain_delete_failed", "OS credential storage failed while removing credentials."); }
}

export function tokenFingerprint(token: string): string { return createHash("sha256").update(token).digest("hex").slice(0, 12); }
