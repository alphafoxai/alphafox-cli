export const RESOLVE_SYMBOLS_DEFAULT_EXCHANGE = "binance_perp_usdt";

export interface ResolveSymbolsExchange {
  readonly id: string;
  readonly label: string;
  readonly aliases: readonly string[];
}

export const RESOLVE_SYMBOLS_EXCHANGES: readonly ResolveSymbolsExchange[] = [
  {
    id: "binance_perp_usdt",
    label: "Binance",
    aliases: ["binance", "binanceusdm", "binance_perp_usdt"],
  },
  {
    id: "okx_perp_usdt",
    label: "OKX",
    aliases: ["okx", "okx_perp_usdt"],
  },
  {
    id: "bybit_perp_usdt",
    label: "Bybit",
    aliases: ["bybit", "bybit_perp_usdt"],
  },
  {
    id: "bitget_perp_usdt",
    label: "Bitget",
    aliases: ["bitget", "bitget_perp_usdt"],
  },
  {
    id: "hyperliquid_perp_usdc",
    label: "HyperLiquid",
    aliases: ["hyperliquid", "hyperliquid_perp_usdc"],
  },
  {
    id: "aster_perp_usdt",
    label: "Aster",
    aliases: ["aster", "aster_perp_usdt"],
  },
];

const EXCHANGE_BY_ALIAS = new Map<string, ResolveSymbolsExchange>();
for (const exchange of RESOLVE_SYMBOLS_EXCHANGES) {
  EXCHANGE_BY_ALIAS.set(exchange.id, exchange);
  for (const alias of exchange.aliases) {
    EXCHANGE_BY_ALIAS.set(alias.toLowerCase(), exchange);
  }
}

export function resolveSymbolsExchangeId(raw: string): ResolveSymbolsExchange {
  const key = raw.trim().toLowerCase();
  const exchange = EXCHANGE_BY_ALIAS.get(key);
  if (!exchange) {
    const allowed = RESOLVE_SYMBOLS_EXCHANGES.map((item) => item.aliases[0]).join(
      "|"
    );
    throw new Error(
      `--exchange must be ${allowed} (got ${raw.trim() || "<empty>"})`
    );
  }
  return exchange;
}
