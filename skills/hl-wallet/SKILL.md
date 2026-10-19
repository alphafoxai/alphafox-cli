---
name: alphafox-hl-wallet
description: Read-only Hyperliquid wallet history for one address — PnL and fills by day and coin, USDC equity curve with net PnL and external flows, ledger movements, positions at the latest snapshot, orders and round trips. Use when the user gives a 0x Hyperliquid address or asks how a Hyperliquid wallet / 钱包 / 交易员 traded, earned, or what it holds.
version: 0.3.24
---

# Hyperliquid wallet history

Always `--format json --no-input`. Every call is a read; there is no write and no trading in this Skill. Analyzing a wallet never implies copying it — copy trading goes through `alphafox-trading` with its own approval.

Access is admin-only while the history backfill is in progress. A `403` with `forbidden` means the signed-in account is not an admin: say so and stop. Do not retry with another profile unless the operator asks.

## Inputs

- `--address`: a full Hyperliquid address, lowercase `0x` + 40 hex. Lowercase what the operator pasted; ask for the full address if it is shortened (`0x0a50…956a`). Do not guess one from a name.
- `--range`: `7d | 30d | 90d | 180d | 365d` (default `30d`). The window ends at the next UTC midnight, so it includes today, which is still incomplete.
- Data is daily history (T+1), not live. For a live view, say the latest snapshot time instead of calling it current.

## Calls

```bash
alphafox hl_wallet summary get --address 0x… --range 30d --format json --no-input
alphafox hl_wallet equity get --address 0x… --range 90d --format json --no-input
alphafox hl_wallet ledger get --address 0x… --range 90d --format json --no-input
alphafox hl_wallet positions get --address 0x… --format json --no-input
alphafox hl_wallet activity get --address 0x… --end 2026-10-17 --days 7 --format json --no-input
```

| Question | Call | Read |
|---|---|---|
| PnL, fees, volume by day or coin; win/loss fills | `summary` (`--assetClass perp\|spot` optional) | `days[]`, `coins[]` |
| Equity curve, net PnL, drawdown, deposits/withdrawals | `equity` | `points[]`, `intervals[]`, `totals` |
| Deposits, withdrawals, transfers, vault moves | `ledger` | `categories[]` (whole range), `rows[]` (newest 500) |
| What it holds | `positions` | `perp[]`, `spot[]`, `dexes[]`, `snapshot_time` |
| Orders and position round trips | `activity` (`--end` UTC day ≤ today, `--days 1\|3\|7`) | `orders[]`, `roundTrips[]` |

Start with `summary` + `equity` for "how did this wallet do". Add the others only when the question needs them.

## Coverage first

Every response carries `status` (`ok | partial`) and `coverage` (one day list per status; `equity` and `positions` have one per source). Read them before any number.

- Days listed under `missing`, `waiting` or `error` are not available; days under `partial` or `provisional` are not final. Report the result as partial and name those dates. Never treat a missing day as zero activity or zero PnL.
- `status` is `partial` whenever the source is incomplete anywhere, including days outside the window that are still being backfilled, or when `coverage.stale` is `true`. If every day of the window is in `applied` and the other lists are empty, the window's figures are final: say the window is fully covered, and add that the data may lag when `stale` is `true`.
- In `summary`, a day absent from `days[]` had no fills **only** if `coverage.applied` lists it. Otherwise its activity is unknown.
- In `equity`, points are snapshots, not days. A day without a snapshot is a gap; the next interval spans it and its net PnL is still computed from the snapshots on either side. `intervals[].complete: false` means a component (fills or ledger) may be missing for that interval; count them from `totals.incomplete_intervals`.
- Some upstream days were never published and stay missing. Say "no data for these dates", not "the wallet was inactive".

## Metric definitions

Use these definitions; do not compute PnL any other way.

- **Net PnL** = `equity_change − external_flow − spot_cash_flow` (per interval; `totals.net_pnl` for the range). Deposits, withdrawals and transfers are flows, not profit.
- **Attribution**: `realized_pnl − fees_usdc + funding + ledger_pnl + unrealized_change`. Report `unexplained` as its own number; never fold it into a component.
- **Equity** is USDC equity. Spot tokens other than USDC are not priced (their `entry_value` is cost). In `portfolio_margin` mode `equity_usdc` can be negative; `pm_total_account_value` is the venue total.
- **Drawdown**: compute it from cumulative net PnL (the running sum of `intervals[].net_pnl`), not from raw equity, which deposits and withdrawals move. Say that this is the method.
- **Volume**: `notional` sums this account's fills in each market's quote units, so it is one side of each trade. Summed across wallets it double-counts trades between them; do not present it as market volume.
- `profitable_closes` / `losing_closes` count fills with a positive or negative realized PnL, not round trips. For win rate by trade, use `activity.roundTrips[]` with `status: closed`, and say how many were `open` or `carried_in`.
- Decimals are strings. Keep their precision; round only for display. Snapshot values may use exponent form (`1e-8`).

A wallet is an account, not a person: similar behavior does not prove the same owner, and the data excludes positions held elsewhere.

## Errors

A failed call prints `ok: false` with `error.status` and `error.message`. Act on the status:

| `status` | Meaning | Action |
|---|---|---|
| `400` | Bad address, range, `end` or `days` | Fix the input; do not loop |
| `403` | Not an admin | Stop and say so |
| `409` | History was republished during the query | Retry once |
| `422` | The wallet is too active for this window | Use a shorter `--range` or fewer `--days` |
| `429`, or `503` with "busy" | Too many requests | Wait about a minute, then retry once |
| `502`, `503`, `504` | Service unavailable or timed out | Report it with `requestId`. A `504` may succeed on a shorter range. Do not substitute other data |

`truncated` flags (`coins_truncated`, ledger `truncated`, activity `truncated` / `ordersTruncated` / `roundTripsTruncated`) mean a list was capped. Say so; range totals in `categories` and `totals` still cover the whole range.

## Report

Lead with the window, `status`, and any missing or partial dates. Then net PnL with its attribution, external flows, fees and funding, and the top coins. Give exact figures from the response, and say which call each one came from. End with the web view:

`https://www.alphafox.app/zh/dashboard/tools/hl-wallet?address={address}&range={range}`

`--profile staging` → host `https://staging.alphafox.app`.

## operationIds

- `hl_wallet.summary.get`
- `hl_wallet.equity.get`
- `hl_wallet.ledger.get`
- `hl_wallet.positions.get`
- `hl_wallet.activity.get`
