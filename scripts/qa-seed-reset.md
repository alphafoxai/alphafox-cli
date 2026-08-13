# QA seed/reset (t101373)

Implementations run only against staging. Production users, production trading, and real funds are forbidden.

## Staging identities (2026-08-13)

| Identity | Role | How to sign in |
|----------|------|----------------|
| `test@local.com` | ordinary user | password `localtest` via `POST https://staging.alphafox.app/api/auth/sign-in/email` |
| `cli-e2e-user` (GCP `ddddao-dev`) | pointer secret | email/role only; password is the documented pair, not stored in the secret |
| `cli-e2e-admin` | not provisioned | still missing |

Gate is `ALPHAFOX_DEPLOY_ENV=staging` on the Vercel Custom Environment. Production is fail-closed.

Device Flow without a browser click:

```bash
alphafox --profile staging auth login --no-wait --format json --no-input
node scripts/e2e-staging-device-approve.mjs --user-code <user_code>
alphafox --profile staging auth login --device-code <device_code> --format json --no-input
```

Per-run seed/reset scripts (`qa/seed-cli-e2e.mjs`) are still not implemented. Do not pretend they succeed.

## Contract (do not weaken)

- Prefer vendor sandbox/testnet for exchange, wallet, LLM, ASR, mail/Telegram.
- Unavailable dependency → fail with real error + request-id. No mock success.
- Missing admin fixture → do not invent production admin credentials.
