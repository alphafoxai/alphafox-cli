import { existsSync } from "node:fs";
import { join } from "node:path";

import { CLI_PACKAGE, CLI_VERSION } from "../version";
import { createDefaultInstallRunner } from "./exec";
import {
  findAlphafoxPackageRoot,
  globalBinPath,
  globalPackageRoot,
  packageHasSkills,
} from "./package-root";
import {
  AGENT_INSTALL_GUIDE_BLOB_URL,
  InstallError,
  SKILLS_GITHUB_SOURCE,
  SKILLS_NAME_PREFIX,
  type InstallAuthStep,
  type InstallCliStep,
  type InstallFlags,
  type InstallResult,
  type InstallRunner,
  type InstallSkillsStep,
} from "./types";

const NPM_TIMEOUT_MS = 120_000;
const SKILLS_TIMEOUT_MS = 120_000;

export function parseInstallArgs(args: readonly string[]): {
  readonly noAuth: boolean;
  readonly help: boolean;
  readonly unknown: readonly string[];
} {
  let noAuth = false;
  let help = false;
  const unknown: string[] = [];
  for (const arg of args) {
    if (arg === "--no-auth") {
      noAuth = true;
    } else if (arg === "--help" || arg === "-h") {
      help = true;
    } else {
      unknown.push(arg);
    }
  }
  return { noAuth, help, unknown };
}

export function semverLessThan(a: string, b: string): boolean {
  const pa = stripPrerelease(a).split(".").map((part) => Number(part) || 0);
  const pb = stripPrerelease(b).split(".").map((part) => Number(part) || 0);
  for (let i = 0; i < 3; i += 1) {
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return true;
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return false;
  }
  return false;
}

export function parseNpmListVersion(output: string): string | null {
  const match = output.match(/@(\d+\.\d+\.\d+[^\s]*)/);
  return match?.[1] ?? null;
}

export function skillsListHasAlphafox(output: string): boolean {
  const prefix = SKILLS_NAME_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|\\s)${prefix}[\\w-]+`, "m").test(output);
}

export function nextSteps(input: {
  readonly auth: InstallAuthStep;
  readonly dryRun: boolean;
}): string[] {
  const steps = [
    "Restart the AI tool so newly installed Skills are loaded.",
  ];
  if (input.auth.action === "skipped" || input.auth.action === "planned") {
    steps.push(
      "alphafox auth login --browser --format json --no-input",
      "alphafox auth login --no-wait --format json --no-input"
    );
  }
  steps.push(
    "alphafox doctor --format json --no-input",
    `Agent install guide: ${AGENT_INSTALL_GUIDE_BLOB_URL}`
  );
  if (input.dryRun) {
    steps.unshift("This was --dry-run; re-run without it to apply changes.");
  }
  return steps;
}

export async function runInstallWizard(
  flags: InstallFlags,
  env: NodeJS.ProcessEnv = process.env,
  runner: InstallRunner = createDefaultInstallRunner(env, defaultSearchDirs())
): Promise<InstallResult> {
  runner.log("Setting up Alphafox CLI...");

  const installedVer = await readGloballyInstalledVersion(runner);
  const latestVer = await readLatestVersion(runner);
  const needsUpgrade =
    Boolean(installedVer) &&
    Boolean(latestVer) &&
    semverLessThan(installedVer!, latestVer!);

  const cli = await stepInstallCli(flags, runner, {
    installedVer,
    latestVer,
    needsUpgrade,
  });

  const skills = await stepInstallSkills(flags, runner);
  const auth = await stepAuth(flags, runner);

  return {
    cli,
    skills,
    auth,
    next: nextSteps({ auth, dryRun: flags.dryRun }),
  };
}

function defaultSearchDirs(): string[] {
  return [__dirname, process.cwd()];
}

function stripPrerelease(version: string): string {
  return version.replace(/-.*$/, "");
}

async function readGloballyInstalledVersion(
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

async function readLatestVersion(
  runner: InstallRunner
): Promise<string | null> {
  try {
    const { stdout } = await runner.exec("npm", ["view", CLI_PACKAGE, "version"], {
      timeoutMs: 15_000,
    });
    const ver = stdout.trim();
    return /^\d+\.\d+\.\d+/.test(ver) ? ver : null;
  } catch {
    return null;
  }
}

async function npmRootGlobal(runner: InstallRunner): Promise<string | null> {
  try {
    const { stdout } = await runner.exec("npm", ["root", "-g"], {
      timeoutMs: 15_000,
    });
    const root = stdout.trim();
    return root.length > 0 ? root : null;
  } catch {
    return null;
  }
}

async function npmPrefixGlobal(runner: InstallRunner): Promise<string | null> {
  try {
    const { stdout } = await runner.exec("npm", ["prefix", "-g"], {
      timeoutMs: 15_000,
    });
    const prefix = stdout.trim();
    return prefix.length > 0 ? prefix : null;
  } catch {
    return null;
  }
}

async function stepInstallCli(
  flags: InstallFlags,
  runner: InstallRunner,
  versions: {
    readonly installedVer: string | null;
    readonly latestVer: string | null;
    readonly needsUpgrade: boolean;
  }
): Promise<InstallCliStep> {
  const { installedVer, latestVer, needsUpgrade } = versions;
  if (installedVer && !needsUpgrade) {
    runner.log(`Already installed (${installedVer}). Skipped`);
    return {
      action: flags.dryRun ? "planned" : "skipped",
      version: installedVer,
      latestVersion: latestVer ?? undefined,
    };
  }

  if (flags.dryRun) {
    runner.log(
      needsUpgrade
        ? `Would upgrade ${CLI_PACKAGE} (${installedVer} → ${latestVer ?? "latest"})`
        : `Would install ${CLI_PACKAGE} globally`
    );
    return {
      action: "planned",
      previousVersion: installedVer ?? undefined,
      latestVersion: latestVer ?? undefined,
    };
  }

  runner.log(
    needsUpgrade
      ? `Upgrading ${CLI_PACKAGE} (${installedVer} → ${latestVer})...`
      : `Installing ${CLI_PACKAGE} globally...`
  );
  try {
    await runner.exec("npm", ["install", "-g", CLI_PACKAGE], {
      timeoutMs: NPM_TIMEOUT_MS,
    });
  } catch (err) {
    throw new InstallError({
      type: "install",
      subtype: "npm_global_failed",
      message: `Failed to install ${CLI_PACKAGE} globally.`,
      hint: `npm install -g ${CLI_PACKAGE}`,
      details: err instanceof Error ? err.message : String(err),
    });
  }
  const after = (await readGloballyInstalledVersion(runner)) ?? latestVer ?? CLI_VERSION;
  runner.log(needsUpgrade ? `Upgraded to ${after}` : "Installed globally");
  return {
    action: needsUpgrade ? "upgraded" : "installed",
    version: after,
    previousVersion: installedVer ?? undefined,
    latestVersion: latestVer ?? undefined,
  };
}

async function resolveSkillsSources(
  runner: InstallRunner
): Promise<string[]> {
  const override = runner.env.ALPHAFOX_SKILLS_SOURCE?.trim();
  if (override) return [override];

  const sources: string[] = [];
  const npmRoot = await npmRootGlobal(runner);
  if (npmRoot) {
    const globalRoot = globalPackageRoot(npmRoot);
    if (packageHasSkills(globalRoot)) sources.push(globalRoot);
  }

  const localRoot = findAlphafoxPackageRoot(runner.packageSearchDirs());
  if (localRoot && !sources.includes(localRoot) && packageHasSkills(localRoot)) {
    sources.push(localRoot);
  }

  sources.push(SKILLS_GITHUB_SOURCE);
  return sources;
}

async function skillsAlreadyInstalled(runner: InstallRunner): Promise<boolean> {
  try {
    const { stdout, stderr } = await runner.exec(
      "npx",
      ["-y", "skills", "ls", "-g"],
      { timeoutMs: SKILLS_TIMEOUT_MS }
    );
    return skillsListHasAlphafox(`${stdout}\n${stderr}`);
  } catch {
    return false;
  }
}

async function stepInstallSkills(
  flags: InstallFlags,
  runner: InstallRunner
): Promise<InstallSkillsStep> {
  const sources = await resolveSkillsSources(runner);
  const already = flags.dryRun ? false : await skillsAlreadyInstalled(runner);
  if (already) {
    runner.log("Skills already installed. Skipped");
    return {
      action: "skipped",
      source: sources[0],
      scope: "global",
      alreadyPresent: true,
    };
  }

  if (flags.dryRun) {
    runner.log(`Would install Skills from ${sources[0] ?? SKILLS_GITHUB_SOURCE}`);
    return {
      action: "planned",
      source: sources[0] ?? SKILLS_GITHUB_SOURCE,
      scope: "global",
    };
  }

  runner.log("Installing AI Skills...");
  let lastError: unknown;
  for (const source of sources) {
    try {
      await runner.exec(
        "npx",
        ["-y", "skills", "add", source, "-y", "-g"],
        { timeoutMs: SKILLS_TIMEOUT_MS }
      );
      runner.log(`Skills installed (${source})`);
      return { action: "installed", source, scope: "global" };
    } catch (err) {
      lastError = err;
    }
  }

  throw new InstallError({
    type: "install",
    subtype: "skills_add_failed",
    message: "Failed to install Agent Skills.",
    hint: `npx skills add ${SKILLS_GITHUB_SOURCE} -y -g`,
    details: lastError instanceof Error ? lastError.message : String(lastError),
  });
}

async function resolveAlphafoxBin(
  runner: InstallRunner
): Promise<string | null> {
  const prefix = await npmPrefixGlobal(runner);
  if (prefix) {
    const bin = globalBinPath(prefix);
    if (existsSync(bin)) return bin;
  }
  try {
    const { stdout } = await runner.exec(
      process.platform === "win32" ? "where" : "which",
      ["alphafox"],
      { timeoutMs: 10_000 }
    );
    const first = stdout.split(/\r?\n/)[0]?.trim();
    return first || null;
  } catch {
    return null;
  }
}

async function stepAuth(
  flags: InstallFlags,
  runner: InstallRunner
): Promise<InstallAuthStep> {
  if (flags.noAuth) {
    return { action: "skipped", reason: "no-auth" };
  }
  if (flags.noInput || !runner.isTty()) {
    if (flags.dryRun) {
      return { action: "planned", reason: "non-interactive" };
    }
    runner.log(
      "To finish setup, run:\n  alphafox auth login --browser\n  alphafox auth login --no-wait --format json --no-input"
    );
    return { action: "skipped", reason: "non-interactive" };
  }
  if (flags.dryRun) {
    runner.log("Would prompt for alphafox auth login --browser");
    return { action: "planned", reason: "tty" };
  }

  const yes = await runner.confirm(
    "Log in now so Agents can call the public Application API?"
  );
  if (!yes) {
    runner.log("Skipped login. Run alphafox auth login later.");
    return { action: "skipped", reason: "declined" };
  }

  const bin = await resolveAlphafoxBin(runner);
  if (!bin) {
    throw new InstallError({
      type: "install",
      subtype: "cli_bin_missing",
      message: "alphafox binary not found after install.",
      hint: "Ensure the npm global bin directory is on PATH, then run alphafox auth login --browser.",
    });
  }

  try {
    await runner.execInherit(bin, ["auth", "login", "--browser"], {
      timeoutMs: 10 * 60_000,
    });
    runner.log("Login complete");
    return { action: "completed" };
  } catch (err) {
    runner.log(
      "Login failed. Run alphafox auth login --browser to retry."
    );
    return {
      action: "failed",
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

export function installHelpData(): {
  readonly name: string;
  readonly usage: readonly string[];
  readonly description: string;
  readonly agentGuide: string;
} {
  return {
    name: "install",
    usage: [
      "npx @alphafox/cli@latest install",
      "alphafox install",
      "alphafox install --no-auth",
      "alphafox install --dry-run",
    ],
    description:
      "Install @alphafox/cli globally and copy co-versioned Agent Skills into detected agents (Cursor, Claude Code, Codex, …) via npx skills add.",
    agentGuide: AGENT_INSTALL_GUIDE_BLOB_URL,
  };
}

export function resolveLocalSkillsDir(
  searchDirs: readonly string[]
): string | null {
  const root = findAlphafoxPackageRoot(searchDirs);
  if (!root) return null;
  const skillsDir = join(root, "skills");
  return packageHasSkills(root) ? skillsDir : null;
}
