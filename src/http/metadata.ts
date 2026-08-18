import type { ProfileConfig } from "../config/profiles";
import {
  CATALOG_SOURCE,
  COMPATIBILITY_RANGE,
} from "../catalog/operations";
import { checkCliCompatibility } from "../catalog/compatibility";
import { CLI_VERSION } from "../version";
import { newRequestId } from "../envelope";

export const DEPLOYED_METADATA_PATH = "/api/v1/meta";
export const DEPLOYED_METADATA_TIMEOUT_MS = 3_000;

export interface DeployedMetadata {
  readonly environment: string;
  readonly contractVersion: string;
  readonly registryVersion: string;
  readonly openapi: string;
  readonly minCliVersion: string;
  readonly maxCliVersion: string;
  readonly contractsSha: string;
  readonly [key: string]: unknown;
}

function compatibilityError(
  subtype: string,
  message: string,
  details?: Record<string, unknown>
): Error {
  return Object.assign(new Error(message), {
    type: "compatibility",
    subtype,
    hint: "Upgrade the CLI or contact the API owner; deployed metadata must match this CLI before operational requests can run.",
    ...(details ? { details } : {}),
  });
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function validateDeployedMetadata(
  value: unknown,
  profile: ProfileConfig,
  cliVersion = CLI_VERSION
): DeployedMetadata {
  const record = recordOf(value);
  const required = [
    "environment",
    "contractVersion",
    "registryVersion",
    "openapi",
    "minCliVersion",
    "maxCliVersion",
    "contractsSha",
  ] as const;
  if (!record) {
    throw compatibilityError(
      "metadata_malformed",
      "Deployed /api/v1/meta response must be a JSON object."
    );
  }
  for (const key of required) {
    if (typeof record[key] !== "string" || !record[key].trim()) {
      throw compatibilityError(
        "metadata_malformed",
        `Deployed /api/v1/meta response is missing a non-empty string field: ${key}.`,
        { field: key }
      );
    }
  }

  const metadata = record as DeployedMetadata;
  if (metadata.environment !== profile.name) {
    throw compatibilityError(
      "metadata_environment_mismatch",
      `Deployed environment ${metadata.environment} does not match resolved profile ${profile.name}.`,
      { expected: profile.name, actual: metadata.environment }
    );
  }
  if (
    profile.contractVersion &&
    metadata.contractVersion !== profile.contractVersion
  ) {
    throw compatibilityError(
      "metadata_contract_mismatch",
      `Deployed contractVersion ${metadata.contractVersion} does not match resolved profile ${profile.contractVersion}.`,
      { expected: profile.contractVersion, actual: metadata.contractVersion }
    );
  }

  const expected: ReadonlyArray<readonly [string, string, string]> = [
    ["contractVersion", COMPATIBILITY_RANGE.contractVersion, "metadata_contract_mismatch"],
    ["registryVersion", COMPATIBILITY_RANGE.registryVersion, "metadata_registry_mismatch"],
    ["openapi", COMPATIBILITY_RANGE.openapi, "metadata_openapi_mismatch"],
    ["minCliVersion", COMPATIBILITY_RANGE.minCliVersion, "metadata_cli_range_mismatch"],
    ["maxCliVersion", COMPATIBILITY_RANGE.maxCliVersion, "metadata_cli_range_mismatch"],
    ["contractsSha", CATALOG_SOURCE.contractsSha, "metadata_source_mismatch"],
  ];
  for (const [field, expectedValue, subtype] of expected) {
    const actual = metadata[field] as string;
    if (actual !== expectedValue) {
      throw compatibilityError(
        subtype,
        `Deployed ${field} ${actual} does not match this CLI's generated catalog ${expectedValue}.`,
        { field, expected: expectedValue, actual }
      );
    }
  }

  const cliCompatibility = checkCliCompatibility(
    { cliVersion, contractVersion: metadata.contractVersion },
    {
      contractVersion: metadata.contractVersion,
      registryVersion: metadata.registryVersion,
      minCliVersion: metadata.minCliVersion,
      maxCliVersion: metadata.maxCliVersion,
      openapi: metadata.openapi,
    }
  );
  if (!cliCompatibility.ok) {
    throw compatibilityError(
      "metadata_cli_version_mismatch",
      `CLI ${cliVersion} is outside the deployed CLI compatibility range ${metadata.minCliVersion}..${metadata.maxCliVersion}.`,
      { code: cliCompatibility.code, message: cliCompatibility.message }
    );
  }
  return metadata;
}

function metadataUrl(profile: ProfileConfig): string {
  const base = profile.apiBaseUrl.replace(/\/$/, "");
  return `${base.replace(/\/api\/v1$/, "")}${DEPLOYED_METADATA_PATH}`;
}

export async function verifyDeployedMetadata(
  profile: ProfileConfig,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch
): Promise<DeployedMetadata> {
  const requestId = newRequestId();
  let response: Response;
  try {
    response = await fetchImpl(metadataUrl(profile), {
      method: "GET",
      headers: {
        Accept: "application/json",
        "X-Request-Id": requestId,
        "X-Alphafox-Client": "alphafox-cli",
        "X-Alphafox-Client-Version": env.ALPHAFOX_CLI_VERSION ?? CLI_VERSION,
      },
      signal: AbortSignal.timeout(DEPLOYED_METADATA_TIMEOUT_MS),
    });
  } catch (err) {
    throw compatibilityError(
      "metadata_unavailable",
      `Unable to fetch deployed API metadata from ${DEPLOYED_METADATA_PATH}; refusing the operational request.`,
      { path: DEPLOYED_METADATA_PATH, cause: err instanceof Error ? err.message : String(err) }
    );
  }

  if (!response.ok) {
    throw compatibilityError(
      "metadata_unavailable",
      `Deployed API metadata returned HTTP ${response.status}; refusing the operational request.`,
      { path: DEPLOYED_METADATA_PATH, status: response.status }
    );
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch (err) {
    throw compatibilityError(
      "metadata_malformed",
      "Deployed API metadata was not valid JSON; refusing the operational request.",
      { path: DEPLOYED_METADATA_PATH, cause: err instanceof Error ? err.message : String(err) }
    );
  }
  return validateDeployedMetadata(json, profile);
}
