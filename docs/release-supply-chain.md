# Release: npm, Skills, supply chain (t101375)

**Status:** Frozen (G0)  
**Date:** 2026-08-13  
**Canonical package:** `@alphafox/cli` on the public npmjs.org registry.

This document freezes distribution policy. It supersedes the earlier draft that
named `@alphafoxai/cli` (that name was never published; npmjs returns 404).

## Package

| Field | Frozen value |
|-------|----------------|
| Name | `@alphafox/cli` |
| Binary | `alphafox` (`bin/alphafox.js`) |
| Registry | `https://registry.npmjs.org/` |
| Visibility | **public** (`publishConfig.access=public`) |
| npm org / owner | `@alphafox` scope; maintainer `alphafox <joe@alphafox.app>` |
| License | MIT |
| Node | LTS **≥ 20** (`engines.node`) |
| OS | macOS, Linux, Windows (npm install; no standalone native binary in v1) |
| Package contents | `bin/`, `dist/`, `skills/`, `README.md`, `docs/`, `LICENSE` |

v1 does **not** ship independent GitHub Release binaries, so there is no extra
binary signing/checksum channel. Integrity is npm pack integrity plus
provenance (below).

Do **not** republish under `@alphafoxai/cli` without a new ADR. Skills and docs
that still mention that name are stale and must follow this freeze.

## Publish rules (normative)

1. Publish **only** from CI on a protected git tag matching `v*` (example:
   `v0.2.0`). Humans must not `npm publish` from a laptop for any release
   after this freeze, except an explicit incident rollback documented in the
   change ticket.
2. CI MUST use npm **trusted publishing / OIDC provenance**. Long-lived npm
   tokens are forbidden for publish.
3. npm org owners MUST have 2FA. Publish permission is CI identity plus owners;
   no shared user tokens in git or chat.
4. Package tarball MUST NOT contain secrets, test fixtures with credentials,
   `.env`, private endpoints, or internal-only hostnames.
5. `prepublishOnly` builds from the tagged SHA. The published `CLI_VERSION`
   (or equivalent) MUST equal the npm version.

### Grandfathered 0.1.x

npmjs currently has `@alphafox/cli@0.1.0`–`0.1.5` (latest `0.1.5`). Those
tarballs have registry signatures and **no** provenance attestations
(`dist.attestations` is empty). They were published by the human npm user
`alphafox`. They remain installable but are **not** the compliance target.
The next minor/patch that this policy covers MUST be the first
OIDC-provenance release.

## Skills distribution

- Skills ship **inside** the same npm tarball under `skills/` (co-versioned).
- Skills major aligns with CLI major. There is no separate Skills registry
  in v1 and no silent download of a different Skills version at runtime.
- `npm install -g @alphafox/cli` places `skills/` next to the binary only.
  Agents do not load that directory. `alphafox install`, `alphafox update`,
  and `alphafox skills sync` verify `dist/skills-manifest.json`, then copy
  only from that exact package into global Agent skill dirs.
- GitHub `main` is not an update fallback. A missing or invalid package
  manifest fails closed instead of silently changing the Skills version.
- Sync state and per-Skill hashes live under the AlphaFox config directory.
  Missing or unchanged stale Skills may update automatically. Modified Skills
  require `alphafox skills sync --force --yes` and are backed up first.
- Retired Skills are removed only when the state proves they are AlphaFox
  managed and unmodified. Failed copy/removal verification does not advance
  sync state.
- `contractVersion` on the CLI profile MUST match the Public API
  `contractVersion` (or the documented compatible range). Mismatch → fail
  closed; do not download an older contract or degrade quietly.

## Compatibility / channels / deprecation

| Channel | npm dist-tag | Meaning |
|---------|--------------|---------|
| stable | `latest` | Supported release |
| prerelease | `next` | Opt-in only |

- Breaking API/contract/minCLI/maxCLI changes: announce ≥ **30 days** before
  `latest` moves; keep the previous compatible CLI installable on npm.
- Incompatible CLI ↔ API ↔ contract: CLI exits non-zero with a machine-readable
  error. No silent skip, no automatic down-version.
- Emergency unpublish is a last resort (npm unpublish window). Preferred:
  `npm deprecate @alphafox/cli@<bad> "<reason>; use <good>"` and tell
  operators to install the last good version.

## Support matrix (install / update / uninstall)

| Platform | Install | Update | Uninstall | Secrets |
|----------|---------|--------|-----------|---------|
| macOS | `npm install -g @alphafox/cli` or `npx @alphafox/cli` | `npm update -g @alphafox/cli` or pin `@<version>` | `npm uninstall -g @alphafox/cli` | Keychain Access |
| Linux | same | same | same | Secret Service; explicit `ALPHAFOX_FORCE_FILE_KEYCHAIN=1` enables POSIX `0600` file mode |
| Windows | same | same | same | Credential Manager (`CredWrite`/`CredRead`); file mode is unsupported |

Fresh-machine acceptance (release checklist, not optional):

```bash
npm install -g @alphafox/cli@<version>
npm view @alphafox/cli@<version> --json   # attestations present after first OIDC release
alphafox version
alphafox doctor
alphafox schema me.whoami
```

## Rollback

```bash
npm install -g @alphafox/cli@<previous-compatible>
alphafox version
alphafox doctor
```

Failed install leaves the previous global binary in place (npm does not
half-replace). If `doctor` fails after a successful install, roll back with
the command above. Do not point the CLI at a different environment to “make
it work”.

## SBOM / audit

CI MUST emit an SBOM (CycloneDX from the pnpm production tree via
`scripts/generate-sbom.mjs`) from the tagged SHA and fail the release job on
**critical** vulnerabilities in **runtime** dependencies (`pnpm audit --prod`).
Dev-only advisories do not block publish. SBOM is an artifact of the release
workflow, not a file committed to `main` by default.

## Out of scope (v1)

- Private npm / GitHub Packages as the user install path
- Homebrew / scoop / standalone signed binaries
- Separate Skills marketplace
- Automation-token distribution (ADR 0004)
