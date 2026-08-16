---
name: alphafox-strategy
description: Strategy definitions and chats via public operationIds.
version: 0.3.4
---

# Strategy / Chat

Always `--format json --no-input`. Read scopes `trading:read`; writes `chats:write`.

Whenever the human names a coin or ticker, resolve it with `alphafox resolve-symbols` (`skills/market`) before writing strategy config or symbols arrays. Exact matches may be used; a single close match needs confirmation; multiple close matches must be chosen by the human.

## Read

```bash
alphafox schema trading.strategy_definitions.list --format json --no-input
alphafox api GET /api/v1/trading/strategy-definitions --format json --no-input
```

## Write (ordinary)

Read `request.body` first. Do not invent chat or strategy fields.

```bash
alphafox schema chats.create --format json --no-input
alphafox chats create --body '{"strategyGenerationMode":"simple"}' --format json --no-input
# large / nested bodies:
# alphafox chats create --config @./create-chat.json --format json --no-input
```

Requires auth. Sends `Idempotency-Key` when available. Duplicate key → `409`; do not invent a new key unless the operator asks to create another chat.

Engine strategy backtest (WASM tape + persist) is `skills/engine-backtest` (`alphafox engine-backtest run`). Chat-attached `/api/v1/backtests` (`backtests.*`) is not a CLI surface — do not call it.

## operationIds

- `trading.strategy_definitions.list`
- `chats.create`
