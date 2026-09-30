---
name: alphafox-trading
description: Running strategies (traders) — create, list, start, and stop. A trader is a live or paper strategy instance (grid, dca, copy, …), not a person. Default Engine create uses autoStart true (创建即开始). Use autoStart false only when the user asks to create without starting. After create or start, include https://www.alphafox.app/zh/dashboard/traders/{traderId}.
version: 0.3.24
---

# Running strategies (traders)

Always `--format json --no-input`. Read first. Creates and updates need `trading:write`; start/stop also `trading:high-risk`.

A **trader** is a running strategy instance (paper or live). Creating a strategy means creating a trader. Bind it to a **strategy definition**, an exchange connector, and runtime settings.

Human-mentioned tickers must be resolved with `alphafox resolve-symbols` (`skills/market`) before they are written into trader config. 美股 stay `equity_perp` contracts such as `NVDA/USDT:USDT`.

Pick the create operation from the definition the operator asked for:

| Kind | Create |
|---|---|
| Engine definitions (grid, dca, …) | `trading.traders.create` |
| Hyperliquid copy | `trading.hl_copy_traders.create` |
| Rebate copy | `trading.rebate_copy_traders.create` |

Copy leads come from `trading.signal_sources.list` when the operator named one. Same trader lifecycle (list / start / stop) after create. Copy-detail header actions (只交易现有仓位 / 手动同步) use `byId.update` and `byId.actions.byAction.*` below — they are not separate create commands.

## Read

```bash
alphafox api GET /api/v1/trading/traders --format json --no-input
```

## Create

Read `alphafox schema <operationId>` first. Body may only include documented `request.body` fields. Large / nested bodies use `--config @file`.

Before executing create, follow the complete execution-parameter review in `alphafox-strategy`, including supplied configs. JSON preparation, validation and dry-run may precede approval. Reuse the confirmed proposal while parameters and environment are unchanged; obtain approval for any changed execution settings. User overrides win; resolve required values before create. Do not create merely because validation succeeded.

```bash
alphafox schema trading.traders.create --format json --no-input
alphafox trading traders create --config @./create-trader.json --dry-run --format json --no-input
alphafox trading traders create --config @./create-trader.json --yes --format json --no-input
```

`trading.traders.create` is `high-risk-write` and needs `--yes`. Copy creates follow whatever `risk` the schema reports — `--dry-run` first, then `--yes` when required.

Default Engine create is **创建即开始**: set `autoStart` to `true` in the body. Omitting `autoStart` is not the same — the server treats a missing flag as do-not-start. Use `autoStart: false` only when the operator explicitly asks to create without starting (创建但不启动 / 暂时不开始 / 先创建不要跑). Do not create-then-`byId.start` as the default path.

After a successful create (or a later start), include the trader dashboard URL from `alphafox-shared` (`https://www.alphafox.app/zh/dashboard/traders/{traderId}`).

Create `config` must include `common.execution.leverage` unless the operator chose another value. Default **10**, matching the website form. Omitting it is not 10x — Engine uses **1x**.

If a required field is missing, re-read the schema and ask the operator. Do not invent ids. The CLI has no authoring-session surface; instantiate from a definition, connector, and config.

## High-risk start / stop

Read `alphafox schema trading.traders.byId.start` first. Start body is optional Engine fields (`startType`, `enableSLTPMonitoring`, `expectedCoverageType`). `{}` is valid. Do not send `reason`.

```bash
alphafox schema trading.traders.byId.start --format json --no-input
alphafox trading traders byId start --traderId <id> --body '{}' --dry-run --format json --no-input
alphafox trading traders byId start --traderId <id> --body '{}' --yes --format json --no-input
```

Without `--yes`, CLI exits `10` with `confirmation_required`. Server still checks role/ownership.

Stop requires `closePositions` (boolean). Ask the operator whether to flatten positions. Do not default. Do not send `reason`.

```bash
alphafox schema trading.traders.byId.stop --format json --no-input
alphafox trading traders byId stop --traderId <id> --body '{"closePositions":false}' --dry-run --format json --no-input
alphafox trading traders byId stop --traderId <id> --body '{"closePositions":false}' --yes --format json --no-input
```

## Copy detail actions (跟单详情页)

Website header toggles and the same-strip sync control. Read `alphafox schema` first. Do not invent action ids or body keys.

**只交易现有仓位** is `existingPositionOnlyFollowing` on `trading.traders.byId.update`. Engine accepts it only for exchange copy definitions (`simple_copy_trading`, `copy_trading`, `reverse_copy_trading`, `rebate_copy_trading`, `hl_copy_trading`) and only while the trader is running. Read the current flag from `trading.traders.byId.get` (`data.trader.existingPositionOnlyFollowing`). Do not default the boolean — ask the operator.

```bash
alphafox schema trading.traders.byId.update --format json --no-input
alphafox trading traders byId update --traderId <id> --body '{"existingPositionOnlyFollowing":true}' --dry-run --format json --no-input
alphafox trading traders byId update --traderId <id> --body '{"existingPositionOnlyFollowing":true}' --yes --format json --no-input
```

**手动同步 / 同步仓位** is the generic runtime action `trigger_sync` (no dedicated operationId). Preview first, then run. Body is `{ "payload": { … } }`. Website default ratio is `100`. Optional copy filters (`signalSourceId`, `positionSelection`, `pnlFilter`, `directionFilter`, `positionKeys`) only when the operator asked for a custom subset — do not invent them.

```bash
alphafox schema trading.traders.byId.actions.byAction.preview --format json --no-input
alphafox trading traders byId actions byAction preview --traderId <id> --action trigger_sync --body '{"payload":{"ratioPercent":100}}' --format json --no-input
alphafox schema trading.traders.byId.actions.byAction.run --format json --no-input
alphafox trading traders byId actions byAction run --traderId <id> --action trigger_sync --body '{"payload":{"ratioPercent":100}}' --dry-run --format json --no-input
alphafox trading traders byId actions byAction run --traderId <id> --action trigger_sync --body '{"payload":{"ratioPercent":100}}' --yes --format json --no-input
```

**减仓** on the copy positions table is `--action reduce_position` with `payload.symbol`, `payload.side` (`long`|`short`), and `payload.reducePercent`. Same `byAction.run` command. Website copy detail does not offer per-position 平仓 (`dca_delete_symbol` is DCA-only).

**自动刷新** is a local website preference (no Public API). **一键分享** copies a public card/link; it does not PATCH the trader. Changing subscribed signal sources on a running copy trader uses website `signal-source-changes` — that route is not in the Public API registry, so do not call it via typed CLI or `alphafox api`.

## Recovery

- `403`: missing scope or not owner — stop, do not retry `--yes`.
- `409`: trader already in the requested state — report, do not loop start/stop.
- Unknown HTTP after a write: do not auto-retry.

## operationIds

- `trading.traders.list`
- `trading.traders.create`
- `trading.hl_copy_traders.create`
- `trading.rebate_copy_traders.create`
- `trading.signal_sources.list`
- `trading.traders.byId.get`
- `trading.traders.byId.update`
- `trading.traders.byId.start`
- `trading.traders.byId.stop`
- `trading.traders.byId.actions.byAction.preview`
- `trading.traders.byId.actions.byAction.run`
