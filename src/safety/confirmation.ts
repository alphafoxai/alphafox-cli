export type RiskLevel = "read" | "write" | "high-risk-write" | "unknown";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export interface ConfirmationGateResult {
  readonly allowed: boolean;
  readonly error?: {
    readonly type: "confirmation";
    readonly subtype: "confirmation_required";
    readonly message: string;
    readonly hint: string;
    readonly risk: "high-risk-write";
    readonly action: string;
  };
}

/**
 * Infer risk for raw `api METHOD PATH` calls.
 * Catalog-matched risks win; uncataloged mutations are treated as high-risk
 * so they cannot skip the `--yes` gate.
 */
export function inferRawApiRisk(
  method: string,
  catalogRisk: string | undefined
): RiskLevel | string {
  if (catalogRisk) {
    return catalogRisk;
  }
  if (MUTATING_METHODS.has(method.toUpperCase())) {
    return "unknown";
  }
  return "read";
}

export function requiresHighRiskConfirmation(
  risk: RiskLevel | string
): boolean {
  return risk === "high-risk-write" || risk === "unknown";
}

/**
 * High-risk writes (and uncataloged/unknown mutations) require explicit --yes.
 * Server still enforces scopes/roles; this is CLI UX only.
 */
export function assertHighRiskConfirmation(input: {
  readonly risk: RiskLevel | string;
  readonly yes: boolean;
  readonly action: string;
  readonly dryRun?: boolean;
}): ConfirmationGateResult {
  if (!requiresHighRiskConfirmation(input.risk)) {
    return { allowed: true };
  }
  if (input.dryRun) {
    return { allowed: true };
  }
  if (input.yes) {
    return { allowed: true };
  }
  return {
    allowed: false,
    error: {
      type: "confirmation",
      subtype: "confirmation_required",
      message: `${input.action} requires confirmation`,
      hint: "add --yes to confirm",
      risk: "high-risk-write",
      action: input.action,
    },
  };
}
