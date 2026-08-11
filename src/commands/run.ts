import { randomUUID } from "node:crypto";
import {
  CATALOG_OPERATIONS,
  CATALOG_VERSION,
  buildCapabilityManifest,
  findCatalogOperation,
  resolveOperationPath,
} from "../catalog/operations";
import {
  isFacadeAllowlistedPath,
  isInternalDisallowedPath,
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
import { apiRequest } from "../http/client";
import {
  deleteTokens,
  loadTokens,
  saveTokens,
  tokenFingerprint,
} from "../keychain/store";
import { assertHighRiskConfirmation } from "../safety/confirmation";
import {
  CLI_CONTRACT_VERSION,
  CLI_NAME,
  CLI_PACKAGE,
  CLI_VERSION,
} from "../version";

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
  const { flags, rest } = parseGlobalFlags(argv);
  const [cmd, ...args] = rest;

  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    writeSuccess(
      {
        name: CLI_NAME,
        usage: [
          "alphafox version",
          "alphafox doctor",
          "alphafox auth login [--no-wait|--device-code CODE|--browser]",
          "alphafox auth status [--verify]",
          "alphafox auth logout",
          "alphafox whoami",
          "alphafox profile list|use <name>",
          "alphafox schema [operationId]",
          "alphafox api METHOD PATH [--body JSON]",
          "alphafox <domain> <resource> <action> [flags]",
        ],
      },
      { format: flags.format }
    );
    return 0;
  }

  try {
    switch (cmd) {
      case "version":
        return cmdVersion(flags);
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

function cmdVersion(flags: GlobalFlags): number {
  writeSuccess(
    {
      name: CLI_NAME,
      package: CLI_PACKAGE,
      version: CLI_VERSION,
      contractVersion: CLI_CONTRACT_VERSION,
      catalogVersion: CATALOG_VERSION,
      node: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    { format: flags.format }
  );
  return 0;
}

function cmdDoctor(flags: GlobalFlags, env: NodeJS.ProcessEnv): number {
  const profile = resolveProfile(flags.profile, env, {
    unsafeCustomEndpoint: flags.unsafeCustomEndpoint,
  });
  // Avoid macOS `security` stderr noise when no item exists; file keychain is fine for doctor.
  const doctorEnv = { ...env, ALPHAFOX_FORCE_FILE_KEYCHAIN: env.ALPHAFOX_FORCE_FILE_KEYCHAIN ?? "1" };
  const tokens = loadTokens(profile.name, doctorEnv);
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
      name: "configHasNoTokens",
      ok: true,
      detail: "enforced",
    },
    {
      name: "automation",
      ok: true,
      detail: "v1 deferred (interactive login only)",
    },
  ];
  const ok = checks.every((c) => c.ok);
  writeSuccess(
    { ok, profile: profile.name, checks },
    { format: flags.format }
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
  writeSuccess(res.json, { requestId: res.requestId, format: flags.format });
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
        { format: flags.format }
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
      { format: flags.format }
    );
    return 0;
  }

  if (sub === "logout") {
    const tokens = loadTokens(profile.name, env);
    if (tokens?.refreshToken) {
      try {
        await apiRequest(
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
      } catch {
        // still clear local
      }
    }
    deleteTokens(profile.name, env);
    writeSuccess(
      { loggedOut: true, profile: profile.name },
      { format: flags.format }
    );
    return 0;
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
      { format: flags.format, requestId: res.requestId }
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
        { format: flags.format, requestId: res.requestId }
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
      { format: flags.format, requestId: res.requestId }
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
      { format: flags.format, requestId: res.requestId }
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
        { format: flags.format, requestId: poll.requestId }
      );
      return 0;
    }
    writeError({
      type: "auth",
      message: "Device authorization timed out",
      subtype: "expired_token",
    });
  }

  // Browser Authorization Code + PKCE (RFC 7636 S256)
  if (browser || args.includes("--pkce")) {
    const { createHash, randomBytes } = await import("node:crypto");
    const state = randomUUID();
    const codeVerifier = randomBytes(32).toString("base64url");
    const codeChallenge = createHash("sha256")
      .update(codeVerifier, "utf8")
      .digest("base64url");
    const redirectUri = redirectUriArg;
    const authorize = new URL(`${profile.issuer}/oauth/authorize`);
    authorize.searchParams.set("response_type", "code");
    authorize.searchParams.set("client_id", profile.clientId);
    authorize.searchParams.set("redirect_uri", redirectUri);
    authorize.searchParams.set("code_challenge", codeChallenge);
    authorize.searchParams.set("code_challenge_method", "S256");
    authorize.searchParams.set("state", state);
    authorize.searchParams.set("scope", "openid profile offline_access");

    writeSuccess(
      {
        flow: "authorization_code_pkce",
        profile: profile.name,
        authorizeUrl: authorize.toString(),
        redirect_uri: redirectUri,
        state,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        // Required for the follow-up exchange; store securely (not in config).
        code_verifier: codeVerifier,
        next: `After browser redirect: alphafox auth login --code <code> --code-verifier ${codeVerifier} --redirect-uri ${redirectUri}`,
        note: "Sign in at authorizeUrl if prompted. Prefer Device Flow for headless agents.",
      },
      { format: flags.format }
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
      { format: flags.format }
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
    writeSuccess({ activeProfile: name }, { format: flags.format });
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
        operations: CATALOG_OPERATIONS.map((o) => o.operationId),
      },
      { format: flags.format }
    );
    return 0;
  }
  const op = findCatalogOperation(operationId);
  if (!op) {
    writeError({
      type: "not_found",
      message: `Unknown operationId: ${operationId}`,
      status: 404,
    });
  }
  writeSuccess(
    {
      operationId: op.operationId,
      method: op.method,
      path: op.path,
      role: op.role,
      risk: op.risk,
      scopes: op.scopes,
      stream: op.stream ?? false,
      mvp: op.mvp ?? false,
      description: op.description,
      input: {
        type: "object",
        note: "See OpenAPI at GET /api/v1/openapi.json and alphafox-contracts Zod schemas",
      },
      output: { type: "object" },
      errors: ["401", "403", "404", "409", "422", "429", "5xx"],
    },
    { format: flags.format }
  );
  return 0;
}

function cmdCatalog(flags: GlobalFlags): number {
  writeSuccess(buildCapabilityManifest(), { format: flags.format });
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
      message: "Usage: alphafox api METHOD PATH [--body JSON]",
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
  const bodyIdx = args.indexOf("--body");
  if (bodyIdx >= 0) {
    body = JSON.parse(args[bodyIdx + 1] ?? "{}");
  }

  const profile = resolveProfile(flags.profile, env, {
    unsafeCustomEndpoint: flags.unsafeCustomEndpoint,
  });

  // Infer risk from catalog if possible
  const catalogHit = CATALOG_OPERATIONS.find(
    (o) => o.method === method && pathMatches(o.path, path)
  );
  if (catalogHit) {
    const gate = assertHighRiskConfirmation({
      risk: catalogHit.risk,
      yes: flags.yes,
      dryRun: flags.dryRun,
      action: `api ${method} ${path}`,
    });
    if (!gate.allowed && gate.error) {
      process.stderr.write(`${JSON.stringify(errorEnvelope(gate.error))}\n`);
      return 10;
    }
  }

  if (flags.dryRun) {
    writeSuccess(
      {
        dryRun: true,
        method,
        path,
        profile: profile.name,
        risk: catalogHit?.risk ?? "unknown",
      },
      { format: flags.format }
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
  writeSuccess(res.json, { requestId: res.requestId, format: flags.format });
  return 0;
}

async function cmdTyped(
  domain: string,
  args: string[],
  flags: GlobalFlags,
  env: NodeJS.ProcessEnv
): Promise<number> {
  // alphafox trading traders list
  // alphafox chats create --body ...
  const resource = args[0];
  const action = args[1];
  if (!resource || !action) {
    // try domain as operationId
    const asOp = findCatalogOperation(domain);
    if (asOp) {
      return await invokeOperation(asOp.operationId, args, flags, env);
    }
    writeError({
      type: "usage",
      message: `Unknown command "${domain}". Try alphafox schema or alphafox catalog.`,
    });
  }
  const candidates = CATALOG_OPERATIONS.filter((o) => {
    const parts = o.operationId.split(".");
    return (
      parts[0]?.replace(/_/g, "-") === domain.replace(/_/g, "-") ||
      o.operationId.startsWith(domain.replace(/-/g, "_"))
    );
  });
  const op =
    candidates.find(
      (o) =>
        o.operationId.endsWith(`.${action}`) ||
        o.operationId.includes(`.${resource}.`) &&
          o.operationId.endsWith(action)
    ) ||
    findCatalogOperation(`${domain}.${resource}.${action}`) ||
    findCatalogOperation(
      `${domain.replace(/-/g, "_")}.${resource.replace(/-/g, "_")}.${action}`
    );

  if (!op) {
    writeError({
      type: "not_found",
      message: `No catalog operation for ${domain} ${resource} ${action}`,
      status: 404,
      hint: "Run alphafox schema for operationIds",
    });
  }
  return await invokeOperation(op.operationId, args.slice(2), flags, env);
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
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]!;
    if (a.startsWith("--") && a !== "--body") {
      const key = a.slice(2);
      params[key] = args[++i] ?? "";
    }
  }
  let body: unknown;
  const bodyIdx = args.indexOf("--body");
  if (bodyIdx >= 0) {
    body = JSON.parse(args[bodyIdx + 1] ?? "{}");
  }

  const path = resolveOperationPath(op.path, params);
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
      },
      { format: flags.format }
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
    format: flags.format,
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

function pathMatches(template: string, actual: string): boolean {
  const t = template.split("/").filter(Boolean);
  const a = actual.split("/").filter(Boolean);
  if (t.length !== a.length) return false;
  for (let i = 0; i < t.length; i += 1) {
    if (t[i]!.startsWith("{") && t[i]!.endsWith("}")) continue;
    if (t[i] !== a[i]) return false;
  }
  return true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// silence unused import in some builds
void successEnvelope;
