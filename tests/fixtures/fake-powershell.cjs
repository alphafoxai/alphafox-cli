#!/usr/bin/env node
/**
 * Test double for powershell.exe -File windows-cred.ps1 <action> <target>
 * Stores blobs under ALPHAFOX_FAKE_CRED_DIR. Does not claim to be CredMan.
 */
const fs = require("node:fs");
const path = require("node:path");

const dir = process.env.ALPHAFOX_FAKE_CRED_DIR;
if (!dir) {
  process.stderr.write("ALPHAFOX_FAKE_CRED_DIR required\n");
  process.exit(1);
}
fs.mkdirSync(dir, { recursive: true });

const args = process.argv.slice(2);
if (args.includes("-Command") && args[args.indexOf("-Command") + 1] === "exit 0") {
  process.exit(0);
}

const fileIdx = args.indexOf("-File");
const action = fileIdx >= 0 ? args[fileIdx + 2] : args[args.length - 2];
const target = fileIdx >= 0 ? args[fileIdx + 3] : args[args.length - 1];
const dest = path.join(dir, Buffer.from(String(target)).toString("hex"));

if (action === "write") {
  fs.writeFileSync(dest, fs.readFileSync(0));
  process.exit(0);
}
if (action === "read") {
  try {
    process.stdout.write(fs.readFileSync(dest));
    process.exit(0);
  } catch {
    process.exit(2);
  }
}
if (action === "delete") {
  try {
    fs.unlinkSync(dest);
  } catch {
    // none
  }
  process.exit(0);
}
process.exit(1);
