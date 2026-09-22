# alphafox-cli

AlphaFox CLI (`alphafox`) — Agent and human entry for the versioned Public Application API on alphafox-web.

Homepage: https://alphafoxai.github.io/alphafox-cli/

## Install

Pick **one** of the following. Both install the CLI **and** register Agent
Skills. `npm install -g @alphafox/cli` alone does **not** install Skills.

### Method 1 — Manual wizard

```bash
npx @alphafox/cli@latest install
```

This installs `@alphafox/cli` globally, runs `npx skills add` into detected
agents (Cursor, Claude Code, Codex, …), and may prompt for
`alphafox auth login --browser`. **Restart the AI tool** afterwards so Skills
load.

### Method 2 — Install via Agent

Copy and send this to Cursor / Claude Code / Codex / Trae:

```
帮我安装 AlphaFox CLI：https://github.com/alphafoxai/alphafox-cli/blob/main/docs/alphafox-cli-installation-guide.md
```

```
Help me install AlphaFox CLI: https://github.com/alphafoxai/alphafox-cli/blob/main/docs/alphafox-cli-installation-guide.md
```

The Agent follows that guide (`npm install -g`, `alphafox skills sync`, login,
`doctor`). **Restart the AI tool** when it finishes.

## Update

CLI and Skills are one verified release unit:

```bash
alphafox update --check
alphafox update
alphafox skills status
```

Ordinary CLI commands check npm at most once every 24 hours and only print a
stderr notice when a newer version exists. They never auto-upgrade.

`alphafox update` upgrades the npm package and then syncs the exact Skills
bundle shipped inside it. It never updates Skills independently from GitHub.
Locally modified Skills are reported and preserved; use
`alphafox skills sync --force --yes` only when you intend to replace them.
Restart the AI tool after a sync.

## Uninstall

This is **not** an `alphafox` subcommand. The script removes the global npm
package, Agent Skills (including Claude / Cursor / Codex / Grok links), local
config, login tokens, and Engine backtest caches. It does **not** delete
server-side traders or account data.

```bash
curl -fsSL https://raw.githubusercontent.com/alphafoxai/alphafox-cli/main/scripts/uninstall.cjs | node -- --yes
```

Preview first:

```bash
curl -fsSL https://raw.githubusercontent.com/alphafoxai/alphafox-cli/main/scripts/uninstall.cjs | node -- --dry-run
```

From a git checkout:

```bash
node scripts/uninstall.cjs --dry-run
node scripts/uninstall.cjs --yes
```

Restart AI tools afterwards so Skills unload.

## Quick start

After Method 1 or 2:

```bash
alphafox version
alphafox doctor
alphafox auth login --no-wait          # Device Flow (headless-friendly)
alphafox auth login --device-code <code>
alphafox whoami
alphafox schema me.whoami
alphafox api GET /api/v1/me
```

## Security

- By default, tokens use the OS keychain (macOS Keychain, Linux Secret Service, or Windows Credential Manager). If unavailable or a save fails, the CLI warns and uses a **plaintext file fallback**. `ALPHAFOX_FORCE_FILE_KEYCHAIN=1` explicitly selects file storage without that warning. Tokens are **never** written to the CLI config file or accepted via `--token` argv.
- Fallback files default to `~/.config/alphafox/keychain/<profile>.tokens.json`; `ALPHAFOX_KEYCHAIN_DIR` overrides that directory. `ALPHAFOX_CONFIG_DIR` changes config location only, **not** the token directory. On POSIX, the fallback repairs file permissions to `0600` before writing; this is access control, not encryption. Windows permissions depend on filesystem ACLs.
- Opt in to keychain-only storage by setting `ALPHAFOX_REQUIRE_OS_KEYCHAIN=1` for **every** CLI invocation (including login, refresh, status, and logout). OS save failure then stops with `credential_storage` / `os_keychain_required` before any plaintext write. Strict mode rejects force-file mode and test token injection (`keychain_policy_conflict`), and never reads plaintext fallback credentials.
- Enabling strict mode does not migrate or delete old credentials. If no OS entry is readable but a legacy fallback exists, it fails with `plaintext_credentials_disallowed`, including on logout, rather than claiming remote revocation. Revoke the old session and remove its file explicitly before treating the transition as complete. `doctor` checks helper availability, not successful storage or remote authentication; verify login with `auth status --verify`.
- Profiles: `production` (default), `staging`, `local` — isolated issuer/audience/client (ADR 0003).
- High-risk writes require `--yes`. Automation tokens are **deferred** (ADR 0004).
- Raw `api` only hits allowlisted `/api/v1/*` facade paths.
- Writes validate `--body` / `--config @file` against the catalog schema
  before HTTP. Agents must `alphafox schema <operationId>` first and must
  not invent fields. Large objects use `--config @file`, not argv.

## Skills

Co-versioned Agent Skills live under `skills/`. The entry skill is
`skills/alphafox` (`name: alphafox`): it routes to domain skills. API-oriented
skills then use public `operationId`s; an explicit local-execution skill may
call its co-versioned built-in command.

`alphafox install` (and the [Agent install guide](docs/alphafox-cli-installation-guide.md))
verify the packaged Skills manifest, copy it into `~/.agents/skills`, and link
each Skill into `~/.claude/skills` (plus `~/.cursor/skills` / `~/.codex/skills`
when those agents exist). Use `alphafox skills status` to inspect missing,
stale, modified, or unlinked Skills and `alphafox skills sync` to repair safe
drift — including Claude Code links when the canonical bundle is already current.

## Docs

- [Homepage](https://alphafoxai.github.io/alphafox-cli/)
- [Release / supply chain](docs/release-supply-chain.md)
- [Agent install guide](docs/alphafox-cli-installation-guide.md)
- [Staging E2E checklist](docs/e2e-staging.md)
- Related ADRs and parity matrix live in the alphafox-web repository

## Development

```bash
pnpm install
pnpm build
pnpm test
node dist/cli.js version
```

## License

MIT
