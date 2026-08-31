---
name: alphafox-admin
description: Admin-only operations reusing Web role authorization.
version: 0.3.18
---

# Admin

Requires admin role on the server. CLI confirmation does not grant privilege. Not available to automation (v1 deferred). Always `--format json --no-input`.

```bash
alphafox api GET /api/v1/admin/users --format json --no-input
```

High-risk cataloged admin writes: `alphafox schema <operationId>` first, then `--dry-run` then `--yes`. Body fields must come from that schema; use `--config @file` for large objects. If the operator is not admin, expect `403` and stop.

## Passivbot paper acceptance

This Stage 1 endpoint is intentionally absent from the public Operation Registry and typed CLI catalog. The only allowed uncataloged admin path is the exact direct route below. Its JSON body is strict: `name`, `exchangeConnectorId`, and `config` are required; `configSchemaVersion` may only be `1`; `autoStart` is optional and defaults to `true`. Do not add server-owned fields.

Preview the exact raw request first. The unknown/high-risk gate must return `confirmation_required`; show the requested action and risk to the operator, wait for explicit confirmation, then rerun the same command with `--yes`.

```bash
alphafox api POST /api/admin/passivbot-paper-acceptance-traders --config @./create-passivbot-paper.json --dry-run --format json --no-input
alphafox api POST /api/admin/passivbot-paper-acceptance-traders --config @./create-passivbot-paper.json --yes --format json --no-input
```

The config file shape is:

```json
{
  "name": "Passivbot paper acceptance",
  "exchangeConnectorId": "<internal-paper-connector-id>",
  "configSchemaVersion": 1,
  "config": {},
  "autoStart": true
}
```

## Recovery

- `401`: re-auth. `403`: not admin — do not escalate by switching profiles.
- Uncataloged admin POST/PATCH/DELETE still require `--yes` (unknown risk).

## operationIds

- `admin.users.list`
