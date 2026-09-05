---
name: alphafox-cache
description: Inspect and clean local Engine backtest caches (downloaded OHLCV tape and wasm runtime). Use when the user asks to 清理缓存, free disk, or after a large historical backtest.
version: 0.3.22
---

# Cache

Always `--format json --no-input`. Never `--token`. This is local disk only.

`engine-backtest run|sweep` writes closed OHLCV into the **tape** cache (`~/.alphafox/cache/engine-backtest`, or `ALPHAFOX_TAPE_CACHE_DIR`). The wasm / Node host lives under the **runtime** cache (`~/.cache/alphafox/engine-backtest/<hash>/`). Tape is the large historical download.

## Status first

```bash
alphafox cache status --format json --no-input
```

Read `data.tape.bytes`, `data.tape.files`, `data.tape.large`, `data.remindAfterBytes`. `large` is true when tape bytes ≥ `remindAfterBytes` (512 MiB).

When cleanup was not requested and `data.tape.large` is true, first deliver the backtest result, then offer:

**回测下载的历史数据比较大，要不要我帮你清理本地缓存？**

An explicit request to clean this cache or approval of this offer authorizes the displayed scope; do not ask twice. A size notice alone does not authorize deletion. Extra runtime/all-cache deletion needs its own scope.

## Clean

Default clean is **tape only** (historical bars). Runtime re-downloads on the next run; only add `--runtime` or `--all` when the operator asks.

```bash
alphafox cache clean --dry-run --format json --no-input
alphafox cache clean --yes --format json --no-input
```

`--yes` is required to delete. `--dry-run` reports what would be removed. After clean, `data.bytesFreed` is the space recovered.

Do not `rm` cache paths by hand. Do not delete `~/.config/alphafox` (config / skills state / keychain).
