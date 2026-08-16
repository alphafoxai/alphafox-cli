import { existsSync } from "node:fs";
import { join } from "node:path";

import { CLI_PACKAGE, CLI_VERSION } from "../version";
import {
  loadAndVerifySkillsManifest,
  syncSkills,
} from "../skills/manager";
import {
  installedSkillsRoot,
  skillsStatePath,
} from "../skills/run-command";
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
  return /(^|\s)alphafox(?:-[\w-]+)?(?=\s|$)/m.test(output);
}

export function nextSteps(input: {
  readonly auth: InstallAuthStep;
  readonly dryRun: boolean;
}): string[] {
  const steps = ["请重启 AI 工具，以便加载刚安装的 Skills。"];
  if (input.auth.action === "skipped" || input.auth.action === "planned") {
    steps.push(
      "alphafox auth login --browser --format json --no-input",
      "alphafox auth login --no-wait --format json --no-input"
    );
  }
  steps.push(
    "alphafox doctor --format json --no-input",
    `Agent 安装指南：${AGENT_INSTALL_GUIDE_BLOB_URL}`
  );
  if (input.dryRun) {
    steps.unshift("这是 --dry-run，去掉该参数再运行才会真正安装。");
  }
  return steps;
}

export async function runInstallWizard(
  flags: InstallFlags,
  env: NodeJS.ProcessEnv = process.env,
  runner: InstallRunner = createDefaultInstallRunner(env, defaultSearchDirs())
): Promise<InstallResult> {
  runner.log("正在安装 AlphaFox CLI…");

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
    runner.log(`已安装（${installedVer}），已跳过`);
    return {
      action: flags.dryRun ? "planned" : "skipped",
      version: installedVer,
      latestVersion: latestVer ?? undefined,
    };
  }

  if (flags.dryRun) {
    runner.log(
      needsUpgrade
        ? `将升级 ${CLI_PACKAGE}（${installedVer} → ${latestVer ?? "latest"}）`
        : `将全局安装 ${CLI_PACKAGE}`
    );
    return {
      action: "planned",
      previousVersion: installedVer ?? undefined,
      latestVersion: latestVer ?? undefined,
    };
  }

  runner.log(
    needsUpgrade
      ? `正在升级 ${CLI_PACKAGE}（${installedVer} → ${latestVer}）…`
      : `正在全局安装 ${CLI_PACKAGE}…`
  );
  try {
    await runner.exec("npm", ["install", "-g", CLI_PACKAGE], {
      timeoutMs: NPM_TIMEOUT_MS,
    });
  } catch (err) {
    throw new InstallError({
      type: "install",
      subtype: "npm_global_failed",
      message: `全局安装 ${CLI_PACKAGE} 失败。`,
      hint: `npm install -g ${CLI_PACKAGE}`,
      details: err instanceof Error ? err.message : String(err),
    });
  }
  const after = (await readGloballyInstalledVersion(runner)) ?? latestVer ?? CLI_VERSION;
  runner.log(needsUpgrade ? `已升级到 ${after}` : "已全局安装");
  return {
    action: needsUpgrade ? "upgraded" : "installed",
    version: after,
    previousVersion: installedVer ?? undefined,
    latestVersion: latestVer ?? undefined,
  };
}

async function resolveSkillsSource(
  runner: InstallRunner
): Promise<string> {
  const override = runner.env.ALPHAFOX_SKILLS_SOURCE?.trim();
  if (override) {
    if (packageHasSkills(override)) return override;
    throw new InstallError({
      type: "install",
      subtype: "skills_source_invalid",
      message:
        "ALPHAFOX_SKILLS_SOURCE must point to a local @alphafox/cli package with bundled Skills.",
      details: override,
    });
  }

  const npmRoot = await npmRootGlobal(runner);
  if (npmRoot) {
    const globalRoot = globalPackageRoot(npmRoot);
    if (packageHasSkills(globalRoot)) return globalRoot;
  }

  const localRoot = findAlphafoxPackageRoot(runner.packageSearchDirs());
  if (localRoot && packageHasSkills(localRoot)) {
    return localRoot;
  }

  throw new InstallError({
    type: "install",
    subtype: "skills_package_missing",
    message:
      "Could not locate the verified Skills bundle inside @alphafox/cli.",
    hint: `npm install -g ${CLI_PACKAGE}`,
  });
}

async function stepInstallSkills(
  flags: InstallFlags,
  runner: InstallRunner
): Promise<InstallSkillsStep> {
  const source = await resolveSkillsSource(runner);
  const manifest = loadAndVerifySkillsManifest(source);
  runner.log(
    flags.dryRun
      ? `将同步 Skills ${manifest.packageVersion}（${source}）`
      : `正在同步 AI Skills ${manifest.packageVersion}…`
  );
  try {
    const result = await syncSkills(
      {
        manifest,
        packageRoot: source,
        installedRoot: installedSkillsRoot(runner.env),
        statePath: skillsStatePath(runner.env),
        dryRun: flags.dryRun,
        force: false,
      },
      {
        install: async (names) => {
          await runner.exec(
            "npx",
            [
              "-y",
              "skills",
              "add",
              source,
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
    const action: InstallSkillsStep["action"] =
      result.blocked.length > 0
        ? "blocked"
        : result.action === "planned"
          ? "planned"
          : result.action === "skipped"
            ? "skipped"
            : result.backupDir
              ? "updated"
              : "installed";
    runner.log(
      action === "skipped"
        ? "Skills 已是当前版本，已跳过"
        : action === "blocked"
          ? `检测到本地修改，未覆盖：${result.blocked.join(", ")}`
          : flags.dryRun
            ? `将同步 ${result.updated.length} 个 Skills`
            : `Skills 已同步（${source}）`
    );
    return {
      action,
      source,
      scope: "global",
      alreadyPresent: result.status.summary.current > 0,
      version: manifest.packageVersion,
      updated: result.updated,
      removed: result.removed,
      blocked: result.blocked,
      backupDir: result.backupDir,
      restartRequired: result.restartRequired,
    };
  } catch (err) {
    if (err instanceof InstallError) throw err;
    throw new InstallError({
      type: "install",
      subtype:
        err && typeof err === "object" && "subtype" in err
          ? String((err as { subtype: unknown }).subtype)
          : "skills_sync_failed",
      message: "同步 Agent Skills 失败。",
      hint: `alphafox skills sync --format json --no-input`,
      details: err instanceof Error ? err.message : String(err),
    });
  }
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
      "要完成安装，请运行：\n  alphafox auth login --browser\n  alphafox auth login --no-wait --format json --no-input"
    );
    return { action: "skipped", reason: "non-interactive" };
  }
  if (flags.dryRun) {
    runner.log("将提示运行 alphafox auth login --browser");
    return { action: "planned", reason: "tty" };
  }

  const yes = await runner.confirm(
    "现在登录，以便 Agent 可以调用公开 Application API？"
  );
  if (!yes) {
    runner.log("已跳过登录。之后可运行 alphafox auth login。");
    return { action: "skipped", reason: "declined" };
  }

  const bin = await resolveAlphafoxBin(runner);
  if (!bin) {
    throw new InstallError({
      type: "install",
      subtype: "cli_bin_missing",
      message: "安装完成后找不到 alphafox 可执行文件。",
      hint: "请确认 npm 全局 bin 目录在 PATH 中，然后运行 alphafox auth login --browser。",
    });
  }

  try {
    await runner.execInherit(bin, ["auth", "login", "--browser"], {
      timeoutMs: 10 * 60_000,
    });
    runner.log("登录完成");
    return { action: "completed" };
  } catch (err) {
    runner.log("登录失败。请运行 alphafox auth login --browser 重试。");
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
      "全局安装 @alphafox/cli，校验包内 Skills manifest，并把同版本 Agent Skills 同步到本机已检测到的 Agent（Cursor、Claude Code、Codex 等）的用户级目录。",
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
