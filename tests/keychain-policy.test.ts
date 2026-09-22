import assert from "node:assert/strict";
import fs, { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { deleteTokens, getLastTokenSaveResult, loadTokens, saveTokens, type StoredTokens } from "../src/keychain/store";

const fixtureSecret = join(__dirname, "../../tests/fixtures/fake-secret-tool");

const sample: StoredTokens = {
  accessToken: "synthetic-access", refreshToken: "synthetic-refresh",
  expiresAt: Date.now() + 600_000, environment: "local",
  issuer: "http://127.0.0.1:3000/api/auth", audience: "http://127.0.0.1:3000/api/v1",
  clientId: "alphafox-cli-local", scopes: ["openid"],
};

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), "alphafox-policy-"));
  const env: NodeJS.ProcessEnv = {
    HOME: join(dir, "home"), TMPDIR: dir,
    ALPHAFOX_CONFIG_DIR: join(dir, "config"), ALPHAFOX_KEYCHAIN_DIR: join(dir, "fallback"),
    ALPHAFOX_KEYCHAIN_PLATFORM: "linux", ALPHAFOX_SECRET_TOOL: join(dir, "missing-secret-tool"),
    ALPHAFOX_REQUIRE_OS_KEYCHAIN: "1", ALPHAFOX_SKIP_UPDATE_CHECK: "1",
  };
  return { dir, env, path: join(env.ALPHAFOX_KEYCHAIN_DIR!, "local.tokens.json"),
    cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

it("strict save fails closed without creating plaintext or reporting an old success", () => {
  const box = sandbox();
  try {
    saveTokens("seed", sample, { ...box.env, ALPHAFOX_REQUIRE_OS_KEYCHAIN: "0", ALPHAFOX_FORCE_FILE_KEYCHAIN: "1" });
    assert.throws(() => saveTokens("local", sample, box.env), {
      type: "credential_storage", subtype: "os_keychain_required",
    });
    assert.equal(existsSync(box.path), false);
    assert.equal(getLastTokenSaveResult(), null);
  } finally { box.cleanup(); }
});

for (const conflict of ["ALPHAFOX_FORCE_FILE_KEYCHAIN", "ALPHAFOX_TEST_ACCESS_TOKEN", "ALPHAFOX_TEST_REFRESH_TOKEN"]) {
  it(`strict policy rejects ${conflict} before reading or saving credentials`, () => {
    const box = sandbox();
    try {
      const env = { ...box.env, [conflict]: "1" };
      for (const action of [() => loadTokens("local", env), () => saveTokens("local", sample, env)]) {
        assert.throws(action, { type: "credential_storage", subtype: "keychain_policy_conflict" });
      }
      assert.equal(existsSync(box.path), false);
    } finally { box.cleanup(); }
  });
}

it("strict load refuses legacy plaintext without reading or deleting its contents", (t) => {
  const box = sandbox();
  try {
    mkdirSync(box.env.ALPHAFOX_KEYCHAIN_DIR!, { recursive: true });
    writeFileSync(box.path, "not JSON: must not be read");
    const read = t.mock.method(fs, "readFileSync", () => { throw new Error("must not read plaintext"); });
    assert.throws(() => loadTokens("local", box.env), {
      type: "credential_storage", subtype: "plaintext_credentials_disallowed",
    });
    assert.equal(read.mock.callCount(), 0);
    t.mock.restoreAll();
    assert.equal(readFileSync(box.path, "utf8"), "not JSON: must not be read");
  } finally { box.cleanup(); }
});

it("strict keychain success takes precedence without migrating legacy files; delete still cleans up", () => {
  const box = sandbox();
  try {
    chmodSync(fixtureSecret, 0o755);
    const env = { ...box.env, ALPHAFOX_SECRET_TOOL: fixtureSecret, ALPHAFOX_FAKE_SECRET_DIR: join(box.dir, "fake-os") };
    assert.equal(loadTokens("local", env), null);
    mkdirSync(box.env.ALPHAFOX_KEYCHAIN_DIR!, { recursive: true });
    writeFileSync(box.path, "legacy plaintext untouched");
    assert.equal(saveTokens("local", sample, env).backend, "keychain");
    assert.deepEqual(loadTokens("local", env), sample);
    assert.equal(readFileSync(box.path, "utf8"), "legacy plaintext untouched");
    deleteTokens("local", env);
    assert.equal(existsSync(box.path), false);
    assert.equal(loadTokens("local", env), null);
  } finally { box.cleanup(); }
});

it("file fallback repairs existing 0644 permissions before writing payload", { skip: process.platform === "win32" }, (t) => {
  const box = sandbox();
  try {
    mkdirSync(box.env.ALPHAFOX_KEYCHAIN_DIR!, { recursive: true });
    writeFileSync(box.path, "old");
    chmodSync(box.path, 0o644);
    const originalWrite = fs.writeFileSync;
    t.mock.method(fs, "writeFileSync", (...args: Parameters<typeof fs.writeFileSync>) => {
      assert.equal(statSync(box.path).mode & 0o777, 0o600, "permissions must be private before payload write");
      return originalWrite(...args);
    });
    const env = { ...box.env, ALPHAFOX_REQUIRE_OS_KEYCHAIN: "0", ALPHAFOX_FORCE_FILE_KEYCHAIN: "1" };
    saveTokens("local", sample, env);
    assert.equal(statSync(box.path).mode & 0o777, 0o600);
    assert.deepEqual(loadTokens("local", env), sample);
  } finally { box.cleanup(); }
});

it("permission repair failure leaves prior payload intact", { skip: process.platform === "win32" }, (t) => {
  const box = sandbox();
  try {
    mkdirSync(box.env.ALPHAFOX_KEYCHAIN_DIR!, { recursive: true });
    writeFileSync(box.path, "old");
    chmodSync(box.path, 0o644);
    t.mock.method(fs, "fchmodSync", () => { throw Object.assign(new Error("denied"), { code: "EPERM" }); });
    assert.throws(() => saveTokens("local", sample, {
      ...box.env, ALPHAFOX_REQUIRE_OS_KEYCHAIN: "0", ALPHAFOX_FORCE_FILE_KEYCHAIN: "1",
    }), { code: "EPERM" });
    assert.equal(readFileSync(box.path, "utf8"), "old");
    assert.equal(getLastTokenSaveResult(), null);
  } finally { box.cleanup(); }
});

it("file fallback refuses symlink destinations without modifying their targets", { skip: process.platform === "win32" }, () => {
  const box = sandbox();
  try {
    mkdirSync(box.env.ALPHAFOX_KEYCHAIN_DIR!, { recursive: true });
    const target = join(box.dir, "target");
    writeFileSync(target, "untouched");
    chmodSync(target, 0o644);
    symlinkSync(target, box.path);
    assert.throws(() => saveTokens("local", sample, {
      ...box.env, ALPHAFOX_REQUIRE_OS_KEYCHAIN: "0", ALPHAFOX_FORCE_FILE_KEYCHAIN: "1",
    }));
    assert.equal(readFileSync(target, "utf8"), "untouched");
    assert.equal(statSync(target).mode & 0o777, 0o644);
  } finally { box.cleanup(); }
});

it("strict load detects even a dangling legacy symlink without following it", { skip: process.platform === "win32" }, () => {
  const box = sandbox();
  try {
    mkdirSync(box.env.ALPHAFOX_KEYCHAIN_DIR!, { recursive: true });
    symlinkSync(join(box.dir, "missing"), box.path);
    assert.throws(() => loadTokens("local", box.env), {
      type: "credential_storage", subtype: "plaintext_credentials_disallowed",
    });
  } finally { box.cleanup(); }
});

it("strict failed save leaves an existing fallback payload and permissions untouched", () => {
  const box = sandbox();
  try {
    mkdirSync(box.env.ALPHAFOX_KEYCHAIN_DIR!, { recursive: true });
    writeFileSync(box.path, "legacy payload");
    const mode = statSync(box.path).mode;
    assert.throws(() => saveTokens("local", sample, box.env), {
      type: "credential_storage", subtype: "os_keychain_required",
    });
    assert.equal(readFileSync(box.path, "utf8"), "legacy payload");
    assert.equal(statSync(box.path).mode, mode);
  } finally { box.cleanup(); }
});

it("file fallback refuses non-regular destinations", () => {
  const box = sandbox();
  try {
    mkdirSync(box.path, { recursive: true });
    assert.throws(() => saveTokens("local", sample, {
      ...box.env, ALPHAFOX_REQUIRE_OS_KEYCHAIN: "0", ALPHAFOX_FORCE_FILE_KEYCHAIN: "1",
    }), { type: "credential_storage", subtype: "unsafe_fallback_file" });
    assert.equal(statSync(box.path).isDirectory(), true);
  } finally { box.cleanup(); }
});

it("POSIX file fallback refuses a symlink swapped in immediately before open", { skip: process.platform === "win32" }, (t) => {
  const box = sandbox();
  try {
    mkdirSync(box.env.ALPHAFOX_KEYCHAIN_DIR!, { recursive: true });
    writeFileSync(box.path, "old");
    const target = join(box.dir, "target");
    writeFileSync(target, "untouched");
    const originalOpen = fs.openSync;
    t.mock.method(fs, "openSync", (...args: Parameters<typeof fs.openSync>) => {
      unlinkSync(box.path);
      symlinkSync(target, box.path);
      return originalOpen(...args);
    });
    assert.throws(() => saveTokens("local", sample, {
      ...box.env, ALPHAFOX_REQUIRE_OS_KEYCHAIN: "0", ALPHAFOX_FORCE_FILE_KEYCHAIN: "1",
    }));
    t.mock.restoreAll();
    assert.equal(readFileSync(target, "utf8"), "untouched");
  } finally { box.cleanup(); }
});
