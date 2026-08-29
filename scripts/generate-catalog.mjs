/**
 * Generate the CLI Operation Catalog from @alphafoxai/contracts/public-api.
 *
 * Does not invent a second registry: listCliOperations, buildCapabilityManifest,
 * buildOperationSchemaDocument, and getCompatibilityRange are the only inputs.
 *
 * Contracts root resolution:
 *   ALPHAFOX_CONTRACTS_ROOT if set, else sibling ../alphafox-contracts when
 *   it has a public-api build, else the newest remaining installed copy
 *   (website node_modules, CLI node_modules). Do not pick a larger stale
 *   registry over a newer sibling — retirement shrinks the operation list.
 *   Sibling createTrader is overlaid when it is already Engine-shaped
 *   (strategyDefinitionId + config).
 *
 * Usage:
 *   node scripts/generate-catalog.mjs           # write generated JSON
 *   node scripts/generate-catalog.mjs --check   # fail on drift (CI)
 */
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const cliRoot = join(here, "..");
const outDir = join(cliRoot, "src/catalog/generated");
const registryPath = join(outDir, "registry.json");
const schemasPath = join(outDir, "schemas.json");
const checkOnly = process.argv.includes("--check");
const require = createRequire(import.meta.url);

function existingPackageRoot(path) {
  if (!existsSync(join(path, "package.json"))) {
    return null;
  }
  return realpathSync(path);
}

function siblingContractsRoot() {
  return existingPackageRoot(join(cliRoot, "..", "alphafox-contracts"));
}

function listContractsCandidates() {
  const found = [];
  const seen = new Set();
  const add = (path) => {
    const resolved = existingPackageRoot(path);
    if (!resolved || seen.has(resolved)) {
      return;
    }
    seen.add(resolved);
    found.push(resolved);
  };

  if (process.env.ALPHAFOX_CONTRACTS_ROOT) {
    add(process.env.ALPHAFOX_CONTRACTS_ROOT);
  }
  add(join(cliRoot, "..", "alphafox-contracts"));
  add(
    join(
      cliRoot,
      "..",
      "alphafox-web",
      "node_modules",
      "@alphafoxai",
      "contracts"
    )
  );
  add(
    join(cliRoot, "..", "alphafox-web", "node_modules", "@alphafox", "contracts")
  );
  try {
    add(dirname(require.resolve("@alphafoxai/contracts/package.json")));
  } catch {
    // CLI does not depend on the contracts package at runtime.
  }
  return found;
}

function loadPublicApi(contractsRoot) {
  const requireFromContracts = createRequire(
    join(contractsRoot, "package.json")
  );
  const candidates = [
    join(contractsRoot, "dist/public-api/index.js"),
    join(contractsRoot, "dist/public-api.js"),
  ];
  for (const file of candidates) {
    if (existsSync(file)) {
      return requireFromContracts(file);
    }
  }
  throw new Error(
    `alphafox-contracts public-api build missing under ${contractsRoot}. Run pnpm build there first.`
  );
}

function registryOperationCount(contractsRoot) {
  try {
    return loadPublicApi(contractsRoot).OPERATION_REGISTRY.operations.length;
  } catch {
    return -1;
  }
}

function registryContractVersion(contractsRoot) {
  try {
    return String(
      loadPublicApi(contractsRoot).OPERATION_REGISTRY.contractVersion ?? ""
    );
  } catch {
    return "";
  }
}

function resolveContractsRoot() {
  if (process.env.ALPHAFOX_CONTRACTS_ROOT) {
    const explicit = existingPackageRoot(process.env.ALPHAFOX_CONTRACTS_ROOT);
    if (!explicit) {
      throw new Error(
        `ALPHAFOX_CONTRACTS_ROOT is not a package: ${process.env.ALPHAFOX_CONTRACTS_ROOT}`
      );
    }
    if (registryOperationCount(explicit) < 0) {
      throw new Error(
        `alphafox-contracts public-api build missing under ${explicit}. Run pnpm build there first.`
      );
    }
    return explicit;
  }

  const sibling = siblingContractsRoot();
  if (sibling && registryOperationCount(sibling) >= 0) {
    return sibling;
  }

  const candidates = listContractsCandidates().filter(
    (path) => registryOperationCount(path) >= 0
  );
  if (candidates.length === 0) {
    throw new Error(
      "Cannot find alphafox-contracts. Set ALPHAFOX_CONTRACTS_ROOT or clone it as ../alphafox-contracts (same layout as alphafox-web for MVP tests)."
    );
  }
  let best = candidates[0];
  let bestVersion = registryContractVersion(best);
  for (const candidate of candidates.slice(1)) {
    const version = registryContractVersion(candidate);
    if (version > bestVersion) {
      best = candidate;
      bestVersion = version;
    }
  }
  return best;
}

function contractsSha(contractsRoot) {
  if (existsSync(join(contractsRoot, ".git"))) {
    try {
      return execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: contractsRoot,
        encoding: "utf8",
      }).trim();
    } catch {
      // Published packages are not git checkouts.
    }
  }
  try {
    const pkg = JSON.parse(
      readFileSync(join(contractsRoot, "package.json"), "utf8")
    );
    const match = String(pkg.version ?? "").match(/git\.([0-9a-f]+)/i);
    return match ? match[1] : "";
  } catch {
    return "";
  }
}

function isEngineCreateTraderDocument(document) {
  const properties = document?.request?.body?.properties;
  return Boolean(
    properties?.strategyDefinitionId &&
      properties?.config &&
      properties?.exchangeConnectorId &&
      !properties?.chatId &&
      !properties?.strategyId
  );
}

function overlayEngineCreateTrader(schemas, primaryRoot) {
  const sibling = siblingContractsRoot();
  if (!sibling || sibling === primaryRoot) {
    return schemas;
  }
  let siblingApi;
  try {
    siblingApi = loadPublicApi(sibling);
  } catch {
    return schemas;
  }
  const op = siblingApi.findOperationById(
    "trading.traders.create",
    siblingApi.OPERATION_REGISTRY
  );
  if (!op) {
    return schemas;
  }
  const document = siblingApi.buildOperationSchemaDocument(
    op,
    siblingApi.OPERATION_REGISTRY
  );
  if (!isEngineCreateTraderDocument(document)) {
    return schemas;
  }
  return { ...schemas, "trading.traders.create": document };
}

function stableStringify(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * Keep in sync with src/catalog/omit.ts.
 * Retired chat / Chat Backtest / Strategy Plaza prefixes.
 * Match backtests / backtests.* only — never engine_backtest.*.
 */
function isOmittedCatalogOperation(operationId) {
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

function buildArtifacts(publicApi, sourceMeta, contractsRoot) {
  const {
    OPERATION_REGISTRY,
    buildCapabilityManifest,
    buildOperationSchemaDocument,
    findOperationById,
    getCompatibilityRange,
    listCliOperations,
  } = publicApi;

  const compatibility = getCompatibilityRange(OPERATION_REGISTRY);
  const manifest = buildCapabilityManifest(OPERATION_REGISTRY);
  const cliOps = listCliOperations(OPERATION_REGISTRY).filter(
    (op) => !isOmittedCatalogOperation(op.operationId)
  );

  const operations = manifest.operations
    .filter((row) => !isOmittedCatalogOperation(row.operationId))
    .map((row) => {
      const full = findOperationById(row.operationId, OPERATION_REGISTRY);
      return {
        operationId: row.operationId,
        method: row.method,
        path: row.path,
        role: row.role,
        risk: row.risk,
        auth: row.auth,
        scopes: row.scopes,
        stream: row.stream,
        file: row.file,
        pagination: row.pagination,
        idempotent: row.idempotent,
        mvp: row.mvp,
        catchAll: Boolean(full?.catchAll),
        contractStatus: row.contractStatus,
        requestBodySchema: row.requestBodySchema ?? null,
        querySchema: row.querySchema ?? null,
        responseSchema: row.responseSchema,
        errorSchema: row.errorSchema,
      };
    });

  let schemas = {};
  for (const op of cliOps) {
    schemas[op.operationId] = buildOperationSchemaDocument(
      op,
      OPERATION_REGISTRY
    );
  }
  schemas = overlayEngineCreateTrader(schemas, contractsRoot);

  const registry = {
    source: {
      package: "@alphafoxai/contracts",
      export: "public-api",
      contractsSha: sourceMeta.contractsSha,
      registryVersion: OPERATION_REGISTRY.version,
      contractVersion: OPERATION_REGISTRY.contractVersion,
      scannedAt: OPERATION_REGISTRY.inventory?.scannedAt ?? "",
      totalOperations: OPERATION_REGISTRY.operations.length,
      cliOperations: cliOps.length,
    },
    compatibility,
    operations,
  };

  return {
    registryText: stableStringify(registry),
    schemasText: stableStringify(schemas),
  };
}

function readIfExists(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

const contractsRoot = resolveContractsRoot();
const publicApi = loadPublicApi(contractsRoot);
const artifacts = buildArtifacts(
  publicApi,
  {
    contractsSha: contractsSha(contractsRoot),
  },
  contractsRoot
);

if (checkOnly) {
  const registryOnDisk = readIfExists(registryPath);
  const schemasOnDisk = readIfExists(schemasPath);
  const drift = [];
  if (registryOnDisk !== artifacts.registryText) {
    drift.push("src/catalog/generated/registry.json");
  }
  if (schemasOnDisk !== artifacts.schemasText) {
    drift.push("src/catalog/generated/schemas.json");
  }
  if (drift.length > 0) {
    process.stderr.write(
      `Catalog drift versus ${contractsRoot}:\n  ${drift.join("\n  ")}\nRe-run: node scripts/generate-catalog.mjs\n`
    );
    process.exit(1);
  }
  process.stdout.write("Catalog matches @alphafoxai/contracts/public-api.\n");
  process.exit(0);
}

mkdirSync(outDir, { recursive: true });
writeFileSync(registryPath, artifacts.registryText);
writeFileSync(schemasPath, artifacts.schemasText);
process.stdout.write(
  `Wrote ${registryPath} and ${schemasPath} from ${contractsRoot}\n`
);
