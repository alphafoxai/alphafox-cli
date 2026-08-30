---
name: alphafox-admin
description: Admin-only operations reusing Web role authorization.
version: 0.3.16
---

# Admin

Requires admin role on the server. CLI confirmation does not grant privilege. Not available to automation (v1 deferred). Always `--format json --no-input`.

```bash
alphafox api GET /api/v1/admin/users --format json --no-input
```

High-risk admin writes: `alphafox schema <operationId>` first, then `--dry-run` then `--yes`. Body fields must come from that schema; use `--config @file` for large objects. If the operator is not admin, expect `403` and stop.

## Recovery

- `401`: re-auth. `403`: not admin — do not escalate by switching profiles.
- Uncataloged admin POST/PATCH/DELETE still require `--yes` (unknown risk).

## operationIds

- `admin.users.list`
