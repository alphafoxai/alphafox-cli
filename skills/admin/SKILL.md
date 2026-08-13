---
name: alphafox-admin
description: Admin-only operations reusing Web role authorization.
version: 0.2.0
---

# Admin

Requires admin role on the server. CLI confirmation does not grant privilege. Not available to automation (v1 deferred). Always `--format json --no-input`.

```bash
alphafox api GET /api/v1/admin/users --format json --no-input
```

High-risk admin writes: `--dry-run` then `--yes`. If the operator is not admin, expect `403` and stop.

## Recovery

- `401`: re-auth. `403`: not admin — do not escalate by switching profiles.
- Uncataloged admin POST/PATCH/DELETE still require `--yes` (unknown risk).

## operationIds

- `admin.users.list`
