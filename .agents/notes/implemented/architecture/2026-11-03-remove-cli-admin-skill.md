# Agent Note: Remove the admin Skill and the direct admin raw-API path

Status: implemented

## Problem

The CLI still shipped two admin surfaces that no longer worked:

- the `alphafox-admin` Skill, routed from `alphafox`;
- one direct raw-API path outside the catalog, `POST /api/admin/passivbot-paper-acceptance-traders`,
  allowed by `DIRECT_ADMIN_ALLOW` in `src/catalog/allowlist.ts`. `alphafox api` skipped catalog body
  validation for it.

Since alphafox-web #1187 (2026-10-25), admin routes refuse CLI tokens and require a web session with
passkey step-up. On 2026-11-03, alphafox-contracts 0.12.0 removed every admin operation from the
registry, and this repository's catalog followed (alphafox-cli #57). An Agent loading the Skill would
be taught calls that can only return 403. The allowlist entry also kept an exception to the rule that
raw API reaches only `/api/v1` facade paths.

## Decision

- Delete `skills/admin/` and its row in the `alphafox` router.
- Remove `DIRECT_ADMIN_ALLOW`, `isDirectAdminAllowlistedPath` and the body-validation bypass in
  `alphafox api`. Raw API now allows only infrastructure paths and catalog facade paths, so every
  admin path, direct or under `/api/v1/admin`, is refused with `facade_only` (exit 77) before any
  request is sent.
- Drop the `cli-e2e-admin` fixture row from `scripts/qa-seed-reset.md`, since the CLI has no admin
  use left for it.

Installed copies of `alphafox-admin` go away on the next Skill sync, which removes orphaned
managed Skills.

## Alternatives considered

**Keep the Skill with a note that admin work moved to the web console.** The Skill would still be
loaded for admin requests and spend context only to say no, since admin routes need a web session
the CLI cannot hold.

**Keep the direct path for a later admin automation channel.** Such a channel would need a new
authorization design on the web side; a CLI allowlist entry would not make it work. It can be added
with that design.

## Consequences

Running `alphafox api` against an admin path fails locally with `facade_only` instead of reaching the
server and getting 403. Creating a Passivbot paper acceptance trader needs a web admin session; the
CLI has no path to that route.

## Verification

- `tests/allowlist-safety.test.ts` asserts that no admin path is allowed, both `/api/admin/...` and
  `/api/v1/admin/...`.
- `tests/cli-launch.test.ts` asserts that `alphafox api POST` to both forms exits 77 with
  `facade_only`, even with `--dry-run`.
- `tests/skills-surface.test.ts` asserts that `skills/admin` does not exist and that the router does
  not mention `alphafox-admin`.

The repository depends on ccxt, so these tests run in CI, not locally.
