/**
 * Linux Secret Service via `secret-tool` (libsecret).
 * Tokens travel on stdin/stdout, never as argv.
 */

import { execFileSync } from "node:child_process";

export const LINUX_SECRET_LABEL_PREFIX = "alphafox-cli";

export function linuxSecretServiceArgs(
  action: "store" | "lookup" | "clear",
  service: string,
  account: string
): readonly string[] {
  if (action === "store") {
    return [
      "store",
      "--label",
      `${LINUX_SECRET_LABEL_PREFIX} ${service}`,
      "service",
      service,
      "account",
      account,
    ];
  }
  if (action === "lookup") {
    return ["lookup", "service", service, "account", account];
  }
  return ["clear", "service", service, "account", account];
}

export function linuxSecretToolBin(
  env: NodeJS.ProcessEnv = process.env
): string {
  return env.ALPHAFOX_SECRET_TOOL?.trim() || "secret-tool";
}

function childEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...process.env, ...env };
}

export function linuxSecretServiceWrite(
  service: string,
  account: string,
  payload: string,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  try {
    execFileSync(
      linuxSecretToolBin(env),
      [...linuxSecretServiceArgs("store", service, account)],
      {
        input: payload,
        encoding: "utf8",
        stdio: ["pipe", "ignore", "ignore"],
        timeout: 10_000,
        env: childEnv(env),
      }
    );
    return true;
  } catch {
    return false;
  }
}

export function linuxSecretServiceRead(
  service: string,
  account: string,
  env: NodeJS.ProcessEnv = process.env
): string | null {
  try {
    const out = execFileSync(
      linuxSecretToolBin(env),
      [...linuxSecretServiceArgs("lookup", service, account)],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 10_000,
        env: childEnv(env),
      }
    );
    const text = out.replace(/\n$/, "");
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

export function linuxSecretServiceDelete(
  service: string,
  account: string,
  env: NodeJS.ProcessEnv = process.env
): void {
  try {
    execFileSync(
      linuxSecretToolBin(env),
      [...linuxSecretServiceArgs("clear", service, account)],
      {
        stdio: "ignore",
        timeout: 10_000,
        env: childEnv(env),
      }
    );
  } catch {
    // none
  }
}

export function linuxSecretServiceAvailable(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  try {
    execFileSync(linuxSecretToolBin(env), ["--help"], {
      stdio: "ignore",
      timeout: 5_000,
      env: childEnv(env),
    });
    return true;
  } catch {
    return false;
  }
}
