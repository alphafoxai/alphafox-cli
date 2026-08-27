import { EngineBacktestError } from "./errors";
import type {
  BacktestClientLike,
  EngineBacktestResult,
  EngineBacktestTapeInput,
  EnginePreparedTape,
} from "./types";

/** Matches Web `DEFAULT_TAPE_SERIES_CONCURRENCY`. */
export const ENGINE_BACKTEST_TAPE_SERIES_CONCURRENCY = 8;

const PREPARED_TAPE_METHODS = [
  "prepareTape",
  "runPreparedBacktest",
  "runPreparedBacktestBatch",
  "releaseTape",
] as const;

const PREPARED_TAPE_ERROR_CODES = new Set([
  "prepared_tape_not_found",
  "prepared_tape_mismatch",
]);

export function cloneTapeBuffers(
  sourceBuffers: Readonly<Record<string, ArrayBuffer>>
): Record<string, ArrayBuffer> {
  return Object.fromEntries(
    Object.entries(sourceBuffers).map(([key, buffer]) => [key, buffer.slice(0)])
  );
}

export function requirePreparedTapeClient(client: BacktestClientLike): void {
  for (const name of PREPARED_TAPE_METHODS) {
    if (typeof client[name] !== "function") {
      throw new EngineBacktestError({
        type: "runtime",
        subtype: "prepared_tape_unavailable",
        message: `Backtest runtime is missing ${name}; one-shot runBacktest is not used.`,
        hint: "Use an Engine WASM host that exports prepareTape, runPreparedBacktest, runPreparedBacktestBatch, and releaseTape.",
        details: { missing: name },
      });
    }
  }
}

export async function prepareWorkerTape(
  client: BacktestClientLike,
  tape: EngineBacktestTapeInput,
  buffers: Readonly<Record<string, ArrayBuffer>>
): Promise<EnginePreparedTape> {
  requirePreparedTapeClient(client);
  const prepared = await client.prepareTape(tape, cloneTapeBuffers(buffers));
  const failure = preparedTapeFailure(prepared);
  if (failure) {
    throw preparedTapeError(failure.code, failure.message, prepared);
  }
  if (
    !prepared ||
    typeof prepared.handle !== "string" ||
    prepared.handle.trim() === ""
  ) {
    throw new EngineBacktestError({
      type: "runtime",
      subtype: "prepared_tape_unavailable",
      message: "prepareTape did not return a worker-local handle.",
    });
  }
  return prepared;
}

export async function releaseWorkerTape(
  client: BacktestClientLike,
  handle: string | undefined
): Promise<void> {
  if (!handle) return;
  try {
    await client.releaseTape(handle);
  } catch (error) {
    if (preparedTapeCodeFromUnknown(error) === "prepared_tape_not_found") {
      return;
    }
    throw mapPreparedTapeError(error);
  }
}

export function requireCompletedPreparedRun(
  result: EngineBacktestResult
): EngineBacktestResult {
  throwIfPreparedTapeErrors(result.errors, result);
  if (result.status === "failed") {
    throw new EngineBacktestError({
      type: "runtime",
      subtype: "backtest_failed",
      message: "runPreparedBacktest returned status=failed",
      details: { errors: result.errors, runId: result.runId },
    });
  }
  return result;
}

export function throwIfPreparedTapeErrors(
  errors: EngineBacktestResult["errors"] | undefined,
  details?: unknown
): void {
  const failure = preparedTapeFailure({ errors });
  if (!failure) return;
  throw preparedTapeError(failure.code, failure.message, details);
}

export function mapPreparedTapeError(error: unknown): never {
  if (error instanceof EngineBacktestError) throw error;
  const code = preparedTapeCodeFromUnknown(error);
  if (code) {
    throw preparedTapeError(
      code,
      error instanceof Error ? error.message : String(error),
      error
    );
  }
  throw error;
}

function preparedTapeFailure(value: unknown): {
  readonly code: string;
  readonly message: string;
} | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as {
    status?: unknown;
    errors?: Array<{ code?: string; message?: string }>;
  };
  const code = preparedTapeCodeFromErrors(record.errors);
  if (!code) return undefined;
  return {
    code,
    message: record.errors?.[0]?.message?.trim() || code,
  };
}

function preparedTapeCodeFromErrors(
  errors: Array<{ code?: string }> | undefined
): string | undefined {
  const code = errors?.[0]?.code;
  return typeof code === "string" && PREPARED_TAPE_ERROR_CODES.has(code)
    ? code
    : undefined;
}

function preparedTapeCodeFromUnknown(error: unknown): string | undefined {
  if (error instanceof EngineBacktestError && error.subtype) {
    return PREPARED_TAPE_ERROR_CODES.has(error.subtype)
      ? error.subtype
      : undefined;
  }
  const message = error instanceof Error ? error.message : String(error);
  for (const code of PREPARED_TAPE_ERROR_CODES) {
    if (message.includes(code)) return code;
  }
  return undefined;
}

function preparedTapeError(
  code: string,
  message: string,
  details?: unknown
): EngineBacktestError {
  return new EngineBacktestError({
    type: "runtime",
    subtype: code,
    message,
    details,
  });
}
