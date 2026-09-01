# alphafox-cli

Agent and human entry for the versioned Public Application API on alphafox-web.

## Engine Backtest runtime

`alphafox engine-backtest run` vendors the tape runner (`vendor/backtest-runner`, plus `ccxt`) so public npm installs do not need GitHub Packages. The wasm / Node host is downloaded from the public Vercel Blob manifest (`engine-backtest/latest.json`) into `~/.cache/alphafox/engine-backtest/<hash>/`. Override with `ALPHAFOX_BACKTEST_WASM_DIR` / `ALPHAFOX_BACKTEST_RUNNER_DIR` / `ALPHAFOX_ENGINE_ROOT`, or `ALPHAFOX_USE_LOCAL_BACKTEST=1` for a sibling Engine build. Do not add `@alphafoxai/backtest-wasm` or `@alphafoxai/backtest-runner` as CLI dependencies.

## Public API catalog

CLI catalog is generated from `@alphafoxai/contracts/public-api`. Do not hand-edit `src/catalog/generated/*.json`. Run `node scripts/generate-catalog.mjs`. Prefer `ALPHAFOX_CONTRACTS_ROOT`, then sibling `../alphafox-contracts`, then other installed copies. A stale website `node_modules` registry must not win just because it has more rows.

Chat workbench, Chat Backtest (`backtests.*`), and Strategy Plaza (`strategy_plaza.*`) were removed from contracts `2.0.0`. Omit those prefixes at generate time as a safety net. Do not call them via typed commands, `schema`, or `alphafox api`. Local Engine WASM (`engine-backtest run`) and `engine_backtest.*` stay.

`trading.traders.create` must match the website Engine create body: `strategyDefinitionId` + `config` + `exchangeConnectorId` (+ `name`, `configSchemaVersion`). Do not invent `chatId` or integer `strategyId` to make create work. Hyperliquid / rebate copy use `trading.hl_copy_traders.create` / `trading.rebate_copy_traders.create`.

## Agent skills

### Issue tracker

Matt Skills engineering issues, specs, and tickets live in this repository's GitHub Issues; use the `gh` CLI for all operations. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the default triage labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Read the repository's domain vocabulary and ADR layout as described in `docs/agents/domain.md`.
