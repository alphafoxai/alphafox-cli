import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

/** Remind Agents to offer cleanup at or above this tape-cache size. */
export const TAPE_CACHE_REMIND_BYTES = 512 * 1024 * 1024;

export function resolveTapeCacheDir(
  env: NodeJS.ProcessEnv = process.env
): string {
  const override = env.ALPHAFOX_TAPE_CACHE_DIR?.trim();
  if (override) {
    return resolve(override);
  }
  return resolve(join(homedir(), ".alphafox", "cache", "engine-backtest"));
}

export function resolveRuntimeCacheRoot(
  env: NodeJS.ProcessEnv = process.env
): string {
  const override = env.ALPHAFOX_BACKTEST_RUNTIME_CACHE_DIR?.trim();
  if (override) {
    return resolve(override);
  }
  const xdg = env.XDG_CACHE_HOME?.trim();
  return resolve(
    join(xdg || join(homedir(), ".cache"), "alphafox", "engine-backtest")
  );
}

export function assertSafeCacheRoot(
  directory: string,
  env: NodeJS.ProcessEnv = process.env
): void {
  const resolved = resolve(directory);
  const tape = resolveTapeCacheDir(env);
  const runtime = resolveRuntimeCacheRoot(env);
  if (resolved === tape || resolved === runtime) {
    return;
  }
  if (basename(resolved) === "engine-backtest") {
    return;
  }
  throw Object.assign(
    new Error(`Refusing to touch cache directory ${resolved}`),
    {
      type: "usage",
      subtype: "cache_root_unsafe",
      status: 400,
    }
  );
}
