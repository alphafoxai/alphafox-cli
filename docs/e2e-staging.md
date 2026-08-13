# Staging E2E checklist (t101364 / t101369)

Run only against the stable public facade `https://staging.alphafox.app`. Do not use Preview URLs, internal service tokens, or production.

Staging CLI issuer: `https://staging.alphafox.app`. Test login (staging-only, gated on `ALPHAFOX_DEPLOY_ENV=staging`): `test@local.com` / `localtest`. Device Flow approve without a human click: `node scripts/e2e-staging-device-approve.mjs --user-code <code>`. Isolate credentials with `ALPHAFOX_CONFIG_DIR` and `ALPHAFOX_FORCE_FILE_KEYCHAIN=1`.

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

## Evidence (2026-08-13) — vertical slice pass

Anonymous `GET https://staging.alphafox.app/api/v1/meta` → **HTTP 200**, `environment=staging`, `contractVersion=2026-08-13`, `commitSha=65d1f816007adc7acc09db5e86671931737e0379`, `x-request-id=66511bcf-dda9-4974-9378-3aacd8d938ff`. No 302 to `vercel.com/sso-api`. Vercel Authentication is disabled for the whole `alphafox-web` project (Preview `*.vercel.app` is also public; accepted).

CLI used: local `alphafox-cli` `fd04570747b1096b57a5a12ef20994b6c79531d7` (`dist/cli.js --profile staging --format json --no-input`). Config dir `/tmp/alphafox-e2e-staging`.

| Step | Result | Evidence |
|------|--------|----------|
| 1. `version` | pass | `contractsSha` matches freeze `5a4f9c0175951a6bedc52640fe917abe992ec824` |
| 1. `doctor` | pass | `apiBaseUrl` / issuer `https://staging.alphafox.app` |
| 2. password sign-in | pass | HTTP 200, session cookie, `userId=019f3073-307f-76e9-adf1-0203af9ab22b` |
| 2. Device Flow `--no-wait` | pass | `user_code` issued; verification `https://staging.alphafox.app/cli/device` |
| 2. device approve helper | pass | HTTP 200, `requestId=821fa89f-04c9-490a-8e45-88f83a7e69e6` |
| 2. `auth login --device-code` | pass | authenticated, `requestId=a90ef882-c341-4af5-b68c-f27b2a280bfd` |
| 3. `whoami` | pass | same `userId`, `requestId=8202f6b0-517d-44fa-acf3-0e19c39db7c7` |
| 3. `auth status --verify` | pass | `verified: true`, issuer/audience/clientId staging |
| 4. `GET /api/v1/trading/strategy-definitions` | pass | HTTP 200 via CLI, `requestId=22afdb63-d8cf-4512-a6b7-326f97a876a9` |
| 4. `GET /api/v1/exchange-connectors` | pass | HTTP 200, `requestId=1284cfe7-a06a-4f30-bac1-6322eaf05e1b` |
| 4. `GET /api/v1/trading/traders` | pass | HTTP 200, `requestId=c09ced70-d704-4b78-bc72-96a7048d4c7a` |
| 7. high-risk without `--yes` | pass | `api POST /api/v1/trading/traders/{id}/start` → **exit 10**, `confirmation_required` (no HTTP call) |
| Rate limit | pass (live) | 80 sequential `POST /api/auth/oauth/device/code` → first **HTTP 429** at request 72, `x-request-id=e585251a-2768-4cfc-aab6-77da1ae20570`, `Retry-After: 43`. Limit is 10/min **per serverless instance**; cross-instance windows do not share memory. Feishu alert is debounce 10 min/key via `ALPHAFOX_OPS_FEISHU_WEBHOOK_URL`. |

Not run this pass (still open on the full checklist):

- 5. create chat with idempotency
- 6. backtest create → watch stream → cancel
- 8. logout / revoke
- 9. cross-env token rejection

Login UI on the website is still OTP/passwordless. E2E used API password + the approve helper. Remaining human click if someone uses the browser `/cli/device` page: they must already have a web session (OTP unless they hit the sign-in API).

Web PR: https://github.com/alphafoxai/alphafox-web/pull/448 (head `65d1f816`). Do not enable production OAuth client or npm `latest` from this evidence.

## Policy

- Capture the real HTTP status, redirect, and request-id. Never fabricate staging success.
- External dependency outage → fail the test. No mock success, no silent skip.
- Parent Feishu task stays `todo` until production publish / OAuth latest is accepted.
- Do not enable production OAuth client or npm latest from a staging-only pass.
