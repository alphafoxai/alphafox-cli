#!/usr/bin/env node
/**
 * Staging Device Flow helper: password sign-in + device approve.
 * Usage:
 *   node scripts/e2e-staging-device-approve.mjs --user-code ABCD1234
 *
 * Origin is always https://staging.alphafox.app. Does not print the password
 * or Set-Cookie values.
 */
"use strict";

const ORIGIN = "https://staging.alphafox.app";
const EMAIL = process.env.ALPHAFOX_E2E_EMAIL;
const PASSWORD = process.env.ALPHAFOX_E2E_PASSWORD;

function argValue(name) {
  const idx = process.argv.indexOf(name);
  if (idx >= 0) {
    return process.argv[idx + 1];
  }
  const prefix = `${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

function cookieHeaderFromSetCookie(setCookie) {
  const parts = [];
  for (const entry of setCookie) {
    const pair = entry.split(";", 1)[0]?.trim();
    if (pair) {
      parts.push(pair);
    }
  }
  return parts.join("; ");
}

async function main() {
  const userCode = (argValue("--user-code") || "").trim().toUpperCase();
  if (!EMAIL || !PASSWORD) {
    console.error("ALPHAFOX_E2E_EMAIL and ALPHAFOX_E2E_PASSWORD are required");
    process.exit(2);
  }
  if (!userCode) {
    console.error("Usage: node scripts/e2e-staging-device-approve.mjs --user-code <code>");
    process.exit(2);
  }

  const signIn = await fetch(`${ORIGIN}/api/auth/sign-in/email`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      accept: "application/json",
    },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    redirect: "manual",
  });
  const signInRequestId = signIn.headers.get("x-request-id") || "";
  const signInBody = await signIn.text();
  if (signIn.status >= 400) {
    console.log(
      JSON.stringify({
        ok: false,
        step: "sign-in",
        status: signIn.status,
        requestId: signInRequestId,
        body: signInBody.slice(0, 400),
      })
    );
    process.exit(1);
  }

  const cookie = cookieHeaderFromSetCookie(signIn.headers.getSetCookie?.() ?? []);
  if (!cookie) {
    console.log(
      JSON.stringify({
        ok: false,
        step: "sign-in",
        status: signIn.status,
        requestId: signInRequestId,
        error: "no_session_cookie",
      })
    );
    process.exit(1);
  }

  const approve = await fetch(`${ORIGIN}/api/auth/oauth/device/approve`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      cookie,
    },
    body: JSON.stringify({ user_code: userCode, action: "approve" }),
  });
  const approveRequestId = approve.headers.get("x-request-id") || "";
  const approveText = await approve.text();
  let approveJson = {};
  try {
    approveJson = JSON.parse(approveText);
  } catch {
    approveJson = { raw: approveText.slice(0, 200) };
  }
  const ok = approve.status >= 200 && approve.status < 300 && approveJson.approved === true;
  console.log(
    JSON.stringify({
      ok,
      step: "approve",
      status: approve.status,
      requestId: approveRequestId,
      signInStatus: signIn.status,
      signInRequestId,
      approved: approveJson.approved === true,
      user_code: userCode,
    })
  );
  process.exit(ok ? 0 : 1);
}

main().catch((error) => {
  console.error(String(error && error.message ? error.message : error));
  process.exit(1);
});
