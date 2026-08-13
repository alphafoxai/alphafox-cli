/**
 * Raw API allowlist from the generated Operation Registry.
 * Finite set: infra catalog paths + CLI-included operation facade paths.
 * Unknown `/api/v1/*` paths are denied — raw API cannot bypass the catalog.
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

/**
 * Infra paths always allowed (exact, except `/api/v1/operations/*`).
 * Product routes must match a registry facadePath — no prefix smuggling.
 */
export const FACILITY_ALWAYS_ALLOW = [
  "/api/v1/meta",
  "/api/v1/openapi.json",
  "/api/v1/openapi",
  "/api/v1/operations",
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
  actual: string,
  catchAll = false
): boolean {
  const t = normalizeApiPath(template).split("/").filter(Boolean);
  const a = normalizeApiPath(actual).split("/").filter(Boolean);
  if (catchAll) {
    if (a.length < t.length) return false;
    for (let i = 0; i < t.length; i += 1) {
      const seg = t[i]!;
      if (seg.startsWith("{") && seg.endsWith("}")) continue;
      if (seg !== a[i]) return false;
    }
    return true;
  }
  if (t.length !== a.length) return false;
  for (let i = 0; i < t.length; i += 1) {
    const seg = t[i]!;
    if (seg.startsWith("{") && seg.endsWith("}")) continue;
    if (seg !== a[i]) return false;
  }
  return true;
}

function isInfraAllowlisted(n: string): boolean {
  if (
    n === "/api/v1/meta" ||
    n === "/api/v1/openapi.json" ||
    n === "/api/v1/openapi" ||
    n === "/api/v1/operations" ||
    n.startsWith("/api/v1/operations/")
  ) {
    return true;
  }
  return false;
}

function isCatalogPathMatch(n: string): boolean {
  for (const op of CATALOG_OPERATIONS) {
    if (pathTemplateMatches(op.path, n, Boolean(op.catchAll))) {
      return true;
    }
  }
  return false;
}

function isExtraAllowMatch(n: string, extraAllow: readonly string[]): boolean {
  for (const a of extraAllow) {
    if (n === a || n.startsWith(`${a}/`) || pathTemplateMatches(a, n)) {
      return true;
    }
  }
  return false;
}

/**
 * Finite allow set: infra catalog paths + generated operation facade paths.
 * Unknown `/api/v1/*` paths are denied.
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
  if (n !== "/api/v1" && !n.startsWith("/api/v1/")) {
    return false;
  }
  if (isInfraAllowlisted(n)) {
    return true;
  }
  if (isExtraAllowMatch(n, extraAllow)) {
    return true;
  }
  if (isCatalogPathMatch(n)) {
    return true;
  }
  return false;
}
