import {
  existsSync,
  lstatSync,
  mkdirSync,
  readlinkSync,
  realpathSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import {
  hashSkillDirectory,
  type AgentSkillLinkStatus,
  type SkillsStatus,
  type SkillsSyncResult,
} from "./manager";

export interface AgentSkillTarget {
  readonly id: "claude-code" | "cursor" | "codex";
  readonly required: boolean;
  readonly home: string;
  readonly skillsDir: string;
}

export interface AgentLinkChange {
  readonly agent: AgentSkillTarget["id"];
  readonly name: string;
}

export interface AgentLinkInput {
  readonly canonicalRoot: string;
  readonly skillNames: readonly string[];
  readonly homeDir: string;
  readonly env?: NodeJS.ProcessEnv;
}

export function agentHomeDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.ALPHAFOX_AGENT_HOME?.trim() || homedir();
}

export function resolveAgentSkillTargets(
  homeDir: string,
  env: NodeJS.ProcessEnv = process.env
): readonly AgentSkillTarget[] {
  const claudeHome = env.CLAUDE_CONFIG_DIR?.trim() || join(homeDir, ".claude");
  const cursorHome = join(homeDir, ".cursor");
  const codexHome = env.CODEX_HOME?.trim() || join(homeDir, ".codex");
  return [
    {
      id: "claude-code",
      required: true,
      home: claudeHome,
      skillsDir: join(claudeHome, "skills"),
    },
    {
      id: "cursor",
      required: false,
      home: cursorHome,
      skillsDir: join(cursorHome, "skills"),
    },
    {
      id: "codex",
      required: false,
      home: codexHome,
      skillsDir: join(codexHome, "skills"),
    },
  ];
}

export function inspectAgentLinks(
  input: AgentLinkInput
): readonly AgentSkillLinkStatus[] {
  return activeTargets(input).map((target) => classifyTarget(target, input));
}

export function ensureAgentLinks(
  input: AgentLinkInput
): readonly AgentLinkChange[] {
  const created: AgentLinkChange[] = [];
  for (const status of inspectAgentLinks(input)) {
    if (status.missing.length === 0) continue;
    mkdirSync(status.skillsDir, { recursive: true });
    for (const name of status.missing) {
      linkSkillDir(join(input.canonicalRoot, name), join(status.skillsDir, name));
      created.push({ agent: status.id, name });
    }
  }
  return created;
}

export function removeAgentLinks(input: AgentLinkInput): void {
  for (const target of activeTargets(input)) {
    for (const name of input.skillNames) {
      const dest = join(target.skillsDir, name);
      if (!lexists(dest)) continue;
      if (!isOurAgentLink(dest, join(input.canonicalRoot, name))) continue;
      unlinkSync(dest);
    }
  }
}

export function attachAgentLinks(
  status: SkillsStatus,
  env: NodeJS.ProcessEnv = process.env
): SkillsStatus {
  const skillNames = status.skills
    .filter((skill) => skill.status !== "missing")
    .map((skill) => skill.name);
  const agentLinks = inspectAgentLinks({
    canonicalRoot: status.installedRoot,
    skillNames,
    homeDir: agentHomeDir(env),
    env,
  });
  return {
    ...status,
    agentLinks,
    restartRequired:
      status.restartRequired || agentLinksNeedWork(agentLinks),
  };
}

export function applyAgentLinkPass(
  result: SkillsSyncResult,
  input: {
    readonly dryRun: boolean;
    readonly env: NodeJS.ProcessEnv;
    readonly canonicalRoot: string;
  }
): SkillsSyncResult {
  const skillNames = result.status.skills
    .filter((skill) => skill.status !== "missing")
    .map((skill) => skill.name);
  const linkInput: AgentLinkInput = {
    canonicalRoot: input.canonicalRoot,
    skillNames,
    homeDir: agentHomeDir(input.env),
    env: input.env,
  };
  const created = input.dryRun ? [] : ensureAgentLinks(linkInput);
  const status = attachAgentLinks(result.status, input.env);
  if (!input.dryRun && agentLinksNeedWork(status.agentLinks)) {
    throw Object.assign(
      new Error(
        `Failed to link Skills into Agent directories: ${missingAgentSummary(status.agentLinks)}`
      ),
      {
        type: "install",
        subtype: "skills_agent_link_failed",
        details: status.agentLinks.filter((item) => item.missing.length > 0),
      }
    );
  }
  const linked = created.length > 0 || agentLinksNeedWork(status.agentLinks);
  return {
    ...result,
    status,
    action: nextSyncAction(result.action, linked, input.dryRun),
    restartRequired: result.restartRequired || linked,
  };
}

export function agentLinksNeedWork(
  agentLinks: readonly AgentSkillLinkStatus[]
): boolean {
  return agentLinks.some((item) => item.missing.length > 0);
}

function activeTargets(input: AgentLinkInput): readonly AgentSkillTarget[] {
  return resolveAgentSkillTargets(input.homeDir, input.env ?? {}).filter(
    (target) => target.required || existsSync(target.home)
  );
}

function classifyTarget(
  target: AgentSkillTarget,
  input: AgentLinkInput
): AgentSkillLinkStatus {
  const linked: string[] = [];
  const missing: string[] = [];
  const blocked: string[] = [];
  for (const name of input.skillNames) {
    const state = classifyLink(
      join(input.canonicalRoot, name),
      join(target.skillsDir, name)
    );
    if (state === "linked") linked.push(name);
    else if (state === "blocked") blocked.push(name);
    else missing.push(name);
  }
  return {
    id: target.id,
    skillsDir: target.skillsDir,
    linked,
    missing,
    blocked,
  };
}

function classifyLink(
  canonical: string,
  dest: string
): "linked" | "missing" | "blocked" {
  if (!existsSync(join(canonical, "SKILL.md"))) return "missing";
  if (resolve(canonical) === resolve(dest)) return "linked";
  if (!lexists(dest) || isBrokenSymlink(dest)) return "missing";
  if (isOurAgentLink(dest, canonical)) return "linked";
  return "blocked";
}

function isOurAgentLink(dest: string, canonical: string): boolean {
  if (pointsAtCanonical(dest, canonical)) return true;
  try {
    const stat = lstatSync(dest);
    if (stat.isSymbolicLink() || !stat.isDirectory()) return false;
    if (!existsSync(join(dest, "SKILL.md"))) return false;
    return hashSkillDirectory(dest) === hashSkillDirectory(canonical);
  } catch {
    return false;
  }
}

function pointsAtCanonical(dest: string, canonical: string): boolean {
  try {
    if (lstatSync(dest).isSymbolicLink()) {
      const resolved = resolve(dirname(dest), readlinkSync(dest));
      if (resolve(resolved) === resolve(canonical)) return true;
    }
  } catch {
    // Compare real paths below when the symlink metadata is unreadable.
  }
  try {
    return realpathSync(dest) === realpathSync(canonical);
  } catch {
    return false;
  }
}

function linkSkillDir(canonical: string, dest: string): void {
  if (isBrokenSymlink(dest)) unlinkSync(dest);
  symlinkSync(
    canonical,
    dest,
    process.platform === "win32" ? "junction" : undefined
  );
}

function lexists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

function isBrokenSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink() && !existsSync(path);
  } catch {
    return false;
  }
}

function nextSyncAction(
  action: SkillsSyncResult["action"],
  linked: boolean,
  dryRun: boolean
): SkillsSyncResult["action"] {
  if (!linked || action !== "skipped") return action;
  return dryRun ? "planned" : "synced";
}

function missingAgentSummary(
  agentLinks: readonly AgentSkillLinkStatus[]
): string {
  return agentLinks
    .filter((item) => item.missing.length > 0)
    .map((item) => `${item.id} (${item.missing.join(", ")})`)
    .join("; ");
}
