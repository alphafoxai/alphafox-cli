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

# Verify and globally sync the exact co-versioned Skills bundle
alphafox skills sync --format json --no-input
```

`alphafox skills sync` writes the verified bundle to `~/.agents/skills` and
then links each Skill into `~/.claude/skills` so Claude Code can discover it.
Cursor (`~/.cursor/skills`) and Codex (`~/.codex/skills`) are linked when those
tools are already present. `alphafox skills status` reports `agentLinks`.

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

### Choose the credential storage policy

By default the CLI prefers the OS keychain, but falls back to a **plaintext** file with a warning if the backend is unavailable or saving fails. `ALPHAFOX_FORCE_FILE_KEYCHAIN=1` intentionally selects file storage without that warning. The default file is `~/.config/alphafox/keychain/<profile>.tokens.json`; use `ALPHAFOX_KEYCHAIN_DIR` to change it. `ALPHAFOX_CONFIG_DIR` changes config location only, not the token directory. POSIX file writes repair permissions to `0600` before writing; this does not encrypt the file or establish Windows ACLs.

If the user requires keychain-only storage, set `ALPHAFOX_REQUIRE_OS_KEYCHAIN=1` in the environment of **every** CLI invocation, including both Device Flow steps and subsequent status/refresh/logout commands. Do not combine it with `ALPHAFOX_FORCE_FILE_KEYCHAIN=1` or test token injection. An unavailable/failing OS save returns `credential_storage` / `os_keychain_required` with nonzero exit status; conflicting overrides return `keychain_policy_conflict`. Stop and report the error rather than disabling the policy to finish login.

Enabling strict mode does not migrate or delete old credentials. It never reads plaintext fallback tokens. If there is no readable OS entry but a legacy file exists, `plaintext_credentials_disallowed` is returned, including for logout; this is not a successful remote revocation. Revoke the old session and remove its file explicitly. Enabling the flag alone is not a migration or cleanup procedure.

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

Check the exit status and the JSON envelope; `doctor` also requires `data.ok === true`.
Its keychain probe only checks helper availability, not an actual save or authentication.
Confirm `auth status --verify` reports an active, verified session rather than
treating a successful envelope or `doctor` alone as login success. Errors land on
**stderr**. A 401 / expired session means re-run Step 2 — do not pass
`--token` and do not reuse a token from another profile.

## Step 4: Tell the user to restart

Ask the user to **restart the AI tool** so the new Skills are loaded.

## Step 5: New-user welcome

After restart and `alphafox auth status --verify` shows `session: active`,
follow skill `alphafox` **After install**: fetch the Lite square catalog
(`lite.catalog_config.get`, `lite.signal_sources.list`) and introduce the
classic strategy definitions from `trading.strategy_definitions.list`. Do not
invent 带单员 names. Do not create a trader until the user asks.

## Human wizard (do not run this from an Agent)

Humans who prefer an interactive terminal should run this instead of
stepping through the commands above:

```shell
npx @alphafox/cli@latest install
```

That wizard installs the CLI globally, verifies and syncs the packaged Skills,
and may prompt for `alphafox auth login --browser`. It is TTY-oriented.
Agents must follow Steps 1–4 in this document rather than the wizard.

## Uninstall

Uninstall is a standalone script, not `alphafox uninstall`. After the user
explicitly asks to uninstall:

```shell
curl -fsSL https://raw.githubusercontent.com/alphafoxai/alphafox-cli/main/scripts/uninstall.cjs | node -- --dry-run
curl -fsSL https://raw.githubusercontent.com/alphafoxai/alphafox-cli/main/scripts/uninstall.cjs | node -- --yes
```

That removes the global `@alphafox/cli` package, Agent Skills under
`~/.agents/skills` (and Claude / Cursor / Codex / Grok links),
`~/.config/alphafox`, login tokens, and local Engine backtest caches.
It does not delete running traders or other server-side data. Ask the user
to restart the AI tool afterwards. Do not invent a CLI subcommand.
