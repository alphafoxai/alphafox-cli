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
