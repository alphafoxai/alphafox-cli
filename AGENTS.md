# alphafox-cli

Agent and human entry for the versioned Public Application API on alphafox-web.

## Engine Backtest runtime

`alphafox engine-backtest run` vendors the tape runner (`vendor/backtest-runner`, plus `ccxt`) so public npm installs do not need GitHub Packages. The wasm / Node host is downloaded from the public Vercel Blob manifest (`engine-backtest/latest.json`) into `~/.cache/alphafox/engine-backtest/<hash>/`. Override with `ALPHAFOX_BACKTEST_WASM_DIR` / `ALPHAFOX_BACKTEST_RUNNER_DIR` / `ALPHAFOX_ENGINE_ROOT`, or `ALPHAFOX_USE_LOCAL_BACKTEST=1` for a sibling Engine build. Do not add `@alphafoxai/backtest-wasm` or `@alphafoxai/backtest-runner` as CLI dependencies.

## Agent skills

### Issue tracker

Matt Skills engineering issues, specs, and tickets live in the shared Feishu `AlphaFox-Issues` tasklist; prefix titles with `[alphafox-cli]`. See `docs/agents/issue-tracker.md`.

### Triage labels

Triage roles map to Feishu tasklist sections, while issue categories use the `Type` field. See `docs/agents/triage-labels.md`.

### Domain docs

Read the repository's domain vocabulary and ADR layout as described in `docs/agents/domain.md`.
