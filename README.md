# Lucia's Production Assistant (V2)

Web/PWA-first production operations for one pizza-production facility, with
support for multiple inventory warehouses. V2 is the active application in this
repository; the retained V1 code and research are historical references, not the
current runtime.

## What V2 does

- Coordinates shared production runs across devices. The server owns run state,
  station progress, and automatic timers.
- Provides station workflows for Line, Dough, Cheese, Pepperoni, Sauce,
  Frontline, and Packaging.
- Supports production scheduling and planning, manager-reviewed setup imports,
  warehouse inventory, and QC observations.
- Keeps a cached, read-only view available while disconnected; writes resume
  after reconnecting and refreshing canonical server state.

V2 is not a copy of V1's production database. Do not assume V1 run history,
inventory balances, credentials, or sessions are present in V2. See the
[V1-to-V2 data-transfer record](v2/CUTOVER-DATA-TRANSFER.md) for the approved
data boundaries.

## Start and verify V2

In Replit, start the **V2 Production Assistant** workflow for the normal
development preview. For a disposable, synthetic-data browser session, use
**V2 Agent Test Preview** instead. The test preview uses a temporary database;
its data is discarded when the workflow stops. See the
[Replit runbook](replit.md) before using either workflow.

From the repository root, the focused V2 checks are:

```sh
pnpm install
pnpm run build:v2
pnpm run test:v2
pnpm --filter @workspace/lucia-v2 run test:browser
pnpm --filter @workspace/lucia-v2 run test:db
pnpm --filter @workspace/lucia-v2 run test:agent-preview
```

The database and agent-preview checks create disposable test environments.
Never point them at production or a shared operational database.

## Repository map

| Path | Purpose |
| --- | --- |
| `v2/` | Active V2 application, server, worker, browser client, database SQL, and tests |
| `v2/README.md` | Detailed V2 architecture, setup, data-safety, and validation guide |
| `v2/HANDOFF.md` | V2 scope and implementation handoff |
| `v2/CUTOVER-DATA-TRANSFER.md` | Approved V1-to-V2 transfer boundaries and source evidence |
| `scripts/start-v2.sh` | V2 Replit launcher |
| `replit.md` | Replit workflows, test preview, and agent operating guidance |
| `artifacts/`, `lib/` | Retained V1 code and shared libraries for historical reference |
| `_archived/v1/` | Archived V1 source snapshot |
| `docs/capabilities/` | Cross-version capability catalog and its evidence rules |

V2 uses a Node.js API and station worker, PostgreSQL, and a browser PWA. Its
database objects are kept in the isolated `v2` schema; V2 must not connect to
V1 schemas or sessions.

## Project decisions

- One production facility; warehouses represent separate inventory locations
  within that facility.
- Web/PWA first. A native mobile app is not the active V2 application.
- Production data and timers are server-owned; disconnected clients are
  read-only until they reconnect.
- QC records observations and evidence. It does not invent pass/fail limits or
  product-hold policy that has not been approved.

Additional implementation notes and recorded checks are in the
[V2 handoff](v2/HANDOFF.md) and the
[V2 validation record](v2/research/validation.md). Treat dated status notes as
snapshots and verify them against the current workflows before making
operational decisions.
