---
name: V2 product boundaries
description: Owner-confirmed product scope and isolation decisions that source code cannot establish.
---

V2 is an upgraded successor, not a simplified replacement. Small implementation
slices do not retire V1 capabilities. The agreed scope includes run control,
every station, imports, full inventory, shared sync and auto-tracking; scheduling,
manager tools, operational history, QC and allergens follow the staged plans.

There is one production facility and more than one warehouse. Warehouses are
inventory locations, not separate production facilities.

Multiple devices must work on one run. Timers/progress remain server-owned.
Disconnected clients are read-only until they reconnect. Web/PWA comes first.

The owner approved using this workspace and an isolated `v2` database schema,
not a separate-project prerequisite. Schema isolation is not physical database
isolation. Elevated database access was accepted only for a private synthetic
pilot, not public production use.

Rebuild username/password sign-in with fresh V2 sessions. Do not reuse V1
sessions or transfer credentials without a separate decision. Inventory starts
from a fresh physical count, not historical V1 balances.

The original V1 production database was removed. Code repositories and source
archives must not be presented as recovered database records; V2 work should
not wait for a source export from that unavailable database.

**Why:** These are explicit owner decisions following V1 reliability failures.
The owner rejected a reduced-capability replacement and unnecessary separate
project barriers.

**How to apply:** Preserve these boundaries when recovering source, planning
features or reviewing cutover. Restored SQL is source only until separately
approved for the target database. Do not claim publication or physical-device
acceptance from local tests.
