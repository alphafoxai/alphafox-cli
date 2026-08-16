import type {
  CatalogSymbol,
  ResolveAssetClassFilter,
  ResolveSymbolsMatch,
  ResolveSymbolsMatchReason,
  ResolveSymbolsQueryResult,
  SymbolMetadata,
} from "./types";

const LINEAR_PERP_PATTERN =
  /^([\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*)\/(USDT|USDC|USD):\2$/u;
const QUOTE_ASSETS = ["USDT", "USDC", "BUSD", "USD"] as const;
const EXACT_REASONS = new Set<ResolveSymbolsMatchReason>([
  "exact_canonical",
  "exact_compact",
  "exact_pair",
  "exact_base",
]);

export function normalizeSymbolSearchKey(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

export function parseCatalogSymbol(symbol: string): CatalogSymbol | null {
  const trimmed = symbol.trim();
  if (!trimmed) return null;
  const upper = trimmed.toUpperCase();
  const linear = LINEAR_PERP_PATTERN.exec(upper);
  if (linear) {
    const base = linear[1]!;
    const quote = linear[2]!;
    const canonical = `${base}/${quote}:${quote}`;
    const compact = `${base}${quote}`;
    return {
      symbol: canonical,
      base,
      quote,
      pair: `${base}/${quote}`,
      compact,
      searchKey: normalizeSymbolSearchKey(canonical),
      baseKey: normalizeSymbolSearchKey(base),
      compactKey: normalizeSymbolSearchKey(compact),
    };
  }
  const slash = upper.indexOf("/");
  const colon = upper.lastIndexOf(":");
  if (slash > 0) {
    const base = upper.slice(0, slash);
    const quote =
      colon > slash ? upper.slice(slash + 1, colon) : upper.slice(slash + 1);
    const compact = `${base}${quote}`;
    return {
      symbol: upper,
      base,
      quote,
      pair: `${base}/${quote}`,
      compact,
      searchKey: normalizeSymbolSearchKey(upper),
      baseKey: normalizeSymbolSearchKey(base),
      compactKey: normalizeSymbolSearchKey(compact),
    };
  }
  return {
    symbol: upper,
    base: upper,
    quote: "",
    pair: upper,
    compact: upper,
    searchKey: normalizeSymbolSearchKey(upper),
    baseKey: normalizeSymbolSearchKey(upper),
    compactKey: normalizeSymbolSearchKey(upper),
  };
}

export function indexCatalogSymbols(
  symbols: readonly string[],
  metadata: Readonly<Record<string, SymbolMetadata>> = {}
): readonly CatalogSymbol[] {
  const seen = new Set<string>();
  const indexed: CatalogSymbol[] = [];
  for (const raw of symbols) {
    const parsed = parseCatalogSymbol(raw);
    if (!parsed) continue;
    if (seen.has(parsed.symbol)) continue;
    seen.add(parsed.symbol);
    indexed.push({
      ...parsed,
      metadata: metadata[raw] ?? metadata[parsed.symbol],
    });
  }
  return indexed;
}

export function catalogMatchesAssetClass(
  item: CatalogSymbol,
  assetClass: ResolveAssetClassFilter
): boolean {
  if (assetClass === "all") return true;
  const cls = item.metadata?.assetClass;
  const tradfi = item.metadata?.isTradFiRwa === true;
  if (assetClass === "equity_perp") return cls === "equity_perp";
  if (assetClass === "rwa_perp") return cls === "rwa_perp";
  return !tradfi && cls !== "equity_perp" && cls !== "rwa_perp";
}

export function resolveQueryAgainstCatalog(
  query: string,
  catalog: readonly CatalogSymbol[],
  limit = 8,
  assetClass: ResolveAssetClassFilter = "all"
): ResolveSymbolsQueryResult {
  const trimmed = query.trim();
  const scoped = catalog.filter((item) =>
    catalogMatchesAssetClass(item, assetClass)
  );
  const matches = rankMatches(trimmed, scoped);
  const exact = matches.filter((item) => EXACT_REASONS.has(item.reason));
  const close = matches.filter((item) => !EXACT_REASONS.has(item.reason));
  const capped = (items: readonly ResolveSymbolsMatch[]) =>
    items.slice(0, Math.max(1, limit));

  if (exact.length === 1) {
    return result("exact", exact[0]!.symbol, false, exact, exact.length);
  }
  if (exact.length > 1) {
    return result("ambiguous", null, true, capped(exact), exact.length);
  }
  if (close.length === 1) {
    return result("close", close[0]!.symbol, true, close, 1);
  }
  if (close.length > 1) {
    return result("ambiguous", null, true, capped(close), close.length);
  }
  return result("none", null, false, [], 0);

  function result(
    status: ResolveSymbolsQueryResult["status"],
    resolved: string | null,
    needsConfirmation: boolean,
    matches: readonly ResolveSymbolsMatch[],
    matchCount: number
  ): ResolveSymbolsQueryResult {
    const chosen = resolved
      ? matches.find((item) => item.symbol === resolved)
      : undefined;
    return {
      query: trimmed,
      status,
      resolved,
      assetClass: chosen?.assetClass ?? null,
      isTradFiRwa: chosen?.isTradFiRwa ?? false,
      needsConfirmation,
      matches,
      matchCount,
    };
  }
}

function rankMatches(
  query: string,
  catalog: readonly CatalogSymbol[]
): ResolveSymbolsMatch[] {
  const canonicalQuery = query.trim().toUpperCase();
  const queryKey = normalizeSymbolSearchKey(query);
  if (!canonicalQuery || !queryKey) return [];
  if (isQuoteAssetKey(queryKey)) return [];

  const queryBaseKey = queryBaseSearchKey(canonicalQuery, queryKey);
  const scored: ResolveSymbolsMatch[] = [];
  for (const item of catalog) {
    const ranked = rankCatalogSymbol(item, canonicalQuery, queryKey, queryBaseKey);
    if (ranked) scored.push(ranked);
  }
  scored.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return left.symbol.localeCompare(right.symbol);
  });
  return scored;
}

function rankCatalogSymbol(
  item: CatalogSymbol,
  canonicalQuery: string,
  queryKey: string,
  queryBaseKey: string
): ResolveSymbolsMatch | null {
  if (item.symbol === canonicalQuery) {
    return match(item, "exact_canonical", 100);
  }
  if (item.pair === canonicalQuery) {
    return match(item, "exact_pair", 96);
  }
  if (item.compactKey === queryKey || item.searchKey === queryKey) {
    return match(item, "exact_compact", 98);
  }
  if (item.baseKey === queryKey || item.baseKey === queryBaseKey) {
    return match(item, "exact_base", 95);
  }

  let best: ResolveSymbolsMatch | null = null;
  const consider = (
    reason: ResolveSymbolsMatchReason,
    score: number
  ): void => {
    if (!best || score > best.score) {
      best = match(item, reason, score);
    }
  };

  if (queryBaseKey.length >= 2 && item.baseKey.startsWith(queryBaseKey)) {
    consider("prefix", clampScore(80 - (item.baseKey.length - queryBaseKey.length)));
  }
  if (queryBaseKey.length >= 3 && queryBaseKey.startsWith(item.baseKey)) {
    consider("prefix", clampScore(74 - (queryBaseKey.length - item.baseKey.length)));
  }
  if (queryBaseKey.length >= 3 && item.baseKey.includes(queryBaseKey)) {
    consider("contains", 55);
  }
  const distance = levenshtein(queryBaseKey, item.baseKey);
  if (isCloseDistance(queryBaseKey, item.baseKey, distance)) {
    consider("close", clampScore(48 - distance * 8));
  }
  return best;
}

function queryBaseSearchKey(canonicalQuery: string, queryKey: string): string {
  const linear = LINEAR_PERP_PATTERN.exec(canonicalQuery);
  if (linear) return normalizeSymbolSearchKey(linear[1]!);
  const slash = canonicalQuery.indexOf("/");
  if (slash > 0) {
    return normalizeSymbolSearchKey(canonicalQuery.slice(0, slash));
  }
  for (const quote of QUOTE_ASSETS) {
    if (queryKey.length > quote.length && queryKey.endsWith(quote)) {
      return queryKey.slice(0, -quote.length);
    }
  }
  return queryKey;
}

function isQuoteAssetKey(queryKey: string): boolean {
  return (QUOTE_ASSETS as readonly string[]).includes(queryKey);
}

function isCloseDistance(left: string, right: string, distance: number): boolean {
  const shortest = Math.min(left.length, right.length);
  if (shortest < 2 || distance <= 0) return false;
  if (shortest <= 4) return distance === 1;
  return distance <= 2;
}

function match(
  item: CatalogSymbol,
  reason: ResolveSymbolsMatchReason,
  score: number
): ResolveSymbolsMatch {
  return {
    symbol: item.symbol,
    reason,
    score,
    assetClass: item.metadata?.assetClass ?? null,
    isTradFiRwa: item.metadata?.isTradFiRwa === true,
  };
}

function clampScore(score: number): number {
  return Math.max(1, Math.min(94, score));
}

export function levenshtein(left: string, right: string): number {
  if (left === right) return 0;
  if (left.length === 0) return right.length;
  if (right.length === 0) return left.length;
  const prev = new Array<number>(right.length + 1);
  const next = new Array<number>(right.length + 1);
  for (let j = 0; j <= right.length; j += 1) prev[j] = j;
  for (let i = 1; i <= left.length; i += 1) {
    next[0] = i;
    const leftCh = left.charCodeAt(i - 1);
    for (let j = 1; j <= right.length; j += 1) {
      const cost = leftCh === right.charCodeAt(j - 1) ? 0 : 1;
      next[j] = Math.min(
        (prev[j] ?? 0) + 1,
        (next[j - 1] ?? 0) + 1,
        (prev[j - 1] ?? 0) + cost
      );
    }
    for (let j = 0; j <= right.length; j += 1) prev[j] = next[j] ?? 0;
  }
  return prev[right.length] ?? Math.max(left.length, right.length);
}
