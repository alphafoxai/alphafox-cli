export class EngineBacktestError extends Error {
  readonly type: string;
  readonly subtype?: string;
  readonly status?: number;
  readonly code?: string | number;
  readonly hint?: string;
  readonly details?: unknown;

  constructor(input: {
    readonly message: string;
    readonly type?: string;
    readonly subtype?: string;
    readonly status?: number;
    readonly code?: string | number;
    readonly hint?: string;
    readonly details?: unknown;
  }) {
    super(input.message);
    this.name = "EngineBacktestError";
    this.type = input.type ?? "runtime";
    this.subtype = input.subtype;
    this.status = input.status;
    this.code = input.code;
    this.hint = input.hint;
    this.details = input.details;
  }
}

export function isEngineBacktestError(
  value: unknown
): value is EngineBacktestError {
  return value instanceof EngineBacktestError;
}
