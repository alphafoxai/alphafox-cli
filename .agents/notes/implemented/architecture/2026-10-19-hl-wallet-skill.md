# Agent Note: Ship Hyperliquid wallet history as a read-only Skill over catalog operations

Status: implemented

## Problem

The product design gives the Hyperliquid trader research base two entry points: the web
wallet page and an Agent Skill that uses the same facts and metric definitions. The CLI had no
wallet history operations, so an Agent could not answer "how did this wallet trade" without
being given another data source. Without guidance it would also make three mistakes:

- read a missing day as zero activity;
- count deposits and withdrawals as profit;
- present one account's notional as market volume.

## Decision

alphafox-contracts registry 4.1.0 publishes `hl_wallet.{summary,equity,ledger,positions,
activity}.get`. The regenerated catalog exposes them as typed commands such as
`alphafox hl_wallet summary get`. No new command code is needed.

A new `alphafox-hl-wallet` Skill, routed from `alphafox`, carries the domain rules:

- read `status` and `coverage` before any number, and never treat an unavailable day as zero;
- compute net PnL and its attribution with the analytics definitions, and keep `unexplained`
  as its own number;
- compute drawdown from cumulative net PnL, not raw equity;
- act on errors by HTTP status, because the CLI envelope keeps the status and message but not
  the route's `error` string;
- say that the access is admin-only while the history backfill runs, and that analyzing a
  wallet never implies copying it.

The Skill names no internal service, host or credential. The repository is public.

## Alternatives considered

**A hand-written `alphafox hl-wallet` command.** The typed catalog commands already validate
the operation and carry auth, profiles and the envelope. A wrapper would duplicate them and
drift from the registry.

**Extract the `error` string into the envelope `code`.** That would change the error output of
every operation whose server returns `{error, message}`. It can be done separately. The Skill
works from `status`.

**Wait for the full backfill.** The coverage-first rules are the same for partial and complete
history, and admins can use the data now.

## Consequences

Opening the operations to non-admin users changes only alphafox-web and the Skill's access
line. Controlled SQL and wallet similarity search are not in this surface; they need their own
service work first.

## Verification

`tests/skills-surface.test.ts` checks:

- the router row;
- the coverage, net PnL and admin rules;
- that each listed operationId is a catalog read;
- that each example command resolves through `resolveTypedCommand`.

`tests/catalog-registry.test.ts` pins registry 4.1.0. The generated catalog differs from main
only by the five operations and the registry version string. The repository depends on ccxt,
so its tests run in CI, not locally.
