# Capability catalog guide

The canonical inventory is [`catalog.json`](catalog.json). The generated
[`summary.md`](summary.md) is a readable view; edit the JSON, then regenerate the
summary with:

```sh
pnpm run generate:capability-catalog
pnpm run check:capability-catalog
```

The catalog is portable: its identifiers do not depend on project task numbers.
Its local evidence paths are repository-relative and must be carried with the
catalog when they are needed. A missing path is a validation failure, not a
reason to invent a replacement source.

## What the states mean

Each record keeps three separate decisions:

- **Decision state** records authority: `approved`, `candidate`, `deferred`,
  `out-of-scope`, or `retired`.
- **Release scope** records where it is intended: `current`, `future`, or
  `none`.
- **Implementation status** records delivery: `not-started`, `in-progress`,
  `implemented`, or `blocked`.

Do not use implementation status as evidence of approval. An old proposal can
remain a candidate even if code or a compiled artifact exists. A delivered
historical V1 behavior does not automatically become an approved V2 or V3
requirement.

`sourceEvidence` says what a surviving source supports. `approvedBehavior`
contains only explicit approved behavior. `unresolvedOwnerDecisions` lists
choices that still belong to the owner or a qualified policy owner. Keep these
lists separate. A candidate enters as a candidate with its question and
evidence; change it to approved only after recording the explicit decision and
its source.

Every implementation acceptance check describes an observable user outcome.
`verificationEvidence` links a check to a local source and records one outcome:
`PASS`, `FAIL`, `BLOCKED`, or `NOT RUN`. A test or document reference records
what was observed; it does **not** make this checker a judge of evidence quality,
policy adequacy, completeness, or release readiness.

## Add, approve, defer, exclude, or retire

1. Add a record with a new stable `CAP-...` ID. Prefer a user workflow, not a
   task, code file, or milestone, as the identity.
2. Add the evidence reference and cite only surviving documents, source,
   tests, or an explicit owner decision. If source coverage is incomplete, say
   so in the record.
3. Enter new ideas as `candidate`, with `releaseScope: "none"`. Candidates and
   unfinished work may have no test evidence.
4. When an owner explicitly approves scope, set the decision and release scope,
   record the approved behavior, and add observable acceptance checks. A
   current-release approved record always needs acceptance checks, even before
   implementation begins.
5. Use `deferred` for a known idea postponed pending a condition or decision;
   use `out-of-scope` for an explicit exclusion. Neither state is a synonym for
   “not implemented.”
6. Use `retired` rather than deleting an accepted or previously implemented
   capability. Explain the decision in its evidence/rationale.
7. Add dependencies by capability ID. Keep verification outcomes tied to
   individual acceptance-check IDs; do not mark a broader feature `PASS` from
   a narrower test.
8. Regenerate and validate. Review the generated summary and the source claim
   before merging.

## Evidence and privacy limits

The original V1 production database was removed. This catalog does not recover
or represent V1 production records, customer data, credentials, sessions, or
runtime behavior. The archived V1 application in this workspace includes
compiled bundles; those are labeled as build artifacts, not editable source or
proof of deployed behavior. The V1 research package also excludes broad
customer-source inventories and raw operational captures. This is a bounded
inventory rather than proof that every historical feature was found. Preserve
these limits when copying the catalog to another project.

## Reusable work template

Start new capability work from
[`../../.local/tasks/templates/feature-task.md`](../../.local/tasks/templates/feature-task.md).
It asks for stable capability IDs, observable outcomes, source/decision
references, acceptance checks, dependencies, and verification evidence.

## Validation boundary

The dependency-free checker catches malformed structure, duplicate or invalid
IDs, invalid states/outcomes, missing required fields, unresolved capability
dependencies, broken local paths, missing implemented evidence, and a stale
generated summary. It permits candidates and unfinished work without test
evidence. A passing check does not approve scope, certify a test, or authorize
release.
