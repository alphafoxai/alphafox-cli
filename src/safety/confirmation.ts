export type RiskLevel = "read" | "write" | "high-risk-write";

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
 * High-risk writes require explicit --yes (or equivalent confirmation token).
 * Server still enforces scopes/roles; this is CLI UX only.
 */
export function assertHighRiskConfirmation(input: {
  readonly risk: RiskLevel | string;
  readonly yes: boolean;
  readonly action: string;
  readonly dryRun?: boolean;
}): ConfirmationGateResult {
  if (input.risk !== "high-risk-write") {
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
