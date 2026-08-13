---
name: alphafox-trading
description: Traders list and high-risk start/stop with confirmation gates.
version: 0.2.0
---

# Trading

Always `--format json --no-input`. Read first. Writes need scopes `trading:write`; start/stop also `trading:high-risk`.

## Read

```bash
alphafox api GET /api/v1/trading/traders --format json --no-input
```

## High-risk write

```bash
alphafox api POST /api/v1/trading/traders/{traderId}/start --body '{}' --dry-run --format json --no-input
alphafox api POST /api/v1/trading/traders/{traderId}/start --body '{}' --yes --format json --no-input
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
