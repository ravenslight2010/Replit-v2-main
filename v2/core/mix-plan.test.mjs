import assert from "node:assert/strict";
import test from "node:test";
import { buildMixPlan } from "./mix-plan.mjs";

const makeDate = "2026-02-28";
const template = {
  code: "TEMPLATE-A",
  name: "Brand A · plain",
  brand: "Brand A",
  flavor: "Plain",
  values: { pizzasPerCase: 10 },
};
const nonPrep = {
  code: "MIX-REGULAR",
  name: "Regular mix",
  brand: "Brand A",
  flavor: "Plain",
  enabled: true,
  isPrep: false,
  daysEarly: 1,
  batchSizeLbs: 10,
  components: [
    { ingredientName: "Flour", perPizzaOz: 0.5, linkedIngredientCode: "FLOUR" },
    { ingredientName: "Salt", perBatchLbs: 1, linkedIngredientCode: "SALT" },
  ],
};
const prep = {
  code: "MIX-PREP",
  name: "Prepared mix",
  enabled: true,
  isPrep: true,
  daysEarly: 2,
  batchSizeLbs: 10,
  outputProductCode: "PREP",
  outputProductUnit: "each",
  outputStockUnitsPerLb: 2,
  components: [{
    ingredientName: "Flour",
    declaredIngredientCode: "FLOUR",
    linkedIngredientCode: "FLOUR",
    perBatchLbs: 2,
    productUnit: "kg",
    stockUnitsPerLb: 2,
  }],
};
const scheduledRun = {
  id: "run-scheduled",
  productCode: "PRODUCT-A",
  productionSetupCode: "SETUP-A",
  runTemplateCode: "TEMPLATE-A",
  targetCases: 2,
};
const schedule = {
  date: "2026-03-01",
  runs: [scheduledRun, {
    ...scheduledRun,
    id: "run-no-mix-demand",
    productCode: "PRODUCT-OTHER",
    runTemplateCode: "TEMPLATE-OTHER",
  }],
};
const templates = [
  template,
  { code: "TEMPLATE-OTHER", name: "Other product", brand: "Brand B", flavor: "Plain", values: { pizzasPerCase: 8 } },
];
const setup = {
  productCode: "PRODUCT-A",
  productionSetupCode: "SETUP-A",
  recipes: [{
    ingredients: [{ productCode: "PREP", productName: "Prepared mix", quantity: "4", unit: "each" }],
  }],
};
const activeRun = {
  id: "run-active",
  status: "paused",
  createdAt: "2026-02-28T23:30:00.000Z",
  startedAt: "2026-02-28T23:45:00.000Z",
  setupSnapshot: {
    label: "Active prep run",
    productCode: "PRODUCT-A",
    targetCases: 1,
    productionPlan: {
      recipes: [{
        ingredients: [{ productCode: "PREP", productName: "Prepared mix", quantity: "1", unit: "each" }],
      }],
    },
  },
};

function build(overrides = {}) {
  return buildMixPlan({
    makeDate,
    mixes: [nonPrep, prep],
    schedules: [schedule],
    templates,
    setups: [setup],
    activeRuns: [activeRun],
    substitutions: [],
    ...overrides,
  });
}

test("mix plan supports per-pizza and linked per-batch formulas without guessing", () => {
  const result = build();
  const regular = result.items.find((item) => item.mixCode === "MIX-REGULAR");
  const prepared = result.items.find((item) => item.mixCode === "MIX-PREP");

  assert.ok(regular);
  assert.equal(regular.preparationDate, makeDate);
  assert.equal(regular.totalQuantity, 0.625);
  assert.equal(regular.totalUnit, "lb");
  assert.equal(regular.components[1].amount, null);
  assert.equal(regular.batchEquivalent, null, "incomplete ingredient values do not produce a batch estimate");
  assert.ok(regular.warnings.some((warning) => warning.code === "per-pizza-amount-missing"));
  assert.equal(regular.contributingRuns[0].productionDate, "2026-03-01");

  assert.ok(prepared);
  assert.equal(prepared.totalQuantity, 9, "eight scheduled units plus one active frozen-snapshot unit");
  assert.equal(prepared.totalUnit, "each");
  assert.equal(prepared.batchEquivalent, 0.45);
  assert.equal(prepared.components[0].amount, 0.9);
  assert.equal(prepared.components[0].inventoryQuantity, 1.8);
  assert.equal(prepared.components[0].inventoryUnit, "kg");
  assert.deepEqual(prepared.contributingRuns.map((run) => run.status), ["paused", "scheduled"]);
});

test("make-day boundary is inclusive, Central-time active dates are respected, and completed runs are ignored", () => {
  const result = build({
    makeDate: "2026-03-01",
    mixes: [{ ...nonPrep, components: [{ ingredientName: "Flour", perPizzaOz: 0.5 }] }],
    schedules: [
      { date: "2026-03-02", runs: [scheduledRun] },
      { date: "2026-03-03", runs: [scheduledRun] },
    ],
    activeRuns: [
      { ...activeRun, startedAt: "2026-03-01T06:30:00.000Z" },
      { ...activeRun, id: "completed-run", status: "completed", completedAt: "2026-03-01T12:00:00.000Z" },
    ],
    templates: [template],
    setups: [setup],
  });
  const regular = result.items.find((item) => item.mixCode === "MIX-REGULAR");
  assert.ok(regular);
  assert.deepEqual(regular.contributingRuns.map((run) => run.productionDate), ["2026-03-02"]);
  assert.equal(result.coverage.activeRunCount, 1);
  assert.equal(result.coverage.scheduledRunCount, 2);
});

test("zero-demand and unrelated runs create no preparation cards", () => {
  const result = build({
    mixes: [{ ...nonPrep, components: [{ ingredientName: "Flour", perPizzaOz: 0 }] }],
    schedules: [schedule],
    activeRuns: [],
    setups: [],
  });
  assert.deepEqual(result.items, []);
  assert.equal(result.coverage.includedRunCount, 0);
});

test("missing batch size, unresolved links, conflicting links, and absent prep batch values are explicit", () => {
  const result = build({
    mixes: [
      { ...nonPrep, batchSizeLbs: null, components: [{ ingredientName: "Flour", perPizzaOz: 1 }] },
      {
        ...prep,
        components: [
          { ingredientName: "Flour", declaredIngredientCode: "OTHER", linkedIngredientCode: "FLOUR", perBatchLbs: 2 },
          { ingredientName: "Salt", perBatchLbs: null },
          { ingredientName: "Sugar", declaredIngredientCode: "SUGAR", perBatchLbs: 1 },
        ],
      },
    ],
    schedules: [schedule],
    activeRuns: [],
  });
  const regular = result.items.find((item) => item.mixCode === "MIX-REGULAR");
  const prepared = result.items.find((item) => item.mixCode === "MIX-PREP");
  assert.ok(regular?.warnings.some((warning) => warning.code === "batch-size-missing"));
  assert.equal(regular.batchEquivalent, null);
  assert.ok(prepared?.warnings.some((warning) => warning.code === "ambiguous-ingredient-link"));
  assert.ok(prepared?.warnings.some((warning) => warning.code === "per-batch-amount-missing"));
  assert.ok(prepared?.warnings.some((warning) => warning.code === "ingredient-link-missing"));
  assert.equal(prepared.components[2].inventoryQuantity, null);
});

test("substitutions are disclosed while the frozen active recipe remains the quantity source", () => {
  const original = structuredClone(activeRun);
  const result = build({
    mixes: [prep],
    schedules: [],
    activeRuns: [Object.freeze(activeRun)],
    substitutions: [{ runId: activeRun.id, plannedProductCode: "PREP", actualProductCode: "ALT", quantity: "1" }],
  });
  const item = result.items[0];
  assert.ok(item.warnings.some((warning) => warning.code === "run-has-substitution"));
  assert.equal(item.totalQuantity, 1);
  assert.deepEqual(activeRun, original);
});

test("changed current setup recipes change only scheduled demand, not frozen active snapshots", () => {
  const updated = build({ setups: [{ ...setup, recipes: [{ ingredients: [] }] }] });
  const prepared = updated.items.find((item) => item.mixCode === "MIX-PREP");
  assert.equal(prepared.totalQuantity, 1);
  assert.deepEqual(prepared.contributingRuns.map((run) => run.status), ["paused"]);
});
