import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  errorEnvelope,
  mapErrorToExitCode,
  parseJsonEnvelope,
  successEnvelope,
} from "../src/envelope";

describe("envelope", () => {
  it("builds success envelope with ok true and data", () => {
    const env = successEnvelope({ version: "0.1.0" }, { source: "test" }, "rid-1");
    assert.equal(env.ok, true);
    assert.deepEqual(env.data, { version: "0.1.0" });
    assert.equal(env.requestId, "rid-1");
    assert.deepEqual(env.meta, { source: "test" });
  });

  it("builds error envelope and maps confirmation to exit 10", () => {
    const env = errorEnvelope({
      type: "confirmation",
      subtype: "confirmation_required",
      message: "needs --yes",
      risk: "high-risk-write",
      action: "traders.start",
    });
    assert.equal(env.ok, false);
    assert.equal(mapErrorToExitCode(env.error), 10);
  });

  it("parses JSON envelopes from real serialized form", () => {
    const raw = JSON.stringify(successEnvelope({ a: 1 }));
    const parsed = parseJsonEnvelope(raw);
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.deepEqual(parsed.data, { a: 1 });
    }
  });

  it("maps HTTP 401 to exit 77", () => {
    assert.equal(
      mapErrorToExitCode({ type: "http", message: "nope", status: 401 }),
      77
    );
  });
});
