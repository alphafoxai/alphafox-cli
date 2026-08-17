# alphafox-cli

Agent and human entry for the versioned Public Application API on alphafox-web.

## Engine Backtest runtime

`alphafox engine-backtest run` vendors the tape runner (`vendor/backtest-runner`, plus `ccxt`) so public npm installs do not need GitHub Packages. The wasm / Node host is downloaded from the public Vercel Blob manifest (`engine-backtest/latest.json`) into `~/.cache/alphafox/engine-backtest/<hash>/`. Override with `ALPHAFOX_BACKTEST_WASM_DIR` / `ALPHAFOX_BACKTEST_RUNNER_DIR` / `ALPHAFOX_ENGINE_ROOT`, or `ALPHAFOX_USE_LOCAL_BACKTEST=1` for a sibling Engine build. Do not add `@alphafoxai/backtest-wasm` or `@alphafoxai/backtest-runner` as CLI dependencies.

## Public API catalog

CLI catalog is generated from `@alphafoxai/contracts/public-api`. Do not hand-edit `src/catalog/generated/*.json`. Run `node scripts/generate-catalog.mjs`. The generator picks the largest available Operation Registry (sibling contracts, website `node_modules`, or `ALPHAFOX_CONTRACTS_ROOT`) and overlays sibling `createTrader` when that schema is already Engine-shaped. A stale sibling registry must not drop `engine_backtest` sweeps.

Chat product (`chats.*`, `chat_summaries.*`) and web `/api/v1/backtests` (`backtests.*`) are **not** a CLI surface. Omit them at generate time. Do not call them via typed commands, `schema`, or `alphafox api`. Local Engine WASM (`engine-backtest run`) and `engine_backtest.*` stay.

`trading.traders.create` must match the website Engine create body: `strategyDefinitionId` + `config` + `exchangeConnectorId` (+ `name`, `configSchemaVersion`). Do not invent `chatId` or integer `strategyId` to make create work. Those fields belong to the Chat compile path (`traderInit*`, trader snapshots, `backtests.create`), not Engine instantiate. Hyperliquid / rebate copy use `trading.hl_copy_traders.create` / `trading.rebate_copy_traders.create`.

Do not remove chat schemas from alphafox-contracts, and do not set `chats.*` `includeInCli: false`. The website chat product and `/api/v1` allowlist still use them. Chat is omitted only on the CLI surface.

## Agent skills

### Issue tracker

Matt Skills engineering issues, specs, and tickets live in the shared Feishu `AlphaFox-Issues` tasklist; prefix titles with `[alphafox-cli]`. See `docs/agents/issue-tracker.md`.

### Triage labels

Triage roles map to Feishu tasklist sections, while issue categories use the `Type` field. See `docs/agents/triage-labels.md`.

### Domain docs

Read the repository's domain vocabulary and ADR layout as described in `docs/agents/domain.md`.
