# alphafox-cli

Alphafox CLI (`alphafox`) — Agent and human entry for the versioned Public Application API on alphafox-web.

## Install

### Method 1 — Manual wizard

Installs the CLI globally and copies co-versioned Agent Skills into detected
agents (Cursor, Claude Code, Codex, and others):

```bash
npx @alphafox/cli@latest install
```

After the wizard finishes, **restart your AI tool** so Skills load.

### Method 2 — Install via Agent

Copy and send this to your AI tool (Cursor, Claude Code, Codex, Trae, …):

```
Help me install Alphafox CLI: https://github.com/alphafoxai/alphafox-cli/blob/main/docs/alphafox-cli-installation-guide.md
```

```
帮我安装 Alphafox CLI：https://github.com/alphafoxai/alphafox-cli/blob/main/docs/alphafox-cli-installation-guide.md
```

The Agent reads that guide and runs the steps (global CLI, `npx skills add`,
login, verify). Restart the AI tool when it finishes.

### CLI only (no Skills)

```bash
npm install -g @alphafox/cli
# or
npx @alphafox/cli version
```

`npm install -g` does **not** register Skills with Agents. Use `alphafox install`
or the Agent guide for that.

## Quick start

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

- Tokens live in the OS keychain (or controlled test injection). **Never** in config files or `--token` argv.
- Profiles: `production` (default), `staging`, `local` — isolated issuer/audience/client (ADR 0003).
- High-risk writes require `--yes`. Automation tokens are **deferred** (ADR 0004).
- Raw `api` only hits allowlisted `/api/v1/*` facade paths.
- Writes validate `--body` / `--config @file` against the catalog schema
  before HTTP. Agents must `alphafox schema <operationId>` first and must
  not invent fields. Large objects use `--config @file`, not argv.

## Skills

Co-versioned Agent Skills live under `skills/`. API-oriented skills route public
`operationId`s; an explicit local-execution skill may call its co-versioned
built-in command.

`alphafox install` (and the [Agent install guide](docs/alphafox-cli-installation-guide.md))
run `npx skills add` so those files land in Agent skill directories
(`.cursor/skills`, `.claude/skills`, `~/.agents/skills`, …).

## Docs

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
