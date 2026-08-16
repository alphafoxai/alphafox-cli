import { execFile, spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { promisify } from "node:util";

import type { ExecResult, InstallRunner } from "./types";

const execFileAsync = promisify(execFile);

export function wrapWindowsCommand(
  command: string,
  args: readonly string[],
  platform: NodeJS.Platform = process.platform
): { readonly file: string; readonly argv: string[] } {
  if (platform === "win32") {
    return { file: "cmd.exe", argv: ["/c", command, ...args] };
  }
  return { file: command, argv: [...args] };
}

export async function execCommand(
  command: string,
  args: readonly string[],
  options: {
    readonly timeoutMs?: number;
    readonly env?: NodeJS.ProcessEnv;
    readonly inherit?: boolean;
    readonly platform?: NodeJS.Platform;
  } = {}
): Promise<ExecResult> {
  const { file, argv } = wrapWindowsCommand(
    command,
    args,
    options.platform ?? process.platform
  );
  const timeout = options.timeoutMs ?? 120_000;
  if (options.inherit) {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(file, argv, {
        stdio: "inherit",
        env: options.env,
        timeout,
      });
      child.on("error", reject);
      child.on("exit", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`${command} exited ${code ?? "null"}`));
      });
    });
    return { stdout: "", stderr: "" };
  }
  const { stdout, stderr } = await execFileAsync(file, argv, {
    timeout,
    encoding: "utf8",
    env: options.env,
    maxBuffer: 10 * 1024 * 1024,
  });
  return { stdout, stderr };
}

export async function confirmTty(message: string): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
  });
  try {
    const answer = await rl.question(`${message} [Y/n] `);
    const token = answer.trim().toLowerCase();
    return (
      token === "" ||
      token === "y" ||
      token === "yes" ||
      token === "是" ||
      token === "好"
    );
  } finally {
    rl.close();
  }
}

export function createDefaultInstallRunner(
  env: NodeJS.ProcessEnv,
  searchDirs: readonly string[]
): InstallRunner {
  return {
    env,
    packageSearchDirs: () => searchDirs,
    isTty: () => Boolean(process.stdin.isTTY && process.stderr.isTTY),
    log: (message) => {
      process.stderr.write(`${message}\n`);
    },
    confirm: confirmTty,
    exec: (command, args, options) =>
      execCommand(command, args, { ...options, env }),
    execInherit: async (command, args, options) => {
      await execCommand(command, args, { ...options, env, inherit: true });
    },
  };
}
