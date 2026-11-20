import { centralDate, isValidProductionDate } from "../core/schedule-planning.mjs";

const API = "/api/v2/mix-plan";
const CACHE_PREFIX = "fieldline:v2:mix-plan:";
const POLL_MS = 10_000;
const byId = (id) => document.getElementById(id);
const dom = {
  panel: byId("mix-plan"),
  date: byId("mix-plan-date"),
  refresh: byId("mix-plan-refresh"),
  state: byId("mix-plan-state"),
  alert: byId("mix-plan-alert"),
  warnings: byId("mix-plan-warnings"),
  list: byId("mix-plan-list"),
  empty: byId("mix-plan-empty"),
  links: byId("mix-plan-links"),
  recipesLink: byId("mix-plan-recipes-link"),
  inventoryLink: byId("mix-plan-inventory-link"),
  scheduleNav: byId("schedule-nav-link"),
  setupNav: byId("setup-nav-link"),
};

let staff = null;
let serverConfirmed = false;
let plan = null;
let generatedAt = null;
let isLoading = false;
let generation = 0;
let lastLoadedAt = 0;
let pollTimer = null;
let refreshQueued = false;
let awaitingReconnect = false;

function hasRunReadAccess(value) {
  return value?.verified !== false && Array.isArray(value?.capabilities)
    && ["run.read", "manage-inventory", "manage-factory-settings"]
      .some((capability) => value.capabilities.includes(capability));
}

function cacheKey(date = dom.date.value) {
  return `${CACHE_PREFIX}${staff?.userId ?? "unknown"}:${date}`;
}

function validPlan(value, date) {
  const nullableNumber = (number) => number === null
    || (typeof number === "number" && Number.isFinite(number));
  const validWarnings = (warnings) => Array.isArray(warnings) && warnings.length <= 2000
    && warnings.every((warning) => warning && typeof warning.code === "string"
      && typeof warning.message === "string");
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && value.makeDate === date && isValidProductionDate(value.makeDate)
    && value.timeZone === "America/Chicago"
    && Array.isArray(value.items) && value.items.length <= 1000
    && validWarnings(value.warnings)
    && value.coverage && ["scheduledRunCount", "activeRunCount", "includedRunCount", "enabledMixCount"]
      .every((key) => Number.isSafeInteger(value.coverage[key]) && value.coverage[key] >= 0)
    && value.items.every((item) => item && typeof item.mixCode === "string"
      && typeof item.mixName === "string" && ["per-pizza", "per-batch"].includes(item.mode)
      && item.preparationDate === date && nullableNumber(item.batchSizeLbs)
      && nullableNumber(item.batchEquivalent) && nullableNumber(item.totalQuantity)
      && (item.totalUnit === null || typeof item.totalUnit === "string")
      && Array.isArray(item.components) && item.components.length <= 200
      && item.components.every((component) => component && typeof component.name === "string"
        && nullableNumber(component.amount) && nullableNumber(component.inventoryQuantity)
        && (component.ingredientCode === null || typeof component.ingredientCode === "string")
        && (component.unit === null || typeof component.unit === "string")
        && (component.inventoryUnit === null || typeof component.inventoryUnit === "string"))
      && Array.isArray(item.contributingRuns) && item.contributingRuns.length <= 1000
      && item.contributingRuns.every((run) => run && typeof run.runId === "string"
        && typeof run.label === "string" && ["scheduled", "running", "paused"].includes(run.status)
        && isValidProductionDate(run.productionDate))
      && validWarnings(item.warnings));
}

function readCache(date) {
  try {
    const saved = JSON.parse(localStorage.getItem(cacheKey(date)) || "null");
    if (saved && validPlan(saved.plan, date) && typeof saved.generatedAt === "string"
      && !Number.isNaN(Date.parse(saved.generatedAt))) {
      return saved;
    }
  } catch {
    // A corrupt or unavailable browser cache never replaces server state.
  }
  return null;
}

function writeCache(value) {
  try {
    localStorage.setItem(cacheKey(value.plan.makeDate), JSON.stringify(value));
  } catch {
    // Browser storage is optional; a confirmed server plan remains usable.
  }
}

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = String(text);
  return element;
}

function formatQuantity(value, maximumFractionDigits = 3) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "Not calculated";
  return new Intl.NumberFormat(undefined, { maximumFractionDigits }).format(value);
}

function formatDate(value) {
  if (!isValidProductionDate(value)) return value || "Unknown date";
  return new Intl.DateTimeFormat(undefined, {
    timeZone: "UTC", weekday: "short", month: "short", day: "numeric", year: "numeric",
  }).format(new Date(`${value}T12:00:00Z`));
}

function warningList(warnings, { item = false } = {}) {
  const list = node("ul", item ? "mix-plan-item-warnings" : "mix-plan-global-warnings");
  for (const warning of warnings) {
    const li = node("li", "", warning.message);
    li.dataset.warningCode = warning.code || "warning";
    list.append(li);
  }
  return list;
}

function renderItem(item) {
  const article = node("article", "mix-plan-card");
  article.dataset.mixCode = item.mixCode;
  const heading = node("div", "mix-plan-card-heading");
  const title = node("div");
  title.append(node("p", "eyebrow", item.mode === "per-batch" ? "PREP MIX · SAVED BATCH FORMULA" : "RECIPE MIX · OUNCES PER PIZZA"));
  title.append(node("h3", "", item.mixName));
  const quantity = node("div", "mix-plan-total");
  quantity.append(node("span", "eyebrow", item.mode === "per-batch" ? "RUN DEMAND" : "KNOWN INGREDIENT NEED"));
  quantity.append(node("strong", "", item.totalQuantity === null
    ? "Needs incomplete"
    : `${formatQuantity(item.totalQuantity)} ${item.totalUnit || ""}`.trim()));
  if (item.batchEquivalent !== null) {
    quantity.append(node("span", "", `${formatQuantity(item.batchEquivalent)} batch equivalents`));
  }
  heading.append(title, quantity);
  article.append(heading);

  if (item.batchSizeLbs !== null) {
    article.append(node("p", "mix-plan-batch-note", `Saved batch size: ${formatQuantity(item.batchSizeLbs)} lb`));
  } else if (item.mode === "per-batch") {
    article.append(node("p", "mix-plan-batch-note", "Batch size is not set."));
  }

  const componentHeading = node("h4", "mix-plan-subheading", "Ingredient quantities");
  article.append(componentHeading);
  const tableWrap = node("div", "mix-plan-table-wrap");
  const table = node("table", "mix-plan-table");
  table.append(node("caption", "visually-hidden", `${item.mixName} ingredient quantities`));
  const thead = node("thead");
  const headerRow = node("tr");
  for (const label of ["Ingredient", "Need", "Inventory mapping"]) {
    headerRow.append(node("th", "", label));
  }
  thead.append(headerRow);
  table.append(thead);
  const tbody = node("tbody");
  for (const component of item.components) {
    const row = node("tr");
    row.append(node("th", "", component.name));
    const need = component.amount === null
      ? "Not calculated"
      : `${formatQuantity(component.amount)} ${component.unit || ""}`.trim();
    row.append(node("td", "", need));
    const inventory = component.inventoryQuantity === null
      ? (component.ingredientCode ? "Link or conversion unavailable" : "No ingredient link")
      : `${formatQuantity(component.inventoryQuantity)} ${component.inventoryUnit}`;
    row.append(node("td", "", inventory));
    tbody.append(row);
  }
  table.append(tbody);
  tableWrap.append(table);
  article.append(tableWrap);

  article.append(node("h4", "mix-plan-subheading", "Contributing runs"));
  const runs = node("ul", "mix-plan-run-list");
  for (const run of item.contributingRuns) {
    const detail = [
      formatDate(run.productionDate),
      run.status === "scheduled" ? "Scheduled" : `Active · ${run.status}`,
      run.cases === null || run.cases === undefined ? null : `${formatQuantity(run.cases, 0)} cases`,
      run.pizzas === null || run.pizzas === undefined ? null : `${formatQuantity(run.pizzas, 0)} pizzas`,
      run.productName || run.productCode,
    ].filter(Boolean).join(" · ");
    const li = node("li");
    li.append(node("strong", "", run.label), node("span", "", detail));
    runs.append(li);
  }
  article.append(runs);
  if (item.warnings.length > 0) article.append(warningList(item.warnings, { item: true }));
  return article;
}

function render() {
  dom.alert.hidden = true;
  dom.warnings.replaceChildren();
  dom.list.replaceChildren();
  const cached = !serverConfirmed && navigator.onLine === false ? readCache(dom.date.value) : null;
  const displayedPlan = cached?.plan ?? plan;
  const displayedAt = cached?.generatedAt ?? generatedAt;
  if (cached) {
    dom.state.textContent = `Offline · showing the last server-confirmed plan from ${new Date(displayedAt).toLocaleString()}. Read-only.`;
  } else if (serverConfirmed && generatedAt) {
    dom.state.textContent = `Server-confirmed ${new Date(generatedAt).toLocaleTimeString()} · ${displayedPlan?.coverage?.scheduledRunCount ?? 0} scheduled and ${displayedPlan?.coverage?.activeRunCount ?? 0} active runs checked.`;
  } else if (plan && generatedAt) {
    dom.state.textContent = `Showing a prior server-confirmed plan from ${new Date(generatedAt).toLocaleString()}; refresh when connected.`;
  } else if (isLoading) {
    dom.state.textContent = "Loading the current server plan…";
  } else if (navigator.onLine === false) {
    dom.state.textContent = "Offline · no saved plan is available for this date.";
  } else {
    dom.state.textContent = "Load the server plan to view current needs.";
  }
  dom.refresh.disabled = isLoading || navigator.onLine === false || !staff;
  dom.date.disabled = isLoading || !staff;
  if (!displayedPlan) {
    dom.empty.hidden = true;
    return;
  }
  if (displayedPlan.warnings.length > 0) {
    dom.warnings.append(warningList(displayedPlan.warnings));
  }
  for (const item of displayedPlan.items) dom.list.append(renderItem(item));
  dom.empty.hidden = displayedPlan.items.length > 0;
}

async function load({ force = false } = {}) {
  if (!staff || !serverConfirmed || navigator.onLine === false || isLoading || !isValidProductionDate(dom.date.value)) return;
  if (!force && Date.now() - lastLoadedAt < POLL_MS) return;
  const requestGeneration = generation;
  isLoading = true;
  render();
  try {
    const response = await fetch(`${API}?makeDate=${encodeURIComponent(dom.date.value)}`, {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    let body;
    try {
      body = await response.json();
    } catch {
      throw new Error("The mix plan response could not be read.");
    }
    if (!response.ok) {
      throw new Error(typeof body?.error === "string" ? body.error : "The mix plan could not be loaded.");
    }
    if (requestGeneration !== generation || !staff) return;
    if (!body || !validPlan(body.plan, dom.date.value)
      || typeof body.generatedAt !== "string" || Number.isNaN(Date.parse(body.generatedAt))) {
      throw new Error("The server returned an incomplete mix plan. Refresh to try again.");
    }
    plan = body.plan;
    generatedAt = body.generatedAt;
    lastLoadedAt = Date.now();
    writeCache(body);
    dom.alert.hidden = true;
  } catch (error) {
    if (requestGeneration !== generation) return;
    dom.alert.textContent = error instanceof Error ? error.message : "The mix plan could not be loaded. Refresh to try again.";
    dom.alert.hidden = false;
  } finally {
    isLoading = false;
    render();
    if (refreshQueued && staff && serverConfirmed && navigator.onLine !== false) {
      refreshQueued = false;
      void load({ force: true });
    }
  }
}

export function refreshMixPlan() {
  if (!staff || !serverConfirmed || navigator.onLine === false) return;
  lastLoadedAt = 0;
  if (isLoading) {
    refreshQueued = true;
    return;
  }
  void load({ force: true });
}

function updateNavigation(value) {
  const capabilities = Array.isArray(value?.capabilities) ? value.capabilities : [];
  dom.scheduleNav.hidden = !capabilities.includes("manage-factory-settings");
  dom.setupNav.hidden = !capabilities.includes("manage-inventory");
  dom.links.hidden = !capabilities.includes("manage-inventory");
  dom.recipesLink.hidden = !capabilities.includes("manage-inventory");
  dom.inventoryLink.hidden = !capabilities.includes("manage-inventory");
}

export function updateMixPlanContext(nextStaff, confirmed) {
  const changedUser = staff?.userId !== nextStaff?.userId;
  staff = nextStaff;
  if (changedUser) {
    generation += 1;
    plan = null;
    generatedAt = null;
    lastLoadedAt = 0;
  }
  serverConfirmed = confirmed === true;
  const canRead = hasRunReadAccess(staff);
  dom.panel.hidden = !canRead;
  updateNavigation(canRead ? staff : null);
  if (!canRead) {
    plan = null;
    generatedAt = null;
    window.clearInterval(pollTimer);
    render();
    return;
  }
  if (changedUser || !dom.date.value) dom.date.value = centralDate();
  if (navigator.onLine === false) {
    awaitingReconnect = true;
    const cached = readCache(dom.date.value);
    plan = cached?.plan ?? null;
    generatedAt = cached?.generatedAt ?? null;
  } else if (serverConfirmed
    && (changedUser || !plan || awaitingReconnect || Date.now() - lastLoadedAt >= POLL_MS)) {
    const force = changedUser || awaitingReconnect;
    awaitingReconnect = false;
    void load({ force });
  }
  window.clearInterval(pollTimer);
  pollTimer = window.setInterval(() => {
    if (staff && serverConfirmed && !document.hidden && navigator.onLine !== false) void load();
  }, POLL_MS);
  render();
}

dom.date.value = centralDate();
dom.date.addEventListener("change", () => {
  generation += 1;
  plan = null;
  generatedAt = null;
  lastLoadedAt = 0;
  if (navigator.onLine === false) {
    const cached = readCache(dom.date.value);
    plan = cached?.plan ?? null;
    generatedAt = cached?.generatedAt ?? null;
    render();
  } else {
    void load({ force: true });
  }
});
dom.refresh.addEventListener("click", () => void load({ force: true }));
dom.recipesLink.addEventListener("click", () => {
  const family = byId("setup-catalog-family");
  family.value = "mixes";
  family.dispatchEvent(new Event("change", { bubbles: true }));
});
window.addEventListener("online", () => {
  if (staff && serverConfirmed) void load({ force: true });
});
window.addEventListener("offline", () => {
  serverConfirmed = false;
  awaitingReconnect = true;
  const cached = readCache(dom.date.value);
  plan = cached?.plan ?? plan;
  generatedAt = cached?.generatedAt ?? generatedAt;
  render();
});
window.addEventListener("focus", () => {
  if (staff && serverConfirmed) void load({ force: true });
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && staff && serverConfirmed) void load({ force: true });
});

render();
