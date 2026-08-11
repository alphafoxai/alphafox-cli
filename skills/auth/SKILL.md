---
name: alphafox-auth
description: Login, status, logout, whoami, and environment isolation for Alphafox CLI.
version: 0.1.0
---

# Auth Skill

## When to use

User needs to sign in, verify session, switch profile, or revoke tokens.

## Workflows

### Device Flow (headless / Agent)

1. `alphafox auth login --no-wait --format json`
2. Present `verification_uri` / `user_code` to the human.
3. After approval: `alphafox auth login --device-code <device_code>`
4. `alphafox whoami` / `alphafox auth status --verify`

### Status / logout

- `alphafox auth status --verify`
- `alphafox auth logout` (server revoke + local keychain clear)

## Safety

- Fail closed on cross-environment tokens (prod token never hits staging).
- Do not copy refresh tokens into CI (automation deferred — ADR 0004).

## operationIds

- `me.whoami`
- Auth AS endpoints under `/api/auth/oauth/*` (not catalog product ops)
