---
name: alphafox-strategy
description: Strategy definitions, chats, and backtests via public operationIds.
version: 0.1.5
---

# Strategy / Chat / Backtest

Always `--format json --no-input`. Read scopes `trading:read` / `backtests:read`; writes `chats:write` / `backtests:write`.

## Read

```bash
alphafox schema trading.strategy_definitions.list --format json --no-input
alphafox api GET /api/v1/trading/strategy-definitions --format json --no-input
```

## Write (ordinary)

```bash
alphafox api POST /api/v1/chats --body '{"strategyGenerationMode":"simple"}' --format json --no-input
```

Requires auth. Sends `Idempotency-Key` when available. Duplicate key → `409`; do not invent a new key unless the operator asks to create another chat.

## Long-running backtest

```bash
alphafox api POST /api/v1/backtests --body '{...}' --format json --no-input
alphafox api GET /api/v1/backtests/{backtestId} --format json --no-input
alphafox api GET /api/v1/backtests/{backtestId}/stream --format jsonl --no-input
alphafox api POST /api/v1/backtests/{backtestId}/cancel --body '{}' --format json --no-input
```

If the stream drops, `GET` the backtest by id — do not assume success. Cancel is explicit; interruption must remain queryable.

## operationIds

- `trading.strategy_definitions.list`
- `chats.create`
- `backtests.create` / `backtests.byId.get` / `backtests.byId.stream` / `backtests.byId.cancel`
