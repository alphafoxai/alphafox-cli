/**
 * CLI capability catalog generated from `@alphafoxai/contracts/public-api`.
 * Do not hand-edit generated JSON; run `node scripts/generate-catalog.mjs`.
 */

import type { CompatibilityRange } from "./compatibility";
import { checkCliCompatibility } from "./compatibility";
import registryJson from "./generated/registry.json";
import schemasJson from "./generated/schemas.json";
import { isOmittedCatalogOperation } from "./omit";

export interface CatalogOperation {
  readonly operationId: string;
  readonly method: string;
  readonly path: string;
  readonly role: string;
  readonly risk: "read" | "write" | "high-risk-write" | string;
  readonly scopes: readonly string[];
  readonly auth?: string;
  readonly stream?: boolean;
  readonly file?: boolean;
  readonly pagination?: boolean;
  readonly idempotent?: boolean;
  readonly catchAll?: boolean;
  readonly mvp?: boolean;
  readonly contractStatus?: string;
  readonly requestBodySchema?: string | null;
  readonly querySchema?: string | null;
  readonly responseSchema?: string;
  readonly errorSchema?: string;
  readonly description?: string;
}

export interface CatalogSource {
  readonly package: string;
  readonly export: string;
  readonly contractsSha: string;
  readonly registryVersion: string;
  readonly contractVersion: string;
  readonly scannedAt: string;
  readonly totalOperations: number;
  readonly cliOperations: number;
}

export interface OperationSchemaDocument {
  readonly operationId: string;
  readonly method: string;
  readonly path: string;
  readonly role: string;
  readonly risk: string;
  readonly auth: string;
  readonly scopes: readonly string[];
  readonly idempotent: boolean;
  readonly pagination: boolean;
  readonly stream: boolean;
  readonly file: boolean;
  readonly contractStatus: string;
  readonly webZodContract: string;
  readonly sharedContractRef: string;
  readonly compatibility: CompatibilityRange;
  readonly request: {
    readonly contentType: string | null;
    readonly path: Record<string, unknown>;
    readonly query: Record<string, unknown> | null;
    readonly body: Record<string, unknown> | null;
    readonly pathParamNames: readonly string[];
  };
  readonly response: {
    readonly contentType: string;
    readonly success: Record<string, unknown>;
  };
  readonly error: {
    readonly contentType: "application/problem+json" | string;
    readonly schema: Record<string, unknown>;
  };
}

const generated = registryJson as {
  readonly source: CatalogSource;
  readonly compatibility: CompatibilityRange;
  readonly operations: readonly CatalogOperation[];
};

const generatedSchemas = schemasJson as Record<string, OperationSchemaDocument>;

export const CATALOG_SOURCE: CatalogSource = generated.source;
export const CATALOG_VERSION = generated.compatibility.contractVersion;
export const CATALOG_OPERATIONS: readonly CatalogOperation[] =
  generated.operations.filter(
    (op) => !isOmittedCatalogOperation(op.operationId)
  );
export const COMPATIBILITY_RANGE: CompatibilityRange = generated.compatibility;

export function getCompatibilityRange(): CompatibilityRange {
  return COMPATIBILITY_RANGE;
}

export function findCatalogOperation(
  operationId: string
): CatalogOperation | undefined {
  return CATALOG_OPERATIONS.find((op) => op.operationId === operationId);
}

export function findCatalogOperationByRoute(
  method: string,
  path: string
): CatalogOperation | undefined {
  const verb = method.toUpperCase();
  return CATALOG_OPERATIONS.find(
    (op) =>
      op.method.toUpperCase() === verb &&
      pathTemplateMatchesOp(op.path, path, Boolean(op.catchAll))
  );
}

function pathTemplateMatchesOp(
  template: string,
  actual: string,
  catchAll: boolean
): boolean {
  const t = template.split("/").filter(Boolean);
  const a = actual.split("/").filter(Boolean);
  if (catchAll) {
    if (a.length < t.length) return false;
    for (let i = 0; i < t.length; i += 1) {
      const seg = t[i]!;
      if (seg.startsWith("{") && seg.endsWith("}")) continue;
      if (seg !== a[i]) return false;
    }
    return true;
  }
  if (t.length !== a.length) return false;
  for (let i = 0; i < t.length; i += 1) {
    const seg = t[i]!;
    if (seg.startsWith("{") && seg.endsWith("}")) continue;
    if (seg !== a[i]) return false;
  }
  return true;
}

export function getOperationSchemaDocument(
  operationId: string
): OperationSchemaDocument | undefined {
  if (isOmittedCatalogOperation(operationId)) return undefined;
  return generatedSchemas[operationId];
}

export function extractPathParamNames(template: string): string[] {
  const names: string[] = [];
  const re = /\{([^}]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(template))) {
    names.push(m[1]!);
  }
  return names;
}

export function buildCapabilityManifest() {
  return {
    contractVersion: COMPATIBILITY_RANGE.contractVersion,
    registryVersion: COMPATIBILITY_RANGE.registryVersion,
    minCliVersion: COMPATIBILITY_RANGE.minCliVersion,
    maxCliVersion: COMPATIBILITY_RANGE.maxCliVersion,
    openapi: COMPATIBILITY_RANGE.openapi,
    source: CATALOG_SOURCE,
    operations: CATALOG_OPERATIONS.map((op) => ({
      operationId: op.operationId,
      method: op.method,
      path: op.path,
      role: op.role,
      risk: op.risk,
      auth: op.auth ?? "bearer",
      scopes: op.scopes,
      stream: Boolean(op.stream),
      file: Boolean(op.file),
      pagination: Boolean(op.pagination),
      idempotent: Boolean(op.idempotent),
      mvp: Boolean(op.mvp),
      contractStatus: op.contractStatus ?? "envelope",
      requestBodySchema: op.requestBodySchema ?? null,
      querySchema: op.querySchema ?? null,
      responseSchema: op.responseSchema ?? "JsonValue",
      errorSchema: op.errorSchema ?? "ProblemDetails",
    })),
  };
}

/** Resolve path templates like /api/v1/engine-backtest/experiments/{experimentId}. */
export function resolveOperationPath(
  template: string,
  params: Record<string, string>
): string {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key: string) => {
    const value = params[key];
    if (!value) {
      throw new Error(`Missing path parameter: ${key}`);
    }
    return encodeURIComponent(value);
  });
}

export function checkGeneratedCatalogCompatibility(cliVersion: string) {
  return checkCliCompatibility(
    {
      cliVersion,
      contractVersion: COMPATIBILITY_RANGE.contractVersion,
    },
    COMPATIBILITY_RANGE
  );
}
