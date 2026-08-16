/**
 * Run package-local tests that do not need sibling alphafox-contracts /
 * alphafox-web checkouts. Used by the npm publish workflow.
 */
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "dist-test", "tests");
const skip = new Set([
  "mvp-oauth-web-handlers.test.js",
  "oauth-client-scope.test.js",
]);
const files = readdirSync(dir)
  .filter((name) => name.endsWith(".test.js") && !skip.has(name))
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
