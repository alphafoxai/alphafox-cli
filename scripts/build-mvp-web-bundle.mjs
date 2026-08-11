/**
 * Compile a thin copy of shipped alphafox-web OAuth + MVP handlers for
 * integration tests without full Next.js install.
 * Sources are copied from alphafox-web (not reimplemented). Only:
 * - `@/` imports rewritten to relative paths
 * - client.ts / session.ts cookie stubs (bearer path is the real code)
 */
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const cliRoot = join(here, "..");
const webRoot = join(cliRoot, "..", "alphafox-web");
const outRoot = join(cliRoot, "dist-mvp-web");
const compileRoot = join(outRoot, "compile");

function ensureDir(p) {
  mkdirSync(p, { recursive: true });
}

function copyFile(src, dest) {
  ensureDir(dirname(dest));
  cpSync(src, dest);
}

function walkTs(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walkTs(p, acc);
    else if (name.endsWith(".ts")) acc.push(p);
  }
  return acc;
}

rmSync(outRoot, { recursive: true, force: true });
ensureDir(compileRoot);

// OAuth lib + request guard + public API handlers + routes (from shipped web)
ensureDir(join(compileRoot, "lib/auth"));
cpSync(join(webRoot, "lib/auth/oauth"), join(compileRoot, "lib/auth/oauth"), {
  recursive: true,
});
copyFile(
  join(webRoot, "lib/auth/request-guard.ts"),
  join(compileRoot, "lib/auth/request-guard.ts")
);
ensureDir(join(compileRoot, "server/public-api"));
copyFile(
  join(webRoot, "server/public-api/errors.ts"),
  join(compileRoot, "server/public-api/errors.ts")
);
copyFile(
  join(webRoot, "server/public-api/mvp-handlers.ts"),
  join(compileRoot, "server/public-api/mvp-handlers.ts")
);
cpSync(
  join(webRoot, "app/api/auth/oauth"),
  join(compileRoot, "app/api/auth/oauth"),
  { recursive: true }
);

const v1Paths = [
  "me",
  "trading/strategy-definitions",
  "trading/traders",
  "exchange-connectors",
  "chats",
  "backtests",
  "backtests/[backtestId]",
  "backtests/[backtestId]/cancel",
];
for (const p of v1Paths) {
  const src = join(webRoot, "app/api/v1", p, "route.ts");
  const dest = join(compileRoot, "app/api/v1", p, "route.ts");
  copyFile(src, dest);
}

writeFileSync(
  join(compileRoot, "lib/auth/client.ts"),
  `export type AuthSession = {
  user: {
    id: string;
    email: string;
    name: string;
    emailVerified: boolean;
    createdAt: Date;
    updatedAt: Date;
    image: string | null;
  };
  session: {
    id: string;
    userId: string;
    token: string;
    expiresAt: Date;
    createdAt: Date;
    updatedAt: Date;
    ipAddress: string | null;
    userAgent: string | null;
  };
};
`
);

writeFileSync(
  join(compileRoot, "lib/auth/session.ts"),
  `import type { AuthSession } from "./client";
/** Cookie session stub for offline MVP tests; production uses real session.ts. */
export async function getRequestAuthSession(
  _request: Pick<Request, "headers">
): Promise<AuthSession | null> {
  return null;
}
export async function getFreshRequestAuthSession(
  _request: Pick<Request, "headers">
): Promise<AuthSession | null> {
  return null;
}
`
);

// Rewrite @/ imports
for (const file of walkTs(compileRoot)) {
  let text = readFileSync(file, "utf8");
  text = text.replace(/from\s+["']@\/([^"']+)["']/g, (_m, target) => {
    const abs = join(compileRoot, target);
    let rel = relative(dirname(file), abs);
    if (!rel.startsWith(".")) rel = `./${rel}`;
    return `from "${rel}"`;
  });
  text = text.replace(/import\(\s*["']@\/([^"']+)["']\s*\)/g, (_m, target) => {
    const abs = join(compileRoot, target);
    let rel = relative(dirname(file), abs);
    if (!rel.startsWith(".")) rel = `./${rel}`;
    return `import("${rel}")`;
  });
  writeFileSync(file, text);
}

writeFileSync(
  join(outRoot, "tsconfig.json"),
  JSON.stringify(
    {
      compilerOptions: {
        target: "ES2022",
        module: "CommonJS",
        moduleResolution: "Node",
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        ignoreDeprecations: "6.0",
        outDir: "./js",
        rootDir: "./compile",
        declaration: false,
        types: ["node"],
      },
      include: ["./compile/**/*.ts"],
    },
    null,
    2
  )
);

const tsc = join(cliRoot, "node_modules/.bin/tsc");
const r = spawnSync(tsc, ["-p", join(outRoot, "tsconfig.json")], {
  encoding: "utf8",
});
if (r.status !== 0) {
  process.stderr.write(r.stdout || "");
  process.stderr.write(r.stderr || "");
  process.exit(r.status ?? 1);
}
console.log("mvp-web-bundle: ok", join(outRoot, "js"));
