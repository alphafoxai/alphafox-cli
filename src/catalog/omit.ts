/**
 * Chat-attached `/api/v1/backtests` jobs are not a CLI surface.
 * Local Engine WASM (`engine-backtest run`) and `engine_backtest.*` stay.
 * Match `backtests` / `backtests.*` only — never `engine_backtest.*`.
 */
export function isOmittedCatalogOperation(operationId: string): boolean {
  return operationId === "backtests" || operationId.startsWith("backtests.");
}
