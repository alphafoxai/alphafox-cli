---
name: alphafox-market
description: Market data and spread-radar readonly queries.
version: 0.1.5
---

# Market

Always `--format json --no-input`. Prefer readonly scopes. No mock success if upstream fails.

```bash
alphafox api GET /api/v1/spread-radar/pairs --format json --no-input
```

`GET /api/v1/market/symbols` is only valid if it is on the current catalog/allowlist; otherwise the CLI fails closed with `facade_only`. Do not fall back to internal market APIs.

## operationIds

- `spread_radar.pairs.list` when present in `alphafox catalog`
