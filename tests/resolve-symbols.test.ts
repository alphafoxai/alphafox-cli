import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  extractCatalogSymbols,
  extractMarketCatalog,
} from "../src/resolve-symbols/catalog";
import { ResolveSymbolsError } from "../src/resolve-symbols/errors";
import { resolveSymbolsExchangeId } from "../src/resolve-symbols/exchanges";
import {
  indexCatalogSymbols,
  resolveQueryAgainstCatalog,
} from "../src/resolve-symbols/match";
import { parseResolveSymbolsArgs } from "../src/resolve-symbols/parse-args";
import {
  executeResolveSymbols,
  type ResolveSymbolsCliFlags,
} from "../src/resolve-symbols/run-command";
import type { ApiRequestOptions, ApiResponse } from "../src/http/client";

const CATALOG = indexCatalogSymbols(
  [
    "BTC/USDT:USDT",
    "ETH/USDT:USDT",
    "SOL/USDT:USDT",
    "ETC/USDT:USDT",
    "ETHW/USDT:USDT",
    "1000PEPE/USDT:USDT",
    "龙虾/USDT:USDT",
    "XYZ-TSLA/USDC:USDC",
    "NVDA/USDT:USDT",
    "TSLA/USDT:USDT",
    "XAU/USDT:USDT",
  ],
  {
    "NVDA/USDT:USDT": { isTradFiRwa: true, assetClass: "equity_perp" },
    "TSLA/USDT:USDT": { isTradFiRwa: true, assetClass: "equity_perp" },
    "XAU/USDT:USDT": { isTradFiRwa: true, assetClass: "rwa_perp" },
  }
);

const FLAGS: ResolveSymbolsCliFlags = {
  format: "json",
  yes: false,
  dryRun: false,
  noInput: true,
  profile: "local",
};

describe("resolve-symbols parse", () => {
  it("defaults exchange to binance_perp_usdt", () => {
    const parsed = parseResolveSymbolsArgs(["BTC"]);
    assert.equal(parsed.exchange, "binance_perp_usdt");
    assert.equal(parsed.assetClass, "all");
    assert.deepEqual(parsed.queries, ["BTC"]);
  });

  it("accepts --asset-class equity_perp", () => {
    const parsed = parseResolveSymbolsArgs([
      "NVDA",
      "--asset-class",
      "equity_perp",
    ]);
    assert.equal(parsed.assetClass, "equity_perp");
    assert.deepEqual(parsed.queries, ["NVDA"]);
  });

  it("rejects unknown --asset-class values", () => {
    assert.throws(
      () => parseResolveSymbolsArgs(["NVDA", "--asset-class", "stocks"]),
      (err: unknown) => {
        assert.ok(err instanceof ResolveSymbolsError);
        assert.equal(err.subtype, "invalid_asset_class");
        return true;
      }
    );
  });

  it("accepts exchange aliases and repeated --query", () => {
    const parsed = parseResolveSymbolsArgs([
      "--exchange",
      "okx",
      "--query",
      "BTC",
      "--symbol",
      "eth",
    ]);
    assert.equal(parsed.exchange, "okx_perp_usdt");
    assert.deepEqual(parsed.queries, ["BTC", "eth"]);
  });

  it("passes through catalog ids that are not built-in perp aliases", () => {
    const parsed = parseResolveSymbolsArgs([
      "NVDA",
      "--exchange",
      "binance_spot",
    ]);
    assert.equal(parsed.exchange, "binance_spot");
    assert.deepEqual(parsed.queries, ["NVDA"]);
  });

  it("rejects malformed exchange ids", () => {
    assert.throws(
      () => parseResolveSymbolsArgs(["BTC", "--exchange", "??"]),
      (err: unknown) => {
        assert.ok(err instanceof ResolveSymbolsError);
        assert.equal(err.subtype, "invalid_exchange");
        return true;
      }
    );
  });

  it("requires a query", () => {
    assert.throws(
      () => parseResolveSymbolsArgs(["--exchange", "binance"]),
      (err: unknown) => {
        assert.ok(err instanceof ResolveSymbolsError);
        assert.equal(err.subtype, "missing_query");
        return true;
      }
    );
  });
});

describe("resolve-symbols exchanges", () => {
  it("maps binance to the public market id", () => {
    assert.equal(resolveSymbolsExchangeId("Binance").id, "binance_perp_usdt");
    assert.equal(
      resolveSymbolsExchangeId("hyperliquid_perp_usdc").label,
      "HyperLiquid"
    );
    assert.equal(resolveSymbolsExchangeId("binance_spot").id, "binance_spot");
  });
});

describe("resolve-symbols match", () => {
  it("resolves canonical, compact, pair, and base forms as exact", () => {
    assert.equal(
      resolveQueryAgainstCatalog("BTC/USDT:USDT", CATALOG).resolved,
      "BTC/USDT:USDT"
    );
    assert.equal(
      resolveQueryAgainstCatalog("btcusdt", CATALOG).status,
      "exact"
    );
    assert.equal(
      resolveQueryAgainstCatalog("BTC/USDT", CATALOG).resolved,
      "BTC/USDT:USDT"
    );
    const base = resolveQueryAgainstCatalog("btc", CATALOG);
    assert.equal(base.status, "exact");
    assert.equal(base.resolved, "BTC/USDT:USDT");
    assert.equal(base.needsConfirmation, false);
  });

  it("keeps CJK bases exact", () => {
    const result = resolveQueryAgainstCatalog("龙虾", CATALOG);
    assert.equal(result.status, "exact");
    assert.equal(result.resolved, "龙虾/USDT:USDT");
  });

  it("does not treat ETH as ETHW", () => {
    const result = resolveQueryAgainstCatalog("ETH", CATALOG);
    assert.equal(result.status, "exact");
    assert.equal(result.resolved, "ETH/USDT:USDT");
  });

  it("auto-selects a single close match and asks for confirmation", () => {
    const result = resolveQueryAgainstCatalog("btcc", CATALOG);
    assert.equal(result.status, "close");
    assert.equal(result.resolved, "BTC/USDT:USDT");
    assert.equal(result.needsConfirmation, true);
  });

  it("maps a longer name onto a unique prefix base with confirmation", () => {
    const result = resolveQueryAgainstCatalog("solana", CATALOG);
    assert.equal(result.status, "close");
    assert.equal(result.resolved, "SOL/USDT:USDT");
    assert.equal(result.needsConfirmation, true);
  });

  it("returns ambiguous close matches without auto-selecting", () => {
    const result = resolveQueryAgainstCatalog("et", CATALOG);
    assert.equal(result.status, "ambiguous");
    assert.equal(result.resolved, null);
    assert.equal(result.needsConfirmation, true);
    assert.ok(result.matches.length >= 2);
  });

  it("prefers the equity perp over a crypto contains-match", () => {
    const result = resolveQueryAgainstCatalog("TSLA", CATALOG);
    assert.equal(result.status, "exact");
    assert.equal(result.resolved, "TSLA/USDT:USDT");
    assert.equal(result.assetClass, "equity_perp");
    assert.equal(result.isTradFiRwa, true);
  });

  it("filters to equity perps when --asset-class equity_perp", () => {
    const nvda = resolveQueryAgainstCatalog("NVDA", CATALOG, 8, "equity_perp");
    assert.equal(nvda.status, "exact");
    assert.equal(nvda.resolved, "NVDA/USDT:USDT");
    assert.equal(nvda.assetClass, "equity_perp");
    const btc = resolveQueryAgainstCatalog("BTC", CATALOG, 8, "equity_perp");
    assert.equal(btc.status, "none");
    const tsla = resolveQueryAgainstCatalog("TSLA", CATALOG, 8, "equity_perp");
    assert.equal(tsla.resolved, "TSLA/USDT:USDT");
    assert.equal(
      tsla.matches.some((item) => item.symbol === "XYZ-TSLA/USDC:USDC"),
      false
    );
  });

  it("does not invent a match for unknown queries or quote assets", () => {
    assert.equal(resolveQueryAgainstCatalog("zzzzzzz", CATALOG).status, "none");
    assert.equal(resolveQueryAgainstCatalog("USDT", CATALOG).status, "none");
  });

  it("caps ambiguous lists with --limit", () => {
    const result = resolveQueryAgainstCatalog("et", CATALOG, 1);
    assert.equal(result.status, "ambiguous");
    assert.equal(result.matches.length, 1);
    assert.ok(result.matchCount > 1);
  });
});

describe("resolve-symbols catalog parse", () => {
  it("reads symbols from a BFF payload or data envelope", () => {
    assert.deepEqual(
      extractCatalogSymbols({
        exchange: "binance_perp_usdt",
        symbols: ["BTC/USDT:USDT", "ETH/USDT:USDT"],
      }),
      ["BTC/USDT:USDT", "ETH/USDT:USDT"]
    );
    assert.deepEqual(
      extractCatalogSymbols({
        data: { symbols: ["SOL/USDT:USDT"] },
      }),
      ["SOL/USDT:USDT"]
    );
    const catalog = extractMarketCatalog({
      exchange: "binance_perp_usdt",
      symbols: ["BTC/USDT:USDT", "NVDA/USDT:USDT"],
      symbolMetadata: {
        "NVDA/USDT:USDT": {
          isTradFiRwa: true,
          assetClass: "equity_perp",
          minAmount: 0.01,
          minCost: 5,
          contractSize: 1,
        },
      },
    });
    assert.deepEqual(catalog.symbolMetadata["NVDA/USDT:USDT"], {
      isTradFiRwa: true,
      assetClass: "equity_perp",
      minAmount: 0.01,
      minCost: 5,
      contractSize: 1,
    });
  });

  it("rejects an empty catalog", () => {
    assert.throws(
      () => extractCatalogSymbols({ symbols: [] }),
      (err: unknown) => {
        assert.ok(err instanceof ResolveSymbolsError);
        assert.equal(err.subtype, "catalog_empty");
        return true;
      }
    );
  });
});

describe("resolve-symbols orchestration", () => {
  it("fetches the public catalog and resolves queries", async () => {
    const calls: string[] = [];
    const result = await executeResolveSymbols(
      {
        help: false,
        queries: ["BTC", "btcc"],
        exchange: "binance_perp_usdt",
        limit: 8,
        assetClass: "all",
      },
      FLAGS,
      { ALPHAFOX_FORCE_FILE_KEYCHAIN: "1" },
      {
        apiRequest: async (options: ApiRequestOptions): Promise<ApiResponse> => {
          calls.push(`${options.method} ${options.path}`);
          return {
            status: 200,
            headers: new Headers(),
            bodyText: "{}",
            requestId: "req-1",
            json: {
              exchange: "binance_perp_usdt",
              symbols: ["BTC/USDT:USDT", "ETH/USDT:USDT", "NVDA/USDT:USDT"],
              symbolMetadata: {
                "NVDA/USDT:USDT": {
                  isTradFiRwa: true,
                  assetClass: "equity_perp",
                },
              },
            },
          };
        },
      }
    );
    assert.deepEqual(calls, [
      "GET /api/v1/market/symbols?exchange=binance_perp_usdt",
    ]);
    assert.equal(result.queries[0]?.status, "exact");
    assert.equal(result.queries[0]?.resolved, "BTC/USDT:USDT");
    assert.equal(result.queries[1]?.status, "close");
    assert.equal(result.queries[1]?.needsConfirmation, true);
    assert.equal(result.queries[0]?.assetClass, null);
    assert.equal(result.queries[0]?.isTradFiRwa, false);
  });

  it("resolves NVDA as an equity perp when metadata is present", async () => {
    const result = await executeResolveSymbols(
      {
        help: false,
        queries: ["NVDA"],
        exchange: "binance_perp_usdt",
        limit: 8,
        assetClass: "equity_perp",
      },
      FLAGS,
      { ALPHAFOX_FORCE_FILE_KEYCHAIN: "1" },
      {
        apiRequest: async (): Promise<ApiResponse> => ({
          status: 200,
          headers: new Headers(),
          bodyText: "{}",
          requestId: "req-eq",
          json: {
            exchange: "binance_perp_usdt",
            symbols: ["BTC/USDT:USDT", "NVDA/USDT:USDT"],
            symbolMetadata: {
              "NVDA/USDT:USDT": {
                isTradFiRwa: true,
                assetClass: "equity_perp",
              },
            },
          },
        }),
      }
    );
    assert.equal(result.queries[0]?.status, "exact");
    assert.equal(result.queries[0]?.resolved, "NVDA/USDT:USDT");
    assert.equal(result.queries[0]?.assetClass, "equity_perp");
    assert.equal(result.queries[0]?.isTradFiRwa, true);
  });

  it("fails closed when --asset-class is set but symbolMetadata is missing", async () => {
    await assert.rejects(
      () =>
        executeResolveSymbols(
          {
            help: false,
            queries: ["NVDA"],
            exchange: "binance_perp_usdt",
            limit: 8,
            assetClass: "equity_perp",
          },
          FLAGS,
          { ALPHAFOX_FORCE_FILE_KEYCHAIN: "1" },
          {
            apiRequest: async (): Promise<ApiResponse> => ({
              status: 200,
              headers: new Headers(),
              bodyText: "{}",
              requestId: "req-meta",
              json: {
                exchange: "binance_perp_usdt",
                symbols: ["BTC/USDT:USDT", "NVDA/USDT:USDT"],
              },
            }),
          }
        ),
      (err: unknown) => {
        assert.ok(err instanceof ResolveSymbolsError);
        assert.equal(err.subtype, "metadata_missing");
        return true;
      }
    );
  });

  it("fails closed on catalog HTTP errors", async () => {
    await assert.rejects(
      () =>
        executeResolveSymbols(
          {
            help: false,
            queries: ["BTC"],
            exchange: "binance_perp_usdt",
            limit: 8,
            assetClass: "all",
          },
          FLAGS,
          { ALPHAFOX_FORCE_FILE_KEYCHAIN: "1" },
          {
            apiRequest: async (): Promise<ApiResponse> => ({
              status: 401,
              headers: new Headers(),
              bodyText: "unauthorized",
              requestId: "req-2",
              json: { message: "Not authenticated" },
            }),
          }
        ),
      (err: unknown) => {
        assert.ok(err instanceof ResolveSymbolsError);
        assert.equal(err.status, 401);
        return true;
      }
    );
  });
});
