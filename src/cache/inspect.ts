import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export interface DirectoryUsage {
  readonly path: string;
  readonly exists: boolean;
  readonly bytes: number;
  readonly files: number;
}

export function inspectDirectory(path: string): DirectoryUsage {
  if (!existsSync(path)) {
    return { path, exists: false, bytes: 0, files: 0 };
  }
  const root = statSync(path);
  if (root.isFile()) {
    return { path, exists: true, bytes: root.size, files: 1 };
  }
  let bytes = 0;
  let files = 0;
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const next = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(next);
        continue;
      }
      if (entry.isFile()) {
        files += 1;
        bytes += statSync(next).size;
      }
    }
  };
  walk(path);
  return { path, exists: true, bytes, files };
}
