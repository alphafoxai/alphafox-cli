---
name: alphafox-exchange
description: Exchange connectors list and connection management via Public API.
version: 0.3.17
---

# Exchange connectors

Always `--format json --no-input`. List is `exchange-connectors:read`.

```bash
alphafox api GET /api/v1/exchange-connectors --format json --no-input
```

Writes that create/disable connectors may be `high-risk-write` — `alphafox schema` first, then `--dry-run` / `--yes`. Do not invent connector fields; large bodies use `--config @file`. Uncataloged connector POST cannot carry a non-empty body.

## Recovery

- `403` / wrong resource: stop. Do not retry with production tokens on staging.
- Never log connector secrets from request bodies.

## operationIds

- `exchange_connectors.list`
