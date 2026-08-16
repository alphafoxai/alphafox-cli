import type { ProfileConfig } from "../config/profiles";
import { resolveProfile } from "../config/profiles";
import { writeError, writeSuccess } from "../envelope";
import type { ApiRequestOptions, ApiResponse } from "../http/client";
import { apiRequest as defaultApiRequest } from "../http/client";
import { extractMarketCatalog, marketSymbolsPath } from "./catalog";
import { isResolveSymbolsError, ResolveSymbolsError } from "./errors";
import { resolveSymbolsExchangeId } from "./exchanges";
import { indexCatalogSymbols, resolveQueryAgainstCatalog } from "./match";
import {
  parseResolveSymbolsArgs,
  RESOLVE_SYMBOLS_USAGE,
} from "./parse-args";
import type { ResolveSymbolsRunArgs, ResolveSymbolsSuccess } from "./types";

export interface ResolveSymbolsCliFlags {
  readonly profile?: string;
  readonly format: "json" | "jsonl" | "text";
  readonly yes: boolean;
  readonly dryRun: boolean;
  readonly noInput: boolean;
  readonly unsafeCustomEndpoint?: string;
  readonly jq?: string;
}

export interface ResolveSymbolsRunDeps {
  readonly apiRequest?: (
    options: ApiRequestOptions,
    env?: NodeJS.ProcessEnv
  ) => Promise<ApiResponse>;
}

function extractErrorMessage(json: unknown, fallback: string): string {
  if (json && typeof json === "object") {
    const o = json as Record<string, unknown>;
    if (typeof o.message === "string") return o.message;
    if (typeof o.detail === "string") return o.detail;
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
  }
  return undefined;
}

export function resolveSymbolsHelpData(): {
  readonly name: string;
  readonly usage: string[];
  readonly notes: string[];
} {
  return {
    name: "resolve-symbols",
    usage: RESOLVE_SYMBOLS_USAGE,
    notes: [
      "Resolves user-mentioned tickers against market.symbols.list for the chosen catalog",
      "Default --exchange is binance (binance_perp_usdt). Built-in aliases: binance|okx|bybit|bitget|hyperliquid|aster",
      "US stock perps live in the same catalog (NVDA/USDT:USDT) and are tagged symbolMetadata.assetClass=equity_perp / isTradFiRwa",
      "For 美股 use --asset-class equity_perp. For gold/silver RWAs use rwa_perp. Crypto perps are untagged or --asset-class crypto",
      "Each match includes assetClass and isTradFiRwa. Do not treat an equity_perp as a crypto coin",
      "Catalog dump remains alphafox market symbols list --exchange <id>",
    ],
  };
}

export async function executeResolveSymbols(
  args: ResolveSymbolsRunArgs,
  flags: ResolveSymbolsCliFlags,
  env: NodeJS.ProcessEnv = process.env,
  deps: ResolveSymbolsRunDeps = {}
): Promise<ResolveSymbolsSuccess> {
  if (args.help) {
    throw new ResolveSymbolsError({
      type: "usage",
      message: "internal: help should be handled by the command wrapper",
    });
  }
  const exchange = resolveSymbolsExchangeId(args.exchange);
  const profile: ProfileConfig = resolveProfile(flags.profile, env, {
    unsafeCustomEndpoint: flags.unsafeCustomEndpoint,
  });
  const api = deps.apiRequest ?? defaultApiRequest;
  const res = await api(
    {
      method: "GET",
      path: marketSymbolsPath(exchange.id),
      profile,
    },
    env
  );
  if (res.status >= 400) {
    throw new ResolveSymbolsError({
      type: "http",
      status: res.status,
      message: extractErrorMessage(res.json, res.bodyText),
      code: extractErrorCode(res.json),
      hint:
        res.status === 401 || res.status === 403
          ? "Run alphafox auth login. Tokens live in the OS keychain."
          : undefined,
      details: res.json,
    });
  }

  const payload = extractMarketCatalog(res.json);
  const catalog = indexCatalogSymbols(payload.symbols, payload.symbolMetadata);
  if (
    args.assetClass !== "all" &&
    !catalog.some((item) => item.metadata?.assetClass)
  ) {
    throw new ResolveSymbolsError({
      type: "runtime",
      subtype: "metadata_missing",
      message:
        "market.symbols.list did not include symbolMetadata; cannot apply --asset-class",
      hint: "Retry without --asset-class, or use a catalog that returns symbolMetadata.assetClass.",
    });
  }
  return {
    exchange: exchange.id,
    exchangeLabel: exchange.label,
    catalogSize: catalog.length,
    queries: args.queries.map((query) =>
      resolveQueryAgainstCatalog(query, catalog, args.limit, args.assetClass)
    ),
  };
}

export async function cmdResolveSymbols(
  args: string[],
  flags: ResolveSymbolsCliFlags,
  env: NodeJS.ProcessEnv = process.env,
  deps: ResolveSymbolsRunDeps = {}
): Promise<number> {
  let parsed: ResolveSymbolsRunArgs;
  try {
    parsed = parseResolveSymbolsArgs(args);
  } catch (err) {
    if (isResolveSymbolsError(err)) {
      writeError(
        {
          type: err.type,
          subtype: err.subtype,
          message: err.message,
          hint: err.hint,
          status: err.status,
          details: err.details,
        },
        { exitCode: err.status === 401 || err.status === 403 ? 77 : undefined }
      );
    }
    throw err;
  }

  if (parsed.help) {
    writeSuccess(resolveSymbolsHelpData(), {
      format: flags.format,
      jq: flags.jq,
    });
    return 0;
  }

  const exchange = resolveSymbolsExchangeId(parsed.exchange);
  if (flags.dryRun) {
    writeSuccess(
      {
        dryRun: true,
        operationId: "market.symbols.list",
        method: "GET",
        path: marketSymbolsPath(exchange.id),
        exchange: exchange.id,
        exchangeLabel: exchange.label,
        assetClass: parsed.assetClass,
        queries: parsed.queries,
      },
      { format: flags.format, jq: flags.jq }
    );
    return 0;
  }

  try {
    const result = await executeResolveSymbols(parsed, flags, env, deps);
    writeSuccess(result, {
      format: flags.format,
      jq: flags.jq,
      meta: { operationId: "market.symbols.list" },
    });
    return 0;
  } catch (err) {
    if (isResolveSymbolsError(err)) {
      writeError(
        {
          type: err.type,
          subtype: err.subtype,
          message: err.message,
          hint: err.hint,
          status: err.status,
          code: err.code,
          details: err.details,
        },
        { exitCode: err.status === 401 || err.status === 403 ? 77 : undefined }
      );
    }
    throw err;
  }
}
