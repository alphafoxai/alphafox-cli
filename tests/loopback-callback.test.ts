import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { startLoopbackCallbackServer } from "../src/auth/loopback-callback";

async function getCallback(
  redirectUri: string,
  search: string,
  extra: RequestInit = {}
): Promise<Response> {
  return fetch(`${redirectUri}${search}`, extra);
}

describe("loopback callback server", () => {
  it("accepts a valid code+state callback once", async () => {
    const state = "state-one";
    const server = await startLoopbackCallbackServer({
      expectedState: state,
      timeoutMs: 5_000,
    });
    try {
      assert.match(server.redirectUri, /^http:\/\/127\.0\.0\.1:\d+\/callback$/);
      const wait = server.wait();
      const res = await getCallback(
        server.redirectUri,
        `?code=auth-code-1&state=${state}`
      );
      assert.equal(res.status, 200);
      const html = await res.text();
      assert.match(html, /已登录/);
      assert.equal(html.includes("auth-code-1"), false);
      assert.equal(html.toLowerCase().includes("token"), false);
      assert.equal(html.includes("verifier"), false);

      const result = await wait;
      assert.equal(result.status, "success");
      if (result.status === "success") {
        assert.equal(result.code, "auth-code-1");
        assert.equal(result.state, state);
      }

      const dup = await getCallback(
        server.redirectUri,
        `?code=auth-code-2&state=${state}`
      );
      assert.equal(dup.status, 409);
      const dupHtml = await dup.text();
      assert.equal(dupHtml.includes("auth-code-2"), false);
      const stillFirst = await server.wait();
      assert.equal(stillFirst.status, "success");
      if (stillFirst.status === "success") {
        assert.equal(stillFirst.code, "auth-code-1");
      }
    } finally {
      await server.close();
    }
  });

  it("rejects state mismatch", async () => {
    const server = await startLoopbackCallbackServer({
      expectedState: "expected-state",
      timeoutMs: 5_000,
    });
    try {
      const wait = server.wait();
      const res = await getCallback(
        server.redirectUri,
        "?code=auth-code-1&state=wrong-state"
      );
      assert.equal(res.status, 400);
      const result = await wait;
      assert.equal(result.status, "state_mismatch");
    } finally {
      await server.close();
    }
  });

  it("rejects OAuth error query without treating it as success", async () => {
    const server = await startLoopbackCallbackServer({
      expectedState: "s",
      timeoutMs: 5_000,
    });
    try {
      const wait = server.wait();
      const res = await getCallback(
        server.redirectUri,
        "?error=access_denied&error_description=user_rejected&state=s"
      );
      assert.equal(res.status, 400);
      const html = await res.text();
      assert.equal(html.includes("user_rejected"), false);
      const result = await wait;
      assert.equal(result.status, "oauth_error");
      if (result.status === "oauth_error") {
        assert.equal(result.error, "access_denied");
      }
    } finally {
      await server.close();
    }
  });

  it("times out when no callback arrives", async () => {
    const server = await startLoopbackCallbackServer({
      expectedState: "s",
      timeoutMs: 50,
    });
    try {
      const result = await server.wait();
      assert.equal(result.status, "timeout");
    } finally {
      await server.close();
    }
  });

  it("does not settle on an unknown path", async () => {
    const server = await startLoopbackCallbackServer({
      expectedState: "s",
      timeoutMs: 5_000,
    });
    try {
      const origin = `http://127.0.0.1:${server.port}`;
      const miss = await fetch(`${origin}/not-callback?code=x&state=s`);
      assert.equal(miss.status, 404);
      const wait = server.wait();
      const ok = await getCallback(server.redirectUri, "?code=real&state=s");
      assert.equal(ok.status, 200);
      const result = await wait;
      assert.equal(result.status, "success");
    } finally {
      await server.close();
    }
  });
});
