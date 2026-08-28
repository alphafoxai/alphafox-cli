---
name: alphafox-account
description: Account, wallet, and subscription read paths.
version: 0.3.15
---

# Account / wallet

Always `--format json --no-input`. These paths are read-first. Wallet mutations are write/high-risk — `alphafox schema` first (do not invent fields), `--dry-run` then `--yes`; never auto-retry. Large bodies: `--config @file`.

```bash
alphafox api GET /api/v1/wallet --format json --no-input
alphafox api GET /api/v1/account/exchange-uids --format json --no-input
alphafox api GET /api/v1/subscriptions/me --format json --no-input
alphafox api GET /api/v1/managed-wallets --format json --no-input
```

## operationIds

- `wallet.get`
- `account.exchange_uids.list`
- `subscriptions.me.get` (facade `GET /api/v1/subscriptions/me`)
- `managed_wallets.list`
