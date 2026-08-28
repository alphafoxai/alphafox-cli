import { projectDcaFirstOrderAmountForLegacyRuntime } from "./dca-first-order-amount-compat";

/**
 * Web create / backtest forms seed `common.execution.leverage` to 10
 * (`applyInitialUiDefaults` in alphafox-web). Engine runtime treats a
 * missing or non-positive leverage as 1x, so CLI runs that omit the
 * field used to size positions at 1x while the website ran 10x.
 */
export const WEB_UI_DEFAULT_LEVERAGE = 10;

export function applyWebUiConfigDefaults(config: unknown): unknown {
  const record = asRecord(config);
  if (!record) {
    return config;
  }
  const common = asRecord(record.common) ?? {};
  const execution = asRecord(common.execution) ?? {};
  if (hasPositiveLeverage(execution.leverage)) {
    return config;
  }
  return {
    ...record,
    common: {
      ...common,
      execution: {
        ...execution,
        leverage: WEB_UI_DEFAULT_LEVERAGE,
      },
    },
  };
}

/** Web UI defaults first, then DCA first-order aliases for older wasm. */
export function prepareEngineBacktestConfig(config: unknown): unknown {
  return projectDcaFirstOrderAmountForLegacyRuntime(
    applyWebUiConfigDefaults(config)
  );
}

function hasPositiveLeverage(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
