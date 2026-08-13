/**
 * One-shot RFC 8252 loopback callback server for Authorization Code + PKCE.
 * Binds 127.0.0.1 only. HTML responses never include code, token, or verifier.
 */

import { timingSafeEqual } from "node:crypto";
import http from "node:http";

export const LOOPBACK_CALLBACK_PATH = "/callback";

export type LoopbackCallbackResult =
  | { readonly status: "success"; readonly code: string; readonly state: string }
  | {
      readonly status: "oauth_error";
      readonly error: string;
      readonly errorDescription?: string;
    }
  | { readonly status: "state_mismatch" }
  | { readonly status: "missing_code" }
  | { readonly status: "timeout" };

export interface LoopbackCallbackServer {
  readonly redirectUri: string;
  readonly port: number;
  wait(): Promise<LoopbackCallbackResult>;
  close(): Promise<void>;
}

const SUCCESS_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Alphafox CLI</title></head>
<body><p>Signed in. You can close this window and return to the CLI.</p></body></html>
`;

const FAILURE_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Alphafox CLI</title></head>
<body><p>Authorization failed. You can close this window and return to the CLI.</p></body></html>
`;

const DUPLICATE_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Alphafox CLI</title></head>
<body><p>This login callback was already used. You can close this window.</p></body></html>
`;

export async function startLoopbackCallbackServer(options: {
  readonly expectedState: string;
  readonly timeoutMs?: number;
  readonly path?: string;
  readonly port?: number;
}): Promise<LoopbackCallbackServer> {
  const callbackPath = options.path ?? LOOPBACK_CALLBACK_PATH;
  const timeoutMs = options.timeoutMs ?? 300_000;
  const expectedState = options.expectedState;

  let settled = false;
  let timer: NodeJS.Timeout | undefined;
  let resolveDone!: (result: LoopbackCallbackResult) => void;
  const done = new Promise<LoopbackCallbackResult>((resolve) => {
    resolveDone = resolve;
  });

  const server = http.createServer((req, res) => {
    handleLoopbackRequest(req, res, {
      callbackPath,
      expectedState,
      isSettled: () => settled,
      settle: (result, httpStatus) => {
        if (settled) {
          res.writeHead(409, htmlHeaders());
          res.end(DUPLICATE_HTML);
          return;
        }
        settled = true;
        if (timer) clearTimeout(timer);
        res.writeHead(httpStatus, htmlHeaders());
        res.end(httpStatus === 200 ? SUCCESS_HTML : FAILURE_HTML);
        resolveDone(result);
      },
    });
  });

  await listenLoopback(server, options.port ?? 0);

  const addr = server.address();
  if (!addr || typeof addr === "string") {
    server.close();
    throw new Error("loopback server did not bind a TCP port");
  }

  const redirectUri = `http://127.0.0.1:${addr.port}${callbackPath}`;

  timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    resolveDone({ status: "timeout" });
  }, timeoutMs);
  timer.unref?.();

  let closed = false;
  return {
    redirectUri,
    port: addr.port,
    wait: () => done,
    close: async () => {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      await closeServer(server);
    },
  };
}

function htmlHeaders(): http.OutgoingHttpHeaders {
  return {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  };
}

function handleLoopbackRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: {
    readonly callbackPath: string;
    readonly expectedState: string;
    readonly isSettled: () => boolean;
    readonly settle: (result: LoopbackCallbackResult, httpStatus: number) => void;
  }
): void {
  if (ctx.isSettled()) {
    res.writeHead(409, htmlHeaders());
    res.end(DUPLICATE_HTML);
    return;
  }

  if (!isLoopbackHostHeader(req.headers.host)) {
    res.writeHead(400, htmlHeaders());
    res.end(FAILURE_HTML);
    return;
  }

  if (req.method !== "GET") {
    res.writeHead(405, htmlHeaders());
    res.end(FAILURE_HTML);
    return;
  }

  let parsed: URL;
  try {
    parsed = new URL(req.url ?? "/", "http://127.0.0.1");
  } catch {
    res.writeHead(400, htmlHeaders());
    res.end(FAILURE_HTML);
    return;
  }

  if (parsed.pathname !== ctx.callbackPath) {
    res.writeHead(404, htmlHeaders());
    res.end(FAILURE_HTML);
    return;
  }

  const oauthError = parsed.searchParams.get("error");
  if (oauthError) {
    ctx.settle(
      {
        status: "oauth_error",
        error: oauthError,
        errorDescription: parsed.searchParams.get("error_description") ?? undefined,
      },
      400
    );
    return;
  }

  const state = parsed.searchParams.get("state") ?? "";
  if (!statesEqual(state, ctx.expectedState)) {
    ctx.settle({ status: "state_mismatch" }, 400);
    return;
  }

  const code = parsed.searchParams.get("code")?.trim() ?? "";
  if (!code) {
    ctx.settle({ status: "missing_code" }, 400);
    return;
  }

  ctx.settle({ status: "success", code, state }, 200);
}

function isLoopbackHostHeader(host: string | undefined): boolean {
  if (!host) return false;
  const hostname = host.split(":")[0]?.toLowerCase() ?? "";
  return hostname === "127.0.0.1" || hostname === "localhost";
}

function statesEqual(actual: string, expected: string): boolean {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function listenLoopback(server: http.Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error) => {
      server.off("error", onError);
      reject(err);
    };
    server.once("error", onError);
    server.listen({ host: "127.0.0.1", port }, () => {
      server.off("error", onError);
      resolve();
    });
  });
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => {
    if (typeof server.closeAllConnections === "function") {
      server.closeAllConnections();
    }
    server.close(() => resolve());
  });
}
