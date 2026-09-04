# Vendored Engine tape runner

This directory is copied from `alphafox-engine/npm/backtest-runner` so the public CLI does not need GitHub Packages. Keep it aligned when the Engine runner changes.

# @alphafoxai/backtest-runner

Node 侧的 Engine Backtest **tape loader + scenario 组装**库。从交易所拉 closed OHLCV / funding，编成 wasm 运行时需要的 tape JSON 与列式 `ArrayBuffer`，并套上与 web 回测相同的默认 `executionModel`。

本包**不执行 wasm**，也不依赖 `@alphafoxai/backtest-wasm`（避免把约 40MB 的 wasm 拖进 CLI 的懒加载路径）。CLI 应同时依赖本包与 wasm 包：runner 负责行情，wasm 包负责 `planBacktest` / `runBacktest`。

## 安装

```bash
npm install @alphafoxai/backtest-runner --registry=https://npm.pkg.github.com
```

要求 Node >= 20。

## 发布

`main` push 通过常规 CI 后，仅当 `lib/`、入口 / 类型声明或 package 元数据发生变化时发布到 GitHub Packages。测试、README 或其他 Engine 文件单独变化不会触发 runner 发布。CI 使用当前 workflow run / attempt 生成唯一版本，并通过仓库 `GITHUB_TOKEN` 发布。

## 公共 API

```js
import {
  DEFAULT_EXECUTION_MODEL,
  TAPE_EXCHANGES,
  resolveTapeExchange,
  encodeOhlcvColumns,
  createFileTapeCache,
  loadTape,
  assembleScenario,
} from "@alphafoxai/backtest-runner";

const { tape, buffers, coverageWarnings, coverageIssues } = await loadTape({
  exchangeId: "binance_perp_usdt",
  symbols: ["BTC/USDT:USDT"],
  timeframes: ["1m", "1h"],
  fromMs,
  toMs,
  dataQualityMode: "basic",
});

const scenario = assembleScenario({
  runId,
  definitionId: "grid",
  configSchemaVersion: 4,
  config,
  subscriptionTier: "pro",
  initialEquity: 10_000,
  traderName: "paper-grid",
  tape,
});
```

| 导出 | 作用 |
|---|---|
| `DEFAULT_EXECUTION_MODEL` | web 硬编码值：`ohlc_path_4` / maker `0.0002` / taker `0.0005` / slippage `0.0001` |
| `TAPE_EXCHANGES` | Binance / OKX / Bybit / Bitget / Hyperliquid 线性合约定义 |
| `resolveTapeExchange(id)` | 解析 `binance_perp_usdt` 或 `binance` 等别名；未知 id **抛错** |
| `encodeOhlcvColumns(rows)` | 与 wasm 包相同的 float64 列式小端布局 |
| `createFileTapeCache(rootDir)` | 默认根目录 `~/.alphafox/cache/engine-backtest` |
| `loadTape(request, options?)` | 拉数 + 缓存缺口补齐 + 覆盖率校验 |
| `assembleScenario(input)` | 组装 `EngineBacktestScenario`，不跑 wasm |

`loadTape` 可注入 `ohlcvFetcher` / `fundingFetcher` / `marketsLoader`，单测不得打真实交易所。任一注入器出现时，本包拒绝再构造 live ccxt client。

## 缓存

- 语义对齐 web 的 closed-series IndexedDB 缓存：每个 `ccxtId + symbol + timeframe` 一条滚动区间，命中后只补缺口。
- Node 侧改为文件系统 JSON；max-age 30 天。
- `options.cache === false` / `"disable"` 关闭缓存；`options.cacheDir` 覆盖根目录。测试应使用临时目录。

## 代理

尊重 `HTTPS_PROXY` / `https_proxy` / `HTTP_PROXY` / `http_proxy`，并写入 ccxt 构造参数 `httpsProxy` / `httpProxy`。也可显式传入 `options.httpsProxy` / `options.httpProxy` / `options.agent`。未配置时不会假装“已走代理”。

## 分页 limit

与 web `tape-loader.series.ts` 对齐：Binance 1500、OKX 100、Bybit / Bitget 1000、Hyperliquid 5000。Bitget 另受约 89 天请求跨度限制；Hyperliquid 分页带 `until` 窗口。

长区间会拆成最多 8 个可独立下载的时间窗口；不同 `symbol × timeframe` 与同一序列的时间窗口共用一个全局 8 请求池，避免嵌套并发放大。相邻窗口保留一根重叠 K 线，合并时按时间去重；同时间戳内容不一致会抛出 `invalid_ohlcv`，不会静默选取其中一份。

## 数据质量

- `basic`（默认）：硬失败（缺市场、空序列、非法 K 线、拉数失败）仍抛错；软缺口进入 `coverageIssues` 与 `coverageWarnings`。起始缺口（`prefix_gap`）较轻，中间缺口（`internal_gap`）较重。
- `strict`：任何缺口 / 缺数 / 非法 K 线都抛 `TapeDataUnavailableError`。
- 禁止 mock 成功或静默降级。

## 已知限制（相对 alphafox-web）

- **不执行 wasm**，不做 `planBacktest` / `runBacktest`。
- **HIP-3**：构造 Hyperliquid 时与 web 一样只附加硬编码的 `xyz` builder DEX，不拉取完整 HIP-3 目录，也不移植 Next alias / 浏览器 HIP-3 市场列表。原生 HL USDC 线性合约是主路径；HIP-3 符号属于尽力而为。
- **缓存后端**是文件系统，不是 IndexedDB；key 版本仍是 `closed-series-v2`。
- **未知交易所 id 抛错**，web 的 `resolveEngineBacktestTapeExchange` 会静默回落到 Binance。
- **Aster / Gate** 不是 tape 数据源。
- Hyperliquid 不提供 `6h` K 线（与 web 相同，快速失败）。
- 本包不依赖 `@alphafoxai/backtest-wasm`；`encodeOhlcvColumns` 与必要类型自包含。`EngineBacktestTapeMarket.precisionMode` 按 Go tape 协议写出（wasm 包的 `index.d.ts` 目前漏了该字段）。
