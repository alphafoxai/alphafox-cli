import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  applyAgentLinkPass,
  attachAgentLinks,
  ensureAgentLinks,
  inspectAgentLinks,
  removeAgentLinks,
} from "../src/skills/agent-links";
import type { SkillsStatus, SkillsSyncResult } from "../src/skills/manager";

function writeSkill(root: string, name: string, body = "# Skill\n"): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "SKILL.md"),
    `---\nname: ${name}\nversion: 0.3.11\n---\n\n${body}`
  );
  return dir;
}

function sandbox(): {
  readonly root: string;
  readonly canonical: string;
  readonly home: string;
  cleanup(): void;
} {
  const root = mkdtempSync(join(tmpdir(), "alphafox-agent-links-"));
  return {
    root,
    canonical: join(root, "agents", "skills"),
    home: join(root, "home"),
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

describe("Agent skill links", () => {
  it("always targets Claude Code and only detected Cursor/Codex homes", () => {
    const box = sandbox();
    writeSkill(box.canonical, "alphafox");
    mkdirSync(join(box.home, ".cursor"), { recursive: true });

    const status = inspectAgentLinks({
      canonicalRoot: box.canonical,
      skillNames: ["alphafox"],
      homeDir: box.home,
    });

    assert.deepEqual(
      status.map((item) => item.id),
      ["claude-code", "cursor"]
    );
    assert.deepEqual(status[0]?.missing, ["alphafox"]);
    assert.equal(status[0]?.skillsDir, join(box.home, ".claude", "skills"));
    assert.deepEqual(status[1]?.missing, ["alphafox"]);
    box.cleanup();
  });

  it("creates Claude Code symlinks for Skills already in the canonical store", () => {
    const box = sandbox();
    const canonicalSkill = writeSkill(box.canonical, "alphafox");

    const created = ensureAgentLinks({
      canonicalRoot: box.canonical,
      skillNames: ["alphafox"],
      homeDir: box.home,
    });

    assert.deepEqual(created, [{ agent: "claude-code", name: "alphafox" }]);
    const dest = join(box.home, ".claude", "skills", "alphafox");
    assert.equal(readlinkSync(dest), canonicalSkill);
    assert.deepEqual(
      inspectAgentLinks({
        canonicalRoot: box.canonical,
        skillNames: ["alphafox"],
        homeDir: box.home,
      })[0]?.linked,
      ["alphafox"]
    );
    box.cleanup();
  });

  it("does not overwrite a different Skill sitting in the Agent directory", () => {
    const box = sandbox();
    writeSkill(box.canonical, "alphafox", "# Canonical\n");
    writeSkill(join(box.home, ".claude", "skills"), "alphafox", "# Local\n");

    const created = ensureAgentLinks({
      canonicalRoot: box.canonical,
      skillNames: ["alphafox"],
      homeDir: box.home,
    });

    assert.deepEqual(created, []);
    assert.deepEqual(
      inspectAgentLinks({
        canonicalRoot: box.canonical,
        skillNames: ["alphafox"],
        homeDir: box.home,
      })[0]?.blocked,
      ["alphafox"]
    );
    box.cleanup();
  });

  it("treats a matching copy and a self canonical path as already linked", () => {
    const box = sandbox();
    writeSkill(box.canonical, "alphafox");
    writeSkill(join(box.home, ".claude", "skills"), "alphafox");

    const claude = inspectAgentLinks({
      canonicalRoot: box.canonical,
      skillNames: ["alphafox"],
      homeDir: box.home,
    })[0];
    assert.deepEqual(claude?.linked, ["alphafox"]);

    const self = inspectAgentLinks({
      canonicalRoot: join(box.home, ".claude", "skills"),
      skillNames: ["alphafox"],
      homeDir: box.home,
    })[0];
    assert.deepEqual(self?.linked, ["alphafox"]);
    box.cleanup();
  });

  it("replaces a broken Agent symlink and removes only managed links", () => {
    const box = sandbox();
    const canonicalSkill = writeSkill(box.canonical, "alphafox");
    const destDir = join(box.home, ".claude", "skills");
    mkdirSync(destDir, { recursive: true });
    symlinkSync(join(box.root, "missing"), join(destDir, "alphafox"));

    ensureAgentLinks({
      canonicalRoot: box.canonical,
      skillNames: ["alphafox"],
      homeDir: box.home,
    });
    assert.equal(readlinkSync(join(destDir, "alphafox")), canonicalSkill);

    writeSkill(join(box.home, ".claude", "skills"), "other", "# Keep\n");
    removeAgentLinks({
      canonicalRoot: box.canonical,
      skillNames: ["alphafox", "other"],
      homeDir: box.home,
    });
    assert.equal(existsSync(join(destDir, "alphafox")), false);
    assert.equal(existsSync(join(destDir, "other", "SKILL.md")), true);
    box.cleanup();
  });

  it("promotes a skipped canonical sync to planned/synced when Agent links are missing", () => {
    const box = sandbox();
    writeSkill(box.canonical, "alphafox");
    const env = { ALPHAFOX_AGENT_HOME: box.home };
    const skipped: SkillsSyncResult = {
      action: "skipped",
      updated: [],
      removed: [],
      blocked: [],
      status: baseStatus(box.canonical),
      restartRequired: false,
    };

    const planned = applyAgentLinkPass(skipped, {
      dryRun: true,
      env,
      canonicalRoot: box.canonical,
    });
    assert.equal(planned.action, "planned");
    assert.equal(planned.restartRequired, true);
    assert.deepEqual(planned.status.agentLinks[0]?.missing, ["alphafox"]);

    const synced = applyAgentLinkPass(skipped, {
      dryRun: false,
      env,
      canonicalRoot: box.canonical,
    });
    assert.equal(synced.action, "synced");
    assert.deepEqual(synced.status.agentLinks[0]?.linked, ["alphafox"]);
    assert.deepEqual(synced.status.agentLinks[0]?.missing, []);
    box.cleanup();
  });

  it("marks status restartRequired when a detected Agent is missing links", () => {
    const box = sandbox();
    writeSkill(box.canonical, "alphafox");
    const status = attachAgentLinks(baseStatus(box.canonical), {
      ALPHAFOX_AGENT_HOME: box.home,
    });
    assert.equal(status.restartRequired, true);
    assert.equal(status.agentLinks[0]?.id, "claude-code");
    box.cleanup();
  });
});

function baseStatus(installedRoot: string): SkillsStatus {
  return {
    bundleVersion: "0.3.11",
    contractVersion: "2026-08-13",
    bundleHash: "hash",
    installedRoot,
    skills: [
      {
        name: "alphafox",
        expectedVersion: "0.3.11",
        installedVersion: "0.3.11",
        expectedHash: "abc",
        installedHash: "abc",
        status: "current",
        managed: true,
      },
    ],
    orphans: [],
    summary: { current: 1, missing: 0, stale: 0, modified: 0 },
    restartRequired: false,
    agentLinks: [],
  };
}
