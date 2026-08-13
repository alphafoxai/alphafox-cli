import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isFacadeAllowlistedPath,
  isInternalDisallowedPath,
  normalizeApiPath,
  pathTemplateMatches,
} from "../src/catalog/allowlist";
import {
  assertHighRiskConfirmation,
  inferRawApiRisk,
  requiresHighRiskConfirmation,
} from "../src/safety/confirmation";

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

  it("allows known facility and catalog paths", () => {
    assert.equal(isFacadeAllowlistedPath("/api/v1/meta"), true);
    assert.equal(isFacadeAllowlistedPath("/api/v1/me"), true);
    assert.equal(
      isFacadeAllowlistedPath("/api/v1/trading/traders/t1/start"),
      true
    );
    assert.equal(isFacadeAllowlistedPath("/api/v1/wallet"), true);
    assert.equal(
      isFacadeAllowlistedPath("/api/v1/backtests/bt-1/cancel"),
      true
    );
  });

  it("rejects arbitrary unknown /api/v1 paths", () => {
    assert.equal(isFacadeAllowlistedPath("/api/v1/totally-unknown"), false);
    assert.equal(isFacadeAllowlistedPath("/api/v1/secret/admin/wipe"), false);
    assert.equal(isFacadeAllowlistedPath("/api/v1/../backend/x"), false);
    assert.equal(
      isFacadeAllowlistedPath("/api/v1/not-in-facility-or-catalog"),
      false
    );
  });

  it("collapses . and .. before allowlist match (no facility-prefix smuggle)", () => {
    assert.equal(
      normalizeApiPath("/api/v1/me/../totally-unknown-endpoint"),
      "/api/v1/totally-unknown-endpoint"
    );
    assert.equal(
      normalizeApiPath("/api/v1/me/../../totally-unknown"),
      "/api/totally-unknown"
    );
    assert.equal(normalizeApiPath("/api/v1/me/./"), "/api/v1/me");
    assert.equal(
      normalizeApiPath("/api/v1/trading/traders/../traders/t1/start"),
      "/api/v1/trading/traders/t1/start"
    );

    // Resolved unknown path must be denied (same as direct unknown).
    assert.equal(
      isFacadeAllowlistedPath("/api/v1/me/../totally-unknown-endpoint"),
      false
    );
    assert.equal(
      isFacadeAllowlistedPath("/api/v1/me/../../totally-unknown"),
      false
    );
    assert.equal(isFacadeAllowlistedPath("/api/v1/totally-unknown"), false);
    assert.equal(
      isFacadeAllowlistedPath("/api/v1/me/../../totally-unknown"),
      isFacadeAllowlistedPath("/api/v1/totally-unknown")
    );

    // Percent-encoded dots
    assert.equal(
      normalizeApiPath("/api/v1/me/%2e%2e/totally-unknown-endpoint"),
      "/api/v1/totally-unknown-endpoint"
    );
    assert.equal(
      isFacadeAllowlistedPath("/api/v1/me/%2e%2e/totally-unknown-endpoint"),
      false
    );
    assert.equal(
      isFacadeAllowlistedPath("/api/v1/me/%2E%2E/%2e%2e/secret"),
      false
    );
    // Double-encoded %252e%252e → %2e%2e → ..
    assert.equal(
      isFacadeAllowlistedPath("/api/v1/me/%252e%252e/totally-unknown"),
      false
    );

    // Legitimate nested still works after collapse
    assert.equal(isFacadeAllowlistedPath("/api/v1/me/./"), true);
    assert.equal(
      isFacadeAllowlistedPath("/api/v1/trading/traders/../traders/t1/start"),
      true
    );
  });

  it("pathTemplateMatches handles path params", () => {
    assert.equal(
      pathTemplateMatches(
        "/api/v1/trading/traders/{traderId}/start",
        "/api/v1/trading/traders/abc/start"
      ),
      true
    );
    assert.equal(
      pathTemplateMatches(
        "/api/v1/trading/traders/{traderId}/start",
        "/api/v1/trading/traders/abc/stop"
      ),
      false
    );
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

  it("blocks uncataloged/unknown mutating risk without --yes", () => {
    assert.equal(requiresHighRiskConfirmation("unknown"), true);
    assert.equal(inferRawApiRisk("POST", undefined), "unknown");
    assert.equal(inferRawApiRisk("GET", undefined), "read");
    assert.equal(inferRawApiRisk("POST", "write"), "write");
    assert.equal(inferRawApiRisk("POST", "high-risk-write"), "high-risk-write");

    const blocked = assertHighRiskConfirmation({
      risk: inferRawApiRisk("DELETE", undefined),
      yes: false,
      action: "api DELETE /api/v1/trading/traders",
    });
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.error?.subtype, "confirmation_required");
    assert.equal(blocked.error?.risk, "unknown");
    assert.match(blocked.error?.hint ?? "", /uncataloged/);

    assert.equal(
      assertHighRiskConfirmation({
        risk: "unknown",
        yes: true,
        action: "api DELETE x",
      }).allowed,
      true
    );
    assert.equal(
      assertHighRiskConfirmation({
        risk: "unknown",
        yes: false,
        dryRun: true,
        action: "api DELETE x",
      }).allowed,
      true
    );
  });
});
