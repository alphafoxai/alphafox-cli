---
name: alphafox-trading
description: Traders list and high-risk start/stop with confirmation gates.
version: 0.3.6
---

# Trading

Always `--format json --no-input`. Read first. Writes need scopes `trading:write`; start/stop also `trading:high-risk`.

Human-mentioned tickers must be resolved with `alphafox resolve-symbols` (`skills/market`) before they are written into trader config.

## Read

```bash
alphafox api GET /api/v1/trading/traders --format json --no-input
```

## High-risk write

Read `alphafox schema trading.traders.byId.start` first. Body may only include documented fields (`reason` is optional). Do not invent keys.

```bash
alphafox schema trading.traders.byId.start --format json --no-input
alphafox trading traders byId start --traderId <id> --body '{}' --dry-run --format json --no-input
alphafox trading traders byId start --traderId <id> --body '{}' --yes --format json --no-input
```

Without `--yes`, CLI exits `10` with `confirmation_required`. Server still checks role/ownership.

Stop: `POST /api/v1/trading/traders/{traderId}/stop` with the same `--dry-run` then `--yes` sequence.

## Recovery

- `403`: missing scope or not owner — stop, do not retry `--yes`.
- `409`: trader already in the requested state — report, do not loop start/stop.
- Unknown HTTP after a write: do not auto-retry.

## operationIds

- `trading.traders.list`
- `trading.traders.byId.start`
- `trading.traders.byId.stop`
