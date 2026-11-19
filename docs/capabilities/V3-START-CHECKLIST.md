# V3 start checklist

Carry this catalog forward before implementing V3 features. This checklist is
for scope review, not a release checklist.

## Transfer and verify

- [ ] Copy `docs/capabilities/catalog.json`, `README.md`, and generated
  `summary.md` outside any version-specific implementation directory.
- [ ] Copy the feature-task template and dependency-free checker/test files.
- [ ] Carry or deliberately replace every referenced evidence document; update
  reference paths without changing capability IDs.
- [ ] Run `pnpm run check:capability-catalog` and its contract tests in the new
  project before feature work begins.
- [ ] Confirm that the catalog still states the V1 evidence boundary: no claim
  that the removed production database, customer records, credentials, or
  runtime behavior have been recovered.

## Select V3 scope

- [ ] Review approved capabilities and their current/future release scope with
  the owner.
- [ ] Compare delivered, in-progress, blocked, and not-started capabilities with
  the evidence that survives; do not infer delivery from task status alone.
- [ ] Review candidates, deferred items, explicit exclusions, and retirements
  separately. Candidates become requirements only after explicit owner
  approval.
- [ ] Resolve or assign every owner/policy decision that affects the chosen
  release. Preserve decisions that remain open rather than filling them in.
- [ ] Choose V3 release scope explicitly; `current` in an earlier version does
  not automatically mean current in V3.

## Review gaps and dependencies

- [ ] Identify missing evidence and label it `NOT RUN`, `BLOCKED`, or
  `incomplete` as appropriate; do not overstate historical test or browser
  results.
- [ ] Check capability dependencies and acceptance checks for every selected
  capability.
- [ ] Record newly discovered workflows as candidates with sources and
  unresolved decisions. Preserve distinct workflows rather than hiding them
  under a broad umbrella.
- [ ] Create feature tasks from the reusable template and use capability IDs,
  not task numbers, as durable scope links.
- [ ] Regenerate the summary and run the structural check after catalog changes.

Only after scope, decisions, evidence gaps, dependencies, and validation have
been reviewed should V3 feature implementation begin.
