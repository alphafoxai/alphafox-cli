# Agent Note: Keep the GCS runtime promises and drop the monorepo sibling preference

Status: implemented

## Problem

The short GCS migration page states the public discovery promise but not the local override order, anonymous fetch, or 16-hex fingerprint.
The archive conversion still prefers a monorepo `apps/engine` sibling.
Restoring that preference would point operators at a path this repository no longer has.

## Decision

The existing GCS / CDN / no-Blob-fallback promises stay.
A dated section on the same page records current `resolve-packages.ts` and `fetch-runtime.ts` behavior: independent-repo `../alphafox-engine` only with `ALPHAFOX_USE_LOCAL_BACKTEST=1`, anonymous `fetch`, protocol 1, nine-file 16-hex fingerprint, and Web as a different consumer.

## Alternatives considered

**Add a second subsystem page.** Rejected because the migration page already owns the consumer promise.

**Restore `apps/engine` as a lookup.** Rejected because current source does not implement it.

**Do nothing.** Rejected because operators would keep assuming monorepo sibling discovery.

## Consequences

- CLI `ci.yml` has no path filter; a documentation PR still runs `test:release`. Publish remains tag-triggered.
- No WASM download or local Engine build was run.

## Verification

Read `resolve-packages.ts` local/sibling order and `fetch-runtime.ts` manifest URL, protocol, nine-file list, and `fetch(..., { cache: "no-cache" })`.
Did not download a manifest.
