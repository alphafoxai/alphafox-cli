---
name: alphafox-auth
description: Login, status, logout, whoami, and environment isolation for AlphaFox CLI.
version: 0.3.7
---

# Auth Skill

## When to use

User needs to sign in, verify session, switch profile, or revoke tokens.

Always `--format json --no-input`. Never `--token`.

## Workflows

### Device Flow (headless / Agent)

1. `alphafox auth login --no-wait --format json --no-input`
2. Present `verification_uri` / `user_code` to the human.
3. After approval: `alphafox auth login --device-code <device_code> --format json --no-input`
4. `alphafox whoami --format json --no-input` / `alphafox auth status --verify --format json --no-input`

### Browser loopback (human, local machine)

1. `alphafox auth login --browser --format json --no-input`
2. CLI binds `127.0.0.1` and opens the system browser. Do not copy codes or verifiers.
3. After the localhost callback, `alphafox whoami` / `alphafox auth status --verify`
4. If the browser cannot open, the error includes a copyable `authorizeUrl`. Do not retry as Device Flow unless the human is headless.

### Status / logout

- `alphafox auth status --verify --format json --no-input`
- `alphafox auth logout --format json --no-input` (server revoke + local keychain clear). If `remoteRevoke` is `failed`, local tokens are still cleared but exit is non-zero — do not claim a full logout.

### Recovery

- `401` / `expired_token`: re-run Device Flow or browser login. Do not reuse a token from another profile.
- Cross-env: production tokens are rejected on staging/local. Switch `--profile` only with explicit operator intent.

## Safety

- Fail closed on cross-environment tokens (prod token never hits staging).
- Do not copy refresh tokens into CI (automation deferred — ADR 0004).
- Scopes: `openid` `profile` `offline_access` at grant time.

## operationIds

- `me.whoami`
- Auth AS endpoints under `/api/auth/oauth/*` (not catalog product ops)
