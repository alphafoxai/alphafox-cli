---
name: alphafox-notification
description: Notification channels and subscriptions.
version: 0.3.10
---

# Notification

Always `--format json --no-input`. List is `notification:read`. Channel create/replace/delete may be write or high-risk — `alphafox schema` first (no invented fields), then `--dry-run` / `--yes`. Large bodies: `--config @file`.

```bash
alphafox api GET /api/v1/notification/channels --format json --no-input
alphafox api GET /api/v1/notification/subscriptions --format json --no-input
```

If a path is not allowlisted, stop with the structured error. Do not call notification internals.

## operationIds

- `notification.channels.list`
- `notification.subscriptions.list`
