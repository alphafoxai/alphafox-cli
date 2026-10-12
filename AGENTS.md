# alphafox-cli

Versioned CLI entry for the Public Application API on alphafox-web.

<!-- BEGIN alphafox-workspace pointer -->
## AlphaFox workspace

This repository is one of the AlphaFox repositories that sit beside
[`alphafox-workspace`](../alphafox-workspace/AGENTS.md). Read that file once per session
before changing anything here; it holds the rules that bind every repository, the project
map, and the development and documentation skills. In a worktree outside the parent
directory, read `$ALPHAFOX_WORKSPACE/AGENTS.md` instead. When neither resolves, say so,
follow this file, and ask for the shared settings an operation needs rather than guessing
tracker IDs, release permissions, or deployment facts.

- **Documents:** every document added or changed here follows the workspace
  [documentation standard](../alphafox-workspace/docs/documentation-standard.md); load its
  `alphafox-doc` skill before writing.
- **Decisions:** a non-trivial change records its rationale as an Agent Note in this
  repository's `.agents/notes/` in the same change. A decision that binds other
  repositories goes in the workspace `notes/workspace/` instead.
- **Cross-repository changes:** a change that reaches another repository, a schema, a
  contract, an external resource, or `alphafox-infra` also gets a workspace Change Set.
- **Other repositories:** find the owner in the workspace
  [project map](../alphafox-workspace/docs/projects.md) and read it from `../<repository>`.

Where `.alphafox/workspace.yaml` exists, it pins the workspace revision this repository was
last reconciled with, and CI checks governance against that revision.
<!-- END alphafox-workspace pointer -->

## Delivery

Keep CLI changes on a task worktree and authorize deployment, merge, production access, and credentials separately.

## Catalog and create boundaries

- Generate the catalog with `node scripts/generate-catalog.mjs`; treat `src/catalog/generated/*.json` as output. Resolve contracts from `ALPHAFOX_CONTRACTS_ROOT`, sibling `../alphafox-contracts`, then an installed copy.
- Route Chat workbench, Chat Backtest (`backtests.*`), Strategy Plaza (`strategy_plaza.*`), and web `/api/v1/backtests` through alphafox-web. Keep those prefixes out of the CLI catalog; use `alphafox engine-backtest run|sweep` for local Engine WASM and `engine_backtest.*` for persisted experiments.
- Build `trading.traders.create` from the website body: `strategyDefinitionId`, `config`, `exchangeConnectorId`, optional `name` and `configSchemaVersion`. Keep Chat fields such as `chatId` and integer `strategyId` in web contracts. Route Hyperliquid/rebate copy through `trading.hl_copy_traders.create` / `trading.rebate_copy_traders.create`.

## Safe command sequence

- Run `alphafox auth login` and keep tokens in the OS keychain. Use `--format json --no-input` (or `--format jsonl` for progress); for each cataloged write, read `alphafox schema <operationId>`, validate the body (`--config @file` for large input), preview with `--dry-run`, then use `--yes` after matching explicit approval.
- Resolve symbols with `alphafox resolve-symbols` before strategy, backtest, or write input; carry the returned `assetClass` into the operation.
- Run local backtests with `alphafox engine-backtest run|sweep`; use `--no-persist` for zero-write work, let a requested sweep persist one completed summary, surface `coverageNotice` (`basic` stops missing/corrupt tape; `strict` stops any gap), preserve the requested range/data-quality mode, include `https://www.alphafox.app/zh/dashboard/traders/backtest/{experimentId}` after persistence, and keep live trader creation separately approved. Read `skills/engine-backtest/SKILL.md` for runtime, cache, and dashboard gates.

## Validation and tracker

- Documentation/Skill changes: check frontmatter, references, command entry points, permission gates, and completion boundaries with fixtures or sandbox operations. CLI changes: run focused tests and typecheck, then `pnpm test:release`; use full `pnpm test` when the catalog contract must be re-verified, which needs a resolvable contracts checkout.
- Do not re-add a compiled copy of alphafox-web's OAuth or public-API handlers to this test build. That seam was removed: copying the Web implementation into the test could not detect the drift it existed to catch, since a changed handler was copied in and the test kept passing. The vertical slice is owned by `alphafox-web` (`tests/cli-oauth-mvp-integration.test.ts`, `tests/oauth-client-env-binding.test.ts`, `tests/oauth-scopes.test.ts`). Test CLI-side behavior against its own request, PKCE, token-storage, and catalog code.
- Use `package.json` commands, review the diff, and report verification plus remaining acceptance. Engineering tasks use GitHub Issues as declared in this revision's `docs/agents/issue-tracker.md`; read it before issue operations.
- Triage mapping: `docs/agents/triage-labels.md`. Domain vocabulary and ADR pointers: `docs/agents/domain.md`.
