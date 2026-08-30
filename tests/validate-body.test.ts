import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { validateCatalogWriteBody } from "../src/catalog/validate-body";
import {
  loadJsonArg,
  parseRequestBodyFlags,
  RequestBodyError,
} from "../src/commands/request-body";

describe("catalog write-body validation", () => {
  it("accepts trading.traders.byId.start when body matches schema", () => {
    const result = validateCatalogWriteBody({
      method: "POST",
      operationId: "trading.traders.byId.start",
      body: { startType: "manual_start" },
    });
    assert.equal(result.ok, true);
  });

  it("rejects missing required fields and extra keys", () => {
    const missing = validateCatalogWriteBody({
      method: "POST",
      operationId: "trading.traders.create",
      body: {},
    });
    assert.equal(missing.ok, false);
    if (!missing.ok) {
      assert.equal(missing.error.subtype, "body_schema");
      assert.match(missing.error.message, /trading\.traders\.create/);
    }

    const extra = validateCatalogWriteBody({
      method: "POST",
      operationId: "trading.traders.byId.start",
      body: { startType: "manual_start", inventedField: true },
    });
    assert.equal(extra.ok, false);
    if (!extra.ok) {
      assert.equal(extra.error.subtype, "body_schema");
    }
  });

  it("accepts Engine create body and rejects chatId / strategyId", () => {
    const engine = validateCatalogWriteBody({
      method: "POST",
      operationId: "trading.traders.create",
      body: {
        name: "跌了就追",
        strategyDefinitionId: "momentum_dump",
        exchangeConnectorId: "01a00af5-db8d-761a-86f4-9a283914e9ae",
        configSchemaVersion: 1,
        config: { leverage: 10 },
      },
    });
    assert.equal(engine.ok, true);

    const chatLegacy = validateCatalogWriteBody({
      method: "POST",
      operationId: "trading.traders.create",
      body: {
        chatId: "chat-1",
        strategyId: 1,
        name: "跌了就追",
        mode: "paper",
        exchangeConnectId: "01a00af5-db8d-761a-86f4-9a283914e9ae",
        runtimeSettings: {},
        strategyParamValues: {},
        riskSettings: { enabled: false },
      },
    });
    assert.equal(chatLegacy.ok, false);
    if (!chatLegacy.ok) {
      assert.equal(chatLegacy.error.subtype, "body_schema");
    }
  });

  it("rejects invented enum values", () => {
    const result = validateCatalogWriteBody({
      method: "POST",
      operationId: "trading.traders.create",
      body: { mode: "from-memory" },
    });
    assert.equal(result.ok, false);
  });

  it("allows optional Engine start body {} and requires stop closePositions", () => {
    const emptyStart = validateCatalogWriteBody({
      method: "POST",
      operationId: "trading.traders.byId.start",
      body: {},
    });
    assert.equal(emptyStart.ok, true);
    const retiredReason = validateCatalogWriteBody({
      method: "POST",
      operationId: "trading.traders.byId.start",
      body: { reason: "resume" },
    });
    assert.equal(retiredReason.ok, false);
    const bad = validateCatalogWriteBody({
      method: "POST",
      operationId: "trading.traders.byId.start",
      body: { force: true },
    });
    assert.equal(bad.ok, false);
    const emptyStop = validateCatalogWriteBody({
      method: "POST",
      operationId: "trading.traders.byId.stop",
      body: {},
    });
    assert.equal(emptyStop.ok, false);
    const keepPositions = validateCatalogWriteBody({
      method: "POST",
      operationId: "trading.traders.byId.stop",
      body: { closePositions: false },
    });
    assert.equal(keepPositions.ok, true);
    const closePositions = validateCatalogWriteBody({
      method: "POST",
      operationId: "trading.traders.byId.stop",
      body: { closePositions: true },
    });
    assert.equal(closePositions.ok, true);
  });

  it("skips GET and allows empty uncataloged write bodies only", () => {
    const get = validateCatalogWriteBody({
      method: "GET",
      body: { ignored: true },
    });
    assert.equal(get.ok, true);
    const empty = validateCatalogWriteBody({
      method: "POST",
      body: {},
    });
    assert.equal(empty.ok, true);
    const invented = validateCatalogWriteBody({
      method: "POST",
      body: { foo: 1 },
    });
    assert.equal(invented.ok, false);
    if (!invented.ok) {
      assert.equal(invented.error.subtype, "body_schema_missing");
    }
  });
});

describe("request body flags", () => {
  it("loads --config @file and --body @file", () => {
    const dir = mkdtempSync(join(tmpdir(), "alphafox-body-"));
    const file = join(dir, "start.json");
    writeFileSync(file, JSON.stringify({ closePositions: false }));
    const fromConfig = parseRequestBodyFlags(["--config", `@${file}`]);
    assert.equal(fromConfig.source, "config");
    assert.deepEqual(fromConfig.body, { closePositions: false });
    const fromBody = parseRequestBodyFlags(["--body", `@${file}`]);
    assert.equal(fromBody.source, "body");
    assert.deepEqual(fromBody.body, { closePositions: false });
  });

  it("rejects --body and --config together", () => {
    assert.throws(
      () => parseRequestBodyFlags(["--body", "{}", "--config", "@x.json"]),
      (err: unknown) => {
        assert.ok(err instanceof RequestBodyError);
        assert.equal(err.subtype, "body_and_config");
        return true;
      }
    );
  });

  it("rejects invalid inline JSON", () => {
    assert.throws(
      () => loadJsonArg("{not-json"),
      (err: unknown) => {
        assert.ok(err instanceof RequestBodyError);
        assert.equal(err.subtype, "invalid_body");
        return true;
      }
    );
  });
});
