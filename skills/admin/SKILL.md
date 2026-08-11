---
name: alphafox-admin
description: Admin-only operations reusing Web role authorization.
version: 0.1.0
---

# Admin

Requires admin role on the server. CLI confirmation does not grant privilege.

```bash
alphafox api GET /api/v1/admin/users
```

High-risk admin writes: `--dry-run` then `--yes`. Not available to automation (v1 deferred).

## operationIds

- `admin.users.list`
