---
name: alphafox-engine-backtest
description: Local Engine WASM backtest (alphafox engine-backtest run|sweep) vs catalog experiment CRUD.
version: 0.3.4
---

# Engine Backtest

Always `--format json --no-input` (or `--format jsonl` when you need progress). Never `--token`. Tokens live in the OS keychain via `alphafox auth login`.

Human-mentioned tickers must be resolved with `alphafox resolve-symbols` (`skills/market`) before they go into `--config`. Use `data.queries[].resolved` only when `status` is `exact`, or `close` after confirming with the human. Do not invent `BTC/USDT:USDT`. Aster is in the public catalog but is **not** an Engine tape source.

## Which command

| Intent | Use | Do not |
|---|---|---|
| Iterate a strategy locally (pull tape + run wasm + optional persist) | `alphafox engine-backtest run` (hyphen, built-in) | Do not treat this as server-side execution of `engine_backtest.experiments.byId.runs.create` |
| Local parameter search with explicit axes; persist one Sweep after completion | `alphafox engine-backtest sweep` | Never loop `runs.create` per coordinate. Do not call Chat `backtests.*` |
| Local search with zero writes | `alphafox engine-backtest sweep ... --no-persist` | Do not persist a cancelled or incomplete search |
| List / get / delete persisted Sweeps | Catalog `engine_backtest.experiments.byId.sweeps.*` | Do not invent a second catalog. Delete is high-risk and needs `--yes` |
| List / get / create / rename / delete experiments and persisted runs | Catalog `engine_backtest.*` (underscore) | Do not invent a second catalog |
| Chat-attached `/api/v1/backtests` job | — | Not a CLI surface. Do not call `backtests.*` or `/api/v1/backtests` |

Read the create-experiment body with `alphafox schema` **before** composing JSON. Do not invent experiment fields. Large create/run/sweep payloads use `--config @file`, never a guessed `--body`.

```bash
alphafox schema engine_backtest.experiments.create --format json --no-input
alphafox engine_backtest experiments create --config @./experiment.json --format json --no-input
alphafox schema engine_backtest.experiments.byId.sweeps.create --format json --no-input
```

## Local run

The tape runner ships inside the CLI (plus `ccxt` for public-market pulls). The wasm / Node host is downloaded from the public Vercel Blob manifest (`engine-backtest/latest.json`) into `~/.cache/alphafox/engine-backtest/<hash>/` on first run.

Local overrides, in order:

1. `ALPHAFOX_BACKTEST_WASM_DIR` / `ALPHAFOX_BACKTEST_RUNNER_DIR`
2. `ALPHAFOX_ENGINE_ROOT` + `/npm/backtest-wasm` or `/npm/backtest-runner`
3. Sibling `../alphafox-engine/npm/...` only when `ALPHAFOX_USE_LOCAL_BACKTEST=1`

Do not install `@alphafoxai/backtest-wasm` or `@alphafoxai/backtest-runner` from GitHub Packages.

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

## Local sweep

`alphafox engine-backtest sweep` reuses the same Experiment / definition / config / exchange / range / initial equity / replay timeframe / data quality / execution model / tier flags as `run`. Axes are explicit JSON (`--axes @file`); each axis must name a config path and `min`/`max`/`step` or `values`. The command does not guess parameter paths.

```bash
alphafox engine-backtest sweep \
  --experiment <uuid> \
  --definition grid \
  --config @./grid.json \
  --axes @./axes.json \
  --exchange binance \
  --range 2026-08-01..2026-08-08 \
  --initial-equity 10000 \
  --mode neighborhood \
  --search-mode standard \
  --format jsonl --no-input
```

`--mode` is `neighborhood|range`. `--search-mode` is `standard|fast`. `--concurrency` is 1–8; Free is always serial. After every local coordinate finishes, the command POSTs **one** `engine_backtest.experiments.byId.sweeps.create` summary (4 MiB / point-error caps). It never calls `runs.create` per coordinate and never writes Tape, curves, or full configs. `--no-persist` stays zero-write. A cancelled or incomplete search is not persisted. The same `clientSweepId` is reused if you rebuild the create body for retry; unknown write results (no Sweep id) fail instead of reporting `persisted: true`.

`--format jsonl` includes `planning`, `tape`, `sweep`, and `persist` stages. The final envelope includes counts, `elapsedMs`, best coordinate/config, `sweepId`, `persisted`, and an Experiment URL with `?tab=sweep`.

Read / delete history through typed catalog commands. Delete is high-risk-write:

```bash
alphafox engine_backtest experiments sweeps list --experimentId <uuid> --format json --no-input
alphafox engine_backtest experiments sweeps get --experimentId <uuid> --sweepId <uuid> --format json --no-input
alphafox engine_backtest experiments sweeps delete --experimentId <uuid> --sweepId <uuid> --yes --format json --no-input
```

Owner isolation and 7-day expiry are enforced by the server. Applying a coordinate to a formal Run is a separate `engine-backtest run`.

## Iterate

1. Edit config JSON.
2. `engine-backtest run` (reuse `--experiment` after the first create).
3. Read `data.metrics` / `data.engineVersion` / `data.runId` / `data.experimentUrl`.
4. Adjust parameters and run again. Do not invent a token flag if persist returns 401 — `alphafox auth login`.

## Safety

- Unauthenticated persist/create fails like `whoami` (HTTP 401, exit 77).
- `strict` data quality: missing/gapped tape **stops**. Do not retry as `basic` unless the operator asks.
- `planBacktest` unsupported → fail with the plan reason. Do not degrade to a guessed universe.
- Catalog `engine_backtest.experiments.byId.update` / `.delete` / `.sweeps.byId.delete` are high-risk-write and are **not** this command's run/sweep path.

## operationIds (catalog only)

- `engine_backtest.experiments.create` / `.list` / `.byId.get`
- `engine_backtest.experiments.byId.runs.create` / `.list`
- `engine_backtest.experiments.byId.sweeps.create` / `.list`
- `engine_backtest.experiments.byId.sweeps.byId.get`
- High-risk (not this skill's run/sweep path): `engine_backtest.experiments.byId.update` / `.byId.delete` / `.byId.runs.byId.delete` / `.byId.sweeps.byId.delete`

Chat `backtests.*` is not an Engine Sweep or Engine Run surface. Do not call it from this skill.
