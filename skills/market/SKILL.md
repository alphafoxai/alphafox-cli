---
name: alphafox-market
description: Market data and spread-radar readonly queries.
version: 0.2.0
---

# Market

Always `--format json --no-input`. Prefer readonly scopes. No mock success if upstream fails.

```bash
alphafox api GET /api/v1/spread-radar/pairs --format json --no-input
alphafox api GET /api/v1/market/symbols --format json --no-input
```

## operationIds

- `spread_radar.pairs.list`
- `market.symbols.list`
