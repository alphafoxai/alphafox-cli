# Agent Note: Pin CI actions, add Dependabot, and gate high-severity runtime advisories

Status: implemented

## Problem

CI referenced actions by mutable tags, no bot proposed dependency updates, and the test job did not fail on known high or critical runtime advisories.

## Decision

- Every third-party `uses:` in the workflows and composite actions is pinned to a full commit SHA with the version as a trailing comment; local and docker:// refs are unchanged.
- Dependabot opens weekly, grouped minor/patch updates per ecosystem, waits seven days after a release (cooldown), and keeps SHA pins current. Auto-merge is not enabled.
- The `test` job runs `pnpm audit --prod --audit-level high` after the frozen install. Undici (through ccxt) and fast-uri are fixed by in-major overrides in `package.json`. The vendored copy under `vendor/backtest-runner` has no lockfile and is not gated here; the engine owns it.

## Alternatives considered

Ignore the ccxt undici advisories. Rejected: the in-major patch is available, so the advisory can be fixed directly.

## Consequences

The ccxt-dependent lockfile changed. It was verified with `--frozen-lockfile --lockfile-only` only; the CI runner runs the full test.
