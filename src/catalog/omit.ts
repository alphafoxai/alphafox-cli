/**
 * Not a CLI surface:
 * - Web `/api/v1/backtests` jobs (`backtests` / `backtests.*`)
 * - Chat product (`chats` / `chats.*`, `chat_summaries` / `chat_summaries.*`)
 * Local Engine WASM (`engine-backtest run`) and `engine_backtest.*` stay.
 * Match `backtests` / `backtests.*` only — never `engine_backtest.*`.
 */
export function isOmittedCatalogOperation(operationId: string): boolean {
  return (
    operationId === "backtests" ||
    operationId.startsWith("backtests.") ||
    operationId === "chats" ||
    operationId.startsWith("chats.") ||
    operationId === "chat_summaries" ||
    operationId.startsWith("chat_summaries.")
  );
}
