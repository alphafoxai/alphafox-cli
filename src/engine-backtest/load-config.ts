import { readFileSync } from "node:fs";
import { isAbsolute, resolve as resolvePath } from "node:path";

import { EngineBacktestError } from "./errors";

type LoadConfigOptions = {
  readonly cwd?: string;
  readonly readFile?: (path: string) => string;
};

export function loadConfigValue(
  raw: string,
  options: LoadConfigOptions = {}
): unknown {
  const cwd = options.cwd ?? process.cwd();
  const read = options.readFile ?? ((p: string) => readFileSync(p, "utf8"));
  if (raw.startsWith("@")) {
    const rel = raw.slice(1);
    if (!rel) {
      throw new EngineBacktestError({
        type: "usage",
        subtype: "missing_config",
        message: "--config @path is empty",
        status: 400,
      });
    }
    const abs = isAbsolute(rel) ? rel : resolvePath(cwd, rel);
    try {
      return JSON.parse(read(abs));
    } catch (err) {
      throw new EngineBacktestError({
        type: "usage",
        subtype: "invalid_config",
        message: `Cannot read --config file ${abs}: ${err instanceof Error ? err.message : String(err)}`,
        status: 400,
      });
    }
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new EngineBacktestError({
      type: "usage",
      subtype: "invalid_config",
      message: "--config must be JSON or @path-to.json",
      status: 400,
    });
  }
}

export function loadEngineBacktestConfig(
  raw: string,
  options: LoadConfigOptions = {}
): unknown {
  const value = loadConfigValue(raw, options);
  assertEngineBacktestConfig(value);
  return value;
}

export function assertEngineBacktestConfig(value: unknown): void {
  if (!isPlainObject(value) || !isPlainObject(value.config)) {
    return;
  }
  throw new EngineBacktestError({
    type: "usage",
    subtype: "validate_config_envelope",
    message:
      "--config looks like a validate_config HTTP body; engine-backtest needs the inner trader config",
    hint: "Pass { common, strategy }. Extract the `config` field; do not send { configSchemaVersion, config }.",
    status: 400,
    details: { keys: Object.keys(value) },
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
