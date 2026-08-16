import { existsSync, rmSync } from "node:fs";

import { assertSafeCacheRoot } from "./paths";

export function removeCacheRoot(
  directory: string,
  env: NodeJS.ProcessEnv = process.env
): void {
  assertSafeCacheRoot(directory, env);
  if (!existsSync(directory)) {
    return;
  }
  rmSync(directory, { recursive: true, force: true });
}
