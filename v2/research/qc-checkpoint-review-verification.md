# V2 QC checkpoint and review extension

## Scope comparison

The first-release QC foundation already covered Brix, lots, weights, cleaning,
date-code observations, allergen/component reviews, corrections, redactions, and
run/facility history through one facility-scoped append-only event ledger.
This extension adds only the remaining general checkpoint and review outcomes:

- temperature and elapsed-time observations linked to a run and a station in its
  saved setup;
- corrective-action observations linked to an existing checkpoint or review
  flag;
- advisory run flags and lot flags linked to an existing, non-redacted lot
  record; and
- an attributed manager review event, restricted to `manage-qc`.

Corrections append evidence; they do not rewrite the original observation.
Events retain server actor and timestamp attribution and use the existing
idempotent write command. QC history stays in the existing append-only ledger;
no V1 history transfer or new reset/purge behavior was added.

## Source and policy boundary

`v2/research/NEXT-PHASE-HANDOFF.md` referenced `docs/qc-department-plan.md`,
`.agents/memory/qc-allergen-phase1-decisions.md`, and
`.agents/memory/qc-brix-targets.md`; those files are not present in this
checkout. The current V2 handoff and existing QC code were used to identify the
implemented foundation. No historical safety limit or criterion was inferred.

Temperature/time fields accept an explicit reading and unit, but the system
does not convert readings, compare them to a target, or produce pass/fail
results. A checkpoint is stored as `not_evaluated`. Review flags mean “needs
review” only; they do not hold or release production/shipping and do not imply
certification. A qualified facility/QC owner must approve the source, units,
limits, and policy before any criterion can be evaluated.

## Verification ledger

| Status | Check | Evidence |
| --- | --- | --- |
| PASS | V2 unit/server tests | `pnpm --filter @workspace/lucia-v2 test` — 222 passed. QC coverage includes active/completed run observations, invalid inputs, linked references, and manager-only review. |
| PASS | Full disposable PostgreSQL suite | `bash v2/db/run-local-tests.sh` passed, including the new `0011` SQL checks, restricted API role, append-only history, denied roles, and the existing V2 database suites. |
| PASS | Authenticated Chromium QC flow | Real manager sign-in against the disposable API; created a run, recorded a station-linked observation, appended a correction, raised and reviewed a run flag, then reloaded and confirmed history persisted. |
| PASS | Chromium manager/operator UI | Synthetic role fixture verified visible manager review actions are absent to operators. Lot and run flags, corrections, and browser history were exercised at 402×874, 768×1024, 1024×768, and 1280×900. |
| PASS | WebKit QC UI | The synthetic QC journey passed with the Nix Playwright WebKit runtime at 402×874, 768×1024, 1024×768, and 1280×900. |
| PASS | API contract and source validation | `v2/api/openapi.yaml` parsed with unique-key checking; new QC request schemas are present. JavaScript syntax checks passed. |
| BLOCKED | Password-recovery WebKit lane in the broader suite | The broader integration runner reports missing compatible native WebKit libraries. The focused QC WebKit lane passed through the Nix Playwright runtime; this does not represent physical Safari hardware testing. |
| MISSING | Physical iOS/Android devices | Not available in this environment; viewport emulation is not treated as hardware evidence. |
| MISSING | Approved evaluation policy | No qualified-owner source, unit policy, limits, or evaluation policy was supplied. Checkpoints therefore remain observation-only. |

## Retention and confidentiality

The extension adds event types to the existing QC ledger and does not add another
data store. The ledger is documented as outside reset/purge paths and its
append-only safeguards remain in force. Run/lot references are facility- and
run-bounded; unavailable and redacted references cannot be used as targets.
User-entered observation text is displayed in QC history, while existing
manager-only export and history controls remain unchanged.
