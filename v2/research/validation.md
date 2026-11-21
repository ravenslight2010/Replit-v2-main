# Bundle validation record

**Validation date:** 2026-11-10  
**V1 checkout:** `dc6e5205f55fa74005373c6d7f06fae8df0f3399`

## Checks

| Check | Result | Scope |
|---|---|---|
| Source-copy and task-snapshot SHA-256 manifest | **PASS** | 21 retained repository source files matched their original bytes. All 10 accessible task descriptions and 9 generated link placeholders matched their manifest hashes. No exact duplicate payloads were found. |
| Relative Markdown links and anchors | **PASS** | 47 package/archive Markdown files checked; all local paths and referenced heading anchors resolve. Omitted repository references resolve to explicit non-evidence placeholders. |
| Clean-copy portability | **PASS** | Copied all of `v2/research/` to a temporary directory and rechecked archive hashes, local links, and anchors without relying on repository files outside that copy. |
| Sensitive-content review | **PASS** | Reviewed key/token patterns, contact-pattern matches, source scope, and retained task/source text. No secrets, credentials, sessions, personal email, customer workbook/recipe contents, or raw operational records were retained. Email matches were public Replit documentation addresses; broad phone-pattern hits were numeric SVG path coordinates, not contact details. |
| V1 code boundary | **PASS** | Changed paths are confined to `v2/`; no V1 source, runtime, database, deployment, or production data was changed. |
| V1 focused current-source tests | **PASS** | 286 tests across 13 files on the V1 checkout listed above. Exact files and scope are in [the reconciliation](v1-to-v2.md). |

No application-wide test suite, database-backed suite, browser suite, deployment
pilot, production query, migration, data transfer, physical-device check, or
release decision was required or run for this documentation task.

## Resolved execution issue

The first source-copy command stopped because the mirrored `attached_assets/`
destination directory had not been created. The destination was created and the
copy succeeded on retry. No original file was modified, and the failed attempt
did not delete or overwrite data.

The first link-placeholder scan stopped on a relative-versus-absolute path
comparison before writing a placeholder. The path handling was corrected; the
scan then created and verified nine explicit placeholders. No source text was
changed.

Anchor validation found two incoming links to omitted sections in one
placeholder. The corresponding fragment aliases were added to that
non-evidence placeholder and its catalog hash was refreshed. The original
archived source remains unchanged; all three local Markdown fragment links now
resolve.

## V2 operational validation

**Validation date:** 2026-11-20

**Scope:** bounded update-safety and authenticated manager-journey verification.
No publishing, cutover authorization, production-data writes, or release decision.
The configured V2 workflow was not restarted because it uses the shared project
database; database-backed browser checks used the disposable local PostgreSQL
fixture instead.

**Revision under test:** base `621288c4b06f0b747b957148fbc71ddb562b4532` plus the
V2 source/test worktree diff (SHA-256
`80920afc15dc3c42a9c3903111e7bf6c077f917416545bf455edd872772dc389`).
The diff hash covers the changed V2 database runner, browser tests, package
script, authenticated browser integration, and web styles; documentation and
memory edits are excluded.
The database-browser rows use base `621288c4b06f0b747b957148fbc71ddb562b4532`
plus DB-surface diff SHA-256
`bde0a485e4f785b8de418da819eab19fd752c708bac5ca835f5383ecc7b209b6`, covering
the database test runner, authenticated browser integration, and web styles.

**Environment:** Node `v24.22.3`, pnpm `11.5.2`, disposable local PostgreSQL,
Chromium `138.0.7204.100`, and Nix Playwright `1.52.0` with WebKit `18.4`.
Chromium and WebKit are browser emulation lanes, not physical-device results.

### Current evidence matrix

| Lane | Command | Revision | Environment | Status and evidence |
|---|---|---|---|---|
| V2 unit and API tests | `pnpm --filter @workspace/lucia-v2 run test` | Current revision above | Node/pnpm above | **PASS** — 228 tests, no skips. |
| V2 build/syntax checks | `pnpm --filter @workspace/lucia-v2 run build` | Current revision above | Node above | **PASS** — server and web JavaScript syntax checks. |
| Chromium browser emulation | `pnpm --filter @workspace/lucia-v2 run test:browser` with the Nix environment below | Current revision above | Chromium `138.0.7204.100` | **PASS** — part of the required 20/20 cross-engine suite; Chromium manager, update, import, sync, offline/reconnect, and responsive cases passed. |
| WebKit/Safari browser emulation | Same `test:browser` command; `V2_REQUIRE_WEBKIT=true` | Current revision above | Nix Playwright WebKit `18.4` | **PASS** — part of the required 20/20 cross-engine suite; WebKit update, import, responsive, and offline-shell cases passed with no skips. |
| Browser suite total | `pnpm --filter @workspace/lucia-v2 run test:browser` | Current revision above | Chromium and WebKit emulation; Node test concurrency set to 1 | **PASS** — 20/20 tests, 0 skipped. Final run completed in 53.1 seconds. |
| Authenticated manager lifecycle on disposable database | `bash scripts/src/run-v2-webkit-db-tests.sh` | Base plus DB-surface diff hash above | Disposable PostgreSQL; authenticated Chromium and WebKit | **PASS — target journey** — manager import preview/Apply, physical opening count, run creation/start, station progress saved and reloaded, completion, receipt, and completed-run reload assertions passed before a later unrelated operator sign-in step failed. |
| Remaining combined database-browser runner | Same `run-v2-webkit-db-tests.sh` command | Base plus DB-surface diff hash above | Disposable PostgreSQL; Chromium and WebKit | **FAIL — out-of-scope suffix** — after target manager checks and WebKit responsive checks passed, the password-reset/operator journey timed out waiting for the authenticated shell at `http-postgres.browser.integration.mjs:1039`. See the ledger; this role-path investigation belongs to #3977 and was not repeated here. |
| Two-session stale-write and offline/wake recovery | `pnpm --filter @workspace/lucia-v2 run test:browser` | Current revision above | Chromium and WebKit browser fixtures | **PASS** — stale manual edits remain protected; offline reload is read-only and reconnect/wake adopts the latest shared run state; station timers and progress are server-owned. |
| Phone/tablet/desktop web layouts | Browser suite plus `run-v2-webkit-db-tests.sh` | Current revision above | 390px phone, 768px tablet portrait, 1024px landscape, 1440px desktop; Chromium and WebKit | **PASS — emulation only** — manager and station layouts fit the tested viewports; WebKit horizontal overflow found during validation was corrected. The combined database runner later failed in its unrelated operator-login suffix. |
| V1-to-V2 cache migration and PWA update behavior | `pnpm --filter @workspace/lucia-v2 run test:browser` | Current revision above | Chromium | **PASS** — V2 replaces V1 cache entries while preserving unrelated cache, cookie, localStorage, and IndexedDB; the existing page is not forced to reload; manual reload reaches V2. Service-worker install/update and offline/reconnect shell paths passed. |
| More-menu update dialog accessibility and reload safety | Same `test:browser` command | Current revision above | Chromium `138.0.7204.100` | **PASS** — keyboard access, focus containment, Escape, reduced motion, failed/unavailable fallback, current-vs-available outcomes, and explicit reload gating for active runs, unconfirmed workbook review, and dirty form edits passed. |
| Physical Android Chrome/PWA | Not run | Current revision above | No authorized physical Android endpoint available | **BLOCKED** — Chromium emulation is not physical-device evidence. |
| Physical iOS Safari/PWA | Not run | Current revision above | No authorized physical iOS endpoint available | **BLOCKED** — WebKit emulation is not physical-device evidence. |
| Screen-reader assistive-technology session | Not run | Current revision above | No screen-reader device/runtime configured | **NOT RUN** — automated accessible-name/role and keyboard paths passed; no manual screen-reader result is claimed. |
| Upstream #3968 Safari setup-import and #3977 runtime/deployment evidence | Not run | N/A | Their result records were not present in this workspace | **NOT RUN** — did not repeat the Safari setup-import journey or deployment/provider checks. |
| Diff hygiene | `git diff --check` | Current revision above | Workspace | **PASS**. |

The update dialog is reachable from **More** and distinguishes current,
available, failed, and unavailable checks. A failed or unavailable check leaves
the manual path usable. Reload is always explicit; an active run, unconfirmed
workbook review, or dirty form edit blocks it. The completed-run path permits
the user-confirmed reload. Keyboard focus stays inside the dialog, Escape
closes it, and reduced-motion behavior is covered.

The exact cross-engine browser command used the installed Nix runtimes. The
existing `test:browser` script runs serially to avoid host contention in browser
tests; WebKit coverage is required, not silently skipped.

```sh
env \
  V2_WEBKIT_PLAYWRIGHT_MODULE=/nix/store/fcwgdskzd6yp50d9qb04v82vb23kllld-playwright-test-1.52.0/lib/node_modules/playwright \
  V2_WEBKIT_EXECUTABLE_PATH=/nix/store/q70d15vcgipibv45yxp44hdjfhdmdmg5-playwright-browsers/webkit-2158/pw_run.sh \
  V2_WEBKIT_SKIP_HOST_REQUIREMENTS=1 \
  V2_REQUIRE_WEBKIT=true \
  V2_WEBKIT_EGL_VENDOR=/nix/store/cpwib3zazj49fm0y04y53w4xkbqsgrgm-mesa-25.0.7/share/glvnd/egl_vendor.d/50_mesa.json \
  PLAYWRIGHT_BROWSERS_PATH=/nix/store/q70d15vcgipibv45yxp44hdjfhdmdmg5-playwright-browsers \
  pnpm --filter @workspace/lucia-v2 run test:browser
```

### Failure and exception ledger

| Finding | Owner | Resolution or next action |
|---|---|---|
| Offline module coverage exposed a missing `inventory-export.mjs` precache entry. | V2 update lane | Added the module to the shell cache and advanced its cache version; offline and migration browser tests now pass. |
| A first database-browser run reached QC history before the test schema and role grants were installed. | Validation lane | Corrected fixture order so required schemas/grants precede the browser journey; subsequent target journey assertions passed. |
| WebKit manager operations overflowed at phone width, the operations refresh could race its status change, and full-page screenshots were unreliable. | V2 validation lane | Constrained the operations/station navigation layout, waited for the refreshed report before changing status, and used viewport-sized screenshots. WebKit phone/tablet/landscape checks passed. |
| The V1 migration reload and cached-shell assertion, plus one Chromium sauce-import status wait, timed out intermittently during browser-suite runs. | V2 validation lane | Serialized the existing browser suite, made the migration test wait for navigation commit and the actual cached V2 shell, and added failure-only diagnostics. The final full suite passed 20/20; the sauce-import case also passed alone. |
| The combined database-browser command failed after the target manager journey, while signing in as the operator after password recovery. | #3977 owner; validation lane recorded evidence | Failure was a timeout at `http-postgres.browser.integration.mjs:1039` waiting for `#authenticated-app:not([hidden])`; sensitive values were not logged. This is outside #3983's manager journey. Use #3977's retained result if available; do not duplicate its role/deployment investigation. |
| Physical Android/iOS access and upstream #3968/#3977 result records were unavailable. | Facility/device owner; upstream task owners | Keep physical lanes **BLOCKED** and upstream evidence **NOT RUN** until authorized endpoints or retained results are available. Do not treat emulation as a physical pass. |

This is bounded verification only, not a production-readiness or release
decision.
