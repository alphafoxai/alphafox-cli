import { ResolveSymbolsError } from "./errors";
import {
  RESOLVE_SYMBOLS_DEFAULT_EXCHANGE,
  resolveSymbolsExchangeId,
} from "./exchanges";
import type { ResolveSymbolsRunArgs } from "./types";

export const RESOLVE_SYMBOLS_DEFAULT_LIMIT = 8;
export const RESOLVE_SYMBOLS_MAX_LIMIT = 25;

export const RESOLVE_SYMBOLS_USAGE = [
  "alphafox resolve-symbols <query...> [--exchange binance] [--limit 8]",
  "alphafox resolve-symbols --query BTC --query ETH --exchange okx",
];

function usage(message: string, subtype = "invalid_args"): never {
  throw new ResolveSymbolsError({
    type: "usage",
    subtype,
    message,
    hint: RESOLVE_SYMBOLS_USAGE[0],
    status: 400,
  });
}

function takeValue(
  args: readonly string[],
  i: number,
  flag: string
): { readonly value: string; readonly next: number } {
  const next = args[i + 1];
  if (next === undefined || next.startsWith("--")) {
    usage(`Missing value for ${flag}`, "missing_flag_value");
  }
  return { value: next, next: i + 1 };
}

export function parseResolveSymbolsArgs(
  args: readonly string[]
): ResolveSymbolsRunArgs {
  const queries: string[] = [];
  let exchange = RESOLVE_SYMBOLS_DEFAULT_EXCHANGE;
  let limit = RESOLVE_SYMBOLS_DEFAULT_LIMIT;
  let help = false;

  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]!;
    if (a === "--help" || a === "-h") {
      help = true;
      continue;
    }
    if (!a.startsWith("--")) {
      queries.push(a);
      continue;
    }

    const eq = a.indexOf("=");
    const flag = eq >= 0 ? a.slice(0, eq) : a;
    const inline = eq >= 0 ? a.slice(eq + 1) : undefined;
    const read = (): string => {
      if (inline !== undefined) return inline;
      const taken = takeValue(args, i, flag);
      i = taken.next;
      return taken.value;
    };

    switch (flag) {
      case "--query":
      case "--symbol":
        queries.push(read());
        break;
      case "--exchange":
        exchange = read();
        break;
      case "--limit": {
        const n = Number(read());
        if (!Number.isInteger(n) || n <= 0 || n > RESOLVE_SYMBOLS_MAX_LIMIT) {
          usage(
            `--limit must be an integer 1..${RESOLVE_SYMBOLS_MAX_LIMIT}`,
            "invalid_limit"
          );
        }
        limit = n;
        break;
      }
      default:
        usage(`Unknown flag: ${flag}`, "unknown_flag");
    }
  }

  if (help) {
    return { help: true, queries: [], exchange, limit };
  }

  const normalizedQueries = queries.map((item) => item.trim()).filter(Boolean);
  if (normalizedQueries.length === 0) {
    usage("Provide at least one symbol query", "missing_query");
  }

  let resolvedExchange: string;
  try {
    resolvedExchange = resolveSymbolsExchangeId(exchange).id;
  } catch (err) {
    usage(err instanceof Error ? err.message : String(err), "invalid_exchange");
  }

  return {
    help: false,
    queries: uniqueQueries(normalizedQueries),
    exchange: resolvedExchange,
    limit,
  };
}

function uniqueQueries(queries: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const query of queries) {
    const key = query.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(query);
  }
  return out;
}
