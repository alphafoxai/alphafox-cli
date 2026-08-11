import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isFacadeAllowlistedPath,
  isInternalDisallowedPath,
} from "../src/catalog/allowlist";
import { assertHighRiskConfirmation } from "../src/safety/confirmation";

describe("raw API allowlist", () => {
  it("rejects internal paths", () => {
    assert.equal(isInternalDisallowedPath("/backend/v1/x"), true);
    assert.equal(isInternalDisallowedPath("/control-plane/foo"), true);
    assert.equal(isInternalDisallowedPath("/signal-center/bar"), true);
    assert.equal(isInternalDisallowedPath("/api/control-plane/x"), true);
    assert.equal(isFacadeAllowlistedPath("/backend/secret"), false);
    assert.equal(isFacadeAllowlistedPath("/api/v1/me"), true);
  });

  it("requires /api/v1 facade prefix", () => {
    assert.equal(isFacadeAllowlistedPath("/api/chats"), false);
    assert.equal(isFacadeAllowlistedPath("/api/v1/chats"), true);
  });
});

describe("high-risk confirmation gate", () => {
  it("blocks high-risk-write without --yes", () => {
    const blocked = assertHighRiskConfirmation({
      risk: "high-risk-write",
      yes: false,
      action: "trading.traders.byId.start",
    });
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.error?.subtype, "confirmation_required");
  });

  it("allows high-risk with --yes or dry-run", () => {
    assert.equal(
      assertHighRiskConfirmation({
        risk: "high-risk-write",
        yes: true,
        action: "start",
      }).allowed,
      true
    );
    assert.equal(
      assertHighRiskConfirmation({
        risk: "high-risk-write",
        yes: false,
        dryRun: true,
        action: "start",
      }).allowed,
      true
    );
    assert.equal(
      assertHighRiskConfirmation({
        risk: "write",
        yes: false,
        action: "chats.create",
      }).allowed,
      true
    );
  });
});
