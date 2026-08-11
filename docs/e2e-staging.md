# Staging E2E checklist (t101364 / t101369)

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

## Evidence policy

If staging domain/secrets are unavailable in the runner, capture provisioning failure to evidence logs and rely on:

- local unit/integration tests of envelope, allowlist, token model, confirmation
- structural presence of deploy workflow + runbooks

**Never fabricate staging success.**

Parent Feishu task stays `todo` until human acceptance of staging evidence.
