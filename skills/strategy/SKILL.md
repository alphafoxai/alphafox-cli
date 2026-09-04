---
name: alphafox-strategy
description: Strategy definitions — list types, read a definition's contract, and validate config. Creating a running strategy is creating a trader; use alphafox-trading for that. Local Engine backtest is alphafox-engine-backtest.
version: 0.3.22
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
4. The effective `configSchema`, including composed common modules, strategy parameters, defaults, constraints, conditional branches, and each field's `display`
5. `capabilities.actionDefinitions` (what a manual action changes)

Explain the type from those fields. Missing a layer → say unknown; do not fill from memory. Decision logic (`simple-long`, grid `mode` `neutral`/`long`/`short`) is an internal parameter, not a new definition id.

## Configure with the human

The human confirms the complete parameter set. You write JSON only after that review.

1. Confirm the definition from `byId.get` in the operator's language (what it is, what drives it, how positions change).
2. Use the effective `configSchema` returned by `byId.get` as the sole parameter contract. It already composes the definition's `commonModules` with `strategyConfigSchema` and may contain definition-specific customization. Walk every applicable parameter, not only required fields or familiar knobs.
3. Resolve conditional schemas in dependency order. Ask for a discriminator or enable/disable choice first, then enumerate every parameter in the selected branch. Do not present inactive branch fields as active settings. For arrays or maps, explain the collection and confirm every field of each configured item.
4. Build a grouped or numbered review table in the operator's language. Every applicable parameter must have:

   - full JSON path;
   - short explanation from localized `display.description`, falling back to the schema's description; if neither exists, say the definition provides no explanation — do not guess;
   - type plus enum, range, or other relevant constraints;
   - default status and source;
   - proposed value and value source.

5. Determine the proposed value in this precedence order:

   1. **user override** — any value the operator explicitly supplied, including values already present in a provided config;
   2. **schema default** — the field's JSON Schema `default`;
   3. **product default** — only a default explicitly documented by this skill or the live product contract. Currently `common.execution.leverage` is `10`, matching the website form; raw Engine omission means 1x;
   4. **no default** — required fields remain unresolved and must be answered; optional fields are proposed as “不设置 / omit”. Do not guess a value or describe omission as a default.

   A user override always wins, even when it equals neither default. Preserve explicit `false`, `0`, empty arrays, and empty strings when the schema allows them; they are not missing values.

6. When there are many parameters, present them in logical groups or numbered chunks so the review remains readable. After all groups are visible, ask the operator to reply **confirm all** / “全部确认”, or override paths/numbers. One overall confirmation is sufficient, but it must cover every displayed parameter. Apply overrides, show the affected rows again, and repeat until no required value is unresolved and the operator explicitly confirms the final proposal.
7. An earlier request such as “创建策略”, “运行回测”, or a pasted command/config is input to the proposal, not confirmation of the review. Do not validate, create, or backtest until the complete parameter review is explicitly confirmed.
8. Write `strategy-config.json` as the trader object:

```json
{
  "common": {},
  "strategy": {}
}
```

`common` is shared risk / SLTP / execution / market. `strategy` is this type's parameters and decision logic. Do not use top-level `settings`, `policyId`, or `policyParams`. `configSchemaVersion` comes from the definition (`byId.get` / list); keep it off this file.

9. Keys and enums come from the definition schema, not from this skill. Do not ship a default `grid.json` / `dca.json`. Reuse this source file for `engine-backtest --config` and as `trading.traders.create` `config`.

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
