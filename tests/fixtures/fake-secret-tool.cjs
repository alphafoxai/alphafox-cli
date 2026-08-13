#!/usr/bin/env node
/**
 * Test double for libsecret `secret-tool`. Stores blobs under ALPHAFOX_FAKE_SECRET_DIR.
 */
const fs = require("node:fs");
const path = require("node:path");

const args = process.argv.slice(2);
if (args[0] === "--help" || args[0] === "-h") {
  process.exit(0);
}

const dir = process.env.ALPHAFOX_FAKE_SECRET_DIR;
if (!dir) {
  process.stderr.write("ALPHAFOX_FAKE_SECRET_DIR required\n");
  process.exit(1);
}
fs.mkdirSync(dir, { recursive: true });

function attr(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : "";
}

function filePath() {
  return path.join(dir, `${attr("service")}__${attr("account")}`);
}

const action = args[0];
if (action === "store") {
  fs.writeFileSync(filePath(), fs.readFileSync(0));
  process.exit(0);
}
if (action === "lookup") {
  try {
    process.stdout.write(fs.readFileSync(filePath()));
    process.exit(0);
  } catch {
    process.exit(1);
  }
}
if (action === "clear") {
  try {
    fs.unlinkSync(filePath());
  } catch {
    // none
  }
  process.exit(0);
}
process.exit(1);
