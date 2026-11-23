# V2 database readiness review

**Status:** Development repaired and verified; production remains unchanged and incomplete.
**Checked:** 2026-11-23

This document records the full V2 migration scope and the safe next steps for
reconciling the managed development and production databases. It is not an
executable migration package.

## Initial read-only production findings

The initial authorized catalog check found:

- V2 currently has 21 tables, 49 functions, and 7 non-internal triggers.
- The `v2_runtime_access` database role is absent.
- These required tables are absent: `manager_action_events`,
  `production_schedules`, `qc_events`, `qc_ingredient_link_events`,
  `qc_run_substitutions`, `staff_account_change_events`, and
  `staff_password_reset_requests`.
- These route-facing functions are absent: `get_production_schedule`,
  `list_schedule_run_templates`, `get_manager_operations_snapshot`,
  `list_staff_account_change_history`, and
  `list_run_operational_substitutions`.
- An authorized aggregate-only inventory check found no balance rows and no
  positive balance quantity. The opening-lot backfill in
  `0008-inventory-parity.sql` would therefore insert zero lots at that snapshot.

The missing objects span multiple features; a route-only subset is not a
complete repair. In particular, manager operations rely on both schedule and
QC data, the operational mix-plan reader relies on schedules and inventory,
and the run substitution-status reader depends on QC substitutions.

## November 23 catalog reconciliation and development repair

A fresh read-only comparison before the repair found that development and production both
databases have the same V2 table and function names as the first six core SQL
migrations: 21 tables and 49 functions. Across all 22 checked-in migrations,
the source defines 51 distinct table names and 121 distinct function names.
Both were missing 30 table names and 72 function names from that full set.

The missing groups cover reviewed setup catalogs; inventory lots, preparation,
transfers, and cycle counts; production rules; QC and allergens; die defaults;
production schedules; password resets; operational mix planning; QC
substitutions; import-link corrections; manager operations; substitution
status; and staff-account history. The exact source files are listed below.

`list_run_products(uuid)` exists, but its database definition is stale: it
does not include the die-default data expected by the current API. This
explains the run-products route error. Schedule, manager-operations,
password-reset, and account-history routes also call functions absent from
both databases. The evidence points to incomplete V2 database initialization,
not a general inability to connect to PostgreSQL.

The development repair applied all 16 migrations after its verified core
baseline, in source order and in per-file transactions. Post-checks found 51
V2 tables, 122 function names, all route-facing functions, the updated
run-products function, and the required triggers. The inventory backfill ran
while the balances table was locked and empty, so it added zero opening lots.
Existing stable-row hashes and existing non-seed role hashes matched; the only
changing row was the station worker lease heartbeat.

Production remains at the original 21 tables and 49 functions. Its schedules,
password-reset functions, and inventory-lot table are still absent, and its
run-products function is still stale. This confirms the production problem is
separate from V2's successful PostgreSQL connection.

The latest aggregate-only check before development repair found zero balance
rows and zero positive balance quantity in both databases. The production
inventory count should be checked again immediately before its migration
because balances may change.

The V2 Production Assistant workflow is healthy in development and its health
endpoint reports the station worker active. The generic development domain
still serves the legacy artifact shell, so V2 should be opened from the V2
Production Assistant workflow preview. This routing distinction is separate
from the missing production database objects.

## November 23 validation

- The isolated V2 Agent Test Preview applied all 22 migration sources to its
  disposable database and passed its browser flow.
- `pnpm --dir v2 run test:db` passed after the PostgreSQL browser integration
  was corrected to wait for the saved station value to return after reload.
  That test now checks server-backed persistence instead of reading the
  page's cached form immediately after reload.
- Chromium coverage passed. WebKit-specific coverage remains unavailable in
  this Nix environment because its native libraries are not installed.
- No production database was modified. Development changes were approved and
  applied only after the complete migration suite passed against a disposable
  database and the shared development baseline was rechecked.
- The database tool rejected a combined 16-file request before SQL ran because
  it exceeded the request-size limit. Development migrations were therefore
  applied in source order, one transaction-wrapped file at a time; all 16
  committed successfully.

## Complete numbered migration source set

There are 22 numbered migration files. The previous Agent Preview manifest
listed 21 and omitted `0011-run-operational-substitution-status.sql`; that
source is now included, and a regression test requires the manifest to cover
every numbered migration exactly once.

| Source | Feature area |
| --- | --- |
| `0001-run-control.sql` | Shared run state, lifecycle, events, and receipts |
| `0002-staff-auth.sql` | Facility scope, staff, roles, sessions, first-manager bootstrap |
| `0003-production-stations.sql` | Station progress, worker leases, and auto-track commands |
| `0004-import-inventory.sql` | Inventory, product/master records, imports, and counts |
| `0005-dough-capacity-sources.sql` | Dough capacity and workbook-source reads |
| `0006-run-inventory-linkage.sql` | Run snapshots and inventory consumption |
| `0007-approved-setup-catalogs.sql` | Reviewed setup catalogs and manager lists |
| `0007-staff-role-equivalents.sql` | Staff capability/role equivalents |
| `0008-inventory-parity.sql` | Lots, preparation, transfers, cycle counts, and balance backfill |
| `0008-production-rule-enforcement.sql` | Production-rule persistence and run-start enforcement |
| `0008-qc-workflows.sql` | QC evidence and manager QC settings |
| `0008-reviewed-die-defaults.sql` | Reviewed die defaults and run snapshots |
| `0009-production-schedules.sql` | Schedules, templates, and schedule commands |
| `0009-qc-ingredient-links.sql` | Ingredient/allergen links and run allergen snapshots |
| `0009-staff-password-resets.sql` | Staff password-reset requests and events |
| `0010-operational-mix-plan.sql` | Operational mix-plan source reader |
| `0010-qc-substitutions.sql` | QC substitutions and inventory accounting |
| `0010-workbook-link-corrections.sql` | Reviewed import-source link corrections |
| `0011-manager-operations.sql` | Manager operations events and summary |
| `0011-qc-checkpoint-review.sql` | QC checkpoint review and corrective evidence |
| `0011-run-operational-substitution-status.sql` | Run-scoped substitution status |
| `0012-staff-account-history.sql` | Staff-account change history |

The numbered sources are not safe to replay blindly against an existing
database: the first six already define the current core objects, and later
files build on earlier tables, functions, and grants. The existing
`development-activation.mjs` is also not a full-feature migration set; it
contains a smaller, baseline-fingerprinted set of sources and must not be
treated as a repair for the absent schedule, QC, and substitution dependencies.

## Managed database change boundary

For Replit-managed PostgreSQL, Publish synchronizes supported schema objects
from the development database: tables, columns, indexes, constraints, enums,
sequences, views, and row-level security. It does not create or synchronize
custom functions/procedures, triggers, database roles, grants, or some RLS
details.

Accordingly:

1. First determine and rehearse the complete additive change from the current
   development baseline using a disposable database. Preserve existing rows
   and prove all migration dependencies and role permissions before any
   shared-database write.
2. Use the supported managed-schema flow for objects it can represent. Review
   its proposed changes for destructive drops or unintended renames.
3. Treat functions, triggers, roles, and grants as a separate, explicitly
   reviewed operation. They require the database owner's separate approval
   and handling; this document does not provide SQL to paste into production.
4. After any approved application, verify the exact required objects and
   execute the affected authenticated route/browser checks before relying on
   those workflows.

The approved development change does not authorize production database
modification or changing the published schema. Production still needs the
supported table/constraint publish flow and a separately reviewed application
of functions, triggers, grants, and required static role seeds. See Replit's
[managed database change flow](https://docs.replit.com/features/data-and-storage/publish-database-changes)
and [unsupported database objects](https://docs.replit.com/help/troubleshooting/databases).
