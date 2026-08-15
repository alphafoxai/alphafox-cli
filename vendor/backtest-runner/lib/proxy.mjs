const agentCacheIds = new WeakMap();
let nextAgentCacheId = 1;

/**
 * Resolve ccxt constructor proxy fields.
 *
 * Explicit `httpsProxy` / `httpProxy` / `agent` win. Otherwise read
 * `HTTPS_PROXY` / `https_proxy` / `HTTP_PROXY` / `http_proxy`.
 * HTTPS requests fall back to HTTP_PROXY when HTTPS_PROXY is unset.
 *
 * These keys are passed through to the ccxt constructor (`httpsProxy`,
 * `httpProxy`, `agent`). They are never silently dropped.
 *
 * @param {import("../index.d.ts").TapeProxyOptions | undefined} options
 * @param {NodeJS.ProcessEnv} [env]
 */
export function resolveCcxtProxyOptions(options = {}, env = process.env) {
  const httpsProxy =
    options.httpsProxy ??
    env.HTTPS_PROXY ??
    env.https_proxy ??
    env.HTTP_PROXY ??
    env.http_proxy;
  const httpProxy =
    options.httpProxy ?? env.HTTP_PROXY ?? env.http_proxy;
  const agent = options.agent;
  const resolved = {};
  if (httpsProxy) {
    resolved.httpsProxy = httpsProxy;
  }
  if (httpProxy) {
    resolved.httpProxy = httpProxy;
  }
  if (agent) {
    resolved.agent = agent;
  }
  return resolved;
}

export function ccxtExchangeClientCacheKey(exchangeId, options = {}) {
  const proxy = resolveCcxtProxyOptions(options);
  return JSON.stringify([
    exchangeId,
    proxy.httpsProxy ?? null,
    proxy.httpProxy ?? null,
    agentCacheIdentity(proxy.agent),
  ]);
}

export function buildCcxtConstructorOptions(exchange, options = {}) {
  const runtimeConfig = options.runtimeConfig;
  const proxy = resolveCcxtProxyOptions(options);
  return {
    enableRateLimit: true,
    options: {
      defaultType: exchange.marketType,
      ...(runtimeConfig?.constructorOptions ?? {}),
    },
    ...proxy,
  };
}

function agentCacheIdentity(agent) {
  if (
    agent === undefined ||
    agent === null ||
    (typeof agent !== "object" && typeof agent !== "function")
  ) {
    return agent ?? null;
  }
  let id = agentCacheIds.get(agent);
  if (id === undefined) {
    id = nextAgentCacheId;
    nextAgentCacheId += 1;
    agentCacheIds.set(agent, id);
  }
  return id;
}
