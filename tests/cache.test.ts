import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { cmdCache } from "../src/cache/run-command";
import { assertSafeCacheRoot, TAPE_CACHE_REMIND_BYTES } from "../src/cache/paths";
import { inspectDirectory } from "../src/cache/inspect";

function cacheEnv(): NodeJS.ProcessEnv {
  const dir = mkdtempSync(join(tmpdir(), "alphafox-cli-cache-"));
  return {
    ALPHAFOX_TAPE_CACHE_DIR: join(dir, "tape"),
    ALPHAFOX_BACKTEST_RUNTIME_CACHE_DIR: join(dir, "runtime"),
    ALPHAFOX_SKIP_UPDATE_CHECK: "1",
    ALPHAFOX_CACHE_TEST_ROOT: dir,
  };
}

async function captureCache(
  args: string[],
  env: NodeJS.ProcessEnv,
  flags: { yes?: boolean; dryRun?: boolean } = {}
): Promise<Record<string, unknown>> {
  const chunks: string[] = [];
  const origWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    chunks.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  try {
    const code = await cmdCache(args, {
      format: "json",
      yes: flags.yes === true,
      dryRun: flags.dryRun === true,
    }, env);
    assert.equal(code, 0);
    return JSON.parse(chunks.join("").trim().split("\n").pop() ?? "{}") as Record<
      string,
      unknown
    >;
  } finally {
    process.stdout.write = origWrite;
  }
}

describe("backtest cache", () => {
  it("status reports an empty tape cache as not large", async () => {
    const env = cacheEnv();
    try {
      const json = await captureCache(["status"], env);
      const data = json.data as Record<string, unknown>;
      const tape = data.tape as Record<string, unknown>;
      assert.equal(tape.exists, false);
      assert.equal(tape.bytes, 0);
      assert.equal(tape.large, false);
      assert.equal(data.remindAfterBytes, TAPE_CACHE_REMIND_BYTES);
    } finally {
      rmSync(env.ALPHAFOX_CACHE_TEST_ROOT!, { recursive: true, force: true });
    }
  });

  it("clean --dry-run leaves tape files in place", async () => {
    const env = cacheEnv();
    try {
      mkdirSync(env.ALPHAFOX_TAPE_CACHE_DIR!, { recursive: true });
      writeFileSync(join(env.ALPHAFOX_TAPE_CACHE_DIR!, "1m.json"), "x".repeat(64));
      const json = await captureCache(["clean"], env, { dryRun: true });
      const data = json.data as Record<string, unknown>;
      assert.equal(data.dryRun, true);
      assert.deepEqual(data.cleared, ["tape"]);
      assert.equal(inspectDirectory(env.ALPHAFOX_TAPE_CACHE_DIR!).files, 1);
    } finally {
      rmSync(env.ALPHAFOX_CACHE_TEST_ROOT!, { recursive: true, force: true });
    }
  });

  it("clean --yes removes tape and leaves runtime", async () => {
    const env = cacheEnv();
    try {
      mkdirSync(env.ALPHAFOX_TAPE_CACHE_DIR!, { recursive: true });
      mkdirSync(env.ALPHAFOX_BACKTEST_RUNTIME_CACHE_DIR!, { recursive: true });
      writeFileSync(join(env.ALPHAFOX_TAPE_CACHE_DIR!, "1m.json"), "bars");
      writeFileSync(join(env.ALPHAFOX_BACKTEST_RUNTIME_CACHE_DIR!, "host.mjs"), "ok");
      const json = await captureCache(["clean"], env, { yes: true });
      const data = json.data as Record<string, unknown>;
      assert.equal(data.dryRun, false);
      assert.deepEqual(data.cleared, ["tape"]);
      assert.equal(inspectDirectory(env.ALPHAFOX_TAPE_CACHE_DIR!).exists, false);
      assert.equal(inspectDirectory(env.ALPHAFOX_BACKTEST_RUNTIME_CACHE_DIR!).files, 1);
      assert.ok(Number(data.bytesFreed) > 0);
    } finally {
      rmSync(env.ALPHAFOX_CACHE_TEST_ROOT!, { recursive: true, force: true });
    }
  });

  it("refuses to delete a directory that is not a backtest cache root", () => {
    const env = cacheEnv();
    try {
      assert.throws(
        () => assertSafeCacheRoot("/tmp", env),
        /Refusing to touch cache directory/
      );
    } finally {
      rmSync(env.ALPHAFOX_CACHE_TEST_ROOT!, { recursive: true, force: true });
    }
  });
});
