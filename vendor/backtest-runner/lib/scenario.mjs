export const DEFAULT_EXECUTION_MODEL = Object.freeze({
  pricePath: "ohlc_path_4",
  makerFeeRate: 0.0002,
  takerFeeRate: 0.0005,
  slippageRate: 0.0001,
});

const PRICE_PATHS = new Set(["ohlc_path_4", "close_only"]);

/**
 * Assemble an EngineBacktestScenario from a prepared tape.
 * Does not execute wasm.
 *
 * @param {import("../index.d.ts").AssembleScenarioInput} input
 * @returns {import("../index.d.ts").EngineBacktestScenario}
 */
export function assembleScenario(input) {
  const tape = input?.tape ?? input?.preparedTape?.tape ?? input?.prepared?.tape;
  if (!tape) {
    throw new Error("assembleScenario requires a prepared tape");
  }
  if (typeof input.runId !== "string" || input.runId.trim() === "") {
    throw new Error("assembleScenario requires runId");
  }
  if (
    typeof input.definitionId !== "string" ||
    input.definitionId.trim() === ""
  ) {
    throw new Error("assembleScenario requires definitionId");
  }
  if (!Number.isFinite(input.initialEquity)) {
    throw new Error("assembleScenario requires initialEquity");
  }

  return {
    version: 1,
    runId: input.runId,
    trader: {
      ...(input.traderId ? { id: input.traderId } : {}),
      ...(input.traderName ? { name: input.traderName } : {}),
      strategyDefinitionId: input.definitionId,
      configSchemaVersion: input.configSchemaVersion,
      subscriptionTier: input.subscriptionTier,
      config: structuredClone(input.config),
    },
    exchange: {
      positionSideDual: true,
      initialEquity: input.initialEquity,
    },
    executionModel: resolveExecutionModel(input.executionModel),
    tape,
  };
}

function resolveExecutionModel(override) {
  const merged = {
    pricePath: override?.pricePath ?? DEFAULT_EXECUTION_MODEL.pricePath,
    makerFeeRate: override?.makerFeeRate ?? DEFAULT_EXECUTION_MODEL.makerFeeRate,
    takerFeeRate: override?.takerFeeRate ?? DEFAULT_EXECUTION_MODEL.takerFeeRate,
    slippageRate: override?.slippageRate ?? DEFAULT_EXECUTION_MODEL.slippageRate,
  };
  if (!PRICE_PATHS.has(merged.pricePath)) {
    throw new Error(`Unsupported executionModel.pricePath: ${merged.pricePath}`);
  }
  return merged;
}
