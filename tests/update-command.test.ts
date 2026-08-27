import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { InstallRunner } from "../src/install/types";
import type { SkillsSyncResult } from "../src/skills/manager";
import {
  executeCliUpdate,
  parseUpdateArgs,
} from "../src/update/run-command";

function runnerFor(
  exec: InstallRunner["exec"]
): {
  readonly runner: InstallRunner;
  readonly calls: { command: string; args: readonly string[] }[];
} {
  const calls: { command: string; args: readonly string[] }[] = [];
  return {
    calls,
    runner: {
      env: {},
      packageSearchDirs: () => [],
      isTty: () => false,
      confirm: async () => false,
      log: () => undefined,
      exec: async (command, args, options) => {
        calls.push({ command, args: [...args] });
        return await exec(command, args, options);
      },
      execInherit: async () => undefined,
    },
  };
}

const SYNCED: SkillsSyncResult = {
  action: "synced",
  updated: ["alphafox"],
  removed: [],
  blocked: [],
  status: {
    bundleVersion: "0.3.5",
    contractVersion: "2026-08-13",
    bundleHash: "hash",
    installedRoot: "/home/test/.agents/skills",
    skills: [],
    orphans: [],
    summary: { current: 1, missing: 0, stale: 0, modified: 0 },
    agentLinks: [],
    restartRequired: false,
  },
  restartRequired: true,
};

describe("CLI update", () => {
  it("checks npm latest without mutating the CLI or Skills", async () => {
    const { runner, calls } = runnerFor(async (command, args) => {
      if (command === "npm" && args[0] === "list") {
        return { stdout: "└── @alphafox/cli@0.3.4\n", stderr: "" };
      }
      if (command === "npm" && args[0] === "view") {
        return { stdout: "0.3.5\n", stderr: "" };
      }
      throw new Error(`unexpected ${command} ${args.join(" ")}`);
    });

    const result = await executeCliUpdate(
      parseUpdateArgs(["--check"]),
      { yes: false, dryRun: false },
      {},
      { runner }
    );

    assert.equal(result.currentVersion, "0.3.4");
    assert.equal(result.targetVersion, "0.3.5");
    assert.equal(result.updateAvailable, true);
    assert.equal(result.cli.action, "available");
    assert.equal(result.skills.action, "not-run");
    assert.equal(
      calls.some((call) => call.args[0] === "install"),
      false
    );
  });

  it("does not treat an unpublished newer local install as a downgrade candidate", async () => {
    const { runner, calls } = runnerFor(async (command, args) => {
      if (command === "npm" && args[0] === "list") {
        return { stdout: "└── @alphafox/cli@0.3.5\n", stderr: "" };
      }
      if (command === "npm" && args[0] === "view") {
        return { stdout: "0.3.4\n", stderr: "" };
      }
      throw new Error(`unexpected ${command} ${args.join(" ")}`);
    });

    const result = await executeCliUpdate(
      parseUpdateArgs(["--check"]),
      { yes: false, dryRun: false },
      {},
      { runner }
    );

    assert.equal(result.updateAvailable, false);
    assert.equal(result.cli.action, "current");
    assert.equal(
      calls.some((call) => call.args[0] === "install"),
      false
    );
  });

  it("installs an exact npm version and then syncs its bundled Skills", async () => {
    let installed = false;
    const { runner, calls } = runnerFor(async (command, args) => {
      if (command === "npm" && args[0] === "list") {
        return {
          stdout: `└── @alphafox/cli@${installed ? "0.3.5" : "0.3.4"}\n`,
          stderr: "",
        };
      }
      if (command === "npm" && args[0] === "view") {
        return { stdout: "0.3.5\n", stderr: "" };
      }
      if (command === "npm" && args[0] === "install") {
        installed = true;
        return { stdout: "updated\n", stderr: "" };
      }
      if (command === "npm" && args[0] === "root") {
        return { stdout: "/npm/root\n", stderr: "" };
      }
      throw new Error(`unexpected ${command} ${args.join(" ")}`);
    });
    const syncedRoots: string[] = [];

    const result = await executeCliUpdate(
      parseUpdateArgs(["--version", "0.3.5"]),
      { yes: false, dryRun: false },
      {},
      {
        runner,
        packageHasSkills: () => true,
        sync: async (packageRoot) => {
          syncedRoots.push(packageRoot);
          return SYNCED;
        },
      }
    );

    assert.equal(result.cli.action, "updated");
    assert.deepEqual(syncedRoots, ["/npm/root/@alphafox/cli"]);
    assert.ok(
      calls.some(
        (call) =>
          call.command === "npm" &&
          call.args.join(" ") === "install -g @alphafox/cli@0.3.5"
      )
    );
    assert.equal(result.skills.action, "synced");
  });
});
