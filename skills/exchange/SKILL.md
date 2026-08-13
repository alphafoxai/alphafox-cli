---
name: alphafox-exchange
description: Exchange connectors list and connection management via Public API.
version: 0.1.5
---

# Exchange connectors

Always `--format json --no-input`. List is `exchange-connectors:read`.

```bash
alphafox api GET /api/v1/exchange-connectors --format json --no-input
```

Writes that create/disable connectors may be `high-risk-write` — use `--dry-run` / `--yes`. Uncataloged connector POST is treated as unknown risk and still needs `--yes`.

## Recovery

- `403` / wrong resource: stop. Do not retry with production tokens on staging.
- Never log connector secrets from request bodies.

## operationIds

- `exchange_connectors.list`
