import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, normalize, sep } from "node:path";
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
} as const;
const RUNTIME_CACHE_MARKER = ".complete.json";
const RUNTIME_CACHE_LOCK = ".publish.lock";
const RUNTIME_CACHE_LOCK_STALE_MS = 5 * 60_000;
const RUNTIME_CACHE_OWNERLESS_GRACE_MS = 1_000;
const RUNTIME_CACHE_LOCK_WAIT_MS = 10 * 60_000;
const RUNTIME_CACHE_LOCK_HEARTBEAT_MS = 30_000;

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
  if (!isSafeRuntimeHash(hash)) {
    throw new EngineBacktestError({
      type: "runtime",
      subtype: "runtime_manifest_invalid",
      message: "Backtest runtime manifest hash must be a safe cache key.",
    });
  }
  const override = env.ALPHAFOX_BACKTEST_RUNTIME_CACHE_DIR?.trim();
  const root = override || join(env.XDG_CACHE_HOME?.trim() || join(homedir(), ".cache"), "alphafox", "engine-backtest");
  return join(root, hash);
}

function isSafeRuntimeHash(hash: string): boolean {
  const trimmed = hash.trim();
  return (
    trimmed === hash &&
    trimmed !== "" &&
    trimmed !== "." &&
    trimmed !== ".." &&
    !isAbsolute(trimmed) &&
    normalize(trimmed) === trimmed &&
    !trimmed.includes(sep) &&
    !trimmed.includes("/") &&
    !trimmed.includes("\\")
  );
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
  const hash = readRequiredString(record.hash, "hash");
  if (!isSafeRuntimeHash(hash)) {
    throw new EngineBacktestError({
      type: "runtime",
      subtype: "runtime_manifest_invalid",
      message: "Backtest runtime manifest hash must be a safe cache key.",
    });
  }
  return {
    version: readRequiredString(record.version, "version"),
    hash,
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
  const marker = join(directory, RUNTIME_CACHE_MARKER);
  if (!(await runtimeCacheIsComplete(directory, marker, manifest))) {
    const release = await acquireRuntimeCacheLock(directory);
    try {
      if (!(await runtimeCacheIsComplete(directory, marker, manifest))) {
        await replaceRuntimeCache(fetchImpl, manifest, directory);
      }
    } finally {
      await release();
    }
  }
  return {
    manifest,
    directory,
    nodeEntry: join(directory, BLOB_RUNTIME_FILES.node),
  };
}

async function replaceRuntimeCache(
  fetchImpl: typeof fetch,
  manifest: EngineBacktestBlobManifest,
  directory: string
): Promise<void> {
  const staging = join(
    dirname(directory),
    `.${manifest.hash}.${process.pid}.${randomUUID()}.tmp`
  );
  try {
    await mkdir(staging, { recursive: true });
    for (const key of Object.keys(BLOB_RUNTIME_FILES) as BlobRuntimeFileKey[]) {
      await downloadFile(
        fetchImpl,
        manifest[key],
        join(staging, BLOB_RUNTIME_FILES[key])
      );
    }
    await writeFile(
      join(staging, RUNTIME_CACHE_MARKER),
      `${JSON.stringify({
        protocol: manifest.protocol,
        hash: manifest.hash,
        files: await runtimeFileDigests(staging),
      })}\n`,
      { encoding: "utf8", mode: 0o600, flag: "wx" }
    );
    await rm(directory, { recursive: true, force: true });
    await rename(staging, directory);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

async function acquireRuntimeCacheLock(
  directory: string
): Promise<() => Promise<void>> {
  const lock = `${directory}${RUNTIME_CACHE_LOCK}`;
  const owner = randomUUID();
  const ownerFile = join(lock, "owner");
  const startedAt = Date.now();
  await mkdir(dirname(directory), { recursive: true });
  while (true) {
    try {
      await mkdir(lock);
      try {
        await writeFile(ownerFile, owner, { encoding: "utf8", mode: 0o600 });
      } catch (error) {
        await rm(lock, { recursive: true, force: true });
        throw error;
      }
      const heartbeat = setInterval(() => {
        const now = new Date();
        void utimes(ownerFile, now, now).catch(() => undefined);
      }, RUNTIME_CACHE_LOCK_HEARTBEAT_MS);
      heartbeat.unref();
      return async () => {
        clearInterval(heartbeat);
        try {
          if ((await readFile(ownerFile, "utf8")) === owner) {
            await rm(lock, { recursive: true, force: true });
          }
        } catch {
          // The lock was already removed; never delete a replacement owner's lock.
        }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (Date.now() - startedAt > RUNTIME_CACHE_LOCK_WAIT_MS) {
        throw new EngineBacktestError({
          type: "runtime",
          subtype: "runtime_cache_lock_timeout",
          message: "Timed out waiting for another process to publish the backtest runtime cache.",
        });
      }
      try {
        const heartbeat = await stat(ownerFile);
        if (Date.now() - heartbeat.mtimeMs > RUNTIME_CACHE_LOCK_STALE_MS) {
          const quarantine = `${lock}.${process.pid}.${randomUUID()}.stale`;
          try {
            await rename(lock, quarantine);
            await rm(quarantine, { recursive: true, force: true });
            continue;
          } catch (staleError) {
            if ((staleError as NodeJS.ErrnoException).code !== "ENOENT") {
              throw staleError;
            }
          }
        }
      } catch (inspectError) {
        if ((inspectError as NodeJS.ErrnoException).code === "ENOENT") {
          let lockAge: number;
          try {
            lockAge = Date.now() - (await stat(lock)).mtimeMs;
          } catch (lockError) {
            if ((lockError as NodeJS.ErrnoException).code === "ENOENT") continue;
            throw lockError;
          }
          if (lockAge > RUNTIME_CACHE_OWNERLESS_GRACE_MS) {
            const quarantine = `${lock}.${process.pid}.${randomUUID()}.stale`;
            try {
              await rename(lock, quarantine);
              await rm(quarantine, { recursive: true, force: true });
            } catch (staleError) {
              if ((staleError as NodeJS.ErrnoException).code !== "ENOENT") {
                throw staleError;
              }
            }
          }
          continue;
        }
        throw inspectError;
      }
      await sleep(50);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function runtimeCacheIsComplete(
  directory: string,
  marker: string,
  manifest: EngineBacktestBlobManifest
): Promise<boolean> {
  try {
    const recorded = JSON.parse(await readFile(marker, "utf8")) as {
      protocol?: unknown;
      hash?: unknown;
      files?: unknown;
    };
    if (
      recorded.protocol !== manifest.protocol ||
      recorded.hash !== manifest.hash ||
      !recorded.files ||
      typeof recorded.files !== "object" ||
      Array.isArray(recorded.files)
    ) return false;
    const expected = recorded.files as Record<string, unknown>;
    const actual = await runtimeFileDigests(directory);
    return (Object.keys(BLOB_RUNTIME_FILES) as BlobRuntimeFileKey[]).every(
      (key) => expected[key] === actual[key]
    );
  } catch {
    return false;
  }
}

async function runtimeFileDigests(directory: string): Promise<Record<BlobRuntimeFileKey, string>> {
  const entries = await Promise.all(
    (Object.keys(BLOB_RUNTIME_FILES) as BlobRuntimeFileKey[]).map(async (key) => {
      const path = join(directory, BLOB_RUNTIME_FILES[key]);
      const info = await stat(path);
      if (!info.isFile() || info.size === 0) throw new Error(`Runtime file is missing: ${path}`);
      return [key, createHash("sha256").update(await readFile(path)).digest("hex")] as const;
    })
  );
  return Object.fromEntries(entries) as Record<BlobRuntimeFileKey, string>;
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
