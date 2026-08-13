/**
 * Equivalent of `@alphafoxai/contracts/public-api` `checkCliCompatibility`.
 * Fail closed on CLI/contract version skew. Do not invent a second range:
 * callers must pass the generated registry compatibility block.
 */

export interface CompatibilityRange {
  readonly contractVersion: string;
  readonly registryVersion: string;
  readonly minCliVersion: string;
  readonly maxCliVersion: string;
  readonly openapi: string;
}

export type CompatibilityResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code:
        | "cli_too_old"
        | "cli_too_new"
        | "contract_mismatch"
        | "invalid_version";
      readonly message: string;
    };

function parseSemver(raw: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(raw.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function cmpSemver(a: string, b: string): number | null {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return pa[i]! - pb[i]!;
  }
  return 0;
}

export function checkCliCompatibility(
  input: {
    readonly cliVersion: string;
    readonly contractVersion: string;
  },
  range: CompatibilityRange
): CompatibilityResult {
  const cliVsMin = cmpSemver(input.cliVersion, range.minCliVersion);
  const cliVsMax = cmpSemver(input.cliVersion, range.maxCliVersion);
  if (cliVsMin === null || cliVsMax === null) {
    return {
      ok: false,
      code: "invalid_version",
      message: `CLI version ${input.cliVersion} is not valid semver (expected MAJOR.MINOR.PATCH).`,
    };
  }
  if (cliVsMin < 0) {
    return {
      ok: false,
      code: "cli_too_old",
      message: `CLI ${input.cliVersion} is older than minCliVersion ${range.minCliVersion} for contract ${range.contractVersion}.`,
    };
  }
  if (cliVsMax > 0) {
    return {
      ok: false,
      code: "cli_too_new",
      message: `CLI ${input.cliVersion} is newer than maxCliVersion ${range.maxCliVersion} for contract ${range.contractVersion}.`,
    };
  }
  if (input.contractVersion !== range.contractVersion) {
    return {
      ok: false,
      code: "contract_mismatch",
      message: `Server contractVersion ${input.contractVersion} does not match CLI catalog ${range.contractVersion}.`,
    };
  }
  return { ok: true };
}
