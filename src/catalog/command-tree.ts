/**
 * Typed command tree derived from registry operationIds.
 * Shortcuts may only compose operationIds — never a second schema catalog.
 */

import {
  CATALOG_OPERATIONS,
  findCatalogOperation,
  type CatalogOperation,
} from "./operations";

function hyphenToUnderscore(token: string): string {
  return token.replace(/-/g, "_");
}

export function splitCommandTokens(tokens: readonly string[]): {
  readonly commandTokens: string[];
  readonly flagArgs: string[];
  readonly help: boolean;
} {
  const commandTokens: string[] = [];
  const flagArgs: string[] = [];
  let help = false;
  let inFlags = false;
  for (const token of tokens) {
    if (!inFlags && (token === "--help" || token === "-h")) {
      help = true;
      continue;
    }
    if (!inFlags && token.startsWith("--")) {
      inFlags = true;
    }
    if (inFlags) {
      flagArgs.push(token);
    } else {
      commandTokens.push(token);
    }
  }
  return { commandTokens, flagArgs, help };
}

function lookupId(id: string): CatalogOperation | undefined {
  return (
    findCatalogOperation(id) ??
    findCatalogOperation(hyphenToUnderscore(id))
  );
}

export function operationsWithPrefix(prefix: string): CatalogOperation[] {
  const norm = hyphenToUnderscore(prefix);
  return CATALOG_OPERATIONS.filter(
    (op) => op.operationId === norm || op.operationId.startsWith(`${norm}.`)
  );
}

function uniqueSuffixMatch(tokens: readonly string[]): CatalogOperation[] {
  if (tokens.length < 2) return [];
  const domain = hyphenToUnderscore(tokens[0]!);
  const action = hyphenToUnderscore(tokens[tokens.length - 1]!);
  const middle = tokens.slice(1, -1).map(hyphenToUnderscore);
  return CATALOG_OPERATIONS.filter((op) => {
    if (!op.operationId.startsWith(`${domain}.`)) return false;
    if (!op.operationId.endsWith(`.${action}`) && op.operationId !== action) {
      return false;
    }
    for (const part of middle) {
      if (!op.operationId.includes(`.${part}.`) && !op.operationId.includes(`${part}.`)) {
        return false;
      }
    }
    return true;
  });
}

export type TypedResolution =
  | {
      readonly kind: "operation";
      readonly operation: CatalogOperation;
      readonly flagArgs: string[];
      readonly help: boolean;
    }
  | {
      readonly kind: "help";
      readonly prefix: string;
      readonly operations: readonly CatalogOperation[];
      readonly flagArgs: string[];
    }
  | {
      readonly kind: "ambiguous";
      readonly prefix: string;
      readonly candidates: readonly string[];
    }
  | {
      readonly kind: "missing";
      readonly prefix: string;
    };

export function resolveTypedCommand(tokens: readonly string[]): TypedResolution {
  const { commandTokens, flagArgs, help } = splitCommandTokens(tokens);
  if (commandTokens.length === 0) {
    return { kind: "missing", prefix: "" };
  }

  const joined = commandTokens.join(".");
  const exact = lookupId(joined);
  if (exact) {
    return { kind: "operation", operation: exact, flagArgs, help };
  }

  const suffixHits = uniqueSuffixMatch(commandTokens);
  if (suffixHits.length === 1) {
    return {
      kind: "operation",
      operation: suffixHits[0]!,
      flagArgs,
      help,
    };
  }
  if (suffixHits.length > 1) {
    return {
      kind: "ambiguous",
      prefix: joined,
      candidates: suffixHits.map((op) => op.operationId),
    };
  }

  const prefixOps = operationsWithPrefix(joined);
  if (prefixOps.length > 0) {
    return {
      kind: "help",
      prefix: hyphenToUnderscore(joined),
      operations: prefixOps,
      flagArgs,
    };
  }

  return { kind: "missing", prefix: joined };
}

export function typedCommandExample(op: CatalogOperation): {
  readonly typed: string;
  readonly api: string;
} {
  const segments = op.operationId.split(".");
  const schemaNames =
    op.path.match(/\{([a-zA-Z0-9_]+)\}/g)?.map((s) => s.slice(1, -1)) ?? [];
  const pathFlags = schemaNames.map((name) => `--${name} <${name}>`).join(" ");
  const riskFlag =
    op.risk === "high-risk-write" || op.risk === "unknown" ? " --yes" : "";
  const bodyFlag =
    op.method !== "GET" && op.method !== "HEAD" && op.method !== "DELETE"
      ? " --body '{}'"
      : "";
  const typedFlags = [pathFlags, bodyFlag.trim(), riskFlag.trim()]
    .filter(Boolean)
    .join(" ");
  return {
    typed: `alphafox ${segments.join(" ")}${typedFlags ? ` ${typedFlags}` : ""}`,
    api: `alphafox api ${op.method} ${op.path}${bodyFlag}${riskFlag}`,
  };
}
