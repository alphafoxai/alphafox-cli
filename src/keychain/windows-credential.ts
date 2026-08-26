/**
 * Windows Credential Manager via advapi32 CredWrite/CredRead/CredDelete.
 * Payload is passed on stdin to PowerShell — never as argv.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** CRED_MAX_CREDENTIAL_BLOB_SIZE is 5*512 = 2560. */
export const WINDOWS_CRED_MAX_BYTES = 2560;

export const WINDOWS_CRED_PS1 = `# AlphaFox CLI — Windows Credential Manager helper (t101360)
param(
  [Parameter(Mandatory = $true)][ValidateSet('write','read','delete')][string]$Action,
  [Parameter(Mandatory = $true)][string]$Target
)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
namespace AlphafoxCred {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct CREDENTIAL {
    public uint Flags;
    public uint Type;
    public string TargetName;
    public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public uint CredentialBlobSize;
    public IntPtr CredentialBlob;
    public uint Persist;
    public uint AttributeCount;
    public IntPtr Attributes;
    public string TargetAlias;
    public string UserName;
  }
  public static class Native {
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool CredWrite(ref CREDENTIAL credential, uint flags);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool CredRead(string target, uint type, uint flags, out IntPtr credentialPtr);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool CredDelete(string target, uint type, uint flags);
    [DllImport("advapi32.dll", SetLastError = true)]
    public static extern void CredFree(IntPtr credential);
  }
}
"@
$CredTypeGeneric = 1
$PersistLocalMachine = 2
switch ($Action) {
  'write' {
    $payload = [Console]::In.ReadToEnd()
    $bytes = [Text.Encoding]::UTF8.GetBytes($payload)
    if ($bytes.Length -gt ${WINDOWS_CRED_MAX_BYTES}) { throw "credential blob too large" }
    $blob = [Runtime.InteropServices.Marshal]::AllocHGlobal($bytes.Length)
    try {
      [Runtime.InteropServices.Marshal]::Copy($bytes, 0, $blob, $bytes.Length)
      $cred = New-Object AlphafoxCred.CREDENTIAL
      $cred.Type = $CredTypeGeneric
      $cred.TargetName = $Target
      $cred.UserName = "alphafox-cli"
      $cred.CredentialBlobSize = [uint32]$bytes.Length
      $cred.CredentialBlob = $blob
      $cred.Persist = $PersistLocalMachine
      $ok = [AlphafoxCred.Native]::CredWrite([ref]$cred, 0)
      if (-not $ok) {
        throw "CredWrite failed Win32=$([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
      }
    } finally {
      [Runtime.InteropServices.Marshal]::FreeHGlobal($blob)
    }
  }
  'read' {
    $ptr = [IntPtr]::Zero
    $ok = [AlphafoxCred.Native]::CredRead($Target, $CredTypeGeneric, 0, [ref]$ptr)
    if (-not $ok) { exit 2 }
    try {
      $cred = [Runtime.InteropServices.Marshal]::PtrToStructure($ptr, [type][AlphafoxCred.CREDENTIAL])
      $size = [int]$cred.CredentialBlobSize
      $bytes = New-Object byte[] $size
      [Runtime.InteropServices.Marshal]::Copy($cred.CredentialBlob, $bytes, 0, $size)
      [Console]::Out.Write([Text.Encoding]::UTF8.GetString($bytes))
    } finally {
      [AlphafoxCred.Native]::CredFree($ptr)
    }
  }
  'delete' {
    [void][AlphafoxCred.Native]::CredDelete($Target, $CredTypeGeneric, 0)
  }
}
`;

export function windowsCredentialTarget(slot: string): string {
  return `alphafox-cli/${slot}/oauth-tokens`;
}

export function windowsPowershellBin(env: NodeJS.ProcessEnv = process.env): string { return env.ALPHAFOX_POWERSHELL?.trim() || "powershell.exe"; }

function scriptPath(): string {
  const dir = join(tmpdir(), "alphafox-cli");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "windows-cred.ps1");
  writeFileSync(path, WINDOWS_CRED_PS1, { encoding: "utf8", mode: 0o600 });
  return path;
}

function runCred(action: "write" | "read" | "delete", target: string, env: NodeJS.ProcessEnv, input?: string): string {
  const result = execFileSync(windowsPowershellBin(env), ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath(), action, target], {
    input: input ?? "", encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 15_000, windowsHide: true, env: { ...process.env, ...env },
  });
  return typeof result === "string" ? result : String(result);
}

export type WindowsCredentialReadResult =
  | { readonly status: "found"; readonly value: string }
  | { readonly status: "missing" };

function statusCode(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  if ("status" in error && typeof error.status === "number") return error.status;
  return undefined;
}

export function windowsCredentialWrite(slot: string, payload: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (Buffer.byteLength(payload, "utf8") > WINDOWS_CRED_MAX_BYTES) throw new Error("Windows credential payload exceeds the supported size.");
  runCred("write", windowsCredentialTarget(slot), env, payload);
  return true;
}

export function windowsCredentialReadResult(slot: string, env: NodeJS.ProcessEnv = process.env): WindowsCredentialReadResult {
  try {
    const value = runCred("read", windowsCredentialTarget(slot), env);
    return value.length > 0 ? { status: "found", value } : { status: "missing" };
  } catch (error) {
    if (statusCode(error) === 2) return { status: "missing" };
    throw error;
  }
}

export function windowsCredentialRead(slot: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const result = windowsCredentialReadResult(slot, env);
  return result.status === "found" ? result.value : null;
}

export function windowsCredentialDelete(slot: string, env: NodeJS.ProcessEnv = process.env): void {
  runCred("delete", windowsCredentialTarget(slot), env);
}

export function windowsCredentialAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  try { execFileSync(windowsPowershellBin(env), ["-NoProfile", "-Command", "exit 0"], { stdio: "ignore", timeout: 5_000, windowsHide: true, env: { ...process.env, ...env } }); return true; } catch { return false; }
}
