---
name: V2 layer-based ingredient demand
description: Owner-confirmed V2 station scope for frozen cases-per-layer calculations.
---

Use the run's frozen cases-per-layer value for ingredient demand at Sauce,
Cheese, Frontline, and Pepperoni. Do not add the layer to the planned run target
or its case-progress metrics. Keep existing station allowances, and never infer
Pepperoni stick or batch values from the layer.

**Why:** The owner confirmed that V1's layer-inclusive pizza basis should apply
to all four V2 ingredient stations, not Sauce alone.

**How to apply:** Read layer counts only from the run setup snapshot. If a
positive frozen value is absent, calculate from planned cases only. Keep worked
examples explicit when their layer value is illustrative rather than
source-backed.
