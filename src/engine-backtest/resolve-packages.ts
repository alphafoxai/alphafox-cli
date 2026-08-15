import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";

import { EngineBacktestError } from "./errors";
import { ensureBlobRuntime, type FetchRuntimeHooks } from "./fetch-runtime";
import { importNativeModule } from "./native-import";
import type { BacktestRunnerModule, BacktestWasmModule } from "./types";

const WASM_SPEC = "@alphafoxai/backtest-wasm/node";
const RUNNER_SPEC = "@alphafoxai/backtest-runner";

export type PackageKind = "wasm" | "runner";

interface PackageDescriptor {
  readonly specifier: string;
  readonly envKey:
    | "ALPHAFOX_BACKTEST_WASM_DIR"
    | "ALPHAFOX_BACKTEST_RUNNER_DIR";
  readonly npmName: "backtest-wasm" | "backtest-runner";
  readonly exportKey: "./node" | ".";
  readonly useMainFallback: boolean;
  readonly entryCandidates: readonly string[];
  readonly installHint: string;
}

const PACKAGE_DESCRIPTORS: Record<PackageKind, PackageDescriptor> = {
  wasm: {
    specifier: WASM_SPEC,
    envKey: "ALPHAFOX_BACKTEST_WASM_DIR",
    npmName: "backtest-wasm",
    exportKey: "./node",
    useMainFallback: false,
    entryCandidates: ["node.mjs", "node.js", "node.cjs"],
    installHint:
      "Set ALPHAFOX_BACKTEST_WASM_DIR / ALPHAFOX_ENGINE_ROOT, or ALPHAFOX_USE_LOCAL_BACKTEST=1 with a sibling Engine build. Otherwise the CLI downloads the Node runtime from Vercel Blob.",
  },
  runner: {
    specifier: RUNNER_SPEC,
    envKey: "ALPHAFOX_BACKTEST_RUNNER_DIR",
    npmName: "backtest-runner",
    exportKey: ".",
    useMainFallback: true,
    entryCandidates: ["index.mjs", "index.js", "index.cjs"],
    installHint:
      "The tape runner is bundled with the CLI. Override with ALPHAFOX_BACKTEST_RUNNER_DIR / ALPHAFOX_ENGINE_ROOT.",
  },
};

export interface ResolvedPackagePath {
  readonly kind: PackageKind;
  readonly specifier: string;
  readonly filePath: string;
  readonly source: "env_dir" | "engine_root" | "sibling" | "vendor" | "blob";
}

export interface ResolvePackageHooks extends FetchRuntimeHooks {
  readonly requireResolve?: (specifier: string) => string;
  readonly importModule?: (fileUrl: string) => Promise<unknown>;
  readonly exists?: (path: string) => boolean;
  readonly readFile?: (path: string) => string;
  readonly cliRoot?: string;
  readonly callerFilename?: string;
}

function existsPath(
  path: string,
  hooks: ResolvePackageHooks | undefined
): boolean {
  return hooks?.exists ? hooks.exists(path) : existsSync(path);
}

function readText(path: string, hooks: ResolvePackageHooks | undefined): string {
  return hooks?.readFile ? hooks.readFile(path) : readFileSync(path, "utf8");
}

function callerFilename(hooks?: ResolvePackageHooks): string {
  return hooks?.callerFilename ?? __filename;
}

export function findCliRoot(
  startDir: string,
  hooks?: ResolvePackageHooks
): string | undefined {
  if (hooks?.cliRoot) return hooks.cliRoot;
  let dir = startDir;
  for (let i = 0; i < 10; i += 1) {
    const pkgPath = join(dir, "package.json");
    if (existsPath(pkgPath, hooks)) {
      try {
        const pkg = JSON.parse(readText(pkgPath, hooks)) as { name?: string };
        if (pkg.name === "@alphafox/cli") return dir;
      } catch {
        // keep walking
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

function entryFromPackageDir(
  dir: string,
  kind: PackageKind,
  hooks?: ResolvePackageHooks
): string | undefined {
  if (!existsPath(dir, hooks)) return undefined;
  const descriptor = PACKAGE_DESCRIPTORS[kind];
  const pkgPath = join(dir, "package.json");
  if (existsPath(pkgPath, hooks)) {
    try {
      const req = createRequire(pkgPath);
      return req.resolve(descriptor.specifier);
    } catch {
      // fall through to known filenames
    }
    try {
      const pkg = JSON.parse(readText(pkgPath, hooks)) as {
        exports?: Record<string, unknown>;
        main?: string;
      };
      const exp = pkg.exports?.[descriptor.exportKey];
      const mainFallback = descriptor.useMainFallback ? pkg.main : undefined;
      const file =
        typeof exp === "string"
          ? exp
          : exp && typeof exp === "object"
            ? String(
                (exp as { default?: string; import?: string }).default ??
                  (exp as { import?: string }).import ??
                  mainFallback ??
                  ""
              )
            : (mainFallback ?? "");
      if (file) {
        const abs = join(dir, file);
        if (existsPath(abs, hooks)) return abs;
      }
    } catch {
      // ignore malformed package.json
    }
  }
  for (const name of descriptor.entryCandidates) {
    const abs = join(dir, name);
    if (existsPath(abs, hooks)) return abs;
  }
  return undefined;
}

function toAbsDir(raw: string): string {
  return isAbsolute(raw) ? raw : join(process.cwd(), raw);
}

function shouldUseLocalOverride(env: NodeJS.ProcessEnv): boolean {
  return env.ALPHAFOX_USE_LOCAL_BACKTEST === "1";
}

function hasExplicitLocalDir(
  kind: PackageKind,
  env: NodeJS.ProcessEnv
): boolean {
  return Boolean(
    env[PACKAGE_DESCRIPTORS[kind].envKey]?.trim() ||
      env.ALPHAFOX_ENGINE_ROOT?.trim() ||
      shouldUseLocalOverride(env)
  );
}

export function resolveBacktestPackagePath(
  kind: PackageKind,
  env: NodeJS.ProcessEnv = process.env,
  hooks?: ResolvePackageHooks
): ResolvedPackagePath {
  const descriptor = PACKAGE_DESCRIPTORS[kind];
  const { specifier, envKey, npmName } = descriptor;
  const tried: string[] = [];

  const envDir = env[envKey]?.trim();
  if (envDir) {
    const abs = toAbsDir(envDir);
    const entry = entryFromPackageDir(abs, kind, hooks);
    if (entry) {
      return { kind, specifier, filePath: entry, source: "env_dir" };
    }
    throw new EngineBacktestError({
      type: "runtime",
      subtype: "package_unresolved",
      message: `Cannot resolve ${specifier} from ${envKey}=${abs}`,
      hint: `Point ${envKey} at the npm/${npmName} package directory (must contain ${descriptor.entryCandidates[0]}).`,
      details: { specifier, envKey, dir: abs, tried },
    });
  }
  tried.push(`${envKey}:(unset)`);

  const engineRoot = env.ALPHAFOX_ENGINE_ROOT?.trim();
  if (engineRoot) {
    const dir = join(toAbsDir(engineRoot), "npm", npmName);
    const entry = entryFromPackageDir(dir, kind, hooks);
    if (entry) {
      return { kind, specifier, filePath: entry, source: "engine_root" };
    }
    throw new EngineBacktestError({
      type: "runtime",
      subtype: "package_unresolved",
      message: `Cannot resolve ${specifier} from ALPHAFOX_ENGINE_ROOT=${engineRoot}`,
      hint: `Expected ${dir} to contain the ${npmName} package.`,
      details: { specifier, dir, tried },
    });
  }
  tried.push("ALPHAFOX_ENGINE_ROOT:(unset)");

  if (shouldUseLocalOverride(env)) {
    const cliRoot = findCliRoot(dirname(callerFilename(hooks)), hooks);
    if (cliRoot) {
      const dir = join(cliRoot, "..", "alphafox-engine", "npm", npmName);
      const entry = entryFromPackageDir(dir, kind, hooks);
      if (entry) {
        return { kind, specifier, filePath: entry, source: "sibling" };
      }
      tried.push(`sibling:${dir}`);
    } else {
      tried.push("sibling:(cli root not found)");
    }
  } else {
    tried.push("sibling:(requires ALPHAFOX_USE_LOCAL_BACKTEST=1)");
  }

  throw new EngineBacktestError({
    type: "runtime",
    subtype: "package_unresolved",
    message: `Cannot resolve ${specifier}`,
    hint: descriptor.installHint,
    details: { specifier, tried },
  });
}

function resolveVendoredRunner(hooks?: ResolvePackageHooks): ResolvedPackagePath {
  const cliRoot = findCliRoot(dirname(callerFilename(hooks)), hooks);
  if (!cliRoot) {
    throw new EngineBacktestError({
      type: "runtime",
      subtype: "package_unresolved",
      message: `Cannot resolve ${RUNNER_SPEC} from the vendored runner`,
      hint: PACKAGE_DESCRIPTORS.runner.installHint,
    });
  }
  const dir = join(cliRoot, "vendor", "backtest-runner");
  const entry = entryFromPackageDir(dir, "runner", hooks);
  if (!entry) {
    throw new EngineBacktestError({
      type: "runtime",
      subtype: "package_unresolved",
      message: `Cannot resolve ${RUNNER_SPEC} from ${dir}`,
      hint: PACKAGE_DESCRIPTORS.runner.installHint,
      details: { specifier: RUNNER_SPEC, dir },
    });
  }
  return {
    kind: "runner",
    specifier: RUNNER_SPEC,
    filePath: entry,
    source: "vendor",
  };
}

async function importFile(
  filePath: string,
  hooks?: ResolvePackageHooks
): Promise<unknown> {
  const url = pathToFileURL(filePath).href;
  if (hooks?.importModule) {
    return hooks.importModule(url);
  }
  return importNativeModule(url);
}

function assertWasmModule(mod: unknown, filePath: string): BacktestWasmModule {
  if (
    !mod ||
    typeof mod !== "object" ||
    typeof (mod as BacktestWasmModule).createNodeBacktestClient !== "function"
  ) {
    throw new EngineBacktestError({
      type: "runtime",
      subtype: "package_invalid",
      message: `${WASM_SPEC} does not export createNodeBacktestClient`,
      details: { filePath },
    });
  }
  return mod as BacktestWasmModule;
}

function assertRunnerModule(
  mod: unknown,
  filePath: string
): BacktestRunnerModule {
  if (!mod || typeof mod !== "object") {
    throw new EngineBacktestError({
      type: "runtime",
      subtype: "package_invalid",
      message: `${RUNNER_SPEC} is not a module`,
      details: { filePath },
    });
  }
  const m = mod as Partial<BacktestRunnerModule>;
  for (const name of [
    "loadTape",
    "assembleScenario",
    "resolveTapeExchange",
  ] as const) {
    if (typeof m[name] !== "function") {
      throw new EngineBacktestError({
        type: "runtime",
        subtype: "package_invalid",
        message: `${RUNNER_SPEC} does not export ${name}`,
        details: { filePath },
      });
    }
  }
  if (!m.DEFAULT_EXECUTION_MODEL) {
    throw new EngineBacktestError({
      type: "runtime",
      subtype: "package_invalid",
      message: `${RUNNER_SPEC} does not export DEFAULT_EXECUTION_MODEL`,
      details: { filePath },
    });
  }
  return m as BacktestRunnerModule;
}

export async function loadBacktestWasm(
  env: NodeJS.ProcessEnv = process.env,
  hooks?: ResolvePackageHooks
): Promise<{ readonly module: BacktestWasmModule; readonly resolved: ResolvedPackagePath }> {
  if (hasExplicitLocalDir("wasm", env)) {
    const resolved = resolveBacktestPackagePath("wasm", env, hooks);
    const mod = assertWasmModule(
      await importFile(resolved.filePath, hooks),
      resolved.filePath
    );
    return { module: mod, resolved };
  }
  const runtime = await ensureBlobRuntime(env, hooks);
  const mod = assertWasmModule(
    await importFile(runtime.nodeEntry, hooks),
    runtime.nodeEntry
  );
  return {
    module: mod,
    resolved: {
      kind: "wasm",
      specifier: WASM_SPEC,
      filePath: runtime.nodeEntry,
      source: "blob",
    },
  };
}

export async function loadBacktestRunner(
  env: NodeJS.ProcessEnv = process.env,
  hooks?: ResolvePackageHooks
): Promise<{
  readonly module: BacktestRunnerModule;
  readonly resolved: ResolvedPackagePath;
}> {
  const resolved = hasExplicitLocalDir("runner", env)
    ? resolveBacktestPackagePath("runner", env, hooks)
    : resolveVendoredRunner(hooks);
  const mod = assertRunnerModule(
    await importFile(resolved.filePath, hooks),
    resolved.filePath
  );
  return { module: mod, resolved };
}
