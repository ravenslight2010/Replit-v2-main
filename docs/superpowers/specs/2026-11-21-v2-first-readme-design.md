# V2-first Repository README Design

## Goal

Make the repository landing page accurately identify V2 as the active
application and help a new contributor find its current setup and validation
instructions without mistaking retained V1 code for the deployed product.

## Proposed README content

The root `README.md` will:

- Name the project as Lucia's Production Assistant (V2) and describe its
  production-floor purpose in a short, current summary.
- Explain the product boundary: one production facility, potentially multiple
  inventory warehouses; web/PWA-first; server-owned shared state and run
  progression.
- Summarize the V2 capabilities evidenced in `v2/README.md`, including run
  control, production stations, scheduling/planning, reviewed imports,
  inventory, and manager/QC workflows. It will not imply V1 production records
  were transferred.
- Point contributors to `v2/README.md` for authoritative architecture, setup,
  test commands, and safety notes.
- Identify root `artifacts/` and `lib/` material and `_archived/v1/` as retained
  V1/reference material, not the active application.
- Provide a short V2 quick-start and focused validation commands that match the
  current V2 docs.
- Remove outdated V1-only mobile, CI, source-workbook, and operational claims
  from the root landing page. Keep the separate V1 documentation and research
  intact.
- Avoid a CI badge or repository URL unless it can be verified against the
  currently connected GitHub repository.

## Boundaries

- This is a documentation-only change; it does not change application behavior,
  deployment settings, database contents, or the archived V1 source.
- `v2/README.md` remains the detailed technical reference and is not rewritten
  as part of this change.
- Historical V1 references remain valid where they are explicitly identified
  as historical.

## Verification

- Check every README link and listed command against the current files and
  package scripts.
- Search the root README for statements that still describe V1 as the active
  app.
- Run `git diff --check`.
