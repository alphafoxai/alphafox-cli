# Release: npm, Skills, supply chain (t101375)

## Package

| Field | Value |
|-------|--------|
| Name | `@alphafoxai/cli` |
| Binary | `alphafox` |
| Visibility | public npm (org `@alphafoxai`) |
| Node | LTS ≥ 20 |
| OS | macOS, Linux, Windows |

## Publish rules

- Publish **only** from CI on protected tags (`v*`)
- Prefer npm **trusted publishing / OIDC provenance** — no long-lived npm tokens
- 2FA required for org owners
- Package contents: `dist/`, `skills/`, README, docs — **no** secrets, fixtures, private endpoints, or `.env`

## Skills distribution

- Co-versioned inside the npm package under `skills/`
- Compatibility: Skills major aligns with CLI major; `contractVersion` must match API or CLI fails closed

## Support matrix

| Platform | Install | Keychain |
|----------|---------|----------|
| macOS | npm global / npx | Keychain Access |
| Linux | npm global / npx | Secret Service or file fallback 0600 |
| Windows | npm global / npx | Credential Manager (file fallback until implemented) |

## Channels

- `latest` — stable
- `next` — prerelease
- Deprecation window: ≥ 30 days for breaking contract changes

## Rollback

```bash
npm install -g @alphafoxai/cli@<previous>
alphafox version
alphafox doctor
```

## SBOM / audit

CI should generate SBOM (e.g. `cyclonedx` / `npm sbom`) and fail on critical vulns in runtime deps.
