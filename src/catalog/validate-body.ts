import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020";

import type { ErrorBody } from "../envelope";
import { getOperationSchemaDocument } from "./operations";

const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
  validateSchema: false,
});

const compiled = new Map<string, ValidateFunction>();

export function isWriteMethod(method: string): boolean {
  const verb = method.toUpperCase();
  return verb !== "GET" && verb !== "HEAD";
}

export function isEmptyObject(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value as object).length === 0
  );
}

export type BodyValidationResult =
  | { readonly ok: true; readonly body: unknown }
  | { readonly ok: false; readonly error: ErrorBody };

export function validateCatalogWriteBody(input: {
  readonly method: string;
  readonly operationId?: string;
  readonly body: unknown;
}): BodyValidationResult {
  if (!isWriteMethod(input.method)) {
    return { ok: true, body: input.body };
  }

  const payload = input.body === undefined ? {} : input.body;
  const operationId = input.operationId;

  if (!operationId) {
    if (payload === undefined || isEmptyObject(payload)) {
      return { ok: true, body: payload };
    }
    return {
      ok: false,
      error: {
        type: "usage",
        subtype: "body_schema_missing",
        message:
          "Uncataloged write cannot send a non-empty body. Find the operationId first.",
        hint: "Run alphafox catalog / alphafox schema <operationId>, then resend only documented fields.",
      },
    };
  }

  const doc = getOperationSchemaDocument(operationId);
  const schema = doc?.request.body ?? null;
  if (!schema) {
    if (payload === undefined || isEmptyObject(payload)) {
      return { ok: true, body: payload };
    }
    return {
      ok: false,
      error: {
        type: "usage",
        subtype: "body_schema_missing",
        message: `Operation ${operationId} has no catalog request body; do not invent fields.`,
        hint: `Run alphafox schema ${operationId}. Omit --body/--config or send {}.`,
      },
    };
  }

  const validate = compileBodySchema(operationId, schema);
  const ok = validate(payload);
  if (ok) {
    return { ok: true, body: payload };
  }
  return {
    ok: false,
    error: {
      type: "usage",
      subtype: "body_schema",
      message: `Request body does not match catalog schema for ${operationId}`,
      hint: `Run alphafox schema ${operationId} and resend only documented fields via --body or --config @file.`,
      details: {
        operationId,
        errors: formatAjvErrors(validate.errors ?? []),
      },
    },
  };
}

function compileBodySchema(
  operationId: string,
  schema: Record<string, unknown>
): ValidateFunction {
  const cached = compiled.get(operationId);
  if (cached) return cached;
  const validate = ajv.compile(schema);
  compiled.set(operationId, validate);
  return validate;
}

export function formatAjvErrors(
  errors: readonly ErrorObject[]
): readonly {
  readonly instancePath: string;
  readonly keyword: string;
  readonly message: string;
  readonly params: Record<string, unknown>;
}[] {
  return errors.map((err) => ({
    instancePath: err.instancePath,
    keyword: err.keyword,
    message: err.message ?? "invalid",
    params: (err.params ?? {}) as Record<string, unknown>,
  }));
}
