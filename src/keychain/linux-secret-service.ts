/** Linux Secret Service via `secret-tool`; payloads travel on stdin only. */
import { execFileSync } from "node:child_process";

export const LINUX_SECRET_LABEL_PREFIX = "alphafox-cli";
export type SecretServiceReadResult =
  | { readonly status: "found"; readonly value: string }
  | { readonly status: "missing" };

export function linuxSecretServiceArgs(action: "store" | "lookup" | "clear", service: string, account: string): readonly string[] {
  if (action === "store") return ["store", "--label", `${LINUX_SECRET_LABEL_PREFIX} ${service}`, "service", service, "account", account];
  if (action === "lookup") return ["lookup", "service", service, "account", account];
  return ["clear", "service", service, "account", account];
}

export function linuxSecretToolBin(env: NodeJS.ProcessEnv = process.env): string { return env.ALPHAFOX_SECRET_TOOL?.trim() || "secret-tool"; }
function childEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv { return { ...process.env, ...env }; }
function errorCode(error: unknown): string | number | undefined { return (error as NodeJS.ErrnoException)?.code ?? (error as { status?: number })?.status; }

export function linuxSecretServiceWrite(service: string, account: string, payload: string, env: NodeJS.ProcessEnv = process.env): boolean {
  execFileSync(linuxSecretToolBin(env), [...linuxSecretServiceArgs("store", service, account)], { input: payload, encoding: "utf8", stdio: ["pipe", "ignore", "ignore"], timeout: 10_000, env: childEnv(env) });
  return true;
}

export function linuxSecretServiceReadResult(service: string, account: string, env: NodeJS.ProcessEnv = process.env): SecretServiceReadResult {
  try {
    const out = execFileSync(linuxSecretToolBin(env), [...linuxSecretServiceArgs("lookup", service, account)], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 10_000, env: childEnv(env) });
    const value = out.replace(/\n$/, "");
    return value.length > 0 ? { status: "found", value } : { status: "missing" };
  } catch (error) {
    if (errorCode(error) === 1) return { status: "missing" };
    throw error;
  }
}

export function linuxSecretServiceRead(service: string, account: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const result = linuxSecretServiceReadResult(service, account, env);
  return result.status === "found" ? result.value : null;
}

export function linuxSecretServiceDelete(service: string, account: string, env: NodeJS.ProcessEnv = process.env): void {
  execFileSync(linuxSecretToolBin(env), [...linuxSecretServiceArgs("clear", service, account)], { stdio: "ignore", timeout: 10_000, env: childEnv(env) });
}

export function linuxSecretServiceAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  try { execFileSync(linuxSecretToolBin(env), ["--help"], { stdio: "ignore", timeout: 5_000, env: childEnv(env) }); return true; } catch { return false; }
}
