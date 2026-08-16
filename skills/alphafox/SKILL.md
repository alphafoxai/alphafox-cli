---
name: alphafox
description: AlphaFox CLI entry router. Use for any AlphaFox request — install, update, login, whoami, 回测, engine backtest, strategy definitions, create/list/start/stop a running strategy (trader), ticker/标的 resolve (美股 or crypto), market data, exchange connectors, wallet, subscriptions, notifications, or admin. If a CLI command prints `[alphafox] update available`, ask the user「检测到新的版本，是否需要我帮你升级？」and only then run `alphafox update --format json --no-input`. Start here, then open the routed domain skill. Do not guess alphafox-engine-backtest vs alphafox-strategy vs alphafox-trading from memory.
version: 0.3.8
---

# AlphaFox

This skill only routes. After choosing a row, **read that skill's `SKILL.md` and follow it**. Do not improvise domain procedures from this file.

Also read `alphafox-shared` before any CLI invocation (envelope, auth, risk, schema-first writes). Always `--format json --no-input`. Never `--token`.

Human-mentioned tickers go through `alphafox-market` (`alphafox resolve-symbols`) **before** they enter config, backtest, or writes. Keep the operator's asset class (美股 → `equity_perp` on `binance_perp_usdt`).

A **trader** is a running strategy instance (paper or live), not a person. Creating a strategy means creating a trader.

## Route

| User intent | Skill |
|---|---|
| Install, update, Skills status/sync, doctor, version, catalog, how to call the CLI | `alphafox-shared` |
| Login, logout, whoami, profile, staging vs production | `alphafox-auth` |
| Ticker / 标的 / 美股 / crypto / resolve a misspelled symbol | `alphafox-market` |
| Engine WASM backtest, experiment, `engine-backtest run`, persist a local run | `alphafox-engine-backtest` |
| Strategy types / definitions / validate config (grid, dca, copy, …) | `alphafox-strategy` |
| Create, list, start, or stop a running strategy (trader), including copy | `alphafox-trading` |
| Exchange connectors | `alphafox-exchange` |
| Account, wallet, subscription | `alphafox-account` |
| Notification channels | `alphafox-notification` |
| Admin-only operations | `alphafox-admin` |

If several rows apply, load **all** of them (typical: `alphafox-shared` + `alphafox-market` + one domain skill). “帮我建一个网格/DCA/跟单策略” → `alphafox-strategy` (pick the definition) **and** `alphafox-trading` (create the trader).

## Upgrade reminder

The CLI may print this on **stderr** at most once every 24 hours:

```text
[alphafox] update available: 0.3.7 -> 0.3.8. After the user confirms, run: alphafox update --format json --no-input,
```

If you see that notice (or `updateAvailable: true` from `alphafox update --check`):

1. Ask the user: **检测到新的版本，是否需要我帮你升级？**
2. Wait for an explicit yes. Do not upgrade on your own.
3. After they confirm:

```bash
alphafox update --format json --no-input
```

4. Tell the user to **restart the AI tool** so the new Skills load.

Do not install Skills from GitHub. Details and dry-run / check commands live in `alphafox-shared`.

## Do not mix these backtest paths

- Local Engine tape + wasm + optional persist → `alphafox-engine-backtest` (`alphafox engine-backtest run`, hyphen).
- Experiment catalog CRUD → same skill, underscore catalog `engine_backtest.*`.
- Web `/api/v1/backtests` (`backtests.*`) is **not** a CLI surface. Do not call it via typed commands, `schema`, or `alphafox api`.

Ambiguous “帮我回测” → `alphafox-engine-backtest`, after resolving symbols.
