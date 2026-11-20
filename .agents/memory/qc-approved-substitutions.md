---
name: QC-approved substitutions
description: Owner-confirmed coordination boundary for same-day ingredient substitutions in V2.
---

The owner requires same-day ingredient substitutions to be approved by QC, with the inventory update happening automatically at that approval. Substitutions can replace all or part of an ingredient, and one replacement may cover multiple planned ingredients. A QC-only record is not sufficient, and the inventory side must not silently ignore an approved replacement.

**Why:** The owner confirmed that QC authorization and accurate stock accounting are one combined outcome; either side alone leaves the run record or inventory balance misleading. The owner chose approval-time posting rather than waiting until run completion. They gave the example of one 40 lb Monterey replacement covering 5 lb Monterey and 20 lb mozzarella to clarify that partial and multi-source substitutions must remain possible.

**How to apply:** Keep one canonical substitution record connected to the run and inventory identities. Record every source product and exact source quantity/unit plus the exact replacement quantity/unit. Post the replacement amount atomically when QC approves, and ensure run completion subtracts only the replaced source amounts and never deducts the replacement twice. Preserve the authenticated approver, audit history, and completed-run snapshot; never guess a conversion.
