# V2 station and offline WebKit verification

**Date:** 2026-11-21

## Environment

- Node `v24.22.3`
- Chromium `138.0.7204.100`
- Nix `playwright-test` `1.52.0`, WebKit `18.4`
- Project-pinned Playwright `1.65.1`, WPE WebKit `27.2` (`webkit-2388` bundle)
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
but read-only while the page stays open, then refreshes to the latest
server-owned progress after reconnecting. This is not installed-shell offline
reload coverage.

## Installed-shell offline reload probe

The focused installed-shell WebKit test enables service workers, waits for the
V2 worker to control the page, and confirms both `/` and `/v2/web/app.js` are in
`fieldline-v2-shell-12`. On the Nix `playwright-test` 1.52.0 runtime with WPE
WebKit 18.4, the subsequent offline `page.reload()` fails before navigation
commits with:

```text
page.reload: WebKit encountered an internal error
Call log:
  - waiting for navigation until "commit"
```

The same failure was reproduced using Playwright's `domcontentloaded` reload
wait condition; changing the wait condition does not avoid it. The focused
regression test reports this exact WebKit 18.4 failure as a skip, rather than
claiming the cached station view restored.

### Newer WPE runtime result

The project-pinned Playwright `1.65.1` cache includes WPE WebKit `27.2`
(`webkit-2388`). Its bundled host-dependency check could not see the Nix
libraries, so this run used a temporary, uncommitted launcher wrapper to expose
the matching Nix shared libraries and Mesa EGL manifest; application
dependencies and the repository's Nix configuration were unchanged.

The installed-shell journey was run serially with
`V2_REQUIRE_WEBKIT=true`, the WebKit 27.2 launcher, and:

```sh
node --test --test-concurrency=1 --test-reporter=spec \
  --test-name-pattern='WebKit installed shell reloads offline' \
  v2/e2e/station-sync.browser.test.mjs
```

Result:

```text
✔ WebKit installed shell reloads offline read-only and adopts fresh server state
ℹ tests 1
ℹ pass 1
ℹ fail 0
ℹ skipped 0
```

The station restored the cached paused run (`casesProduced: 12`) read-only after
an offline app-shell reload. Once reconnected, it adopted the updated server
state (`running`, `casesProduced: 20`) and re-enabled station controls. The
test fixture now blocks its own HTTP server during the offline phase and
provides fixture API responses after reconnect; WebKit can bypass Playwright's
route hooks after a service worker takes control, so this keeps the offline
reload and reconnect assertions meaningful.

Latest installed-shell evidence: WPE WebKit 27.2 passed the offline reload,
read-only restoration, and reconnect-to-latest-state journey. The WebKit 18.4
runtime remains skipped for its reproduced pre-commit navigation error.

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

## Real iOS access checked

**Date:** 2026-11-21

Checked whether a no-cost route can provide the required installed-iPhone
evidence:

- Replit's cloud iOS Simulator is for native mobile artifacts and is hidden for
  web-only projects. V2 is a web/PWA project, so that preview cannot run this
  check.
- BrowserStack Live documents manually adding a PWA to an iOS device's Home
  Screen from Safari, and documents true offline mode on real iPhones running
  iOS 15 or later. Live Local Testing can route a real device to a private or
  staging V2 site. This is the closest match to the requested check.
- BrowserStack's published free trial currently includes 30 minutes of Live
  testing, limited to one minute per device. Its network-simulation feature,
  including Offline, is listed for Team, Team Pro, and Enterprise plans. The
  free trial therefore does not establish that the required offline control is
  available without a paid plan.
- Apple's iOS Simulator requires Xcode on macOS. It can inspect Home Screen web
  apps, but it is simulated hardware and cannot be recorded as physical-device
  evidence.
- No BrowserStack account or device session is connected to this workspace.
  No account was created and no paid service was enabled.

References:

- [Replit native mobile preview and simulator scope](https://docs.replit.com/features/artifact-types/building-mobile-apps)
- [BrowserStack PWA scenarios in Live](https://www.browserstack.com/support/faq/live/features-live/how-can-i-progressive-web-app-pwa-specific-scenarios-on-devices-in-live)
- [BrowserStack iOS offline mode](https://www.browserstack.com/docs/live/network/network-simulation/offline-mode/offline-mode-ios)
- [BrowserStack Live Local Testing](https://www.browserstack.com/docs/live/local-testing)
- [BrowserStack free-trial limits](https://www.browserstack.com/support/faq/plans-pricing/plans/what-do-i-get-with-a-free-trial)
- [BrowserStack Live network-simulation plan availability](https://www.browserstack.com/docs/live/network)
- [Apple iOS Simulator setup](https://developer.apple.com/documentation/safari-developer-tools/installing-xcode-and-simulators)

**Outcome:** no free route available in this workspace completes the required
real-iPhone offline reload test. The physical-device result remains unverified;
do not substitute the free-trial browser session, an iOS simulator, or headless
WebKit for that evidence.
