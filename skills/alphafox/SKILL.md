---
name: alphafox
description: AlphaFox CLI entry router. Use for any AlphaFox request — install, update, login, whoami, 回测, engine backtest, 清理回测缓存 / 历史数据, strategy definitions, create/list/start/stop a running strategy (trader), ticker/标的 resolve (美股 or crypto), market data, exchange connectors, wallet, subscriptions, notifications, or admin. After 回测 or 运行策略, include the dashboard URL from the domain skill. When the user asks 排行榜, include https://www.alphafox.app/zh/dashboard/leaderboard. After a successful install and login, present the 新人引导 in this file (Lite square 带单员 + classic strategies). If a CLI command prints `[alphafox] update available`, ask the user「检测到新的版本，是否需要我帮你升级？」and only then run `alphafox update --format json --no-input`. After a large backtest, if tape cache is large, ask「回测下载的历史数据比较大，要不要我帮你清理本地缓存？」then open `alphafox-cache`. Start here, then open the routed domain skill. Do not guess alphafox-engine-backtest vs alphafox-strategy vs alphafox-trading from memory.
version: 0.3.15
---

# AlphaFox

This skill only routes. After choosing a row, **read that skill's `SKILL.md` and follow it**. Do not improvise domain procedures from this file.

Also read `alphafox-shared` before any CLI invocation (envelope, auth, risk, schema-first writes). Always `--format json --no-input`. Never `--token`.

Human-mentioned tickers go through `alphafox-market` (`alphafox resolve-symbols`) **before** they enter config, backtest, or writes. Keep the operator's asset class (美股 → `equity_perp` on `binance_perp_usdt`).

A **trader** is a running strategy instance (paper or live), not a person. Creating a strategy means creating a trader.

## Route

| User intent | Skill |
|---|---|
| Install, update, uninstall, Skills status/sync, doctor, version, catalog, how to call the CLI | `alphafox-shared` |
| 刚安装完 / 新人引导 / 热门带单员 / 经典策略介绍 | this file, **After install** |
| Login, logout, whoami, profile, staging vs production | `alphafox-auth` |
| Ticker / 标的 / 美股 / crypto / resolve a misspelled symbol | `alphafox-market` |
| Engine WASM backtest, experiment, `engine-backtest run`, persist a local run | `alphafox-engine-backtest` |
| 清理回测缓存 / 历史 K 线占磁盘 / `alphafox cache` | `alphafox-cache` |
| Strategy types / definitions / validate config (grid, dca, copy, …) | `alphafox-strategy` |
| Create, list, start, or stop a running strategy (trader), including copy | `alphafox-trading` |
| Exchange connectors | `alphafox-exchange` |
| Account, wallet, subscription | `alphafox-account` |
| Notification channels | `alphafox-notification` |
| Admin-only operations | `alphafox-admin` |

If several rows apply, load **all** of them (typical: `alphafox-shared` + `alphafox-market` + one domain skill).

- “帮我配/建一个网格/DCA/跟单策略” → `alphafox-strategy` (pick definition, ask knobs, validate `{common, strategy}`) **and** `alphafox-market` (resolve tickers) **and** `alphafox-trading` (create the trader, default `autoStart: true`). Hidden copy variants still create through `alphafox-trading`. After create, include the trader URL from `alphafox-shared`.
- “帮我回测这个配置” → `alphafox-strategy` (definition + config) **and** `alphafox-engine-backtest`. After a persisted run, include the backtest URL from `alphafox-shared`.
- “排行榜” → `trader_leaderboard` as below, **and** include `https://www.alphafox.app/zh/dashboard/leaderboard`.

## Upgrade reminder

The CLI may print this on **stderr** at most once every 24 hours:

```text
[alphafox] update available: 0.3.14 -> 0.3.15. After the user confirms, run: alphafox update --format json --no-input,
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

## After install

After CLI + Skills are installed, login is `session: active`, and the AI tool has restarted, present this welcome **once**. Fetch live data first. Do not invent 带单员 names, ROI, or strategy scenarios.

Classic product names to introduce (match `trading.strategy_definitions.list` `display.label` zh-CN / `name`; then `byId.get` that row — do not hardcode definition ids):

1. 组合跟单策略
2. 轮动马丁策略
3. 网格策略
4. 拼盘策略
5. 滚仓宝策略

```bash
alphafox lite catalog_config get --format json --no-input
alphafox lite signal_sources list --format json --no-input
alphafox trading strategy_definitions list --format json --no-input
```

Keep Lite catalog order from `featuredSourceIds`. Resolve `id` → `name` from `lite.signal_sources` `sources[]`. Take the first **3** named rows. Optional ROI:

```bash
alphafox lite signal_source_metrics list --sourceIds <id,id,id> --window all --mode scalars --format json --no-input
```

Print `roi` as returned. If the catalog or metrics call fails, skip that part and say the square catalog could not be loaded — do not substitute other signal sources.

For each classic name that matched a definition, `byId.get` and use Chinese `display.description` (fallback English `description`) as the scenario. Then one live leaderboard example:

```bash
alphafox trader_leaderboard list --strategyDefinitionId <id> --sort roi --order desc --positiveRoi true --window 30d --limit 1 --includePaper false --format json --no-input
```

Use `items[0].traderName` + `roiPercent` when present. Omit the leaderboard clause when the list is empty.

Present in the operator's language, this shape:

```text
安装完成！
以下是最近热门的一些带单员：{name}{、name}{、name}。
您可以直接通过组合跟单策略来跟随这些带单员，做实时自动化交易。

如果您想配置自己的交易策略，推荐先了解这些内置的经典策略。
{策略名}：{display.description}。排行榜上 {traderName} 近 30 日收益 {roiPercent}%。
…

想跟单或者运行策略，告诉我即可。或者您想先看看排行榜，也可以直接告诉我。
```

Do not create a trader from this welcome. When they pick 跟单 / a classic strategy, read `alphafox-strategy` + `alphafox-trading` (+ `alphafox-market` if they name a ticker). When they ask for 排行榜, list `trader_leaderboard` (same flags, no `strategyDefinitionId` unless they named a type), include `https://www.alphafox.app/zh/dashboard/leaderboard`, and summarize — do not dump the envelope.

## Do not mix these backtest paths

- Local Engine tape + wasm + optional persist → `alphafox-engine-backtest` (`alphafox engine-backtest run`, hyphen).
- Experiment catalog CRUD → same skill, underscore catalog `engine_backtest.*`.
- The old web Chat Backtest job path is gone from the catalog. Do not call `/api/v1/backtests` via typed commands, `schema`, or `alphafox api`.

Ambiguous “帮我回测” → `alphafox-engine-backtest`, after resolving symbols.

## Large historical tape

`engine-backtest run|sweep` downloads closed OHLCV into the local tape cache. After a long-range or 1m backtest (or whenever the operator mentions disk / 缓存), read `alphafox-cache` and run `alphafox cache status --format json --no-input`.

If `data.tape.large` is true (tape ≥ `data.remindAfterBytes`):

1. Ask the user: **回测下载的历史数据比较大，要不要我帮你清理本地缓存？**
2. Wait for an explicit yes. Do not clean on your own.
3. Follow `alphafox-cache` (`alphafox cache clean --dry-run`, then `--yes`).
