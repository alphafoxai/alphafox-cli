import { randomUUID } from "node:crypto";

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
  } = {}
): void {
  const envelope = successEnvelope(data, options.meta, options.requestId);
  if (options.format === "text" && data && typeof data === "object") {
    process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(envelope)}\n`);
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
