export const SKILLS_GITHUB_SOURCE = "alphafoxai/alphafox-cli";
export const SKILLS_NAME_PREFIX = "alphafox-";
export const AGENT_INSTALL_GUIDE_URL =
  "https://raw.githubusercontent.com/alphafoxai/alphafox-cli/main/docs/alphafox-cli-installation-guide.md";
export const AGENT_INSTALL_GUIDE_BLOB_URL =
  "https://github.com/alphafoxai/alphafox-cli/blob/main/docs/alphafox-cli-installation-guide.md";

export type InstallCliAction = "installed" | "upgraded" | "skipped" | "planned";
export type InstallSkillsAction =
  | "installed"
  | "skipped"
  | "planned"
  | "failed";
export type InstallAuthAction =
  | "completed"
  | "skipped"
  | "failed"
  | "planned";

export interface InstallCliStep {
  readonly action: InstallCliAction;
  readonly version?: string;
  readonly previousVersion?: string;
  readonly latestVersion?: string;
}

export interface InstallSkillsStep {
  readonly action: InstallSkillsAction;
  readonly source?: string;
  readonly scope: "global";
  readonly alreadyPresent?: boolean;
}

export interface InstallAuthStep {
  readonly action: InstallAuthAction;
  readonly reason?: string;
}

export interface InstallResult {
  readonly cli: InstallCliStep;
  readonly skills: InstallSkillsStep;
  readonly auth: InstallAuthStep;
  readonly next: readonly string[];
}

export interface InstallFlags {
  readonly format: "json" | "jsonl" | "text";
  readonly yes: boolean;
  readonly dryRun: boolean;
  readonly noInput: boolean;
  readonly jq?: string;
  readonly noAuth: boolean;
  readonly help: boolean;
}

export interface ExecResult {
  readonly stdout: string;
  readonly stderr: string;
}

export interface InstallRunner {
  readonly exec: (
    command: string,
    args: readonly string[],
    options?: { readonly timeoutMs?: number }
  ) => Promise<ExecResult>;
  readonly execInherit: (
    command: string,
    args: readonly string[],
    options?: { readonly timeoutMs?: number }
  ) => Promise<void>;
  readonly isTty: () => boolean;
  readonly confirm: (message: string) => Promise<boolean>;
  readonly log: (message: string) => void;
  readonly packageSearchDirs: () => readonly string[];
  readonly env: NodeJS.ProcessEnv;
}

export class InstallError extends Error {
  readonly type: string;
  readonly subtype?: string;
  readonly hint?: string;
  readonly details?: unknown;

  constructor(input: {
    readonly message: string;
    readonly type?: string;
    readonly subtype?: string;
    readonly hint?: string;
    readonly details?: unknown;
  }) {
    super(input.message);
    this.name = "InstallError";
    this.type = input.type ?? "runtime";
    this.subtype = input.subtype;
    this.hint = input.hint;
    this.details = input.details;
  }
}

export function isInstallError(value: unknown): value is InstallError {
  return value instanceof InstallError;
}
