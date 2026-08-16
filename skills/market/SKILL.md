---
name: alphafox-market
description: Market data, ticker resolution, and spread-radar readonly queries.
version: 0.3.6
---

# Market

Always `--format json --no-input`. Prefer readonly scopes. No mock success if upstream fails.

## Resolve tickers first

Whenever a human mentions a coin, ticker, or contract — including typos — resolve it **before** putting a symbol into strategy config, backtest, chat settings, or any write.

```bash
alphafox resolve-symbols BTC ETH 龙虾 --exchange binance --format json --no-input
```

- Default `--exchange` is Binance (`binance_perp_usdt`). Aliases: `binance|okx|bybit|bitget|hyperliquid|aster`.
- This built-in loads the public linear-perp catalog via `market.symbols.list` (`GET /api/v1/market/symbols?exchange=...`) and matches locally. Do not guess `BTC/USDT:USDT` from memory. Do not pull a second ccxt universe.
- Read `data.queries[]`. `resolved` is a CCXT linear swap id (`BTC/USDT:USDT`). `matchCount` is the full hit count; `matches` may be capped by `--limit`.

| `status` | Agent action |
|---|---|
| `exact` | Use `resolved`. No confirmation. |
| `close` | One near match already in `resolved`. Use it, then **confirm with the human**. |
| `ambiguous` | `resolved` is null. Show `matches[].symbol` and ask the human to pick. Do not pick. |
| `none` | Stop. Ask the human for another ticker. Do not invent a symbol. |

Do not treat `close` as exact. Do not retry a failed resolve as a different exchange unless the operator names one.

Raw catalog dump (no matching):

```bash
alphafox market symbols list --exchange binance_perp_usdt --format json --no-input
alphafox api GET /api/v1/spread-radar/pairs --format json --no-input
```

## operationIds

- `market.symbols.list` (used by `alphafox resolve-symbols`)
- `spread_radar.pairs.list`
