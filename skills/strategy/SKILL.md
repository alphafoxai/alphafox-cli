---
name: alphafox-strategy
description: Strategy definitions — list types (grid, dca, copy, …) and validate config. Creating a running strategy is creating a trader; use alphafox-trading for that.
version: 0.3.10
---

# Strategy definitions

Always `--format json --no-input`. Read scopes `trading:read`; validate is `trading:write`.

A **definition** is a strategy type (grid, dca, copy, …). A **trader** is one running instance of a definition. Instantiating a definition is `alphafox-trading`, not this skill.

Whenever the human names a ticker (US stock, coin, or contract), resolve it with `alphafox resolve-symbols` (`skills/market`) before writing symbols into a config you later validate or hand to create. 美股 are equity perps in `binance_perp_usdt` (`NVDA/USDT:USDT`, `assetClass=equity_perp`) — do not swap them for a crypto coin.

## Read

```bash
alphafox schema trading.strategy_definitions.list --format json --no-input
alphafox api GET /api/v1/trading/strategy-definitions --format json --no-input
alphafox trading strategy_definitions byId get --definitionId <id> --format json --no-input
```

Use the list to pick the definition the operator named. Copy / rebate-copy / DCA / grid are rows in this catalog, not a separate product.

## Validate config

Read `request.body` first. Do not invent definition or config fields.

```bash
alphafox schema trading.strategy_definitions.byId.validate_config --format json --no-input
alphafox trading strategy_definitions byId validate_config --definitionId <id> --config @./strategy-config.json --format json --no-input
```

After the config validates, create the running instance with `alphafox-trading`.

## operationIds

- `trading.strategy_definitions.list`
- `trading.strategy_definitions.byId.get`
- `trading.strategy_definitions.byId.validate_config`
