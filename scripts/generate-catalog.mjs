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
  readdirSync,
  realpathSync,
  statSync,
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

/**
 * Refuse to read a stale upstream build. The generator consumes
 * `<contracts>/dist`, which `pnpm build` writes and nothing keeps in step with
 * `src`, so an out-of-date build silently changes what the catalog is derived
 * from — it has reported retired operations as newly added. Newest-file times
 * are a heuristic (a checkout that restores older content still trips it); the
 * error direction is toward refusing to run, which is the safe one.
 *
 * Only applies when both trees exist, so an installed upstream package (which
 * ships no `src`) is unaffected.
 */
function assertContractsBuildIsCurrent(contractsRoot) {
  const srcDir = join(contractsRoot, "src");
  const distDir = join(contractsRoot, "dist");
  if (!existsSync(srcDir) || !existsSync(distDir)) {
    return;
  }
  const newest = (dir) => {
    let newestTime = 0;
    let newestFile = "";
    const walk = (current) => {
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        const full = join(current, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile()) {
          const { mtimeMs } = statSync(full);
          if (mtimeMs > newestTime) {
            newestTime = mtimeMs;
            newestFile = full;
          }
        }
      }
    };
    walk(dir);
    return { newestTime, newestFile };
  };
  const src = newest(srcDir);
  const dist = newest(distDir);
  if (src.newestTime > dist.newestTime) {
    process.stderr.write(
      `alphafox-contracts build is stale under ${contractsRoot}:\n` +
        `  ${src.newestFile}\n` +
        `  is newer than\n` +
        `  ${dist.newestFile}\n` +
        `Run pnpm build in alphafox-contracts first. Generating from a stale ` +
        `build produces a catalog that does not describe the current contract ` +
        `and has reported retired operations as newly added.\n`
    );
    process.exit(1);
  }
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

/**
 * Reduce a registry artifact to the contract content it asserts, dropping the
 * provenance fields that record when and from where it was generated.
 *
 * `source.contractsSha` records the upstream HEAD at generation time. It cannot
 * be stable — any upstream commit moves it, including commits that touch no
 * contract — and when upstream history is rewritten the recorded value names a
 * commit that no longer exists, so gating on it fails forever for a reason no
 * change can fix. Content, not the pointer, is what drift means.
 */
function contractContentOnly(registryText) {
  const parsed = JSON.parse(registryText);
  if (parsed?.source) {
    delete parsed.source.contractsSha;
  }
  return stableStringify(parsed);
}

const contractsRoot = resolveContractsRoot();
assertContractsBuildIsCurrent(contractsRoot);
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
  let provenanceBehind = false;
  if (registryOnDisk !== artifacts.registryText) {
    if (
      registryOnDisk !== null &&
      contractContentOnly(registryOnDisk) ===
        contractContentOnly(artifacts.registryText)
    ) {
      provenanceBehind = true;
    } else {
      drift.push("src/catalog/generated/registry.json");
    }
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
  if (provenanceBehind) {
    process.stdout.write(
      "Catalog content matches @alphafoxai/contracts/public-api, but " +
        "source.contractsSha is behind upstream HEAD; run " +
        "node scripts/generate-catalog.mjs to refresh provenance.\n"
    );
    process.exit(0);
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
