---
name: alphafox-strategy
description: Strategy definitions, chats, and backtests via public operationIds.
version: 0.2.0
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
alphafox api POST /api/v1/backtests --body '{"chatId":"<chat-id>"}' --format json --no-input
alphafox api GET /api/v1/backtests/{backtestId} --format json --no-input
alphafox api GET /api/v1/backtests/{backtestId}/stream --format jsonl --no-input
alphafox api POST /api/v1/backtests/{backtestId}/cancel --body '{}' --format json --no-input
```

`backtests.create` requires `chatId`. `strategyId` is optional: the facade resolves a compiled strategy on that chat. A chat with no compiled strategy returns `CHAT_HAS_NO_COMPILED_STRATEGY` (not `JOB_NOT_FOUND`). Optional `backtestSettings` overlays chat settings when it is a settingsJson object.

If the stream drops, `GET` the backtest by id — do not assume success. Cancel is explicit; interruption must remain queryable.

## operationIds

- `trading.strategy_definitions.list`
- `chats.create`
- `backtests.create` / `backtests.byId.get` / `backtests.byId.stream` / `backtests.byId.cancel`
