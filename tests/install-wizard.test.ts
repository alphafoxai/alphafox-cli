import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { wrapWindowsCommand } from "../src/install/exec";
import {
  findAlphafoxPackageRoot,
  globalBinPath,
  globalPackageRoot,
  packageHasSkills,
} from "../src/install/package-root";
import {
  AGENT_INSTALL_GUIDE_BLOB_URL,
  SKILLS_GITHUB_SOURCE,
  type ExecResult,
  type InstallRunner,
} from "../src/install/types";
import {
  nextSteps,
  parseInstallArgs,
  parseNpmListVersion,
  runInstallWizard,
  semverLessThan,
  skillsListHasAlphafox,
} from "../src/install/wizard";

function fakeRunner(input: {
  readonly exec?: (
    command: string,
    args: readonly string[]
  ) => Promise<ExecResult>;
  readonly execInherit?: (
    command: string,
    args: readonly string[]
  ) => Promise<void>;
  readonly isTty?: boolean;
  readonly confirm?: boolean;
  readonly env?: NodeJS.ProcessEnv;
  readonly searchDirs?: readonly string[];
}): {
  readonly runner: InstallRunner;
  readonly logs: string[];
  readonly execCalls: { command: string; args: readonly string[] }[];
  readonly inheritCalls: { command: string; args: readonly string[] }[];
} {
  const logs: string[] = [];
  const execCalls: { command: string; args: readonly string[] }[] = [];
  const inheritCalls: { command: string; args: readonly string[] }[] = [];
  const runner: InstallRunner = {
    env: input.env ?? {},
    packageSearchDirs: () => input.searchDirs ?? [],
    isTty: () => input.isTty ?? false,
    log: (message) => {
      logs.push(message);
    },
    confirm: async () => input.confirm ?? false,
    exec: async (command, args) => {
      execCalls.push({ command, args: [...args] });
      if (input.exec) return input.exec(command, args);
      return { stdout: "", stderr: "" };
    },
    execInherit: async (command, args) => {
      inheritCalls.push({ command, args: [...args] });
      if (input.execInherit) {
        await input.execInherit(command, args);
        return;
      }
    },
  };
  return { runner, logs, execCalls, inheritCalls };
}

function flags(overrides: Partial<Parameters<typeof runInstallWizard>[0]> = {}) {
  return {
    format: "json" as const,
    yes: false,
    dryRun: false,
    noInput: true,
    noAuth: true,
    help: false,
    ...overrides,
  };
}

describe("install helpers", () => {
  it("parses install flags and rejects leftovers via unknown", () => {
    const parsed = parseInstallArgs(["--no-auth", "--help", "--weird"]);
    assert.equal(parsed.noAuth, true);
    assert.equal(parsed.help, true);
    assert.deepEqual(parsed.unknown, ["--weird"]);
  });

  it("compares semver without prerelease noise", () => {
    assert.equal(semverLessThan("0.1.5", "0.2.0"), true);
    assert.equal(semverLessThan("0.2.0", "0.2.0"), false);
    assert.equal(semverLessThan("0.2.1-rc.1", "0.2.0"), false);
    assert.equal(semverLessThan("0.2.0-rc.1", "0.2.1"), true);
  });

  it("parses npm list -g version lines", () => {
    assert.equal(
      parseNpmListVersion("/usr/lib\n└── @alphafox/cli@0.2.0\n"),
      "0.2.0"
    );
    assert.equal(parseNpmListVersion("empty"), null);
  });

  it("detects alphafox-* skills in ls output", () => {
    assert.equal(skillsListHasAlphafox("lark-im\n"), false);
    assert.equal(skillsListHasAlphafox("alphafox-shared\nalphafox-auth\n"), true);
    assert.equal(skillsListHasAlphafox("  alphafox-trading  "), true);
  });

  it("wraps Windows commands through cmd.exe", () => {
    assert.deepEqual(wrapWindowsCommand("npm", ["install", "-g", "x"], "win32"), {
      file: "cmd.exe",
      argv: ["/c", "npm", "install", "-g", "x"],
    });
    assert.deepEqual(wrapWindowsCommand("npm", ["view", "x"], "linux"), {
      file: "npm",
      argv: ["view", "x"],
    });
  });

  it("resolves global package and bin paths", () => {
    assert.equal(
      globalPackageRoot("/usr/local/lib/node_modules"),
      join("/usr/local/lib/node_modules", "@alphafox", "cli")
    );
    assert.equal(globalBinPath("/usr/local", "linux"), join("/usr/local", "bin", "alphafox"));
    assert.equal(
      globalBinPath("C:\\npm", "win32"),
      join("C:\\npm", "alphafox.cmd")
    );
  });

  it("finds this repo as an @alphafox/cli package with skills", () => {
    const root = findAlphafoxPackageRoot([__dirname, process.cwd()]);
    assert.ok(root);
    assert.equal(packageHasSkills(root), true);
  });

  it("lists login and restart in next steps when auth was skipped", () => {
    const steps = nextSteps({
      auth: { action: "skipped", reason: "no-auth" },
      dryRun: false,
    });
    assert.ok(steps.some((s) => s.includes("重启")));
    assert.ok(steps.some((s) => s.includes("auth login --browser")));
    assert.ok(steps.some((s) => s.includes(AGENT_INSTALL_GUIDE_BLOB_URL)));
  });
});

describe("install wizard", () => {
  it("dry-run plans global CLI + skills without writing", async () => {
    const { runner, execCalls, inheritCalls } = fakeRunner({
      exec: async (command, args) => {
        if (command === "npm" && args[0] === "list") {
          return { stdout: "(empty)", stderr: "" };
        }
        if (command === "npm" && args[0] === "view") {
          return { stdout: "0.2.0\n", stderr: "" };
        }
        if (command === "npm" && args[0] === "root") {
          return { stdout: "/tmp/npm-root\n", stderr: "" };
        }
        throw new Error(`unexpected ${command} ${args.join(" ")}`);
      },
    });
    const result = await runInstallWizard(flags({ dryRun: true }), {}, runner);
    assert.equal(result.cli.action, "planned");
    assert.equal(result.skills.action, "planned");
    assert.equal(result.skills.scope, "global");
    assert.equal(result.skills.source, SKILLS_GITHUB_SOURCE);
    assert.equal(result.auth.action, "skipped");
    assert.equal(result.auth.reason, "no-auth");
    assert.equal(
      execCalls.some((c) => c.command === "npm" && c.args[0] === "install"),
      false
    );
    assert.equal(inheritCalls.length, 0);
    assert.ok(result.next[0]?.includes("dry-run"));
  });

  it("skips npm install when the global CLI is already latest", async () => {
    const { runner, execCalls } = fakeRunner({
      exec: async (command, args) => {
        if (command === "npm" && args[0] === "list") {
          return { stdout: "└── @alphafox/cli@0.2.0\n", stderr: "" };
        }
        if (command === "npm" && args[0] === "view") {
          return { stdout: "0.2.0\n", stderr: "" };
        }
        if (command === "npm" && args[0] === "root") {
          return { stdout: "/tmp/npm-root\n", stderr: "" };
        }
        if (command === "npx" && args.includes("ls")) {
          return { stdout: "alphafox-shared\n", stderr: "" };
        }
        throw new Error(`unexpected ${command} ${args.join(" ")}`);
      },
    });
    const result = await runInstallWizard(flags(), {}, runner);
    assert.equal(result.cli.action, "skipped");
    assert.equal(result.cli.version, "0.2.0");
    assert.equal(result.skills.action, "skipped");
    assert.equal(result.skills.alreadyPresent, true);
    assert.equal(
      execCalls.some((c) => c.command === "npm" && c.args[0] === "install"),
      false
    );
    assert.equal(
      execCalls.some((c) => c.command === "npx" && argsHas(c.args, "add")),
      false
    );
  });

  it("installs CLI then skills from the global package path", async () => {
    const pkg = mkdtempSync(join(tmpdir(), "alphafox-cli-pkg-"));
    mkdirSync(join(pkg, "skills", "alphafox-shared"), { recursive: true });
    writeFileSync(
      join(pkg, "package.json"),
      JSON.stringify({ name: "@alphafox/cli", version: "0.2.0" })
    );
    writeFileSync(join(pkg, "skills", "alphafox-shared", "SKILL.md"), "# skill\n");
    const npmRoot = join(pkg, "node_modules");
    mkdirSync(join(npmRoot, "@alphafox"), { recursive: true });
    // globalPackageRoot(npmRoot) => npmRoot/@alphafox/cli — point a real tree there
    const { symlinkSync, rmSync } = await import("node:fs");
    const dest = join(npmRoot, "@alphafox", "cli");
    try {
      symlinkSync(pkg, dest);
    } catch {
      // copy-less environments: write a second tree
      mkdirSync(join(dest, "skills", "alphafox-shared"), { recursive: true });
      writeFileSync(
        join(dest, "package.json"),
        JSON.stringify({ name: "@alphafox/cli" })
      );
      writeFileSync(
        join(dest, "skills", "alphafox-shared", "SKILL.md"),
        "# skill\n"
      );
    }

    const { runner, execCalls } = fakeRunner({
      exec: async (command, args) => {
        if (command === "npm" && args[0] === "list") {
          const already = execCalls.some(
            (c) => c.command === "npm" && c.args[0] === "install"
          );
          return {
            stdout: already ? "└── @alphafox/cli@0.2.0\n" : "",
            stderr: "",
          };
        }
        if (command === "npm" && args[0] === "view") {
          return { stdout: "0.2.0\n", stderr: "" };
        }
        if (command === "npm" && args[0] === "install") {
          return { stdout: "added 1 package\n", stderr: "" };
        }
        if (command === "npm" && args[0] === "root") {
          return { stdout: `${npmRoot}\n`, stderr: "" };
        }
        if (command === "npx" && args.includes("ls")) {
          return { stdout: "", stderr: "" };
        }
        if (command === "npx" && args.includes("add")) {
          return { stdout: "installed\n", stderr: "" };
        }
        throw new Error(`unexpected ${command} ${args.join(" ")}`);
      },
    });

    const result = await runInstallWizard(flags(), {}, runner);
    assert.equal(result.cli.action, "installed");
    assert.equal(result.skills.action, "installed");
    assert.equal(result.skills.source, dest);
    const add = execCalls.find((c) => c.command === "npx" && argsHas(c.args, "add"));
    assert.ok(add);
    assert.deepEqual(add!.args, ["-y", "skills", "add", dest, "-y", "-g"]);
    rmSync(pkg, { recursive: true, force: true });
  });

  it("falls back to GitHub when local skills add fails", async () => {
    const { runner, execCalls } = fakeRunner({
      searchDirs: [process.cwd()],
      exec: async (command, args) => {
        if (command === "npm" && args[0] === "list") {
          return { stdout: "└── @alphafox/cli@0.2.0\n", stderr: "" };
        }
        if (command === "npm" && args[0] === "view") {
          return { stdout: "0.2.0\n", stderr: "" };
        }
        if (command === "npm" && args[0] === "root") {
          return { stdout: "/missing-root\n", stderr: "" };
        }
        if (command === "npx" && args.includes("ls")) {
          return { stdout: "", stderr: "" };
        }
        if (command === "npx" && args.includes("add")) {
          const source = args[3];
          if (source !== SKILLS_GITHUB_SOURCE) {
            throw new Error("local add failed");
          }
          return { stdout: "ok\n", stderr: "" };
        }
        throw new Error(`unexpected ${command} ${args.join(" ")}`);
      },
    });
    const result = await runInstallWizard(flags(), {}, runner);
    assert.equal(result.skills.action, "installed");
    assert.equal(result.skills.source, SKILLS_GITHUB_SOURCE);
    const adds = execCalls.filter((c) => c.command === "npx" && argsHas(c.args, "add"));
    assert.ok(adds.length >= 2);
    assert.equal(adds[adds.length - 1]?.args[3], SKILLS_GITHUB_SOURCE);
    assert.notEqual(adds[0]?.args[3], SKILLS_GITHUB_SOURCE);
  });

  it("honors ALPHAFOX_SKILLS_SOURCE and skips auth when --no-auth", async () => {
    const { runner, inheritCalls } = fakeRunner({
      env: { ALPHAFOX_SKILLS_SOURCE: "/tmp/custom-skills" },
      isTty: true,
      confirm: true,
      exec: async (command, args) => {
        if (command === "npm" && args[0] === "list") {
          return { stdout: "└── @alphafox/cli@0.2.0\n", stderr: "" };
        }
        if (command === "npm" && args[0] === "view") {
          return { stdout: "0.2.0\n", stderr: "" };
        }
        if (command === "npx" && args.includes("ls")) {
          return { stdout: "", stderr: "" };
        }
        if (command === "npx" && args.includes("add")) {
          return { stdout: "ok\n", stderr: "" };
        }
        throw new Error(`unexpected ${command} ${args.join(" ")}`);
      },
    });
    const result = await runInstallWizard(flags({ noAuth: true }), {}, runner);
    assert.equal(result.skills.source, "/tmp/custom-skills");
    assert.equal(result.auth.action, "skipped");
    assert.equal(result.auth.reason, "no-auth");
    assert.equal(inheritCalls.length, 0);
  });

  it("runs browser login on TTY when the user confirms", async () => {
    const { runner, inheritCalls } = fakeRunner({
      env: { ALPHAFOX_SKILLS_SOURCE: "alphafoxai/alphafox-cli" },
      isTty: true,
      confirm: true,
      exec: async (command, args) => {
        if (command === "npm" && args[0] === "list") {
          return { stdout: "└── @alphafox/cli@0.2.0\n", stderr: "" };
        }
        if (command === "npm" && args[0] === "view") {
          return { stdout: "0.2.0\n", stderr: "" };
        }
        if (command === "npm" && args[0] === "prefix") {
          return { stdout: "/usr/local\n", stderr: "" };
        }
        if (command === "npx") {
          if (args.includes("ls")) return { stdout: "alphafox-shared\n", stderr: "" };
          return { stdout: "", stderr: "" };
        }
        if (command === "which") {
          return { stdout: "/usr/local/bin/alphafox\n", stderr: "" };
        }
        throw new Error(`unexpected ${command} ${args.join(" ")}`);
      },
    });
    const result = await runInstallWizard(
      flags({ noAuth: false, noInput: false }),
      {},
      runner
    );
    assert.equal(result.auth.action, "completed");
    assert.equal(inheritCalls.length, 1);
    assert.deepEqual(inheritCalls[0]?.args, ["auth", "login", "--browser"]);
  });

  it("fails closed when npm install -g fails", async () => {
    const { runner } = fakeRunner({
      exec: async (command, args) => {
        if (command === "npm" && args[0] === "list") {
          return { stdout: "", stderr: "" };
        }
        if (command === "npm" && args[0] === "view") {
          return { stdout: "0.2.0\n", stderr: "" };
        }
        if (command === "npm" && args[0] === "install") {
          throw new Error("EACCES");
        }
        throw new Error(`unexpected ${command} ${args.join(" ")}`);
      },
    });
    await assert.rejects(
      () => runInstallWizard(flags(), {}, runner),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.equal((err as { subtype?: string }).subtype, "npm_global_failed");
        return true;
      }
    );
  });
});

function argsHas(args: readonly string[], token: string): boolean {
  return args.includes(token);
}
