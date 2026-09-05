---
name: alphafox-market
description: Market data and ticker resolution for US equity perps, RWAs, and crypto on the same perp catalog. Use when the user names 美股, NVDA, AAPL, BTC, or any 标的. Keep the operator's asset class via symbolMetadata — do not rewrite NVDA into a crypto coin.
version: 0.3.22
---

# Market

Always `--format json --no-input`. Prefer readonly scopes. No mock success if upstream fails.

## Asset class first

Binance US stocks are **equity perps in the same** `binance_perp_usdt` catalog (`NVDA/USDT:USDT`). They are not a second exchange. `symbolMetadata` tags them:

| Tag | Meaning |
|---|---|
| `assetClass: "equity_perp"` and `isTradFiRwa: true` | US stock perp (NVDA, AAPL, TSLA) |
| `assetClass: "rwa_perp"` and `isTradFiRwa: true` | TradFi RWA perp (XAU, XAG) |
| untagged / not TradFi | Crypto perp (BTC, ETH) |

| Operator said | Resolve with |
|---|---|
| 美股 / US stocks / 持仓 / NVDA the company | `--exchange binance --asset-class equity_perp` |
| 黄金 / 白银 / RWA | `--exchange binance --asset-class rwa_perp` |
| BTC / ETH / 加密永续 | `--exchange binance` or `--asset-class crypto` |

`NVDA/USDT:USDT` with `equity_perp` **is** the US stock product. Do not replace it with a different crypto base.

## Resolve tickers

Resolve a human-mentioned ticker before using it in config, backtest or a write. Reuse an exact/confirmed result for the same exchange, asset class and catalog within this task; resolve again when any of those inputs changes or the result is rejected. Mere discussion of a ticker does not require a market API call.

```bash
alphafox resolve-symbols BTC ETH --exchange binance --format json --no-input
alphafox resolve-symbols NVDA AAPL TSLA --exchange binance --asset-class equity_perp --format json --no-input
```

- Default `--exchange` is Binance (`binance_perp_usdt`). Aliases: `binance|okx|bybit|bitget|hyperliquid|aster`.
- This built-in loads `GET /api/v1/market/symbols?exchange=...` (includes `symbolMetadata`) and matches locally. Do not invent a symbol from memory. Do not pull a second ccxt universe.
- Read `data.queries[]`. `resolved` is a catalog id such as `NVDA/USDT:USDT` or `BTC/USDT:USDT`. Also read `assetClass` and `isTradFiRwa` on the query and on `matches[]`.
- `matchCount` is the full hit count; `matches` may be capped by `--limit`.

| `status` | Agent action |
|---|---|
| `exact` | Use `resolved` when `assetClass` matches the operator (美股 → `equity_perp`). |
| `close` | One near match already in `resolved`. Confirm with the human, and confirm the asset class. |
| `ambiguous` | `resolved` is null. Show `matches[].symbol` plus `assetClass` and ask the human to pick. Do not pick. |
| `none` | Stop. Ask for another ticker. Do not invent a symbol and do not swap in a crypto coin. |

Do not treat `close` as exact. Do not retry a failed equity resolve as a different crypto base.

Raw catalog dump (no matching):

```bash
alphafox market symbols list --exchange binance_perp_usdt --format json --no-input
alphafox api GET /api/v1/spread-radar/pairs --format json --no-input
```

## operationIds

- `market.symbols.list` (used by `alphafox resolve-symbols`)
- `spread_radar.pairs.list`
