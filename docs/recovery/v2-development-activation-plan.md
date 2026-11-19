# V2 development activation: inspection and proposed change

Status: **approved and applied to managed development only.** The restricted
access group exists; the API and worker credential switch was not authorized
or performed.

## Target and boundaries

Only the assigned workspace's managed **development** database, `heliumdb`,
schema `v2`. The database callback explicitly selected `development`.
The runtime launcher maps the project connection to V2 when
`V2_USE_PROJECT_DATABASE=true`. Reconfirm target identity immediately before
any approved write; a database name alone is not a unique target identifier.

No production access or writes, publication, resets, account bootstrap,
credential transfer, V1 data transfer, or rerun of initial migrations.
No changes to other feature owners' source. Post-merge and startup must continue
to avoid automatic SQL application.

## Read-only inspection

At inspection on 2026-11-19:

| Item | Observed |
| --- | --- |
| V2 tables | 21 |
| Existing functions | 49 |
| Constraints | 127 |
| Indexes | 41 |
| Non-internal triggers | 7 |
| Staff accounts / disabled accounts | 1 / 0 |
| Staff sessions / role assignments | 2 / 1 |
| Application roles | manager, operator, qc-manager, warehouse |
| Runs / products / master records | 0 / 0 / 0 |
| Warehouses / balances / inventory movements | 0 / 0 / 0 |
| Opening counts / setup imports / consumption records | 0 / 0 / 0 |

No usernames, password hashes, session hashes, credentials, or connection
strings were extracted. Roles and capability mappings already match the
reviewed staff-role source; no staff-role data migration is needed.

The inspection connection is `postgres`, with superuser, create-role,
create-database, and bypass-RLS privileges. All existing V2 tables are owned
by `postgres`. Schema usage and function execution ACLs are owner-only.
There is no observed `v2_runtime`, `v2_owner`, or `neondb_owner` role in this
isolated database. Do not transfer ownership to a new application role or
alter the provider's `postgres` role.

The existing functions' definition fingerprints, all constraint definitions,
indexes, and triggers exactly match a fresh disposable PostgreSQL installation
of source migrations 0001–0006 plus the already-applied staff-role equivalents.
This supports applying only the missing catalog and rule changes, not replaying
the initial schema.

## Proposed approaches

1. **Recommended:** add only the missing catalogs and rule enforcement;
   prepare an explicitly granted non-login runtime access role and a separate
   restricted-login credential handoff. Preserve all existing rows and owners.
2. Add only the missing schema, leaving elevated runtime access unchanged.
   This enables restored functionality but does not reduce runtime privileges.
3. Leave the database unchanged. Restored catalog operations remain unavailable.

## Exact proposed schema changes

Use only these existing, rehearsed source files, with the guarded, single
transaction built by `v2/db/development-activation.mjs`:

- `v2/db/0007-approved-setup-catalogs.sql`
  SHA-256 `163829a4906746dc18879aa41156cc04adacaccc17a33ca698554979860dab9d`
- `v2/db/0008-production-rule-enforcement.sql`
  SHA-256 `d248bb1d6c9b4a781d001f0720376bce827b78c3f8f3f8a03a59eb86334cc5a2`

The wrapper verifies the source hashes and removes only their outer transaction
delimiters. It checks the target name and role absence, locks the 21 existing
tables with a 3-second lock timeout, validates the inspected schema fingerprint
(`8563f4c4b177a2c0a864491f9d5ed5db`), and compares existing row contents before
and after. It has a 30-second statement timeout. If the source fingerprints or
managed schema change, stop and obtain revised approval. The builder emits
SQL only; it cannot connect to any database.

Add these 11 empty tables and their source-defined constraints and indexes:

- `setup_catalog_imports`
- `setup_ingredient_records`
- `setup_mix_records`
- `setup_mix_component_links`
- `setup_die_type_records`
- `setup_die_default_records`
- `setup_production_rule_records`
- `setup_freezer_pull_records`
- `setup_run_template_records`
- `setup_manager_list_records`
- `setup_alias_records`

Add the seven catalog functions: `setup_catalog_table_name`,
`setup_catalog_object_size`, `stage_setup_catalog_import`,
`apply_setup_catalog_import`, `undo_setup_catalog_import`,
`list_setup_catalog_imports`, and `get_setup_catalog_import`.

Add `production_rule_value`, `assess_production_rules`, and
`guard_production_rules`. Rename the existing `run_snapshot(uuid,uuid)` to
`run_snapshot_without_rules`, retaining its implementation, and add the new
`run_snapshot(uuid,uuid)` wrapper.

Add `production_rules_before_prepare` and `production_rules_before_start`
triggers on `v2.runs`. Strict imported rules will block preparation/start;
flexible rules will appear in assessments. Existing records are not rewritten.
With no imported rules, assessments are empty.

Retain the source's PUBLIC privilege revocations, including table access
revocations scoped to `v2`. Do not rewrite accounts, sessions, role assignments,
balances, run snapshots, or existing audit records.

Expected schema after application: **32 tables, 60 functions, 9 triggers**.

## Least-privilege runtime proposal

Prepare a new `v2_runtime_access` role with NOLOGIN, NOSUPERUSER, NOCREATEDB,
NOCREATEROLE, NOREPLICATION, and NOBYPASSRLS. Grant schema USAGE and EXECUTE on
an explicit allowlist of functions called by the current API and worker,
not ALL FUNCTIONS or any direct table privileges. Do not grant internal
helpers, triggers, raw consumption writers, or first-manager bootstrap.
Existing manager/staff application authorization remains mandatory.

The exact 44 function signatures are in `v2/db/development-runtime-access.sql`
(SHA-256 `14f2febdbbc7af08a23e728db89d02c5b3e619527fa62f4f58d8d3c4aec387b0`).
The transaction checks the effective grants and rejects direct application
table access, including outside V2. The role is currently absent. A
conflicting role is a stop condition, not permission to alter it.

Use a separately provisioned restricted LOGIN role, with membership only in
this access role, and supply its connection string through the secure Secrets
flow as `V2_DATABASE_URL`. Do not reuse, print, construct in logs, or commit
the elevated connection credentials. A SET ROLE on a superuser connection
is not a least-privilege credential boundary.

Credential provisioning and switching the running API/worker require a
separate explicit handoff. A non-login role alone does not make the currently
elevated runtime restricted. Verify the actual connected identity and negative
table/schema/role-creation checks after a switch.

## Rehearsal evidence

A disposable PostgreSQL 16 cluster was initialized from source 0001–0006 and
staff-role equivalents. Only that local disposable cluster received synthetic
accounts or operational data.

Before applying the missing files, six populated tables were fingerprinted:
staff accounts, sessions, products, warehouses, balances, and runs. The
synthetic records included fixed UUIDs and a balance of `12.345678` at revision
7. After applying both missing files, every fingerprint matched exactly.

Run `node v2/db/development-activation.rehearsal.mjs` to repeat the focused
rehearsal. The final atomic transaction passed on a populated disposable
cluster. A baseline mismatch, an injected failure after DDL/grants, and a
second application were all rejected without a partial change. The catalog
and production-rule SQL checks passed.

A separate disposable login (not the owner with `SET ROLE`) inherited the
44 grants and was denied direct staff and inventory reads, V2 DDL, role
creation, first-manager bootstrap, and internal snapshot execution. It could
claim and release the worker lease. Real HTTP requests through the API used a
pre-migration session to read the existing run and `12.345678` balance, and to
stage, apply, and list a synthetic catalog import. This is not managed API
evidence, a browser acceptance pass, or permission to write to development.

## Recovery prerequisite and procedure

Before any managed write, identify the checkpoint immediately before the
change and confirm that it includes a development-database snapshot.
Checkpoint database snapshots are best-effort; do not claim that one exists
without confirmation. A code checkpoint or Git commit alone does not back up
rows. Do not create backup tables, another schema, a managed database copy,
or a dump job.

During application, any guard, DDL, permission, or preservation-check failure
must roll back the entire transaction. Capture before/after equality checks
inside the same transaction without exposing sensitive values. Stop concurrent
operational activity for an agreed maintenance window; worker lease changes
need separate treatment from immutable business-record preservation.

If an issue appears after commit, stop V2 writes, retain the failure evidence,
and use the confirmed pre-change checkpoint with its Database rollback option.
This restores the entire development database to that moment and can discard
later valid writes. It does not affect production. Do not automatically drop
the new tables or rerun initial migrations as a recovery shortcut.

## Verification and completion gates

1. Obtain final approval for the exact development target, schema change list,
   and restricted access group, plus confirmation of the database-bearing
   checkpoint and maintenance window.
2. Reconfirm the baseline and apply only the approved transaction in one
   development-only database call. Compare existing IDs, account
   state, sessions, balances, runs, imports, and audit data without logging
   secrets or copying records into managed backup tables.
3. Verify representative catalog, run, and inventory HTTP/API operations.
   Keep synthetic mutation journeys on disposable PostgreSQL; managed smoke
   writes need explicit approval and must not leave synthetic business data.
4. Record runtime privilege status honestly and retain the approved scope,
   source hashes, preservation results, API evidence, and recovery reference.

The separately owned feature implementations and cross-domain browser/update
acceptance remain outside this activation task.

Functions, triggers, roles, and grants are not automatically copied by Replit
Publish. Production needs its own separately approved manual provisioning
decision. This document does not authorize or provide a production migration.

## Managed development result

- The owner authorized the exact transaction and confirmed a quiet
  development window and the database-bearing November 18, 2026, 7:02 p.m.
  (workspace local time) checkpoint as the recovery point.
- A new preflight confirmed `heliumdb`, 21 existing V2 tables, the reviewed
  schema fingerprint, and no conflicting access role. The V2 worker was
  connected to this database as `postgres`.
- The development-only transaction committed all changes together. Its
  preservation guard matched the full contents of all 21 existing tables
  before and after, including IDs and session rows. Post-commit checks found
  32 V2 tables, 60 functions, nine triggers, and exactly 44 executable
  functions for `v2_runtime_access`. The database still had one staff account,
  two sessions, one assignment, no runs, and no inventory balances. Bootstrap
  remained closed.
- Read-only SQL entry points succeeded under the access group. Four HTTP
  reads also returned 200 and the expected empty lists: catalog import
  history, runs, warehouses, and inventory products. These HTTP checks used
  the application handlers on a loopback-only temporary listener and a
  read-only transaction as `v2_runtime_access`, with a test-injected manager
  principal. They verify the managed API read paths, not a deployed login
  or a credential switch. The disposable rehearsal exercised the actual
  session, catalog writes, retained stock, and worker permissions.
- No production database changes, test records in managed development,
  account bootstrap, resets, or publication were made. No schema SQL runs
  automatically from startup or post-merge.
