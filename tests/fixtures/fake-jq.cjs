#!/usr/bin/env node
/**
 * Minimal jq test double: supports `-c <filter>` for `.`, `.data.name`, `.ok`.
 */
const fs = require("node:fs");

const args = process.argv.slice(2);
const cIdx = args.indexOf("-c");
const filter = cIdx >= 0 ? args[cIdx + 1] : args[0];
const input = JSON.parse(fs.readFileSync(0, "utf8"));
let value = input;
if (filter === ".") {
  value = input;
} else if (filter === ".data.name") {
  value = input.data.name;
} else if (filter === ".ok") {
  value = input.ok;
} else if (filter === ".data.checks") {
  value = input.data.checks;
} else {
  process.stderr.write(`unsupported fake jq filter: ${filter}\n`);
  process.exit(1);
}
process.stdout.write(`${JSON.stringify(value)}\n`);
