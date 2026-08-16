import { readFileSync } from "node:fs";
import { isAbsolute, resolve as resolvePath } from "node:path";

import { EngineBacktestError } from "./errors";

export function loadConfigValue(
  raw: string,
  options: { readonly cwd?: string; readonly readFile?: (path: string) => string } = {}
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
