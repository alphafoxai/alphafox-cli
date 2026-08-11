import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { buildAuthorizeUrl, generatePkcePair } from "../src/auth/pkce";

describe("PKCE helpers", () => {
  it("generates S256 challenge matching RFC 7636", () => {
    const pair = generatePkcePair();
    assert.equal(pair.codeChallengeMethod, "S256");
    assert.ok(pair.codeVerifier.length >= 43);
    const expected = createHash("sha256")
      .update(pair.codeVerifier, "utf8")
      .digest("base64url");
    assert.equal(pair.codeChallenge, expected);
  });

  it("builds authorize URL with code_challenge (not only method)", () => {
    const pair = generatePkcePair();
    const url = buildAuthorizeUrl({
      issuer: "http://127.0.0.1:3000/api/auth",
      clientId: "alphafox-cli-local",
      redirectUri: "http://127.0.0.1:8742/callback",
      codeChallenge: pair.codeChallenge,
      state: "abc",
    });
    const parsed = new URL(url);
    assert.equal(parsed.pathname, "/api/auth/oauth/authorize");
    assert.equal(parsed.searchParams.get("code_challenge_method"), "S256");
    assert.equal(parsed.searchParams.get("code_challenge"), pair.codeChallenge);
    assert.equal(parsed.searchParams.get("response_type"), "code");
    assert.ok(parsed.searchParams.get("code_challenge")!.length > 20);
  });
});
