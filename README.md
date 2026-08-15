# alphafox-cli

Alphafox CLI (`alphafox`) — Agent and human entry for the versioned Public Application API on alphafox-web.

## Install

```bash
npm install -g @alphafox/cli
# or
npx alphafox-cli version
```

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

## Skills

Co-versioned Agent Skills live under `skills/`. API-oriented skills route public
`operationId`s; an explicit local-execution skill may call its co-versioned
built-in command.

## Docs

- [Release / supply chain](docs/release-supply-chain.md)
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
