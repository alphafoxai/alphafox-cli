---
name: alphafox-strategy
description: Strategy definitions, chats, and backtests via public operationIds.
version: 0.1.0
---

# Strategy / Chat / Backtest

## Read

```bash
alphafox schema trading.strategy_definitions.list
alphafox api GET /api/v1/trading/strategy-definitions
```

## Write (ordinary)

```bash
alphafox api POST /api/v1/chats --body '{"strategyGenerationMode":"simple"}'
```

Requires auth. Sends `Idempotency-Key` when available.

## Long-running backtest

```bash
alphafox api POST /api/v1/backtests --body '{...}'
alphafox api GET /api/v1/backtests/{backtestId}
alphafox api GET /api/v1/backtests/{backtestId}/stream
alphafox api POST /api/v1/backtests/{backtestId}/cancel --body '{}'
```

## operationIds

- `trading.strategy_definitions.list`
- `chats.create`
- `backtests.create` / `backtests.byId.get` / `backtests.byId.stream` / `backtests.byId.cancel`
