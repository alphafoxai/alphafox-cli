import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { EngineBacktestError } from "../src/engine-backtest/errors";
import {
  assertEngineBacktestConfig,
  loadEngineBacktestConfig,
} from "../src/engine-backtest/load-config";
import {
  parseEngineBacktestRunArgs,
  parseEngineBacktestSweepArgs,
} from "../src/engine-backtest/parse-args";
import {
  executeEngineBacktestRun,
  type EngineBacktestCliFlags,
} from "../src/engine-backtest/run-command";
import { executeEngineBacktestSweep } from "../src/engine-backtest/sweep-command";

const FLAGS: EngineBacktestCliFlags = {
  format: "json",
  yes: false,
  dryRun: false,
  noInput: true,
  profile: "local",
};

const ENVELOPE = {
  configSchemaVersion: 4,
  config: { common: {}, strategy: {} },
};

function isEnvelopeError(err: unknown): boolean {
  assert.ok(err instanceof EngineBacktestError);
  assert.equal(err.subtype, "validate_config_envelope");
  assert.match(err.message, /validate_config HTTP body/);
  assert.match(String(err.hint), /common, strategy/);
  return true;
}

describe("engine-backtest --config shape", () => {
  it("accepts the inner trader config", () => {
    const config = { common: { symbols: ["BTC/USDT:USDT"] }, strategy: {} };
    assert.doesNotThrow(() => assertEngineBacktestConfig(config));
    assert.deepEqual(
      loadEngineBacktestConfig(JSON.stringify(config)),
      config
    );
  });

  it("rejects the validate_config HTTP envelope", () => {
    assert.throws(
      () => assertEngineBacktestConfig(ENVELOPE),
      isEnvelopeError
    );
    assert.throws(
      () => loadEngineBacktestConfig(JSON.stringify({ config: { common: {} } })),
      isEnvelopeError
    );
  });

  it("rejects a nested config object even when trader keys are also present", () => {
    assert.throws(
      () =>
        assertEngineBacktestConfig({
          common: {},
          strategy: {},
          config: { common: {} },
        }),
      isEnvelopeError
    );
  });

  it("does not treat a trader field named config as an envelope unless it is an object", () => {
    assert.doesNotThrow(() =>
      assertEngineBacktestConfig({ common: {}, strategy: {}, config: "x" })
    );
  });

  it("rejects the envelope on run before planning", async () => {
    await assert.rejects(
      () =>
        executeEngineBacktestRun(
          parseEngineBacktestRunArgs([
            "--experiment",
            "11111111-1111-1111-1111-111111111111",
            "--definition",
            "grid",
            "--config",
            JSON.stringify(ENVELOPE),
            "--exchange",
            "binance",
            "--range",
            "2026-08-01..2026-08-08",
            "--initial-equity",
            "10000",
            "--no-persist",
          ]),
          FLAGS,
          { ALPHAFOX_CONFIG_DIR: mkdtempSync(join(tmpdir(), "alphafox-cfg-")) },
          {
            createNodeBacktestClient: () => {
              throw new Error("must not plan");
            },
          }
        ),
      isEnvelopeError
    );
  });

  it("rejects the envelope on sweep before planning", async () => {
    await assert.rejects(
      () =>
        executeEngineBacktestSweep(
          parseEngineBacktestSweepArgs([
            "--experiment",
            "11111111-1111-1111-1111-111111111111",
            "--definition",
            "grid",
            "--config",
            JSON.stringify(ENVELOPE),
            "--axes",
            "[]",
            "--exchange",
            "binance",
            "--range",
            "2026-08-01..2026-08-08",
            "--initial-equity",
            "10000",
            "--no-persist",
          ]),
          FLAGS,
          { ALPHAFOX_CONFIG_DIR: mkdtempSync(join(tmpdir(), "alphafox-cfg-")) },
          {
            createNodeBacktestClient: () => {
              throw new Error("must not plan");
            },
          }
        ),
      isEnvelopeError
    );
  });
});
