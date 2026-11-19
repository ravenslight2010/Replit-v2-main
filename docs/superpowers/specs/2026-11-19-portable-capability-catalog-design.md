# Portable Capability Catalog for Future V3

## Problem and goal

V1 and V2 capabilities, owner decisions, implementation status, and test evidence
are spread across archived source, research documents, handoffs, task plans, and
tests. When V2 changes or a future V3 begins, that makes it easy to omit a
required workflow or mistake an old plan, unverified behavior, or future idea
for an approved requirement.

Create one portable, evidence-backed capability catalog and a lightweight
process/check that makes feature scope reusable across future versions. The
catalog covers every known V1/V2 capability and has a clear path for recording
new ideas.

## Agreed design

### 1. Portable, structured source of truth

- Keep the catalog outside `v2/`, so a future version can bring it forward
  without treating it as V2 implementation detail.
- Use a canonical, version-controlled structured file with stable capability
  IDs. Provide a generated, human-readable summary and a short guide; do not
  maintain a second hand-edited copy of the catalog.
- A capability record contains:
  - Stable ID, name, category, and short user-facing purpose.
  - The user workflow and roles it serves.
  - Owner decision state (approved, candidate, deferred, explicitly out of
    scope, or retired), release scope (current release, future release, or
    none), and implementation state (not started, in progress, implemented, or
    blocked).
  - Source evidence references, including relevant surviving V1/V2 code,
    documents, prior decisions, task plans, and tests.
  - Approved behavior and unresolved owner decisions, kept distinct from
    historical evidence and unapproved ideas.
  - Dependencies, observable acceptance checks, and verification evidence.
- New capabilities enter as candidates. They become requirements only after
  explicit owner approval. Retirement or exclusion is recorded rather than
  silently deleting a capability.
- Project task numbers are not capability identity. Work plans refer to stable
  capability IDs and repository paths so they remain useful when task records
  or projects change.

### 2. Bounded completeness check

- Add a small, dependency-free check and test coverage for the catalog tooling.
- The check validates the catalog format, unique IDs, allowed states, required
  fields, and referenced local paths. It validates the generated summary
  against the canonical file so the view cannot silently drift.
- Approved/release-scoped records must have observable acceptance checks.
  Implemented records must link evidence to those checks and state each outcome
  as `PASS`, `FAIL`, `BLOCKED`, or `NOT RUN`. Candidate and unfinished records
  may lack test evidence; unfinished release-scoped records still need defined
  acceptance checks.
- The check blocks malformed or broken records; it does not claim to determine
  whether evidence proves the behavior or certify a release. Evidence quality
  and release approval remain human review responsibilities.
- Wire the check into the repository's existing validation path. Do not create
  a new release suite or make a future candidate block ordinary development.

### 3. Repeatable feature intake and V3 handoff

- Add a reusable feature-task template requiring capability IDs, user-visible
  outcomes, source/decision references, acceptance checks, dependencies, and
  verification evidence.
- Seed the catalog by reconciling the surviving archived V1 source, V1-to-V2
  research, approved decisions, V2 handoffs, task plans, and tests. Merge
  duplicate descriptions of the same capability and preserve materially
  different workflows as separate entries.
- Label uncertain or historical-only claims as unverified or needing a decision;
  do not convert them into approved requirements.
- Include a V3-start checklist: review required and delivered capabilities,
  identify gaps and unresolved decisions, select the target release scope, and
  carry the catalog and its validation command into the new project before
  feature implementation begins.

## Important data and evidence boundary

The original V1 production database was removed. This catalog can preserve
knowledge evidenced by surviving code, documents, tests, and explicit owner
decisions only. It must not imply that lost production records, customer data,
or runtime behavior have been recovered. Production data and credentials are
not inputs to this work.

## Alternatives considered

1. **Manual catalog and task template only** — simple to start, but broken links
   and incomplete records can accumulate unnoticed.
2. **Generate the catalog from project tasks and tests** — less duplicated
   status, but current task/test metadata does not consistently identify
   capabilities, and task-system records are not portable to a new project.
3. **Portable catalog plus structural checks (selected)** — preserves a
   stable, reviewable scope record while automatically catching basic omissions
   and broken references. It does not automate product judgment or claim that
   listed tests are sufficient.

## Success criteria

- A reviewer can identify the approved, deferred, implemented, blocked, and
  candidate capabilities without reading every task conversation.
- Every catalog entry is traceable to surviving evidence or explicitly marked
  as a new candidate/owner decision.
- A new feature task can reference the relevant stable IDs and acceptance
  checks using the reusable template.
- The catalog checker detects duplicate IDs, malformed records, missing
  required acceptance/evidence fields, and broken local references, while
  allowing incomplete future candidates and unfinished implementation.
- A future V3 can copy the catalog, guide, template, and check without
  depending on V2 application code or task numbers.

## Out of scope

- Implementing or changing production features in V1 or V2.
- Reconstructing the removed V1 production database or claiming recovery of
  runtime/customer records.
- Automatically deciding product scope, safety policy, or whether evidence is
  sufficient.
- Building a general product-management platform or creating one project task
  per catalog entry.
