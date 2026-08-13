import { randomUUID } from "node:crypto";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";

export type ExitCode =
  | 0
  | 1
  | 2
  | 3
  | 4
  | 10
  | 64
  | 65
  | 66
  | 69
  | 70
  | 75
  | 77
  | 78;

export interface SuccessEnvelope<T = unknown> {
  readonly ok: true;
  readonly data: T;
  readonly meta?: Record<string, unknown>;
  readonly requestId?: string;
}

export interface ErrorBody {
  readonly type: string;
  readonly subtype?: string;
  readonly code?: string | number;
  readonly message: string;
  readonly hint?: string;
  readonly status?: number;
  readonly risk?: string;
  readonly action?: string;
  readonly details?: unknown;
}

export interface ErrorEnvelope {
  readonly ok: false;
  readonly error: ErrorBody;
  readonly requestId?: string;
}

export function newRequestId(): string {
  return randomUUID();
}

export function successEnvelope<T>(
  data: T,
  meta?: Record<string, unknown>,
  requestId?: string
): SuccessEnvelope<T> {
  return {
    ok: true,
    data,
    ...(meta ? { meta } : {}),
    ...(requestId ? { requestId } : {}),
  };
}

export function errorEnvelope(
  error: ErrorBody,
  requestId?: string
): ErrorEnvelope {
  return {
    ok: false,
    error,
    ...(requestId ? { requestId } : {}),
  };
}

export function writeSuccess(
  data: unknown,
  options: {
    readonly meta?: Record<string, unknown>;
    readonly requestId?: string;
    readonly format?: "json" | "jsonl" | "text";
    readonly jq?: string;
  } = {}
): void {
  const envelope = successEnvelope(data, options.meta, options.requestId);
  const rendered =
    options.format === "text" && data && typeof data === "object"
      ? `${JSON.stringify(envelope, null, 2)}\n`
      : `${JSON.stringify(envelope)}\n`;
  if (options.jq?.trim()) {
    const filtered = applyJqFilter(envelope, options.jq.trim());
    process.stdout.write(filtered.endsWith("\n") ? filtered : `${filtered}\n`);
    return;
  }
  process.stdout.write(rendered);
}

export function applyJqFilter(
  value: unknown,
  filter: string,
  spawn: typeof spawnSync = spawnSync
): string {
  if (!filter.trim()) {
    throw Object.assign(new Error("--jq filter must be non-empty"), {
      type: "usage",
      subtype: "jq_empty",
      status: 64,
    });
  }
  const result: SpawnSyncReturns<string> = spawn(
    process.env.ALPHAFOX_JQ?.trim() || "jq",
    ["-c", filter],
    {
      input: JSON.stringify(value),
      encoding: "utf8",
      timeout: 10_000,
    }
  );
  if (result.error) {
    const code = (result.error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw Object.assign(
        new Error(
          "jq is not installed; --jq requires the jq binary on PATH"
        ),
        { type: "usage", subtype: "jq_not_installed", status: 64 }
      );
    }
    throw Object.assign(new Error(result.error.message), {
      type: "usage",
      subtype: "jq_failed",
      status: 64,
    });
  }
  if (result.status !== 0) {
    const errText = (result.stderr || "jq filter failed").trim();
    throw Object.assign(new Error(errText), {
      type: "usage",
      subtype: "jq_failed",
      status: 64,
    });
  }
  return result.stdout;
}

export function writeError(
  error: ErrorBody,
  options: {
    readonly requestId?: string;
    readonly exitCode?: number;
  } = {}
): never {
  const envelope = errorEnvelope(error, options.requestId);
  process.stderr.write(`${JSON.stringify(envelope)}\n`);
  process.exit(options.exitCode ?? mapErrorToExitCode(error));
}

export function mapErrorToExitCode(error: ErrorBody): number {
  if (error.type === "confirmation") {
    return 10;
  }
  if (error.status === 401) {
    return 77;
  }
  if (error.status === 403) {
    return 77;
  }
  if (error.status === 404) {
    return 66;
  }
  if (error.status === 409) {
    return 75;
  }
  if (error.status === 422 || error.status === 400) {
    return 64;
  }
  if (error.status === 429) {
    return 75;
  }
  if (error.status && error.status >= 500) {
    return 69;
  }
  if (error.type === "usage") {
    return 64;
  }
  return 1;
}

export function parseJsonEnvelope(text: string): SuccessEnvelope | ErrorEnvelope {
  const parsed = JSON.parse(text) as SuccessEnvelope | ErrorEnvelope;
  if (typeof parsed !== "object" || parsed === null || !("ok" in parsed)) {
    throw new Error("Invalid envelope: missing ok field");
  }
  return parsed;
}
