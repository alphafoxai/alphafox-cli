---
name: alphafox-shared
description: Shared Alphafox CLI rules for Agents — auth, profiles, envelopes, risk gates, and public operationIds only.
version: 0.1.0
---

# Alphafox shared Agent contract

## Install / identity

```bash
npx @alphafoxai/cli version
npx @alphafoxai/cli doctor
```

- Default profile: `production`. Use `--profile staging|local` explicitly.
- Tokens: OS keychain only. Never pass `--token`. Never read tokens from config JSON.
- Automation tokens are **not supported in v1** (interactive Device Flow / PKCE only).

## Output

Always use:

```bash
alphafox … --format json --no-input
```

Parse the JSON envelope: `ok === true` for success. Errors land on **stderr** with `ok: false` and may include HTTP `status` + `requestId`.

## Auth

```bash
alphafox auth login --no-wait
# show verification_uri to the user, then:
alphafox auth login --device-code <device_code>
alphafox auth status --verify
alphafox whoami
```

## Commands

1. Prefer typed catalog: `alphafox schema <operationId>` then invoke domain commands.
2. Raw escape hatch only for allowlisted facade:

```bash
alphafox api GET /api/v1/me
```

Forbidden: `/backend`, `/control-plane`, `/signal-center`, internal secrets, non-`/api/v1` product routes.

## Risk

- `high-risk-write` requires `--yes` (exit code `10` if missing).
- Prefer `--dry-run` first for trader start/stop, withdrawals, admin writes.
- Never auto-retry unknown write outcomes.

## Public operationIds only

Skills must reference registry `operationId`s (see `alphafox schema` / `alphafox catalog`). Do not hardcode internal service URLs.
