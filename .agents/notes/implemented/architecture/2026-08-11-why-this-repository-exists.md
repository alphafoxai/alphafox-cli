# Agent Note: Publish the public CLI as its own package

Status: implemented

## Problem

Agents and humans need a versioned entry to the Public Application API that can install
from npm, carry co-versioned Skills, and run a local WASM backtest without cloning the
web app. Those release and permission needs are not the same as deploying the website.

## Decision

`alphafox-cli` is the public `alphafox` CLI. It talks to the Public Application API
served by `alphafox-web`, ships Agent Skills beside the binary, and vendors a local
WASM backtest runner so the public package does not need GitHub Packages. This
repository is public and publishes to npm. It does not own the chat workbench, Chat
Backtest HTTP handlers, Strategy Plaza, or web `/api/v1/backtests`; those stay on
`alphafox-web`. The catalog is generated from `alphafox-contracts`. Uninstalling the
CLI does not delete server-side traders or account data.

## Alternatives considered

The alternatives weighed when this repository was created are not recorded.

## Consequences

- CLI version, Skills, and catalog ship together as a package, not as a web deploy.
- Web remains the owner of the Public API handlers the CLI calls.
