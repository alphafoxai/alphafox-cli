# QA seed/reset (t101373)

Implementations run only against staging with secret-manager credentials. Production users, production trading, and real funds are forbidden.

## Current blocker (2026-08-13)

GCP project `ddddao-dev` has many `alphafox-staging-backend-*` secrets and **no** `cli-e2e-user` / `cli-e2e-admin` (or similarly named) identities. `staging.alphafox.app` is not publicly reachable (Vercel SSO 302). Seed/reset scripts are therefore **not implemented** and must not pretend to succeed.

When those secrets exist and public staging is up:

```bash
export RUN_ID="$(uuidgen)"
node scripts/qa/seed-cli-e2e.mjs --run-id "$RUN_ID" --profile staging
# … MVP / E2E …
node scripts/qa/reset-cli-e2e.mjs --run-id "$RUN_ID" --profile staging
```

Credentials stay in staging secret manager. Never commit tokens.

## Contract (do not weaken)

| Identity | Role | Storage |
|----------|------|---------|
| `cli-e2e-user` | normal user, no admin | staging secret manager |
| `cli-e2e-admin` | admin | staging secret manager |

- Prefer vendor sandbox/testnet for exchange, wallet, LLM, ASR, mail/Telegram.
- Unavailable dependency → fail with real error + request-id. No mock success.
- Each run has a unique `run_id`. Reset must stop traders, delete temp connectors, cancel open backtests, and drop bind tokens for that run.
- Missing credentials → **non-zero exit**. Do not skip-success.
