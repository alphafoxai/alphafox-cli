---
name: alphafox-strategy
description: Strategy definitions — list types, read a definition's contract, and validate config. Creating a running strategy is creating a trader; use alphafox-trading for that. Local Engine backtest is alphafox-engine-backtest.
version: 0.3.17
---

# Strategy definitions

Always `--format json --no-input`. Read scopes `trading:read`; validate is `trading:write`.

A **definition** is a strategy type. A **trader** is one running instance. Instantiating is `alphafox-trading`. Local wasm backtest is `alphafox-engine-backtest`. This skill only discovers types and checks config.

Human-named tickers go through `alphafox resolve-symbols` (`skills/market`) before they enter a config you later validate or hand to create. 美股 are equity perps in `binance_perp_usdt` (`NVDA/USDT:USDT`, `assetClass=equity_perp`).

Do not enumerate engine strategy IDs in this file. Pick the definition from `list` / `byId.get`. Do not add a wizard command. Do not invent a second catalog.

## Discover

`trading.strategy_definitions.list` returns **active** rows only. Hidden types (including Hyperliquid / rebate copy) are absent from list; `byId.get` and `validate_config` still work when the operator named that id. Creation of those copy variants is `alphafox-trading` (`trading.hl_copy_traders.create` / `trading.rebate_copy_traders.create`).

```bash
alphafox schema trading.strategy_definitions.list --format json --no-input
alphafox api GET /api/v1/trading/strategy-definitions --format json --no-input
alphafox trading strategy_definitions byId get --definitionId <id> --format json --no-input
```

Match the name the operator used against list `id` / `name` / `display`. If they already gave an id that list omitted, `byId.get` that id. Copy / DCA / grid are catalog rows, not separate products.

`byId.get` is the operator model. Read, in order:

1. `id`, `category` (`COPY` / `DCA` / `GRID` / `TREND` / `OTHERS`), `status`
2. English `description` (mechanism). Prefer it over marketing `display.description`
3. `capabilities` and `commonModules` (event-driven vs polling, signal sources, manual sync)
4. `strategyConfigSchema` required fields and each field's `display` — including decision-logic enums inside this definition
5. `capabilities.actionDefinitions` (what a manual action changes)

Explain the type from those fields. Missing a layer → say unknown; do not fill from memory. Decision logic (`simple-long`, grid `mode` `neutral`/`long`/`short`) is an internal parameter, not a new definition id.

## Configure with the human

The human answers knobs. You write JSON.

1. Confirm the definition from `byId.get` in the operator's language (what it is, what drives it, how positions change).
2. From `strategyConfigSchema` plus common required fields, ask **only** values the human must choose: symbols (resolve first), direction / mode, size, signal source, leverage. Do not walk every optional key. If the operator does not pick leverage, write `common.execution.leverage: 10` (website form default). Omitting the field is not the same — Engine treats a missing leverage as **1x**.
3. Write `strategy-config.json` as the trader object:

```json
{
  "common": {},
  "strategy": {}
}
```

`common` is shared risk / SLTP / execution / market. `strategy` is this type's parameters and decision logic. Do not use top-level `settings`, `policyId`, or `policyParams`. `configSchemaVersion` comes from the definition (`byId.get` / list); keep it off this file.

4. Keys and enums come from the definition schema, not from this skill. Do not ship a default `grid.json` / `dca.json`. Reuse this source file for `engine-backtest --config` and as `trading.traders.create` `config`.

## Validate config

Read `alphafox schema trading.strategy_definitions.byId.validate_config` first. Catalog `request.body` may look like a free `JsonObject`; still send the HTTP envelope, wrapping the source file — do not overwrite `strategy-config.json`:

```json
{
  "configSchemaVersion": 4,
  "config": { "common": {}, "strategy": {} }
}
```

`config` is the contents of `strategy-config.json`. `configSchemaVersion` must match the definition.

```bash
alphafox trading strategy_definitions byId validate_config --definitionId <id> --config @./validate-config.json --format json --no-input
```

`body_schema` / `body_schema_missing` (exit `64`): re-read the operation schema. Server field-path errors: fix that path. Do not retry with a different envelope.

After it validates: create with `alphafox-trading` (default `autoStart: true`), or backtest with `alphafox-engine-backtest`. Do not create or backtest from this skill. Dashboard URLs after those actions live in `alphafox-shared`.

## operationIds

- `trading.strategy_definitions.list`
- `trading.strategy_definitions.byId.get`
- `trading.strategy_definitions.byId.validate_config`
