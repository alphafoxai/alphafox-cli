/**
 * Retired from `@alphafoxai/contracts` 2.0.0. Kept as a generate-time
 * safety net if a stale registry still lists them:
 * - Chat product (`chats` / `chats.*`, `chat_summaries` / `chat_summaries.*`)
 * - Web `/api/v1/backtests` jobs (`backtests` / `backtests.*`)
 * - Strategy Plaza publications (`strategy_plaza` / `strategy_plaza.*`)
 * Local Engine WASM (`engine-backtest run`) and `engine_backtest.*` stay.
 * Match `backtests` / `backtests.*` only — never `engine_backtest.*`.
 * Internal maintenance (`internal` / `internal.*`) is not a public facade.
 */
export function isOmittedCatalogOperation(operationId: string): boolean {
  return (
    operationId === "backtests" ||
    operationId.startsWith("backtests.") ||
    operationId === "chats" ||
    operationId.startsWith("chats.") ||
    operationId === "chat_summaries" ||
    operationId.startsWith("chat_summaries.") ||
    operationId === "strategy_plaza" ||
    operationId.startsWith("strategy_plaza.") ||
    operationId === "internal" ||
    operationId.startsWith("internal.")
  );
}
