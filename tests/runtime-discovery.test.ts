import assert from "node:assert/strict";
import test from "node:test";
import { resolveBacktestWasmManifestUrl } from "../src/engine-backtest/fetch-runtime";

test("runtime discovery isolates profiles and preserves explicit override", () => {
  assert.equal(resolveBacktestWasmManifestUrl({ALPHAFOX_PROFILE:"production"}), "https://api.alphafox.app/control-plane/v1/backtest/runtime-manifest");
  assert.equal(resolveBacktestWasmManifestUrl({ALPHAFOX_PROFILE:"staging"}), "https://staging-api.alphafox.app/control-plane/v1/backtest/runtime-manifest");
  assert.equal(resolveBacktestWasmManifestUrl({ALPHAFOX_PROFILE:"local", ALPHAFOX_BACKTEST_WASM_MANIFEST_URL:"https://example.test/pinned.json"}), "https://example.test/pinned.json");
  assert.throws(() => resolveBacktestWasmManifestUrl({ALPHAFOX_PROFILE:"local"}));
});
