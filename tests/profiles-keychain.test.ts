import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  assertNoTokenFields,
  loadConfigFile,
  profileCredentialSlot,
  resolveProfile,
  saveConfigFile,
} from "../src/config/profiles";
import {
  credentialSlot,
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

  it("refuses config files that contain token fields", () => {
    assert.throws(() => assertNoTokenFields({ accessToken: "secret" }), /Forbidden/);
  });

  it("stores tokens outside config file path", () => {
    const dir = mkdtempSync(join(tmpdir(), "alphafox-cli-"));
    const env = {
      ALPHAFOX_CONFIG_DIR: dir,
      ALPHAFOX_KEYCHAIN_DIR: join(dir, "kc"),
      ALPHAFOX_FORCE_FILE_KEYCHAIN: "1",
    };
    const profile = resolveProfile("local", env);
    try {
      saveConfigFile({ activeProfile: "local", profiles: {} }, env);
      saveTokens(
        profile,
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
      const loaded = loadTokens(profile, env);
      assert.equal(loaded?.accessToken, "access-secret-value");
      const fileCfg = loadConfigFile(env);
      assert.equal(fileCfg.activeProfile, "local");
      deleteTokens(profile, env);
      assert.equal(loadTokens(profile, env), null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("rejects prototype keys and profile-name mismatches", () => {
    const dir = mkdtempSync(join(tmpdir(), "alphafox-profile-invalid-"));
    const env = { ALPHAFOX_CONFIG_DIR: dir };
    try {
      writeFileSync(join(dir, "config.json"), JSON.stringify({ activeProfile: "toString", profiles: {} }));
      assert.throws(() => loadConfigFile(env), /activeProfile/);
      writeFileSync(join(dir, "config.json"), JSON.stringify({ activeProfile: "production", profiles: { constructor: {} } }));
      assert.throws(() => loadConfigFile(env), /unknown profile/);
      writeFileSync(join(dir, "config.json"), JSON.stringify({ activeProfile: "production", profiles: { staging: { name: "production" } } }));
      assert.throws(() => loadConfigFile(env), /must be/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("separates same-label custom authorities into distinct slots", () => {
    const one = resolveProfile("local", {}, { unsafeCustomEndpoint: "http://127.0.0.1:3000/api/v1" });
    const two = resolveProfile("local", {}, { unsafeCustomEndpoint: "http://127.0.0.1:3001/api/v1" });
    assert.notEqual(profileCredentialSlot(one), profileCredentialSlot(two));
    assert.notEqual(credentialSlot(one), credentialSlot(two));
  });

  it("rejects token records bound to a different authority", () => {
    const dir = mkdtempSync(join(tmpdir(), "alphafox-profile-foreign-"));
    const env = { ALPHAFOX_KEYCHAIN_DIR: dir, ALPHAFOX_FORCE_FILE_KEYCHAIN: "1" };
    const profile = resolveProfile("local", env);
    try {
      assert.throws(() => saveTokens(profile, {
        accessToken: "a", refreshToken: "r", expiresAt: Date.now() + 1000,
        environment: profile.name, issuer: profile.issuer, audience: "http://127.0.0.1:3001/api/v1",
        clientId: profile.clientId, scopes: [],
      }, env), /credential/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
