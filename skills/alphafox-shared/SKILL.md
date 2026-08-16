---
name: alphafox-shared
description: Shared Alphafox CLI rules for Agents — auth, profiles, envelopes, risk gates, and public operationIds only.
version: 0.3.0
---

# Alphafox shared Agent contract

Co-versioned with `@alphafox/cli`. Query compatibility with `alphafox version --format json` (`version`, `contractVersion`, `catalogVersion`) and `alphafox catalog`.

## Install / identity

Prefer the wizard (CLI + Agent Skills) or the Agent install guide. Do not treat
`npm install -g @alphafox/cli` as enough for Agents — Skills must be registered
with `npx skills add`.

```bash
npx @alphafox/cli@latest install
# Agent playbook:
# https://github.com/alphafoxai/alphafox-cli/blob/main/docs/alphafox-cli-installation-guide.md
npx @alphafox/cli version --format json --no-input
npx @alphafox/cli doctor --format json --no-input
```

- Default profile: `production`. Use `--profile staging|local` explicitly.
- Tokens: OS keychain only (macOS Keychain, Linux Secret Service, Windows Credential Manager). Never pass `--token`. Never read tokens from config JSON.
- Automation tokens are **not supported in v1** (interactive Device Flow / PKCE only).

## Output

Always use:

```bash
alphafox … --format json --no-input
```

Optional: `--jq '<filter>'` requires the `jq` binary; missing jq fails closed (does not print the unfiltered envelope).

Parse the JSON envelope: `ok === true` for success. Errors land on **stderr** with `ok: false` and may include HTTP `status` + `requestId`. Stream watch uses JSONL. Do not parse human tables.

## Auth

```bash
alphafox auth login --no-wait --format json --no-input
# show verification_uri / user_code to the human, then:
alphafox auth login --device-code <device_code> --format json --no-input
alphafox auth status --verify --format json --no-input
alphafox whoami --format json --no-input
```

Local browser: `alphafox auth login --browser --format json --no-input` (loopback 127.0.0.1). If the browser cannot open, copy `authorizeUrl` from the error; do not invent a Device Flow retry unless the operator is headless.

Wrong environment / missing permission / missing `--yes`: stop. Do not retry with a different profile.

## Commands

1. Prefer typed catalog: `alphafox schema <operationId>` then invoke domain commands.
2. Raw escape hatch only for allowlisted facade:

```bash
alphafox api GET /api/v1/me --format json --no-input
```

Forbidden: `/backend`, `/control-plane`, `/signal-center`, internal secrets, non-`/api/v1` product routes, `--token`.

## Writes — schema first, never invent fields

Before every write (`POST` / `PUT` / `PATCH` / `DELETE` with a body):

1. Run `alphafox schema <operationId> --format json --no-input`.
2. Build the body **only** from `request.body` (property names, types, enums, required). Do not guess fields from memory, from another operationId, or from training data.
3. Small object: typed command + `--body '<json>'`.
4. Nested / large object: write a JSON file, then `--config @./payload.json`. Do not paste 20+ fields onto argv.
5. `--dry-run` first when the risk is `write` or `high-risk-write`.

CLI validates `--body` / `--config` against the catalog **before** HTTP. `body_schema` / `body_schema_missing` (exit `64`) means the payload is wrong — re-read `schema`, do not add extra keys to “make it work”. `--body` and `--config` cannot be combined. `--body @file` is also a file (same as `--config @file`).

Uncataloged writes cannot carry a non-empty body. Find the `operationId` first.

## Risk

- `high-risk-write` and uncataloged mutations (`unknown`) require `--yes` (exit code `10` if missing).
- Prefer `--dry-run` first for trader start/stop, withdrawals, admin writes.
- Never auto-retry unknown write outcomes.
- CLI `--yes` is UX only; the server still enforces role, ownership, and scopes.

## Public operationIds only

Skills must reference registry `operationId`s (see `alphafox schema` / `alphafox catalog`). Shortcuts may only compose those operationIds. Do not hardcode internal service URLs or invent a second catalog.
