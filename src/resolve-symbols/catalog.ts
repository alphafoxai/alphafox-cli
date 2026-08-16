import { ResolveSymbolsError } from "./errors";

export const MARKET_SYMBOLS_PATH = "/api/v1/market/symbols";

export function marketSymbolsPath(exchangeId: string): string {
  const query = new URLSearchParams({ exchange: exchangeId }).toString();
  return `${MARKET_SYMBOLS_PATH}?${query}`;
}

export function extractCatalogSymbols(json: unknown): string[] {
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
  return out;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}
