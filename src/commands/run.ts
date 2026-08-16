import { randomUUID } from "node:crypto";
import {
  CATALOG_OPERATIONS,
  CATALOG_SOURCE,
  CATALOG_VERSION,
  COMPATIBILITY_RANGE,
  buildCapabilityManifest,
  checkGeneratedCatalogCompatibility,
  extractPathParamNames,
  findCatalogOperation,
  findCatalogOperationByRoute,
  getOperationSchemaDocument,
  resolveOperationPath,
} from "../catalog/operations";
import { resolveTypedCommand, typedCommandExample } from "../catalog/command-tree";
import {
  isFacadeAllowlistedPath,
  isInternalDisallowedPath,
  normalizeApiPath,
} from "../catalog/allowlist";
import {
  loadConfigFile,
  resolveProfile,
  saveConfigFile,
  type ProfileName,
} from "../config/profiles";
import {
  errorEnvelope,
  newRequestId,
  successEnvelope,
  writeError,
  writeSuccess,
} from "../envelope";
import {
  browserLoginTimeoutMs,
  resolveOpenBrowser,
  runBrowserPkceLogin,
} from "../auth/browser-login";
import { apiRequest } from "../http/client";
import {
  deleteTokens,
  loadTokens,
  probeOsKeychain,
  saveTokens,
  tokenFingerprint,
} from "../keychain/store";
import {
  assertHighRiskConfirmation,
  inferRawApiRisk,
} from "../safety/confirmation";
import {
  CLI_CONTRACT_VERSION,
  CLI_NAME,
  CLI_PACKAGE,
  CLI_VERSION,
} from "../version";
import { cmdEngineBacktest } from "../engine-backtest/run-command";
import { cmdResolveSymbols } from "../resolve-symbols/run-command";
import { cmdSkills } from "../skills/run-command";
import {
  maybeNotifyCliUpdate,
  shouldSkipUpdateCheck,
} from "../update/notify";
import { cmdUpdate } from "../update/run-command";
import { validateCatalogWriteBody } from "../catalog/validate-body";
import { isInstallError } from "../install/types";
import {
  installHelpData,
  parseInstallArgs,
  runInstallWizard,
} from "../install/wizard";
import {
  isRequestBodyError,
  parseRequestBodyFlags,
} from "./request-body";

export interface GlobalFlags {
  profile?: string;
  format: "json" | "jsonl" | "text";
  yes: boolean;
  dryRun: boolean;
  noInput: boolean;
  unsafeCustomEndpoint?: string;
  jq?: string;
}

export function parseGlobalFlags(argv: string[]): {
  flags: GlobalFlags;
  rest: string[];
} {
  const flags: GlobalFlags = {
    format: "json",
    yes: false,
    dryRun: false,
    noInput: false,
  };
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]!;
    if (a === "--profile" || a === "-p") {
      flags.profile = argv[++i];
    } else if (a.startsWith("--profile=")) {
      flags.profile = a.slice("--profile=".length);
    } else if (a === "--format") {
      flags.format = argv[++i] as GlobalFlags["format"];
    } else if (a.startsWith("--format=")) {
      flags.format = a.slice("--format=".length) as GlobalFlags["format"];
    } else if (a === "--yes" || a === "-y") {
      flags.yes = true;
    } else if (a === "--dry-run") {
      flags.dryRun = true;
    } else if (a === "--no-input") {
      flags.noInput = true;
    } else if (a === "--unsafe-custom-endpoint") {
      flags.unsafeCustomEndpoint = argv[++i];
    } else if (a.startsWith("--unsafe-custom-endpoint=")) {
      flags.unsafeCustomEndpoint = a.slice("--unsafe-custom-endpoint=".length);
    } else if (a === "--jq") {
      flags.jq = argv[++i];
    } else if (a.startsWith("--jq=")) {
      flags.jq = a.slice("--jq=".length);
    } else {
      rest.push(a);
    }
  }
  return { flags, rest };
}

export async function runCli(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env
): Promise<number> {
  if (argv.some((a) => a === "--token" || a.startsWith("--token="))) {
    writeError({
      type: "usage",
      subtype: "token_argv_forbidden",
      message:
        "Refusing --token on argv. Store credentials in the OS keychain via alphafox auth login.",
      hint: "Automation tokens are not supported in v1. Do not copy refresh tokens into CI.",
    });
  }
  const { flags, rest } = parseGlobalFlags(argv);
  const [cmd, ...args] = rest;

  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    writeSuccess(
      {
        name: CLI_NAME,
        usage: [
          "alphafox version",
          "alphafox doctor",
          "alphafox install [--no-auth|--dry-run]",
          "alphafox update [--check|--version VERSION]",
          "alphafox skills status|sync [--force --yes]",
          "alphafox auth login [--no-wait|--device-code CODE|--browser]",
          "alphafox auth status [--verify]",
          "alphafox auth logout",
          "alphafox whoami",
          "alphafox profile list|use <name>",
          "alphafox schema [operationId]",
          "alphafox catalog",
          "alphafox api METHOD PATH [--body JSON|--config @file]",
          "alphafox engine-backtest run --experiment <uuid> --definition <id> --config @file --exchange <id> --range FROM..TO --initial-equity N",
          "alphafox engine-backtest sweep --experiment <uuid> --definition <id> --config @file --axes @file --exchange <id> --range FROM..TO --initial-equity N --no-persist",
          "alphafox resolve-symbols <query...> [--exchange binance]",
          "alphafox <domain> <resource> <action> [flags]",
        ],
      },
      { format: flags.format, jq: flags.jq }
    );
    return 0;
  }

  try {
    if (!shouldSkipUpdateCheck(cmd, env)) {
      try {
        await maybeNotifyCliUpdate({ env, currentVersion: CLI_VERSION });
      } catch {
        // Update notices must never fail a command.
      }
    }
    if (
      cmd !== "version" &&
      cmd !== "install" &&
      cmd !== "update" &&
      cmd !== "skills"
    ) {
      assertCatalogCompatible();
    }
    switch (cmd) {
      case "version":
        return cmdVersion(flags);
      case "install":
        return await cmdInstall(args, flags, env);
      case "update":
        return await cmdUpdate(args, flags, env);
      case "skills":
        return await cmdSkills(args, flags, env);
      case "doctor":
        return cmdDoctor(flags, env);
      case "whoami":
        return await cmdWhoami(flags, env);
      case "auth":
        return await cmdAuth(args, flags, env);
      case "profile":
        return cmdProfile(args, flags, env);
      case "schema":
        return cmdSchema(args, flags);
      case "api":
        return await cmdApi(args, flags, env);
      case "catalog":
        return cmdCatalog(flags);
      case "engine-backtest": {
        const sub = args[0];
        if (
          !sub ||
          sub === "run" ||
          sub === "sweep" ||
          sub === "help" ||
          sub === "--help" ||
          sub === "-h"
        ) {
          return await cmdEngineBacktest(args, flags, env);
        }
        // Hyphen built-in owns `run` and `sweep`. Underscore/hyphen catalog CRUD
        // (engine_backtest.experiments.*) still goes through the typed tree.
        return await cmdTyped(cmd, args, flags, env);
      }
      case "resolve-symbols":
      case "resolve-symbol":
        return await cmdResolveSymbols(args, flags, env);
      default:
        return await cmdTyped(cmd, args, flags, env);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status =
      err && typeof err === "object" && "status" in err
        ? Number((err as { status: unknown }).status)
        : undefined;
    const type =
      err && typeof err === "object" && "type" in err
        ? String((err as { type: unknown }).type)
        : "runtime";
    writeError(
      {
        type,
        message,
        status,
        subtype:
          err && typeof err === "object" && "subtype" in err
            ? String((err as { subtype: unknown }).subtype)
            : undefined,
      },
      { exitCode: status === 401 || status === 403 ? 77 : 1 }
    );
  }
}

function assertCatalogCompatible(): void {
  const result = checkGeneratedCatalogCompatibility(CLI_VERSION);
  if (result.ok) return;
  writeError({
    type: "compatibility",
    subtype: result.code,
    message: result.message,
    hint: "Upgrade or pin @alphafox/cli to the catalog minCliVersion/maxCliVersion range.",
  });
}

async function cmdInstall(
  args: string[],
  flags: GlobalFlags,
  env: NodeJS.ProcessEnv
): Promise<number> {
  const parsed = parseInstallArgs(args);
  if (parsed.unknown.length > 0) {
    writeError({
      type: "usage",
      subtype: "unknown_install_flag",
      message: `未知的 install 参数：${parsed.unknown.join(" ")}`,
      hint: "用法：alphafox install [--no-auth] [--dry-run]",
    });
  }
  if (parsed.help) {
    writeSuccess(installHelpData(), { format: flags.format, jq: flags.jq });
    return 0;
  }
  try {
    const data = await runInstallWizard(
      {
        format: flags.format,
        yes: flags.yes,
        dryRun: flags.dryRun,
        noInput: flags.noInput,
        jq: flags.jq,
        noAuth: parsed.noAuth,
        help: false,
      },
      env
    );
    writeSuccess(data, { format: flags.format, jq: flags.jq });
    return data.auth.action === "failed" ||
      data.skills.action === "blocked" ||
      (data.skills.blocked?.length ?? 0) > 0
      ? 1
      : 0;
  } catch (err) {
    if (isInstallError(err)) {
      writeError({
        type: err.type,
        subtype: err.subtype,
        message: err.message,
        hint: err.hint,
        details: err.details,
      });
    }
    throw err;
  }
}

function cmdVersion(flags: GlobalFlags): number {
  const compatibility = checkGeneratedCatalogCompatibility(CLI_VERSION);
  writeSuccess(
    {
      name: CLI_NAME,
      package: CLI_PACKAGE,
      version: CLI_VERSION,
      contractVersion: CLI_CONTRACT_VERSION,
      catalogVersion: CATALOG_VERSION,
      registryVersion: COMPATIBILITY_RANGE.registryVersion,
      minCliVersion: COMPATIBILITY_RANGE.minCliVersion,
      maxCliVersion: COMPATIBILITY_RANGE.maxCliVersion,
      openapi: COMPATIBILITY_RANGE.openapi,
      contractsSha: CATALOG_SOURCE.contractsSha,
      compatibility,
      node: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    { format: flags.format, jq: flags.jq }
  );
  return compatibility.ok ? 0 : 1;
}

function cmdDoctor(flags: GlobalFlags, env: NodeJS.ProcessEnv): number {
  const profile = resolveProfile(flags.profile, env, {
    unsafeCustomEndpoint: flags.unsafeCustomEndpoint,
  });
  // Avoid macOS `security` stderr noise when no item exists; file keychain is fine for doctor.
  const doctorEnv = { ...env, ALPHAFOX_FORCE_FILE_KEYCHAIN: env.ALPHAFOX_FORCE_FILE_KEYCHAIN ?? "1" };
  const tokens = loadTokens(profile.name, doctorEnv);
  const probe = probeOsKeychain(env);
  const checks = [
    {
      name: "node",
      ok: Number(process.versions.node.split(".")[0]) >= 20,
      detail: process.version,
    },
    {
      name: "profile",
      ok: true,
      detail: profile.name,
    },
    {
      name: "apiBaseUrl",
      ok: Boolean(profile.apiBaseUrl),
      detail: profile.apiBaseUrl,
    },
    {
      name: "issuer",
      ok: Boolean(profile.issuer),
      detail: profile.issuer,
    },
    {
      name: "keychain",
      ok: true,
      detail: tokens
        ? `token present (fp=${tokenFingerprint(tokens.accessToken)})`
        : "no tokens stored",
    },
    {
      name: "osKeychain",
      ok: true,
      detail: probe.available
        ? probe.kind
        : `${probe.kind} unavailable; file fallback (0600) if tokens are saved`,
    },
    {
      name: "configHasNoTokens",
      ok: true,
      detail: "enforced",
    },
    {
      name: "automation",
      ok: true,
      detail: "v1 deferred (interactive login only)",
    },
    {
      name: "catalogCompatibility",
      ok: checkGeneratedCatalogCompatibility(CLI_VERSION).ok,
      detail: `${CLI_VERSION} in [${COMPATIBILITY_RANGE.minCliVersion}, ${COMPATIBILITY_RANGE.maxCliVersion}] contract ${COMPATIBILITY_RANGE.contractVersion}`,
    },
  ];
  const ok = checks.every((c) => c.ok);
  writeSuccess(
    { ok, profile: profile.name, checks },
    { format: flags.format, jq: flags.jq }
  );
  return ok ? 0 : 1;
}

async function cmdWhoami(
  flags: GlobalFlags,
  env: NodeJS.ProcessEnv
): Promise<number> {
  const profile = resolveProfile(flags.profile, env, {
    unsafeCustomEndpoint: flags.unsafeCustomEndpoint,
  });
  const requestId = newRequestId();
  const res = await apiRequest(
    {
      method: "GET",
      path: "/api/v1/me",
      profile,
      requestId,
    },
    env
  );
  if (res.status >= 400) {
    writeError(
      {
        type: "http",
        status: res.status,
        message: extractErrorMessage(res.json, res.bodyText),
        code: extractErrorCode(res.json),
      },
      { requestId: res.requestId, exitCode: res.status === 401 ? 77 : 1 }
    );
  }
  writeSuccess(res.json, { requestId: res.requestId, format: flags.format, jq: flags.jq });
  return 0;
}

async function cmdAuth(
  args: string[],
  flags: GlobalFlags,
  env: NodeJS.ProcessEnv
): Promise<number> {
  const sub = args[0];
  const profile = resolveProfile(flags.profile, env, {
    unsafeCustomEndpoint: flags.unsafeCustomEndpoint,
  });

  if (sub === "status") {
    const verify = args.includes("--verify");
    const tokens = loadTokens(profile.name, env);
    if (!tokens) {
      writeSuccess(
        {
          authenticated: false,
          profile: profile.name,
          verified: false,
        },
        { format: flags.format, jq: flags.jq }
      );
      return 0;
    }
    let verified: boolean | null = null;
    let whoami: unknown = null;
    if (verify) {
      const res = await apiRequest(
        {
          method: "GET",
          path: "/api/v1/me",
          profile,
        },
        env
      );
      verified = res.status >= 200 && res.status < 300;
      whoami = verified ? res.json : { status: res.status, body: res.json };
    }
    writeSuccess(
      {
        authenticated: true,
        profile: profile.name,
        environment: tokens.environment,
        issuer: tokens.issuer,
        audience: tokens.audience,
        clientId: tokens.clientId,
        scopes: tokens.scopes,
        accessTokenFingerprint: tokenFingerprint(tokens.accessToken),
        expiresAt: tokens.expiresAt,
        verified,
        whoami,
      },
      { format: flags.format, jq: flags.jq }
    );
    return 0;
  }

  if (sub === "logout") {
    const tokens = loadTokens(profile.name, env);
    let remoteRevoke: "ok" | "failed" | "skipped" = "skipped";
    if (tokens?.refreshToken) {
      try {
        const res = await apiRequest(
          {
            method: "POST",
            path: "/api/auth/oauth/revoke",
            profile,
            body: {
              token: tokens.refreshToken,
              token_type_hint: "refresh_token",
            },
            skipAuth: false,
          },
          env
        );
        remoteRevoke =
          res.status >= 200 && res.status < 300 ? "ok" : "failed";
      } catch {
        remoteRevoke = "failed";
      }
    }
    deleteTokens(profile.name, env);
    const localCleared = true;
    const fullyLoggedOut = remoteRevoke !== "failed";
    // Never claim a clean remote logout when revoke failed while an RT was present.
    writeSuccess(
      {
        localCleared,
        remoteRevoke,
        fullyLoggedOut,
        // retained for compatibility; false when remote revoke failed
        loggedOut: fullyLoggedOut,
        profile: profile.name,
      },
      { format: flags.format, jq: flags.jq }
    );
    return fullyLoggedOut ? 0 : 1;
  }

  if (sub === "login") {
    return await cmdAuthLogin(args.slice(1), flags, env, profile);
  }

  writeError({
    type: "usage",
    message: "Usage: alphafox auth login|status|logout",
  });
}

async function cmdAuthLogin(
  args: string[],
  flags: GlobalFlags,
  env: NodeJS.ProcessEnv,
  profile: ReturnType<typeof resolveProfile>
): Promise<number> {
  const noWait = args.includes("--no-wait");
  const deviceCodeIdx = args.indexOf("--device-code");
  const deviceCode =
    deviceCodeIdx >= 0 ? args[deviceCodeIdx + 1] : undefined;
  const browser = args.includes("--browser");
  const codeIdx = args.indexOf("--code");
  const authCode = codeIdx >= 0 ? args[codeIdx + 1] : undefined;
  const verifierIdx = args.indexOf("--code-verifier");
  const codeVerifierArg =
    verifierIdx >= 0 ? args[verifierIdx + 1] : undefined;
  const redirectIdx = args.indexOf("--redirect-uri");
  const redirectUriArg =
    redirectIdx >= 0
      ? args[redirectIdx + 1]
      : "http://127.0.0.1:8742/callback";

  // Complete Authorization Code + PKCE exchange
  if (authCode) {
    if (!codeVerifierArg) {
      writeError({
        type: "usage",
        message:
          "PKCE exchange requires --code-verifier (from the earlier --browser start output).",
      });
    }
    const res = await apiRequest(
      {
        method: "POST",
        path: "/api/auth/oauth/token",
        profile,
        skipAuth: true,
        body: {
          grant_type: "authorization_code",
          code: authCode,
          redirect_uri: redirectUriArg,
          client_id: profile.clientId,
          code_verifier: codeVerifierArg,
        },
      },
      env
    );
    if (res.status >= 400) {
      writeError(
        {
          type: "auth",
          status: res.status,
          message: extractErrorMessage(res.json, res.bodyText),
        },
        { requestId: res.requestId }
      );
    }
    const tokens = extractTokenPair(res.json);
    saveTokens(
      profile.name,
      {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: Date.now() + (tokens.expires_in ?? 600) * 1000,
        environment: profile.name,
        issuer: profile.issuer,
        audience: profile.audience,
        clientId: profile.clientId,
        scopes: (tokens.scope ?? "openid profile").split(/\s+/),
      },
      env
    );
    writeSuccess(
      {
        authenticated: true,
        flow: "authorization_code_pkce",
        profile: profile.name,
        accessTokenFingerprint: tokenFingerprint(tokens.access_token),
        expiresIn: tokens.expires_in,
      },
      { format: flags.format, jq: flags.jq, requestId: res.requestId }
    );
    return 0;
  }

  if (deviceCode) {
    const res = await apiRequest(
      {
        method: "POST",
        path: "/api/auth/oauth/device/token",
        profile,
        skipAuth: true,
        body: {
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          device_code: deviceCode,
          client_id: profile.clientId,
        },
      },
      env
    );
    if (res.status === 400 && isPending(res.json)) {
      writeSuccess(
        {
          status: "authorization_pending",
          profile: profile.name,
        },
        { format: flags.format, jq: flags.jq, requestId: res.requestId }
      );
      return 0;
    }
    if (res.status >= 400) {
      writeError(
        {
          type: "auth",
          status: res.status,
          message: extractErrorMessage(res.json, res.bodyText),
        },
        { requestId: res.requestId }
      );
    }
    const tokens = extractTokenPair(res.json);
    saveTokens(profile.name, {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + (tokens.expires_in ?? 600) * 1000,
      environment: profile.name,
      issuer: profile.issuer,
      audience: profile.audience,
      clientId: profile.clientId,
      scopes: (tokens.scope ?? "openid profile").split(/\s+/),
    }, env);
    writeSuccess(
      {
        authenticated: true,
        profile: profile.name,
        accessTokenFingerprint: tokenFingerprint(tokens.access_token),
        expiresIn: tokens.expires_in,
      },
      { format: flags.format, jq: flags.jq, requestId: res.requestId }
    );
    return 0;
  }

  // Start device flow (default headless path)
  if (!browser) {
    const res = await apiRequest(
      {
        method: "POST",
        path: "/api/auth/oauth/device/code",
        profile,
        skipAuth: true,
        body: {
          client_id: profile.clientId,
          scope: "openid profile offline_access",
        },
      },
      env
    );
    if (res.status >= 400) {
      writeError(
        {
          type: "auth",
          status: res.status,
          message: extractErrorMessage(res.json, res.bodyText),
        },
        { requestId: res.requestId }
      );
    }
    const data = res.json as Record<string, unknown>;
    writeSuccess(
      {
        flow: "device_authorization",
        profile: profile.name,
        device_code: data.device_code,
        user_code: data.user_code,
        verification_uri: data.verification_uri,
        verification_uri_complete: data.verification_uri_complete,
        expires_in: data.expires_in,
        interval: data.interval,
        next:
          "Open verification_uri, approve, then: alphafox auth login --device-code <device_code>",
      },
      { format: flags.format, jq: flags.jq, requestId: res.requestId }
    );
    if (noWait) {
      return 0;
    }
    // poll
    const code = String(data.device_code);
    const interval = Number(data.interval ?? 5) * 1000;
    const deadline = Date.now() + Number(data.expires_in ?? 600) * 1000;
    while (Date.now() < deadline) {
      await sleep(interval);
      const poll = await apiRequest(
        {
          method: "POST",
          path: "/api/auth/oauth/device/token",
          profile,
          skipAuth: true,
          body: {
            grant_type: "urn:ietf:params:oauth:grant-type:device_code",
            device_code: code,
            client_id: profile.clientId,
          },
        },
        env
      );
      if (isPending(poll.json)) {
        continue;
      }
      if (poll.status >= 400) {
        writeError(
          {
            type: "auth",
            status: poll.status,
            message: extractErrorMessage(poll.json, poll.bodyText),
          },
          { requestId: poll.requestId }
        );
      }
      const tokens = extractTokenPair(poll.json);
      saveTokens(
        profile.name,
        {
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          expiresAt: Date.now() + (tokens.expires_in ?? 600) * 1000,
          environment: profile.name,
          issuer: profile.issuer,
          audience: profile.audience,
          clientId: profile.clientId,
          scopes: (tokens.scope ?? "openid profile").split(/\s+/),
        },
        env
      );
      writeSuccess(
        {
          authenticated: true,
          profile: profile.name,
          accessTokenFingerprint: tokenFingerprint(tokens.access_token),
        },
        { format: flags.format, jq: flags.jq, requestId: poll.requestId }
      );
      return 0;
    }
    writeError({
      type: "auth",
      message: "Device authorization timed out",
      subtype: "expired_token",
    });
  }

  // Browser Authorization Code + PKCE with loopback callback (RFC 8252).
  if (browser || args.includes("--pkce")) {
    const result = await runBrowserPkceLogin({
      profile,
      env,
      timeoutMs: browserLoginTimeoutMs(env),
      openBrowser: resolveOpenBrowser(env),
    });
    if (result.status !== "authenticated") {
      writeError({
        type: "auth",
        subtype: result.reason,
        message: result.message,
        details: result.authorizeUrl
          ? { authorizeUrl: result.authorizeUrl }
          : undefined,
        hint: result.authorizeUrl
          ? "Copy authorizeUrl into a browser, or use Device Flow: alphafox auth login --no-wait"
          : undefined,
      });
    }
    writeSuccess(
      {
        authenticated: true,
        flow: "authorization_code_pkce",
        profile: profile.name,
        accessTokenFingerprint: result.accessTokenFingerprint,
        expiresIn: result.expiresIn,
      },
      { format: flags.format, jq: flags.jq, requestId: result.requestId }
    );
    return 0;
  }

  writeError({
    type: "usage",
    message:
      "Usage: alphafox auth login [--no-wait|--device-code CODE|--browser|--code CODE --code-verifier V]",
  });
}

function cmdProfile(
  args: string[],
  flags: GlobalFlags,
  env: NodeJS.ProcessEnv
): number {
  const sub = args[0] ?? "list";
  if (sub === "list") {
    const file = loadConfigFile(env);
    writeSuccess(
      {
        activeProfile: file.activeProfile,
        profiles: ["production", "staging", "local"].map((name) =>
          resolveProfile(name, env)
        ),
      },
      { format: flags.format, jq: flags.jq }
    );
    return 0;
  }
  if (sub === "use") {
    const name = args[1] as ProfileName;
    if (!name || !["production", "staging", "local"].includes(name)) {
      writeError({
        type: "usage",
        message: "Usage: alphafox profile use production|staging|local",
      });
    }
    const file = loadConfigFile(env);
    saveConfigFile({ ...file, activeProfile: name }, env);
    writeSuccess({ activeProfile: name }, { format: flags.format, jq: flags.jq });
    return 0;
  }
  writeError({ type: "usage", message: "Usage: alphafox profile list|use" });
}

function cmdSchema(args: string[], flags: GlobalFlags): number {
  const operationId = args[0];
  if (!operationId) {
    writeSuccess(
      {
        contractVersion: CATALOG_VERSION,
        registryVersion: COMPATIBILITY_RANGE.registryVersion,
        openapi: COMPATIBILITY_RANGE.openapi,
        minCliVersion: COMPATIBILITY_RANGE.minCliVersion,
        maxCliVersion: COMPATIBILITY_RANGE.maxCliVersion,
        operations: CATALOG_OPERATIONS.map((o) => o.operationId),
      },
      { format: flags.format, jq: flags.jq }
    );
    return 0;
  }
  const op = findCatalogOperation(operationId);
  const schema = getOperationSchemaDocument(operationId);
  if (!op || !schema) {
    writeError({
      type: "not_found",
      message: `Unknown operationId: ${operationId}`,
      status: 404,
    });
  }
  writeSuccess(
    {
      ...schema,
      examples: typedCommandExample(op),
    },
    { format: flags.format, jq: flags.jq }
  );
  return 0;
}

function cmdCatalog(flags: GlobalFlags): number {
  writeSuccess(buildCapabilityManifest(), { format: flags.format, jq: flags.jq });
  return 0;
}

async function cmdApi(
  args: string[],
  flags: GlobalFlags,
  env: NodeJS.ProcessEnv
): Promise<number> {
  const method = args[0]?.toUpperCase();
  const path = args[1];
  if (!method || !path) {
    writeError({
      type: "usage",
      message: "Usage: alphafox api METHOD PATH [--body JSON|--config @file]",
    });
  }
  if (isInternalDisallowedPath(path) || !isFacadeAllowlistedPath(path)) {
    writeError(
      {
        type: "authorization",
        subtype: "facade_only",
        message: `Raw api only allows Public API facade paths under /api/v1. Rejected: ${path}`,
        status: 403,
      },
      { exitCode: 77 }
    );
  }

  let body: unknown;
  try {
    body = parseRequestBodyFlags(args).body;
  } catch (err) {
    if (isRequestBodyError(err)) {
      writeError({
        type: err.type,
        subtype: err.subtype,
        message: err.message,
        hint: err.hint,
      });
    }
    throw err;
  }

  const profile = resolveProfile(flags.profile, env, {
    unsafeCustomEndpoint: flags.unsafeCustomEndpoint,
  });

  // Infer risk from catalog; uncataloged mutations are treated as high-risk.
  const catalogHit = findCatalogOperationByRoute(method, normalizeApiPath(path));
  const validated = validateCatalogWriteBody({
    method,
    operationId: catalogHit?.operationId,
    body,
  });
  if (!validated.ok) {
    writeError(validated.error);
  }
  body = validated.body;
  const risk = inferRawApiRisk(method, catalogHit?.risk);
  const gate = assertHighRiskConfirmation({
    risk,
    yes: flags.yes,
    dryRun: flags.dryRun,
    action: `api ${method} ${path}`,
  });
  if (!gate.allowed && gate.error) {
    process.stderr.write(`${JSON.stringify(errorEnvelope(gate.error))}\n`);
    return 10;
  }

  if (flags.dryRun) {
    writeSuccess(
      {
        dryRun: true,
        method,
        path,
        profile: profile.name,
        risk,
        operationId: catalogHit?.operationId,
        body,
      },
      { format: flags.format, jq: flags.jq }
    );
    return 0;
  }

  const res = await apiRequest(
    {
      method,
      path,
      body,
      profile,
      idempotencyKey:
        method === "POST" ? env.ALPHAFOX_IDEMPOTENCY_KEY : undefined,
    },
    env
  );
  if (res.status >= 400) {
    writeError(
      {
        type: "http",
        status: res.status,
        message: extractErrorMessage(res.json, res.bodyText),
        code: extractErrorCode(res.json),
      },
      { requestId: res.requestId, exitCode: res.status === 401 ? 77 : 1 }
    );
  }
  writeSuccess(res.json, { requestId: res.requestId, format: flags.format, jq: flags.jq });
  return 0;
}

async function cmdTyped(
  domain: string,
  args: string[],
  flags: GlobalFlags,
  env: NodeJS.ProcessEnv
): Promise<number> {
  const resolved = resolveTypedCommand([domain, ...args]);
  if (resolved.kind === "help") {
    writeSuccess(
      {
        prefix: resolved.prefix,
        operations: resolved.operations.map((op) => ({
          operationId: op.operationId,
          method: op.method,
          path: op.path,
          risk: op.risk,
          scopes: op.scopes,
          stream: Boolean(op.stream),
          file: Boolean(op.file),
          pagination: Boolean(op.pagination),
          examples: typedCommandExample(op),
        })),
      },
      { format: flags.format, jq: flags.jq }
    );
    return 0;
  }
  if (resolved.kind === "ambiguous") {
    writeError({
      type: "usage",
      message: `Ambiguous command "${resolved.prefix}"`,
      hint: `Matches: ${resolved.candidates.join(", ")}`,
    });
  }
  if (resolved.kind === "missing") {
    writeError({
      type: "not_found",
      message: `No catalog operation for ${resolved.prefix || domain}`,
      status: 404,
      hint: "Run alphafox schema for operationIds",
    });
  }
  if (resolved.help) {
    return cmdSchema([resolved.operation.operationId], flags);
  }
  return await invokeOperation(
    resolved.operation.operationId,
    resolved.flagArgs,
    flags,
    env
  );
}

async function invokeOperation(
  operationId: string,
  args: string[],
  flags: GlobalFlags,
  env: NodeJS.ProcessEnv
): Promise<number> {
  const op = findCatalogOperation(operationId);
  if (!op) {
    writeError({
      type: "not_found",
      message: `Unknown operationId: ${operationId}`,
      status: 404,
    });
  }
  const gate = assertHighRiskConfirmation({
    risk: op.risk,
    yes: flags.yes,
    dryRun: flags.dryRun,
    action: operationId,
  });
  if (!gate.allowed && gate.error) {
    process.stderr.write(`${JSON.stringify(errorEnvelope(gate.error))}\n`);
    return 10;
  }

  const params: Record<string, string> = {};
  const extra: Record<string, string> = {};
  const pathParamNames = new Set(
    getOperationSchemaDocument(operationId)?.request.pathParamNames ??
      extractPathParamNames(op.path)
  );
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]!;
    if (a.startsWith("--") && a !== "--body" && a !== "--config") {
      const key = a.slice(2);
      const value = args[++i] ?? "";
      if (pathParamNames.has(key)) {
        params[key] = value;
      } else {
        extra[key] = value;
      }
    }
  }
  let body: unknown;
  try {
    body = parseRequestBodyFlags(args).body;
  } catch (err) {
    if (isRequestBodyError(err)) {
      writeError({
        type: err.type,
        subtype: err.subtype,
        message: err.message,
        hint: err.hint,
      });
    }
    throw err;
  }
  const validated = validateCatalogWriteBody({
    method: op.method,
    operationId,
    body,
  });
  if (!validated.ok) {
    writeError(validated.error);
  }
  body = validated.body;

  let path = resolveOperationPath(op.path, params);
  if (
    (op.method === "GET" || op.method === "HEAD") &&
    Object.keys(extra).length > 0
  ) {
    const query = new URLSearchParams(extra).toString();
    path = `${path}?${query}`;
  }
  const profile = resolveProfile(flags.profile, env, {
    unsafeCustomEndpoint: flags.unsafeCustomEndpoint,
  });

  if (flags.dryRun) {
    writeSuccess(
      {
        dryRun: true,
        operationId,
        method: op.method,
        path,
        risk: op.risk,
        profile: profile.name,
        body: op.method === "GET" || op.method === "HEAD" ? undefined : body,
      },
      { format: flags.format, jq: flags.jq }
    );
    return 0;
  }

  const res = await apiRequest(
    {
      method: op.method,
      path,
      body: op.method === "GET" ? undefined : body ?? {},
      profile,
      idempotencyKey:
        op.method === "POST" ? randomUUID() : undefined,
    },
    env
  );
  if (res.status >= 400) {
    writeError(
      {
        type: "http",
        status: res.status,
        message: extractErrorMessage(res.json, res.bodyText),
        code: extractErrorCode(res.json),
      },
      { requestId: res.requestId }
    );
  }
  writeSuccess(res.json, {
    requestId: res.requestId,
    format: flags.format, jq: flags.jq,
    meta: { operationId },
  });
  return 0;
}

function extractTokenPair(json: unknown): {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  scope?: string;
} {
  if (!json || typeof json !== "object") {
    throw new Error("Invalid token response");
  }
  const o = json as Record<string, unknown>;
  const access = o.access_token ?? o.accessToken;
  const refresh = o.refresh_token ?? o.refreshToken;
  if (typeof access !== "string" || typeof refresh !== "string") {
    throw new Error("Token response missing access_token/refresh_token");
  }
  return {
    access_token: access,
    refresh_token: refresh,
    expires_in:
      typeof o.expires_in === "number"
        ? o.expires_in
        : typeof o.expiresIn === "number"
          ? o.expiresIn
          : undefined,
    scope: typeof o.scope === "string" ? o.scope : undefined,
  };
}

function isPending(json: unknown): boolean {
  if (!json || typeof json !== "object") return false;
  const o = json as Record<string, unknown>;
  return (
    o.error === "authorization_pending" ||
    o.subtype === "authorization_pending" ||
    (o.error as { subtype?: string } | undefined)?.subtype ===
      "authorization_pending"
  );
}

function extractErrorMessage(json: unknown, fallback: string): string {
  if (json && typeof json === "object") {
    const o = json as Record<string, unknown>;
    if (typeof o.message === "string") return o.message;
    if (typeof o.error === "string") return o.error;
    if (o.error && typeof o.error === "object") {
      const e = o.error as Record<string, unknown>;
      if (typeof e.message === "string") return e.message;
    }
  }
  return fallback || "Request failed";
}

function extractErrorCode(json: unknown): string | number | undefined {
  if (json && typeof json === "object") {
    const o = json as Record<string, unknown>;
    if (typeof o.code === "string" || typeof o.code === "number") return o.code;
    if (o.error && typeof o.error === "object") {
      const e = o.error as Record<string, unknown>;
      if (typeof e.code === "string" || typeof e.code === "number") return e.code;
    }
  }
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// silence unused import in some builds
void successEnvelope;
