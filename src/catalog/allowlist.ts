/**
 * Raw API allowlist + internal path rejection.
 * Only facility prefixes and catalog-derived paths pass the facade gate.
 * Paths are segment-resolved (`.` / `..` / percent-encoded dots) before matching
 * so facility prefix checks cannot be bypassed via path traversal.
 */

import { CATALOG_OPERATIONS } from "./operations";

const INTERNAL_PREFIXES = [
  "/backend",
  "/control-plane",
  "/signal-center",
  "/api/backend",
  "/api/control-plane",
  "/api/signal-center",
] as const;

/** MVP + core facade path prefixes always allowed (exact or nested under). */
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

/**
 * Decode percent-encoded path segments (up to twice for double-encoding)
 * without turning encoded slashes into separators mid-segment incorrectly:
 * each segment is decoded independently so %2F stays inside a segment name.
 */
function decodePathSegments(path: string): string {
  let current = path;
  for (let pass = 0; pass < 2; pass += 1) {
    const next = current
      .split("/")
      .map((seg) => {
        if (!seg.includes("%")) return seg;
        try {
          return decodeURIComponent(seg);
        } catch {
          return seg;
        }
      })
      .join("/");
    if (next === current) break;
    current = next;
  }
  return current;
}

/**
 * Normalize API paths for allowlist decisions:
 * strip query/hash, collapse //, decode %2e-style segments, resolve `.`/`..`.
 * Escaping above `/` via `..` is clamped at root (POSIX-style).
 */
export function normalizeApiPath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return "/";
  let raw = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  raw = (raw.split("?")[0] ?? raw).split("#")[0]!;
  raw = decodePathSegments(raw);
  raw = raw.replace(/\/{2,}/g, "/");

  const resolved: string[] = [];
  for (const seg of raw.split("/")) {
    if (seg === "" || seg === ".") {
      continue;
    }
    if (seg === "..") {
      if (resolved.length > 0) {
        resolved.pop();
      }
      continue;
    }
    // Reject backslash or null-byte style smuggling in a segment
    if (seg.includes("\0") || seg.includes("\\")) {
      return "/";
    }
    resolved.push(seg);
  }
  return resolved.length === 0 ? "/" : `/${resolved.join("/")}`;
}

export function isInternalDisallowedPath(path: string): boolean {
  const n = normalizeApiPath(path);
  return INTERNAL_PREFIXES.some(
    (p) => n === p || n.startsWith(`${p}/`) || n.includes(`${p}/`)
  );
}

/** Match OpenAPI-style templates: /api/v1/backtests/{backtestId}/cancel */
export function pathTemplateMatches(
  template: string,
  actual: string
): boolean {
  const t = normalizeApiPath(template).split("/").filter(Boolean);
  const a = normalizeApiPath(actual).split("/").filter(Boolean);
  if (t.length !== a.length) return false;
  for (let i = 0; i < t.length; i += 1) {
    const seg = t[i]!;
    if (seg.startsWith("{") && seg.endsWith("}")) continue;
    if (seg !== a[i]) return false;
  }
  return true;
}

function isFacilityPrefixMatch(n: string, allow: readonly string[]): boolean {
  for (const a of allow) {
    if (n === a || n.startsWith(`${a}/`)) {
      return true;
    }
  }
  return false;
}

function isCatalogPathMatch(n: string): boolean {
  for (const op of CATALOG_OPERATIONS) {
    if (pathTemplateMatches(op.path, n)) {
      return true;
    }
  }
  return false;
}

/**
 * Finite allow set: facility prefixes + catalog operation paths (+ optional extras).
 * Unknown `/api/v1/*` paths are denied — raw API cannot bypass the catalog facade.
 * Matching always uses the segment-resolved path (no `..` prefix smuggling).
 */
export function isFacadeAllowlistedPath(
  path: string,
  extraAllow: readonly string[] = []
): boolean {
  const n = normalizeApiPath(path);
  if (isInternalDisallowedPath(n)) {
    return false;
  }
  // Must remain under /api/v1 after resolution (blocks /api/v1/../backend, etc.)
  if (n !== "/api/v1" && !n.startsWith("/api/v1/")) {
    return false;
  }
  const allow = [...FACILITY_ALWAYS_ALLOW, ...extraAllow];
  if (isFacilityPrefixMatch(n, allow)) {
    return true;
  }
  if (isCatalogPathMatch(n)) {
    return true;
  }
  return false;
}
