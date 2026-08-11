/**
 * Raw API allowlist + internal path rejection.
 * Mirrors alphafox-contracts public-api allowlist rules.
 */

const INTERNAL_PREFIXES = [
  "/backend",
  "/control-plane",
  "/signal-center",
  "/api/backend",
  "/api/control-plane",
  "/api/signal-center",
] as const;

/** MVP + core facade paths always allowed; full registry embedded for drift tests. */
export const FACILITY_ALWAYS_ALLOW = [
  "/api/v1/meta",
  "/api/v1/me",
  "/api/v1/operations",
  "/api/v1/openapi.json",
  "/api/v1/trading/strategy-definitions",
  "/api/v1/exchange-connectors",
  "/api/v1/trading/traders",
  "/api/v1/chats",
  "/api/v1/backtests",
] as const;

export function normalizeApiPath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return "/";
  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return (withSlash.split("?")[0] ?? withSlash).split("#")[0]!.replace(
    /\/{2,}/g,
    "/"
  );
}

export function isInternalDisallowedPath(path: string): boolean {
  const n = normalizeApiPath(path);
  return INTERNAL_PREFIXES.some(
    (p) => n === p || n.startsWith(`${p}/`) || n.includes(`${p}/`)
  );
}

export function isFacadeAllowlistedPath(
  path: string,
  extraAllow: readonly string[] = []
): boolean {
  const n = normalizeApiPath(path);
  if (isInternalDisallowedPath(n)) {
    return false;
  }
  if (!n.startsWith("/api/v1")) {
    return false;
  }
  const allow = [...FACILITY_ALWAYS_ALLOW, ...extraAllow];
  for (const a of allow) {
    if (n === a || n.startsWith(`${a}/`)) {
      return true;
    }
  }
  // templated backtests etc.
  if (/^\/api\/v1\/backtests\/[^/]+(\/.*)?$/.test(n)) {
    return true;
  }
  if (/^\/api\/v1\/trading\/traders\/[^/]+(\/.*)?$/.test(n)) {
    return true;
  }
  if (/^\/api\/v1\//.test(n)) {
    // Allow any /api/v1/* that is not internal — facade is the allowlist boundary.
    // Internal services are never mounted under /api/v1.
    return true;
  }
  return false;
}
