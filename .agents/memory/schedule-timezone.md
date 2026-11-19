---
name: Production schedule timezone
description: Owner-selected timezone for schedule dates, imported day blocks, and timeline estimates.
---

V2 production schedule dates and wall-clock times use `America/Chicago`, including daylight-saving transitions. They do not follow each viewer's browser timezone.

**Why:** The project owner chose Central time as the production schedule basis.

**How to apply:** Use this timezone consistently for schedule date defaults, workbook day blocks, day scoping, timeline estimates, and date-bound browser tests. Keep unknown duration or missing inputs explicit rather than inventing an end time.
