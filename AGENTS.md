# alphafox-cli

Versioned CLI entry for the Public Application API on alphafox-web.

## Workspace

Load `$ALPHAFOX_WORKSPACE/AGENTS.md`, or `~/Desktop/Projects/alphafox/AGENTS.md` when unset; external worktrees do not inherit it. Keep CLI changes on this task worktree and authorize deployment, merge, production access, and credentials separately.

## Catalog and create boundaries

- Generate the catalog with `node scripts/generate-catalog.mjs`; treat `src/catalog/generated/*.json` as output. Resolve contracts from `ALPHAFOX_CONTRACTS_ROOT`, sibling `../alphafox-contracts`, then an installed copy.
- Route Chat workbench, Chat Backtest (`backtests.*`), Strategy Plaza (`strategy_plaza.*`), and web `/api/v1/backtests` through alphafox-web. Keep those prefixes out of the CLI catalog; use `alphafox engine-backtest run|sweep` for local Engine WASM and `engine_backtest.*` for persisted experiments.
- Build `trading.traders.create` from the website body: `strategyDefinitionId`, `config`, `exchangeConnectorId`, optional `name` and `configSchemaVersion`. Keep Chat fields such as `chatId` and integer `strategyId` in web contracts. Route Hyperliquid/rebate copy through `trading.hl_copy_traders.create` / `trading.rebate_copy_traders.create`.

## Safe command sequence

- Run `alphafox auth login`; default storage prefers the OS keychain but permits plaintext file fallback. Set `ALPHAFOX_REQUIRE_OS_KEYCHAIN=1` for every invocation when OS-only storage is required; it rejects force-file/test-token overrides and does not migrate or delete legacy files. Use `--format json --no-input` (or `--format jsonl` for progress); for each cataloged write, read `alphafox schema <operationId>`, validate the body (`--config @file` for large input), preview with `--dry-run`, then use `--yes` after matching explicit approval.
- Resolve symbols with `alphafox resolve-symbols` before strategy, backtest, or write input; carry the returned `assetClass` into the operation.
- Run local backtests with `alphafox engine-backtest run|sweep`; use `--no-persist` for zero-write work, let a requested sweep persist one completed summary, surface `coverageNotice` (`basic` stops missing/corrupt tape; `strict` stops any gap), preserve the requested range/data-quality mode, include `https://www.alphafox.app/zh/dashboard/traders/backtest/{experimentId}` after persistence, and keep live trader creation separately approved. Read `skills/engine-backtest/SKILL.md` for runtime, cache, and dashboard gates.

## Validation and tracker

- Documentation/Skill changes: check frontmatter, references, command entry points, permission gates, and completion boundaries with fixtures or sandbox operations. CLI changes: run focused tests and typecheck, then `pnpm test:release`; use full `pnpm test` for catalog/Web-bundle seams.
- Use `package.json` commands, review the diff, and report verification plus remaining acceptance. Engineering tasks use GitHub Issues as declared in this revision's `docs/agents/issue-tracker.md`; read it before issue operations.
- Triage mapping: `docs/agents/triage-labels.md`. Domain vocabulary and ADR pointers: `docs/agents/domain.md`.
