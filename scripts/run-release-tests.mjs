/**
 * Run every compiled test in this package. Used by the npm publish workflow and
 * by CI, because it skips `check:catalog-drift`, which needs a resolvable
 * @alphafoxai/contracts (sibling checkout, ALPHAFOX_CONTRACTS_ROOT, or an
 * installed copy). The Web OAuth vertical slice is not tested here or anywhere
 * in this repository: it is owned by alphafox-web's own suite, which covers the
 * same routes, grants, and error codes against the real implementation.
 */
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "dist-test", "tests");
const files = readdirSync(dir)
  .filter((name) => name.endsWith(".test.js"))
  .map((name) => join(dir, name))
  .sort();

if (files.length === 0) {
  console.error("No release tests found under dist-test/tests");
  process.exit(1);
}

const result = spawnSync(process.execPath, ["--test", ...files], {
  cwd: root,
  stdio: "inherit",
});
process.exit(result.status === null ? 1 : result.status);
