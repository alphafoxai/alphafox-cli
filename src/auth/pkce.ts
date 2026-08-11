import { createHash, randomBytes } from "node:crypto";

export function generatePkcePair(): {
  readonly codeVerifier: string;
  readonly codeChallenge: string;
  readonly codeChallengeMethod: "S256";
} {
  const codeVerifier = randomBytes(32).toString("base64url");
  const codeChallenge = createHash("sha256")
    .update(codeVerifier, "utf8")
    .digest("base64url");
  return {
    codeVerifier,
    codeChallenge,
    codeChallengeMethod: "S256",
  };
}

export function buildAuthorizeUrl(input: {
  readonly issuer: string;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly codeChallenge: string;
  readonly state: string;
  readonly scope?: string;
}): string {
  const authorize = new URL(`${input.issuer.replace(/\/$/, "")}/oauth/authorize`);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("client_id", input.clientId);
  authorize.searchParams.set("redirect_uri", input.redirectUri);
  authorize.searchParams.set("code_challenge", input.codeChallenge);
  authorize.searchParams.set("code_challenge_method", "S256");
  authorize.searchParams.set("state", input.state);
  authorize.searchParams.set(
    "scope",
    input.scope ?? "openid profile offline_access"
  );
  return authorize.toString();
}
