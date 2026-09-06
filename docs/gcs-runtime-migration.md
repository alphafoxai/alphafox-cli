# Runtime discovery migration

New CLI releases discover the protocol-1 runtime through the environment's Engine API and download the same nine files from GCS / Cloud CDN. SHA256 runtime verification and the existing content cache remain enabled. `--profile staging` selects staging; production selects production. A local profile requires an explicit manifest URL or local runtime build.

`ALPHAFOX_BACKTEST_WASM_MANIFEST_URL` remains an explicit override. Discovery errors are reported; no automatic switch to the old Blob URL occurs.

Historical packages keep their original Blob endpoint and frozen compatible files. The support end date is not yet defined; do not delete them based on a short period of low traffic. Upgrade with `npm install -g @alphafox/cli` after the new release has been published. A PR is not an npm release.
