---
name: V2 manager browser fixture order
description: Database setup required before authenticated manager browser journeys.
---

The authenticated V2 manager screen requests QC run history whenever its selected run changes and may load manager-operation summaries. A cross-domain browser journey therefore needs the relevant feature schemas and API-role function grants installed before it opens the manager UI, even when the scenario is about inventory or run progress.

**Why:** Running the browser lane against a partially migrated disposable database produced endpoint errors and obscured otherwise successful manager actions.

**How to apply:** Run manager-facing browser integrations only after all endpoint schemas and test API role grants they rely on are in place. Keep this setup disposable and do not hide unexpected API failures in browser assertions.
