import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CATALOG_OPERATIONS,
  CATALOG_SOURCE,
  CATALOG_VERSION,
  COMPATIBILITY_RANGE,
  buildCapabilityManifest,
  checkGeneratedCatalogCompatibility,
  findCatalogOperation,
  findCatalogOperationByRoute,
  getOperationSchemaDocument,
} from "../src/catalog/operations";
import { checkCliCompatibility } from "../src/catalog/compatibility";
import { resolveTypedCommand } from "../src/catalog/command-tree";
import { isFacadeAllowlistedPath } from "../src/catalog/allowlist";
import { CLI_VERSION } from "../src/version";

describe("generated operation catalog", () => {
  it("is generated from the public-api registry, not a handwritten 24-op list", () => {
    assert.equal(CATALOG_SOURCE.package, "@alphafoxai/contracts");
    assert.equal(CATALOG_SOURCE.registryVersion, "1.1.0");
    assert.equal(CATALOG_VERSION, "2026-08-13");
    assert.ok(
      CATALOG_OPERATIONS.length >= 200,
      `expected >= 200 operations, got ${CATALOG_OPERATIONS.length}`
    );
    assert.equal(CATALOG_OPERATIONS.length, CATALOG_SOURCE.cliOperations);
    const ids = CATALOG_OPERATIONS.map((op) => op.operationId);
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(findCatalogOperation("me.whoami"));
    assert.ok(findCatalogOperation("trading.traders.create"));
    assert.ok(findCatalogOperation("trading.traders.byId.start"));
    assert.equal(findCatalogOperation("backtests.byId.get.get"), undefined);
    const sweepCreate = findCatalogOperation(
      "engine_backtest.experiments.byId.sweeps.create"
    );
    const sweepList = findCatalogOperation(
      "engine_backtest.experiments.byId.sweeps.list"
    );
    const sweepGet = findCatalogOperation(
      "engine_backtest.experiments.byId.sweeps.byId.get"
    );
    const sweepDelete = findCatalogOperation(
      "engine_backtest.experiments.byId.sweeps.byId.delete"
    );
    assert.ok(sweepCreate);
    assert.ok(sweepList);
    assert.ok(sweepGet);
    assert.ok(sweepDelete);
    assert.equal(sweepCreate?.method, "POST");
    assert.equal(sweepCreate?.risk, "write");
    assert.equal(
      sweepCreate?.path,
      "/api/v1/engine-backtest/experiments/{experimentId}/sweeps"
    );
    assert.equal(sweepList?.method, "GET");
    assert.equal(sweepGet?.method, "GET");
    assert.equal(sweepDelete?.method, "DELETE");
    assert.equal(sweepDelete?.risk, "high-risk-write");
    const spaced = resolveTypedCommand([
      "engine_backtest",
      "experiments",
      "sweeps",
      "list",
    ]);
    assert.equal(spaced.kind, "operation");
    if (spaced.kind === "operation") {
      assert.equal(
        spaced.operation.operationId,
        "engine_backtest.experiments.byId.sweeps.list"
      );
    }
    const deleteCmd = resolveTypedCommand([
      "engine_backtest",
      "experiments",
      "sweeps",
      "delete",
    ]);
    assert.equal(deleteCmd.kind, "operation");
    if (deleteCmd.kind === "operation") {
      assert.equal(
        deleteCmd.operation.operationId,
        "engine_backtest.experiments.byId.sweeps.byId.delete"
      );
      assert.equal(deleteCmd.operation.risk, "high-risk-write");
    }
    assert.ok(
      findCatalogOperationByRoute(
        "POST",
        "/api/v1/engine-backtest/experiments/11111111-1111-1111-1111-111111111111/sweeps"
      )
    );
    assert.equal(isFacadeAllowlistedPath("/api/v1/backtests"), true);
    assert.equal(
      findCatalogOperation("engine_backtest.experiments.byId.sweeps.create")
        ?.operationId.includes("backtests."),
      false
    );
  });

  it("capability manifest and schema documents cover every CLI operationId", () => {
    const manifest = buildCapabilityManifest();
    assert.equal(manifest.operations.length, CATALOG_OPERATIONS.length);
    assert.equal(manifest.openapi, "3.1.0");
    for (const op of CATALOG_OPERATIONS) {
      const schema = getOperationSchemaDocument(op.operationId);
      assert.ok(schema, `missing schema for ${op.operationId}`);
      assert.equal(schema.operationId, op.operationId);
      assert.equal(schema.method, op.method);
      assert.equal(schema.path, op.path);
      assert.equal(schema.error.contentType, "application/problem+json");
      assert.ok(schema.response.success);
    }
    const chats = getOperationSchemaDocument("chats.create");
    assert.ok(chats?.request.body);
    const start = getOperationSchemaDocument("trading.traders.byId.start");
    assert.deepEqual(start?.request.pathParamNames, ["traderId"]);
  });

  it("fails closed on CLI/contract incompatibility", () => {
    const ok = checkGeneratedCatalogCompatibility(CLI_VERSION);
    assert.equal(ok.ok, true);
    const mismatch = checkCliCompatibility(
      { cliVersion: CLI_VERSION, contractVersion: "1999-01-01" },
      COMPATIBILITY_RANGE
    );
    assert.equal(mismatch.ok, false);
    if (!mismatch.ok) assert.equal(mismatch.code, "contract_mismatch");
    const old = checkCliCompatibility(
      { cliVersion: "0.0.0", contractVersion: COMPATIBILITY_RANGE.contractVersion },
      { ...COMPATIBILITY_RANGE, minCliVersion: "1.0.0" }
    );
    assert.equal(old.ok, false);
    if (!old.ok) assert.equal(old.code, "cli_too_old");
  });

  it("resolves typed commands from operationIds only", () => {
    const exact = resolveTypedCommand(["trading.traders.byId.start"]);
    assert.equal(exact.kind, "operation");
    if (exact.kind === "operation") {
      assert.equal(exact.operation.operationId, "trading.traders.byId.start");
    }
    const spaced = resolveTypedCommand(["trading", "traders", "list"]);
    assert.equal(spaced.kind, "operation");
    if (spaced.kind === "operation") {
      assert.equal(spaced.operation.operationId, "trading.traders.list");
    }
    const suffix = resolveTypedCommand(["trading", "traders", "start"]);
    assert.equal(suffix.kind, "operation");
    if (suffix.kind === "operation") {
      assert.equal(suffix.operation.operationId, "trading.traders.byId.start");
    }
    const domainHelp = resolveTypedCommand(["trading"]);
    assert.equal(domainHelp.kind, "help");
    if (domainHelp.kind === "help") {
      assert.ok(domainHelp.operations.length > 1);
    }
    const missing = resolveTypedCommand(["not-a-real-domain", "nope"]);
    assert.equal(missing.kind, "missing");
  });

  it("allowlist is finite registry paths, not /api/v1/*", () => {
    assert.equal(isFacadeAllowlistedPath("/api/v1/me"), true);
    assert.equal(isFacadeAllowlistedPath("/api/v1/market/symbols"), true);
    assert.equal(isFacadeAllowlistedPath("/api/v1/totally-unknown"), false);
    assert.equal(
      isFacadeAllowlistedPath("/api/v1/trading/traders/t1/not-a-real-action"),
      false
    );
    assert.ok(findCatalogOperationByRoute("POST", "/api/v1/trading/traders"));
    assert.equal(
      findCatalogOperationByRoute("POST", "/api/v1/me")?.operationId,
      undefined
    );
  });
});
