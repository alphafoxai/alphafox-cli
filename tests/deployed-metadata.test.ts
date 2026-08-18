import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { CATALOG_SOURCE, COMPATIBILITY_RANGE } from "../src/catalog/operations";
import type { ProfileConfig } from "../src/config/profiles";
import { apiRequest } from "../src/http/client";
import {
  validateDeployedMetadata,
  verifyDeployedMetadata,
} from "../src/http/metadata";

const profile: ProfileConfig = {
  name: "production",
  apiBaseUrl: "https://alphafox.app/api/v1",
  issuer: "https://alphafox.app/api/auth",
  audience: "https://alphafox.app/api/v1",
  clientId: "alphafox-cli-prod",
  contractVersion: COMPATIBILITY_RANGE.contractVersion,
};

function metadata(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    environment: profile.name,
    contractVersion: COMPATIBILITY_RANGE.contractVersion,
    registryVersion: COMPATIBILITY_RANGE.registryVersion,
    openapi: COMPATIBILITY_RANGE.openapi,
    minCliVersion: COMPATIBILITY_RANGE.minCliVersion,
    maxCliVersion: COMPATIBILITY_RANGE.maxCliVersion,
    contractsSha: CATALOG_SOURCE.contractsSha,
    ...overrides,
  };
}

function testEnv(): NodeJS.ProcessEnv {
  return {
    ALPHAFOX_CONFIG_DIR: mkdtempSync(join(tmpdir(), "alphafox-cli-meta-")),
    ALPHAFOX_FORCE_FILE_KEYCHAIN: "1",
  };
}

function subtypeOf(value: unknown): string | undefined {
  if (
    value &&
    typeof value === "object" &&
    "subtype" in value &&
    typeof value.subtype === "string"
  ) {
    return value.subtype;
  }
  return undefined;
}

function errorTypeOf(value: unknown): string | undefined {
  if (
    value &&
    typeof value === "object" &&
    "type" in value &&
    typeof value.type === "string"
  ) {
    return value.type;
  }
  return undefined;
}

function assertFailure(value: unknown, subtype: string, cliVersion?: string): void {
  assert.throws(
    () => validateDeployedMetadata(value, profile, cliVersion),
    (err: unknown) => {
      assert.equal(errorTypeOf(err), "compatibility");
      assert.equal(subtypeOf(err), subtype);
      return true;
    }
  );
}

test("metadata verifier accepts matching deployment and operational request follows", async () => {
  const seen: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    seen.push(String(input));
    if (seen.length === 1) {
      assert.ok(init?.signal, "metadata request must be bounded by an AbortSignal");
      return new Response(JSON.stringify(metadata()), { status: 200 });
    }
    return new Response(JSON.stringify({ userId: "user-1" }), { status: 200 });
  };

  const response = await apiRequest(
    { method: "GET", path: "/api/v1/me", profile },
    testEnv(),
    fetchImpl
  );

  assert.equal(response.status, 200);
  assert.deepEqual(seen, [
    "https://alphafox.app/api/v1/meta",
    "https://alphafox.app/api/v1/me",
  ]);
});

test("unreachable and malformed metadata fail closed", async () => {
  await assert.rejects(
    verifyDeployedMetadata(profile, testEnv(), async () => {
      throw new Error("connect timeout");
    }),
    (err: unknown) => subtypeOf(err) === "metadata_unavailable"
  );

  await assert.rejects(
    verifyDeployedMetadata(
      profile,
      testEnv(),
      async () => new Response("not-json", { status: 200 })
    ),
    (err: unknown) => subtypeOf(err) === "metadata_malformed"
  );
});

test("metadata validation rejects malformed payloads and every mismatch class", () => {
  assertFailure(null, "metadata_malformed");
  assertFailure({ ...metadata(), contractsSha: undefined }, "metadata_malformed");
  assertFailure(metadata({ environment: "staging" }), "metadata_environment_mismatch");
  assertFailure(metadata({ contractVersion: "2026-09-01" }), "metadata_contract_mismatch");
  assertFailure(metadata({ registryVersion: "9.9.9" }), "metadata_registry_mismatch");
  assertFailure(metadata({ openapi: "3.0.0" }), "metadata_openapi_mismatch");
  assertFailure(metadata({ minCliVersion: "0.4.0" }), "metadata_cli_range_mismatch");
  assertFailure(metadata({ maxCliVersion: "0.2.0" }), "metadata_cli_range_mismatch");
  assertFailure(metadata({ contractsSha: "different" }), "metadata_source_mismatch");
  assertFailure(metadata(), "metadata_cli_version_mismatch", "1.0.0");
});

test("metadata mismatch prevents the downstream operational request", async () => {
  const seen: string[] = [];
  await assert.rejects(
    apiRequest(
      { method: "POST", path: "/api/v1/trading/traders", profile, body: {} },
      testEnv(),
      async (input) => {
        seen.push(String(input));
        return new Response(JSON.stringify(metadata({ contractsSha: "stale" })), {
          status: 200,
        });
      }
    ),
    (err: unknown) => subtypeOf(err) === "metadata_source_mismatch"
  );
  assert.deepEqual(seen, ["https://alphafox.app/api/v1/meta"]);
});
