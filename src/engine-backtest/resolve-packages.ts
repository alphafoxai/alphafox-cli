import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";

import { EngineBacktestError } from "./errors";
import type { BacktestRunnerModule, BacktestWasmModule } from "./types";

const WASM_SPEC = "@alphafoxai/backtest-wasm/node";
const RUNNER_SPEC = "@alphafoxai/backtest-runner";

export type PackageKind = "wasm" | "runner";

export interface ResolvedPackagePath {
  readonly kind: PackageKind;
  readonly specifier: string;
  readonly filePath: string;
  readonly source: "node_modules" | "env_dir" | "engine_root" | "sibling";
}

export interface ResolvePackageHooks {
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

/**
 * Node resolve via import.meta (when present) or createRequire(__filename).
 * Compiled CLI is CommonJS; import.meta is probed without a static reference.
 */
function nodeResolve(
  specifier: string,
  hooks?: ResolvePackageHooks
): string | undefined {
  if (hooks?.requireResolve) {
    try {
      return hooks.requireResolve(specifier);
    } catch {
      return undefined;
    }
  }
  const filename = callerFilename(hooks);
  try {
    return createRequire(filename).resolve(specifier);
  } catch {
    // fall through to import.meta when the host is ESM
  }
  try {
    const meta = Function("return import.meta")() as { url?: string } | undefined;
    if (meta?.url) {
      return createRequire(meta.url).resolve(specifier);
    }
  } catch {
    // CJS host — import.meta is unavailable
  }
  return undefined;
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
  const pkgPath = join(dir, "package.json");
  if (existsPath(pkgPath, hooks)) {
    try {
      const req = createRequire(pkgPath);
      const spec = kind === "wasm" ? WASM_SPEC : RUNNER_SPEC;
      return req.resolve(spec);
    } catch {
      // fall through to known filenames
    }
    try {
      const pkg = JSON.parse(readText(pkgPath, hooks)) as {
        exports?: Record<string, unknown>;
        main?: string;
      };
      if (kind === "wasm") {
        const exp = pkg.exports?.["./node"];
        const file =
          typeof exp === "string"
            ? exp
            : exp && typeof exp === "object"
              ? String(
                  (exp as { default?: string; import?: string }).default ??
                    (exp as { import?: string }).import ??
                    ""
                )
              : "";
        if (file) {
          const abs = join(dir, file);
          if (existsPath(abs, hooks)) return abs;
        }
      } else {
        const exp = pkg.exports?.["."];
        const file =
          typeof exp === "string"
            ? exp
            : exp && typeof exp === "object"
              ? String(
                  (exp as { default?: string; import?: string }).default ??
                    (exp as { import?: string }).import ??
                    pkg.main ??
                    ""
                )
              : (pkg.main ?? "");
        if (file) {
          const abs = join(dir, file);
          if (existsPath(abs, hooks)) return abs;
        }
      }
    } catch {
      // ignore malformed package.json
    }
  }
  const candidates =
    kind === "wasm"
      ? ["node.mjs", "node.js", "node.cjs"]
      : ["index.mjs", "index.js", "index.cjs"];
  for (const name of candidates) {
    const abs = join(dir, name);
    if (existsPath(abs, hooks)) return abs;
  }
  return undefined;
}

function toAbsDir(raw: string): string {
  return isAbsolute(raw) ? raw : join(process.cwd(), raw);
}

export function resolveBacktestPackagePath(
  kind: PackageKind,
  env: NodeJS.ProcessEnv = process.env,
  hooks?: ResolvePackageHooks
): ResolvedPackagePath {
  const specifier = kind === "wasm" ? WASM_SPEC : RUNNER_SPEC;
  const envKey =
    kind === "wasm"
      ? "ALPHAFOX_BACKTEST_WASM_DIR"
      : "ALPHAFOX_BACKTEST_RUNNER_DIR";
  const npmName = kind === "wasm" ? "backtest-wasm" : "backtest-runner";
  const tried: string[] = [];

  const fromNode = nodeResolve(specifier, hooks);
  if (fromNode) {
    return {
      kind,
      specifier,
      filePath: fromNode,
      source: "node_modules",
    };
  }
  tried.push(`node_modules:${specifier}`);

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
      hint: `Point ${envKey} at the npm/${npmName} package directory (must contain ${kind === "wasm" ? "node.mjs" : "index.mjs"}).`,
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

  throw new EngineBacktestError({
    type: "runtime",
    subtype: "package_unresolved",
    message: `Cannot resolve ${specifier}`,
    hint:
      kind === "wasm"
        ? "Install @alphafoxai/backtest-wasm, or set ALPHAFOX_BACKTEST_WASM_DIR / ALPHAFOX_ENGINE_ROOT."
        : "Install @alphafoxai/backtest-runner, or set ALPHAFOX_BACKTEST_RUNNER_DIR / ALPHAFOX_ENGINE_ROOT.",
    details: { specifier, tried },
  });
}

async function importFile(
  filePath: string,
  hooks?: ResolvePackageHooks
): Promise<unknown> {
  const url = pathToFileURL(filePath).href;
  if (hooks?.importModule) {
    return hooks.importModule(url);
  }
  return import(url);
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
  const resolved = resolveBacktestPackagePath("wasm", env, hooks);
  const mod = assertWasmModule(await importFile(resolved.filePath, hooks), resolved.filePath);
  return { module: mod, resolved };
}

export async function loadBacktestRunner(
  env: NodeJS.ProcessEnv = process.env,
  hooks?: ResolvePackageHooks
): Promise<{
  readonly module: BacktestRunnerModule;
  readonly resolved: ResolvedPackagePath;
}> {
  const resolved = resolveBacktestPackagePath("runner", env, hooks);
  const mod = assertRunnerModule(
    await importFile(resolved.filePath, hooks),
    resolved.filePath
  );
  return { module: mod, resolved };
}
