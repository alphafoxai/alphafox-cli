import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const skillsRoot = [join(__dirname, "..", "skills"), join(__dirname, "..", "..", "skills")].find(existsSync)!;

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

  it("treats access-token expiry as refresh, not logout", () => {
    const auth = readFileSync(join(skillsRoot, "auth", "SKILL.md"), "utf8");
    const shared = readFileSync(
      join(skillsRoot, "alphafox-shared", "SKILL.md"),
      "utf8"
    );
    for (const text of [auth, shared]) {
      assert.match(text, /session.*active/);
      assert.match(text, /refresh_failed/);
      assert.match(text, /whoami.*parallel/i);
    }
  });

  it("routes large tape caches to cleanup and asks before deleting", () => {
    const router = readFileSync(join(skillsRoot, "alphafox", "SKILL.md"), "utf8");
    const cache = readFileSync(join(skillsRoot, "cache", "SKILL.md"), "utf8");
    const engine = readFileSync(
      join(skillsRoot, "engine-backtest", "SKILL.md"),
      "utf8"
    );
    assert.match(router, /alphafox-cache/);
    assert.match(router, /data\.tape\.large/);
    assert.match(
      router,
      /回测下载的历史数据比较大，要不要我帮你清理本地缓存？/
    );
    assert.match(cache, /alphafox cache status/);
    assert.match(cache, /alphafox cache clean --yes/);
    assert.match(engine, /alphafox-cache/);
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
