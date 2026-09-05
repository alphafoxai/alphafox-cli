import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  assertNoTokenFields,
  loadConfigFile,
  resolveProfile,
  saveConfigFile,
} from "../src/config/profiles";
import {
  deleteTokens,
  loadTokens,
  saveTokens,
} from "../src/keychain/store";

describe("profiles + keychain boundary", () => {
  it("resolves production defaults with distinct issuer/audience", () => {
    const prod = resolveProfile("production", {});
    const staging = resolveProfile("staging", {});
    assert.equal(prod.clientId, "alphafox-cli-prod");
    assert.equal(staging.clientId, "alphafox-cli-staging");
    assert.notEqual(prod.issuer, staging.issuer);
    assert.notEqual(prod.audience, staging.audience);
  });

  it("refuses nested credential fields at load and save boundaries", () => {
    assert.throws(
      () =>
        assertNoTokenFields({
          profiles: { staging: { accessToken: "secret" } },
        }),
      /accessToken/
    );
    assert.throws(
      () => assertNoTokenFields({ profiles: [{ private_key: "secret" }] }),
      /private_key/
    );
    assert.throws(
      () => assertNoTokenFields({ profiles: { staging: { passphrase: "secret" } } }),
      /passphrase/
    );
    assert.throws(
      () =>
        assertNoTokenFields({
          profiles: { staging: { code_verifier: "secret" } },
        }),
      /code_verifier/
    );

    const dir = mkdtempSync(join(tmpdir(), "alphafox-cli-config-secrets-"));
    const env = { ALPHAFOX_CONFIG_DIR: dir };
    try {
      writeFileSync(
        join(dir, "config.json"),
        JSON.stringify({
          activeProfile: "staging",
          profiles: { staging: { refreshToken: "secret" } },
        })
      );
      assert.throws(() => loadConfigFile(env), /tokens\/secrets/);
      writeFileSync(
        join(dir, "config.json"),
        JSON.stringify({
          activeProfile: "staging",
          profiles: { staging: { deviceCode: "secret" } },
        })
      );
      assert.throws(() => loadConfigFile(env), /invalid fields/);
      writeFileSync(
        join(dir, "config.json"),
        JSON.stringify({
          activeProfile: { authorizationCode: "secret" },
          profiles: {},
        })
      );
      assert.throws(() => loadConfigFile(env), /invalid fields/);
      assert.throws(
        () =>
          saveConfigFile(
            {
              activeProfile: "staging",
              profiles: {
                staging: { accessToken: "secret" } as never,
              },
            },
            env
          ),
        /accessToken/
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("stores tokens outside config file path", () => {
    const dir = mkdtempSync(join(tmpdir(), "alphafox-cli-"));
    const env = {
      ALPHAFOX_CONFIG_DIR: dir,
      ALPHAFOX_KEYCHAIN_DIR: join(dir, "kc"),
      ALPHAFOX_FORCE_FILE_KEYCHAIN: "1",
    };
    try {
      saveConfigFile({ activeProfile: "local", profiles: {} }, env);
      saveTokens(
        "local",
        {
          accessToken: "access-secret-value",
          refreshToken: "refresh-secret-value",
          expiresAt: Date.now() + 60_000,
          environment: "local",
          issuer: "http://127.0.0.1:3000/api/auth",
          audience: "http://127.0.0.1:3000/api/v1",
          clientId: "alphafox-cli-local",
          scopes: ["openid"],
        },
        env
      );
      const cfg = readFileSync(join(dir, "config.json"), "utf8");
      assert.equal(cfg.includes("access-secret-value"), false);
      assert.equal(cfg.includes("refresh-secret-value"), false);
      assert.equal(cfg.includes("token"), false);
      const loaded = loadTokens("local", env);
      assert.equal(loaded?.accessToken, "access-secret-value");
      const fileCfg = loadConfigFile(env);
      assert.equal(fileCfg.activeProfile, "local");
      deleteTokens("local", env);
      assert.equal(loadTokens("local", env), null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
