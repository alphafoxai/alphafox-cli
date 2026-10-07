import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "node:test";

const root = join(__dirname, "../..");
for (const file of ["README.md", "AGENTS.md", "docs/e2e-staging.md", "docs/alphafox-cli-installation-guide.md"]) {
  it(`${file} describes opt-in keychain-only policy and default fallback honestly`, () => {
    const text = readFileSync(join(root, file), "utf8");
    assert.match(text, /ALPHAFOX_REQUIRE_OS_KEYCHAIN=1/);
    assert.match(text, /plaintext/i);
    assert.match(text, /fallback/i);
  });
}
for (const file of ["README.md", "docs/e2e-staging.md", "docs/alphafox-cli-installation-guide.md"]) {
  it(`${file} documents independent credential directory and strict-mode conflicts`, () => {
    const text = readFileSync(join(root, file), "utf8");
    assert.ok(text.includes("~/.config/alphafox/keychain/<profile>.tokens.json"));
    assert.match(text, /ALPHAFOX_KEYCHAIN_DIR/);
    assert.match(text, /ALPHAFOX_CONFIG_DIR/);
    assert.match(text, /ALPHAFOX_FORCE_FILE_KEYCHAIN=1/);
    assert.match(text, /does not (?:automatically )?migrate or delete/);
  });
}
