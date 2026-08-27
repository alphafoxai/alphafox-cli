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

  it("teaches strategy config from definitions, not a static catalog", () => {
    const strategy = readFileSync(
      join(skillsRoot, "strategy", "SKILL.md"),
      "utf8"
    );
    const router = readFileSync(join(skillsRoot, "alphafox", "SKILL.md"), "utf8");
    assert.match(strategy, /active/);
    assert.match(strategy, /byId\.get/);
    assert.match(strategy, /configSchemaVersion/);
    assert.match(strategy, /"common"/);
    assert.match(strategy, /"strategy"/);
    assert.match(strategy, /settings/);
    assert.match(strategy, /policyId/);
    assert.match(strategy, /alphafox-trading/);
    assert.match(strategy, /alphafox-engine-backtest/);
    assert.match(strategy, /Do not enumerate engine strategy IDs/);
    assert.equal(/rebate_copy_trading/.test(strategy), false);
    assert.equal(/hl_copy_trading/.test(strategy), false);
    assert.equal(/lite_xyz_martingale/.test(strategy), false);
    assert.match(router, /alphafox-strategy/);
    assert.match(router, /alphafox-trading/);
    assert.match(router, /Hidden copy variants/);
  });

  it("teaches post-install welcome from the Lite square catalog", () => {
    const router = readFileSync(join(skillsRoot, "alphafox", "SKILL.md"), "utf8");
    const shared = readFileSync(
      join(skillsRoot, "alphafox-shared", "SKILL.md"),
      "utf8"
    );
    assert.match(router, /After install/);
    assert.match(router, /lite catalog_config get/);
    assert.match(router, /lite signal_sources list/);
    assert.match(router, /featuredSourceIds/);
    assert.match(router, /组合跟单策略/);
    assert.match(router, /轮动马丁策略/);
    assert.match(router, /网格策略/);
    assert.match(router, /拼盘策略/);
    assert.match(router, /滚仓宝策略/);
    assert.match(router, /trader_leaderboard list/);
    assert.match(router, /想跟单或者运行策略，告诉我即可/);
    assert.match(router, /do not hardcode definition ids/i);
    assert.match(shared, /After install/);
    assert.equal(/lite_xyz_martingale/.test(router), false);
    assert.equal(/hl_copy_trading/.test(router), false);
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
