import { homedir } from "node:os";
import { join } from "node:path";

import { defaultConfigDir } from "../config/profiles";
import { writeSuccess } from "../envelope";
import { createDefaultInstallRunner } from "../install/exec";
import { findAlphafoxPackageRoot } from "../install/package-root";
import type { InstallRunner } from "../install/types";
import {
  inspectSkills,
  loadAndVerifySkillsManifest,
  loadSkillsState,
  syncSkills,
  type SkillsStatus,
  type SkillsSyncResult,
} from "./manager";

const SKILLS_TIMEOUT_MS = 120_000;

export interface SkillsCliFlags {
  readonly format: "json" | "jsonl" | "text";
  readonly yes: boolean;
  readonly dryRun: boolean;
  readonly noInput: boolean;
  readonly jq?: string;
}

export interface SkillsCommandDeps {
  readonly runner?: InstallRunner;
  readonly packageRoot?: string;
}

export function installedSkillsRoot(
  env: NodeJS.ProcessEnv = process.env
): string {
  return (
    env.ALPHAFOX_SKILLS_DIR?.trim() ||
    join(homedir(), ".agents", "skills")
  );
}

export function skillsStatePath(
  env: NodeJS.ProcessEnv = process.env
): string {
  return join(defaultConfigDir(env), "skills-state.json");
}

export function resolveCurrentSkillsPackageRoot(
  searchDirs: readonly string[] = [__dirname, process.cwd()]
): string {
  const root = findAlphafoxPackageRoot(searchDirs);
  if (!root) {
    throw Object.assign(
      new Error("Could not locate the installed @alphafox/cli Skills bundle"),
      {
        type: "install",
        subtype: "skills_package_missing",
      }
    );
  }
  return root;
}

export function inspectCurrentSkills(
  env: NodeJS.ProcessEnv = process.env,
  packageRoot = resolveCurrentSkillsPackageRoot()
): SkillsStatus {
  const manifest = loadAndVerifySkillsManifest(packageRoot);
  return inspectSkills({
    manifest,
    installedRoot: installedSkillsRoot(env),
    state: loadSkillsState(skillsStatePath(env)),
  });
}

export async function syncCurrentSkills(
  input: {
    readonly force: boolean;
    readonly dryRun: boolean;
  },
  env: NodeJS.ProcessEnv = process.env,
  deps: SkillsCommandDeps = {}
): Promise<SkillsSyncResult> {
  const packageRoot =
    deps.packageRoot ?? resolveCurrentSkillsPackageRoot();
  const runner =
    deps.runner ??
    createDefaultInstallRunner(env, [__dirname, process.cwd()]);
  const manifest = loadAndVerifySkillsManifest(packageRoot);
  return await syncSkills(
    {
      manifest,
      packageRoot,
      installedRoot: installedSkillsRoot(env),
      statePath: skillsStatePath(env),
      dryRun: input.dryRun,
      force: input.force,
    },
    {
      install: async (names) => {
        await runner.exec(
          "npx",
          [
            "-y",
            "skills",
            "add",
            packageRoot,
            "-y",
            "-g",
            "--skill",
            ...names,
          ],
          { timeoutMs: SKILLS_TIMEOUT_MS }
        );
      },
      remove: async (names) => {
        await runner.exec(
          "npx",
          ["-y", "skills", "remove", ...names, "-y", "-g"],
          { timeoutMs: SKILLS_TIMEOUT_MS }
        );
      },
    }
  );
}

export async function cmdSkills(
  args: string[],
  flags: SkillsCliFlags,
  env: NodeJS.ProcessEnv = process.env,
  deps: SkillsCommandDeps = {}
): Promise<number> {
  const parsed = parseSkillsArgs(args);
  if (parsed.action === "help") {
    writeSuccess(
      {
        name: "skills",
        usage: [
          "alphafox skills status",
          "alphafox skills sync [--dry-run]",
          "alphafox skills sync --force --yes",
        ],
        notes: [
          "Skills are synced only from the verified bundle inside the installed @alphafox/cli package",
          "Modified Skills are preserved unless --force --yes is explicit",
          "Restart the AI tool after a successful sync",
        ],
      },
      { format: flags.format, jq: flags.jq }
    );
    return 0;
  }
  if (parsed.action === "status") {
    writeSuccess(
      inspectCurrentSkills(
        env,
        deps.packageRoot ?? resolveCurrentSkillsPackageRoot()
      ),
      { format: flags.format, jq: flags.jq }
    );
    return 0;
  }
  const runner =
    deps.runner ??
    createDefaultInstallRunner(env, [__dirname, process.cwd()]);
  if (parsed.force && !flags.yes) {
    const confirmed =
      !flags.noInput &&
      runner.isTty() &&
      (await runner.confirm(
        "Modified AlphaFox Skills will be backed up and replaced. Continue?"
      ));
    if (!confirmed) {
      throw Object.assign(
        new Error("Replacing modified Skills requires --force --yes"),
        {
          type: "confirmation",
          subtype: "skills_force_confirmation_required",
        }
      );
    }
  }
  const result = await syncCurrentSkills(
    { force: parsed.force, dryRun: flags.dryRun },
    env,
    { ...deps, runner }
  );
  writeSuccess(result, { format: flags.format, jq: flags.jq });
  return result.blocked.length > 0 ? 1 : 0;
}

function parseSkillsArgs(args: readonly string[]): {
  readonly action: "status" | "sync" | "help";
  readonly force: boolean;
} {
  const actionToken = args[0] ?? "status";
  if (
    actionToken === "help" ||
    actionToken === "--help" ||
    actionToken === "-h"
  ) {
    return { action: "help", force: false };
  }
  if (actionToken !== "status" && actionToken !== "sync") {
    throw usageError(`Unknown skills action: ${actionToken}`);
  }
  let force = false;
  for (const arg of args.slice(1)) {
    if (arg === "--force") force = true;
    else if (arg === "--help" || arg === "-h") {
      return { action: "help", force: false };
    } else {
      throw usageError(`Unknown skills argument: ${arg}`);
    }
  }
  if (actionToken === "status" && force) {
    throw usageError("--force is only valid with skills sync");
  }
  return { action: actionToken, force };
}

function usageError(message: string): Error {
  return Object.assign(new Error(message), {
    type: "usage",
    subtype: "invalid_skills_args",
    status: 64,
  });
}
