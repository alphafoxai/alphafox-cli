import { ResolveSymbolsError } from "./errors";
import type { SymbolMetadata } from "./types";

export const MARKET_SYMBOLS_PATH = "/api/v1/market/symbols";

export function marketSymbolsPath(exchangeId: string): string {
  const query = new URLSearchParams({ exchange: exchangeId }).toString();
  return `${MARKET_SYMBOLS_PATH}?${query}`;
}

export interface MarketCatalogPayload {
  readonly symbols: string[];
  readonly symbolMetadata: Readonly<Record<string, SymbolMetadata>>;
}

export function extractCatalogSymbols(json: unknown): string[] {
  return extractMarketCatalog(json).symbols;
}

export function extractMarketCatalog(json: unknown): MarketCatalogPayload {
  const root = asRecord(json);
  const payload = asRecord(root?.data) ?? root;
  const symbols = payload?.symbols;
  if (!Array.isArray(symbols)) {
    throw new ResolveSymbolsError({
      type: "runtime",
      subtype: "catalog_invalid",
      message: "market.symbols.list response did not include a symbols array",
      details: json,
    });
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of symbols) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  if (out.length === 0) {
    throw new ResolveSymbolsError({
      type: "runtime",
      subtype: "catalog_empty",
      message: "market.symbols.list returned no contract symbols",
      details: json,
    });
  }
  return {
    symbols: out,
    symbolMetadata: extractSymbolMetadata(payload?.symbolMetadata),
  };
}

function extractSymbolMetadata(
  value: unknown
): Readonly<Record<string, SymbolMetadata>> {
  const rec = asRecord(value);
  if (!rec) return {};
  const out: Record<string, SymbolMetadata> = {};
  for (const [rawKey, rawMeta] of Object.entries(rec)) {
    const key = rawKey.trim();
    const meta = parseSymbolMetadata(rawMeta);
    if (!key || !meta) continue;
    out[key] = meta;
  }
  return out;
}

function parseSymbolMetadata(value: unknown): SymbolMetadata | undefined {
  const rec = asRecord(value);
  if (!rec) return undefined;
  const meta: {
    isTradFiRwa?: boolean;
    assetClass?: string;
    minAmount?: number;
    minCost?: number;
    contractSize?: number;
  } = {};
  if (typeof rec.isTradFiRwa === "boolean") {
    meta.isTradFiRwa = rec.isTradFiRwa;
  }
  if (typeof rec.assetClass === "string" && rec.assetClass.trim()) {
    meta.assetClass = rec.assetClass.trim();
  }
  if (isFiniteNumber(rec.minAmount)) meta.minAmount = rec.minAmount;
  if (isFiniteNumber(rec.minCost)) meta.minCost = rec.minCost;
  if (isFiniteNumber(rec.contractSize)) meta.contractSize = rec.contractSize;
  return Object.keys(meta).length > 0 ? meta : undefined;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}
