# V2 database readiness review

**Status:** Review-only; no shared database was changed.
**Checked:** 2026-11-22

This document records the full V2 migration scope and the safe next steps for
reconciling the managed development and production databases. It is not an
executable migration package.

## Read-only production findings

The authorized catalog check found:

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

The current review approval covered preparing this package only. It does not
authorize database writes, direct production SQL, or changing the published
schema. See Replit's
[managed database change flow](https://docs.replit.com/features/data-and-storage/publish-database-changes)
and [unsupported database objects](https://docs.replit.com/help/troubleshooting/databases).
