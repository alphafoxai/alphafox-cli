const fs = require("node:fs");
const path = require("node:path");

const cliJs = path.join(__dirname, "..", "dist", "cli.js");
if (fs.existsSync(cliJs)) {
  const body = fs.readFileSync(cliJs, "utf8");
  if (!body.startsWith("#!/")) {
    fs.writeFileSync(cliJs, `#!/usr/bin/env node\n${body}`);
  }
  try {
    fs.chmodSync(cliJs, 0o755);
  } catch {
    // Windows may ignore mode bits.
  }
}

const root = path.join(__dirname, "..");
const packageJson = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8")
);
const { CLI_CONTRACT_VERSION } = require(path.join(root, "dist", "version.js"));
const { writeSkillsManifest } = require(
  path.join(root, "dist", "skills", "manager.js")
);
writeSkillsManifest(root, path.join(root, "dist", "skills-manifest.json"), {
  packageVersion: packageJson.version,
  contractVersion: CLI_CONTRACT_VERSION,
});
