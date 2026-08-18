import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
    assert.equal(prod.apiBaseUrl, "https://www.alphafox.app/api/v1");
    assert.equal(prod.issuer, "https://alphafox.app/api/auth");
    assert.equal(prod.audience, "https://alphafox.app/api/v1");
    assert.equal(prod.clientId, "alphafox-cli-prod");
    assert.equal(staging.clientId, "alphafox-cli-staging");
    assert.notEqual(prod.issuer, staging.issuer);
    assert.notEqual(prod.audience, staging.audience);
  });

  it("refuses config files that contain token fields", () => {
    assert.throws(() => assertNoTokenFields({ accessToken: "secret" }), /Forbidden/);
  });
  it("rejects nested credential-shaped config fields", () => {
    assert.throws(
      () =>
        assertNoTokenFields({
          profiles: { local: { metadata: { refreshToken: "secret" } } },
        }),
      /Forbidden config field: refreshToken/
    );
  });

  it("defaults omitted profiles to an empty map", () => {
    const dir = mkdtempSync(join(tmpdir(), "alphafox-profile-default-"));
    const env = { ALPHAFOX_CONFIG_DIR: dir };
    try {
      writeFileSync(
        join(dir, "config.json"),
        JSON.stringify({ activeProfile: "production" })
      );
      assert.equal(resolveProfile(undefined, env).name, "production");
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
  it("refuses to read file credentials with permissive mode", () => {
    const dir = mkdtempSync(join(tmpdir(), "alphafox-profile-mode-"));
    const env = {
      ALPHAFOX_KEYCHAIN_DIR: dir,
      ALPHAFOX_FORCE_FILE_KEYCHAIN: "1",
    };
    const profile = resolveProfile("local", env);
    try {
      const saved = saveTokens(profile, {
        accessToken: "a",
        refreshToken: "r",
        expiresAt: Date.now() + 1000,
        environment: profile.name,
        issuer: profile.issuer,
        audience: profile.audience,
        clientId: profile.clientId,
        scopes: [],
      }, env);
      assert.equal(saved.backend, "file");
      chmodSync(saved.path!, 0o644);
      assert.throws(
        () => loadTokens(profile, env),
        (error: unknown) => {
          assert.equal((error as { subtype?: string }).subtype, "file_keychain_insecure");
          return true;
        }
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("migrates authority-valid legacy file credentials and removes the old slot", () => {
    const dir = mkdtempSync(join(tmpdir(), "alphafox-profile-legacy-"));
    const env = { ALPHAFOX_KEYCHAIN_DIR: dir, ALPHAFOX_FORCE_FILE_KEYCHAIN: "1" };
    const profile = resolveProfile("local", env);
    const legacyPath = join(dir, "local.tokens.json");
    try {
      writeFileSync(legacyPath, JSON.stringify({
        accessToken: "legacy-access",
        refreshToken: "legacy-refresh",
        expiresAt: Date.now() + 60_000,
        environment: profile.name,
        issuer: profile.issuer,
        audience: profile.audience,
        clientId: profile.clientId,
        scopes: ["openid"],
      }), { mode: 0o600 });

      assert.equal(loadTokens(profile, env)?.accessToken, "legacy-access");
      assert.equal(existsSync(legacyPath), false);
      assert.equal(loadTokens(profile, env)?.accessToken, "legacy-access");
      deleteTokens(profile, env);
      assert.equal(loadTokens(profile, env), null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("migrates the previous production apex-hash file slot and logout removes both", () => {
    const dir = mkdtempSync(join(tmpdir(), "alphafox-profile-apex-"));
    const env = { ALPHAFOX_KEYCHAIN_DIR: dir, ALPHAFOX_FORCE_FILE_KEYCHAIN: "1" };
    const profile = resolveProfile("production", env);
    const previous = { ...profile, apiBaseUrl: "https://alphafox.app/api/v1" };
    const previousPath = join(dir, `${profileCredentialSlot(previous)}.tokens.json`);
    const currentPath = join(dir, `${profileCredentialSlot(profile)}.tokens.json`);
    const tokens = {
      accessToken: "apex-access",
      refreshToken: "apex-refresh",
      expiresAt: Date.now() + 60_000,
      environment: profile.name,
      issuer: profile.issuer,
      audience: profile.audience,
      clientId: profile.clientId,
      scopes: ["openid"],
    };
    try {
      writeFileSync(previousPath, JSON.stringify(tokens), { mode: 0o600 });
      assert.equal(loadTokens(profile, env)?.accessToken, "apex-access");
      assert.equal(existsSync(previousPath), false);
      assert.equal(existsSync(currentPath), true);

      writeFileSync(previousPath, JSON.stringify(tokens), { mode: 0o600 });
      deleteTokens(profile, env);
      assert.equal(existsSync(currentPath), false);
      assert.equal(existsSync(previousPath), false);
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
