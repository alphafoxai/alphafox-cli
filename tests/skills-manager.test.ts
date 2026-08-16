import assert from "node:assert/strict";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  buildSkillsManifest,
  hashSkillDirectory,
  inspectSkills,
  loadAndVerifySkillsManifest,
  syncSkills,
  writeSkillsManifest,
} from "../src/skills/manager";

function writeSkill(
  packageRoot: string,
  name: string,
  version: string,
  body = "# Skill\n"
): void {
  const dir = join(packageRoot, "skills", name);
  mkdirSync(dir, { recursive: true });
  if (!existsSync(join(packageRoot, "package.json"))) {
    writeFileSync(
      join(packageRoot, "package.json"),
      JSON.stringify({ name: "@alphafox/cli", version })
    );
  }
  writeFileSync(
    join(dir, "SKILL.md"),
    `---\nname: ${name}\nversion: ${version}\n---\n\n${body}`
  );
}

describe("Skills bundle status", () => {
  it("uses Skill frontmatter names instead of repository directory names", () => {
    const root = mkdtempSync(join(tmpdir(), "alphafox-skills-names-"));
    writeSkill(root, "account", "0.3.5");
    writeFileSync(
      join(root, "skills", "account", "SKILL.md"),
      "---\nname: alphafox-account\nversion: 0.3.5\n---\n\n# Account\n"
    );
    const manifest = buildSkillsManifest(root, {
      packageVersion: "0.3.5",
      contractVersion: "2026-08-13",
    });
    assert.equal(manifest.skills[0]?.name, "alphafox-account");
    rmSync(root, { recursive: true, force: true });
  });

  it("reports exact installed bundles as current and absent Skills as missing", () => {
    const root = mkdtempSync(join(tmpdir(), "alphafox-skills-status-"));
    const packageRoot = join(root, "package");
    const installedRoot = join(root, "installed");
    writeSkill(packageRoot, "alphafox", "0.3.5");
    writeSkill(packageRoot, "alphafox-market", "0.3.5");
    mkdirSync(installedRoot, { recursive: true });
    cpSync(
      join(packageRoot, "skills", "alphafox"),
      join(installedRoot, "alphafox"),
      { recursive: true }
    );

    const manifest = buildSkillsManifest(packageRoot, {
      packageVersion: "0.3.5",
      contractVersion: "2026-08-13",
    });
    const status = inspectSkills({
      manifest,
      installedRoot,
      state: null,
    });

    assert.equal(status.bundleVersion, "0.3.5");
    assert.equal(status.summary.current, 1);
    assert.equal(status.summary.missing, 1);
    assert.equal(status.skills[0]?.status, "current");
    assert.equal(status.skills[1]?.status, "missing");
    rmSync(root, { recursive: true, force: true });
  });

  it("syncs missing Skills from the exact bundle and records verified state", async () => {
    const root = mkdtempSync(join(tmpdir(), "alphafox-skills-sync-"));
    const packageRoot = join(root, "package");
    const installedRoot = join(root, "installed");
    const statePath = join(root, "config", "skills-state.json");
    writeSkill(packageRoot, "alphafox", "0.3.5");
    const manifest = buildSkillsManifest(packageRoot, {
      packageVersion: "0.3.5",
      contractVersion: "2026-08-13",
    });
    const installed: string[][] = [];

    const result = await syncSkills(
      {
        manifest,
        packageRoot,
        installedRoot,
        statePath,
        dryRun: false,
        force: false,
      },
      {
        install: async (names) => {
          installed.push([...names]);
          mkdirSync(installedRoot, { recursive: true });
          for (const name of names) {
            cpSync(
              join(packageRoot, "skills", name),
              join(installedRoot, name),
              { recursive: true }
            );
          }
        },
      }
    );

    assert.equal(result.action, "synced");
    assert.deepEqual(result.updated, ["alphafox"]);
    assert.deepEqual(installed, [["alphafox"]]);
    assert.equal(result.status.summary.current, 1);
    assert.equal(existsSync(statePath), true);
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    assert.equal(state.packageVersion, "0.3.5");
    assert.equal(state.skills.alphafox.hash, manifest.skills[0]?.hash);
    rmSync(root, { recursive: true, force: true });
  });

  it("blocks modified Skills unless forced and preserves a backup when forced", async () => {
    const root = mkdtempSync(join(tmpdir(), "alphafox-skills-drift-"));
    const packageRoot = join(root, "package");
    const installedPackageRoot = join(root, "installed");
    const installedRoot = join(installedPackageRoot, "skills");
    const statePath = join(root, "config", "skills-state.json");
    writeSkill(packageRoot, "alphafox", "0.3.5", "# Released\n");
    writeSkill(installedPackageRoot, "alphafox", "0.3.5", "# Local edit\n");
    const manifest = buildSkillsManifest(packageRoot, {
      packageVersion: "0.3.5",
      contractVersion: "2026-08-13",
    });
    let installCalls = 0;
    const install = async (names: readonly string[]) => {
      installCalls += 1;
      for (const name of names) {
        cpSync(
          join(packageRoot, "skills", name),
          join(installedRoot, name),
          { recursive: true, force: true }
        );
      }
    };

    const blocked = await syncSkills(
      {
        manifest,
        packageRoot,
        installedRoot,
        statePath,
        dryRun: false,
        force: false,
      },
      { install }
    );
    assert.equal(blocked.action, "skipped");
    assert.deepEqual(blocked.blocked, ["alphafox"]);
    assert.equal(installCalls, 0);
    assert.match(
      readFileSync(join(installedRoot, "alphafox", "SKILL.md"), "utf8"),
      /Local edit/
    );

    const forced = await syncSkills(
      {
        manifest,
        packageRoot,
        installedRoot,
        statePath,
        dryRun: false,
        force: true,
      },
      { install, now: () => new Date("2026-08-16T10:00:00.000Z") }
    );
    assert.equal(forced.action, "synced");
    assert.equal(installCalls, 1);
    assert.ok(forced.backupDir);
    assert.match(
      readFileSync(
        join(forced.backupDir!, "alphafox", "SKILL.md"),
        "utf8"
      ),
      /Local edit/
    );
    assert.match(
      readFileSync(join(installedRoot, "alphafox", "SKILL.md"), "utf8"),
      /Released/
    );
    rmSync(root, { recursive: true, force: true });
  });

  it("verifies the generated bundle manifest before installing instructions", () => {
    const root = mkdtempSync(join(tmpdir(), "alphafox-skills-manifest-"));
    const packageRoot = join(root, "package");
    const manifestPath = join(packageRoot, "dist", "skills-manifest.json");
    writeSkill(packageRoot, "alphafox", "0.3.5", "# Released\n");
    writeSkillsManifest(packageRoot, manifestPath, {
      packageVersion: "0.3.5",
      contractVersion: "2026-08-13",
    });
    const verified = loadAndVerifySkillsManifest(packageRoot, manifestPath);
    assert.equal(verified.packageVersion, "0.3.5");

    const alteredManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    alteredManifest.skills[0].hash = "0".repeat(64);
    writeFileSync(manifestPath, JSON.stringify(alteredManifest));
    assert.throws(
      () => loadAndVerifySkillsManifest(packageRoot, manifestPath),
      (err: unknown) => {
        assert.equal(
          (err as { subtype?: string }).subtype,
          "skills_bundle_integrity"
        );
        return true;
      }
    );
    writeSkillsManifest(packageRoot, manifestPath, {
      packageVersion: "0.3.5",
      contractVersion: "2026-08-13",
    });
    writeFileSync(
      join(packageRoot, "skills", "alphafox", "SKILL.md"),
      "---\nname: alphafox\nversion: 0.3.5\n---\n\n# Tampered\n"
    );
    assert.throws(
      () => loadAndVerifySkillsManifest(packageRoot, manifestPath),
      (err: unknown) => {
        assert.equal(
          (err as { subtype?: string }).subtype,
          "skills_bundle_integrity"
        );
        return true;
      }
    );
    rmSync(root, { recursive: true, force: true });
  });

  it("removes only retired Skills that are still unchanged from managed state", async () => {
    const root = mkdtempSync(join(tmpdir(), "alphafox-skills-retired-"));
    const packageRoot = join(root, "package");
    const installedPackageRoot = join(root, "installed");
    const installedRoot = join(installedPackageRoot, "skills");
    const statePath = join(root, "config", "skills-state.json");
    writeSkill(packageRoot, "alphafox", "0.3.5");
    writeSkill(installedPackageRoot, "alphafox", "0.3.5");
    writeSkill(installedPackageRoot, "alphafox-retired", "0.3.4");
    const retiredHash = hashSkillDirectory(
      join(installedRoot, "alphafox-retired")
    );
    mkdirSync(join(root, "config"), { recursive: true });
    writeFileSync(
      statePath,
      JSON.stringify({
        schemaVersion: 1,
        packageVersion: "0.3.4",
        contractVersion: "2026-08-13",
        bundleHash: "old",
        syncedAt: "2026-08-15T00:00:00.000Z",
        skills: {
          alphafox: {
            version: "0.3.5",
            hash: hashSkillDirectory(join(installedRoot, "alphafox")),
          },
          "alphafox-retired": {
            version: "0.3.4",
            hash: retiredHash,
          },
        },
      })
    );
    const manifest = buildSkillsManifest(packageRoot, {
      packageVersion: "0.3.5",
      contractVersion: "2026-08-13",
    });
    const removed: string[][] = [];

    const result = await syncSkills(
      {
        manifest,
        packageRoot,
        installedRoot,
        statePath,
        dryRun: false,
        force: false,
      },
      {
        install: async () => undefined,
        remove: async (names) => {
          removed.push([...names]);
          for (const name of names) {
            rmSync(join(installedRoot, name), {
              recursive: true,
              force: true,
            });
          }
        },
      }
    );

    assert.deepEqual(result.removed, ["alphafox-retired"]);
    assert.deepEqual(removed, [["alphafox-retired"]]);
    assert.equal(
      existsSync(join(installedRoot, "alphafox-retired")),
      false
    );
    assert.ok(result.backupDir);
    assert.equal(
      existsSync(join(result.backupDir!, "alphafox-retired", "SKILL.md")),
      true
    );
    rmSync(root, { recursive: true, force: true });
  });
});
