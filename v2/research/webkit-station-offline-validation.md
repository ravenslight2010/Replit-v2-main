# V2 station and offline WebKit verification

**Date:** 2026-11-21

## Environment

- Node `v24.22.3`
- Chromium `138.0.7204.100`
- Nix `playwright-test` `1.52.0`, WebKit `18.4`
- Headless WPE runtime with the Nix Mesa EGL manifest
- Browser tests ran serially. `V2_REQUIRE_WEBKIT=true` was set, and
  `V2_SKIP_WEBKIT` was not set.

## Focused WebKit journeys

Each workflow below was selected and run alone with the Nix Playwright module
and WebKit executable, using `node --test --test-concurrency=1 --test-reporter=spec
--test-name-pattern='<workflow>.*webkit' e2e/station-sync.browser.test.mjs`.
Every focused command reported `tests 1`, `pass 1`, `fail 0`, `skipped 0`.

| Journey | Exact passing test output |
|---|---|
| Substitutions and allergen status | `✔ run substitution and allergen status stays run-bound and readable in webkit (6487.253135ms)` |
| Mix Plan | `✔ operators can review the read-only Mix Plan across roles, reload, and responsive widths in webkit (2556.274206ms)` |
| Setup catalog | `✔ manager reviews, applies, and safely undoes a setup catalog across responsive widths in webkit (2113.833287ms)` |
| Sauce import | `✔ manager previews, applies, and reopens a sauce import in webkit (2467.222784ms)` |

The standalone QC manager/operator browser journey was also run with
`QC_BROWSER=webkit node --test --test-concurrency=1 --test-reporter=spec
e2e/qc-workflow.browser.test.mjs`; it reported:

```text
✔ QC manager and operator screens preserve advisory states and fit phone/tablet layouts (4830.896419ms)
ℹ tests 1
ℹ pass 1
ℹ fail 0
ℹ skipped 0
```

Added a WebKit offline station test that confirms a paused run remains visible
but read-only while offline, then refreshes to the latest server-owned progress
after reconnecting.

## Runner and suite results

The supported database-backed WebKit wrapper,
`bash scripts/src/run-v2-webkit-db-tests.sh`, completed with exit code `0`.
Its retained output includes:

```text
V2 WebKit/Safari engine die-default selection passed.
Password recovery browser coverage: Chromium PASS across phone, tablet portrait/landscape, and desktop; WebKit PASS (WebKit 18.4)
V2 authenticated WebKit inventory layout passed at phone, tablet, and landscape sizes.
Run schema and lifecycle checks passed.
```

The full serial browser command,
`pnpm --filter @workspace/lucia-v2 run test:browser`, ran with
`V2_REQUIRE_WEBKIT=true` and completed in about 62 seconds:

```text
ℹ tests 23
ℹ pass 23
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
```

An intentional failure-path check supplied a temporary WebKit launcher that
prints `INJECTED TEST: WebKit launcher failure for cleanup verification` and
exits `17`. The selected browser test failed as expected and the Node runner
returned exit code `1` in `809.340357ms`, rather than hanging:

```text
✖ WebKit station stays read-only offline and refreshes after reconnecting (39.392441ms)
  browserType.launch: Target page, context or browser has been closed
  [pid=5066][err] INJECTED TEST: WebKit launcher failure for cleanup verification
ℹ tests 1
ℹ pass 0
ℹ fail 1
ℹ duration_ms 809.340357
```

The failure is injected runner-cleanup evidence, not a product or Nix WebKit
failure. Fixture teardown is now registered before browser launch, so a launch
error still closes the local HTTP server and lets the serial test process exit.
