# V2 project handoff

This file carries the approved V2 decisions and current implementation status
for the V2 source in this workspace. It supplements the code; it does not
contain credentials or production data.

Research record: [portable V1-to-V2 research bundle](research/README.md),
prepared 2026-11-10 and checked against V1 revision
`dc6e5205f55fa74005373c6d7f06fae8df0f3399`. It is evidence and planning
context, not additional implementation or cutover approval.

## Product scope

The first usable V2 release is a web/PWA production tool with:

- Run control and every production station.
- Importing, synchronization, and automatic tracking.
- Full inventory workflows.
- Multiple devices able to work on the same active run from the first release.
- Read-only operation while disconnected; writes resume after reconnecting.

## Architecture and deployment boundary

- V1 is archived and no longer live. Preserve its source baseline and data while
  developing V2 under `v2/`; do not move shared V1 code until dependency
  ownership is mapped.
- The owner approved converting this workspace to V2 and using the project's
  managed PostgreSQL database with V2 objects confined to schema `v2`. This is
  schema isolation, not a separate physical database. Existing V1 schemas and
  records must remain untouched.
- The approved deployment architecture is one Reserved VM with separately
  supervised API and worker processes. Replit's managed production database is
  distinct from development. Publish handles supported schema objects, while
  SQL functions, triggers, and grants need a separately reviewed production
  database step.
- The server owns canonical run state. Lifecycle commands use revisions and
  stable idempotency keys; their state change, receipt, event, and outbox entry
  are committed atomically.
- Browser identity and permissions must come from verified server
  authentication. Never accept facility or actor identity from the browser.
- Do not use V1 credentials or connect V2 code to the V1 production database.

## V1 data at cutover

- Carry setup and master data, plus staff identities and roles.
- Require staff to sign in again. Do not transfer sessions or reset tokens.
- Do not carry historical production runs into V2.
- Establish opening inventory from a new physical count, not V1 balances.
- A previously requested full production-to-development preservation copy is
  separate from V2 cutover. No data copy was completed as part of this V2 work.
- The current synthetic transfer rehearsal and its allowlist are documented in
  [CUTOVER-DATA-TRANSFER.md](./CUTOVER-DATA-TRANSFER.md). It does not read a V1
  database or write production data for this setup-family work. A limited,
  owner-authorized read-only V1 audit from 2026-11-17 retained aggregate counts
  and mapping checks only; no V1 records were exported, imported, or changed.
  Approved setup families now have typed V2 destinations and a manager review
  flow. Actual row-level transfer still requires approved mappings and a
  separately authorized source and destination.

## Current V2 source status

The source is under this `v2/` directory and is registered as its own workspace
package. The current project is configured for a V2 preview and Reserved VM
target, but is not published.

- `core/run-lifecycle.mjs` contains the server-time, revision-checked lifecycle
  model for start, pause, resume, and completion.
- `core/run-command-service.mjs` validates authenticated command context,
  authorizes the action, computes the request hash, and calls the database
  transaction boundary.
- `core/run-service.mjs` provides authorized creation, detail reads, and bounded
  facility-scoped run lists through database functions.
- `db/0001-run-control.sql`, `db/0002-staff-auth.sql`, and
  `db/0003-production-stations.sql` define V2 run, staff-auth, and station
  state. Local checks use a disposable PostgreSQL cluster, including run
  creation, canonical timestamps, scoped reads, station timers and automatic
  progress, manual corrections, stale-revision conflicts, idempotent retries,
  role-scoped identity, opaque session lookup, and HTTP requests through a
  restricted API role.
- `db/0004-import-inventory.sql` adds products, recipes and production setups,
  one-facility/multiple-warehouse stock, an append-only movement ledger, and
  reviewed opening counts. Stock changes are blocked until each warehouse has
  an applied physical opening count; no V1 stock or movement history is copied.
- `db/0006-run-inventory-linkage.sql` adds the manager-designated production
  warehouse, validates inventory units in standard recipe/setup imports, and
  freezes the selected product, setup, linked recipes, packaging quantities,
  and warehouse on each newly created run. Run completion calculates actual
  server-recorded batch and packed-case use, appends the movements and receipt
  atomically, and records shortages without blocking completion or allowing
  negative stock.
- `db/0007-staff-role-equivalents.sql` seeds the reviewed `warehouse` and
  `qc-manager` roles in V2 development. The QC workflow migration adds a
  separate `qc-operator` role with record-only access; both roles are facility
  scoped and manager-only actions remain capability-gated.
- `db/0007-approved-setup-catalogs.sql` adds a manager-only import lifecycle
  and dedicated V2 tables for ingredients/allergen facts, mixes, die types and
  defaults, production rules, freezer-pull items, run templates, approved
  manager directories, and spec/merge aliases. Explicit ingredient, mix,
  freezer-pull, and die-default links are facility-scoped. This import does not
  execute production rules or use a V1 run template to start a run.
- `db/0008-reviewed-die-defaults.sql` keeps imported die values as suggestions
  until a manager saves a reviewed revision. Run setup lists those reviewed
  states, applies active values with switch-aware blank filling, and stores the
  selected die revision and line values in each run's immutable setup snapshot.
  Manager changes are revision-checked and recorded in append-only attributed
  history.
- `core/import-csv.mjs` accepts bounded V2 CSV templates for products, recipes,
  production setup, and opening counts. Imports are staged with server-computed
  idempotency, reopenable for manager review, and guarded for safe undo.
- `core/setup-catalog-csv.mjs` validates the approved setup-family CSV maps,
  units, explicit nulls, duplicate identities, named manager-list keys, and
  runtime-field exclusions. The manager setup panel in `web/` downloads each
  family template, stages/reopens the exact values, supports idempotent apply
  and guarded undo, and keeps unscoped flavors and unresolved ingredient names
  unlinked rather than guessing their identity.
- `core/source-workbook-import.mjs` provides bounded, deterministic previews for
  the six non-schedule V1 workbook families. Their source layouts, units,
  unknown-value handling, and recovery boundaries are documented in the
  [source-to-V2 matrix](./research/v1-import-source-matrix.md). Managers review
  and correct candidates in the same setup-catalog flow; uploaded source files
  are not retained, and the existing CSV/capacity workbook paths remain
  separate.
- `server/inventory-api.mjs` exposes manager-only, facility-scoped inventory
  functions. It derives actor/scope from the V2 session, enforces CSRF on writes,
  rate-limits CSV staging, and returns safe errors. Managers can designate only
  an active warehouse with an applied opening count for new production runs.
- `db/0008-qc-workflows.sql` adds facility-scoped, append-only QC evidence,
  manager-reviewed target settings, server timestamps, idempotent writes,
  correction/redaction events, cleaning second-person verification, review
  reopening, and retention-safe run references. `server/qc-api.mjs` and
  `web/qc.js` provide authenticated run and facility histories, lot and weight
  observations, cleaning records, literal date-code observations, Brix checks,
  reviewed settings, manager export, and responsive operator/manager screens.
  Outcomes are advisory only. Weight targets require an explicit source-backed
  manager override; Brix requires an explicit reviewed target and tolerance;
  date-code observations remain not evaluated without an exact-text reference.
- `db/0009-qc-ingredient-links.sql` adds a manager-only, append-only link
  history from an inventory product to one existing canonical setup ingredient.
  New run snapshots freeze that identity and its allergen facts at run creation;
  old runs stay unknown instead of being backfilled. QC exposes the derived
  tracked-allergen footprint separately from the manual run-allergen field.
  Missing links, unreviewed facts, and invalid allergen values remain unknown;
  a reviewed-empty footprint means none of the nine tracked allergens, not a
   safety clearance. Link changes cannot rewrite prior snapshots.
 - `db/0010-qc-substitutions.sql` adds QC-approved run substitutions with exact
   multi-source quantities, append-only corrections, and atomic replacement
   stock adjustments. Run completion deducts only unreplaced source amounts and
   preserves the immutable component/substitution receipt without charging the
   replacement twice. Component-presence checks use the run snapshot and
   approved replacements, including the frozen snapshot for completed runs.
   These QC outcomes remain advisory and do not block production or shipping.
   Migrations `0008` through `0010` have only been exercised on disposable
   PostgreSQL and have not been applied to a shared database.
- `core/run-service.mjs` returns the product catalog with compatible imported
  production setups and the designated production warehouse. Run creation
  requires both selections and rejects a server response without the frozen
  recipe/warehouse plan.
- `core/run-command-service.mjs` sends run completion through the database
  wrapper that atomically records exact-once inventory use with the lifecycle
  transition. The completed run exposes a validated inventory receipt,
  including any unfulfilled quantities.
- The manager workspace in `web/` reviews import history and rows, manages
  warehouse stock/transfers, reopens physical counts, and shows the actor,
  reason, and timestamp for paginated ledger entries.
- `db/0008-inventory-parity.sql` adds V2 lot provenance, linked-mix preparation
  from the selected `perBatchLbs` formula, partial cycle counts with stale
  revision fences and explicit apply acknowledgement, and run-scoped staged
  supply substitutions. Raw and prepared stock remain separate products; the
  stock view distinguishes on-hand, staged, and available quantities.
- The inventory API exposes manager receipt/adjustment, transfer, lot,
  preparation, and cycle-count history/actions. Run readers can see product
  identities and their own staged-supply history; an authorized operator or
  manager can reserve same-unit substitutes. The existing run-completion
  transaction remains the only automatic production-consumption path and
  records actual versus planned product identities.
- `server/auth-adapter.mjs` provides V2-owned Argon2id password verification,
  rate-limited sign-in service logic, opaque hashed sessions, CSRF verification,
  and run/station action authorization.
- `server/auth-api.mjs` provides JSON sign-in, session-read, and sign-out routes.
  Sign-in sets an HttpOnly session cookie and a separate CSRF cookie; tokens and
  credentials are not returned in JSON.
- `server/run-api.mjs` is a request-scoped HTTP handler factory with bounded
  JSON input, safe errors, and required authentication and CSRF adapters.
- `server/api.mjs` serves the V2 web page/assets and composes authentication,
  health, and run routes with restrictive browser headers, request IDs, and
  bounded, payload-free request logs.
- `server/main.mjs` starts the API with `pg`, a bounded pool, startup database
  probe, `/healthz`, and graceful shutdown. It requires `V2_DATABASE_URL` and
  does not run migrations automatically. The launcher maps the managed project
  `DATABASE_URL` only when `V2_USE_PROJECT_DATABASE=true`.
- `core/station-auto-track-worker.mjs` advances due station counters on the
  server without an open browser. Database-backed leases coordinate instances,
  while the existing station transaction remains responsible for pause-aware
  time, idempotency, target caps, and fractional carry. Worker state is exposed
  to the API through a loopback-only worker health endpoint; retry, restart,
  and shutdown behavior is covered by checks.
- `api/openapi.yaml` records health, authentication, manager setup, run control,
  production stations, product/setup/catalog imports, inventory, and QC routes.
- `web/` now connects the username/password sign-in, session check, sign-out,
  run controls, and the Line, Dough, Cheese, Pepperoni, Sauce, Frontline, and
  Packaging station workflows to the V2 API. Station edits, timers, and
  automatic progress use server revisions and canonical responses. The browser
  retains a cached read-only run view offline, refreshes on wake/reconnect, and
  keeps uncertain manual station actions bound to their original staff account.
  Safe timer intents retry a bounded number of times against the latest server
  revision when automatic progress wins a race; manual edits remain visible for
  explicit review. Manager
  tools add reviewed setup imports and multi-warehouse inventory; their writes
  require manager authorization, a confirmed server state, and CSRF.
- Disposable PostgreSQL checks cover guarded first-manager setup and staff
  changes, separate-session run/station conflicts, manager and non-manager
  inventory access, import retries and reopening, review/application,
  warehouse scoping,
  physical-count gating, concurrent stock changes, and balance-to-ledger
  reconciliation. The same check exercises separate staff sessions on run
  revisions and stale-command conflicts. Migration `0006` is tested for frozen
  recipe/warehouse snapshots, per-batch and per-packed-case demand, exactly-once
  completion, stock shortages, and nonnegative on-hand balances.
- V2 now has one-time, secret-guarded first-manager setup plus manager-only
  staff creation, disablement, role changes, and account-session revocation.
  The setup path never imports V1 credentials or sessions.
- Browser automation covers manual-edit conflicts between sessions, offline
  reload and reconnection, plus server-driven station timers and automatic
  progress across desktop and phone-sized Chromium contexts. This is emulated
  browser evidence, not physical-device coverage. A separate authenticated
  Chromium integration now exercises manager product import, physical-count
  review/application, production-warehouse selection, receipt, transfer, and
  reload persistence against the real V2 server and a disposable PostgreSQL
  cluster. The same Chromium inventory journey covers linked-formula
  preparation, a prepared-for-raw run substitution, transfers, and cycle-count
  review/application. Authenticated WebKit checks load the manager UI at desktop,
  phone, tablet-portrait, and tablet-landscape widths; they do not repeat the
  transactional journey. A separate emulated Chromium manager setup journey
  covers family templates, stage/review/apply/undo, and those responsive widths.
  Physical-device behavior is not proven by emulation.
- The V2 preview now runs the API and database-leased worker as separate,
  supervised processes; browsers only refresh canonical state and never submit
  automatic-progress ticks. Development restart was tested and the worker
  recovered. The measured database setting was 112 maximum connections with
  four reserved; the configured API and worker pools allow five total.
- V2 migrations through `0007-staff-role-equivalents.sql` are applied to the
  development database's `v2` schema only. The setup-catalog migration and
  reviewed-die migration `0008` are tested against disposable PostgreSQL and
  have not been applied to the shared development or production database.
- The private preview has one enabled manager account, created through the
  guarded first-manager flow; the owner confirmed sign-out and sign-in. The
  bootstrap marker is set and the one-time bootstrap secret was removed. The two
  reviewed custom role definitions are seeded; no V1 staff, recipe, or inventory
  data has been imported. No run or inventory data has been seeded.
- The V1 production source received a limited read-only aggregate audit; no
  source records were exported, imported, or changed.
- Disposable PostgreSQL checks now cover receiving lots, linked preparation,
  transfer lineage, reserved staged stock, exact-once completion, stale count
  fencing, nonnegative balances, and ledger/lot reconciliation. The signed-in
  browser check covers manager receipt, setup links, preparation, transfer,
  cycle-count review/apply, and reload persistence in Chromium and WebKit at
  desktop, phone, and tablet viewports. Physical iOS/Android behavior,
  production database function/trigger/grant setup, and production publish
  remain future work. Do not publish until the least-privilege runtime access
  and V2 production database objects are reviewed.
  The deployment run command currently refuses to publish; the `Project`
  workflow remains available for the private preview.
- The latest in-workspace pilot status, evidence, and remaining actions are recorded
  in [PILOT-DEPLOYMENT-RECORD.md](PILOT-DEPLOYMENT-RECORD.md).

## Remaining V2 validation

1. Verify the manager setup/catalog and inventory journeys in the live private
   preview, then extend authenticated manager coverage for recipe and
   production-setup imports, run completion, and shortages.
2. Verify station calculations against approved floor examples and test station
   workflows, wake/reconnect, and multi-device operation on real phones/tablets.
3. Complete the production-database and least-privilege review, then verify the
   Reserved VM, worker, and synthetic run behavior after owner-initiated
   publication.

## Focused checks

Run from the source repository root:

```sh
pnpm --filter @workspace/lucia-v2 test
pnpm --filter @workspace/lucia-v2 test:browser
pnpm --filter @workspace/lucia-v2 test:db
node --check v2/server/main.mjs
node --check v2/web/app.js
```

The PostgreSQL script creates and removes its own temporary local cluster. Do
not point it at V1 or any shared development or production database. Password
hash transfer remains a separate cutover decision; this work has not copied any
V1 accounts, credentials, sessions, or data.
