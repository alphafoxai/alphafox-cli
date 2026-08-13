/**
 * Generate the CLI Operation Catalog from @alphafoxai/contracts/public-api.
 *
 * Does not invent a second registry: listCliOperations, buildCapabilityManifest,
 * buildOperationSchemaDocument, and getCompatibilityRange are the only inputs.
 *
 * Contracts root resolution (same sibling pattern as build-mvp-web-bundle.mjs):
 *   ALPHAFOX_CONTRACTS_ROOT, else ../alphafox-contracts, else node_modules.
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

function resolveContractsRoot() {
  if (process.env.ALPHAFOX_CONTRACTS_ROOT) {
    return process.env.ALPHAFOX_CONTRACTS_ROOT;
  }
  const sibling = join(cliRoot, "..", "alphafox-contracts");
  if (existsSync(join(sibling, "package.json"))) {
    return sibling;
  }
  try {
    return dirname(require.resolve("@alphafoxai/contracts/package.json"));
  } catch {
    throw new Error(
      "Cannot find alphafox-contracts. Set ALPHAFOX_CONTRACTS_ROOT or clone it as ../alphafox-contracts (same layout as alphafox-web for MVP tests)."
    );
  }
}

function loadPublicApi(contractsRoot) {
  const candidates = [
    join(contractsRoot, "dist/public-api/index.js"),
    join(contractsRoot, "dist/public-api.js"),
  ];
  for (const file of candidates) {
    if (existsSync(file)) {
      return require(file);
    }
  }
  throw new Error(
    `alphafox-contracts public-api build missing under ${contractsRoot}. Run pnpm build there first.`
  );
}

function contractsSha(contractsRoot) {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: contractsRoot,
      encoding: "utf8",
    }).trim();
  } catch {
    return "";
  }
}

function stableStringify(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function buildArtifacts(publicApi, sourceMeta) {
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
  const cliOps = listCliOperations(OPERATION_REGISTRY);

  const operations = manifest.operations.map((row) => {
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

  const schemas = {};
  for (const op of cliOps) {
    schemas[op.operationId] = buildOperationSchemaDocument(
      op,
      OPERATION_REGISTRY
    );
  }

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
const artifacts = buildArtifacts(publicApi, {
  contractsSha: contractsSha(contractsRoot),
});

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
