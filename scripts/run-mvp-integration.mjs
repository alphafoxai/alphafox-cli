import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const cliRoot = join(here, "..");
const register = join(here, "register-web-alias.mjs");
const testFile = join(cliRoot, "tests", "mvp-oauth-web-handlers.test.mts");

const env = {
  ...process.env,
  NODE_ENV: "test",
  ALPHAFOX_OAUTH_ALLOW_TEST_APPROVE: "1",
  ALPHAFOX_DEPLOY_ENV: "local",
  BETTER_AUTH_URL: "http://127.0.0.1:3000",
};

const result = spawnSync(
  process.execPath,
  [
    "--import",
    register,
    "--experimental-strip-types",
    "--test",
    testFile,
  ],
  {
    cwd: cliRoot,
    env,
    encoding: "utf8",
  }
);

process.stdout.write(result.stdout || "");
process.stderr.write(result.stderr || "");
process.exit(result.status ?? 1);
