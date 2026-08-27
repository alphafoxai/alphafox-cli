const DECISION_LOGIC_KEYS = [
  "decisionLogic",
  "longDecisionLogic",
  "shortDecisionLogic",
] as const;

const FIRST_ORDER_AMOUNT_TYPE_FIXED = "fixedAmount";

/**
 * WASM runtimes older than the firstOrderAmount rename still size DCA
 * entries from initialMarginPercent / fixedInitialNotional and default to
 * 2% when those keys are missing. Mirror the active mode onto the legacy
 * keys so both runtimes honor the user's first-order size.
 */
export function projectDcaFirstOrderAmountForLegacyRuntime(
  config: unknown
): unknown {
  const record = asRecord(config);
  if (!record) {
    return config;
  }
  const strategy = asRecord(record.strategy);
  if (!strategy) {
    return config;
  }

  let changed = false;
  const nextStrategy: Record<string, unknown> = { ...strategy };
  for (const key of DECISION_LOGIC_KEYS) {
    const logic = asRecord(strategy[key]);
    const params = logic ? asRecord(logic.params) : null;
    if (!logic || !params) {
      continue;
    }
    const projected = projectDecisionLogicParams(params);
    if (projected === params) {
      continue;
    }
    nextStrategy[key] = { ...logic, params: projected };
    changed = true;
  }
  if (!changed) {
    return config;
  }
  return { ...record, strategy: nextStrategy };
}

function projectDecisionLogicParams(
  params: Record<string, unknown>
): Record<string, unknown> {
  const amount = toFiniteNumber(params.firstOrderAmount);
  if (amount === undefined || amount <= 0) {
    return params;
  }

  const isFixed = params.firstOrderAmountType === FIRST_ORDER_AMOUNT_TYPE_FIXED;
  const next: Record<string, unknown> = { ...params };
  if (isFixed) {
    next.fixedInitialNotional = amount;
    delete next.initialMarginPercent;
  } else {
    next.initialMarginPercent = amount;
    delete next.fixedInitialNotional;
  }
  return next;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}
