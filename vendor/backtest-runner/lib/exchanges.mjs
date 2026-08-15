export const PUBLIC_MARKET_EXCHANGE_BINANCE = "binance_perp_usdt";
export const PUBLIC_MARKET_EXCHANGE_OKX = "okx_perp_usdt";
export const PUBLIC_MARKET_EXCHANGE_BYBIT = "bybit_perp_usdt";
export const PUBLIC_MARKET_EXCHANGE_BITGET = "bitget_perp_usdt";
export const PUBLIC_MARKET_EXCHANGE_HYPERLIQUID = "hyperliquid_perp_usdc";

/**
 * HIP-3 builder DEXes the web public-market picker exposes.
 * The Node runner does not discover the live HIP-3 catalog.
 */
export const HYPERLIQUID_PUBLIC_MARKET_DEXES = Object.freeze(["", "xyz"]);
const HYPERLIQUID_HIP3_DEXES = HYPERLIQUID_PUBLIC_MARKET_DEXES.filter(
  (dex) => dex !== ""
);

export const TAPE_EXCHANGES = Object.freeze([
  Object.freeze({
    id: PUBLIC_MARKET_EXCHANGE_BINANCE,
    label: "Binance",
    ccxtId: "binanceusdm",
    marketType: "swap",
    quoteAsset: "USDT",
  }),
  Object.freeze({
    id: PUBLIC_MARKET_EXCHANGE_OKX,
    label: "OKX",
    ccxtId: "okx",
    marketType: "swap",
    quoteAsset: "USDT",
  }),
  Object.freeze({
    id: PUBLIC_MARKET_EXCHANGE_BYBIT,
    label: "Bybit",
    ccxtId: "bybit",
    marketType: "swap",
    quoteAsset: "USDT",
  }),
  Object.freeze({
    id: PUBLIC_MARKET_EXCHANGE_BITGET,
    label: "Bitget",
    ccxtId: "bitget",
    marketType: "swap",
    quoteAsset: "USDT",
  }),
  Object.freeze({
    id: PUBLIC_MARKET_EXCHANGE_HYPERLIQUID,
    label: "HyperLiquid",
    ccxtId: "hyperliquid",
    marketType: "swap",
    quoteAsset: "USDC",
  }),
]);

const TAPE_EXCHANGE_BY_ID = new Map(
  TAPE_EXCHANGES.map((exchange) => [exchange.id, exchange])
);

const PLATFORM_ALIASES = Object.freeze({
  binance: PUBLIC_MARKET_EXCHANGE_BINANCE,
  binanceusdm: PUBLIC_MARKET_EXCHANGE_BINANCE,
  [PUBLIC_MARKET_EXCHANGE_BINANCE]: PUBLIC_MARKET_EXCHANGE_BINANCE,
  okx: PUBLIC_MARKET_EXCHANGE_OKX,
  [PUBLIC_MARKET_EXCHANGE_OKX]: PUBLIC_MARKET_EXCHANGE_OKX,
  bybit: PUBLIC_MARKET_EXCHANGE_BYBIT,
  [PUBLIC_MARKET_EXCHANGE_BYBIT]: PUBLIC_MARKET_EXCHANGE_BYBIT,
  bitget: PUBLIC_MARKET_EXCHANGE_BITGET,
  [PUBLIC_MARKET_EXCHANGE_BITGET]: PUBLIC_MARKET_EXCHANGE_BITGET,
  hyperliquid: PUBLIC_MARKET_EXCHANGE_HYPERLIQUID,
  [PUBLIC_MARKET_EXCHANGE_HYPERLIQUID]: PUBLIC_MARKET_EXCHANGE_HYPERLIQUID,
});

export function resolveTapeExchange(exchangeId) {
  if (exchangeId && typeof exchangeId === "object") {
    const id = exchangeId.id;
    if (typeof id === "string" && TAPE_EXCHANGE_BY_ID.has(id)) {
      return TAPE_EXCHANGE_BY_ID.get(id);
    }
    if (exchangeId.ccxtId) {
      tapeExchangeRuntimeConfig(exchangeId);
      return exchangeId;
    }
    throw new Error(
      `Unsupported tape exchange: ${id ?? JSON.stringify(exchangeId)}`
    );
  }
  if (typeof exchangeId !== "string" || exchangeId.trim() === "") {
    throw new Error("Tape exchange id is required");
  }
  const normalized = exchangeId.trim().toLowerCase();
  const id = PLATFORM_ALIASES[normalized];
  const exchange = id ? TAPE_EXCHANGE_BY_ID.get(id) : undefined;
  if (!exchange) {
    throw new Error(`Unsupported tape exchange: ${exchangeId}`);
  }
  return exchange;
}

export function tapeExchangeRuntimeConfig(exchange) {
  switch (exchange.ccxtId) {
    case "binanceusdm":
      return {
        ohlcvPageLimit: 1500,
        fundingPageLimit: 1000,
        requestParams: {},
      };
    case "okx":
      return {
        ohlcvPageLimit: 100,
        fundingPageLimit: 100,
        requestParams: { instType: "SWAP" },
        constructorOptions: {
          fetchMarkets: { types: ["swap"] },
        },
      };
    case "bybit":
      return {
        ohlcvPageLimit: 1000,
        fundingPageLimit: 200,
        requestParams: { category: "linear" },
      };
    case "bitget":
      return {
        ohlcvPageLimit: 1000,
        fundingPageLimit: 100,
        requestParams: { productType: "USDT-FUTURES" },
      };
    case "hyperliquid":
      return {
        ohlcvPageLimit: 5000,
        fundingPageLimit: 500,
        requestParams: {},
        constructorOptions: {
          fetchMarkets: {
            types: ["swap", "hip3"],
            hip3: { dexes: [...HYPERLIQUID_HIP3_DEXES] },
          },
        },
        unsupportedTimeframes: ["6h"],
      };
    default:
      throw new Error(`Engine Backtest 不支持 ${exchange.label ?? exchange.ccxtId} 数据源`);
  }
}
