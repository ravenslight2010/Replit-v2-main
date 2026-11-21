# Transferable Agent Handbook

**Status:** Approved design; updated with the test-preview requirement; awaiting review of this written specification
**Date:** 2026-11-19

## Purpose

Create a durable, project-local handoff that lets a new Replit Agent orient
itself to the production assistant, understand the V1-to-V2 transition and
owner-approved boundaries, and continue work without depending on this chat's
hidden history.

The handbook transfers documented context and working guidance. It cannot
recreate an agent's hidden state or undocumented conversations. It must show
what is known, where it came from, what is merely historical, and what remains
unknown.

## Goals

- Make the V2 project understandable from a short, direct entry point.
- Preserve the important product history, explicit decisions, work preferences,
  and safety boundaries that a new agent cannot infer from code alone.
- Keep feature scope, implementation status, task status, and historical
  evidence distinct.
- Give agents a repeatable way to check freshness and resolve conflicting
  sources.
- Validate transfer with a cold-start review that requires citations or an
  explicit `unknown`.

## Non-goals

- Recreate hidden model memory or copy full chat transcripts.
- Replace the capability catalog, V2 handoff, research package, or specialist
  implementation notes.
- Claim that every V1 behavior has been discovered or that V1 production data
  has been recovered.
- Transfer production records, customer workbook contents, credentials,
  sessions, secrets, or personal information.
- Make code, database, deployment, publication, or V1 archive changes as part of
  the documentation work.
- Turn proposed or deferred capabilities into approved requirements.

## Existing sources and boundaries

The handbook is an index and interpretation layer over existing sources:

- `docs/capabilities/catalog.json` is authoritative for stable capability
  identifiers, recorded decision state, release scope, evidence, and explicit
  approvals. Its guide warns that it is a bounded inventory rather than proof
  that every V1 feature was found.
- `v2/HANDOFF.md` records V2 implementation and validation status. Its dated
  statements must be checked against the current code, tests, and task board.
- `v2/README.md` describes the V2 runtime and safety boundary, but is not proof
  of deployment or production behavior.
- `v2/research/` preserves bounded V1 findings, provenance, gaps, and import
  evidence. Its claims remain tied to the dates, revisions, and environments
  recorded there.
- `docs/recovery/v2-restoration-2026-11-19.md` records recovery provenance and
  validation limits. Recovery is not publication approval.
- `.agents/memory/MEMORY.md` and its topic files contain detailed technical
  gotchas. They are specialist references, not a project onboarding narrative.
- The live project task board is authoritative for current task state. A
  handbook snapshot is only a dated orientation aid.

The current `replit.md` begins with useful V2 instructions but then includes
extensive V1-specific commands, architecture, and user preferences, followed by
a stale generic project-name placeholder. The implementation should make it a
concise V2 entry point. Useful V1 guidance must remain available under a clearly
historical label rather than appearing to be current instructions.

## Proposed handbook structure

Create `docs/agent-transfer/` with these focused documents:

1. **`README.md` — Start here**
   - Explain who the handbook is for and that it transfers documented context,
     not hidden conversation state.
   - Give a short, ordered first-session reading path.
   - State source precedence, freshness rules, evidence labels, and the
     instruction to inspect current code and the live task board before acting.
   - Link to the capability catalog, V2 handoff, V1-to-V2 research, recovery
     report, technical memory, and the safe V2 Agent Test Preview instructions.

2. **`owner-and-project-context.md` — Durable decisions and work guidance**
   - Record only project-relevant decisions and working preferences.
   - Separate `owner-approved`, `observed preference`, and `unresolved` items.
     Observed preferences are explicitly tentative and easy for the owner to
     correct.
   - Include the product identity and the decision that V2 is an upgraded
     successor, not a reduced replacement.
   - Preserve supported working guidance: keep evidence and claims aligned; do
     not silently narrow approved scope; continue independent work when one path
     is blocked; ask before ambiguous or irreversible actions.
   - Exclude private personal context, secrets, credentials, and unsupported
     inferences.

3. **`v1-to-v2-history.md` — Why the project changed**
   - Give a concise, sourced chronology of V1 operational problems, the decision
     to rebuild as V2, the early V2 scope mismatch, and the later capability
     catalog/recovery work.
   - Label user-reported incidents separately from independently verified
     source or test evidence.
   - State explicitly that the V1 wake/sync/auto-track root cause was not
     established merely because V2 was started.
   - Record that V1 production data was removed and cannot be reconstructed
     from Git source or compiled bundles. Link to the existing research and
     recovery records instead of repeating their full evidence.

4. **`v2-boundaries.md` — Product and safety contracts**
   - Summarize only explicit decisions, with links to their canonical sources:
     one production facility and multiple inventory warehouses; responsive
     web/PWA first; multiple devices on one active run; server-owned shared
     state and automatic timers; read-only operation while disconnected; V2
     schema isolation within this workspace rather than a separate physical
     database; and no V1 sessions or operational history.
   - Distinguish approved direction from completed implementation.
   - Preserve the fresh physical opening-count requirement.
   - Flag account/password transfer details if sources do not agree; do not
     infer password-hash authorization from an earlier development-copy
     decision.

5. **`current-state.md` — Dated transfer snapshot**
   - Begin with an explicit `as of` date and state that it is not live status.
   - Capture only the current milestone, important blockers, and next action
     after verifying them against the live task board, `v2/HANDOFF.md`, source,
     and relevant checks.
   - Link to the live task board rather than copying its complete task list.
   - Require refresh at a substantial handoff or version transition; keep older
     snapshots out of the current summary.

6. **`cold-start-review.md` — Transfer acceptance check**
   - Provide a short question set covering product identity, V1-to-V2 rationale,
     capability-scope authority, task-status authority, V2 safety/data
     boundaries, current blocker/next action, and known unknowns.
   - Require each answer to cite a handbook or linked authoritative source, or
     explicitly say `unknown`; unsupported confident answers fail.
   - Record the review date, sources consulted, missed/ambiguous answers, and
     corrections made. Do not store hidden conversation content or personal
     data in the test.

`replit.md` will become a brief current-V2 entry point to this handbook and
current runtime instructions. It will include an immediately usable section for
the **V2 Agent Test Preview**:

1. Stop **V2 Production Assistant** before starting the test preview because
   both web workflows use port 5000.
2. Start the configured **V2 Agent Test Preview** workflow, not the shared
   database workflow, for interactive test changes.
3. Sign in with the clearly labeled synthetic-manager button. Do not copy or
   request credentials.
4. Explain that the preview creates a temporary loopback-only PostgreSQL
   cluster, seeds synthetic records, refuses project/production database
   configuration, and removes the database and its test writes when stopped.
   Preview data does not survive a workflow restart.
5. After testing, stop the preview and restart **V2 Production Assistant** to
   restore the ordinary development preview.
6. Provide the automated browser journey command:
   `pnpm --filter @workspace/lucia-v2 run test:agent-preview`.

Document the preview's pinned-Node, non-root, and development-mode
requirements, as enforced by its launcher. Its V1-specific material will be
retained only where useful, clearly marked historical, and moved or linked into
the historical reference section. Add a prominent pointer to the handbook in
`.agents/memory/MEMORY.md`, preserving that file's technical-topic index role.

## Source precedence and freshness policy

When sources disagree, agents use this order:

1. The user's current instruction and explicit, applicable approval.
2. Current source code, configuration, and tests for what the software actually
   does; a test result applies only to its stated revision and environment.
3. The live project task board for current task ownership and status.
4. The capability catalog for recorded scope decisions and capability evidence,
   not as a substitute for checking current implementation.
5. The V2 handoff and current-state snapshot, after checking their dates and
   confirming material claims against current sources.
6. Dated research, recovery records, archived V1 guidance, and technical memory
   for historical context and implementation cautions.

An older source never overrides a newer explicit owner decision. A newer code
change does not silently change approved product scope. If evidence is
contradictory or missing, preserve the conflict and ask the owner when the
decision affects scope, data, authorization, or production behavior.

## Evidence vocabulary

Use the repository's existing evidence vocabulary when applicable. Every
handbook claim must be attributable to one of:

- `owner-approved`: an explicit owner decision, linked to the durable record
  where available.
- `observed`: directly checked in current code, configuration, or a test.
- `historical`: tied to an older source revision, report, environment, or
  user-reported incident.
- `unresolved`: conflicting, unavailable, or awaiting an owner decision.

Do not present a task state, source file, test, screenshot, or past deployment
as stronger evidence than it supports.

## Maintenance rules

- Update a decision in its canonical source first; then update the handbook
  summary and links.
- Refresh `current-state.md` only after checking the current task board and
  repository evidence. Include an `as of` date and explicit unknowns.
- Keep feature approval and implementation status in the capability catalog;
  keep task status in the task board; do not maintain parallel status tables.
- Keep detailed technical gotchas in `.agents/memory/` topic files. The handbook
  links to them rather than copying implementation recipes.
- When moving V1 instructions out of `replit.md`, preserve provenance and label
  the result historical. Do not edit the archived V1 application source.
- Avoid adding every conversation or every task event. Transfer durable context,
  key rationale, current verified handoff, and pointers to the records that hold
  detail.

## Implementation acceptance criteria

The documentation task is complete when:

1. All six handbook documents exist, are linked, and agree on source precedence
   and evidence labels.
2. `replit.md` clearly identifies V2 as the current runtime and points to the
   handbook without presenting legacy V1 commands as current.
3. Useful V1-specific `replit.md` guidance remains accessible as historical
   reference; no V1 source code or database is changed.
4. Owner decisions are separated from observations and unresolved questions.
   The account/password boundary is not overstated.
5. The dated state snapshot has been checked against current sources and says
   when it was checked.
6. The cold-start review can be completed using only the handbook and its
   linked sources, with citations or explicit unknowns.
7. No secrets, credentials, customer workbook content, production records, or
   personal information are introduced.
8. An agent can locate the test preview, start it without risking the shared
   database, use its synthetic sign-in, understand data cleanup and port
   contention, run its browser test, and restore the normal development
   workflow.
9. Existing documentation links and relevant repository documentation checks
   pass.

## Review checklist

- Is any item presented as approved when it is only a candidate or historical
  proposal?
- Could a new agent mistake a dated status note for live task status?
- Does every key V1/V2 history statement link to evidence and label the
  strength of that evidence?
- Are unresolved database, account, transfer, and deployment questions clearly
  left unresolved?
- Does the entry point route a new agent to current code, tests, the task board,
  the capability catalog, and the specialist memory index?
- Does the cold-start test reject unsupported answers instead of rewarding
  plausible guesses?
