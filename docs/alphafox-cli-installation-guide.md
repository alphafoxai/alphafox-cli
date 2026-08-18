# AlphaFox CLI installation guide

The following steps are designed for AI Agents. Some steps require the user
to complete a browser or Device Flow approval. Always use
`--format json --no-input` when invoking the CLI. Never pass `--token`.

Raw copy of this file:
https://raw.githubusercontent.com/alphafoxai/alphafox-cli/main/docs/alphafox-cli-installation-guide.md

## Prerequisites

- Node.js 20+ (`npm` / `npx`)

## Step 1: Install the CLI and Agent Skills

Skills do **not** register with Cursor / Claude Code / Codex from
`npm install -g` alone. The second command is required.

For reproducible installs, resolve the release once and pass that exact
version to npm:

```shell
# Resolve the current release (record this value for the install)
npm view @alphafox/cli@latest version

# Install the exact version returned above
npm install -g @alphafox/cli@<resolved-version>

# Verify and globally sync the exact co-versioned Skills bundle
alphafox skills sync --format json --no-input
```

`@latest` is also supported as an explicit convenience when reproducibility
is not required:

```shell
npm install -g @alphafox/cli@latest
```

The human `alphafox install` wizard resolves `latest` first and installs that
exact version; it stops without installing if the lookup fails. Do not use an
unqualified `npm install -g @alphafox/cli` because it creates a time-of-check /
time-of-use race.

Do not install Skills from GitHub `main` as a fallback. The CLI verifies the
manifest and hashes inside the npm package before syncing. If sync fails, stop
and report the error rather than downloading a different Skills version.

For future updates:

```shell
alphafox update --check --format json --no-input
alphafox update --format json --no-input
```

`alphafox update` upgrades the npm CLI first, then syncs its bundled Skills.
Modified Skills are preserved and reported. Only use
`alphafox skills sync --force --yes` when the user explicitly wants to replace
them; a backup is created before replacement.

## Step 2: Login

### Device Flow (headless / Agent)

1. Start login and extract `verification_uri` / `user_code` from the JSON
   envelope. Send those to the user. Do not poll in a tight loop.

```shell
alphafox auth login --no-wait --format json --no-input
```

2. After the user approves, resume with the `device_code` from step 1:

```shell
alphafox auth login --device-code <device_code> --format json --no-input
```

### Browser loopback (human on this machine)

If the user is at a local desktop and can use a browser:

```shell
alphafox auth login --browser --format json --no-input
```

The CLI binds `127.0.0.1` and opens the system browser. If the browser
cannot open, the error includes a copyable `authorizeUrl` — send that to
the user. Do not retry as Device Flow unless the operator is headless.

Default profile is `production`. Use `--profile staging|local` only when
the user explicitly asks.

## Step 3: Verify

```shell
alphafox doctor --format json --no-input
alphafox auth status --verify --format json --no-input
alphafox whoami --format json --no-input
```

Parse the JSON envelope: `ok === true` means success. Errors land on
**stderr**. A 401 / expired session means re-run Step 2 — do not pass
`--token` and do not reuse a token from another profile.

## Step 4: Tell the user to restart

Ask the user to **restart the AI tool** so the new Skills are loaded.
Then they can ask the Agent to use AlphaFox. The entry skill `alphafox` routes
to auth, market, engine-backtest, strategy, trading, and the rest.

## Human wizard (do not run this from an Agent)

Humans who prefer an interactive terminal should run this instead of
stepping through the commands above:

```shell
npx @alphafox/cli@latest install
```

That wizard uses `@latest` as a convenience, resolves it before installing,
and stops if the lookup fails; it then verifies and syncs the packaged Skills.
It may prompt for `alphafox auth login --browser` and is TTY-oriented. Agents
must follow Steps 1–4 in this document rather than the wizard.
