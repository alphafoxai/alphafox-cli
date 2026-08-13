import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { systemBrowserCommand } from "../src/auth/open-browser";

describe("system browser command", () => {
  it("uses open on macOS", () => {
    const cmd = systemBrowserCommand("https://example.com/login", "darwin");
    assert.equal(cmd.command, "open");
    assert.deepEqual(cmd.args, ["https://example.com/login"]);
  });

  it("uses xdg-open on Linux", () => {
    const cmd = systemBrowserCommand("https://example.com/login", "linux");
    assert.equal(cmd.command, "xdg-open");
    assert.deepEqual(cmd.args, ["https://example.com/login"]);
  });

  it("uses cmd start on Windows", () => {
    const cmd = systemBrowserCommand("https://example.com/login", "win32");
    assert.equal(cmd.command, "cmd");
    assert.deepEqual(cmd.args, ["/c", "start", "", "https://example.com/login"]);
  });
});
