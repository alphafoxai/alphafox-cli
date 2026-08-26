import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
mkdirSync(".release", { recursive: true });
const metadata = JSON.parse(
  execFileSync(
    "npm",
    ["pack", "--json", "--ignore-scripts", "--pack-destination", ".release"],
    { encoding: "utf8" }
  )
)[0];
const files = metadata?.files?.map(({ path }) => path) ?? [];
const fileSet = new Set(files);
const required = [
  "bin/alphafox.js",
  "dist/cli.js",
  "dist/index.js",
  "dist/skills-manifest.json",
  "package.json",
  "skills/alphafox/SKILL.md",
];
const forbidden = [
  /(^|\/)\.env(?:\.|$)/i,
  /(^|\/)(?:e2e-staging|qa-seed-reset)\.md$/i,
  /(^|\/)fixtures?(?:\/|$)/i,
  /(^|\/)tests?(?:\/|$)/i,
];

for (const path of required) {
  if (!fileSet.has(path)) throw new Error(`Packed artifact missing ${path}`);
}
for (const path of files) {
  if (forbidden.some((pattern) => pattern.test(path))) {
    throw new Error(`Packed artifact contains forbidden path ${path}`);
  }
}

const builtVersion = execFileSync(
  process.execPath,
  ["-e", "process.stdout.write(require('./dist/version.js').CLI_VERSION)"],
  { encoding: "utf8" }
);
if (builtVersion !== packageJson.version) {
  throw new Error(
    `Built CLI_VERSION ${builtVersion} does not match package.json ${packageJson.version}`
  );
}

process.stdout.write(`.release/${metadata.filename}\n`);
