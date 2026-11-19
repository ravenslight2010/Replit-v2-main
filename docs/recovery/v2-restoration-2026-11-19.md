# V2 workspace recovery

This is source-recovery evidence, not a publishing recommendation. No managed
database migration, account import, data reset, or publication was performed.

## Provenance and preserved baseline

- Protected starting branch and tag: `recovery-baseline-v2-restore`, at
  `b1e6eeeff2160d2f0d156aa522053ab0e360b7ad`.
- Source repository: `ravenslight2010/Production-run-calculator`, branch `Replit`.
- Pinned source commit: `82c2f8858fab962a9b018f780470024693814dd1`.
- Pinned V2 subtree: `1b57fc61e18048ef87c9f549623c3f20d57649d0`.
- Recovered 130 files, 2,331,917 bytes. Each downloaded file was verified against
  its Git blob SHA-1, including the `blob <length>\0` header, before restoration.
- Missing destinations were copied selectively. Existing legacy sources,
  security overrides, package-manager pin, and dependency-remediation ownership
  were preserved. Temporary source comparisons remain ignored.
- Four missing architecture/research documents were also restored from the
  pinned commit after blob-hash verification. Historical telemetry remains
  labelled historical. The recovered scope note was reconciled into current
  product-boundary memory rather than copying superseded CSV-only restrictions.
- Recovered dependency versions were integrated into the existing workspace
  lockfile. The V2 Node requirement follows the workspace's actual 24.22.3
  runtime rather than silently downgrading it to the backup's 24.22.2.

## Recovery matrix

| Expected outcome | Provenance and disposition | Current evidence |
| --- | --- | --- |
| Username/password authentication, sessions, CSRF, staff capabilities | Recovered pinned V2 source | Auth unit/API checks; disposable PostgreSQL authenticated browser journey |
| Run preparation, start/pause/resume/completion | Recovered source | Lifecycle transactions, stale revisions, same-key retries and concurrent command checks |
| Line, dough, sauce, front, packaging, warehouse station behavior | Recovered source | Station service/worker tests, station revision races, real two-session browser checks |
| Server-owned progress and timers | Recovered source; no client progress writer added | Two-session timer/auto-track browser check; worker lease contention; pause checks |
| Inventory import, opening counts, transfers, receipts and reload persistence | Recovered source | Authenticated Chromium against disposable PostgreSQL |
| Run-to-inventory snapshots and exact-once completion consumption | Recovered source SQL and services | Per-batch/per-case consumption, shortages, replay and concurrent stock tests |
| Additional setup catalogs and six source workbook families | Recovered source, contracts and fixtures | CSV/source parser checks; reviewed import browser tests; setup SQL apply/undo/isolation tests |
| Imported production-rule enforcement | Reconstructed; later merged commit unavailable | New `0008` source SQL; atomic prepare/start triggers; flexible warnings, strict block, unknown, imported bypass, facility isolation, immutable accepted audit and retry checks |
| Safari/WebKit setup-import and responsive coverage | Reconstructed test expansion; later commit unavailable | Supported Ubuntu CI passed all 13 browser cases, including both required WebKit imports; no browser cases skipped |
| Installed-shell offline/reconnect and old V1 cache migration | Recovered and checked; shell cache generation advanced for recovered JS | Offline read-only/reconnect browser check; targeted legacy-cache test passed after activation/claim synchronization was corrected |
| Runtime-safety reconciliation | Reconstructed from current observations | API and leased worker started; ports/role/runtime recorded below; managed schema differences remain explicitly pending |
| Current GitHub backup | Normal non-forced pushes and protected baseline tag | Verified remote source revision `fb1b549c09f74df5b3d27e6501e78fe02c106222`; final metadata revision is checked again after this report |

## Current runtime observations

- Development application: supervised V2 API on port 5000, worker health on
  loopback port 3001. Only port 5000 is intended as the external web port.
- Runtime: x86_64, Node 24.22.3, pnpm 11.5.2. Old ARM-only verification advice
  does not describe this machine.
- An orphaned supervisor from the earlier V2 workflow still owned both ports.
  Its identity and workspace were verified before stopping it. The configured
  V2 workflow then started successfully.
- Read-only managed-development metadata inspection found the `v2` schema,
  21 tables and an elevated runtime role. There were zero runs. The newer setup
  catalog functions were absent. This is **not** least-privilege readiness.
- Startup did not apply SQL. Restored source SQL, including `0008`, was applied
  only inside disposable PostgreSQL clusters. Worker lease bookkeeping is
  normal runtime activity; accounts, balances and operational records were not
  migrated or reset.
- Post-merge setup now builds V2 without running the legacy database push.
  Restoring source is not approval to change either managed database.
- Legacy source remains reference-only at existing paths to avoid breaking
  shared workspace dependencies. Its web/API workflows are not V2's run target.
- The anonymous preview renders V2 sign-in. A session probe returning 401 before
  sign-in is expected and is not evidence of a failed login.
- Configuration recovery subsequently created preserved recovery checkpoints,
  restored V1 workflows, and removed the standalone Nix file. V2 startup was
  reapplied without reverting application source. The supported package tool
  restored required packages inline under `[nix]` in `.replit`.

## Verification ledger

- V2 source checks: **156 passed**, zero failures/skips.
- Disposable database suite: passed lifecycle, concurrent command/lease races,
  authentication/capabilities, inventory ledger, reviewed catalog imports,
  production-rule enforcement and synthetic transfer rehearsal.
- Real browser pass: nine Chromium cases passed initially; the cache migration
  case exposed a fixture race between cache deletion and `clients.claim()`.
  The test now waits for the new active controller before a user reload.
  Its targeted rerun passed, preserving cookies, local storage, IndexedDB and
  unrelated caches. No application code forces a reload or clears user data.
- A targeted production-rule browser case also passed: warnings are visible,
  a strict 422 rejection clears the uncertain-action state without going
  offline, and an approved imported bypass is displayed after acceptance.
  The API regression rejects client-supplied bypass flags.
- Two WebKit cases were explicitly skipped locally. Installing the browser
  archive did not supply its required Linux shared libraries. They are **not
  passed** and no physical-device result is claimed.
- The focused GitHub workflow installs supported Chromium/WebKit runtimes on
  Ubuntu and requires WebKit rather than allowing that coverage to disappear.
  [Supported-runtime run](https://github.com/ravenslight2010/Replit-v2-main/actions/runs/44451695638)
  passed at source revision `fb1b549c09f74df5b3d27e6501e78fe02c106222`:
  **154 unit cases passed, two private-corpus cases explicitly skipped;
  13 browser cases passed, zero browser skips; disposable PostgreSQL checks
  passed**. The two private-corpus cases passed locally as part of all 156.
  Environment-configuration changes also trigger this workflow.
- The first GitHub attempt exposed an extra external port mapping and two
  tests depending on private, untracked customer workbooks. The mapping was
  removed. CI now explicitly skips those two corpus-only cases; the workspace
  still runs all 156 cases, including the real corpus, with no skips. Synthetic
  workbook import tests remain required in CI. No customer workbooks were
  uploaded to the public repository.
- Recovery-audit file evidence is separate from executable test evidence.
- Root typecheck, generated API contract checks and the ten-entry recovery
  audit passed. Shell syntax and the focused workflow YAML were also checked.

## Other task ownership

At recovery inspection, scheduling/run planning (#3961), inventory parity
(#3963), QC/allergens (#3964), staff resets (#3978), die defaults (#3979), and
dependency remediation (#3990) still had separate owners. Their task records
were checked. No newer completed source patch was available in this checkout;
their in-progress status was not treated as a recoverable implementation.

Queued manager/history, opening setup, station calculations, capacity mappings,
warehouse exports, diagnostics, substitutions, mix planning and extended QC
remain with the existing tasks. Recovery does not mark them implemented.

The production-rule, WebKit and runtime-safety merged commit identifiers did
not resolve from the available repositories or local objects. Reconstructed
behavior is therefore labelled as reconstruction, not byte-for-byte recovery.

## Remaining activation and release work

1. Compare restored SQL with the managed database and prepare a separately
   approved, data-preserving schema/permission reconciliation. Do not blindly
   rerun initial migrations, bootstrap accounts, or rely on Publish to copy
   functions, triggers, roles or grants.
2. Finish the separately owned security and feature work before release review.
3. Complete the separately owned operational/physical-device acceptance work.

The first recovery commit and baseline tag were pushed normally to
`ravenslight2010/Replit-v2-main`. Remote `main` was verified as
`654a615441ef7fa19630a33639acb9e38d4e4e72` at that point; no history rewrite or
force push was used.

The required source-recovery outcomes are now verified. This does not activate
new SQL in either managed database or authorize publishing. Physical-device
acceptance and a production readiness decision remain separate.
