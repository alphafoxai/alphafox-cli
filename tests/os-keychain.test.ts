import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync } from "node:fs";
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

const fixtureSecret = join(
  __dirname,
  "..",
  "..",
  "tests",
  "fixtures",
  "fake-secret-tool"
);
const fixturePs = join(
  __dirname,
  "..",
  "..",
  "tests",
  "fixtures",
  "fake-powershell"
);

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
    assert.equal(windowsCredentialTarget("staging"), "alphafox-cli/staging/oauth-tokens");
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
      const saved = saveTokens("local", sample, env);
      assert.equal(saved.backend, "keychain");
      assert.equal(saved.kind, "linux-secret-service");
      assert.equal(saved.degraded, false);
      assert.equal(loadTokens("local", env)?.accessToken, "access-linux-1");
      deleteTokens("local", env);
      assert.equal(loadTokens("local", env), null);
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
      const saved = saveTokens("local", { ...sample, accessToken: "access-win-1" }, env);
      assert.equal(saved.backend, "keychain");
      assert.equal(saved.kind, "windows-credential-manager");
      assert.equal(loadTokens("local", env)?.accessToken, "access-win-1");
      deleteTokens("local", env);
      assert.equal(loadTokens("local", env), null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("falls back to file when Linux secret-tool is missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "alphafox-secret-miss-"));
    const env: NodeJS.ProcessEnv = {
      ALPHAFOX_KEYCHAIN_PLATFORM: "linux",
      ALPHAFOX_SECRET_TOOL: join(dir, "no-such-secret-tool"),
      ALPHAFOX_KEYCHAIN_DIR: dir,
    };
    try {
      const saved = saveTokens("local", sample, env);
      assert.equal(saved.backend, "file");
      assert.equal(saved.degraded, true);
      assert.equal(loadTokens("local", env)?.refreshToken, "refresh-linux-1");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
