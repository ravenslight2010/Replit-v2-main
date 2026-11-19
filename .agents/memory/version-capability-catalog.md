---
name: Version capability catalog
description: Owner's durable requirement for preserving feature scope across future major versions.
---

Future major versions should begin from a portable inventory of known V1/V2
capabilities and future candidates, not by re-discovering scope from task
conversations. Stable capability identities and evidence references should
survive project/task changes; candidates are not requirements until the owner
approves them.

**Why:** The V2 rebuild showed that feature scope spread across old code,
research, tasks, and tests is easy to omit or misclassify.

**How to apply:** At the start of a future major version, carry forward the
approved capability catalog and review required, delivered, deferred, blocked,
and candidate items before implementation. Do not use task numbers as durable
feature identity.
