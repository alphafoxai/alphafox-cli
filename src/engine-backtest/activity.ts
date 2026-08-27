import { EngineBacktestError } from "./errors";
import type { EngineBacktestAttribution } from "./result-attribution";

export const ENGINE_BACKTEST_ACTIVITY_SCHEMA_VERSION = 1 as const;
export const ENGINE_BACKTEST_ACTIVITY_MAX_UTF8_BYTES = 1024 * 1024;
export const ENGINE_BACKTEST_ACTIVITY_MAX_FILLED_ORDERS = 2_000;

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

export interface EngineBacktestOrder {
  readonly clientOrderId: string;
  readonly orderId: string;
  readonly symbol: string;
  readonly side: string;
  readonly positionSide?: string;
  readonly type: string;
  readonly status: string;
  readonly reduceOnly: boolean;
  readonly price: number;
  readonly contractAmount: number;
  readonly filledQuantity: number;
  readonly fee: number;
  readonly timestamp: string;
  readonly message?: string;
  readonly executionReason?: "liquidation";
}

export interface EngineBacktestPosition {
  readonly symbol: string;
  readonly side: string;
  readonly contracts: number;
  readonly entryPrice: number;
  readonly markPrice: number;
  readonly unrealizedPnl: number;
  readonly leverage: number;
}

export interface EngineBacktestAccountAdjustment {
  readonly type: string;
  readonly amount: number;
  readonly timestamp: string;
}

export interface EngineBacktestActivity {
  readonly schemaVersion: 1;
  readonly attribution: EngineBacktestAttribution;
  readonly openPositions: readonly EngineBacktestPosition[];
  readonly accountAdjustments: readonly EngineBacktestAccountAdjustment[];
  readonly filledOrders: readonly EngineBacktestOrder[];
  readonly filledOrderTotal: number;
  readonly truncated: boolean;
}

export function readActivityOrders(value: unknown): EngineBacktestOrder[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw invalidActivityField("orders", "must be an array");
  }
  return value.map((item, index) => readOrder(item, index));
}

export function readActivityPositions(value: unknown): EngineBacktestPosition[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw invalidActivityField("openPositions", "must be an array");
  }
  return value.map((item, index) => readPosition(item, index));
}

export function readActivityAdjustments(
  value: unknown
): EngineBacktestAccountAdjustment[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw invalidActivityField("accountAdjustments", "must be an array");
  }
  return value.map((item, index) => readAdjustment(item, index));
}

export function selectFilledOrderTail(
  orders: readonly EngineBacktestOrder[],
  limit = ENGINE_BACKTEST_ACTIVITY_MAX_FILLED_ORDERS
): {
  readonly filledOrders: EngineBacktestOrder[];
  readonly filledOrderTotal: number;
  readonly truncated: boolean;
} {
  const filled = orders
    .map((order, index) => ({ order, index }))
    .filter((entry) => entry.order.filledQuantity > 0)
    .sort((left, right) => {
      const byTimestamp =
        Date.parse(left.order.timestamp) - Date.parse(right.order.timestamp);
      if (byTimestamp !== 0) return byTimestamp;
      return left.index - right.index;
    })
    .map((entry) => entry.order);
  const filledOrderTotal = filled.length;
  const truncated = filledOrderTotal > limit;
  return {
    filledOrders: truncated ? filled.slice(-limit) : [...filled],
    filledOrderTotal,
    truncated,
  };
}

export function buildEngineBacktestActivityFromCompleted(input: {
  readonly attribution: EngineBacktestAttribution;
  readonly orders: readonly EngineBacktestOrder[];
  readonly openPositions: readonly EngineBacktestPosition[];
  readonly accountAdjustments?: readonly EngineBacktestAccountAdjustment[];
  readonly maxFilledOrders?: number;
}): EngineBacktestActivity {
  const countCap =
    input.maxFilledOrders ?? ENGINE_BACKTEST_ACTIVITY_MAX_FILLED_ORDERS;
  const tail = selectFilledOrderTail(input.orders, countCap);
  return fitActivityToUtf8Budget({
    schemaVersion: ENGINE_BACKTEST_ACTIVITY_SCHEMA_VERSION,
    attribution: {
      ...input.attribution,
      symbols: [...input.attribution.symbols],
    },
    openPositions: [...input.openPositions],
    accountAdjustments: [...(input.accountAdjustments ?? [])],
    filledOrders: tail.filledOrders.map(toPersistedFilledOrder),
    filledOrderTotal: tail.filledOrderTotal,
    truncated: tail.truncated,
  });
}

function fitActivityToUtf8Budget(
  activity: EngineBacktestActivity
): EngineBacktestActivity {
  if (activityUtf8ByteLength(activity) <= ENGINE_BACKTEST_ACTIVITY_MAX_UTF8_BYTES) {
    return activity;
  }
  let low = 0;
  let high = activity.filledOrders.length;
  let fitted = withFilledOrderTail(activity, 0);
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = withFilledOrderTail(activity, mid);
    if (
      activityUtf8ByteLength(candidate) <= ENGINE_BACKTEST_ACTIVITY_MAX_UTF8_BYTES
    ) {
      fitted = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  if (activityUtf8ByteLength(fitted) > ENGINE_BACKTEST_ACTIVITY_MAX_UTF8_BYTES) {
    throw new EngineBacktestError({
      type: "runtime",
      subtype: "activity_too_large",
      message: `Activity exceeds ${ENGINE_BACKTEST_ACTIVITY_MAX_UTF8_BYTES} UTF-8 bytes.`,
    });
  }
  return fitted;
}

function withFilledOrderTail(
  activity: EngineBacktestActivity,
  keepCount: number
): EngineBacktestActivity {
  const filledOrders =
    keepCount <= 0 ? [] : activity.filledOrders.slice(-keepCount);
  return {
    ...activity,
    filledOrders,
    truncated: activity.filledOrderTotal > filledOrders.length,
  };
}

function activityUtf8ByteLength(activity: EngineBacktestActivity): number {
  return utf8ByteLength(JSON.stringify(activity));
}

function toPersistedFilledOrder(
  order: EngineBacktestOrder
): EngineBacktestOrder {
  return {
    clientOrderId: order.clientOrderId,
    orderId: order.orderId,
    symbol: order.symbol,
    side: order.side,
    ...(order.positionSide ? { positionSide: order.positionSide } : {}),
    type: order.type,
    status: order.status,
    reduceOnly: order.reduceOnly,
    price: order.price,
    contractAmount: order.contractAmount,
    filledQuantity: order.filledQuantity,
    fee: order.fee,
    timestamp: order.timestamp,
    ...(order.message?.trim() ? { message: order.message } : {}),
    ...(order.executionReason === "liquidation"
      ? { executionReason: "liquidation" as const }
      : {}),
  };
}

function readOrder(value: unknown, index: number): EngineBacktestOrder {
  const record = asRecord(value, `orders[${index}]`);
  const executionReason = optionalString(record.executionReason);
  return {
    clientOrderId: requiredString(record.clientOrderId, `orders[${index}].clientOrderId`),
    orderId: requiredString(record.orderId, `orders[${index}].orderId`),
    symbol: requiredString(record.symbol, `orders[${index}].symbol`),
    side: requiredString(record.side, `orders[${index}].side`),
    ...(optionalString(record.positionSide)
      ? { positionSide: optionalString(record.positionSide) }
      : {}),
    type: requiredString(record.type, `orders[${index}].type`),
    status: requiredString(record.status, `orders[${index}].status`),
    reduceOnly: requiredBoolean(record.reduceOnly, `orders[${index}].reduceOnly`),
    price: requiredFinite(record.price, `orders[${index}].price`),
    contractAmount: requiredFinite(
      record.contractAmount,
      `orders[${index}].contractAmount`
    ),
    filledQuantity: requiredFinite(
      record.filledQuantity,
      `orders[${index}].filledQuantity`
    ),
    fee: requiredFinite(record.fee, `orders[${index}].fee`),
    timestamp: requiredString(record.timestamp, `orders[${index}].timestamp`),
    ...(optionalString(record.message)
      ? { message: optionalString(record.message) }
      : {}),
    ...(executionReason === "liquidation"
      ? { executionReason: "liquidation" as const }
      : {}),
  };
}

function readPosition(value: unknown, index: number): EngineBacktestPosition {
  const record = asRecord(value, `openPositions[${index}]`);
  return {
    symbol: requiredString(record.symbol, `openPositions[${index}].symbol`),
    side: requiredString(record.side, `openPositions[${index}].side`),
    contracts: requiredFinite(
      record.contracts,
      `openPositions[${index}].contracts`
    ),
    entryPrice: requiredFinite(
      record.entryPrice,
      `openPositions[${index}].entryPrice`
    ),
    markPrice: requiredFinite(
      record.markPrice,
      `openPositions[${index}].markPrice`
    ),
    unrealizedPnl: requiredFinite(
      record.unrealizedPnl,
      `openPositions[${index}].unrealizedPnl`
    ),
    leverage: requiredFinite(record.leverage, `openPositions[${index}].leverage`),
  };
}

function readAdjustment(
  value: unknown,
  index: number
): EngineBacktestAccountAdjustment {
  const record = asRecord(value, `accountAdjustments[${index}]`);
  return {
    type: requiredString(record.type, `accountAdjustments[${index}].type`),
    amount: requiredFinite(record.amount, `accountAdjustments[${index}].amount`),
    timestamp: requiredString(
      record.timestamp,
      `accountAdjustments[${index}].timestamp`
    ),
  };
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidActivityField(path, "must be an object");
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw invalidActivityField(path, "must be a non-empty string");
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function requiredBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    throw invalidActivityField(path, "must be a boolean");
  }
  return value;
}

function requiredFinite(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw invalidActivityField(path, "must be a finite number");
  }
  return value;
}

function invalidActivityField(path: string, reason: string): EngineBacktestError {
  return new EngineBacktestError({
    type: "runtime",
    subtype: "persist_invalid_activity",
    message: `Cannot persist activity ${path}: ${reason}`,
  });
}
