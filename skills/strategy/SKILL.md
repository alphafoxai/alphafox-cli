---
name: alphafox-strategy
description: Strategy definitions, chats, and backtests via public operationIds.
version: 0.3.2
---

# Strategy / Chat / Backtest

Always `--format json --no-input`. Read scopes `trading:read` / `backtests:read`; writes `chats:write` / `backtests:write`.

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

Engine strategy backtest (WASM tape + persist) is `skills/engine-backtest` (`alphafox engine-backtest run`). Do not treat `/api/v1/backtests` as the Engine WASM runner — that stub is the chat backtest job below.

## Long-running backtest

```bash
alphafox schema backtests.create --format json --no-input
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
