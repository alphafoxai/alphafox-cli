/**
 * Open a URL in the OS browser. Failure is explicit — callers must not
 * continue as if the page was shown.
 */

import { spawnSync } from "node:child_process";

export type OpenBrowserResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

export function systemBrowserCommand(
  url: string,
  platform: NodeJS.Platform = process.platform
): { readonly command: string; readonly args: readonly string[] } {
  if (platform === "darwin") {
    return { command: "open", args: [url] };
  }
  if (platform === "win32") {
    return { command: "cmd", args: ["/c", "start", "", url] };
  }
  return { command: "xdg-open", args: [url] };
}

export function openSystemBrowser(url: string): OpenBrowserResult {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: "unsupported_url_protocol" };
  }

  const { command, args } = systemBrowserCommand(url);
  try {
    const result = spawnSync(command, [...args], {
      stdio: "ignore",
      timeout: 15_000,
      windowsHide: true,
    });
    if (result.error) {
      return { ok: false, reason: result.error.message };
    }
    if (result.status !== 0 && result.status !== null) {
      return { ok: false, reason: `exit_${result.status}` };
    }
    if (result.signal) {
      return { ok: false, reason: `signal_${result.signal}` };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "spawn_failed",
    };
  }
}
