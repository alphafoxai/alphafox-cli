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

```shell
# Install CLI
npm install -g @alphafox/cli

# Install CLI SKILL (required) — project-local, current workspace
npx -y skills add "$(npm root -g)/@alphafox/cli" -y
```

If the local package path fails (older tarball without `skills/`, or
`npm root -g` is wrong), fall back to the public GitHub source:

```shell
npx -y skills add alphafoxai/alphafox-cli -y
```

To install Skills for every project on this machine instead of the current
repo, add `-g`:

```shell
npx -y skills add "$(npm root -g)/@alphafox/cli" -y -g
```

Do not invent a second catalog. Skills must stay co-versioned with the CLI
that was just installed.

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

That wizard installs the CLI globally, runs `npx skills add … -y -g`,
and may prompt for `alphafox auth login --browser`. It is TTY-oriented.
Agents must follow Steps 1–4 in this document rather than the wizard.
