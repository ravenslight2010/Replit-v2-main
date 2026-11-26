# V1 importer knowledge transfer into V3 agents

## Status

Design approved by the project owner on 2026-11-26. This document still needs
the owner's review before implementation begins.

## Goal

Make V1's mature workbook-import behavior understandable and reusable by future
agents working on Production Assistant V3, while keeping V3's approved
deterministic import architecture and safety boundaries authoritative.

## Sources and authority

- V3 destination: `ravenslight2010/Production-assistant-v3`, reviewed at
  `9be05192074328f60416d92947d9a12d72d6cb2e` on `main`.
- V3 source index pins V1 at
  `ravenslight2010/Production-run-calculator@8769908bc25f5ed05943d1a2e50f34dee108b91a`
  and Replit V2 at
  `ravenslight2010/Replit-v2-main@7413225e5577a952570f37c207e6c940166c8e61`.
- V3's approved deterministic import design is
  `research/decisions/import-completion-design.md`.
- Current workspace importer history is in `.agents/memory/` and
  `.agents/skills/`; those lessons are historical V1 evidence, not permission
  to restore V1 runtime behavior or supersede V3 decisions.

Use this authority order: explicit V3 owner decisions, current V3 source and
tests, pinned source evidence, then historical V1 importer lessons. Label
uncorroborated or V1-only behavior as historical.

## Options considered

1. Copy all V1 importer memory verbatim. This retains volume but leaves stale
   V1 paths, implementation assumptions, and duplicated instructions.
2. Create a curated, source-pinned importer guide and V3-specific change skill,
   with a test map that points to executable tests in their real locations.
   **Selected:** useful to future V3 agents without presenting V1 paths or
   tests as live V3 behavior.

## Proposed changes

### V3 repository

- Expand `agents/AGENTS.md` with the importer authority order, safety boundary,
  and links to the new importer guide, skill, and test map.
- Add `agents/memory/v1-importer-lessons.md`. Cover the mature V1 workflow and
  pitfalls: source-family differences and units, spec-first identity, workbook
  order, product/recipe links, conservative matching and aliases, repeated
  imports and cached parses, incomplete/unresolved rows, review-before-apply,
  source provenance, and preserving manager-owned values.
- Add `agents/skills/work-on-importers.md`. Route import changes through
  V3's deterministic, no-AI policy; stage/review/apply and retry rules; private
  corpus handling; and the smallest relevant unit, database, and browser tests.
- Add `agents/memory/importer-test-map.md` mapping V3 parser modules to their
  colocated tests, schedule/setup browser journeys, and the private-corpus
  qualification boundary.
- Extend `agents/scripts/agent-docs.test.mjs` so the importer docs stay linked,
  test paths exist, and private corpus/credentials are not copied into docs.
- Preserve all existing V3 files. Keep executable parser and application tests
  in `core/`, `server/`, `db/`, and `e2e/`; do not duplicate them under `agents/`.

### Current workspace

- Add a concise `.agents/memory/v3-importer-transfer.md` recording the V3 source
  pin, the V3 guidance location, and the rule to check current V3 source/tests
  before applying historical V1 lessons.
- Add `.agents/skills/v3-importer-transfer/SKILL.md` directing future agents to
  the V3 importer guide and to preserve V3's no-AI and private-data boundaries.
- Keep the detailed V1 importer notes already in this workspace intact.

### Repository delivery

Create a review branch and pull request in the V3 repository. Do not write
directly to V3 `main`. Leave the current workspace edits unpushed unless the
owner asks to publish them.

## Importer knowledge to preserve

- V1 spec imports are not interchangeable with deterministic dough, sauce,
  cheese, premix, shipping, or schedule workbooks. Their parse, unit, identity,
  and apply rules differ.
- Keep actual source units and provenance. In particular, cheese/sauce/dough
  batch quantities and premix per-pizza quantities must not be conflated;
  missing dough yield is unknown, not a value to derive.
- Distinguishing product-line qualifiers, size digits, station slots, and
  recipe families matter. Exact unique identities may link automatically;
  uncertain or ambiguous matches remain reviewable instead of being guessed.
- Re-importing must be idempotent and version-aware. A changed source invalidates
  value review; absent rows do not mean delete; failures must not silently drop
  rows, create zero-value recipe stubs, or overwrite unrelated manager edits.
- Source-specific import lessons are summarized from the current workspace's
  importer memory and should be linked from the V3 guide rather than copied as
  unreviewed runtime instructions.

## Verification

1. Run the V3 agent documentation checker and its tests.
2. Run the V3 parser unit tests for CSV, source workbooks, schedule workbooks,
   capacity workbooks, and private-corpus handling.
3. Run relevant V3 setup/schedule browser tests if agent-doc changes require
   them; otherwise record them as mapped but not rerun.
4. Run local workspace checks for the new `.agents` skill and memory references.
5. Review the branch diff to ensure it contains no private workbooks, private
   parser expectations, credentials, or production records.

## Acceptance criteria

- A new V3 agent can find the importer guidance from `agents/AGENTS.md`.
- The guide distinguishes historical V1 evidence from current V3 rules.
- Every V3 import-family test path listed in the guide exists.
- V3's approved no-AI, deterministic review/apply architecture remains intact.
- No private workbook or production data is copied.
- V3 changes are available as a review PR; no direct commit is made to V3 `main`.
