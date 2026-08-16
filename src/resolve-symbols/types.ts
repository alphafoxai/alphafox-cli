export type ResolveSymbolsStatus = "exact" | "close" | "ambiguous" | "none";

export type ResolveAssetClassFilter =
  | "all"
  | "equity_perp"
  | "rwa_perp"
  | "crypto";

export interface SymbolMetadata {
  readonly isTradFiRwa?: boolean;
  readonly assetClass?: string;
  readonly minAmount?: number;
  readonly minCost?: number;
  readonly contractSize?: number;
}

export type ResolveSymbolsMatchReason =
  | "exact_canonical"
  | "exact_compact"
  | "exact_pair"
  | "exact_base"
  | "prefix"
  | "contains"
  | "close";

export interface ResolveSymbolsMatch {
  readonly symbol: string;
  readonly reason: ResolveSymbolsMatchReason;
  readonly score: number;
  readonly assetClass: string | null;
  readonly isTradFiRwa: boolean;
}

export interface ResolveSymbolsQueryResult {
  readonly query: string;
  readonly status: ResolveSymbolsStatus;
  readonly resolved: string | null;
  readonly assetClass: string | null;
  readonly isTradFiRwa: boolean;
  readonly needsConfirmation: boolean;
  readonly matches: readonly ResolveSymbolsMatch[];
  readonly matchCount: number;
}

export interface ResolveSymbolsSuccess {
  readonly exchange: string;
  readonly exchangeLabel: string;
  readonly catalogSize: number;
  readonly queries: readonly ResolveSymbolsQueryResult[];
}

export interface ResolveSymbolsRunArgs {
  readonly help: boolean;
  readonly queries: readonly string[];
  readonly exchange: string;
  readonly limit: number;
  readonly assetClass: ResolveAssetClassFilter;
}

export interface CatalogSymbol {
  readonly symbol: string;
  readonly base: string;
  readonly quote: string;
  readonly pair: string;
  readonly compact: string;
  readonly searchKey: string;
  readonly baseKey: string;
  readonly compactKey: string;
  readonly metadata?: SymbolMetadata;
}
