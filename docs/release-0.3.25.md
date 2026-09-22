# 0.3.25 release candidate — safety follow-up

**Status: preparation only; not evidence of npm publication.**
Tracking: [#37](https://github.com/alphafoxai/alphafox-cli/issues/37).
The maintainer chooses when to merge, tag and publish through the existing
protected-tag/OIDC workflow. This change does not publish or deploy anything.

## Included changes

- Includes the existing [#36](https://github.com/alphafoxai/alphafox-cli/pull/36)
  fix: `moving_average_breakout` keeps omitted leverage for the Engine schema's
  1x default instead of receiving the ordinary Web-form 10x seed. Adds run/sweep
  orchestration coverage and corrects the bundled backtest Skill. Explicit
  valid leverage and other definitions retain their previous runtime behavior.
- Agent policy: Engine trader creation defaults to explicit `autoStart: false`.
  Immediate start is permitted only when the reviewed approval includes it.
  Leverage comes from user input / the effective definition schema, not a
  blanket live-trading 10x rule. API schemas and server-side risk gates are
  unchanged. Copy endpoints keep their own contracts.
- Credential policy: document the existing plaintext fallback; offer opt-in
  `ALPHAFOX_REQUIRE_OS_KEYCHAIN=1` and tighten POSIX fallback-file permissions
  before writing token material. No automatic credential migration or deletion.
- CLI and all packaged Skills are co-versioned as `0.3.25`.

## Compatibility and operator notes

The start policy deliberately changes Agent guidance, not the raw API default.
Existing traders are not stopped or altered. A user who explicitly approves
immediate start can still create-and-start in one operation.

Default headless file fallback remains available. Strict mode is opt-in and
must remain set for every command, including refresh. It refuses conflicting
forced-file/test-token settings. Existing plaintext credentials are not made
secure merely by enabling strict mode; review their cleanup/revocation
separately. POSIX `0600` is not encryption or a Windows ACL guarantee.

The npm `0.3.24` artifact predates #36; updating GitHub documentation alone
cannot fix an already installed package. After publication, operators should
update the CLI and its co-versioned Skills together, then restart their Agent.

## Maintainer release gates

- [ ] Review and approve the Agent-policy change and strict-storage semantics.
- [ ] Run `pnpm typecheck` and `pnpm test:release` (includes the build).
- [ ] `npm pack --ignore-scripts` after the build; inspect the actual tarball.
- [ ] Verify package.json, `alphafox version`, all Skills and the verified
      `dist/skills-manifest.json` report the same version.
- [ ] Verify the packed backtest helper preserves omitted
      `moving_average_breakout` leverage, preserves explicit leverage, and
      continues to seed ordinary definitions as before.
- [ ] Complete the normal SBOM/runtime critical-audit checks and publish via
      the protected `v0.3.25` tag workflow (or adjust all version fields together
      if another release takes that version first).
- [ ] Read npm metadata back and inspect the newly published artifact rather
      than treating a merged PR or successful local build as a release.
- [ ] Close #37 only after its publication acceptance criterion is met.

Full `pnpm test` additionally needs the sibling Contracts/Web checkouts; a
package-local test pass is not a claim that those integration tests ran.
