# Dependency security remediation

Verified on 2026-11-19 with Node 24.22.3 and pnpm 11.5.2.

## Scope

All 85 reported dependency findings were cleared, including findings in the
archived offline-tool trace's captured dependency lockfile. No advisories were
suppressed or excluded, and the minimum package release-age protection remains
enabled.

- Updated Express and the affected HTTP, parsing, archive, browser-targeting,
  build, and test dependencies to patched versions.
- Kept transitive security floors in `pnpm-workspace.yaml`, the authoritative
  override configuration for this pnpm version.
- Upgraded Zod to 4.6.7 and regenerated the API schemas with Orval's Zod 4
  output. The API contract itself was not changed.
- Upgraded both artifacts' React Hook Form resolvers to a Zod 4-compatible
  version. Both operational forms use the same tested resolver; its typed
  boundary preserves the forms' numeric values while retaining schema validation.
- Updated the archived lockfile's affected resolutions, dependencies, and
  matching workspace overrides. Its historical trace output was not rewritten;
  it describes the original run, not a replay with the patched dependencies.

## Verification

| Check | Result |
| --- | --- |
| Full repository dependency scan | 0 findings at every severity |
| `pnpm audit --json` including development dependencies | 0 vulnerabilities |
| Frozen-lockfile install | Passed |
| Full workspace type check and generated-contract freshness | Passed |
| API unit tests | 1,027 passed |
| Generated API contract tests | 4 passed |
| Shared-library tests | 1,244 passed |
| Web tests, including resolver regressions | 2,344 passed |
| V2 tests | 156 passed |
| Web production/PWA build and V2 syntax build | Passed |
| API startup and health | Passed; database and dependencies healthy |
| Web startup and public sign-in screen | Passed |
| Archived YAML and updated package snapshot dependency references | Passed |

The resolver regressions exercise the production resolver directly, including a
nested invalid recipe value, and rendered React Hook Form validation in both
`onChange` and `onSubmit` modes. They verify invalid entries produce field errors
without rejecting, prevent submission, and allow corrected entries to submit.

Machine-readable audit evidence and captured test/build logs are retained in
the ignored `generated-artifacts/dependency-security/` directory. Signed-in
screens were not verified in a browser. These changes were not deployed.
