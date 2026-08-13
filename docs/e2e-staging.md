# Staging E2E checklist (t101364 / t101369)

Run only against the stable public facade `https://staging.alphafox.app`. Do not use Preview URLs, internal service tokens, or production.

## Scenarios

1. Install CLI → `version` / `doctor`
2. Device Flow split (`--no-wait` + `--device-code`)
3. `whoami` / `auth status --verify`
4. Readonly: strategy definitions, connectors, traders
5. Write: create chat with idempotency
6. Backtest create → watch stream → cancel
7. High-risk without `--yes` → exit 10
8. Logout / revoke
9. Cross-env token rejection (prod token on staging)

## Evidence (2026-08-13) — blocked

Anonymous `GET https://staging.alphafox.app/api/v1/meta` → **HTTP 302** `https://vercel.com/sso-api` (Vercel Deployment Protection). CLI cannot complete Device Flow / whoami against a URL that challenges Vercel SSO before Better Auth.

Authenticated `vercel curl` of the same path returns `environment=staging` for SHA `b4063b79…`. That proves the app identity plane, not public CLI reachability. **Do not record that as E2E pass.**

Also missing: staging QA identities / seed-reset credentials (see `scripts/qa-seed-reset.md`). No `cli-e2e-*` secrets in GCP Secret Manager on `ddddao-dev`.

## Policy

- Capture the real HTTP status, redirect, and request-id. Never fabricate staging success.
- External dependency outage → fail the test. No mock success, no silent skip.
- Parent Feishu task stays `todo` until a human accepts **public** staging evidence.
- Do not enable production OAuth client or npm latest while this checklist is blocked.
