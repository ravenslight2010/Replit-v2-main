---
name: V2 inventory preparation
description: V2 prepared stock calculations use the saved linked mix formula and explicit stock mappings.
---

V2 preparation quantities come from the saved, explicitly linked mix formula—not an independent manually entered ratio. Raw ingredients and prepared outputs remain distinct stock products, connected through reviewed product and stock-unit mappings. Make-day plans use only the explicit V2 `daysEarly` policy; never import a V1 safety-buffer assumption.

**Why:** On 2026-11-19, the facility workflow decision chose the linked mix formula as preparation's source of truth while preserving the raw/prepared stock boundary. The make-day window is a V2 setup decision; no legacy buffer is part of that contract.

**How to apply:** For V2 prep workflows, calculate ingredient usage from the linked canonical mix, require explicit product and unit conversions, use only saved `daysEarly` for make-ahead dates, and keep unresolved links visible and blocked.
