#!/usr/bin/env node
"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline/promises");

const CLI_PACKAGE = "@alphafox/cli";
const PROFILES = Object.freeze(["production", "staging", "local"]);
const NPM_TIMEOUT_MS = 120_000;
const KEYCHAIN_TIMEOUT_MS = 10_000;
const USAGE_EXIT = 64;
const UNINSTALL_RAW_URL =
  "https://raw.githubusercontent.com/alphafoxai/alphafox-cli/main/scripts/uninstall.cjs";
const UNINSTALL_CURL = `curl -fsSL ${UNINSTALL_RAW_URL} | node -- --yes`;
const UNINSTALL_DRY_RUN = `curl -fsSL ${UNINSTALL_RAW_URL} | node -- --dry-run`;

function parseUninstallArgs(argv) {
  let dryRun = false;
  let yes = false;
  let help = false;
  const unknown = [];
  for (const arg of argv.slice(1)) {
    if (isLauncherArg(arg)) continue;
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--yes" || arg === "-y") yes = true;
    else if (arg === "--help" || arg === "-h") help = true;
    else unknown.push(arg);
  }
  return { dryRun, yes, help, unknown };
}

function isLauncherArg(arg) {
  return (
    arg === "-" ||
    arg === "--" ||
    arg.endsWith("uninstall.cjs") ||
    arg.endsWith("uninstall.mjs")
  );
}

function uninstallHelpText() {
  return [
    "卸载 AlphaFox CLI、Agent Skills、本机配置、登录凭据和回测缓存。",
    "",
    "用法：",
    `  ${UNINSTALL_CURL}`,
    `  ${UNINSTALL_DRY_RUN}`,
    "  node scripts/uninstall.cjs [--dry-run|--yes]",
    "",
    "不会删除服务器上的策略实例或账户数据。完成后请重启 AI 工具。",
  ].join("\n");
}

function homeDir(env) {
  return env.ALPHAFOX_AGENT_HOME?.trim() || os.homedir();
}

function isAlphafoxSkillName(name) {
  return name === "alphafox" || name.startsWith("alphafox-");
}

function readSkillName(skillMd) {
  try {
    const match = fs.readFileSync(skillMd, "utf8").match(
      /^name:\s*["']?([^"'\s]+)["']?\s*$/m
    );
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function lexists(target) {
  try {
    fs.lstatSync(target);
    return true;
  } catch {
    return false;
  }
}

function isAlphafoxSkillDir(target) {
  if (isAlphafoxSkillName(path.basename(target))) return true;
  const name = readSkillName(path.join(target, "SKILL.md"));
  return name != null && isAlphafoxSkillName(name);
}

function skillRoots(env) {
  const home = homeDir(env);
  const claudeHome = env.CLAUDE_CONFIG_DIR?.trim() || path.join(home, ".claude");
  const codexHome = env.CODEX_HOME?.trim() || path.join(home, ".codex");
  return [
    env.ALPHAFOX_SKILLS_DIR?.trim() || path.join(home, ".agents", "skills"),
    path.join(claudeHome, "skills"),
    path.join(home, ".cursor", "skills"),
    path.join(codexHome, "skills"),
    path.join(home, ".grok", "skills"),
  ];
}

function configDir(env) {
  return env.ALPHAFOX_CONFIG_DIR?.trim() || path.join(homeDir(env), ".config", "alphafox");
}

function tapeCacheDir(env) {
  return (
    env.ALPHAFOX_TAPE_CACHE_DIR?.trim() ||
    path.join(homeDir(env), ".alphafox", "cache", "engine-backtest")
  );
}

function runtimeCacheDir(env) {
  if (env.ALPHAFOX_BACKTEST_RUNTIME_CACHE_DIR?.trim()) {
    return env.ALPHAFOX_BACKTEST_RUNTIME_CACHE_DIR.trim();
  }
  const xdg = env.XDG_CACHE_HOME?.trim();
  return path.join(xdg || path.join(homeDir(env), ".cache"), "alphafox", "engine-backtest");
}

function managedPath(target, env) {
  const resolved = path.resolve(target);
  const home = path.resolve(homeDir(env));
  const roots = [
    home,
    env.ALPHAFOX_SKILLS_DIR,
    env.ALPHAFOX_CONFIG_DIR,
    env.ALPHAFOX_TAPE_CACHE_DIR,
    env.ALPHAFOX_BACKTEST_RUNTIME_CACHE_DIR,
    env.XDG_CACHE_HOME,
    env.CLAUDE_CONFIG_DIR,
    env.CODEX_HOME,
  ]
    .filter(Boolean)
    .map((root) => path.resolve(root));
  if (resolved === home || resolved === path.parse(resolved).root) return false;
  return roots.some(
    (root) => resolved === root || resolved.startsWith(root + path.sep)
  );
}

function assertRemovable(target, env) {
  const resolved = path.resolve(target);
  if (!managedPath(resolved, env)) {
    throw Object.assign(new Error(`Refusing to remove unmanaged path ${resolved}`), {
      type: "usage",
      subtype: "uninstall_path_unsafe",
    });
  }
  return resolved;
}

function collectSkillPaths(env) {
  const found = [];
  for (const root of skillRoots(env)) {
    if (!lexists(root)) continue;
    let entries;
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const target = path.join(root, entry.name);
      if (isAlphafoxSkillDir(target)) found.push(target);
    }
  }
  return found;
}

function collectDirPaths(env) {
  const tape = path.resolve(tapeCacheDir(env));
  const runtime = path.resolve(runtimeCacheDir(env));
  const runtimeRoot =
    path.basename(runtime) === "engine-backtest"
      ? path.dirname(runtime)
      : runtime;
  return [configDir(env), tape, runtimeRoot];
}

function buildUninstallPlan(env = process.env) {
  const paths = [...collectSkillPaths(env), ...collectDirPaths(env)]
    .map((target) => path.resolve(target))
    .filter((target, index, all) => all.indexOf(target) === index)
    .filter((target) => lexists(target))
    .map((target) => ({ kind: "path", path: assertRemovable(target, env) }));
  return [
    ...paths,
    ...PROFILES.map((profile) => ({ kind: "keychain", profile })),
    { kind: "npm", package: CLI_PACKAGE },
  ];
}

function rmdirIfEmpty(dir) {
  try {
    fs.rmdirSync(dir);
  } catch (err) {
    if (err && (err.code === "ENOENT" || err.code === "ENOTEMPTY")) return;
    throw err;
  }
}

function pruneEmptyParents(target, env) {
  const home = path.resolve(homeDir(env));
  let current = path.dirname(path.resolve(target));
  while (current !== home && current !== path.parse(current).root) {
    const base = path.basename(current);
    const parentName = path.basename(path.dirname(current));
    const alphafoxCache = base === "cache" && parentName === ".alphafox";
    if (base !== "alphafox" && base !== ".alphafox" && !alphafoxCache) break;
    rmdirIfEmpty(current);
    current = path.dirname(current);
  }
}

function defaultRunCommand(command, args, options = {}) {
  const timeout = options.timeoutMs ?? NPM_TIMEOUT_MS;
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const file = platform === "win32" ? "cmd.exe" : command;
  const argv = platform === "win32" ? ["/c", command, ...args] : args;
  const result = spawnSync(file, argv, {
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error,
  };
}

function keychainPlatform(env) {
  const raw = env.ALPHAFOX_KEYCHAIN_PLATFORM?.trim();
  if (raw === "darwin" || raw === "linux" || raw === "win32") return raw;
  return process.platform;
}

function keychainDeleteArgs(profile, env) {
  const platform = keychainPlatform(env);
  const service = `alphafox-cli.${profile}`;
  if (platform === "darwin") {
    return {
      command: "security",
      args: ["delete-generic-password", "-s", service, "-a", "oauth-tokens"],
    };
  }
  if (platform === "linux") {
    return {
      command: env.ALPHAFOX_SECRET_TOOL?.trim() || "secret-tool",
      args: ["clear", "service", service, "account", "oauth-tokens"],
    };
  }
  return {
    command: "cmdkey",
    args: [`/delete:alphafox-cli/${profile}/oauth-tokens`],
  };
}

function isMissingSecret(result) {
  if (result.status === 0) return false;
  const text = `${result.stdout}\n${result.stderr}`.toLowerCase();
  return (
    result.status === 44 ||
    text.includes("could not be found") ||
    text.includes("not found") ||
    text.includes("no such") ||
    text.includes("cannot find")
  );
}

function applyPath(item, env) {
  fs.rmSync(item.path, { recursive: true, force: true });
  pruneEmptyParents(item.path, env);
}

function applyKeychain(item, env, runCommand) {
  const spec = keychainDeleteArgs(item.profile, env);
  const result = runCommand(spec.command, spec.args, {
    env,
    timeoutMs: KEYCHAIN_TIMEOUT_MS,
  });
  if (result.error && result.error.code === "ENOENT") return "skipped";
  if (result.status === 0) return "removed";
  if (isMissingSecret(result)) return "skipped";
  throw new Error(
    `删除 ${item.profile} 凭据失败：${result.stderr.trim() || result.error || result.status}`
  );
}

function applyNpm(env, runCommand) {
  const result = runCommand("npm", ["uninstall", "-g", CLI_PACKAGE], {
    env,
    timeoutMs: NPM_TIMEOUT_MS,
  });
  if (result.status === 0 && !result.error) return;
  throw new Error(
    `npm uninstall -g ${CLI_PACKAGE} 失败：${(result.stderr || result.stdout).trim() || result.error || result.status}`
  );
}

async function confirmUninstall(confirm, isTty) {
  if (typeof confirm === "function") return confirm();
  if (!isTty()) return null;
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  });
  try {
    const answer = await rl.question(
      "将卸载全局 @alphafox/cli、本机 Agent Skills、配置、登录凭据和回测缓存。继续？ [Y/n] "
    );
    const token = answer.trim().toLowerCase();
    return token === "" || token === "y" || token === "yes" || token === "是" || token === "好";
  } finally {
    rl.close();
  }
}

function describeItem(item) {
  if (item.kind === "path") return item.path;
  if (item.kind === "keychain") return `keychain:${item.profile}`;
  return `npm uninstall -g ${item.package}`;
}

function applyItem(item, env, runCommand, log) {
  if (item.kind === "path") {
    applyPath(item, env);
    log(`已删除 ${item.path}`);
    return describeItem(item);
  }
  if (item.kind === "keychain") {
    if (applyKeychain(item, env, runCommand) !== "removed") return null;
    log(`已删除 ${item.profile} 登录凭据`);
    return describeItem(item);
  }
  applyNpm(env, runCommand);
  log(`已卸载 ${CLI_PACKAGE}`);
  return describeItem(item);
}

function usageError(error, hint) {
  return { ok: false, exitCode: USAGE_EXIT, error, hint, plan: [], removed: [] };
}

async function approveUninstall(flags, input, isTty, log) {
  if (flags.yes) return { ok: true };
  const approved = await confirmUninstall(input.confirm, isTty);
  if (approved === true) return { ok: true };
  if (approved === false) {
    log("已取消。");
    return { ok: true, cancelled: true, plan: [], removed: [] };
  }
  return usageError("非交互卸载需要 --yes。", UNINSTALL_CURL);
}

async function runUninstall(input = {}) {
  const env = input.env ?? process.env;
  const flags = input.flags ?? parseUninstallArgs(process.argv);
  const log = input.log ?? ((message) => process.stderr.write(`${message}\n`));
  const runCommand = input.runCommand ?? defaultRunCommand;
  const isTty =
    input.isTty ?? (() => Boolean(process.stdin.isTTY && process.stderr.isTTY));

  if (flags.unknown.length > 0) {
    return usageError(
      `未知的 uninstall 参数：${flags.unknown.join(" ")}`,
      "用法：node scripts/uninstall.cjs [--dry-run|--yes]"
    );
  }
  if (flags.help) {
    log(uninstallHelpText());
    return { ok: true, help: true, plan: [], removed: [] };
  }

  const plan = buildUninstallPlan(env);
  if (flags.dryRun) {
    log("这是 --dry-run，不会真正删除：");
    for (const item of plan) log(`  ${describeItem(item)}`);
    return { ok: true, dryRun: true, plan, removed: [] };
  }

  const approval = await approveUninstall(flags, input, isTty, log);
  if (!approval.ok || approval.cancelled) return approval;

  const removed = [];
  const errors = [];
  for (const item of plan) {
    try {
      const label = applyItem(item, env, runCommand, log);
      if (label) removed.push(label);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  if (errors.length > 0) return { ok: false, exitCode: 1, plan, removed, errors };
  log("卸载完成。请重启 AI 工具，以便卸载后的 Skills 生效。");
  return { ok: true, plan, removed };
}

async function main() {
  const result = await runUninstall();
  if (result.error) process.stderr.write(`${result.error}\n`);
  if (result.hint) process.stderr.write(`${result.hint}\n`);
  if (result.errors) {
    for (const line of result.errors) process.stderr.write(`${line}\n`);
  }
  process.exit(result.ok ? 0 : (result.exitCode ?? 1));
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}

module.exports = {
  CLI_PACKAGE,
  PROFILES,
  UNINSTALL_CURL,
  UNINSTALL_DRY_RUN,
  UNINSTALL_RAW_URL,
  USAGE_EXIT,
  buildUninstallPlan,
  isAlphafoxSkillDir,
  isAlphafoxSkillName,
  parseUninstallArgs,
  runUninstall,
  skillRoots,
  uninstallHelpText,
};
