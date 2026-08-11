/**
 * Embedded capability catalog (co-versioned with CLI).
 * Source of truth for full matrix lives in alphafox-contracts + parity-matrix-m0.md.
 */

export interface CatalogOperation {
  readonly operationId: string;
  readonly method: string;
  readonly path: string;
  readonly role: string;
  readonly risk: "read" | "write" | "high-risk-write" | string;
  readonly scopes: readonly string[];
  readonly stream?: boolean;
  readonly mvp?: boolean;
  readonly description?: string;
}

export const CATALOG_VERSION = "2026-08-11";

export const CATALOG_OPERATIONS: readonly CatalogOperation[] = [
  {
    operationId: "meta.get",
    method: "GET",
    path: "/api/v1/meta",
    role: "public",
    risk: "read",
    scopes: [],
    mvp: true,
    description: "Environment, commit SHA, contract version",
  },
  {
    operationId: "me.whoami",
    method: "GET",
    path: "/api/v1/me",
    role: "user",
    risk: "read",
    scopes: ["openid", "profile"],
    mvp: true,
    description: "Authenticated user identity",
  },
  {
    operationId: "trading.strategy_definitions.list",
    method: "GET",
    path: "/api/v1/trading/strategy-definitions",
    role: "user",
    risk: "read",
    scopes: ["openid", "profile", "trading:read"],
    mvp: true,
  },
  {
    operationId: "exchange_connectors.list",
    method: "GET",
    path: "/api/v1/exchange-connectors",
    role: "user",
    risk: "read",
    scopes: ["openid", "profile", "exchange-connectors:read"],
    mvp: true,
  },
  {
    operationId: "trading.traders.list",
    method: "GET",
    path: "/api/v1/trading/traders",
    role: "user",
    risk: "read",
    scopes: ["openid", "profile", "trading:read"],
    mvp: true,
  },
  {
    operationId: "chats.create",
    method: "POST",
    path: "/api/v1/chats",
    role: "user",
    risk: "write",
    scopes: ["openid", "profile", "chats:write"],
    mvp: true,
  },
  {
    operationId: "backtests.create",
    method: "POST",
    path: "/api/v1/backtests",
    role: "user",
    risk: "write",
    scopes: ["openid", "profile", "backtests:write"],
    mvp: true,
  },
  {
    operationId: "backtests.byId.get",
    method: "GET",
    path: "/api/v1/backtests/{backtestId}",
    role: "user",
    risk: "read",
    scopes: ["openid", "profile", "backtests:read"],
    mvp: true,
  },
  {
    operationId: "backtests.byId.stream",
    method: "GET",
    path: "/api/v1/backtests/{backtestId}/stream",
    role: "user",
    risk: "read",
    scopes: ["openid", "profile", "backtests:read"],
    stream: true,
    mvp: true,
  },
  {
    operationId: "backtests.byId.cancel",
    method: "POST",
    path: "/api/v1/backtests/{backtestId}/cancel",
    role: "user",
    risk: "write",
    scopes: ["openid", "profile", "backtests:write"],
    mvp: true,
  },
  {
    operationId: "trading.traders.byId.start",
    method: "POST",
    path: "/api/v1/trading/traders/{traderId}/start",
    role: "user",
    risk: "high-risk-write",
    scopes: ["openid", "profile", "trading:write", "trading:high-risk"],
  },
  {
    operationId: "trading.traders.byId.stop",
    method: "POST",
    path: "/api/v1/trading/traders/{traderId}/stop",
    role: "user",
    risk: "high-risk-write",
    scopes: ["openid", "profile", "trading:write", "trading:high-risk"],
  },
  {
    operationId: "wallet.get",
    method: "GET",
    path: "/api/v1/wallet",
    role: "user",
    risk: "read",
    scopes: ["openid", "profile", "wallet:read"],
  },
  {
    operationId: "notification.channels.list",
    method: "GET",
    path: "/api/v1/notification/channels",
    role: "user",
    risk: "read",
    scopes: ["openid", "profile", "notification:read"],
  },
  {
    operationId: "account.exchange_uids.list",
    method: "GET",
    path: "/api/v1/account/exchange-uids",
    role: "user",
    risk: "read",
    scopes: ["openid", "profile", "account:read"],
  },
  {
    operationId: "subscriptions.me.get",
    method: "GET",
    path: "/api/v1/subscriptions/me",
    role: "user",
    risk: "read",
    scopes: ["openid", "profile", "subscriptions:read"],
  },
  {
    operationId: "managed_wallets.list",
    method: "GET",
    path: "/api/v1/managed-wallets",
    role: "user",
    risk: "read",
    scopes: ["openid", "profile", "managed-wallets:read"],
  },
  {
    operationId: "strategy_plaza.publications.list",
    method: "GET",
    path: "/api/v1/strategy-plaza/publications",
    role: "user",
    risk: "read",
    scopes: ["openid", "profile", "strategy-plaza:read"],
  },
  {
    operationId: "spread_radar.pairs.list",
    method: "GET",
    path: "/api/v1/spread-radar/pairs",
    role: "user",
    risk: "read",
    scopes: ["openid", "profile", "spread-radar:read"],
  },
  {
    operationId: "trader_dna.report.get",
    method: "GET",
    path: "/api/v1/trader-dna/report",
    role: "user",
    risk: "read",
    scopes: ["openid", "profile", "trader-dna:read"],
  },
  {
    operationId: "platform_statistics.get",
    method: "GET",
    path: "/api/v1/platform-statistics",
    role: "user",
    risk: "read",
    scopes: ["openid", "profile", "platform-statistics:read"],
  },
  {
    operationId: "asr.transcribe",
    method: "POST",
    path: "/api/v1/asr/transcribe",
    role: "user",
    risk: "write",
    scopes: ["openid", "profile", "asr:write"],
  },
  {
    operationId: "lite.catalog_config.get",
    method: "GET",
    path: "/api/v1/lite/catalog-config",
    role: "user",
    risk: "read",
    scopes: ["openid", "profile", "lite:read"],
  },
  {
    operationId: "admin.users.list",
    method: "GET",
    path: "/api/v1/admin/users",
    role: "admin",
    risk: "read",
    scopes: ["openid", "profile", "admin:read"],
  },
];

export function findCatalogOperation(
  operationId: string
): CatalogOperation | undefined {
  return CATALOG_OPERATIONS.find((op) => op.operationId === operationId);
}

export function buildCapabilityManifest() {
  return {
    contractVersion: CATALOG_VERSION,
    registryVersion: "1.0.0",
    operations: CATALOG_OPERATIONS.map((op) => ({
      operationId: op.operationId,
      method: op.method,
      path: op.path,
      role: op.role,
      risk: op.risk,
      scopes: op.scopes,
      stream: Boolean(op.stream),
      mvp: Boolean(op.mvp),
    })),
  };
}

/** Resolve path templates like /api/v1/backtests/{backtestId}. */
export function resolveOperationPath(
  template: string,
  params: Record<string, string>
): string {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key: string) => {
    const value = params[key];
    if (!value) {
      throw new Error(`Missing path parameter: ${key}`);
    }
    return encodeURIComponent(value);
  });
}
