---
name: alphafox-trading
description: Traders list and high-risk start/stop with confirmation gates.
version: 0.1.0
---

# Trading

## Read

```bash
alphafox api GET /api/v1/trading/traders
```

## High-risk write

```bash
alphafox api POST /api/v1/trading/traders/{traderId}/start --body '{}' --dry-run
alphafox api POST /api/v1/trading/traders/{traderId}/start --body '{}' --yes
```

Without `--yes`, CLI exits `10` with `confirmation_required`.

## operationIds

- `trading.traders.list`
- `trading.traders.byId.start`
- `trading.traders.byId.stop`
