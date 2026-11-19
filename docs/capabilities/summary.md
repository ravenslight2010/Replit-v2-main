# Portable V1/V2 Capability Catalog

> Generated from [catalog.json](catalog.json). Do not edit this summary by hand.

This is a bounded inventory, not proof that every V1 behavior was discovered: editable V1 source and broad/raw discovery inventories were not retained. It preserves only claims supported by surviving source, documents, tests, or explicit owner decisions. The removed V1 production database, customer records, credentials, sessions, and runtime behavior are not recovered or implied.

**Capabilities:** 46
**Decision states:** approved: 35 · candidate: 10 · deferred: 0 · out-of-scope: 1 · retired: 0
**Implementation states:** implemented: 16 · in-progress: 10 · not-started: 18 · blocked: 2

## Capability inventory

| Stable ID | Capability | Workflow / roles | Decision | Release | Implementation | Depends on | Evidence |
|---|---|---|---|---|---|---|---|
| `CAP-ACCESSIBILITY-RESPONSIVE` | Accessible responsive operations | Use operational screens on web devices (operator, manager, QC manager, warehouse) | approved | current | in-progress | — | [handoff](v2/HANDOFF.md), [validation-plan](.local/tasks/v2-update-operational-validation.md), [v1-audit](v2/research/archive/repo-mirror/docs/research-reconciliation/app-wide-audit-2026-10-29.md) |
| `CAP-AI-IMPORT-MATCHING` | AI-assisted import matching | Review import match suggestions (manager) | candidate | none | not-started | — | [v1-import-plan](v2/research/archive/repo-mirror/docs/import-system-plan.md), [import-matrix](v2/research/v1-import-source-matrix.md) |
| `CAP-AI-OPERATIONAL-ASSISTANCE` | AI operational assistance | Review optional AI assistance (operator, manager) | candidate | none | not-started | — | [next-handoff](v2/research/NEXT-PHASE-HANDOFF.md), [v1-audit](v2/research/archive/repo-mirror/docs/research-reconciliation/app-wide-audit-2026-10-29.md) |
| `CAP-ALLERGEN-EVIDENCE` | Allergen review and run visibility | Review allergen mappings and run status (operator, QC manager, manager) | approved | current | in-progress | `CAP-SETUP-CATALOG`, `CAP-QC-EVIDENCE` | [qc-plan](.local/tasks/v2-qc-allergen-workflows.md), [substitution-plan](.local/tasks/v2-substitution-station-visibility.md), [v1-v2](v2/research/v1-to-v2.md) |
| `CAP-APP-UPDATES` | Safe application updates | Check and apply an app update (operator, manager) | approved | current | not-started | — | [next-handoff](v2/research/NEXT-PHASE-HANDOFF.md), [validation-plan](.local/tasks/v2-update-operational-validation.md) |
| `CAP-AUTOMATIC-TRACKING` | Automatic station progress | Advance station progress in the background (operator, manager, system worker) | approved | current | implemented | `CAP-PRODUCTION-STATIONS` | [handoff](v2/HANDOFF.md), [v1-v2](v2/research/v1-to-v2.md) |
| `CAP-CAST-SCREENS` | Cast production status to screens | View production status on a shared screen (operator, manager) | candidate | none | not-started | — | [next-handoff](v2/research/NEXT-PHASE-HANDOFF.md) |
| `CAP-CUTOVER-BOUNDARY` | Safe V1-to-V2 cutover boundary | Prepare and review a future cutover (owner, manager, administrator) | approved | current | blocked | `CAP-IDENTITY-ROLES`, `CAP-SETUP-CATALOG`, `CAP-INVENTORY-LEDGER` | [handoff](v2/HANDOFF.md), [gaps](v2/research/gaps.md), [research-readme](v2/research/README.md) |
| `CAP-DEPLOYMENT-BOUNDARY` | Isolated V2 deployment and worker | Provision and verify a V2 deployment (owner, administrator) | approved | current | blocked | `CAP-IDENTITY-ROLES` | [handoff](v2/HANDOFF.md), [gaps](v2/research/gaps.md), [v1-v2](v2/research/v1-to-v2.md) |
| `CAP-DIE-DEFAULTS` | Reviewed die and line defaults | Review defaults and configure a run (manager, operator) | approved | current | implemented | `CAP-SETUP-CATALOG` | [next-handoff](v2/research/NEXT-PHASE-HANDOFF.md), [die-plan](.local/tasks/v2-operational-die-defaults.md), [die-test](v2/core/die-defaults.test.mjs) |
| `CAP-EXPORT-RECIPES` | Recipe and specification export | Export specification data (manager) | candidate | none | not-started | — | [v1-audit](v2/research/archive/repo-mirror/docs/research-reconciliation/app-wide-audit-2026-10-29.md), [v1-import-plan](v2/research/archive/repo-mirror/docs/import-system-plan.md) |
| `CAP-FINISHED-GOODS` | Finished-case corrections | Correct finished-case records (warehouse, manager) | approved | current | in-progress | `CAP-INVENTORY-LEDGER` | [v1-v2](v2/research/v1-to-v2.md), [inventory-plan](.local/tasks/v2-inventory-workflows.md) |
| `CAP-FREEZER-CYCLE-COUNTS` | Freezer pulls and cycle counts | Plan freezer pulls and count inventory (warehouse, operator, manager) | approved | current | in-progress | `CAP-INVENTORY-LEDGER` | [next-handoff](v2/research/NEXT-PHASE-HANDOFF.md), [inventory-plan](.local/tasks/v2-inventory-workflows.md) |
| `CAP-IDENTITY-ROLES` | Staff sign-in and role-based access | Sign in, act, and sign out (operator, manager, administrator) | approved | current | implemented | — | [handoff](v2/HANDOFF.md), [v1-v2](v2/research/v1-to-v2.md), [v1-manager-bundle](_archived/v1/artifacts/run-calculator/dist/public/assets/StaffManagementSurface-DRoVU1GR.js) |
| `CAP-IMPORT-CHEESE` | Cheese mix specification import | Review and link cheese specifications (manager) | approved | current | implemented | `CAP-SETUP-CATALOG` | [import-matrix](v2/research/v1-import-source-matrix.md), [v1-import-plan](v2/research/archive/repo-mirror/docs/import-system-plan.md), [import-plan](.local/tasks/v2-remaining-import-workflows.md) |
| `CAP-IMPORT-DOUGH` | Dough guide import | Review dough guide assignments (manager) | approved | current | implemented | `CAP-SETUP-CATALOG` | [import-matrix](v2/research/v1-import-source-matrix.md), [v1-import-plan](v2/research/archive/repo-mirror/docs/import-system-plan.md), [import-plan](.local/tasks/v2-remaining-import-workflows.md) |
| `CAP-IMPORT-PREMIX` | Premix workbook import | Review and apply premix formulas (manager) | approved | current | implemented | `CAP-SETUP-CATALOG` | [import-matrix](v2/research/v1-import-source-matrix.md), [v1-import-plan](v2/research/archive/repo-mirror/docs/import-system-plan.md), [import-plan](.local/tasks/v2-remaining-import-workflows.md) |
| `CAP-IMPORT-SAUCE` | Sauce guide import | Review sauce guide assignments (manager) | approved | current | implemented | `CAP-SETUP-CATALOG` | [import-matrix](v2/research/v1-import-source-matrix.md), [v1-import-plan](v2/research/archive/repo-mirror/docs/import-system-plan.md), [import-plan](.local/tasks/v2-remaining-import-workflows.md) |
| `CAP-IMPORT-SCHEDULING` | Scheduled recurring imports | Schedule a future import (manager) | candidate | none | not-started | — | [v1-import-plan](v2/research/archive/repo-mirror/docs/import-system-plan.md) |
| `CAP-IMPORT-SHIPPING` | Shipping guide import | Review packaging guide mappings (manager) | approved | current | implemented | `CAP-SETUP-CATALOG` | [import-matrix](v2/research/v1-import-source-matrix.md), [v1-import-plan](v2/research/archive/repo-mirror/docs/import-system-plan.md), [import-plan](.local/tasks/v2-remaining-import-workflows.md) |
| `CAP-IMPORT-SPEC` | Specification workbook import | Review and apply product specifications (manager) | approved | current | implemented | `CAP-SETUP-CATALOG` | [import-matrix](v2/research/v1-import-source-matrix.md), [v1-import-plan](v2/research/archive/repo-mirror/docs/import-system-plan.md), [import-plan](.local/tasks/v2-remaining-import-workflows.md) |
| `CAP-INCIDENT-QUEUE` | Reported issue and incident queue | Review reported issues (manager) | candidate | none | not-started | — | [next-handoff](v2/research/NEXT-PHASE-HANDOFF.md), [manager-plan](.local/tasks/v2-manager-operations-history.md) |
| `CAP-INVENTORY-LEDGER` | Warehouse inventory and opening counts | Count, transfer, and reconcile stock (warehouse, manager) | approved | current | implemented | `CAP-IDENTITY-ROLES` | [handoff](v2/HANDOFF.md), [v1-v2](v2/research/v1-to-v2.md), [v1-inventory-plan](v2/research/archive/repo-mirror/docs/inventory-autodeduction-plan.md), [inventory-plan](.local/tasks/v2-inventory-workflows.md) |
| `CAP-MANAGER-OPERATIONS` | Manager action queue and operational history | Review operational status and follow-up (manager) | approved | current | not-started | `CAP-IDENTITY-ROLES` | [manager-plan](.local/tasks/v2-manager-operations-history.md), [v1-audit](v2/research/archive/repo-mirror/docs/research-reconciliation/app-wide-audit-2026-10-29.md) |
| `CAP-MIX-PLAN` | Operational make-day mix plan | Review today's mix needs (operator, manager) | approved | current | not-started | `CAP-SCHEDULE-PLANNING`, `CAP-SETUP-CATALOG`, `CAP-PREP-MIX-STOCK` | [next-handoff](v2/research/NEXT-PHASE-HANDOFF.md), [mix-plan](.local/tasks/v2-operational-mix-plan.md) |
| `CAP-MULTIDEVICE-OFFLINE` | Shared runs and read-only offline access | Share, disconnect, and reconnect (operator, manager) | approved | current | implemented | `CAP-RUN-LIFECYCLE` | [handoff](v2/HANDOFF.md), [v1-v2](v2/research/v1-to-v2.md), [validation-plan](.local/tasks/v2-update-operational-validation.md) |
| `CAP-NATIVE-MOBILE` | Native mobile application | Use production tooling in a native app (operator, manager) | candidate | none | not-started | — | [next-handoff](v2/research/NEXT-PHASE-HANDOFF.md) |
| `CAP-NOTIFICATION-PREFERENCES` | Proactive notification preferences | Manage notification preferences (operator, manager) | candidate | none | not-started | — | [next-handoff](v2/research/NEXT-PHASE-HANDOFF.md), [v1-audit](v2/research/archive/repo-mirror/docs/research-reconciliation/app-wide-audit-2026-10-29.md) |
| `CAP-OFFLINE-WRITES` | Offline write access | Write production changes offline (operator, manager) | out-of-scope | none | not-started | — | [handoff](v2/HANDOFF.md), [gaps](v2/research/gaps.md) |
| `CAP-OPERATIONAL-DIAGNOSTICS` | Manager operational diagnostics | Review operational diagnostics (manager, administrator) | approved | current | not-started | `CAP-IDENTITY-ROLES` | [manager-plan](.local/tasks/v2-manager-operations-history.md), [handoff](v2/HANDOFF.md) |
| `CAP-PREP-MIX-STOCK` | Preparation and premix inventory | Prepare and consume mixes (operator, warehouse, manager) | approved | current | in-progress | `CAP-INVENTORY-LEDGER` | [v1-inventory-plan](v2/research/archive/repo-mirror/docs/inventory-autodeduction-plan.md), [v1-v2](v2/research/v1-to-v2.md), [inventory-plan](.local/tasks/v2-inventory-workflows.md) |
| `CAP-PRODUCTION-RULES` | Production rule checks | Configure and evaluate production rules (manager, operator) | approved | current | implemented | `CAP-RUN-LIFECYCLE`, `CAP-SETUP-CATALOG` | [handoff](v2/HANDOFF.md), [rules-test](v2/db/0008-production-rule-enforcement.test.sql) |
| `CAP-PRODUCTION-STATIONS` | Production station workflows | Work through the production line (operator, manager) | approved | current | implemented | `CAP-RUN-LIFECYCLE` | [handoff](v2/HANDOFF.md), [v1-v2](v2/research/v1-to-v2.md), [v1-station-plan](v2/research/archive/task-records/3911.md) |
| `CAP-QC-CHECKPOINTS` | QC checkpoints and review flags | Record a checkpoint and review a run (QC manager, supervisor, manager) | approved | current | not-started | `CAP-QC-EVIDENCE` | [next-handoff](v2/research/NEXT-PHASE-HANDOFF.md), [qc-extension-plan](.local/tasks/v2-qc-checkpoint-extension.md) |
| `CAP-QC-EVIDENCE` | Run-linked quality records | Record and review quality observations (operator, QC manager, manager) | approved | current | in-progress | `CAP-IDENTITY-ROLES`, `CAP-SETUP-CATALOG` | [gaps](v2/research/gaps.md), [next-handoff](v2/research/NEXT-PHASE-HANDOFF.md), [qc-plan](.local/tasks/v2-qc-allergen-workflows.md), [v1-qc-bundle](_archived/v1/artifacts/run-calculator/dist/public/assets/QcWorkflowTab-DnxuPoJS.js) |
| `CAP-RUN-CONSUMPTION` | Run consumption and inventory receipt | Complete a run and review inventory use (operator, manager, warehouse) | approved | current | implemented | `CAP-RUN-LIFECYCLE`, `CAP-INVENTORY-LEDGER` | [handoff](v2/HANDOFF.md), [v1-v2](v2/research/v1-to-v2.md) |
| `CAP-RUN-HISTORY-REPORTING` | Run history and operational reports | Review run history and reports (manager) | approved | current | not-started | `CAP-RUN-LIFECYCLE` | [manager-plan](.local/tasks/v2-manager-operations-history.md), [handoff](v2/HANDOFF.md), [v1-audit](v2/research/archive/repo-mirror/docs/research-reconciliation/app-wide-audit-2026-10-29.md) |
| `CAP-RUN-LIFECYCLE` | Canonical production run lifecycle | Create and control a run (operator, manager) | approved | current | implemented | `CAP-IDENTITY-ROLES` | [handoff](v2/HANDOFF.md), [v1-v2](v2/research/v1-to-v2.md), [v1-run-bundle](_archived/v1/artifacts/run-calculator/dist/public/assets/LiveRunContext-CGS0d3f4.js) |
| `CAP-SANDBOX-MODE` | Sandbox operating mode | Practice without changing live operations (manager, operator) | candidate | none | not-started | — | [next-handoff](v2/research/NEXT-PHASE-HANDOFF.md), [v1-audit](v2/research/archive/repo-mirror/docs/research-reconciliation/app-wide-audit-2026-10-29.md) |
| `CAP-SCHEDULE-IMPORT` | Reviewed schedule workbook import | Import a production schedule (manager) | approved | current | in-progress | `CAP-SCHEDULE-PLANNING` | [run-plan](.local/tasks/v2-scheduling-and-run-planning.md), [schedule-import-test](v2/core/schedule-workbook-import.test.mjs), [v1-import-plan](v2/research/archive/repo-mirror/docs/import-system-plan.md) |
| `CAP-SCHEDULE-PLANNING` | Dated schedule and run planning | Plan a production day (manager, operator) | approved | current | in-progress | `CAP-SETUP-CATALOG`, `CAP-RUN-LIFECYCLE` | [next-handoff](v2/research/NEXT-PHASE-HANDOFF.md), [run-plan](.local/tasks/v2-scheduling-and-run-planning.md), [v1-audit](v2/research/archive/repo-mirror/docs/research-reconciliation/app-wide-audit-2026-10-29.md) |
| `CAP-SETUP-CATALOG` | Reviewed production setup catalog | Review and apply setup data (manager) | approved | current | implemented | `CAP-IDENTITY-ROLES` | [handoff](v2/HANDOFF.md), [source-catalog](v2/research/source-catalog.md), [setup-test](v2/core/setup-catalog-csv.test.mjs) |
| `CAP-STAFF-RECOVERY` | Staff password recovery | Request and complete password recovery (operator, manager) | approved | current | in-progress | `CAP-IDENTITY-ROLES` | [next-handoff](v2/research/NEXT-PHASE-HANDOFF.md), [reset-plan](.local/tasks/v2-staff-password-reset.md), [handoff](v2/HANDOFF.md) |
| `CAP-SUBSTITUTIONS` | Run substitutions | Record and use a substitution (operator, manager) | approved | current | in-progress | `CAP-INVENTORY-LEDGER`, `CAP-ALLERGEN-EVIDENCE` | [next-handoff](v2/research/NEXT-PHASE-HANDOFF.md), [inventory-plan](.local/tasks/v2-inventory-workflows.md), [substitution-plan](.local/tasks/v2-substitution-station-visibility.md) |
| `CAP-V1-READONLY-ARCHIVE` | Restricted read-only V1 history archive | Review historical V1 records (owner, authorized auditor) | candidate | none | not-started | — | [v1-v2](v2/research/v1-to-v2.md), [gaps](v2/research/gaps.md) |
| `CAP-WAREHOUSE-EXPORT` | Export warehouse records | Export warehouse records (manager, warehouse) | approved | current | not-started | `CAP-INVENTORY-LEDGER` | [handoff](v2/HANDOFF.md), [inventory-plan](.local/tasks/v2-inventory-workflows.md) |

## Review notes

### `CAP-ACCESSIBILITY-RESPONSIVE` — Accessible responsive operations

- **Purpose:** Production and manager controls remain operable across supported web viewport sizes and assistive interaction needs.
- **Approved behavior:** Status is not conveyed by color alone. Responsive emulation is not labeled as physical-device or screen-reader proof.
- **Unresolved owner decisions:** Physical Android/iOS and screen-reader verification remain unrun where noted.
- **Implementation note:** Some V2 emulated viewport journeys exist; cross-domain and assistive technology coverage remains incomplete.
- **Acceptance checks:**
  - `responsive-workflow`: Key workflows remain reachable at desktop, phone, and tablet viewport sizes. — **no result recorded**
  - `device-evidence-label`: Browser emulation is not reported as physical device evidence. — **PASS (handoff)**

### `CAP-AI-IMPORT-MATCHING` — AI-assisted import matching

- **Purpose:** Explore optional suggestions for linking imported names to known production setup records.
- **Approved behavior:** No behavior is approved; this record is not a requirement.
- **Unresolved owner decisions:** Decide whether suggestions are valuable and define privacy, source authorization, evaluation, and no-auto-apply boundaries.
- **Implementation note:** Historical matching behavior is a discovery lead, not evidence that suggestions are safe or approved for future versions.

### `CAP-AI-OPERATIONAL-ASSISTANCE` — AI operational assistance

- **Purpose:** Explore whether AI-generated operational advice, anomaly detection, or insights should be offered.
- **Approved behavior:** No behavior is approved; this record is not a requirement.
- **Unresolved owner decisions:** Define user value, source authorization, privacy/retention, evaluation, and whether advice can affect production decisions.
- **Implementation note:** Historical experiments and tooling are not an approved user-facing capability or evidence of safe production quality.

### `CAP-ALLERGEN-EVIDENCE` — Allergen review and run visibility

- **Purpose:** Staff review ingredient allergen mappings and distinguish known, reviewed-empty, and unknown run states.
- **Approved behavior:** Missing/unreviewed mapping is unknown; reviewed-empty is distinct. Derived allergen status remains distinct from any manual run label. Badges use text/icon and do not rely on color alone.
- **Unresolved owner decisions:** Any clearance, cross-contact, label, or blocking policy requires qualified owner approval.
- **Implementation note:** V1 advisory status is evidenced; V2 mapping/review and operator visibility work is active.
- **Acceptance checks:**
  - `allergen-states`: Unknown, reviewed-empty, and known allergens remain distinguishable. — **NOT RUN (qc-plan)**
  - `allergen-badge`: Run/station status has accessible text plus an icon, not color alone. — **no result recorded**

### `CAP-APP-UPDATES` — Safe application updates

- **Purpose:** Staff can identify and apply non-critical web/PWA updates without losing active work.
- **Approved behavior:** An update does not force reload during active production work. Unavailable update checks have a clear fallback. Unsaved or unconfirmed work is preserved.
- **Unresolved owner decisions:** Physical installed-PWA behavior remains separate evidence.
- **Implementation note:** Historical V1 update control is documented; accepted V2 update behavior is not yet shown as delivered in handoff.
- **Acceptance checks:**
  - `update-no-loss`: An available update does not discard active or pending work. — **no result recorded**
  - `update-fallback`: Unavailable or failed checks leave production controls usable. — **no result recorded**

### `CAP-AUTOMATIC-TRACKING` — Automatic station progress

- **Purpose:** Due station counters advance without requiring an open browser, while pause, retry, and worker recovery remain safe.
- **Approved behavior:** A leased server worker advances due progress; browsers do not submit progress ticks. Retries and worker restarts cannot duplicate accepted progress.
- **Unresolved owner decisions:** Production supervision and measured load remain unverified.
- **Implementation note:** V2 worker, leases, pause-aware tracking, and restart checks exist; production operation is not proven.
- **Acceptance checks:**
  - `track-due-once`: A due station action advances once and respects pause and target limits. — **PASS (worker-test)**
  - `worker-recovery`: Worker restart or stale lease does not duplicate committed progress. — **PASS (handoff)**

### `CAP-CAST-SCREENS` — Cast production status to screens

- **Purpose:** Explore a separate read-only floor display for production status.
- **Approved behavior:** No behavior is approved; this record is not a requirement.
- **Unresolved owner decisions:** Whether a shared display is needed and what information it may show.
- **Implementation note:** Candidate only; no product requirement or verification is asserted.

### `CAP-CUTOVER-BOUNDARY` — Safe V1-to-V2 cutover boundary

- **Purpose:** V2 begins with approved setup/identity decisions and a fresh physical count, without implying historical data recovery.
- **Approved behavior:** Fresh sign-in is required. Opening inventory comes from a new physical count. No V1 production history or credential/session material is imported by this catalog task.
- **Unresolved owner decisions:** Actual transfer mappings, source/destination authorization, archive retention, and cutover timing are not decided here.
- **Implementation note:** Boundary and synthetic rehearsal are documented; actual row-level transfer and cutover are not run.
- **Acceptance checks:**
  - `cutover-fresh-count`: Any authorized cutover uses a reviewed new physical count rather than V1 balances. — **NOT RUN (handoff)**
  - `cutover-exclusions`: No V1 run history, sessions, or reset tokens enter V2. — **no result recorded**

### `CAP-DEPLOYMENT-BOUNDARY` — Isolated V2 deployment and worker

- **Purpose:** V2 API and background worker run within an isolated, reviewed deployment and database boundary.
- **Approved behavior:** V2 must not connect to V1 production. API and worker are separately supervised and use least-privilege access. No publish occurs until database objects and runtime access are reviewed.
- **Unresolved owner decisions:** Separate project/database provisioning and production privilege review remain outstanding.
- **Implementation note:** V2 private preview exists; production deployment and publish are intentionally not complete.
- **Acceptance checks:**
  - `deploy-isolation`: V2 runtime uses only its authorized isolated database and identity boundary. — **no result recorded**
  - `deploy-worker`: API/worker health, restart behavior, and aggregate connection budget are verified before release. — **BLOCKED (handoff)**

### `CAP-DIE-DEFAULTS` — Reviewed die and line defaults

- **Purpose:** Managers review die defaults and run setup applies active values without overwriting explicit operator choices.
- **Approved behavior:** Imported values remain suggestions until reviewed. Defaults fill only eligible blanks and do not alter active-run snapshots. Bought crust setups do not acquire a die.
- **Unresolved owner decisions:** No owner decision is currently listed.
- **Implementation note:** V2 reviewed, revisioned defaults are connected to run setup; browser/physical-device limits remain in the handoff.
- **Acceptance checks:**
  - `die-review`: Unreviewed values are not used as active defaults. — **PASS (die-test)**
  - `die-snapshot`: Default changes do not mutate existing run snapshots. — **PASS (next-handoff)**

### `CAP-EXPORT-RECIPES` — Recipe and specification export

- **Purpose:** Managers export supported recipe/setup information for review or portability.
- **Approved behavior:** No behavior is approved; this record is not a requirement.
- **Unresolved owner decisions:** Decide whether manager-facing specification export belongs in a future version and what data it may include.
- **Implementation note:** Historical V1 deterministic library export behavior is evidenced; no V2/V3 export requirement is approved here.

### `CAP-FINISHED-GOODS` — Finished-case corrections

- **Purpose:** Authorized staff record reviewed changes to finished-case quantities with attributed history.
- **Approved behavior:** Corrections are attributable and do not silently rewrite prior movements.
- **Unresolved owner decisions:** Correction/return semantics require the specific accepted task decision before implementing new cases.
- **Implementation note:** V1 adjustments are evidenced in research; accepted V2 workflow is in progress.
- **Acceptance checks:**
  - `finished-correction-audit`: A correction records actor, reason, time, and a new ledger outcome. — **NOT RUN (inventory-plan)**

### `CAP-FREEZER-CYCLE-COUNTS` — Freezer pulls and cycle counts

- **Purpose:** Managers define count/pull needs and staff can identify due inventory actions with recorded outcomes.
- **Approved behavior:** Due status must be traceable to saved configuration and operational dates. Count discrepancies are recorded, not silently adjusted.
- **Unresolved owner decisions:** Any new timing, waste, or return policy remains owner-controlled.
- **Implementation note:** V1 configuration/reminder and cycle-count surfaces are documented; V2 parity remains assigned work.
- **Acceptance checks:**
  - `freezer-pull-due`: A configured pull becomes visible when due and does not duplicate after refresh. — **NOT RUN (inventory-plan)**
  - `cycle-count-ledger`: A reviewed cycle count creates a traceable stock movement. — **no result recorded**

### `CAP-IDENTITY-ROLES` — Staff sign-in and role-based access

- **Purpose:** Staff sign in to the production tool and receive only the actions allowed by their server-verified role.
- **Approved behavior:** Authorization derives from verified server identity, not browser-supplied actor or facility values. V2 sessions are separate from V1 sessions.
- **Unresolved owner decisions:** Any future account/role transfer needs an explicit mapping and separate rehearsal approval.
- **Implementation note:** V2 sign-in, session handling, and capability checks exist; full security certification is not claimed.
- **Acceptance checks:**
  - `auth-role-gate`: A staff session can use permitted routes while unauthorized roles are denied server-side. — **PASS (auth-test)**
  - `auth-fresh-session`: A V2 session does not reuse V1 session material. — **PASS (handoff)**

### `CAP-IMPORT-CHEESE` — Cheese mix specification import

- **Purpose:** Managers review cheese recipe components and explicitly map them to supported applicator slots.
- **Approved behavior:** Only explicit brand/flavor and applicator assignments are linked. Missing/conflicting slots and formula amounts remain unresolved. Uploaded workbook bytes are not retained.
- **Unresolved owner decisions:** V2 does not create a separate cheese-recipe catalog in this flow.
- **Implementation note:** V2 supports bounded assignment and slot layouts; ambiguous rows require manager correction.
- **Acceptance checks:**
  - `cheese-slot-explicit`: A candidate cannot be applied without a valid explicit cheese applicator target. — **PASS (source-import-test)**

### `CAP-IMPORT-DOUGH` — Dough guide import

- **Purpose:** Managers review explicit brand/flavor-to-dough-recipe assignments from supported guide rows.
- **Approved behavior:** Only explicit supported row assignments are linked. Malformed, formula, duplicate, or ambiguous rows are unresolved or skipped, not guessed. Uploaded source content is not retained.
- **Unresolved owner decisions:** No fuzzy brand/flavor link is made.
- **Implementation note:** V2 supports deterministic column-A assignment rows; other workbook columns are ignored as documented.
- **Acceptance checks:**
  - `dough-guide-explicit`: Only explicit supported brand/flavor mappings are applied and duplicate targets remain unresolved. — **PASS (source-import-test)**

### `CAP-IMPORT-PREMIX` — Premix workbook import

- **Purpose:** Managers import premix formulas while keeping per-pizza ounces and per-batch pounds distinct.
- **Approved behavior:** Source quantity bases remain distinct and blank amounts remain unknown. Formula quantities and duplicate or ambiguous targets require review. Uploaded workbook bytes are not retained.
- **Unresolved owner decisions:** Brand, flavor, enabled, and prep values are not inferred from workbook omissions.
- **Implementation note:** V2 supports a bounded deterministic premix layout; complete real-source fidelity is not claimed.
- **Acceptance checks:**
  - `premix-units`: Per-pizza ounces and per-batch pounds persist independently; unknown amounts are not converted or guessed. — **PASS (source-import-test)**

### `CAP-IMPORT-SAUCE` — Sauce guide import

- **Purpose:** Managers review explicit sauce recipe assignments and amounts for named product varieties.
- **Approved behavior:** Only supported sentence or row layouts and explicit amounts are applied. Ambiguous flavor splits, missing amounts, and unsupported DOCX layouts remain unresolved. Uploaded source content is not retained.
- **Unresolved owner decisions:** Unknown sauce identities are not guessed or linked fuzzily.
- **Implementation note:** V2 supports bounded deterministic sauce guide layouts; unsupported layouts remain review-only.
- **Acceptance checks:**
  - `sauce-guide-explicit`: Only explicit positive amounts and unambiguous brand/flavor assignments are applied. — **PASS (source-import-test)**

### `CAP-IMPORT-SCHEDULING` — Scheduled recurring imports

- **Purpose:** Explore applying a recurring source on a schedule after a recurring source and safe workflow are established.
- **Approved behavior:** No behavior is approved; this record is not a requirement.
- **Unresolved owner decisions:** Confirm a recurring source, asynchronous authorization model, and recovery requirements before approving scope.
- **Implementation note:** No recurring auto-apply behavior is approved or evidenced.

### `CAP-IMPORT-SHIPPING` — Shipping guide import

- **Purpose:** Managers review supported shipping-guide packaging values without fuzzy product identity or guessed fields.
- **Approved behavior:** Supported packaging values retain source meaning. Unknown values, formulas, and unsupported columns remain unresolved. The existing capacity importer remains separate.
- **Unresolved owner decisions:** Unrecognized packaging codes require explicit correction.
- **Implementation note:** V2 supports a bounded shipping-guide layout; product labels are not fuzzy-linked.
- **Acceptance checks:**
  - `shipping-unknown`: Unsupported shipping values remain unresolved and are not silently mapped. — **PASS (source-import-test)**

### `CAP-IMPORT-SPEC` — Specification workbook import

- **Purpose:** Managers review supported product specification tables and correct unresolved recipe or setup mappings.
- **Approved behavior:** Only the documented Brand/Flavor table layout is applied. Unsupported populated columns, formulas, and ambiguous links remain unresolved. Uploaded workbook bytes are not retained.
- **Unresolved owner decisions:** Broader AI layouts, photographs, and OCR require separate approval.
- **Implementation note:** V2 supports a bounded deterministic spec-sheet subset; it does not claim full fidelity to all V1 workbooks.
- **Acceptance checks:**
  - `spec-import-layout`: The supported table maps its explicitly named fields, while unsupported fields remain review-only. — **PASS (source-import-test)**

### `CAP-INCIDENT-QUEUE` — Reported issue and incident queue

- **Purpose:** Explore a manager workflow for reviewing and tracking reported operational issues.
- **Approved behavior:** No behavior is approved; this record is not a requirement.
- **Unresolved owner decisions:** Decide whether to add the queue and define visibility, retention, and action ownership.
- **Implementation note:** Historical incident-pattern surfaces are documented; this candidate does not claim an approved V2 queue.

### `CAP-INVENTORY-LEDGER` — Warehouse inventory and opening counts

- **Purpose:** Managers track facility inventory across warehouses through reviewed opening counts and an auditable movement ledger.
- **Approved behavior:** V2 stock starts from a reviewed physical count. Stock changes are represented by server-owned movements and do not create negative balances.
- **Unresolved owner decisions:** Actual cutover count and any new waste/return policy need separate owner approval.
- **Implementation note:** V2 ledger, multi-warehouse stock, opening counts, and run linkage exist; full manager journey and physical quantities remain unverified.
- **Acceptance checks:**
  - `inventory-ledger-balance`: Accepted stock movements and on-hand balances reconcile atomically. — **PASS (inventory-test)**
  - `inventory-opening-count`: Movement is gated until each warehouse has an applied opening count. — **PASS (handoff)**

### `CAP-MANAGER-OPERATIONS` — Manager action queue and operational history

- **Purpose:** Managers review bounded action queues, data-health findings, incidents, and attributed follow-up actions.
- **Approved behavior:** Incomplete evidence is labeled explicitly. Domain-specific inventory, import, schedule, and QC actions remain in their owning workflows. Manager actions are authorized and attributed.
- **Unresolved owner decisions:** Retention period and external notification delivery remain owner-controlled.
- **Implementation note:** V1 manager panels are described in accepted plans and historical audit; the V2 action queue and cross-domain workspace are not evidenced as delivered.
- **Acceptance checks:**
  - `manager-role`: Only authorized managers can review or change manager action state. — **no result recorded**
  - `manager-coverage`: Reports show their date/source coverage and incomplete evidence. — **no result recorded**

### `CAP-MIX-PLAN` — Operational make-day mix plan

- **Purpose:** Operators see read-only mix preparation needs derived from scheduled and active runs.
- **Approved behavior:** Planning view is distinct from Mix Recipes master data. Missing amounts and incomplete mixes are warnings, not guessed quantities.
- **Unresolved owner decisions:** Make-day quantity/date semantics must follow documented sources; genuinely ambiguous production meaning is owner-controlled.
- **Implementation note:** V1 planning view is documented; V2 operational plan implementation is accepted but not reflected in current handoff as delivered.
- **Acceptance checks:**
  - `mix-plan-current`: Plan reflects canonical planned/active runs and shows each source quantity and unit. — **no result recorded**
  - `mix-plan-unknown`: Missing recipe values produce explicit warnings without invented quantities. — **no result recorded**

### `CAP-MULTIDEVICE-OFFLINE` — Shared runs and read-only offline access

- **Purpose:** Multiple signed-in devices share the same run, and disconnected users can inspect cached state without writing.
- **Approved behavior:** The server remains canonical across devices. Disconnected state is read-only and reconnect adopts confirmed server state.
- **Unresolved owner decisions:** Physical Android/iOS wake and device handoff remain unverified.
- **Implementation note:** V2 emulated-browser tests cover offline reload, reconnect, and two-session conflicts; physical devices remain unverified.
- **Acceptance checks:**
  - `peer-convergence`: Two signed-in sessions converge on the canonical run after accepted changes. — **PASS (handoff)**
  - `offline-read-only`: Offline cached views clearly remain read-only until canonical reconnect. — **PASS (handoff)**

### `CAP-NATIVE-MOBILE` — Native mobile application

- **Purpose:** Explore a separately installed native application for production operations.
- **Approved behavior:** No behavior is approved; this record is not a requirement.
- **Unresolved owner decisions:** Whether there is a user need and whether native mobile belongs in a later release.
- **Implementation note:** No native app scope is approved or implemented in this catalog.

### `CAP-NOTIFICATION-PREFERENCES` — Proactive notification preferences

- **Purpose:** Explore user-controlled preferences for optional proactive browser notifications.
- **Approved behavior:** No behavior is approved; this record is not a requirement.
- **Unresolved owner decisions:** Decide which notification types are useful and how permissions, privacy, and delivery are handled.
- **Implementation note:** Historical preferences and alerts are evidence for discovery, not approval of a V2/V3 notification policy.

### `CAP-OFFLINE-WRITES` — Offline write access

- **Purpose:** Allow users to submit production changes while disconnected from the canonical server.
- **Approved behavior:** Cached offline state is read-only until reconnect and server confirmation.
- **Unresolved owner decisions:** Reconsider only after an explicit owner scope change and conflict/safety review.
- **Implementation note:** Not an approved V2 capability; no offline-write behavior is being added.
- **Acceptance checks:**
  - `offline-no-write`: Disconnected sessions cannot commit production changes. — **NOT RUN (gaps)**

### `CAP-OPERATIONAL-DIAGNOSTICS` — Manager operational diagnostics

- **Purpose:** Managers inspect bounded system and workflow health without seeing credentials or raw operational payloads.
- **Approved behavior:** Diagnostics use bounded, privacy-safe evidence. A warning is not represented as proof of data corruption.
- **Unresolved owner decisions:** No owner decision is currently listed.
- **Implementation note:** V1 diagnostic surfaces are documented; the accepted V2 diagnostics task remains pending.
- **Acceptance checks:**
  - `diagnostics-privacy`: Manager diagnostics show bounded status and never expose secrets or request/recipe payloads. — **no result recorded**

### `CAP-PREP-MIX-STOCK` — Preparation and premix inventory

- **Purpose:** Staff prepare mixes and distinguish prepared stock from raw ingredients and production demand.
- **Approved behavior:** Prepared and raw inventory remain distinct. Unknown quantities and units remain visible rather than inferred.
- **Unresolved owner decisions:** Any waste, spoilage, or return rule needs explicit approval.
- **Implementation note:** V1 prep semantics are documented; remaining complete V2 operational parity is assigned work.
- **Acceptance checks:**
  - `prep-stock-distinct`: Preparation movements preserve separate raw and prepared stock balances. — **NOT RUN (inventory-plan)**
  - `prep-repeat-safe`: A repeated preparation command does not duplicate stock changes. — **no result recorded**

### `CAP-PRODUCTION-RULES` — Production rule checks

- **Purpose:** Managers define production rules that warn or block run start according to the approved rule mode.
- **Approved behavior:** Flexible rules warn while strict rules block Start. Rules do not run merely because imported or previewed.
- **Unresolved owner decisions:** No owner decision is currently listed.
- **Implementation note:** V2 server-enforced production rule checks are implemented and disposable database tested.
- **Acceptance checks:**
  - `rule-mode`: Strict rules block invalid Start and flexible rules report a warning. — **PASS (rules-test)**

### `CAP-PRODUCTION-STATIONS` — Production station workflows

- **Purpose:** Operators record production progress for the approved line and finishing stations.
- **Approved behavior:** Station changes are validated against canonical run revisions. Station-specific calculations and units must remain distinguishable.
- **Unresolved owner decisions:** Owner-approved floor examples remain needed for operational calculation verification.
- **Implementation note:** V2 includes Line, Dough, Cheese, Pepperoni, Sauce, Frontline, and Packaging workflows; physical device/floor evidence is not claimed.
- **Acceptance checks:**
  - `station-canonical-write`: Station edits and progress are validated and reflected in the canonical run. — **PASS (station-test)**
  - `station-floor-math`: Station values agree with owner-approved floor examples. — **NOT RUN (handoff)**

### `CAP-QC-CHECKPOINTS` — QC checkpoints and review flags

- **Purpose:** Authorized QC staff record source-bounded checkpoint observations and managers mark records for review.
- **Approved behavior:** A review flag means needs review, not a production/shipping hold. No threshold or compliance result is inferred without an approved reference.
- **Unresolved owner decisions:** Any evaluated limit, retention change, or enforcement requires qualified policy approval.
- **Implementation note:** The next-phase handoff identifies V1 HACCP/Brix history proposals; separate V2 checkpoint expansion is accepted but dependent on QC foundation.
- **Acceptance checks:**
  - `checkpoint-audit`: Checkpoint observations and corrections preserve actor, server time, and history. — **no result recorded**
  - `checkpoint-review`: Review flags communicate review-needed state without blocking production. — **no result recorded**

### `CAP-QC-EVIDENCE` — Run-linked quality records

- **Purpose:** Authorized staff record bounded quality observations and managers review history without implying certification.
- **Approved behavior:** Unknown or unevaluated stays distinct from pass. QC observations do not block production/shipping or claim regulatory compliance. Corrections and review history remain attributed.
- **Unresolved owner decisions:** Qualified references, tolerances, and retention changes need separate explicit approval.
- **Implementation note:** Historical advisory behavior is documented; accepted V2 QC implementation is active.
- **Acceptance checks:**
  - `qc-unknown`: Missing target/reference yields not evaluated, not an assumed pass. — **NOT RUN (qc-plan)**
  - `qc-history`: Authorized corrections are attributable and visible in history. — **no result recorded**
  - `qc-nonblocking`: QC records do not silently block production or shipping. — **no result recorded**

### `CAP-RUN-CONSUMPTION` — Run consumption and inventory receipt

- **Purpose:** Completing a run records actual material use against the selected warehouse and preserves a receipt.
- **Approved behavior:** Run completion and stock movements commit atomically. Shortages are recorded without negative on-hand stock or blocking completion.
- **Unresolved owner decisions:** No owner decision is currently listed.
- **Implementation note:** V2 freezes setup/warehouse on runs and records exact-once inventory deductions and shortage receipts.
- **Acceptance checks:**
  - `consumption-atomic`: Accepted run completion and inventory movements commit together. — **PASS (inventory-test)**
  - `consumption-retry`: Retrying completion does not deduct stock twice. — **PASS (handoff)**

### `CAP-RUN-HISTORY-REPORTING` — Run history and operational reports

- **Purpose:** Managers review completed-run summaries, event history, shift handoffs, and bounded operational trends.
- **Approved behavior:** History is based on canonical V2 records with visible date/source coverage. V1 production history is not imported.
- **Unresolved owner decisions:** Retention and external notification delivery remain owner-controlled.
- **Implementation note:** V1 reporting surfaces are documented; the complete V2 cross-run history/report workspace is not evidenced as delivered.
- **Acceptance checks:**
  - `history-source-coverage`: A manager can inspect V2 run history with explicit date range and incomplete-source notices. — **no result recorded**
  - `history-no-v1-data`: The V2 history view does not imply that V1 production records were recovered. — **no result recorded**

### `CAP-RUN-LIFECYCLE` — Canonical production run lifecycle

- **Purpose:** Operators create, start, pause, resume, and complete a run with server-confirmed state.
- **Approved behavior:** The server owns canonical lifecycle state, revisions, receipts, and timestamps. A retry of an accepted command does not duplicate its effect.
- **Unresolved owner decisions:** No owner decision is currently listed.
- **Implementation note:** V2 server-owned lifecycle and command services are implemented; broad floor certification remains separate.
- **Acceptance checks:**
  - `run-transition`: Allowed lifecycle transitions persist canonical state and reject stale revisions. — **PASS (run-test)**
  - `run-retry`: Exact retries return the prior outcome without a second transition. — **PASS (handoff)**

### `CAP-SANDBOX-MODE` — Sandbox operating mode

- **Purpose:** Explore a separated practice mode that prevents synthetic work from changing live operational records.
- **Approved behavior:** No behavior is approved; this record is not a requirement.
- **Unresolved owner decisions:** Decide whether practice mode is needed and define isolation, identity, and data-retention boundaries.
- **Implementation note:** Historical sandbox-related code/research is not treated as a new V2/V3 requirement.

### `CAP-SCHEDULE-IMPORT` — Reviewed schedule workbook import

- **Purpose:** Managers review schedule workbook days and rows before applying each planned day.
- **Approved behavior:** Import never starts a live run. Ambiguous or skipped rows and per-day outcomes are visible. A lost reply does not duplicate or delete planned runs.
- **Unresolved owner decisions:** No owner decision is currently listed.
- **Implementation note:** V2 parser and tests exist; accepted manager review/apply and full recovery journey remain assigned.
- **Acceptance checks:**
  - `schedule-import-never-starts`: Applying an imported schedule changes only planned data. — **PASS (schedule-import-test)**
  - `schedule-import-retry`: Per-day retry after an uncertain response preserves one canonical plan. — **no result recorded**

### `CAP-SCHEDULE-PLANNING` — Dated schedule and run planning

- **Purpose:** Managers order planned runs and breaks without conflating planned work with live run state.
- **Approved behavior:** Planned runs remain distinct from live lifecycle records. Unknown durations remain unknown rather than receiving invented estimates. Stale and lost-reply writes preserve canonical plans.
- **Unresolved owner decisions:** Ask the owner only if an unsupported time basis or duration changes production meaning.
- **Implementation note:** V2 planning schema/core is present; complete manager workflow and two-device verification remain assigned.
- **Acceptance checks:**
  - `schedule-live-separation`: Editing a plan does not start, stop, or rewrite a live run. — **PASS (schedule-test)**
  - `schedule-convergence`: Authorized edits are revision-checked and converge after reload/reconnect. — **no result recorded**

### `CAP-SETUP-CATALOG` — Reviewed production setup catalog

- **Purpose:** Managers maintain facility production setup and master data through validated, reviewable imports.
- **Approved behavior:** Imported mappings remain reviewable and unknown links are not guessed. V2 setup data remains isolated from V1 schemas and production records.
- **Unresolved owner decisions:** Actual row-level cutover requires approved mappings and separate source/destination authorization.
- **Implementation note:** V2 has manager-only setup catalog families, templates, staging, review, Apply, history, and guarded Undo.
- **Acceptance checks:**
  - `setup-review-apply`: Manager can stage, review, apply, and inspect setup import history. — **PASS (setup-test)**
  - `setup-no-guess`: Unknown identities and unsupported fields remain unresolved rather than guessed. — **PASS (handoff)**

### `CAP-STAFF-RECOVERY` — Staff password recovery

- **Purpose:** Staff request account recovery and managers approve or deny it without exposing recovery secrets.
- **Approved behavior:** Requests do not reveal arbitrary username existence. Recovery is short-lived, single-use, and revokes old sessions as defined. Recovery codes never appear in logs or ordinary history.
- **Unresolved owner decisions:** No email/SMS or external identity provider is approved by this scope.
- **Implementation note:** The V2 recovery flow is accepted and assigned; complete behavior is not yet evidenced in the handoff.
- **Acceptance checks:**
  - `recovery-replay`: Recovery expires and cannot be replayed after successful use. — **NOT RUN (reset-plan)**
  - `recovery-session`: Approval, denial, and password change preserve the accepted session-revocation policy. — **no result recorded**

### `CAP-SUBSTITUTIONS` — Run substitutions

- **Purpose:** Authorized staff record a run-specific substitution and inventory use follows the substituted ingredient identity.
- **Approved behavior:** Substitutions remain attached to the run and affect inventory consumption. A substitution does not imply allergen clearance or product safety.
- **Unresolved owner decisions:** Any safety or allergen interpretation remains subject to separate qualified policy approval.
- **Implementation note:** Historical substitution behavior is documented; V2 accounting and visibility parity work is active.
- **Acceptance checks:**
  - `substitution-consumption`: Run receipt consumes the selected substituted inventory identity. — **NOT RUN (inventory-plan)**
  - `substitution-visible`: Run and affected station show accessible substitution status. — **no result recorded**

### `CAP-V1-READONLY-ARCHIVE` — Restricted read-only V1 history archive

- **Purpose:** Explore whether an authorized, restricted read-only archive should preserve access to V1 history after cutover.
- **Approved behavior:** No behavior is approved; this record is not a requirement.
- **Unresolved owner decisions:** Decide whether an archive is needed, who may access it, and how long it may be retained.
- **Implementation note:** No V1 production records or archive were created or recovered by this work.

### `CAP-WAREHOUSE-EXPORT` — Export warehouse records

- **Purpose:** Authorized managers export warehouse records in a portable, reviewable format.
- **Approved behavior:** Export includes only approved warehouse records and preserves source/coverage limitations. Export does not imply V1 production records are available.
- **Unresolved owner decisions:** Any additional export fields or retention behavior require explicit review.
- **Implementation note:** Accepted export work is pending; no completed V2 export behavior is evidenced in the supplied handoff.
- **Acceptance checks:**
  - `warehouse-export-scope`: A manager can export the approved warehouse records and review the output for scope and completeness. — **no result recorded**

## Reading this inventory

Decision authority, release scope, implementation delivery, and evidence outcomes are separate. The structural check validates the catalog format and references only; it does not certify evidence quality, product policy, or release readiness.
