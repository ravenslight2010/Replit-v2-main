# Run substitution status verification

**Date:** 2026-11-20

## Outcomes

| Check | Result | Evidence |
|---|---|---|
| V2 build and server/unit tests | **PASS** | `pnpm --dir v2 run build` and `pnpm --dir v2 run test`; all 234 tests passed on the pinned Node 24.22.3 runtime after rebasing onto the latest main changes. |
| Disposable PostgreSQL and Chromium integration | **PASS** | `pnpm --dir v2 run test:db`; approved/corrected substitution quantities, exact source and replacement identities, movement reference, inventory accounting, completion snapshot, reload, and existing QC/manager journeys passed. No production database or stock was used. |
| Run/station status browser journey | **PASS — Chromium** | Focused journey covered desktop, phone, tablet portrait/landscape, visible text and accessible labels, QC navigation, removal, two-session refresh, reload, offline invalidation, and reconnect. |
| Existing QC operator/manager browser journey | **PASS — Chromium** | `qc-workflow.browser.test.mjs` passed with no browser errors. |
| WebKit/Safari browser journey | **BLOCKED** | The WebKit Playwright launcher was absent at `/home/runner/.cache/ms-playwright/webkit-2388/pw_run.sh`; a direct launch also reported missing host libraries including GTK 4, Vulkan, GStreamer, and Graphene. **Owner:** browser test environment. **Next action:** run the WebKit lane on a host with the supported Playwright WebKit runtime and native libraries. |
| Physical Android Chrome and iOS Safari/PWA | **NOT REACHED** | No physical devices were available. Responsive emulation is reported separately and is not physical-device evidence. |
| Broad V2 browser suite | **BLOCKED** | `pnpm --dir v2 run test:browser` exceeded the 300-second shell limit. The focused task journeys and full disposable database suite passed; the broad suite is not represented as passing. **Owner:** browser test runner. **Next action:** rerun the broad suite in a suitably provisioned CI run if required. |
| Archived V1 badge references | **MISSING** | The two V1 files listed in the task were not present in this workspace. The implementation was reconciled against the merged V2 contracts and synthetic integration fixtures instead. |

## Failure ledger

| Issue observed | Resolution or disposition |
|---|---|
| The first database-backed browser integration ran before the new status-read SQL function and grant were loaded. | Moved the new additive migration and test grant before that integration. The final database suite passed. |
| The role-equivalents test expected its pre-QC role count after QC migrations had added roles. | Kept that baseline test before the QC migrations; the test and final database suite passed. |
| The SQL assertion compared a decimal rendered with six fractional digits to the string `35`. | Compared it numerically instead; exact quantity and movement-reference assertions passed. |
| The first status browser assertion used “affect” while the UI said “affects.” | Corrected the expected sentence; the focused Chromium journey passed. |
| Calling the QC reset method stopped status polling, so a second session missed removal updates. | Kept the shared status poller alive across QC panel resets; the two-session removal journey passed. |
| The standalone QC browser fixture did not serve the new operational-status endpoint and logged 404s. | Added a synthetic response to the fixture; the QC manager/operator browser test passed without console errors. |
| The status browser fixture returned an invalid schedule date during its reconnect journey. | Supplied a deterministic fixture date; the focused Chromium journey passed. |
| The rebase introduced a new V2 web module into the shared browser fixture, causing its route to return 404 before the status journey loaded. | Added the module to the fixture’s static asset map; the rebased status journey passed. |
| Rebasing merged two copies of the disposable HTTP browser integration call into one test-runner sequence; the extra run left unrelated manager action records that broke the manager read-model assertion. | Removed only the duplicate call, retained the post-migration integration run, and reran the full database suite successfully. |
| The database runner conflicted while merging the status migration with incoming QC checkpoint and manager-operation migrations. | Kept all three migrations and grants in the runner; the guided rebase completed cleanly and the post-rebase database suite passed. |
| The resumed shell did not expose the existing Nix `pnpm`, Node, Python, PostgreSQL, or Chromium launchers on `PATH`. | Used the already-installed store binaries explicitly; no dependencies were installed or changed. |
| An initial retry used Node 22 instead of the project-pinned Node 24.22.3. Startup checks failed and Node 22 lacked the required `node:crypto` Argon2 export. | Re-ran build and all 234 unit/server tests on Node 24.22.3; all passed. |
| The first database-suite retry could not discover Chromium from the shell `PATH`. | Set `CHROMIUM_PATH` to the installed Nix Chromium binary; the complete disposable database suite passed. |
| The broad browser-suite command exceeded its 300-second limit. | Retained as **BLOCKED** above; the bounded task-specific journeys passed. |
| WebKit and physical-device evidence could not be collected in this environment. | Retained as **BLOCKED** and **NOT REACHED** above; no emulation result is claimed as a substitute. |

No production data, live stock, deployment, or safety-clearance claim was involved.
