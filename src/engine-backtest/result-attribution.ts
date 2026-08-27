import type {
  EngineBacktestAccountAdjustment,
  EngineBacktestOrder,
  EngineBacktestPosition,
} from "./activity";
import type { EngineBacktestMetrics } from "./types";

export interface EngineBacktestSymbolAttribution {
  readonly symbol: string;
  readonly realizedPnl: number;
  readonly liquidationRealizedPnl: number;
  readonly unrealizedPnl: number;
  readonly feesPaid: number;
  readonly netPnl: number;
  readonly orderCount: number;
  readonly filledOrderCount: number;
  readonly canceledOrderCount: number;
  readonly tradeCount: number;
  readonly winningTrades: number;
  readonly losingTrades: number;
  readonly winRatePct: number;
}

export interface EngineBacktestAttribution {
  readonly symbols: readonly EngineBacktestSymbolAttribution[];
  readonly attributedNetPnl: number;
  readonly accountAdjustmentPnl: number;
  readonly residualPnl: number;
  readonly reconciliationTolerance: number;
  readonly reconciled: boolean;
}

interface MutableSymbolAttribution {
  symbol: string;
  realizedPnl: number;
  liquidationRealizedPnl: number;
  unrealizedPnl: number;
  feesPaid: number;
  orderCount: number;
  filledOrderCount: number;
  canceledOrderCount: number;
  tradeCount: number;
  winningTrades: number;
  losingTrades: number;
}

interface BookPosition {
  quantity: number;
  entryPrice: number;
}

export function attributeEngineBacktestResult(input: {
  readonly result: {
    readonly metrics: Pick<EngineBacktestMetrics, "netPnl">;
    readonly orders: readonly EngineBacktestOrder[];
    readonly openPositions: readonly EngineBacktestPosition[];
    readonly accountAdjustments?: readonly EngineBacktestAccountAdjustment[];
  };
  readonly markets: Readonly<Record<string, unknown>>;
  readonly symbols?: readonly string[];
}): EngineBacktestAttribution {
  const bySymbol = new Map<string, MutableSymbolAttribution>();
  const ensure = (symbol: string): MutableSymbolAttribution => {
    const existing = bySymbol.get(symbol);
    if (existing) return existing;
    const created: MutableSymbolAttribution = {
      symbol,
      realizedPnl: 0,
      liquidationRealizedPnl: 0,
      unrealizedPnl: 0,
      feesPaid: 0,
      orderCount: 0,
      filledOrderCount: 0,
      canceledOrderCount: 0,
      tradeCount: 0,
      winningTrades: 0,
      losingTrades: 0,
    };
    bySymbol.set(symbol, created);
    return created;
  };

  input.symbols?.forEach(ensure);
  const book = new Map<string, BookPosition>();
  const orders = input.result.orders
    .map((order, index) => ({ order, index }))
    .sort((left, right) => {
      const byTimestamp =
        Date.parse(left.order.timestamp) - Date.parse(right.order.timestamp);
      if (byTimestamp !== 0) return byTimestamp;
      return left.index - right.index;
    })
    .map((entry) => entry.order);
  for (const order of orders) {
    const attribution = ensure(order.symbol);
    attribution.orderCount++;
    if (isCanceled(order.status)) {
      attribution.canceledOrderCount++;
      continue;
    }
    if (!(order.filledQuantity > 0)) continue;
    attribution.filledOrderCount++;
    attribution.feesPaid += finiteOrZero(order.fee);
    const reduction = applyFill(
      book,
      order,
      contractSizeFor(input.markets[order.symbol])
    );
    if (reduction === null) continue;
    attribution.tradeCount++;
    attribution.realizedPnl += reduction.realizedPnl;
    if (isLiquidationOrder(order)) {
      attribution.liquidationRealizedPnl += reduction.realizedPnl;
    }
    if (reduction.realizedPnl > 0) attribution.winningTrades++;
    else if (reduction.realizedPnl < 0) attribution.losingTrades++;
  }

  for (const position of input.result.openPositions) {
    ensure(position.symbol).unrealizedPnl += finiteOrZero(position.unrealizedPnl);
  }

  const symbols = [...bySymbol.values()].map((value) => {
    const netPnl = value.realizedPnl + value.unrealizedPnl - value.feesPaid;
    return {
      ...value,
      netPnl,
      winRatePct:
        value.tradeCount > 0
          ? (value.winningTrades / value.tradeCount) * 100
          : 0,
    };
  });
  const attributedNetPnl = symbols.reduce(
    (total, symbol) => total + symbol.netPnl,
    0
  );
  const accountAdjustmentPnl = (input.result.accountAdjustments ?? []).reduce(
    (total, adjustment) => total + finiteOrZero(adjustment.amount),
    0
  );
  const residualPnl =
    input.result.metrics.netPnl - attributedNetPnl - accountAdjustmentPnl;
  const reconciliationTolerance = Math.max(
    0.01,
    Math.abs(input.result.metrics.netPnl) * 1e-6
  );

  return {
    symbols,
    attributedNetPnl,
    accountAdjustmentPnl,
    residualPnl,
    reconciliationTolerance,
    reconciled: Math.abs(residualPnl) <= reconciliationTolerance,
  };
}

function applyFill(
  book: Map<string, BookPosition>,
  order: EngineBacktestOrder,
  contractSize: number
): { readonly realizedPnl: number } | null {
  const side = normalizeOrderSide(order.side);
  if (!side) return null;
  const positionSide = resolveAttributionPositionSide({
    positionSide: order.positionSide,
    reduceOnly: order.reduceOnly,
    side,
  });
  const isReduce =
    order.reduceOnly ||
    (positionSide === "long" && side === "sell") ||
    (positionSide === "short" && side === "buy");
  const key = `${order.symbol}\u0000${positionSide}`;
  const quantity = order.filledQuantity * contractSize;
  const position = book.get(key);

  if (!isReduce) {
    if (!position) {
      book.set(key, { quantity, entryPrice: order.price });
      return null;
    }
    const total = position.quantity + quantity;
    if (total > 0) {
      position.entryPrice =
        (position.entryPrice * position.quantity + order.price * quantity) /
        total;
    }
    position.quantity = total;
    return null;
  }
  if (!position || position.quantity <= 0) return null;

  const closed = Math.min(quantity, position.quantity);
  const realized =
    positionSide === "short"
      ? (position.entryPrice - order.price) * closed
      : (order.price - position.entryPrice) * closed;
  position.quantity -= closed;
  if (position.quantity <= 1e-12) book.delete(key);
  return { realizedPnl: realized };
}

function isLiquidationOrder(order: EngineBacktestOrder): boolean {
  if (order.executionReason === "liquidation") return true;
  return order.message?.trim().toLowerCase() === "liquidation";
}

function resolveAttributionPositionSide(input: {
  readonly positionSide?: string;
  readonly reduceOnly: boolean;
  readonly side: "buy" | "sell";
}): "long" | "short" {
  const explicit = input.positionSide?.trim().toLowerCase();
  if (explicit === "long" || explicit === "short") return explicit;
  if (input.reduceOnly) return input.side === "sell" ? "long" : "short";
  return input.side === "buy" ? "long" : "short";
}

function normalizeOrderSide(value: string): "buy" | "sell" | null {
  const normalized = value.trim().toLowerCase();
  return normalized === "buy" || normalized === "sell" ? normalized : null;
}

function isCanceled(status: string): boolean {
  const normalized = status.toLowerCase();
  return normalized === "canceled" || normalized === "cancelled";
}

function contractSizeFor(market: unknown): number {
  if (!market || typeof market !== "object") return 1;
  const size = (market as { contractSize?: unknown }).contractSize;
  return typeof size === "number" && size > 0 ? size : 1;
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}
