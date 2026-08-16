import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";

import { CLI_PACKAGE } from "../version";

export function findAlphafoxPackageRoot(
  startDirs: readonly string[]
): string | null {
  for (const start of startDirs) {
    const found = walkForPackage(start);
    if (found) return found;
  }
  return null;
}

export function packageHasSkills(packageRoot: string): boolean {
  const skillsDir = join(packageRoot, "skills");
  if (!existsSync(skillsDir)) return false;
  try {
    return readdirSync(skillsDir, { withFileTypes: true }).some(
      (entry) =>
        entry.isDirectory() &&
        existsSync(join(skillsDir, entry.name, "SKILL.md"))
    );
  } catch {
    return false;
  }
}

export function globalPackageRoot(npmRootGlobal: string): string {
  return join(npmRootGlobal, "@alphafox", "cli");
}

export function globalBinPath(
  npmPrefixGlobal: string,
  platform: NodeJS.Platform = process.platform
): string {
  if (platform === "win32") {
    return join(npmPrefixGlobal, "alphafox.cmd");
  }
  return join(npmPrefixGlobal, "bin", "alphafox");
}

function walkForPackage(startDir: string): string | null {
  let dir = startDir;
  for (let i = 0; i < 10; i += 1) {
    const pkgPath = join(dir, "package.json");
    if (existsSync(pkgPath) && packageHasSkills(dir)) {
      try {
        const parsed = JSON.parse(readFileSync(pkgPath, "utf8")) as {
          name?: unknown;
        };
        if (parsed.name === CLI_PACKAGE) return dir;
      } catch {
        // keep walking
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
