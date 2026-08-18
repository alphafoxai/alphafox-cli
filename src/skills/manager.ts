import { createHash } from "node:crypto";
import {
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, sep } from "node:path";

export interface SkillManifestFile {
  readonly path: string;
  readonly sha256: string;
  readonly size: number;
}

export interface SkillManifestEntry {
  readonly name: string;
  readonly version: string;
  readonly hash: string;
  readonly files: readonly SkillManifestFile[];
}

export interface SkillsBundleManifest {
  readonly schemaVersion: 1;
  readonly packageName: "@alphafox/cli";
  readonly packageVersion: string;
  readonly contractVersion: string;
  readonly bundleHash: string;
  readonly skills: readonly SkillManifestEntry[];
}

export interface InstalledSkillState {
  readonly version: string;
  readonly hash: string;
}

export interface SkillsInstallState {
  readonly schemaVersion: 1;
  readonly packageVersion: string;
  readonly contractVersion: string;
  readonly bundleHash: string;
  readonly syncedAt: string;
  readonly skills: Readonly<Record<string, InstalledSkillState>>;
}

export type SkillStatus = "current" | "missing" | "stale" | "modified";

export interface InspectedSkill {
  readonly name: string;
  readonly expectedVersion: string;
  readonly installedVersion: string | null;
  readonly expectedHash: string;
  readonly installedHash: string | null;
  readonly status: SkillStatus;
  readonly managed: boolean;
}

export interface SkillsStatus {
  readonly bundleVersion: string;
  readonly contractVersion: string;
  readonly bundleHash: string;
  readonly installedRoot: string;
  readonly skills: readonly InspectedSkill[];
  readonly orphans: readonly {
    readonly name: string;
    readonly installedHash: string;
    readonly recordedHash: string;
    readonly modified: boolean;
  }[];
  readonly summary: Readonly<Record<SkillStatus, number>>;
  readonly restartRequired: boolean;
}

export interface SkillsSyncResult {
  readonly action: "synced" | "planned" | "skipped";
  readonly updated: readonly string[];
  readonly removed: readonly string[];
  readonly blocked: readonly string[];
  readonly backupDir?: string;
  readonly status: SkillsStatus;
  readonly restartRequired: boolean;
}

export interface SkillsSyncDeps {
  readonly install: (names: readonly string[]) => Promise<void>;
  readonly remove?: (names: readonly string[]) => Promise<void>;
  readonly now?: () => Date;
}
export function installSkillsFromBundle(
  packageRoot: string,
  installedRoot: string,
  manifest: SkillsBundleManifest,
  names: readonly string[]
): void {
  const sourceByName = new Map<string, string>();
  const skillsRoot = join(packageRoot, "skills");
  for (const entry of readdirSync(skillsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillRoot = join(skillsRoot, entry.name);
    const name = readSkillName(join(skillRoot, "SKILL.md"));
    if (name && manifest.skills.some((skill) => skill.name === name)) {
      sourceByName.set(name, entry.name);
    }
  }
  mkdirSync(installedRoot, { recursive: true });
  for (const name of names) {
    const sourceName = sourceByName.get(name);
    if (!sourceName) {
      throw Object.assign(new Error(`Skill source is missing: ${name}`), {
        type: "install",
        subtype: "skills_source_missing",
      });
    }
    const target = join(installedRoot, name);
    rmSync(target, { recursive: true, force: true });
    cpSync(join(skillsRoot, sourceName), target, { recursive: true });
  }
}

export function removeInstalledSkills(
  installedRoot: string,
  names: readonly string[]
): void {
  for (const name of names) {
    rmSync(join(installedRoot, name), { recursive: true, force: true });
  }
}


export function buildSkillsManifest(
  packageRoot: string,
  versions: {
    readonly packageVersion: string;
    readonly contractVersion: string;
  }
): SkillsBundleManifest {
  const skillsRoot = join(packageRoot, "skills");
  if (!existsSync(skillsRoot)) {
    throw new Error(`Skills directory is missing: ${skillsRoot}`);
  }
  const skills = readdirSync(skillsRoot, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        existsSync(join(skillsRoot, entry.name, "SKILL.md"))
    )
    .map((entry): SkillManifestEntry => {
      const root = join(skillsRoot, entry.name);
      const skillPath = join(root, "SKILL.md");
      const files = manifestFiles(root);
      const name = readSkillName(skillPath);
      if (!name) {
        throw Object.assign(
          new Error(`Skill name is missing from ${skillPath}`),
          {
            type: "install",
            subtype: "skills_bundle_name_missing",
          }
        );
      }
      const version = readSkillVersion(skillPath) ?? versions.packageVersion;
      if (version !== versions.packageVersion) {
        throw Object.assign(
          new Error(
            `Skill ${entry.name} version ${version} does not match package ${versions.packageVersion}`
          ),
          {
            type: "install",
            subtype: "skills_bundle_version_mismatch",
          }
        );
      }
      return {
        name,
        version,
        files,
        hash: hashManifestFiles(files),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  if (skills.length === 0) {
    throw new Error(`No Skills found under ${skillsRoot}`);
  }
  if (new Set(skills.map((skill) => skill.name)).size !== skills.length) {
    throw Object.assign(new Error("Skills bundle contains duplicate names"), {
      type: "install",
      subtype: "skills_bundle_duplicate_name",
    });
  }
  return {
    schemaVersion: 1,
    packageName: "@alphafox/cli",
    packageVersion: versions.packageVersion,
    contractVersion: versions.contractVersion,
    bundleHash: sha256(
      skills.map((skill) => `${skill.name}\0${skill.hash}`).join("\n")
    ),
    skills,
  };
}

export function writeSkillsManifest(
  packageRoot: string,
  outputPath: string,
  versions: {
    readonly packageVersion: string;
    readonly contractVersion: string;
  }
): SkillsBundleManifest {
  const manifest = buildSkillsManifest(packageRoot, versions);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

export function loadAndVerifySkillsManifest(
  packageRoot: string,
  manifestPath = join(packageRoot, "dist", "skills-manifest.json")
): SkillsBundleManifest {
  try {
    const recorded = JSON.parse(
      readFileSync(manifestPath, "utf8")
    ) as SkillsBundleManifest;
    if (
      recorded.schemaVersion !== 1 ||
      recorded.packageName !== "@alphafox/cli" ||
      typeof recorded.packageVersion !== "string" ||
      typeof recorded.contractVersion !== "string" ||
      typeof recorded.bundleHash !== "string" ||
      !Array.isArray(recorded.skills)
    ) {
      throw new Error("manifest shape is invalid");
    }
    const packageJson = JSON.parse(
      readFileSync(join(packageRoot, "package.json"), "utf8")
    ) as { name?: unknown; version?: unknown };
    if (
      packageJson.name !== recorded.packageName ||
      packageJson.version !== recorded.packageVersion
    ) {
      throw new Error(
        `manifest ${recorded.packageName}@${recorded.packageVersion} does not match package ${String(packageJson.name)}@${String(packageJson.version)}`
      );
    }
    const actual = buildSkillsManifest(packageRoot, {
      packageVersion: recorded.packageVersion,
      contractVersion: recorded.contractVersion,
    });
    if (actual.bundleHash !== recorded.bundleHash) {
      throw new Error(
        `bundle hash ${actual.bundleHash} does not match ${recorded.bundleHash}`
      );
    }
    if (JSON.stringify(actual.skills) !== JSON.stringify(recorded.skills)) {
      throw new Error("manifest Skill entries do not match bundled files");
    }
    return actual;
  } catch (err) {
    throw Object.assign(
      new Error(`AlphaFox Skills bundle integrity check failed: ${manifestPath}`),
      {
        type: "install",
        subtype: "skills_bundle_integrity",
        details: err instanceof Error ? err.message : String(err),
      }
    );
  }
}

export function inspectSkills(input: {
  readonly manifest: SkillsBundleManifest;
  readonly installedRoot: string;
  readonly state: SkillsInstallState | null;
}): SkillsStatus {
  const skills = input.manifest.skills.map((expected): InspectedSkill => {
    const installedDir = join(input.installedRoot, expected.name);
    if (!existsSync(join(installedDir, "SKILL.md"))) {
      return {
        name: expected.name,
        expectedVersion: expected.version,
        installedVersion: null,
        expectedHash: expected.hash,
        installedHash: null,
        status: "missing",
        managed: false,
      };
    }
    const installedHash = hashSkillDirectory(installedDir);
    const installedVersion = readSkillVersion(
      join(installedDir, "SKILL.md")
    );
    if (installedHash === expected.hash) {
      return {
        name: expected.name,
        expectedVersion: expected.version,
        installedVersion,
        expectedHash: expected.hash,
        installedHash,
        status: "current",
        managed: true,
      };
    }
    const previous = input.state?.skills[expected.name];
    const stateConfirmsUnmodified = previous?.hash === installedHash;
    const legacyVersionIsOlder =
      installedVersion != null &&
      compareSemver(installedVersion, expected.version) < 0;
    return {
      name: expected.name,
      expectedVersion: expected.version,
      installedVersion,
      expectedHash: expected.hash,
      installedHash,
      status:
        stateConfirmsUnmodified || (!input.state && legacyVersionIsOlder)
          ? "stale"
          : "modified",
      managed: Boolean(previous) || legacyVersionIsOlder,
    };
  });
  const summary: Record<SkillStatus, number> = {
    current: 0,
    missing: 0,
    stale: 0,
    modified: 0,
  };
  for (const skill of skills) summary[skill.status] += 1;
  const expectedNames = new Set(
    input.manifest.skills.map((skill) => skill.name)
  );
  const orphans = Object.entries(input.state?.skills ?? {})
    .filter(([name]) => !expectedNames.has(name))
    .flatMap(([name, recorded]) => {
      const installedDir = join(input.installedRoot, name);
      if (!existsSync(join(installedDir, "SKILL.md"))) return [];
      const installedHash = hashSkillDirectory(installedDir);
      return [
        {
          name,
          installedHash,
          recordedHash: recorded.hash,
          modified: installedHash !== recorded.hash,
        },
      ];
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    bundleVersion: input.manifest.packageVersion,
    contractVersion: input.manifest.contractVersion,
    bundleHash: input.manifest.bundleHash,
    installedRoot: input.installedRoot,
    skills,
    orphans,
    summary,
    restartRequired:
      summary.missing + summary.stale + summary.modified + orphans.length > 0,
  };
}

export async function syncSkills(
  input: {
    readonly manifest: SkillsBundleManifest;
    readonly packageRoot: string;
    readonly installedRoot: string;
    readonly statePath: string;
    readonly dryRun: boolean;
    readonly force: boolean;
  },
  deps: SkillsSyncDeps
): Promise<SkillsSyncResult> {
  const state = loadSkillsState(input.statePath);
  const before = inspectSkills({
    manifest: input.manifest,
    installedRoot: input.installedRoot,
    state,
  });
  const selected = before.skills
    .filter(
      (skill) =>
        skill.status === "missing" ||
        skill.status === "stale" ||
        (input.force && skill.status === "modified")
    )
    .map((skill) => skill.name);
  const blocked = before.skills
    .filter((skill) => skill.status === "modified" && !input.force)
    .map((skill) => skill.name);
  const removed = before.orphans
    .filter((skill) => !skill.modified || input.force)
    .map((skill) => skill.name);
  blocked.push(
    ...before.orphans
      .filter((skill) => skill.modified && !input.force)
      .map((skill) => skill.name)
  );

  if (input.dryRun) {
    return {
      action:
        selected.length + removed.length > 0 ? "planned" : "skipped",
      updated: selected,
      removed,
      blocked,
      status: before,
      restartRequired: selected.length + removed.length > 0,
    };
  }

  const release = acquireSkillsLock(input.statePath);
  let backupDir: string | undefined;
  try {
    if (selected.length + removed.length > 0) {
      backupDir = backupSkills(
        [...new Set([...selected, ...removed])],
        input.installedRoot,
        input.statePath,
        deps.now?.() ?? new Date()
      );
    }
    if (selected.length > 0) {
      await deps.install(selected);
    }
    if (removed.length > 0) {
      if (!deps.remove) {
        throw Object.assign(
          new Error("Skills remover is required for retired managed Skills"),
          {
            type: "install",
            subtype: "skills_remove_unavailable",
          }
        );
      }
      await deps.remove(removed);
    }
    const after = inspectSkills({
      manifest: input.manifest,
      installedRoot: input.installedRoot,
      state,
    });
    const failed = selected.filter(
      (name) =>
        after.skills.find((skill) => skill.name === name)?.status !== "current"
    );
    if (failed.length > 0) {
      throw Object.assign(
        new Error(
          `Skills sync verification failed for: ${failed.join(", ")}`
        ),
        {
          type: "install",
          subtype: "skills_verify_failed",
          details: { failed, backupDir },
        }
      );
    }
    const removalFailed = removed.filter((name) =>
      existsSync(join(input.installedRoot, name, "SKILL.md"))
    );
    if (removalFailed.length > 0) {
      throw Object.assign(
        new Error(
          `Retired Skills removal verification failed for: ${removalFailed.join(", ")}`
        ),
        {
          type: "install",
          subtype: "skills_remove_verify_failed",
          details: { failed: removalFailed, backupDir },
        }
      );
    }
    saveSkillsState(
      input.statePath,
      stateFromStatus(
        input.manifest,
        after,
        deps.now?.() ?? new Date(),
        state
      )
    );
    return {
      action:
        selected.length + removed.length > 0 ? "synced" : "skipped",
      updated: selected,
      removed,
      blocked,
      ...(backupDir ? { backupDir } : {}),
      status: after,
      restartRequired: selected.length + removed.length > 0,
    };
  } finally {
    release();
  }
}

export function loadSkillsState(path: string): SkillsInstallState | null {
  if (!existsSync(path)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw Object.assign(new Error(`Invalid Skills state file: ${path}`), {
      type: "install",
      subtype: "skills_state_invalid",
      details: err instanceof Error ? err.message : String(err),
    });
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    (parsed as { schemaVersion?: unknown }).schemaVersion !== 1 ||
    typeof (parsed as { skills?: unknown }).skills !== "object"
  ) {
    throw Object.assign(new Error(`Invalid Skills state file: ${path}`), {
      type: "install",
      subtype: "skills_state_invalid",
    });
  }
  return parsed as SkillsInstallState;
}

export function hashSkillDirectory(skillRoot: string): string {
  return hashManifestFiles(manifestFiles(skillRoot));
}

export function readSkillVersion(skillPath: string): string | null {
  try {
    const match = readFileSync(skillPath, "utf8").match(
      /^version:\s*["']?([^"'\s]+)["']?\s*$/m
    );
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

export function readSkillName(skillPath: string): string | null {
  try {
    const match = readFileSync(skillPath, "utf8").match(
      /^name:\s*["']?([^"'\s]+)["']?\s*$/m
    );
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function manifestFiles(root: string): SkillManifestFile[] {
  return listFiles(root)
    .map((path): SkillManifestFile => {
      const body = readFileSync(path);
      return {
        path: relative(root, path).split(sep).join("/"),
        sha256: sha256(body),
        size: body.length,
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}

function listFiles(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFiles(path));
    } else if (entry.isFile() || statSync(path).isFile()) {
      out.push(path);
    }
  }
  return out;
}

function hashManifestFiles(files: readonly SkillManifestFile[]): string {
  return sha256(
    files
      .map((file) => `${file.path}\0${file.size}\0${file.sha256}`)
      .join("\n")
  );
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function compareSemver(a: string, b: string): number {
  const pa = a.replace(/-.*$/, "").split(".").map(Number);
  const pb = b.replace(/-.*$/, "").split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    const delta = (pa[i] || 0) - (pb[i] || 0);
    if (delta !== 0) return delta < 0 ? -1 : 1;
  }
  return 0;
}

function saveSkillsState(path: string, state: SkillsInstallState): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, path);
}

function stateFromStatus(
  manifest: SkillsBundleManifest,
  status: SkillsStatus,
  now: Date,
  previous: SkillsInstallState | null
): SkillsInstallState {
  const skills: Record<string, InstalledSkillState> = {};
  for (const item of status.skills) {
    if (item.status === "current" && item.installedHash) {
      skills[item.name] = {
        version: item.expectedVersion,
        hash: item.installedHash,
      };
    }
  }
  for (const orphan of status.orphans) {
    const recorded = previous?.skills[orphan.name];
    if (orphan.modified && recorded) {
      skills[orphan.name] = recorded;
    }
  }
  return {
    schemaVersion: 1,
    packageVersion: manifest.packageVersion,
    contractVersion: manifest.contractVersion,
    bundleHash: manifest.bundleHash,
    syncedAt: now.toISOString(),
    skills,
  };
}

function backupSkills(
  names: readonly string[],
  installedRoot: string,
  statePath: string,
  now: Date
): string | undefined {
  const existing = names.filter((name) =>
    existsSync(join(installedRoot, name, "SKILL.md"))
  );
  if (existing.length === 0) return undefined;
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const root = join(dirname(statePath), "skill-backups", stamp);
  mkdirSync(root, { recursive: true });
  for (const name of existing) {
    cpSync(join(installedRoot, name), join(root, name), {
      recursive: true,
      dereference: true,
    });
  }
  return root;
}

function acquireSkillsLock(statePath: string): () => void {
  mkdirSync(dirname(statePath), { recursive: true });
  const path = `${statePath}.lock`;
  let fd: number;
  try {
    fd = openSync(path, "wx", 0o600);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EEXIST") {
      const ageMs = Date.now() - statSync(path).mtimeMs;
      if (ageMs > 5 * 60_000) {
        unlinkSync(path);
        fd = openSync(path, "wx", 0o600);
      } else {
        throw Object.assign(
          new Error("Another AlphaFox Skills sync is already running"),
          {
            type: "install",
            subtype: "skills_sync_in_progress",
          }
        );
      }
    } else {
      throw err;
    }
  }
  writeFileSync(fd, `${process.pid}\n`);
  closeSync(fd);
  return () => {
    try {
      unlinkSync(path);
    } catch {
      // Best effort: a stale lock is recovered after five minutes.
    }
  };
}
