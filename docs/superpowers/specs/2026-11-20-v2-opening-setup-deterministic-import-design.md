# V2 Opening Setup: Deterministic Import Design

**Status:** Owner approved the design; importer implementation is complete and
manager review is pending.

## Goal

Improve deterministic handling of the owner-authorized setup workbooks and route
each source family through the existing V2 manager review flow that matches its
data. Keep every row's source reference, units, and unresolved status visible.
Nothing is auto-applied.

## Evidence from the approved source set

The owner approved deterministic parsing of the 50 files in the six supported
source-library families. No workbook has been staged or applied.

- The existing capacity importer parsed all 13 dough procedures into 29 rows.
  Every parsed row has an explicit doughball yield and per-tray count; doughball
  weight is in ounces.
- The existing capacity importer parsed the shipping workbook into 20 rows with
  explicit pizzas-per-case values.
- The premix workbook has 51 sheets, exceeding the current 32-sheet workbook
  limit.
- One cheese worksheet advertises an `A1:XFD44` formatted range while its stored
  cells use only six columns. Its formatting-only width triggers the current
  safety rejection.
- The setup-family importer did not recognize the remaining spec and sauce
  layouts as explicit V2 profile assignments. Their contents must not be
  mapped from filenames or ambiguous free text.

These are parse observations, not import approvals or production records.

## Proposed implementation

### 1. Bound workbook reading by actual content

- Continue enforcing the existing upload size, expanded-size, and per-sheet
  safeguards.
- Permit up to 64 sheets and enforce an aggregate ceiling of 100,000
  materialized review cells across the workbook.
- Derive sheet bounds from stored value/formula cells, not formatting-only
  `!ref` extents. Preserve formula cells and their coordinates.
- Reject a workbook that exceeds a bound; do not silently truncate sheets,
  rows, columns, formulas, or records.

### 2. Route each supported layout through its matching V2 preview

- **Dough procedures:** use the existing capacity importer. Retain explicit
  ounces, doughball yield, and per-tray counts. The manager must resolve
  unmatched or ambiguous product links before staging.
- **Shipping capacity:** use the existing capacity importer for explicit
  pizzas-per-case values. Do not stage that same field a second time from the
  source-family preview. Other packaging fields remain unresolved unless a
  deterministic V2 mapping is supported and reviewed.
- **Premix:** allow the 51-sheet workbook within the aggregate bounds. Keep
  formula-dependent quantities unresolved; do not calculate formulas or trust
  cached values. Keep `perPizzaOz` as ounces per pizza and `perBatchLbs` as
  pounds per batch. Include the source row and unit in transient review evidence
  for each parsed ingredient component.
- **Cheese:** ignore formatting-only columns outside stored content. Continue
  requiring explicit recipe/applicator and flavor assignment. Keep formula
  quantities and unsupported fields unresolved; retain batch pounds as pounds
  and include component source rows in transient review evidence.
- **Spec and sauce:** add no inferred assignments. A row may become a V2 setup
  candidate only when its source values explicitly identify the target and
  map to supported V2 fields. Otherwise show it as unresolved with a reason.

### 3. Preserve manager-controlled review and apply

- Keep current preview, correction, stage, apply, and receipt behavior.
- Require manager product selection for unmatched or ambiguous capacity rows.
- Keep unsupported columns and formula-backed values visible in the review.
- Do not write customer records, create staff accounts, or change inventory
  balances as part of importer implementation.

## Tests and reconciliation

Add focused regression coverage for:

- A valid workbook with more than 32 but no more than 64 sheets.
- Workbook rejection above the sheet or aggregate-cell limit.
- Formatting-only `XFD` worksheet extents with a small set of stored cells.
- Formula cells remaining unresolved, including formulas without cached values.
- Units, source coordinates, explicit product links, duplicate/ambiguous links,
  and row outcomes.

After implementation, rerun a review-only preview over the approved source
files. Reconcile source rows to proposed, skipped, and unresolved outcomes by
family. Do not stage or apply those customer records until an owner reviews them
in the V2 manager UI.

## Safety boundaries

- Do not restore the V1 database or copy V1 runs, inventory balances or
  movements, sessions, password hashes, or credentials.
- Do not estimate opening inventory. V2 inventory starts from a fresh physical
  count.
- Create staff only through V2 account controls after owner review.
- No AI guesses, fuzzy product links, filename-derived assignments, hidden
  fallbacks, or automatic Apply.

## Acceptance criteria

- The larger premix workbook and inflated cheese range are handled without
  weakening explicit resource bounds.
- Every supported value retains its source reference and unit.
- Unmatched, formula-backed, unsupported, and ambiguous data remain visible
  and out of Apply until reviewed.
- Preview totals reconcile to the approved input set; no customer row is staged
  or applied by automated implementation or verification.
- The cutover report clearly separates successfully previewed data from
  manager-pending actions, fresh staff setup, and the physical inventory count.
