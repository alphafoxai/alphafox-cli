import { writeError, writeSuccess } from "../envelope";
import { removeCacheRoot } from "./clean";

export interface CacheCliFlags {
  readonly format: "json" | "jsonl" | "text";
  readonly yes: boolean;
  readonly dryRun: boolean;
  readonly jq?: string;
}
import { inspectDirectory } from "./inspect";
import {
  resolveRuntimeCacheRoot,
  resolveTapeCacheDir,
  TAPE_CACHE_REMIND_BYTES,
} from "./paths";

export async function cmdCache(
  args: string[],
  flags: CacheCliFlags,
  env: NodeJS.ProcessEnv = process.env
): Promise<number> {
  const sub = args[0];
  if (sub === "status" || !sub || sub === "help" || sub === "--help" || sub === "-h") {
    if (sub === "help" || sub === "--help" || sub === "-h") {
      writeSuccess(
        {
          name: "cache",
          usage: [
            "alphafox cache status",
            "alphafox cache clean [--tape|--runtime|--all] [--yes|--dry-run]",
          ],
        },
        { format: flags.format, jq: flags.jq }
      );
      return 0;
    }
    const tape = inspectDirectory(resolveTapeCacheDir(env));
    const runtime = inspectDirectory(resolveRuntimeCacheRoot(env));
    writeSuccess(
      {
        tape: { ...tape, large: tape.bytes >= TAPE_CACHE_REMIND_BYTES },
        runtime,
        remindAfterBytes: TAPE_CACHE_REMIND_BYTES,
        totalBytes: tape.bytes + runtime.bytes,
      },
      { format: flags.format, jq: flags.jq }
    );
    return 0;
  }

  if (sub === "clean") {
    const rest = args.slice(1);
    const all = rest.includes("--all");
    const runtimeOnly = rest.includes("--runtime");
    const tapeOnly = rest.includes("--tape") || (!all && !runtimeOnly);
    const clearTape = all || tapeOnly;
    const clearRuntime = all || runtimeOnly;

    const tapePath = resolveTapeCacheDir(env);
    const runtimePath = resolveRuntimeCacheRoot(env);
    const tapeBefore = inspectDirectory(tapePath);
    const runtimeBefore = inspectDirectory(runtimePath);

    if (flags.dryRun) {
      writeSuccess(
        {
          dryRun: true,
          cleared: [
            ...(clearTape ? (["tape"] as const) : []),
            ...(clearRuntime ? (["runtime"] as const) : []),
          ],
          tape: tapeBefore,
          runtime: runtimeBefore,
        },
        { format: flags.format, jq: flags.jq }
      );
      return 0;
    }

    if (!flags.yes) {
      writeError({
        type: "confirmation",
        subtype: "yes_required",
        message:
          "Cleaning local backtest cache requires --yes (or --dry-run).",
        status: 400,
      });
    }

    if (clearTape) {
      removeCacheRoot(tapePath, env);
    }
    if (clearRuntime) {
      removeCacheRoot(runtimePath, env);
    }

    writeSuccess(
      {
        dryRun: false,
        cleared: [
          ...(clearTape ? (["tape"] as const) : []),
          ...(clearRuntime ? (["runtime"] as const) : []),
        ],
        tape: inspectDirectory(tapePath),
        runtime: inspectDirectory(runtimePath),
        bytesFreed:
          (clearTape ? tapeBefore.bytes : 0) +
          (clearRuntime ? runtimeBefore.bytes : 0),
      },
      { format: flags.format, jq: flags.jq }
    );
    return 0;
  }

  writeError({
    type: "usage",
    message: "Usage: alphafox cache status|clean",
  });
}
