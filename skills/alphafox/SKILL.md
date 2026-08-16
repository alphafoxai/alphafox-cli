---
name: alphafox
description: Alphafox CLI entry router. Use for any Alphafox request — install, login, whoami, 回测, engine backtest, strategy chat, traders, ticker/标的 resolve, market data, exchange connectors, wallet, subscriptions, notifications, or admin. Start here, then open the routed domain skill. Do not guess alphafox-engine-backtest vs alphafox-strategy from memory.
version: 0.3.4
---

# Alphafox

This skill only routes. After choosing a row, **read that skill's `SKILL.md` and follow it**. Do not improvise domain procedures from this file.

Also read `alphafox-shared` before any CLI invocation (envelope, auth, risk, schema-first writes). Always `--format json --no-input`. Never `--token`.

Human-mentioned tickers go through `alphafox-market` (`alphafox resolve-symbols`) **before** they enter config, backtest, or writes.

## Route

| User intent | Skill |
|---|---|
| Install, doctor, version, catalog, how to call the CLI | `alphafox-shared` |
| Login, logout, whoami, profile, staging vs production | `alphafox-auth` |
| Coin / ticker / 标的 / `BTC/USDT:USDT` / resolve a misspelled symbol | `alphafox-market` |
| Engine WASM backtest, experiment, `engine-backtest run`, persist a local run | `alphafox-engine-backtest` |
| Strategy chat, compiled strategy | `alphafox-strategy` |
| List / start / stop traders | `alphafox-trading` |
| Exchange connectors | `alphafox-exchange` |
| Account, wallet, subscription | `alphafox-account` |
| Notification channels | `alphafox-notification` |
| Admin-only operations | `alphafox-admin` |

If several rows apply, load **all** of them (typical: `alphafox-shared` + `alphafox-market` + one domain skill).

## Do not mix these backtest paths

- Local Engine tape + wasm + optional persist → `alphafox-engine-backtest` (`alphafox engine-backtest run`, hyphen).
- Experiment catalog CRUD → same skill, underscore catalog `engine_backtest.*`.
- Chat-attached `/api/v1/backtests` (`backtests.*`) is **not** a CLI surface. Do not call it via typed commands, `schema`, or `alphafox api`.

Ambiguous “帮我回测” → `alphafox-engine-backtest`, after resolving symbols.
