import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type ProfileName = "production" | "staging" | "local";
const PROFILE_NAMES: readonly ProfileName[] = ["production", "staging", "local"];
const PROFILE_FIELDS = new Set(["name", "apiBaseUrl", "issuer", "audience", "clientId", "contractVersion", "localOrigin"]);

export interface ProfileConfig {
  readonly name: ProfileName;
  readonly apiBaseUrl: string;
  readonly issuer: string;
  readonly audience: string;
  readonly clientId: string;
  readonly contractVersion?: string;
  readonly localOrigin?: string;
}

export interface CliConfigFile {
  readonly activeProfile: ProfileName;
  readonly profiles: Partial<Record<ProfileName, Partial<ProfileConfig>>>;
  readonly unsafeCustomEndpoint?: string;
  readonly __tokensForbidden?: never;
}

const DEFAULTS: Record<ProfileName, ProfileConfig> = {
  production: { name: "production", apiBaseUrl: "https://alphafox.app/api/v1", issuer: "https://alphafox.app/api/auth", audience: "https://alphafox.app/api/v1", clientId: "alphafox-cli-prod", contractVersion: "2026-08-13" },
  staging: { name: "staging", apiBaseUrl: "https://staging.alphafox.app/api/v1", issuer: "https://staging.alphafox.app/api/auth", audience: "https://staging.alphafox.app/api/v1", clientId: "alphafox-cli-staging", contractVersion: "2026-08-13" },
  local: { name: "local", apiBaseUrl: "http://127.0.0.1:3000/api/v1", issuer: "http://127.0.0.1:3000/api/auth", audience: "http://127.0.0.1:3000/api/v1", clientId: "alphafox-cli-local", localOrigin: "http://127.0.0.1:3000", contractVersion: "2026-08-13" },
};

export function isProfileName(value: unknown): value is ProfileName {
  return typeof value === "string" && PROFILE_NAMES.includes(value as ProfileName);
}

/** Normalize an authority URL without erasing its meaningful path. */
export function canonicalAuthorityUrl(value: string, field = "authority"): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Invalid profile ${field}: expected a URL.`);
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error(`Invalid profile ${field}: expected an absolute URL.`); }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`Invalid profile ${field}: only http(s) URLs are allowed.`);
  if (url.username || url.password || url.search || url.hash) throw new Error(`Invalid profile ${field}: credentials, query, and fragment are forbidden.`);
  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();
  if ((url.protocol === "http:" && url.port === "80") || (url.protocol === "https:" && url.port === "443")) url.port = "";
  url.pathname = url.pathname.replace(/\/{2,}/g, "/").replace(/\/+$/, "") || "/";
  return url.toString().replace(/\/$/, "");
}

/** Canonical profile identity used to bind every persisted record. */
export function canonicalProfile(profile: ProfileConfig): ProfileConfig {
  if (!profile || typeof profile !== "object" || !isProfileName(profile.name)) throw new Error("Invalid profile: name must be production|staging|local.");
  if (typeof profile.clientId !== "string" || !profile.clientId.trim()) throw new Error(`Invalid profile ${profile.name}: clientId is required.`);
  return {
    ...profile,
    name: profile.name,
    apiBaseUrl: canonicalAuthorityUrl(profile.apiBaseUrl, "apiBaseUrl"),
    issuer: canonicalAuthorityUrl(profile.issuer, "issuer"),
    audience: canonicalAuthorityUrl(profile.audience, "audience"),
    clientId: profile.clientId.trim(),
    ...(profile.localOrigin ? { localOrigin: canonicalAuthorityUrl(profile.localOrigin, "localOrigin") } : {}),
  };
}

/** Stable authority-derived namespace; same labels on different authorities cannot collide. */
export function profileCredentialSlot(profile: ProfileConfig): string {
  const canonical = canonicalProfile(profile);
  const tuple = [canonical.name, canonical.apiBaseUrl, canonical.issuer, canonical.audience, canonical.clientId].join("\n");
  return `${canonical.name}-${createHash("sha256").update(tuple).digest("hex").slice(0, 24)}`;
}

export function defaultConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.ALPHAFOX_CONFIG_DIR?.trim()) return env.ALPHAFOX_CONFIG_DIR.trim();
  return join(homedir(), ".config", "alphafox");
}

export function configFilePath(env: NodeJS.ProcessEnv = process.env): string { return join(defaultConfigDir(env), "config.json"); }

function assertPlainObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid config: ${label} must be an object.`);
}

function validateProfileOverrides(profiles: unknown): asserts profiles is Partial<Record<ProfileName, Partial<ProfileConfig>>> {
  assertPlainObject(profiles, "profiles");
  for (const [key, value] of Object.entries(profiles)) {
    if (!isProfileName(key)) throw new Error(`Invalid config: unknown profile "${key}".`);
    assertPlainObject(value, `profiles.${key}`);
    for (const field of Object.keys(value)) if (!PROFILE_FIELDS.has(field)) throw new Error(`Invalid config: unknown field profiles.${key}.${field}.`);
    if ("name" in value && value.name !== key) throw new Error(`Invalid config: profiles.${key}.name must be "${key}".`);
  }
}

export function loadConfigFile(env: NodeJS.ProcessEnv = process.env): CliConfigFile {
  const path = configFilePath(env);
  if (!existsSync(path)) return { activeProfile: "production", profiles: {} };
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
  assertPlainObject(raw, "root");
  if (raw.tokens != null || raw.accessToken != null || raw.refreshToken != null || raw.secret != null) throw new Error("Refusing to load config: tokens/secrets must not be stored in config files. Remove them and use the OS keychain.");
  const activeProfile = raw.activeProfile ?? "production";
  if (!isProfileName(activeProfile)) throw new Error(`Invalid config: unknown activeProfile "${String(activeProfile)}".`);
  validateProfileOverrides(raw.profiles ?? {});
  if (raw.unsafeCustomEndpoint != null && typeof raw.unsafeCustomEndpoint !== "string") throw new Error("Invalid config: unsafeCustomEndpoint must be a string.");
  return { activeProfile, profiles: raw.profiles as Partial<Record<ProfileName, Partial<ProfileConfig>>>, unsafeCustomEndpoint: raw.unsafeCustomEndpoint as string | undefined };
}

export function saveConfigFile(config: CliConfigFile, env: NodeJS.ProcessEnv = process.env): void {
  assertNoTokenFields(config);
  validateProfileOverrides(config.profiles);
  if (!isProfileName(config.activeProfile)) throw new Error(`Invalid config: unknown activeProfile "${String(config.activeProfile)}".`);
  const safe: CliConfigFile = { activeProfile: config.activeProfile, profiles: config.profiles, ...(config.unsafeCustomEndpoint ? { unsafeCustomEndpoint: config.unsafeCustomEndpoint } : {}) };
  const dir = defaultConfigDir(env);
  mkdirSync(dir, { recursive: true });
  writeFileSync(configFilePath(env), `${JSON.stringify(safe, null, 2)}\n`, { mode: 0o600 });
}

export function resolveProfile(name?: ProfileName | string, env: NodeJS.ProcessEnv = process.env, options: { readonly unsafeCustomEndpoint?: string } = {}): ProfileConfig {
  const file = loadConfigFile(env);
  const profileName = name || env.ALPHAFOX_PROFILE || file.activeProfile || "production";
  if (!isProfileName(profileName)) throw new Error(`Unknown profile "${profileName}". Use production|staging|local.`);
  const base = { ...DEFAULTS[profileName], ...(file.profiles[profileName] ?? {}), name: profileName };
  if (profileName === "local" && env.ALPHAFOX_LOCAL_ORIGIN?.trim()) {
    const origin = canonicalAuthorityUrl(env.ALPHAFOX_LOCAL_ORIGIN.trim().replace(/\/$/, ""), "localOrigin");
    return canonicalProfile({ ...base, name: "local", localOrigin: origin, apiBaseUrl: `${origin}/api/v1`, issuer: `${origin}/api/auth`, audience: `${origin}/api/v1` });
  }
  const custom = options.unsafeCustomEndpoint || env.ALPHAFOX_UNSAFE_CUSTOM_ENDPOINT || file.unsafeCustomEndpoint;
  if (custom) {
    const endpoint = canonicalAuthorityUrl(custom, "unsafeCustomEndpoint");
    const origin = endpoint.replace(/\/api\/v1$/, "");
    return canonicalProfile({ ...base, name: profileName, apiBaseUrl: endpoint.endsWith("/api/v1") ? endpoint : `${origin}/api/v1`, issuer: `${origin}/api/auth`, audience: endpoint.endsWith("/api/v1") ? endpoint : `${origin}/api/v1` });
  }
  return canonicalProfile(base);
}

export function assertNoTokenFields(config: unknown): void {
  if (!config || typeof config !== "object") return;
  for (const key of Object.keys(config as Record<string, unknown>)) {
    const lower = key.toLowerCase();
    if (lower.includes("token") || lower.includes("secret") || lower.includes("password") || lower === "authorization") throw new Error(`Forbidden config field: ${key}`);
  }
}
