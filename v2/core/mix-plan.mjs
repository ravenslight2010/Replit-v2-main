import { isValidProductionDate, SCHEDULE_TIME_ZONE } from "./schedule-planning.mjs";

const OZ_PER_POUND = 16;
const ACTIVE_STATUSES = new Set(["running", "paused"]);

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function dateDifference(later, earlier) {
  if (!isValidProductionDate(later) || !isValidProductionDate(earlier)) return null;
  return (Date.parse(`${later}T00:00:00Z`) - Date.parse(`${earlier}T00:00:00Z`)) / 86_400_000;
}

function centralDateFromTimestamp(value) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SCHEDULE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const result = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
  return `${result.year}-${result.month}-${result.day}`;
}

function fold(value) {
  return typeof value === "string" ? value.trim().toLocaleLowerCase("en-US") : "";
}

function sourceWarning(code, message, details = {}) {
  return { code, message, ...details };
}

function addWarning(item, code, message, details = {}) {
  if (!item.warnings.some((warning) => warning.code === code
    && warning.componentCode === details.componentCode
    && warning.runId === details.runId)) {
    item.warnings.push(sourceWarning(code, message, details));
  }
}

function validComponentLinks(mix, item) {
  const components = Array.isArray(mix.components) ? mix.components : [];
  const codeCounts = new Map();
  for (const component of components) {
    const code = fold(component.linkedIngredientCode);
    if (code) codeCounts.set(code, (codeCounts.get(code) ?? 0) + 1);
  }
  return components.map((component, index) => {
    const declaredCode = fold(component.declaredIngredientCode);
    const linkedCode = fold(component.linkedIngredientCode);
    const componentCode = component.linkedIngredientCode ?? null;
    const conflict = declaredCode && linkedCode && declaredCode !== linkedCode;
    const duplicate = linkedCode && codeCounts.get(linkedCode) > 1;
    if (conflict || duplicate) {
      addWarning(item, "ambiguous-ingredient-link", conflict
        ? `${component.ingredientName || "A component"} has conflicting ingredient codes; its inventory quantity is not converted.`
        : `${component.ingredientName || "A component"} shares an ingredient link with another mix row; its inventory quantity is not converted.`,
      { componentCode: String(index) });
    } else if (!linkedCode) {
      addWarning(item, "ingredient-link-missing",
        `${component.ingredientName || "A component"} has no approved ingredient link.`);
    }
    return { component, index, linkedCode, conflict: Boolean(conflict || duplicate) };
  });
}

function makeItem(mix, makeDate, mode) {
  return {
    mixCode: mix.code,
    mixName: mix.name,
    mode,
    preparationDate: makeDate,
    batchSizeLbs: numberOrNull(mix.batchSizeLbs),
    batchEquivalent: null,
    totalQuantity: null,
    totalUnit: null,
    components: [],
    contributingRuns: [],
    warnings: [],
  };
}

function addContribution(item, run) {
  item.contributingRuns.push({
    runId: run.id,
    label: run.label,
    status: run.status,
    productionDate: run.date,
    productCode: run.productCode,
    productName: run.productName ?? run.productCode,
    cases: run.cases,
    pizzas: run.pizzas ?? null,
  });
}

function eligibleMix(mix, makeDate, productionDate, item) {
  const daysEarly = numberOrNull(mix.daysEarly);
  if (daysEarly === null || !Number.isSafeInteger(daysEarly)) {
    addWarning(item, "make-ahead-window-missing",
      "The mix has no valid make-ahead window, so its preparation date cannot be confirmed.");
    return false;
  }
  const daysUntil = dateDifference(productionDate, makeDate);
  return daysUntil !== null && daysUntil >= 0 && daysUntil <= daysEarly;
}

function matchingTemplate(run, templates) {
  const key = fold(run.runTemplateCode);
  return templates.find((template) => fold(template.code) === key) ?? null;
}

function matchingSetup(run, setups) {
  const product = fold(run.productCode);
  const setup = fold(run.productionSetupCode);
  return setups.find((entry) => fold(entry.productCode) === product
    && fold(entry.productionSetupCode) === setup) ?? null;
}

function normalizedRecipeLines(recipes) {
  if (!Array.isArray(recipes)) return [];
  return recipes.flatMap((recipe) => Array.isArray(recipe?.ingredients)
    ? recipe.ingredients
    : []);
}

function initialComponentRows(mix, item) {
  const rows = validComponentLinks(mix, item).map(({ component, index, linkedCode, conflict }) => ({
    index,
    name: component.ingredientName || `Component ${index + 1}`,
    ingredientCode: linkedCode || null,
    perPizzaOz: numberOrNull(component.perPizzaOz),
    perBatchLbs: numberOrNull(component.perBatchLbs),
    amount: null,
    unit: null,
    inventoryQuantity: null,
    inventoryUnit: null,
    _linkConflict: conflict,
  }));
  item.components = rows;
  return rows;
}

function finishPerPizzaItem(mix, item, run, template) {
  const cases = Number(run.targetCases ?? run.cases);
  const pizzasPerCase = numberOrNull(template?.values?.pizzasPerCase);
  if (!Number.isSafeInteger(cases) || cases < 1) {
    addWarning(item, "case-count-missing", "The run has no valid case target.");
    addContribution(item, run);
    return true;
  }
  if (pizzasPerCase === null || pizzasPerCase <= 0) {
    addWarning(item, "pizzas-per-case-missing",
      "The run template has no approved pizzas-per-case value.");
    run.cases = cases;
    addContribution(item, run);
    return true;
  }
  const pizzas = cases * pizzasPerCase;
  if (!Number.isFinite(pizzas) || pizzas <= 0) {
    addWarning(item, "pizza-demand-invalid", "The run's pizza demand is outside the supported range.");
    return false;
  }
  run.cases = cases;
  run.pizzas = pizzas;
  let anyPositiveDemand = false;
  for (const component of item.components) {
    if (component.perPizzaOz === null) {
      addWarning(item, "per-pizza-amount-missing",
        `${component.name} has no approved ounces-per-pizza value; its need is not estimated.`,
        { componentCode: String(component.index), runId: run.id });
      continue;
    }
    const pounds = component.perPizzaOz * pizzas / OZ_PER_POUND;
    if (!Number.isFinite(pounds)) {
      addWarning(item, "component-amount-invalid",
        `${component.name} exceeds the supported quantity range.`,
        { componentCode: String(component.index), runId: run.id });
      continue;
    }
    component.amount = (component.amount ?? 0) + pounds;
    component.unit = "lb";
    anyPositiveDemand ||= pounds > 0;
  }
  if (!mix.batchSizeLbs || numberOrNull(mix.batchSizeLbs) === null) {
    addWarning(item, "batch-size-missing",
      "Pound needs are shown, but the mix has no approved batch size for a batch estimate.");
  }
  addContribution(item, run);
  return anyPositiveDemand || item.components.some((component) => component.perPizzaOz === null);
}

function prepDemandForRun(mix, item, run, recipeLines) {
  const outputCode = fold(mix.outputProductCode ?? mix.productCode);
  if (!outputCode) return false;
  const matches = recipeLines.filter((line) => fold(line.productCode) === outputCode);
  if (matches.length === 0) return false;
  const unit = typeof mix.outputProductUnit === "string" ? mix.outputProductUnit.trim() : "";
  const demandLines = matches.map((line) => ({
    line,
    quantity: numberOrNull(line.quantity),
    unit: typeof line.unit === "string" ? line.unit.trim() : "",
  }));
  if (!unit || demandLines.some(({ quantity, unit: lineUnit }) => quantity === null || !lineUnit
    || fold(lineUnit) !== fold(unit))) {
    addWarning(item, "output-unit-mismatch",
      "The run recipe and prepared-mix inventory mapping do not share a complete matching unit.",
      { runId: run.id });
    addContribution(item, run);
    return true;
  }
  const cases = Number(run.targetCases ?? run.cases);
  if (!Number.isSafeInteger(cases) || cases < 1) {
    addWarning(item, "case-count-missing", "The run has no valid case target.", { runId: run.id });
    addContribution(item, run);
    return true;
  }
  const demand = demandLines.reduce((sum, value) => sum + value.quantity * cases, 0);
  if (!Number.isFinite(demand) || demand <= 0) return false;
  item.totalQuantity = (item.totalQuantity ?? 0) + demand;
  item.totalUnit = unit;
  run.cases = cases;
  addContribution(item, run);
  return true;
}

function finishPrepItem(mix, item, substitutionsByRun) {
  const batchSize = numberOrNull(mix.batchSizeLbs);
  const outputRate = numberOrNull(mix.outputStockUnitsPerLb ?? mix.stockUnitsPerLb);
  const outputUnit = typeof mix.outputProductUnit === "string" ? mix.outputProductUnit.trim() : "";
  if (batchSize === null || batchSize <= 0) {
    addWarning(item, "batch-size-missing",
      "The mix has no approved batch size; its production need cannot be converted to batch equivalents.");
  }
  if (outputRate === null || outputRate <= 0 || !outputUnit) {
    addWarning(item, "output-conversion-missing",
      "The prepared mix has no complete inventory product and stock-unit conversion.");
  }
  if (batchSize > 0 && outputRate > 0 && item.totalQuantity !== null) {
    const batchOutput = batchSize * outputRate;
    if (Number.isFinite(batchOutput) && batchOutput > 0) {
      item.batchEquivalent = item.totalQuantity / batchOutput;
    }
  }
  const rows = initialComponentRows(mix, item);
  const batchEquivalent = item.batchEquivalent;
  for (const component of rows) {
    if (component.perBatchLbs === null) {
      addWarning(item, "per-batch-amount-missing",
        `${component.name} has no approved pounds-per-batch value; its preparation quantity is not estimated.`,
        { componentCode: String(component.index) });
      continue;
    }
    if (batchEquivalent === null) continue;
    const pounds = component.perBatchLbs * batchEquivalent;
    if (!Number.isFinite(pounds)) {
      addWarning(item, "component-amount-invalid",
        `${component.name} exceeds the supported quantity range.`,
        { componentCode: String(component.index) });
      continue;
    }
    component.amount = pounds;
    component.unit = "lb";
    const link = (mix.components ?? [])[component.index];
    const rate = numberOrNull(link?.stockUnitsPerLb);
    const productUnit = typeof link?.productUnit === "string" ? link.productUnit.trim() : "";
    if (!component._linkConflict && component.ingredientCode && rate > 0 && productUnit) {
      component.inventoryQuantity = pounds * rate;
      component.inventoryUnit = productUnit;
    } else if (!component._linkConflict && component.ingredientCode && (!rate || !productUnit)) {
      addWarning(item, "ingredient-conversion-missing",
        `${component.name} has no complete inventory product and stock-unit conversion.`,
        { componentCode: String(component.index) });
    }
  }
  for (const run of item.contributingRuns) {
    if ((substitutionsByRun.get(run.runId) ?? []).length > 0) {
      addWarning(item, "run-has-substitution",
        `${run.label} has a recorded supply substitution; quantities still use its frozen recipe snapshot.`,
        { runId: run.runId });
    }
  }
  item.components.forEach((component) => { delete component._linkConflict; });
}

export function buildMixPlan({ makeDate, mixes, schedules, templates, setups, activeRuns, substitutions = [] }) {
  if (!isValidProductionDate(makeDate)) throw new TypeError("Choose a valid mix preparation date.");
  if (![mixes, schedules, templates, setups, activeRuns, substitutions].every(Array.isArray)) {
    throw new TypeError("Mix plan sources must be complete arrays.");
  }
  const byTemplate = new Map(templates.map((template) => [fold(template.code), template]));
  const substitutionsByRun = new Map();
  for (const substitution of substitutions) {
    if (!substitution || typeof substitution.runId !== "string") continue;
    const list = substitutionsByRun.get(substitution.runId) ?? [];
    list.push(substitution);
    substitutionsByRun.set(substitution.runId, list);
  }
  const scheduledRuns = [];
  for (const schedule of schedules) {
    if (!isValidProductionDate(schedule?.date) || dateDifference(schedule.date, makeDate) < 0
      || !Array.isArray(schedule.runs)) continue;
    for (const run of schedule.runs) {
      const template = matchingTemplate(run, templates);
      const setup = matchingSetup(run, setups);
      scheduledRuns.push({
        ...run,
        id: run.id,
        label: run.label || template?.name || run.productCode || "Scheduled run",
        status: "scheduled",
        date: schedule.date,
        targetCases: run.targetCases,
        productName: run.productName ?? run.productCode,
        template,
        setup,
        recipes: setup?.recipes ?? null,
      });
    }
  }
  const currentRuns = activeRuns.flatMap((run) => {
    if (!run || !ACTIVE_STATUSES.has(run.status)) return [];
    const date = centralDateFromTimestamp(run.startedAt ?? run.createdAt);
    if (!date || dateDifference(date, makeDate) < 0) return [];
    const snapshot = run.setupSnapshot;
    const plan = snapshot?.productionPlan;
    return [{
      id: run.id,
      label: snapshot?.label || "Active run",
      status: run.status,
      date,
      targetCases: snapshot?.targetCases,
      productCode: snapshot?.productCode ?? null,
      productName: snapshot?.productCode ?? null,
      recipes: Array.isArray(plan?.recipes) ? plan.recipes : null,
      template: null,
      setup: null,
    }];
  });
  const allRuns = [...scheduledRuns, ...currentRuns];
  const planItems = new Map();

  for (const mix of mixes.filter((value) => value?.enabled === true)) {
    const outputCode = fold(mix.outputProductCode ?? mix.productCode);
    const candidates = mix.isPrep
      ? outputCode
        ? allRuns.filter((run) => normalizedRecipeLines(run.recipes)
          .some((line) => fold(line.productCode) === outputCode))
        : []
      : allRuns.filter((run) => run.status === "scheduled"
        && fold(run.template?.brand) === fold(mix.brand)
        && fold(run.template?.flavor) === fold(mix.flavor));
    for (const run of candidates) {
      const itemKey = `${mix.code}:${makeDate}`;
      let item = planItems.get(itemKey);
      if (!item) {
        item = makeItem(mix, makeDate, mix.isPrep ? "per-batch" : "per-pizza");
        if (!mix.isPrep) initialComponentRows(mix, item);
        planItems.set(itemKey, item);
      }
      if (!eligibleMix(mix, makeDate, run.date, item)) continue;
      if (mix.isPrep) {
        const lines = normalizedRecipeLines(run.recipes);
        const foundDemand = prepDemandForRun(mix, item, run, lines);
        if (!foundDemand) continue;
        if (run.status !== "scheduled" && (substitutionsByRun.get(run.id) ?? []).length > 0) {
          addWarning(item, "run-has-substitution",
            `${run.label} has a recorded supply substitution; quantities still use its frozen recipe snapshot.`,
            { runId: run.id });
        }
      } else {
        const populated = finishPerPizzaItem(mix, item, run, run.template);
        if (!populated) item.contributingRuns.pop();
      }
    }
  }

  const items = [...planItems.values()]
    .filter((item) => item.contributingRuns.length > 0)
    .map((item) => {
      if (item.mode === "per-batch") finishPrepItem(
        mixes.find((mix) => mix.code === item.mixCode),
        item,
        substitutionsByRun,
      );
      const totals = item.components.reduce((sum, component) => sum + (component.amount ?? 0), 0);
      if (item.mode === "per-pizza" && item.components.some((component) => component.amount !== null)) {
        item.totalQuantity = totals;
        item.totalUnit = "lb";
        const size = numberOrNull(item.batchSizeLbs);
        if (size > 0 && item.components.every((component) => component.amount !== null)) {
          item.batchEquivalent = totals / size;
        }
      }
      item.contributingRuns.sort((a, b) => a.productionDate.localeCompare(b.productionDate)
        || a.label.localeCompare(b.label));
      item.warnings.sort((a, b) => a.code.localeCompare(b.code)
        || String(a.componentCode ?? "").localeCompare(String(b.componentCode ?? "")));
      return item;
    })
    .sort((a, b) => a.mixName.localeCompare(b.mixName) || a.mixCode.localeCompare(b.mixCode));

  const globalWarnings = [];
  for (const mix of mixes.filter((value) => value?.enabled === true && value.isPrep && !value.outputProductCode)) {
    globalWarnings.push(sourceWarning("prepared-product-link-missing",
      `${mix.name} has no prepared-stock product link, so scheduled demand cannot be matched.`,
      { mixCode: mix.code }));
  }
  for (const mix of mixes.filter((value) => value?.enabled === true)) {
    if (numberOrNull(mix.daysEarly) === null || !Number.isSafeInteger(numberOrNull(mix.daysEarly))) {
      globalWarnings.push(sourceWarning("make-ahead-window-missing",
        `${mix.name} has no valid make-ahead window.`, { mixCode: mix.code }));
    }
  }
  const uniqueWarnings = new Map();
  for (const warning of globalWarnings) {
    const key = `${warning.code}:${warning.mixCode ?? ""}:${warning.runId ?? ""}:${warning.productionDate ?? ""}`;
    if (!uniqueWarnings.has(key)) uniqueWarnings.set(key, warning);
  }
  return {
    makeDate,
    timeZone: SCHEDULE_TIME_ZONE,
    items,
    warnings: [...uniqueWarnings.values()].sort((a, b) => a.code.localeCompare(b.code)
      || String(a.mixCode ?? "").localeCompare(String(b.mixCode ?? ""))
      || String(a.runId ?? "").localeCompare(String(b.runId ?? ""))),
    coverage: {
      scheduledRunCount: scheduledRuns.length,
      activeRunCount: currentRuns.length,
      includedRunCount: new Set(items.flatMap((item) => item.contributingRuns.map((run) => run.runId))).size,
      enabledMixCount: mixes.filter((mix) => mix?.enabled === true).length,
    },
  };
}
