import { readFileSync } from "node:fs";
import { isAbsolute, resolve as resolvePath } from "node:path";

export class RequestBodyError extends Error {
  readonly type = "usage";
  readonly subtype: string;
  readonly hint?: string;

  constructor(input: {
    readonly message: string;
    readonly subtype: string;
    readonly hint?: string;
  }) {
    super(input.message);
    this.name = "RequestBodyError";
    this.subtype = input.subtype;
    this.hint = input.hint;
  }
}

export function isRequestBodyError(
  value: unknown
): value is RequestBodyError {
  return value instanceof RequestBodyError;
}

export interface LoadJsonOptions {
  readonly cwd?: string;
  readonly readFile?: (path: string) => string;
}

export function loadJsonArg(
  raw: string,
  options: LoadJsonOptions = {}
): unknown {
  const cwd = options.cwd ?? process.cwd();
  const read = options.readFile ?? ((p: string) => readFileSync(p, "utf8"));
  if (raw.startsWith("@")) {
    const rel = raw.slice(1);
    if (!rel) {
      throw new RequestBodyError({
        subtype: "missing_config",
        message: "@path is empty",
        hint: "Use --config @./payload.json",
      });
    }
    const abs = isAbsolute(rel) ? rel : resolvePath(cwd, rel);
    try {
      return JSON.parse(read(abs));
    } catch (err) {
      throw new RequestBodyError({
        subtype: "invalid_config",
        message: `Cannot read JSON file ${abs}: ${err instanceof Error ? err.message : String(err)}`,
        hint: "Pass a JSON object file via --config @path",
      });
    }
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new RequestBodyError({
      subtype: "invalid_body",
      message: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
      hint: "Small payloads: --body '{...}'. Large objects: --config @./payload.json",
    });
  }
}

export type RequestBodySource = "body" | "config" | "none";

export function parseRequestBodyFlags(
  args: readonly string[],
  options: LoadJsonOptions = {}
): { readonly body: unknown; readonly source: RequestBodySource } {
  const bodyIdx = args.indexOf("--body");
  const configIdx = args.indexOf("--config");
  if (bodyIdx >= 0 && configIdx >= 0) {
    throw new RequestBodyError({
      subtype: "body_and_config",
      message: "Use either --body or --config, not both",
      hint: "Prefer --config @file for nested / large objects",
    });
  }
  if (configIdx >= 0) {
    const raw = args[configIdx + 1];
    if (!raw || raw.startsWith("--")) {
      throw new RequestBodyError({
        subtype: "missing_config",
        message: "--config requires @path or inline JSON",
        hint: "alphafox <command> --config @./payload.json",
      });
    }
    return { body: loadJsonArg(raw, options), source: "config" };
  }
  if (bodyIdx >= 0) {
    const raw = args[bodyIdx + 1];
    if (!raw || raw.startsWith("--")) {
      throw new RequestBodyError({
        subtype: "missing_body",
        message: "--body requires JSON or @path",
        hint: "Small payloads: --body '{...}'. Large objects: --config @./payload.json",
      });
    }
    return { body: loadJsonArg(raw, options), source: "body" };
  }
  return { body: undefined, source: "none" };
}
