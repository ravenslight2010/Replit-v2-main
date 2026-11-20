# V2 station calculations: workbook-backed examples

## Scope and source handling

The owner identified the V1 workbook set as the approved source and approved using
only a planned case count from the archived schedule. The schedule contributes
only the numeric value at `3-17!E8` (55); customer, product-row, shipping, and PO
fields are not copied into the regression fixture. The V1 schedule importer maps
the `Units` column to planned cases.

The explicit Cheese calculation is a non-production worked example marked
`Example` in its workbook. The 55-case cross-station scenario uses the approved
count-only schedule value with setup values from the matching source workbooks.
It is an archived schedule example, not a synthetic run or a live production
database record. No production database was queried.

Tests pin SHA-256 fingerprints for the source workbooks. If a workbook changes,
the source cells and expected results must be reviewed before updating the pins.

## Evidence and expected results

| Station/example | Approved source and native units | V2 input / expected result |
| --- | --- | --- |
| Cheese worked example | `attached_assets/source-library/cheese/Cheese_Mix_Recipe_Specs_-_Tabbed_by_Customer_-_07.10.26_1784339826076.xlsx`, `Edwardo!A21:A25`: 1,092 cases, 12 pizzas/case, 0.01 oz/pizza, total 8.19 lb. `Edwardo!B29:B30`: 5.000 lb + 1.250 lb = 6.25 lb/batch. | 8.19 lb required; 2 batches. The workbook separately rounds component amounts to 6.6 lb and 1.6 lb (8.2 lb combined); the station total follows its explicit 8.19 lb figure. |
| Line and case target | `attached_assets/source-library/schedule/Production_Schedule_7-8-26_1784339875921.xlsx`, `3-17!E8`: 55 planned units/cases. Only the count is used. `_archived/v1/artifacts/run-calculator/src/utils/runExcel.ts` confirms V1 maps `Units` to planned cases. | At run start: target 55, remaining 55, work in progress 0, completion 0%. |
| Shipping units | `attached_assets/source-library/shipping/Shipping_and_Palletizing_Guide_07.02.2026_1784339849858.xlsx`, `Sheet1!E3`: 12 pizzas/case; `F3`: 60 cases/skid. | 55 cases require 1 skid. |
| Cheese / Frontline recipe | `attached_assets/source-library/specs/Aldo's_Pizza_Specs_-_09_1784339783417.xlsx`, `OZ!B24`: 2.90 oz/pizza. `attached_assets/source-library/cheese/Cheese_Mix_Recipe_Specs_-_Tabbed_by_Customer_-_07.10.26_1784339826076.xlsx`, `Aldo!B13:B17`: 20.000 + 35.000 + 0.300 + 0.300 = 55.600 lb/batch. | Without a layer: Cheese 119.63 lb and 3 batches; Frontline's +20 lb allowance yields 139.63 lb, or 2.51 batches. With an illustrative frozen 4-case layer: Cheese 128.32 lb and 3 batches; Frontline 148.32 lb, or 2.67 batches. With 20 lb on line and 10 lb consumed (test-state values, not workbook facts), Frontline has 1.97 batches to make without a layer and 2.13 with it. |
| Pepperoni | `attached_assets/source-library/specs/Aldo's_Pizza_Specs_-_09_1784339783417.xlsx`, `OZ!C25`: 1.90 oz/pizza. No positive pepperoni batch weight is supplied by the cited workbooks. | 78.38 lb without a layer; 84.08 lb with an illustrative frozen 4-case layer. Batch count remains unknown (`null`), and no stick allowance is inferred. |
| Sauce | `attached_assets/source-library/specs/Aldo's_Pizza_Specs_-_09_1784339783417.xlsx`, `OZ!B23`: 4.00 oz/pizza. `attached_assets/source-library/sauce/Aldo_Pizza_Sauce_02_1784339518984.xlsx`, `Sheet1!C19`: 271.50 lb recipe batch. | For 55 cases without a layer: 195 lb total and 0.72 estimated barrels. With a frozen 4-case layer setting: 207 lb and 0.76 barrels. The 4-case setting is an illustrative test value, not a source-backed Aldo setting. |
| Dough | `attached_assets/source-library/dough/Aldo's_Dough_Mixing_Procedure_-_09_1784339683714.xlsx`, `Sheet1!D11`: 310.50 lb/batch; `C32`: 7.7 oz/doughball; `E32`: 645.19 doughballs/batch; `F32`: 24 doughballs/tray. | The yield formula gives 645.19 doughballs/batch. At 12 pizzas/case, the approved fractional capacity is 53.7658 cases/batch. For 55 cases, V2 needs 2 batches. |
| Packaging remainder | Shipping guide `Sheet1!F3`: 60 cases/skid; the count-only target is 55 cases. | 1 skid needed, none complete, 0 cases on the current skid before packing. Boundary checks cover 59, 60, and 61 packed cases. |

## Boundary checks

- Dough with the approved 53.7658 cases/batch: 53 cases needs 1 batch; 54 and
  107 need 2 batches; 108 needs 3.
- Sauce at 80 and 81 cases produces 0.99 and 1.01 estimated barrels, requiring
  1 and 2 full barrels respectively.
- Frontline uses fractional batch estimates: 139.63 lb ÷ 55.60 lb/batch = 2.51
  batches needed. With 30 lb on line or consumed, (139.63 − 30) ÷ 55.60 =
  1.97 batches still to make. With the illustrative 4-case layer, V2 uses
  148.32 lb, 2.67 batches needed, and 2.13 batches to make.
- For the 55-case example, the illustrative 4-case layer adds 8.7 raw lb to
  Cheese and Frontline, and 5.7 raw lb to Pepperoni; V2 rounds displayed demand
  to hundredths. Sauce continues to include the same layer plus its +30 lb loss.
- Packaging changes from 59 cases on the current skid to a completed skid at 60,
  then 1 case on the next skid at 61.
- Line completion remains capped at 100%, with remaining cases floored at zero.
- The supplied Pepperoni specification supports pounds but not a recipe batch
  count; synthetic tests continue to cover the positive-batch-weight path.

## Approved dough rule and recorded station decisions

On 2026-11-16, the owner approved preserving the fractional dough yield. V2
uses 53.7658 cases per batch (645.19 doughballs / 12 pizzas per case, rounded
to four decimal places) and calculates batches as
`ceil(targetCases / casesPerBatch)`. This yields 1 batch for 53 cases, 2 for
54 and 107, and 3 for 108. The approved recipe yield and case size are
unchanged; V2 accepts four decimal places for this capacity.

On 2026-11-19, the owner approved the following:

1. **Frontline:** Keep the +20 lb allowance and report fractional batch
   estimates. V1's archived calculation adds 20 lb, then divides by effective
   batch weight without rounding up. V2 rounds pounds to hundredths and derived
   batch estimates to hundredths. For the 55-case example, 139.63 ÷ 55.60 =
   2.51 batches; after 20 lb on line and 10 lb consumed, 1.97 remain to make.
   The on-line and consumed amounts are synthetic test values. V1 also used a
   layer-inclusive pizza basis for applicators; this approval covers Frontline's
   allowance and fractional estimates only, so V2 retains its current
   target-case basis for Frontline.
2. **Sauce:** Include `casesPerLayer` from the run's frozen
   `setupSnapshot.dieSetup.lineSettings` when that run has a positive saved
   value; otherwise use the planned case count only. This matches V1's
   `totalPizzasForSauce = (casesNeeded + casesPerLayer) × pizzasPerCase` basis
   without reading a mutable die default. In the illustrative 4-case layer
   example, Sauce demand is `(55 + 4) × 12 × 4 ÷ 16 + 30 = 207 lb`, or
   `207 ÷ 271.5 = 0.76` barrels. No cited source establishes 4 as Aldo's layer
   count.
3. **Pepperoni (decision before the layer-scope confirmation):** Keep batch
   count unavailable unless a batch size is supplied; do not infer a stick
   allowance or weight. `OZ!C25` supplies 1.90 oz/pizza, but none of the cited
   workbooks establishes Pepperoni batch pounds or the meaning/weight of V1's
   `pep1Sticks` value. At that time the source-backed demand was 78.38 lb for 55
   cases; batch metrics remained `null` without a known size. Although V1 also
   included the layer in its shared Pepperoni pizza basis, no unsupported stick
   or batch adjustment is carried into V2.

## Owner-confirmed layer scope

On 2026-11-20, the owner confirmed that the positive `casesPerLayer` value
frozen in a run's `setupSnapshot.dieSetup.lineSettings` applies to ingredient
demand at all four V2 stations: Sauce, Cheese, Frontline, and Pepperoni. This
supersedes the earlier target-case-only scope for Cheese, Frontline, and
Pepperoni. The case target and case-progress metrics remain unchanged.

For the illustrative 55-case run with 12 pizzas per case and a frozen 4-case
layer, Cheese changes from 119.63 to 128.32 lb; Frontline changes from 139.63
to 148.32 lb while keeping its +20 lb allowance; Pepperoni changes from 78.38
to 84.08 lb; and Sauce remains 207 lb including its +30 lb preparation loss.
The four-case layer is only an example, not an Aldo source fact. Pepperoni's
batch count stays unavailable without a supplied batch size, and the layer
does not create a stick allowance or weight.

When the run has no positive frozen layer value, these stations use the planned
case count only. The shared inventory-math summary already used its
layer-inclusive pizza basis for Sauce, applicators, and Pepperoni; this change
aligns the V2 station calculations with that existing basis without altering
inventory-math behavior.

V1 comparison references: archived distribution
`_archived/v1/artifacts/run-calculator/dist/public/assets/src-DAlRkSo8.js`
(minified station calculation containing `casesPerLayer`, the +20/+30 lb
allowances, fractional divisions, and Pepperoni stick addition); the readable
shared formula is in `lib/inventory-math/src/index.ts:107-162`. Current V2
behavior is implemented in `v2/core/station-workflows.mjs:240-282`; focused
regressions are in `v2/core/station-workflows.test.mjs`.
