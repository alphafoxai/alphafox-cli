import { runCli } from "./commands/run";

async function main(): Promise<void> {
  const code = await runCli(process.argv.slice(2), process.env);
  if (typeof code === "number") {
    process.exit(code);
  }
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(
    `${JSON.stringify({
      ok: false,
      error: { type: "runtime", message },
    })}\n`
  );
  process.exit(1);
});
