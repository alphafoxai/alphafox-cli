import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

const loadCjs = createRequire(__filename);
const uninstall = loadCjs("../../scripts/uninstall.cjs") as {
  readonly CLI_PACKAGE: string;
  readonly UNINSTALL_CURL: string;
  readonly UNINSTALL_DRY_RUN: string;
  readonly USAGE_EXIT: number;
  readonly buildUninstallPlan: (env?: NodeJS.ProcessEnv) => readonly {
    readonly kind: string;
    readonly path?: string;
    readonly profile?: string;
    readonly package?: string;
  }[];
  readonly parseUninstallArgs: (argv: readonly string[]) => {
    readonly dryRun: boolean;
    readonly yes: boolean;
    readonly help: boolean;
    readonly unknown: readonly string[];
  };
  readonly runUninstall: (input: {
    readonly env?: NodeJS.ProcessEnv;
    readonly flags?: {
      readonly dryRun: boolean;
      readonly yes: boolean;
      readonly help: boolean;
      readonly unknown: readonly string[];
    };
    readonly log?: (message: string) => void;
    readonly runCommand?: (
      command: string,
      args: readonly string[]
    ) => {
      readonly status: number | null;
      readonly stdout: string;
      readonly stderr: string;
      readonly error?: NodeJS.ErrnoException;
    };
    readonly isTty?: () => boolean;
    readonly confirm?: () => Promise<boolean>;
  }) => Promise<{
    readonly ok: boolean;
    readonly exitCode?: number;
    readonly dryRun?: boolean;
    readonly cancelled?: boolean;
    readonly removed?: readonly string[];
    readonly errors?: readonly string[];
    readonly error?: string;
    readonly plan?: readonly {
      readonly kind: string;
      readonly path?: string;
    }[];
  }>;
};

const scriptPath = join(__dirname, "..", "..", "scripts", "uninstall.cjs");
const readmePath = join(__dirname, "..", "..", "README.md");

function sandboxEnv() {
  const root = mkdtempSync(join(tmpdir(), "alphafox-uninstall-"));
  const home = join(root, "home");
  const skills = join(home, ".agents", "skills");
  const claude = join(home, ".claude", "skills");
  const cursor = join(home, ".cursor", "skills");
  const grok = join(home, ".grok", "skills");
  const config = join(home, ".config", "alphafox");
  const tape = join(home, ".alphafox", "cache", "engine-backtest");
  const runtime = join(home, ".cache", "alphafox", "engine-backtest");
  mkdirSync(skills, { recursive: true });
  mkdirSync(claude, { recursive: true });
  mkdirSync(cursor, { recursive: true });
  mkdirSync(grok, { recursive: true });
  mkdirSync(config, { recursive: true });
  mkdirSync(tape, { recursive: true });
  mkdirSync(runtime, { recursive: true });
  writeSkill(join(skills, "alphafox"), "alphafox");
  writeSkill(join(skills, "alphafox-account"), "alphafox-account");
  writeSkill(join(skills, "unrelated"), "unrelated");
  writeSkill(join(skills, "account"), "alphafox-exchange");
  symlinkSync(join(skills, "alphafox"), join(claude, "alphafox"));
  symlinkSync(join(skills, "alphafox"), join(cursor, "alphafox"));
  writeSkill(join(grok, "alphafox-trading"), "alphafox-trading");
  writeFileSync(join(config, "config.json"), "{}\n");
  writeFileSync(join(tape, "tape.bin"), "ohlcv");
  writeFileSync(join(runtime, "runtime.wasm"), "wasm");
  return {
    root,
    home,
    skills,
    claude,
    cursor,
    grok,
    config,
    tape,
    runtime,
    env: {
      ALPHAFOX_AGENT_HOME: home,
      ALPHAFOX_SKILLS_DIR: skills,
      ALPHAFOX_CONFIG_DIR: config,
      ALPHAFOX_TAPE_CACHE_DIR: tape,
      ALPHAFOX_BACKTEST_RUNTIME_CACHE_DIR: runtime,
      ALPHAFOX_KEYCHAIN_PLATFORM: "darwin",
      HOME: home,
      USERPROFILE: home,
    },
  };
}

function writeSkill(dir: string, name: string) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "SKILL.md"),
    `---\nname: ${name}\nversion: 0.3.12\n---\n\n# ${name}\n`
  );
}

function fakeExec() {
  const calls: { command: string; args: readonly string[] }[] = [];
  return {
    calls,
    runCommand(command: string, args: readonly string[]) {
      calls.push({ command, args });
      return { status: 0, stdout: "", stderr: "" };
    },
  };
}

const silentLog = () => {};

describe("uninstall script", () => {
  it("parses file argv and piped stdin argv", () => {
    assert.deepEqual(uninstall.parseUninstallArgs(["node", scriptPath, "--yes"]), {
      dryRun: false,
      yes: true,
      help: false,
      unknown: [],
    });
    assert.deepEqual(uninstall.parseUninstallArgs(["node", "--", "--dry-run"]), {
      dryRun: true,
      yes: false,
      help: false,
      unknown: [],
    });
    assert.deepEqual(uninstall.parseUninstallArgs(["node", "-", "--yes"]), {
      dryRun: false,
      yes: true,
      help: false,
      unknown: [],
    });
  });

  it("rejects unknown flags", async () => {
    const result = await uninstall.runUninstall({
      flags: {
        dryRun: false,
        yes: true,
        help: false,
        unknown: ["--please-break"],
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.exitCode, uninstall.USAGE_EXIT);
    assert.match(String(result.error), /please-break/);
  });

  it("dry-run lists managed paths without deleting them", async () => {
    const box = sandboxEnv();
    const exec = fakeExec();
    try {
      const result = await uninstall.runUninstall({
        env: box.env,
        flags: { dryRun: true, yes: false, help: false, unknown: [] },
        runCommand: exec.runCommand,
        isTty: () => false,
        log: silentLog,
      });
      assert.equal(result.ok, true);
      assert.equal(result.dryRun, true);
      assert.equal(exec.calls.length, 0);
      assert.equal(existsSync(join(box.skills, "alphafox", "SKILL.md")), true);
      assert.equal(existsSync(join(box.config, "config.json")), true);
      const paths = (result.plan ?? [])
        .filter((item) => item.kind === "path")
        .map((item) => item.path);
      assert.ok(paths.includes(join(box.skills, "alphafox")));
      assert.ok(!paths.includes(join(box.skills, "unrelated")));
    } finally {
      rmSync(box.root, { recursive: true, force: true });
    }
  });

  it("requires --yes when stdin is not a TTY", async () => {
    const result = await uninstall.runUninstall({
      flags: { dryRun: false, yes: false, help: false, unknown: [] },
      isTty: () => false,
    });
    assert.equal(result.ok, false);
    assert.equal(result.exitCode, uninstall.USAGE_EXIT);
    assert.match(String(result.error), /--yes/);
  });

  it("cancels when the operator declines", async () => {
    const box = sandboxEnv();
    const exec = fakeExec();
    try {
      const result = await uninstall.runUninstall({
        env: box.env,
        flags: { dryRun: false, yes: false, help: false, unknown: [] },
        runCommand: exec.runCommand,
        isTty: () => true,
        confirm: async () => false,
        log: silentLog,
      });
      assert.equal(result.ok, true);
      assert.equal(result.cancelled, true);
      assert.equal(exec.calls.length, 0);
      assert.equal(existsSync(join(box.skills, "alphafox", "SKILL.md")), true);
    } finally {
      rmSync(box.root, { recursive: true, force: true });
    }
  });

  it("removes CLI artifacts, Skills, and caches while keeping other skills", async () => {
    const box = sandboxEnv();
    const exec = fakeExec();
    try {
      const result = await uninstall.runUninstall({
        env: box.env,
        flags: { dryRun: false, yes: true, help: false, unknown: [] },
        runCommand: exec.runCommand,
        isTty: () => false,
        log: silentLog,
      });
      assert.equal(result.ok, true, (result.errors ?? []).join("\n"));
      assert.equal(existsSync(join(box.skills, "alphafox")), false);
      assert.equal(existsSync(join(box.skills, "alphafox-account")), false);
      assert.equal(existsSync(join(box.skills, "account")), false);
      assert.equal(existsSync(join(box.claude, "alphafox")), false);
      assert.equal(existsSync(join(box.cursor, "alphafox")), false);
      assert.equal(existsSync(join(box.grok, "alphafox-trading")), false);
      assert.equal(existsSync(join(box.skills, "unrelated", "SKILL.md")), true);
      assert.equal(existsSync(box.config), false);
      assert.equal(existsSync(box.tape), false);
      assert.equal(existsSync(join(box.home, ".cache", "alphafox")), false);
      assert.equal(existsSync(join(box.home, ".alphafox")), false);

      const npm = exec.calls.find(
        (call) => call.command === "npm" && call.args[0] === "uninstall"
      );
      assert.deepEqual(npm?.args, ["uninstall", "-g", uninstall.CLI_PACKAGE]);
      const keychain = exec.calls.filter((call) => call.command === "security");
      assert.equal(keychain.length, 3);
      assert.ok(
        keychain.every((call) => call.args.includes("alphafox-cli.production") ||
          call.args.includes("alphafox-cli.staging") ||
          call.args.includes("alphafox-cli.local"))
      );
    } finally {
      rmSync(box.root, { recursive: true, force: true });
    }
  });

  it("surfaces npm uninstall failure without hiding it", async () => {
    const box = sandboxEnv();
    try {
      const result = await uninstall.runUninstall({
        env: box.env,
        flags: { dryRun: false, yes: true, help: false, unknown: [] },
        runCommand: (command) => {
          if (command === "npm") {
            return { status: 1, stdout: "", stderr: "EACCES" };
          }
          return { status: 0, stdout: "", stderr: "" };
        },
        isTty: () => false,
        log: silentLog,
      });
      assert.equal(result.ok, false);
      assert.equal(result.exitCode, 1);
      assert.ok((result.errors ?? []).some((line) => line.includes("EACCES")));
      assert.equal(existsSync(join(box.skills, "alphafox")), false);
    } finally {
      rmSync(box.root, { recursive: true, force: true });
    }
  });

  it("help spawn does not contact npm", () => {
    const r = spawnSync(process.execPath, [scriptPath, "--help"], {
      encoding: "utf8",
    });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /scripts\/uninstall\.cjs/);
    assert.match(r.stderr, /--yes/);
  });

  it("README documents the one-line uninstall commands", () => {
    const readme = readFileSync(readmePath, "utf8");
    assert.ok(readme.includes("## Uninstall"));
    assert.ok(readme.includes(uninstall.UNINSTALL_CURL));
    assert.ok(readme.includes(uninstall.UNINSTALL_DRY_RUN));
  });
});
