import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type ProfileName = "production" | "staging" | "local";

export interface ProfileConfig {
  readonly name: ProfileName;
  readonly apiBaseUrl: string;
  readonly issuer: string;
  readonly audience: string;
  readonly clientId: string;
  readonly contractVersion?: string;
  /** Only for local / unsafe custom. */
  readonly localOrigin?: string;
}

export interface CliConfigFile {
  readonly activeProfile: ProfileName;
  readonly profiles: Partial<Record<ProfileName, Partial<ProfileConfig>>>;
  readonly unsafeCustomEndpoint?: string;
  /**
   * Tokens MUST NOT be stored here. Key is reserved to detect accidental writes.
   * @deprecated never use
   */
  readonly __tokensForbidden?: never;
}

const DEFAULTS: Record<ProfileName, ProfileConfig> = {
  production: {
    name: "production",
    apiBaseUrl: "https://alphafox.app/api/v1",
    issuer: "https://alphafox.app/api/auth",
    audience: "https://alphafox.app/api/v1",
    clientId: "alphafox-cli-prod",
    contractVersion: "2026-08-13",
  },
  staging: {
    name: "staging",
    apiBaseUrl: "https://staging.alphafox.app/api/v1",
    issuer: "https://staging.alphafox.app/api/auth",
    audience: "https://staging.alphafox.app/api/v1",
    clientId: "alphafox-cli-staging",
    contractVersion: "2026-08-13",
  },
  local: {
    name: "local",
    apiBaseUrl: "http://127.0.0.1:3000/api/v1",
    issuer: "http://127.0.0.1:3000/api/auth",
    audience: "http://127.0.0.1:3000/api/v1",
    clientId: "alphafox-cli-local",
    localOrigin: "http://127.0.0.1:3000",
    contractVersion: "2026-08-13",
  },
};

const CLI_CONFIG_FIELDS = new Set([
  "activeProfile",
  "profiles",
  "unsafeCustomEndpoint",
]);

const PROFILE_OVERRIDE_FIELDS = new Set([
  "name",
  "apiBaseUrl",
  "issuer",
  "audience",
  "clientId",
  "contractVersion",
  "localOrigin",
]);

function assertValidConfig(config: unknown): void {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("Invalid CLI config");
  }
  const root = config as Record<string, unknown>;
  for (const key of Object.keys(root)) {
    if (!CLI_CONFIG_FIELDS.has(key)) {
      throw new Error(`Forbidden config field: ${key}`);
    }
  }
  if (
    root.activeProfile !== undefined &&
    (typeof root.activeProfile !== "string" || !(root.activeProfile in DEFAULTS))
  ) {
    throw new Error("Invalid config field: activeProfile");
  }
  if (
    root.unsafeCustomEndpoint !== undefined &&
    typeof root.unsafeCustomEndpoint !== "string"
  ) {
    throw new Error("Invalid config field: unsafeCustomEndpoint");
  }
  const profiles = root.profiles;
  if (profiles === undefined) return;
  if (!profiles || typeof profiles !== "object" || Array.isArray(profiles)) {
    throw new Error("Invalid config field: profiles");
  }
  for (const [profileName, overrides] of Object.entries(profiles)) {
    if (!(profileName in DEFAULTS)) {
      throw new Error(`Invalid config profile: ${profileName}`);
    }
    if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
      throw new Error(`Invalid config profile: ${profileName}`);
    }
    for (const [key, value] of Object.entries(overrides)) {
      if (!PROFILE_OVERRIDE_FIELDS.has(key) || typeof value !== "string") {
        throw new Error(`Forbidden config field: ${profileName}.${key}`);
      }
    }
  }
}

export function defaultConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.ALPHAFOX_CONFIG_DIR?.trim()) {
    return env.ALPHAFOX_CONFIG_DIR.trim();
  }
  return join(homedir(), ".config", "alphafox");
}

export function configFilePath(env: NodeJS.ProcessEnv = process.env): string {
  return join(defaultConfigDir(env), "config.json");
}

export function loadConfigFile(env: NodeJS.ProcessEnv = process.env): CliConfigFile {
  const path = configFilePath(env);
  if (!existsSync(path)) {
    return { activeProfile: "production", profiles: {} };
  }
  const raw = JSON.parse(readFileSync(path, "utf8")) as CliConfigFile;
  try {
    assertNoTokenFields(raw);
    assertValidConfig(raw);
  } catch {
    throw new Error(
      "Refusing to load config: tokens/secrets or invalid fields must not be stored in config files. Use OS keychain."
    );
  }
  return {
    activeProfile: raw.activeProfile ?? "production",
    profiles: raw.profiles ?? {},
    unsafeCustomEndpoint: raw.unsafeCustomEndpoint,
  };
}

export function saveConfigFile(
  config: CliConfigFile,
  env: NodeJS.ProcessEnv = process.env
): void {
  assertNoTokenFields(config);
  assertValidConfig(config);
  // Strip any accidental token fields
  const safe: CliConfigFile = {
    activeProfile: config.activeProfile,
    profiles: config.profiles,
    ...(config.unsafeCustomEndpoint
      ? { unsafeCustomEndpoint: config.unsafeCustomEndpoint }
      : {}),
  };
  const dir = defaultConfigDir(env);
  mkdirSync(dir, { recursive: true });
  writeFileSync(configFilePath(env), `${JSON.stringify(safe, null, 2)}\n`, {
    mode: 0o600,
  });
}

export function resolveProfile(
  name?: ProfileName | string,
  env: NodeJS.ProcessEnv = process.env,
  options: { readonly unsafeCustomEndpoint?: string } = {}
): ProfileConfig {
  const file = loadConfigFile(env);
  const profileName = (name ||
    env.ALPHAFOX_PROFILE ||
    file.activeProfile ||
    "production") as ProfileName;
  if (!DEFAULTS[profileName]) {
    throw new Error(
      `Unknown profile "${profileName}". Use production|staging|local.`
    );
  }
  const base = { ...DEFAULTS[profileName], ...(file.profiles[profileName] ?? {}) };
  if (profileName === "local" && env.ALPHAFOX_LOCAL_ORIGIN?.trim()) {
    const origin = env.ALPHAFOX_LOCAL_ORIGIN.trim().replace(/\/$/, "");
    return {
      ...base,
      name: "local",
      localOrigin: origin,
      apiBaseUrl: `${origin}/api/v1`,
      issuer: `${origin}/api/auth`,
      audience: `${origin}/api/v1`,
    };
  }
  const custom =
    options.unsafeCustomEndpoint ||
    env.ALPHAFOX_UNSAFE_CUSTOM_ENDPOINT ||
    file.unsafeCustomEndpoint;
  if (custom) {
    // Custom endpoint never inherits stored prod/staging tokens (caller must not send them).
    const origin = custom.replace(/\/$/, "").replace(/\/api\/v1$/, "");
    return {
      ...base,
      apiBaseUrl: custom.includes("/api/v1")
        ? custom
        : `${origin}/api/v1`,
      issuer: `${origin}/api/auth`,
      audience: custom.includes("/api/v1") ? custom : `${origin}/api/v1`,
    };
  }
  return base as ProfileConfig;
}

export function assertNoTokenFields(config: unknown): void {
  if (!config || typeof config !== "object") {
    return;
  }
  const obj = config as Record<string, unknown>;
  for (const [key, value] of Object.entries(obj)) {
    const lower = key.toLowerCase();
    const normalized = lower.replaceAll("_", "").replaceAll("-", "");
    if (
      lower.includes("token") ||
      lower.includes("secret") ||
      lower.includes("password") ||
      lower.includes("passphrase") ||
      normalized.includes("apikey") ||
      normalized.includes("privatekey") ||
      normalized.includes("verifier") ||
      normalized.includes("credential") ||
      lower === "authorization" ||
      lower === "bearer"
    ) {
      throw new Error(`Forbidden config field: ${key}`);
    }
    assertNoTokenFields(value);
  }
}
