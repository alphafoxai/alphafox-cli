import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { linuxSecretServiceArgs } from "../src/keychain/linux-secret-service";
import { windowsCredentialTarget } from "../src/keychain/windows-credential";
import {
  deleteTokens,
  loadTokens,
  probeOsKeychain,
  saveTokens,
  type StoredTokens,
} from "../src/keychain/store";
const fixtureDir = existsSync(join(__dirname, "fixtures")) ? join(__dirname, "fixtures") : join(__dirname, "..", "..", "tests", "fixtures");
const fixtureSecret = join(fixtureDir, "fake-secret-tool");
const fixturePs = join(fixtureDir, "fake-powershell");

const sample: StoredTokens = {
  accessToken: "access-linux-1",
  refreshToken: "refresh-linux-1",
  expiresAt: Date.now() + 60_000,
  environment: "local",
  issuer: "http://127.0.0.1:3000/api/auth",
  audience: "http://127.0.0.1:3000/api/v1",
  clientId: "alphafox-cli-local",
  scopes: ["openid"],
};
const profile = {
  name: "local" as const,
  apiBaseUrl: "http://127.0.0.1:3000/api/v1",
  issuer: "http://127.0.0.1:3000/api/auth",
  audience: "http://127.0.0.1:3000/api/v1",
  clientId: "alphafox-cli-local",
};

describe("OS keychain backends", () => {
  it("builds real secret-tool argv (no payload on argv)", () => {
    const args = linuxSecretServiceArgs(
      "store",
      "alphafox-cli.local",
      "oauth-tokens"
    );
    assert.equal(args[0], "store");
    assert.ok(!args.some((a) => String(a).includes("access-")));
    assert.ok(args.includes("service"));
    assert.notEqual(windowsCredentialTarget("staging-slot"), windowsCredentialTarget("production-slot"));
  });

  it("roundtrips via Linux Secret Service helper (fake secret-tool)", () => {
    chmodSync(fixtureSecret, 0o755);
    const dir = mkdtempSync(join(tmpdir(), "alphafox-secret-"));
    const env: NodeJS.ProcessEnv = {
      ALPHAFOX_KEYCHAIN_PLATFORM: "linux",
      ALPHAFOX_SECRET_TOOL: fixtureSecret,
      ALPHAFOX_FAKE_SECRET_DIR: dir,
      ALPHAFOX_KEYCHAIN_DIR: join(dir, "file-fallback"),
    };
    try {
      const probe = probeOsKeychain(env);
      assert.equal(probe.kind, "linux-secret-service");
      assert.equal(probe.available, true);
      const saved = saveTokens(profile, sample, env);
      assert.equal(saved.backend, "keychain");
      assert.equal(saved.kind, "linux-secret-service");
      assert.equal(saved.degraded, false);
      assert.equal(loadTokens(profile, env)?.accessToken, "access-linux-1");
      deleteTokens(profile, env);
      assert.equal(loadTokens(profile, env), null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("roundtrips via Windows Credential Manager helper (fake powershell)", () => {
    chmodSync(fixturePs, 0o755);
    const dir = mkdtempSync(join(tmpdir(), "alphafox-cred-"));
    const env: NodeJS.ProcessEnv = {
      ALPHAFOX_KEYCHAIN_PLATFORM: "win32",
      ALPHAFOX_POWERSHELL: fixturePs,
      ALPHAFOX_FAKE_CRED_DIR: dir,
      ALPHAFOX_KEYCHAIN_DIR: join(dir, "file-fallback"),
    };
    try {
      const probe = probeOsKeychain(env);
      assert.equal(probe.kind, "windows-credential-manager");
      assert.equal(probe.available, true);
      const saved = saveTokens(profile, { ...sample, accessToken: "access-win-1" }, env);
      assert.equal(saved.backend, "keychain");
      assert.equal(saved.kind, "windows-credential-manager");
      assert.equal(loadTokens(profile, env)?.accessToken, "access-win-1");
      deleteTokens(profile, env);
      assert.equal(loadTokens(profile, env), null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not create file credentials when Linux secret-tool is missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "alphafox-secret-miss-"));
    const env: NodeJS.ProcessEnv = {
      ALPHAFOX_KEYCHAIN_PLATFORM: "linux",
      ALPHAFOX_SECRET_TOOL: join(dir, "no-such-secret-tool"),
      ALPHAFOX_KEYCHAIN_DIR: dir,
    };
    try {
      assert.throws(() => saveTokens(profile, sample, env), /unavailable/i);
      assert.equal(existsSync(join(dir, "local.tokens.json")), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
