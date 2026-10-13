# Runtime discovery migration

New CLI releases discover the protocol-1 runtime through the environment's Engine API and download the same nine files from GCS / Cloud CDN. SHA256 runtime verification and the existing content cache remain enabled. `--profile staging` selects staging; production selects production. A local profile requires an explicit manifest URL or local runtime build.

`ALPHAFOX_BACKTEST_WASM_MANIFEST_URL` remains an explicit override. Discovery errors are reported; no automatic switch to the old Blob URL occurs.

Historical packages keep their original Blob endpoint and frozen compatible files. The support end date is not yet defined; do not delete them based on a short period of low traffic. Upgrade with `npm install -g @alphafox/cli` after the new release has been published. A PR is not an npm release.

## Current source reading (2026-10-13)

This section is a reading of `alphafox-cli` at `ef5086d7a`.
It does not change the GCS / CDN promises above.
Archive conversion source: [`apps/cli/docs/subsystems/engine-backtest-runtime-discovery.md`](https://github.com/alphafoxai/alphafox-monorepo/blob/b4e9454de2e196dac80a9a89f94a22bf98e03f5f/apps/cli/docs/subsystems/engine-backtest-runtime-discovery.md).
The archive’s monorepo `apps/engine` sibling preference is not current and is not restored.

Local package resolution in [`resolve-packages.ts`](../src/engine-backtest/resolve-packages.ts) is:

1. `ALPHAFOX_BACKTEST_WASM_DIR` if set; an invalid explicit directory fails.
2. `ALPHAFOX_ENGINE_ROOT` plus `npm/<package>` if set; an invalid root fails.
3. Only when `ALPHAFOX_USE_LOCAL_BACKTEST=1`, the independent-repo sibling `../alphafox-engine/npm/<package>` from the CLI root.

There is no silent fallback from a failed explicit local source to remote discovery, and no `apps/engine` path.

Without an explicit local source, [`resolveBacktestWasmManifestUrl`](../src/engine-backtest/fetch-runtime.ts) uses `ALPHAFOX_BACKTEST_WASM_MANIFEST_URL`, else staging `https://staging-api.alphafox.app/control-plane/v1/backtest/runtime-manifest`, else production `https://api.alphafox.app/control-plane/v1/backtest/runtime-manifest`.
A local profile without an override throws `runtime_manifest_unconfigured`.

Manifest and asset downloads use `fetch` with `cache: "no-cache"` and no `Authorization` header.
That path is not the product OAuth client.
Web’s runtime consumer is a different implementation; a CLI guarantee is not a Web guarantee.

Protocol must be `1`.
The fingerprint is the first 16 lowercase hex characters of SHA-256 over nine files in a fixed order.
It is not a per-file digest, a signature, or an OAuth token.

This reading did not download a manifest or execute WASM.
