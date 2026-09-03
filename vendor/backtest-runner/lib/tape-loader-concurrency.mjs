export const DEFAULT_TAPE_SERIES_CONCURRENCY = 8;
export const MAX_TAPE_SERIES_CONCURRENCY = 8;

export function resolveTapeSeriesConcurrency(value) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 1) {
    return Math.min(
      MAX_TAPE_SERIES_CONCURRENCY,
      Math.max(1, Math.floor(value))
    );
  }
  return DEFAULT_TAPE_SERIES_CONCURRENCY;
}

export async function mapWithConcurrency(items, concurrency, worker) {
  const list = [...items];
  if (list.length === 0) return [];

  const limit = Math.min(
    list.length,
    Math.max(1, Math.floor(Number(concurrency)) || 1)
  );
  const results = new Array(list.length);
  let nextIndex = 0;
  async function runWorker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= list.length) return;
      results[index] = await worker(list[index], index);
    }
  }
  await Promise.all(Array.from({ length: limit }, () => runWorker()));
  return results;
}

/** Shares one request budget across series workers and their time windows. */
export function limitTapeOhlcvConcurrency(exchange, concurrency, signal) {
  const limit = resolveTapeSeriesConcurrency(concurrency);
  const queue = [];
  let active = 0;

  const drain = () => {
    while (active < limit) {
      const task = queue.shift();
      if (!task) return;
      active += 1;
      void task().finally(() => {
        active -= 1;
        drain();
      });
    }
  };
  const schedule = (operation) =>
    new Promise((resolve, reject) => {
      queue.push(async () => {
        try {
          signal?.throwIfAborted();
          resolve(await operation());
        } catch (error) {
          reject(error);
        }
      });
      drain();
    });

  return {
    fetchOHLCV: (symbol, timeframe, since, pageLimit, params) =>
      schedule(() =>
        exchange.fetchOHLCV(symbol, timeframe, since, pageLimit, params)
      ),
  };
}
