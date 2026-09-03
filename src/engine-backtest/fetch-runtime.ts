import { createWriteStream } from "node:fs";
import { mkdir, rename, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

import { EngineBacktestError } from "./errors";

export const BACKTEST_RUNTIME_PROTOCOL = 1;
export const DEFAULT_BACKTEST_WASM_MANIFEST_URL =
  "https://zwggllrrna54e2d6.public.blob.vercel-storage.com/engine-backtest/latest.json";

export const BLOB_RUNTIME_FILES = {
  wasm: "tradingfox-backtest.wasm",
  wasmExec: "wasm_exec.js",
  worker: "worker.mjs",
  client: "index.mjs",
  node: "node.mjs",
  nodeWorker: "worker-node.mjs",
  nodeWorkerPath: "worker-node-path.mjs",
  passivbotKernel: "passivbot_kernel.wasm",
  passivbotKernelModule: "passivbot-kernel.mjs",
} as const;

export type BlobRuntimeFileKey = keyof typeof BLOB_RUNTIME_FILES;

export interface EngineBacktestBlobManifest {
  readonly version: string;
  readonly hash: string;
  readonly protocol: number;
  readonly engineSha?: string;
  readonly packageVersion?: string;
  readonly wasm: string;
  readonly wasmExec: string;
  readonly worker: string;
  readonly client: string;
  readonly node: string;
  readonly nodeWorker: string;
  readonly nodeWorkerPath: string;
  readonly passivbotKernel?: string;
  readonly passivbotKernelModule?: string;
}

export interface FetchRuntimeHooks {
  readonly fetch?: typeof fetch;
  readonly cacheDir?: string;
}

export function resolveBacktestWasmManifestUrl(
  env: NodeJS.ProcessEnv = process.env
): string {
  return (
    env.ALPHAFOX_BACKTEST_WASM_MANIFEST_URL?.trim() ||
    DEFAULT_BACKTEST_WASM_MANIFEST_URL
  );
}

export function resolveRuntimeCacheDir(
  hash: string,
  env: NodeJS.ProcessEnv = process.env
): string {
  const override = env.ALPHAFOX_BACKTEST_RUNTIME_CACHE_DIR?.trim();
  if (override) {
    return join(override, hash);
  }
  const xdg = env.XDG_CACHE_HOME?.trim();
  return join(xdg || join(homedir(), ".cache"), "alphafox", "engine-backtest", hash);
}

export function parseEngineBacktestBlobManifest(
  value: unknown
): EngineBacktestBlobManifest {
  if (!value || typeof value !== "object") {
    throw new EngineBacktestError({
      type: "runtime",
      subtype: "runtime_manifest_invalid",
      message: "Backtest runtime manifest is not an object.",
    });
  }
  const record = value as Record<string, unknown>;
  if (record.protocol !== BACKTEST_RUNTIME_PROTOCOL) {
    throw new EngineBacktestError({
      type: "runtime",
      subtype: "runtime_protocol_mismatch",
      message: `Backtest runtime protocol is incompatible (got ${String(record.protocol)}, expected ${BACKTEST_RUNTIME_PROTOCOL}).`,
    });
  }
  const passivbotKernel =
    record.passivbotKernel === undefined
      ? undefined
      : readRequiredHttps(record.passivbotKernel, "passivbotKernel");
  const passivbotKernelModule =
    record.passivbotKernelModule === undefined
      ? undefined
      : readRequiredHttps(
          record.passivbotKernelModule,
          "passivbotKernelModule"
        );
  if ((passivbotKernel === undefined) !== (passivbotKernelModule === undefined)) {
    throw new EngineBacktestError({
      type: "runtime",
      subtype: "runtime_manifest_invalid",
      message:
        "Backtest runtime manifest must include both passivbotKernel and passivbotKernelModule.",
    });
  }
  return {
    version: readRequiredString(record.version, "version"),
    hash: readRequiredString(record.hash, "hash"),
    protocol: BACKTEST_RUNTIME_PROTOCOL,
    engineSha: readOptionalString(record.engineSha),
    packageVersion: readOptionalString(record.packageVersion),
    wasm: readRequiredHttps(record.wasm, "wasm"),
    wasmExec: readRequiredHttps(record.wasmExec, "wasmExec"),
    worker: readRequiredHttps(record.worker, "worker"),
    client: readRequiredHttps(record.client, "client"),
    node: readRequiredHttps(record.node, "node"),
    nodeWorker: readRequiredHttps(record.nodeWorker, "nodeWorker"),
    nodeWorkerPath: readRequiredHttps(record.nodeWorkerPath, "nodeWorkerPath"),
    passivbotKernel,
    passivbotKernelModule,
  };
}

export async function ensureBlobRuntime(
  env: NodeJS.ProcessEnv = process.env,
  hooks?: FetchRuntimeHooks
): Promise<{
  readonly manifest: EngineBacktestBlobManifest;
  readonly directory: string;
  readonly nodeEntry: string;
}> {
  const fetchImpl = hooks?.fetch ?? fetch;
  const manifestUrl = resolveBacktestWasmManifestUrl(env);
  let response: Response;
  try {
    response = await fetchImpl(manifestUrl, { cache: "no-cache" });
  } catch (error) {
    throw new EngineBacktestError({
      type: "runtime",
      subtype: "runtime_manifest_unavailable",
      message: `Cannot load backtest runtime manifest: ${error instanceof Error ? error.message : String(error)}`,
      hint: "Check network access to Vercel Blob, or set ALPHAFOX_USE_LOCAL_BACKTEST=1 with a local Engine build.",
      details: { manifestUrl },
    });
  }
  if (!response.ok) {
    throw new EngineBacktestError({
      type: "runtime",
      subtype: "runtime_manifest_unavailable",
      message: `Backtest runtime manifest unavailable (HTTP ${response.status}).`,
      hint: "Check network access to Vercel Blob, or set ALPHAFOX_USE_LOCAL_BACKTEST=1 with a local Engine build.",
      details: { manifestUrl, status: response.status },
    });
  }
  const manifest = parseEngineBacktestBlobManifest(await response.json());
  const directory = hooks?.cacheDir ?? resolveRuntimeCacheDir(manifest.hash, env);
  await mkdir(directory, { recursive: true });
  for (const key of Object.keys(BLOB_RUNTIME_FILES) as BlobRuntimeFileKey[]) {
    const fileName = BLOB_RUNTIME_FILES[key];
    const url = manifest[key];
    if (url === undefined) {
      continue;
    }
    const target = join(directory, fileName);
    if (await fileExists(target)) {
      continue;
    }
    await downloadFile(fetchImpl, url, target);
  }
  return {
    manifest,
    directory,
    nodeEntry: join(directory, BLOB_RUNTIME_FILES.node),
  };
}

async function downloadFile(
  fetchImpl: typeof fetch,
  url: string,
  target: string
): Promise<void> {
  let response: Response;
  try {
    response = await fetchImpl(url);
  } catch (error) {
    throw new EngineBacktestError({
      type: "runtime",
      subtype: "runtime_download_failed",
      message: `Cannot download backtest runtime ${url}: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
  if (!response.ok || !response.body) {
    throw new EngineBacktestError({
      type: "runtime",
      subtype: "runtime_download_failed",
      message: `Backtest runtime file unavailable (${url} HTTP ${response.status}).`,
    });
  }
  const tmp = `${target}.tmp`;
  await pipeline(
    Readable.fromWeb(response.body as import("node:stream/web").ReadableStream),
    createWriteStream(tmp)
  );
  await rename(tmp, target);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const info = await stat(path);
    return info.isFile() && info.size > 0;
  } catch {
    return false;
  }
}


function readRequiredHttps(value: unknown, field: string): string {
  const text = readRequiredString(value, field);
  if (!text.startsWith("https://")) {
    throw new EngineBacktestError({
      type: "runtime",
      subtype: "runtime_manifest_invalid",
      message: `Backtest runtime manifest ${field} must be an https URL.`,
    });
  }
  return text;
}

function readRequiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new EngineBacktestError({
      type: "runtime",
      subtype: "runtime_manifest_invalid",
      message: `Backtest runtime manifest is missing ${field}.`,
    });
  }
  return value.trim();
}

function readOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}
