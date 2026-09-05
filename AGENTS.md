# alphafox-cli

## Shared workflow

For AlphaFox development, load the workspace `AGENTS.md` once if it has not already been supplied. Resolve the workspace from `ALPHAFOX_WORKSPACE`, otherwise `~/Desktop/Projects/alphafox`; external task/Orca worktrees do not inherit that file by directory ancestry. Reuse it while unchanged. In another environment where it is absent, follow available repository instructions and the user's scope; obtain missing shared settings only when the operation needs them, without guessing tracker IDs or release permissions.

Agent and human entry for the versioned Public Application API on alphafox-web.

## Engine Backtest runtime

`alphafox engine-backtest run` vendors the tape runner (`vendor/backtest-runner`, plus `ccxt`) so public npm installs do not need GitHub Packages. The wasm / Node host is downloaded from the public Vercel Blob manifest (`engine-backtest/latest.json`) into `~/.cache/alphafox/engine-backtest/<hash>/`. Override with `ALPHAFOX_BACKTEST_WASM_DIR` / `ALPHAFOX_BACKTEST_RUNNER_DIR` / `ALPHAFOX_ENGINE_ROOT`, or `ALPHAFOX_USE_LOCAL_BACKTEST=1` for a sibling Engine build. Do not add `@alphafoxai/backtest-wasm` or `@alphafoxai/backtest-runner` as CLI dependencies.

## Public API catalog

CLI catalog is generated from `@alphafoxai/contracts/public-api`. Do not hand-edit `src/catalog/generated/*.json`. Run `node scripts/generate-catalog.mjs`. Prefer `ALPHAFOX_CONTRACTS_ROOT`, then sibling `../alphafox-contracts`, then other installed copies. A stale website `node_modules` registry must not win just because it has more rows.

Chat workbench, Chat Backtest (`backtests.*`), and Strategy Plaza (`strategy_plaza.*`) were removed from contracts `2.0.0`. Omit those prefixes at generate time as a safety net. Do not call them via typed commands, `schema`, or `alphafox api`. Local Engine WASM (`engine-backtest run`) and `engine_backtest.*` stay.

`trading.traders.create` must match the website Engine create body: `strategyDefinitionId` + `config` + `exchangeConnectorId` (+ `name`, `configSchemaVersion`). Do not invent `chatId` or integer `strategyId` to make create work. Hyperliquid / rebate copy use `trading.hl_copy_traders.create` / `trading.rebate_copy_traders.create`.

## Validation and delivery

Skill/说明文档变化：核对 frontmatter、版本、引用、命令入口和权限/完成边界，不运行真实交易。CLI 逻辑先跑相关测试和 typecheck；`pnpm test:release` 验证独立发布面。完整 `pnpm test` 还构建 Web bundle 并检查 catalog，涉及这些接缝时使用，记录依赖仓库的 ref。修改仓库 Skill 源文件，不覆盖已安装版本或顺手升级 CLI。

任务完成：请求范围已满足，相关检查和最终 diff 已复核，按授权交付提交/PR或本地产物，并说明剩余验收。复用同一候选的有效检查；缺少环境只阻塞依赖它的验证。移除本任务临时调试内容，不清理他人资源。部署/合并另需授权，不是默认的本地完成条件。

## Task and domain references

- On engineering task operations: `docs/agents/issue-tracker.md` (shared Feishu tracker).
- On triage: `docs/agents/triage-labels.md` (section/Type mapping).
- On domain terminology or architecture changes: `docs/agents/domain.md` (relevant glossary/ADR pointers).
