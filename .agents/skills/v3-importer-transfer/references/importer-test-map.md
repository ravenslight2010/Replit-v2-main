# V3 importer test map

Use this map alongside [V1 importer lessons](v1-importer-lessons.md) and
[Work on V3 importers](../SKILL.md). Paths were checked against the current
V3 repository tree when this transfer was prepared; inspect current `main`
before relying on them.

## Deterministic parser and mapping tests

| Area | Source and tests | Existing coverage to preserve |
| --- | --- | --- |
| Source workbook parse | `core/source-workbook-import.mjs` and `core/source-workbook-import.test.mjs` | Supported layout and value extraction, row/cell provenance, duplicate identity, file/size bounds, formulas and cached values failing closed. |
| Setup catalog CSV | `core/setup-catalog-csv.mjs` and `core/setup-catalog-csv.test.mjs` | Header/layout validation, stable catalog identity, normalized fields, and explicit invalid-row handling. |
| General CSV import | `core/import-csv.mjs` and `core/import-csv.test.mjs` | Supported columns, strict value parsing, duplicates, invalid input, and row-level import semantics. |
| Schedule workbook | `core/schedule-workbook-import.mjs` and `core/schedule-workbook-import.test.mjs` | Explicit dates/day blocks, schedule normalization, unsupported templates, and no guessed schedule date. |
| Capacity workbook | `core/workbook-capacity-import.mjs` and `core/workbook-capacity-import.test.mjs` | Capacity/template mapping, strict source values, and unresolved unsupported layouts. |
| Private corpus boundary | `core/private-source-corpus.mjs`, `core/private-source-corpus.test.mjs`, and `core/source-workbook-corpus.test.mjs` | Manifest and corpus availability checks without committing workbooks or expected customer data. |

## End-to-end and database checks

- `e2e/setup-catalog.browser.test.mjs` exercises the manager setup-catalog flow
  in a browser with mocked APIs.
- `e2e/schedule.browser.test.mjs` exercises schedule import and review in a
  browser with mocked APIs.
- `server/schedule-api.test.mjs` covers schedule API contracts.
- `db/0021-source-workbook-parser-v2.test.sql` checks database behavior for
  source-workbook parser state.
- `db/0023-schedule-import-history.test.sql` checks schedule import history.
- `db/0007-approved-setup-catalogs.test.sql` and
  `db/0014-setup-catalog-editors.test.sql` cover setup catalog storage and
  edits.

Choose server/database suites by the code boundary changed; do not point these
tests at production. See `package.json` for current script definitions.

## Confirmed coverage gap to resolve

A synthetic XLSX check found that a formula-backed dough yield with a cached
display value is currently returned by `parseDoughCapacityWorkbook` as a
numeric `doughballYield`. The approved V3 design says formula or cached results
remain unresolved unless explicitly supported as source text. The capacity
tests cover literal and missing yields but do not cover a formula with a
cached result. Treat this as an importer correctness gap, not as covered
behavior. Keep any code fix and regression test in a separate reviewed change;
the documentation transfer itself does not alter the runtime.

## Recommended regression chain

For a parser or importer behavior change, assert as much of this chain as
applies:

1. Exact source rows, units, and provenance produce the intended parse result.
2. Exact unique identities link; near/ambiguous identities remain reviewable
   and unresolved.
3. Unsupported formulas/layouts fail closed with a visible reason.
4. Staging is non-mutating and displays omitted values as omitted, not deletes.
5. Apply is explicit, revision-fenced, idempotent, and returns a stable
   receipt.
6. Reloaded setup matches the applied result without overwriting
   unrelated/manual values.

`pnpm test` runs core/server/web/agent unit tests. Use `pnpm test:browser` for
browser journeys and `pnpm test:db` for real-Postgres SQL behavior. The
private-corpus suite requires separately provisioned files; never copy them
into Git to make a test pass.
