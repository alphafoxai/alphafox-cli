import { writeSuccess } from "../envelope";
import { createDefaultInstallRunner } from "../install/exec";
import {
  globalPackageRoot,
  packageHasSkills as defaultPackageHasSkills,
} from "../install/package-root";
import type { InstallRunner } from "../install/types";
import {
  parseNpmListVersion,
  semverLessThan,
} from "../install/wizard";
import {
  resolveCurrentSkillsPackageRoot,
  syncCurrentSkills,
} from "../skills/run-command";
import type { SkillsSyncResult } from "../skills/manager";
import { CLI_PACKAGE } from "../version";

const NPM_TIMEOUT_MS = 120_000;

export interface UpdateArgs {
  readonly check: boolean;
  readonly help: boolean;
  readonly version?: string;
}

export interface UpdateExecutionFlags {
  readonly yes: boolean;
  readonly dryRun: boolean;
}

export interface UpdateCliFlags extends UpdateExecutionFlags {
  readonly format: "json" | "jsonl" | "text";
  readonly noInput: boolean;
  readonly jq?: string;
}

export interface UpdateDeps {
  readonly runner?: InstallRunner;
  readonly packageHasSkills?: (packageRoot: string) => boolean;
  readonly sync?: (
    packageRoot: string,
    runner: InstallRunner
  ) => Promise<SkillsSyncResult>;
}

export interface CliUpdateResult {
  readonly currentVersion: string | null;
  readonly targetVersion: string;
  readonly updateAvailable: boolean;
  readonly checkOnly: boolean;
  readonly dryRun: boolean;
  readonly cli: {
    readonly action: "available" | "planned" | "updated" | "current";
    readonly previousVersion: string | null;
    readonly version: string;
  };
  readonly skills:
    | SkillsSyncResult
    | {
        readonly action: "not-run";
        readonly reason: "check-only" | "dry-run";
      };
  readonly restartRequired: boolean;
}

export function parseUpdateArgs(args: readonly string[]): UpdateArgs {
  let check = false;
  let help = false;
  let version: string | undefined;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (arg === "--check") {
      check = true;
    } else if (arg === "--version") {
      version = args[++i];
      if (!version) throw updateUsage("--version requires a value");
    } else if (arg.startsWith("--version=")) {
      version = arg.slice("--version=".length);
    } else if (arg === "--help" || arg === "-h" || arg === "help") {
      help = true;
    } else {
      throw updateUsage(`Unknown update argument: ${arg}`);
    }
  }
  if (version && !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw updateUsage(`Invalid version: ${version}`);
  }
  return { check, help, ...(version ? { version } : {}) };
}

export async function executeCliUpdate(
  args: UpdateArgs,
  flags: UpdateExecutionFlags,
  env: NodeJS.ProcessEnv = process.env,
  deps: UpdateDeps = {}
): Promise<CliUpdateResult> {
  const runner =
    deps.runner ??
    createDefaultInstallRunner(env, [__dirname, process.cwd()]);
  const currentVersion = await readGlobalVersion(runner);
  const targetVersion = await readTargetVersion(runner, args.version);
  const updateAvailable = args.version
    ? currentVersion !== targetVersion
    : currentVersion == null || semverLessThan(currentVersion, targetVersion);
  const effectiveVersion =
    updateAvailable ? targetVersion : (currentVersion ?? targetVersion);

  if (args.check) {
    return {
      currentVersion,
      targetVersion,
      updateAvailable,
      checkOnly: true,
      dryRun: false,
      cli: {
        action: updateAvailable ? "available" : "current",
        previousVersion: currentVersion,
        version: effectiveVersion,
      },
      skills: { action: "not-run", reason: "check-only" },
      restartRequired: false,
    };
  }
  if (
    updateAvailable &&
    args.version &&
    currentVersion &&
    semverLessThan(targetVersion, currentVersion) &&
    !flags.yes
  ) {
    throw Object.assign(
      new Error(
        `Downgrading ${CLI_PACKAGE} from ${currentVersion} to ${targetVersion} requires --yes`
      ),
      {
        type: "confirmation",
        subtype: "cli_downgrade_confirmation_required",
      }
    );
  }
  if (flags.dryRun) {
    return {
      currentVersion,
      targetVersion,
      updateAvailable,
      checkOnly: false,
      dryRun: true,
      cli: {
        action: updateAvailable ? "planned" : "current",
        previousVersion: currentVersion,
        version: effectiveVersion,
      },
      skills: { action: "not-run", reason: "dry-run" },
      restartRequired: updateAvailable,
    };
  }

  if (updateAvailable) {
    await runner.exec(
      "npm",
      ["install", "-g", `${CLI_PACKAGE}@${targetVersion}`],
      { timeoutMs: NPM_TIMEOUT_MS }
    );
    const installedVersion = await readGlobalVersion(runner);
    if (installedVersion !== targetVersion) {
      throw Object.assign(
        new Error(
          `npm reported ${installedVersion ?? "no global install"} after updating to ${targetVersion}`
        ),
        {
          type: "install",
          subtype: "cli_update_verify_failed",
        }
      );
    }
  }
  const packageRoot = await resolveUpdatedPackageRoot(
    runner,
    deps.packageHasSkills ?? defaultPackageHasSkills,
    !updateAvailable
  );
  const sync =
    deps.sync ??
    (async (root: string, activeRunner: InstallRunner) =>
      await syncCurrentSkills(
        { force: false, dryRun: false },
        env,
        { runner: activeRunner, packageRoot: root }
      ));
  const skills = await sync(packageRoot, runner);
  return {
    currentVersion,
    targetVersion,
    updateAvailable,
    checkOnly: false,
    dryRun: false,
    cli: {
      action: updateAvailable ? "updated" : "current",
      previousVersion: currentVersion,
      version: effectiveVersion,
    },
    skills,
    restartRequired: updateAvailable || skills.restartRequired,
  };
}

export async function cmdUpdate(
  args: string[],
  flags: UpdateCliFlags,
  env: NodeJS.ProcessEnv = process.env,
  deps: UpdateDeps = {}
): Promise<number> {
  const parsed = parseUpdateArgs(args);
  if (parsed.help) {
    writeSuccess(
      {
        name: "update",
        usage: [
          "alphafox update --check",
          "alphafox update [--dry-run]",
          "alphafox update --version <version> [--yes]",
        ],
        notes: [
          "Updates @alphafox/cli through npm, then syncs the verified co-versioned Skills bundle",
          "A downgrade requires --yes",
          "No Skills are downloaded independently from GitHub",
        ],
      },
      { format: flags.format, jq: flags.jq }
    );
    return 0;
  }
  const result = await executeCliUpdate(parsed, flags, env, deps);
  writeSuccess(result, { format: flags.format, jq: flags.jq });
  return result.skills.action !== "not-run" &&
    result.skills.blocked.length > 0
    ? 1
    : 0;
}

async function readGlobalVersion(
  runner: InstallRunner
): Promise<string | null> {
  try {
    const { stdout, stderr } = await runner.exec(
      "npm",
      ["list", "-g", CLI_PACKAGE, "--depth=0"],
      { timeoutMs: 15_000 }
    );
    return parseNpmListVersion(`${stdout}\n${stderr}`);
  } catch {
    return null;
  }
}

async function readTargetVersion(
  runner: InstallRunner,
  requested?: string
): Promise<string> {
  const spec = requested ? `${CLI_PACKAGE}@${requested}` : CLI_PACKAGE;
  const { stdout } = await runner.exec("npm", ["view", spec, "version"], {
    timeoutMs: 15_000,
  });
  const version = stdout.trim();
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw Object.assign(
      new Error(`npm returned an invalid version for ${spec}`),
      {
        type: "install",
        subtype: "npm_version_invalid",
      }
    );
  }
  return version;
}

async function resolveUpdatedPackageRoot(
  runner: InstallRunner,
  packageHasSkills: (packageRoot: string) => boolean,
  allowCurrentFallback: boolean
): Promise<string> {
  try {
    const { stdout } = await runner.exec("npm", ["root", "-g"], {
      timeoutMs: 15_000,
    });
    const root = globalPackageRoot(stdout.trim());
    if (packageHasSkills(root)) return root;
  } catch {
    // Fall back to the currently executing package for repair-only updates.
  }
  if (!allowCurrentFallback) {
    throw Object.assign(
      new Error("Updated @alphafox/cli package does not contain Skills"),
      {
        type: "install",
        subtype: "updated_skills_missing",
      }
    );
  }
  const current = resolveCurrentSkillsPackageRoot(
    runner.packageSearchDirs().length > 0
      ? runner.packageSearchDirs()
      : [__dirname, process.cwd()]
  );
  if (packageHasSkills(current)) return current;
  throw Object.assign(
    new Error("Updated @alphafox/cli package does not contain Skills"),
    {
      type: "install",
      subtype: "updated_skills_missing",
    }
  );
}

function updateUsage(message: string): Error {
  return Object.assign(new Error(message), {
    type: "usage",
    subtype: "invalid_update_args",
    status: 64,
  });
}

