export const TAPE_SERIES_COLUMNS = [
  "timestamp",
  "open",
  "high",
  "low",
  "close",
  "volume",
];

/**
 * Encode ascending OHLCV rows ([ts, o, h, l, c, v]) into the columnar
 * little-endian float64 buffer consumed by the wasm runtime.
 * Layout matches `@alphafoxai/backtest-wasm` `encodeOhlcvColumns`.
 *
 * @param {ReadonlyArray<readonly [number, number, number, number, number, number]>} rows
 * @returns {ArrayBuffer}
 */
export function encodeOhlcvColumns(rows) {
  const count = rows.length;
  const view = new Float64Array(TAPE_SERIES_COLUMNS.length * count);
  for (let i = 0; i < count; i++) {
    const row = rows[i];
    for (let column = 0; column < TAPE_SERIES_COLUMNS.length; column++) {
      view[column * count + i] = row[column];
    }
  }
  return view.buffer;
}
