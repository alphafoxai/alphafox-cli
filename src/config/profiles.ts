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
  const raw = JSON.parse(readFileSync(path, "utf8")) as CliConfigFile & {
    tokens?: unknown;
    accessToken?: unknown;
    refreshToken?: unknown;
  };
  // Fail closed if someone stuffed tokens into config.
  if (
    raw.tokens != null ||
    raw.accessToken != null ||
    raw.refreshToken != null ||
    (raw as { secret?: unknown }).secret != null
  ) {
    throw new Error(
      "Refusing to load config: tokens/secrets must not be stored in config files. Remove them and use the OS keychain."
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
  for (const key of Object.keys(obj)) {
    const lower = key.toLowerCase();
    if (
      lower.includes("token") ||
      lower.includes("secret") ||
      lower.includes("password") ||
      lower === "authorization"
    ) {
      throw new Error(`Forbidden config field: ${key}`);
    }
  }
}
