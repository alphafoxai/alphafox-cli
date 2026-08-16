export type ResolveSymbolsStatus = "exact" | "close" | "ambiguous" | "none";

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
}

export interface ResolveSymbolsQueryResult {
  readonly query: string;
  readonly status: ResolveSymbolsStatus;
  readonly resolved: string | null;
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
}
