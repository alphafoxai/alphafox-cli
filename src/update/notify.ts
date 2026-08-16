import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { defaultConfigDir } from "../config/profiles";
import { createDefaultInstallRunner } from "../install/exec";
import { semverLessThan } from "../install/wizard";
import { CLI_PACKAGE, CLI_VERSION } from "../version";

export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const NPM_VIEW_TIMEOUT_MS = 4_000;

export interface UpdateCheckState {
  readonly schemaVersion: 1;
  readonly checkedAt: string;
  readonly currentVersion: string;
  readonly latestVersion: string | null;
  readonly updateAvailable: boolean;
}

export interface UpdateNoticeResult {
  readonly checked: boolean;
  readonly notified: boolean;
  readonly latestVersion: string | null;
}

export interface UpdateNoticeDeps {
  readonly env?: NodeJS.ProcessEnv;
  readonly currentVersion?: string;
  readonly now?: Date;
  readonly fetchLatest?: () => Promise<string>;
  readonly writeNotice?: (line: string) => void;
}

export function updateCheckStatePath(
  env: NodeJS.ProcessEnv = process.env
): string {
  return join(defaultConfigDir(env), "update-check.json");
}

export function formatUpdateNotice(
  currentVersion: string,
  latestVersion: string
): string {
  return `[alphafox] update available: ${currentVersion} -> ${latestVersion}. After the user confirms, run: alphafox update --format json --no-input`;
}

export function shouldSkipUpdateCheck(
  command: string | undefined,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if (env.ALPHAFOX_SKIP_UPDATE_CHECK === "1") return true;
  return command === "update" || command === "install";
}

export async function maybeNotifyCliUpdate(
  deps: UpdateNoticeDeps = {}
): Promise<UpdateNoticeResult> {
  const env = deps.env ?? process.env;
  const currentVersion = deps.currentVersion ?? CLI_VERSION;
  const now = deps.now ?? new Date();
  const writeNotice =
    deps.writeNotice ??
    ((line: string) => {
      process.stderr.write(`${line}\n`);
    });

  const previous = loadUpdateCheckState(updateCheckStatePath(env));
  if (
    previous &&
    now.getTime() - Date.parse(previous.checkedAt) < UPDATE_CHECK_INTERVAL_MS
  ) {
    return {
      checked: false,
      notified: false,
      latestVersion: previous.latestVersion,
    };
  }

  let latestVersion: string | null = null;
  try {
    latestVersion = await (deps.fetchLatest ?? defaultFetchLatest)(env);
  } catch {
    saveUpdateCheckState(updateCheckStatePath(env), {
      schemaVersion: 1,
      checkedAt: now.toISOString(),
      currentVersion,
      latestVersion: previous?.latestVersion ?? null,
      updateAvailable: false,
    });
    return {
      checked: true,
      notified: false,
      latestVersion: previous?.latestVersion ?? null,
    };
  }

  const updateAvailable = semverLessThan(currentVersion, latestVersion);
  saveUpdateCheckState(updateCheckStatePath(env), {
    schemaVersion: 1,
    checkedAt: now.toISOString(),
    currentVersion,
    latestVersion,
    updateAvailable,
  });
  if (updateAvailable) {
    writeNotice(formatUpdateNotice(currentVersion, latestVersion));
  }
  return {
    checked: true,
    notified: updateAvailable,
    latestVersion,
  };
}

function loadUpdateCheckState(path: string): UpdateCheckState | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as UpdateCheckState;
    if (
      parsed.schemaVersion !== 1 ||
      typeof parsed.checkedAt !== "string" ||
      Number.isNaN(Date.parse(parsed.checkedAt))
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function saveUpdateCheckState(path: string, state: UpdateCheckState): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

async function defaultFetchLatest(env: NodeJS.ProcessEnv): Promise<string> {
  const runner = createDefaultInstallRunner(env, []);
  const { stdout } = await runner.exec("npm", ["view", CLI_PACKAGE, "version"], {
    timeoutMs: NPM_VIEW_TIMEOUT_MS,
  });
  const version = stdout.trim();
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`invalid npm version: ${version}`);
  }
  return version;
}
