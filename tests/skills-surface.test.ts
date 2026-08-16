import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const skillsRoot = join(__dirname, "..", "..", "skills");

function skillFiles(): string[] {
  return readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(skillsRoot, entry.name, "SKILL.md"));
}

describe("Skills surface", () => {
  it("keeps market resolution asset-class first", () => {
    const market = readFileSync(join(skillsRoot, "market", "SKILL.md"), "utf8");
    assert.match(market, /asset class/i);
    assert.match(market, /美股/);
    assert.match(market, /equity_perp/);
    assert.match(market, /binance_perp_usdt/);
    assert.match(market, /--asset-class equity_perp/);
  });

  it("does not teach chat product commands or paths", () => {
    const banned = [
      /chats\./,
      /chat_summaries/,
      /\/api\/v1\/chats/,
      /\/api\/v1\/chat-summaries/,
      /strategy chat/i,
    ];
    for (const file of skillFiles()) {
      const text = readFileSync(file, "utf8");
      for (const pattern of banned) {
        assert.equal(pattern.test(text), false, `${file} matches ${pattern}`);
      }
    }
  });
});
