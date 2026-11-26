# V1 importer lessons for V3

This is a curated transfer of V1 importer behavior, not a request to restore
the V1 implementation. The V1 source revision is pinned in the
[V3 source index](https://github.com/ravenslight2010/Production-assistant-v3/blob/main/research/source-index.md).
The V3 contract is the
[approved import-completion design](https://github.com/ravenslight2010/Production-assistant-v3/blob/main/research/decisions/import-completion-design.md),
current code, and current tests. V3 rules win whenever they differ.

## Preserve meaning from the source

A workbook is not just a bag of cells. Sheet purpose, row grouping, column
position, units, brand/flavor scope, recipe family, station slot, and whether a
product is made or bought can all change what a number means. Keep that context
and its cell/row provenance through parsing and review.

### Source families

- **Product/spec workbooks** combine product identity and line setup with
  applicator, target-weight, recipe-name, and sometimes package-related
  details. Do not assume a row is a complete recipe, and do not derive a dough
  yield merely because the sheet has a dough name.
- **Dough recipes** carry batch ingredient amounts, family/variant names,
  dough-ball weight, and tray yield as separate facts. Keep a family recipe
  distinct from each product's dough-ball weight and per-tray quantity. V1
  consolidated compatible variants under one family recipe; do not collapse
  products whose qualifiers change the actual dough.
- **Sauce recipes** use batch quantities. In V1, the production-line label
  **Frontline** refers to the sauce recipe pool. A sauce with no recipe rows
  can be a bought-as-is product, not an empty recipe to fabricate.
- **Cheese recipes** use pounds per batch. The V1 cheese applicator can
  represent an empty flavor set as a catch-all for all varieties; empty is
  meaningful and must not be turned into a guessed flavor list. A
  product-specific recipe must not be linked to the catch-all solely because
  both share a common brand name.
- **Premix/mix workbooks** can express per-pizza ounces, unlike
  dough/sauce/cheese batch pounds. Preserve the unit named by the source and
  the recipe/applicator association. Do not convert units using a guessed
  batch size.
- **Shipping/packaging guides** were handled deterministically in V1. Omit
  unsupported mappings instead of guessing a package setting, and patch only
  the selected profile's supported fields.
- **Schedules** may be a set of dated blocks across worksheets, not one flat
  table. Keep each date explicit; never infer a missing date from worksheet
  order. A re-import may replace prior imported rows for that date while
  preserving manual entries; V3's schedule history and Apply rules remain
  authoritative.

### Units and line identity

V1's important unit distinction was **M&V, dough, sauce, and cheese: pounds
per batch** versus **premix: ounces per pizza**. A quantity must retain its
source unit and basis until the V3 domain model explicitly accepts it. Do not
interpret a tolerance column or trailing numeric cell as an ingredient
amount; inspect the workbook layout and reconcile the result against the
worksheet's target-weight totals.

The production line's applicator order is App 1, App 2, PEPS, App 3, App 4.
Pepperoni-stick products are still pepperoni applicators, not cheese recipes.
Applicator position matters when identical product names appear in different
line stations; never deduplicate stations merely because the type matches.

## Match names without losing scope

- Match a recipe to its brand, flavor, product family, station, and unit
  context—not just a normalized string.
- A recipe can intentionally serve multiple product variants; do not mint one
  empty recipe per variant. Conversely, qualifiers that distinguish dough or
  cheese variants must not be erased by a loose-name match.
- Treat source order and word rearrangement as evidence for a review
  suggestion, not proof that two records are identical. Protect numbered,
  size, weight, and parenthesized qualifiers from fuzzy matching.
- V1 had AI matching and factory-wide learned aliases. Those were V1
  mechanisms, not portable permission to add AI or auto-learn aliases in V3.
  V3 may automatically link only a unique identity supported by its approved
  deterministic contract. Near matches stay review-only; ambiguous matches
  stay unresolved.
- A merge or rename can invalidate links held by other import kinds. Verify
  the canonical link after every rename/apply boundary rather than trusting a
  display name.

## Treat re-imports and missing values carefully

V1's history exposed several failure patterns worth guarding against:

- All-zero or empty recipe rows can create persistent stubs that look real in
  later pickers. Do not turn a missing component into an invented empty
  recipe.
- A selected “use existing” recipe link must update every dependent
  profile/name reference consistently; near-exact renames need an explicit
  propagation path.
- A blank field, an explicit source value of zero, an intentionally empty
  list, an unsupported formula, and an absent row are different states. Keep
  them distinct in the parser and staged diff.
- V1's spec re-import behavior could overwrite recipe rows, while cheese
  batch quantities had separate protection. That behavior is historical. V3
  must show conflicts and use its staged explicit Apply contract; do not
  reproduce a V1 overwrite rule by assumption.
- V1 importer ordering and V3's approved ordering differ. For V3 use the
  approved order: specs, dough/sauce, premixes, cheese, then shipping.
  Schedule imports are date-scoped. Do not reorder or auto-apply imports based
  on V1 convention.
- A source hash alone is not sufficient when parser semantics change. Pair
  source identity with parser version and retain review provenance; a changed
  source or parser invalidates value-level review as specified by V3.

## V3 implementation boundary

1. Keep parsing deterministic. Do not add AI calls, prompts, model
   configuration, provider libraries, or runtime credentials. The repository's
   `scripts/check-no-ai.mjs` is an enforceable boundary.
2. Parse supported workbook layouts explicitly. If formula values, external
   links, merged/ambiguous blocks, missing units, or unsupported layouts cannot
   be resolved from the source, return a clear unresolved result. Never trust
   an Excel cached formula result or guess a value.
3. Preserve source hash, parser version, sheet/row/cell provenance, stable
   record codes, and the distinctions needed to render the staged review.
4. Keep parsing and staging non-mutating. A combined review may coordinate
   staged imports, but it must not become a second setup writer. Only explicit
   Apply changes setup data.
5. Revalidate source/version and expected current revisions at Apply. Keep
   idempotency and per-import receipts intact; a retry must not silently
   create a second application.
6. Absence is not deletion. A missing row, skipped unsupported row, or empty
   optional block must not delete existing setup data. Destructive cleanup
   requires explicit supported review, not inference.
7. Test the complete path that changed: source bytes/layout → parse →
   normalize/link → staged review → Apply receipt → persisted records.
   Parser-only tests do not prove Apply or persistence.
8. Keep private workbooks, customer data, expected-output manifests,
   production rows, signed URLs, and credentials out of Git and reports. Use
   the approved private-corpus gate without copying corpus data into the
   repository.

## Investigation order

When an import appears wrong, compare the same record at each boundary and
identify the first divergence:

1. Source workbook: sheet, row/cell, original label, unit, and formula status.
2. Parsed result: field value, source provenance, and explicit unresolved
   reason.
3. Normalized identity and link decision: exact unique, suggestion, ambiguous,
   or unresolved.
4. Staged review: source/parser version, diff, conflicts, and manager
   decisions.
5. Apply result: idempotency key, receipt, and any rejected/rebased fields.
6. Persisted setup: canonical code and final values after reload.

Do not “fix” correct source parsing when the mismatch first occurs during
linking, review, Apply, or persistence. Do not replay an import to repair its
audit row; use the scoped idempotent audit-recovery path if an audit write is
the only failure.

For current test locations and assertions, read
[`importer-test-map.md`](importer-test-map.md).
