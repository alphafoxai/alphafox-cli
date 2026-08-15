---
name: alphafox-engine-backtest
description: Local Engine WASM backtest (alphafox engine-backtest run) vs catalog experiment CRUD vs chat backtests stub.
version: 0.2.0
---

# Engine Backtest

Always `--format json --no-input` (or `--format jsonl` when you need progress). Never `--token`. Tokens live in the OS keychain via `alphafox auth login`.

## Which command

| Intent | Use | Do not |
|---|---|---|
| Iterate a strategy locally (pull tape + run wasm + optional persist) | `alphafox engine-backtest run` (hyphen, built-in) | Do not treat this as server-side execution of `engine_backtest.experiments.byId.runs.create` |
| List / get / create / rename / delete experiments and persisted runs | Catalog `engine_backtest.*` (underscore) | Do not invent a second catalog |
| Chat-attached `/api/v1/backtests` job | `skills/strategy` + `backtests.*` | That stub is **not** the Engine WASM runner |

Read the create-experiment body with:

```bash
alphafox schema engine_backtest.experiments.create --format json --no-input
```

## Local run

Requires `@alphafoxai/backtest-wasm` and `@alphafoxai/backtest-runner` on disk (lazy-loaded; not CLI dependencies). Resolve each package independently:

1. Node `require.resolve`
2. `ALPHAFOX_BACKTEST_WASM_DIR` / `ALPHAFOX_BACKTEST_RUNNER_DIR`
3. `ALPHAFOX_ENGINE_ROOT` + `/npm/backtest-wasm` or `/npm/backtest-runner`
4. Sibling `../alphafox-engine/npm/...` relative to the CLI repo root

```bash
alphafox engine-backtest run \
  --experiment <uuid> \
  --definition grid \
  --config @./grid.json \
  --exchange binance \
  --range 2026-08-01..2026-08-08 \
  --initial-equity 10000 \
  --format jsonl --no-input
```

Also valid: `--from` / `--to` instead of `--range`. `--create-experiment --name "..."` when there is no `--experiment` (needs `strategyDefinitionId` + `strategyDefinitionDisplay` `{zh,en}`; pass `--definition-label-zh` / `--definition-label-en` or the CLI falls back to the definition id). Persisted runs use the account tier from `subscriptions.me.get`; if `--tier` is supplied, it must match. With `--no-persist`, `runs.create` is skipped and `--tier` may simulate `free|pro|pro_max` (default `pro`). `--data-quality` defaults to `strict`. `--replay-timeframe` defaults to `1m` (allowed `1m|3m|5m|15m|30m|1h|4h`); this is the replay/download bar and is merged with plan indicator timeframes so a 4h RSI grid still replays on 1m. `runs.create` is `write`, not `high-risk-write` — do not add `--yes`. Do not update or delete experiments through this command.

`--format jsonl` writes one JSON object per progress line (`{event:"progress",stage,fraction}`), then a final `{ok:true,data:{...}}` envelope.

## Iterate

1. Edit config JSON.
2. `engine-backtest run` (reuse `--experiment` after the first create).
3. Read `data.metrics` / `data.engineVersion` / `data.runId` / `data.experimentUrl`.
4. Adjust parameters and run again. Do not invent a token flag if persist returns 401 — `alphafox auth login`.

## Safety

- Unauthenticated persist/create fails like `whoami` (HTTP 401, exit 77).
- `strict` data quality: missing/gapped tape **stops**. Do not retry as `basic` unless the operator asks.
- `planBacktest` unsupported → fail with the plan reason. Do not degrade to a guessed universe.
- Catalog `engine_backtest.experiments.byId.update` / `.delete` are high-risk-write and are **not** this command.

## operationIds (catalog only)

- `engine_backtest.experiments.create` / `.list` / `.byId.get`
- `engine_backtest.experiments.byId.runs.create` / `.list`
- High-risk (not this skill's run path): `engine_backtest.experiments.byId.update` / `.byId.delete` / `.byId.runs.byId.delete`
