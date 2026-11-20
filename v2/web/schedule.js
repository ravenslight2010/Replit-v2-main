import {
  calculateScheduleTimeline,
  centralDate,
  SCHEDULE_TIME_ZONE,
} from "../core/schedule-planning.mjs";
import { refreshMixPlan } from "./mix-plan.js";

const API = "/api/v2/schedules";
const RUNS_API = "/api/v2/runs";
const CACHE_PREFIX = "fieldline:v2:schedule-cache:";
const PENDING_PREFIX = "fieldline:v2:schedule-pending:";
const POLL_MS = 10_000;

const byId = (id) => document.getElementById(id);
const dom = {
  panel: byId("schedule-tools"),
  status: byId("schedule-status"),
  alert: byId("schedule-alert"),
  date: byId("schedule-date"),
  refresh: byId("schedule-refresh"),
  retry: byId("schedule-retry"),
  revision: byId("schedule-revision"),
  add: byId("schedule-add"),
  runs: byId("schedule-runs"),
  empty: byId("schedule-empty"),
  swapFirst: byId("schedule-swap-first"),
  swapSecond: byId("schedule-swap-second"),
  swapButton: byId("schedule-swap-button"),
  timeline: byId("schedule-timeline"),
  timelineNote: byId("schedule-timeline-note"),
  finish: byId("schedule-finish"),
  liveRuns: byId("schedule-live-runs"),
  breaks: byId("schedule-breaks"),
  breakSave: byId("schedule-break-save"),
  importForm: byId("schedule-import-form"),
  importFile: byId("schedule-import-file"),
  importDate: byId("schedule-import-date"),
  importReview: byId("schedule-import-review"),
  importPreview: byId("schedule-import-preview"),
};

let staff = null;
let writeGate = false;
let catalog = null;
let schedule = null;
let liveRuns = [];
let importPreview = null;
let isLoading = false;
let requestInFlight = false;
let pollTimer = null;
let generation = 0;
let draftOverlay = null;

function setStatus(message) {
  dom.status.textContent = message;
}

function setAlert(message = "") {
  dom.alert.textContent = message;
  dom.alert.hidden = message.length === 0;
}

function csrfToken() {
  const pair = document.cookie.split("; ").find((part) => part.startsWith("v2_csrf="));
  return pair ? decodeURIComponent(pair.slice("v2_csrf=".length)) : "";
}

async function readJson(response) {
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error(response.ok ? "The schedule response was incomplete." : "The schedule request could not be completed.");
  }
  if (!response.ok) {
    const error = new Error(typeof body?.error === "string" ? body.error : "The schedule request could not be completed.");
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

function keyFor(prefix, date = dom.date.value) {
  return `${prefix}${staff?.userId ?? "unknown"}:${date}`;
}

function getPending(date = dom.date.value) {
  try {
    const value = JSON.parse(sessionStorage.getItem(keyFor(PENDING_PREFIX, date)) || "null");
    if (value && value.date === date && typeof value.requestId === "string" && value.command) return value;
  } catch {
    // A corrupt local draft is ignored; the server plan remains authoritative.
  }
  return null;
}

function savePending(value) {
  sessionStorage.setItem(keyFor(PENDING_PREFIX, value.date), JSON.stringify(value));
  updateControls();
}

function clearPending(date = dom.date.value) {
  sessionStorage.removeItem(keyFor(PENDING_PREFIX, date));
  updateControls();
}

function cacheKey(date = dom.date.value) {
  return `${CACHE_PREFIX}${staff?.userId ?? "unknown"}:${date}`;
}

function cacheConfirmedPlan(value) {
  try {
    const safeSchedule = {
      ...value,
      runs: value.runs.map((run) => ({ ...run, notes: "" })),
    };
    localStorage.setItem(cacheKey(value.date), JSON.stringify({
      schedule: safeSchedule,
      catalog: catalog ? {
        productionStartTime: catalog.productionStartTime,
        timeZone: catalog.timeZone,
        products: catalog.products.map((product) => ({
          code: product.code,
          name: product.name,
          productionSetups: product.productionSetups.map(({ code, name }) => ({ code, name })),
        })),
        templates: catalog.templates.map(({ code, name, brand, flavor, values }) => ({ code, name, brand, flavor, values })),
      } : null,
      cachedAt: new Date().toISOString(),
    }));
  } catch {
    // A full device cache must not prevent the canonical online save.
  }
}

function readCachedPlan(date) {
  try {
    const value = JSON.parse(localStorage.getItem(cacheKey(date)) || "null");
    return value?.schedule ? value : null;
  } catch {
    return null;
  }
}

function setWriteGate(value) {
  writeGate = value === true && navigator.onLine !== false && staff !== null;
  updateControls();
}

function updateControls() {
  const online = navigator.onLine !== false;
  const pending = getPending();
  for (const control of dom.panel.querySelectorAll("[data-schedule-write]")) {
    const row = control.closest(".schedule-run");
    const rowDirty = row?.dataset.dirty === "true";
    const isSave = control.dataset.action === "save-run";
    const isMove = control.dataset.action === "move-up" || control.dataset.action === "move-down";
    const boundary = control.dataset.boundary === "true";
    control.disabled = !writeGate || requestInFlight || isLoading || pending !== null
      || (isSave && row?.dataset.dirty !== "true")
      || (isMove && (rowDirty || boundary));
  }
  for (const control of dom.panel.querySelectorAll("[data-schedule-preview]")) {
    control.disabled = !online || !staff || requestInFlight;
  }
  dom.date.disabled = requestInFlight || isLoading;
  dom.refresh.disabled = !online || isLoading;
  dom.importDate.disabled = !online || isLoading;
  dom.importFile.disabled = !online || isLoading || requestInFlight;
  dom.retry.hidden = pending === null;
  dom.retry.textContent = pending?.command?.type === "merge-import" ? "Retry the same import" : "Retry the same save";
  dom.retry.disabled = !online || !writeGate || requestInFlight;
}

function hasScheduleDraft() {
  if (draftOverlay) return true;
  if (dom.runs.querySelector('.schedule-run[data-dirty="true"]')) return true;
  if (!schedule) return false;
  try {
    const current = collectBreaks();
    return JSON.stringify(current) !== JSON.stringify(schedule.breaks);
  } catch {
    return false;
  }
}

function addOption(select, value, label) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  select.append(option);
}

function makeSelect(labelText, items, selected, getValue, getLabel) {
  const label = document.createElement("label");
  label.className = "field";
  const title = document.createElement("span");
  title.textContent = labelText;
  const select = document.createElement("select");
  select.setAttribute("aria-label", labelText);
  select.required = true;
  addOption(select, "", `Choose ${labelText.toLocaleLowerCase()}`);
  for (const item of items) addOption(select, getValue(item), getLabel(item));
  select.value = selected || "";
  label.append(title, select);
  return { label, select };
}

function getProduct(code) {
  return catalog?.products?.find((product) => product.code === code);
}

function getSetup(productCode, code) {
  return getProduct(productCode)?.productionSetups?.find((setup) => setup.code === code);
}

function getTemplate(code) {
  return catalog?.templates?.find((template) => template.code === code);
}

function formatClock(epochMs) {
  if (!Number.isFinite(epochMs)) return "Unknown";
  return new Intl.DateTimeFormat(undefined, {
    timeZone: SCHEDULE_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(epochMs));
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "Unknown duration";
  const minutes = Math.round(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  if (hours === 0) return `${remaining} min`;
  return remaining ? `${hours} hr ${remaining} min` : `${hours} hr`;
}

function runTitle(run) {
  const product = getProduct(run.productCode);
  const setup = getSetup(run.productCode, run.productionSetupCode);
  const template = getTemplate(run.runTemplateCode);
  return `${product?.name ?? run.productCode} · ${setup?.name ?? run.productionSetupCode} · ${template?.name ?? run.runTemplateCode}`;
}

function setRowDraft(row, value) {
  const fields = {
    productCode: row.querySelector('[data-field="productCode"]'),
    productionSetupCode: row.querySelector('[data-field="productionSetupCode"]'),
    runTemplateCode: row.querySelector('[data-field="runTemplateCode"]'),
    targetCases: row.querySelector('[data-field="targetCases"]'),
    notes: row.querySelector('[data-field="notes"]'),
  };
  if (value.productCode !== undefined) fields.productCode.value = value.productCode;
  if (value.productionSetupCode !== undefined) fields.productionSetupCode.value = value.productionSetupCode;
  if (value.runTemplateCode !== undefined) fields.runTemplateCode.value = value.runTemplateCode;
  if (value.targetCases !== undefined) fields.targetCases.value = String(value.targetCases);
  if (value.notes !== undefined) fields.notes.value = value.notes;
}

function createRunCard(run, index, isNew = false) {
  const article = document.createElement("article");
  article.className = "schedule-run";
  article.dataset.runId = run.id;
  article.dataset.isNew = String(isNew);
  const heading = document.createElement("div");
  heading.className = "schedule-run-heading";
  const title = document.createElement("h4");
  title.textContent = isNew ? `New planned run ${index + 1}` : `Planned run ${index + 1}`;
  const order = document.createElement("span");
  order.className = "schedule-run-order";
  order.textContent = `Order ${index + 1}`;
  heading.append(title, order);
  const productField = makeSelect("Product", catalog.products, run.productCode, (item) => item.code, (item) => item.name);
  productField.select.dataset.field = "productCode";
  const setupItems = getProduct(run.productCode)?.productionSetups ?? [];
  const setupField = makeSelect("Production setup", setupItems, run.productionSetupCode, (item) => item.code, (item) => item.name);
  setupField.select.dataset.field = "productionSetupCode";
  const templateField = makeSelect(
    "Run template",
    catalog.templates,
    run.runTemplateCode,
    (item) => item.code,
    (item) => `${item.name}${item.brand || item.flavor ? ` · ${[item.brand, item.flavor].filter(Boolean).join(" ")}` : ""}`,
  );
  templateField.select.dataset.field = "runTemplateCode";
  const targetLabel = document.createElement("label");
  targetLabel.className = "field";
  const targetTitle = document.createElement("span");
  targetTitle.textContent = "Target cases";
  const target = document.createElement("input");
  target.type = "number";
  target.min = "1";
  target.max = "1000000";
  target.step = "1";
  target.required = true;
  target.value = run.targetCases ? String(run.targetCases) : "";
  target.dataset.field = "targetCases";
  target.setAttribute("aria-label", "Target cases");
  targetLabel.append(targetTitle, target);
  const notesLabel = document.createElement("label");
  notesLabel.className = "field schedule-notes-field";
  const notesTitle = document.createElement("span");
  notesTitle.textContent = "Notes";
  const notes = document.createElement("input");
  notes.type = "text";
  notes.maxLength = 500;
  notes.value = run.notes ?? "";
  notes.dataset.field = "notes";
  notes.setAttribute("aria-label", "Notes");
  notesLabel.append(notesTitle, notes);
  const actions = document.createElement("div");
  actions.className = "schedule-run-actions";
  const save = document.createElement("button");
  save.type = "button";
  save.className = "button button-primary button-small";
  save.textContent = isNew ? "Add to plan" : "Save run";
  save.dataset.action = "save-run";
  const moveUp = document.createElement("button");
  moveUp.type = "button";
  moveUp.className = "button button-secondary button-small";
  moveUp.textContent = "Move up";
  moveUp.setAttribute("aria-label", `Move planned run ${index + 1} up`);
  moveUp.dataset.action = "move-up";
  moveUp.disabled = isNew || index === 0;
  moveUp.dataset.boundary = String(index === 0);
  const moveDown = document.createElement("button");
  moveDown.type = "button";
  moveDown.className = "button button-secondary button-small";
  moveDown.textContent = "Move down";
  moveDown.setAttribute("aria-label", `Move planned run ${index + 1} down`);
  moveDown.dataset.action = "move-down";
  moveDown.disabled = isNew || index === schedule.runs.length - 1;
  moveDown.dataset.boundary = String(index === schedule.runs.length - 1);
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "button button-secondary button-small";
  remove.textContent = isNew ? "Discard draft" : "Remove run";
  remove.dataset.action = "remove-run";
  actions.append(save, moveUp, moveDown, remove);
  article.append(heading, productField.label, setupField.label, templateField.label, targetLabel, notesLabel, actions);
  article.dataset.dirty = String(isNew);
  if (draftOverlay?.runId === run.id) setRowDraft(article, draftOverlay.values);
  if (isNew) {
    productField.select.addEventListener("change", () => {
      const setups = getProduct(productField.select.value)?.productionSetups ?? [];
      setupField.select.replaceChildren();
      addOption(setupField.select, "", "Choose production setup");
      for (const item of setups) addOption(setupField.select, item.code, item.name);
    });
  }
  if (!isNew) {
    const initial = JSON.stringify(run);
    const checkDirty = () => {
      const current = {
        id: run.id,
        productCode: productField.select.value,
        productionSetupCode: setupField.select.value,
        runTemplateCode: templateField.select.value,
        targetCases: Number(target.value),
        notes: notes.value.trim(),
      };
      const dirty = JSON.stringify(current) !== initial;
      article.dataset.dirty = String(dirty);
      save.disabled = !dirty;
      moveUp.disabled = dirty || index === 0;
      moveDown.disabled = dirty || index === schedule.runs.length - 1;
      moveUp.dataset.boundary = String(index === 0);
      moveDown.dataset.boundary = String(index === schedule.runs.length - 1);
    };
    for (const input of [productField.select, setupField.select, templateField.select, target, notes]) {
      input.addEventListener("input", checkDirty);
      input.addEventListener("change", checkDirty);
    }
    productField.select.addEventListener("change", () => {
      const previous = setupField.select.value;
      const setups = getProduct(productField.select.value)?.productionSetups ?? [];
      setupField.select.replaceChildren();
      addOption(setupField.select, "", "Choose production setup");
      for (const item of setups) addOption(setupField.select, item.code, item.name);
      setupField.select.value = setups.some((item) => item.code === previous) ? previous : "";
      checkDirty();
    });
    if (draftOverlay?.runId === run.id) {
      const selectedProduct = productField.select.value;
      const setups = getProduct(selectedProduct)?.productionSetups ?? [];
      setupField.select.replaceChildren();
      addOption(setupField.select, "", "Choose production setup");
      for (const item of setups) addOption(setupField.select, item.code, item.name);
      setupField.select.value = draftOverlay.values.productionSetupCode ?? run.productionSetupCode;
      checkDirty();
    }
    save.disabled = true;
    if (draftOverlay?.runId === run.id) checkDirty();
  }
  for (const control of article.querySelectorAll("input,select,button")) control.dataset.scheduleWrite = "true";
  return article;
}

function renderSwapOptions() {
  const previousFirst = dom.swapFirst.value;
  const previousSecond = dom.swapSecond.value;
  dom.swapFirst.replaceChildren();
  dom.swapSecond.replaceChildren();
  addOption(dom.swapFirst, "", "Choose first run");
  addOption(dom.swapSecond, "", "Choose second run");
  for (const run of schedule?.runs ?? []) {
    const label = runTitle(run);
    addOption(dom.swapFirst, run.id, label);
    addOption(dom.swapSecond, run.id, label);
  }
  dom.swapFirst.dataset.scheduleWrite = "true";
  dom.swapSecond.dataset.scheduleWrite = "true";
  dom.swapButton.dataset.scheduleWrite = "true";
  if (schedule?.runs.some((run) => run.id === previousFirst)) dom.swapFirst.value = previousFirst;
  if (schedule?.runs.some((run) => run.id === previousSecond)) dom.swapSecond.value = previousSecond;
}

function renderBreaks() {
  dom.breaks.replaceChildren();
  if (!schedule) return;
  for (const item of schedule.breaks) {
    const row = document.createElement("div");
    row.className = "schedule-break-row";
    row.dataset.breakSlot = String(item.slot);
    const label = document.createElement("label");
    label.className = "schedule-break-toggle";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = item.enabled;
    checkbox.dataset.field = "enabled";
    checkbox.dataset.scheduleWrite = "true";
    const text = document.createElement("span");
    text.textContent = `Break ${item.slot} · 30 minutes`;
    label.append(checkbox, text);
    const select = document.createElement("select");
    select.setAttribute("aria-label", `Run after break ${item.slot}`);
    addOption(select, "", "Not assigned");
    for (const run of schedule.runs) addOption(select, run.id, runTitle(run));
    select.value = item.runId ?? "";
    select.dataset.field = "runId";
    select.dataset.scheduleWrite = "true";
    row.append(label, select);
    dom.breaks.append(row);
  }
}

function actualRunDate(run) {
  const value = run.startedAt ?? run.createdAt ?? run.updatedAt;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SCHEDULE_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(value));
  const date = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
  return `${date.year}-${date.month}-${date.day}`;
}

function renderLiveRuns() {
  dom.liveRuns.replaceChildren();
  const matching = liveRuns.filter((run) => actualRunDate(run) === dom.date.value);
  if (matching.length === 0) {
    const item = document.createElement("li");
    item.textContent = "No V2 live runs are recorded for this production date.";
    dom.liveRuns.append(item);
    return;
  }
  for (const run of matching) {
    const item = document.createElement("li");
    const title = document.createElement("strong");
    title.textContent = `${run.label || run.productCode || "Live run"} · ${String(run.status || "unknown").replaceAll("_", " ")}`;
    const detail = document.createElement("span");
    const actualTime = run.startedAt ? `Started ${formatClock(Date.parse(run.startedAt))}` : "Not started";
    detail.textContent = `${actualTime} · run ${String(run.id).slice(0, 8)}`;
    item.append(title, detail);
    dom.liveRuns.append(item);
  }
}

function renderTimeline() {
  dom.timeline.replaceChildren();
  dom.finish.textContent = "";
  if (!schedule || !catalog) return;
  const timeline = calculateScheduleTimeline(schedule, catalog.templates);
  const estimates = new Map(timeline.runs.map((item) => [item.runId, item]));
  for (const run of schedule.runs) {
    const estimate = estimates.get(run.id);
    const item = document.createElement("li");
    item.className = "schedule-timeline-item";
    const heading = document.createElement("strong");
    heading.textContent = `${runTitle(run)} · ${run.targetCases} cases`;
    const detail = document.createElement("span");
    const time = estimate?.startMs === undefined
      ? "Planned start unknown"
      : `Planned start ${formatClock(estimate.startMs)}${estimate.finishMs === undefined ? "" : ` · planned end ${formatClock(estimate.finishMs)}`}`;
    detail.textContent = `${time} · ${formatDuration(estimate?.durationSec)}`;
    item.append(heading, detail);
    dom.timeline.append(item);
    for (const plannedBreak of timeline.breaks.filter((entry) => entry.status !== "unassigned"
      && schedule.breaks.find((value) => value.slot === entry.slot)?.runId === run.id)) {
      const breakItem = document.createElement("li");
      breakItem.className = "schedule-timeline-break";
      breakItem.textContent = plannedBreak.startMs === undefined
        ? `Break ${plannedBreak.slot} · 30 minutes · time unknown`
        : `Break ${plannedBreak.slot} · ${formatClock(plannedBreak.startMs)}–${formatClock(plannedBreak.finishMs)}`;
      dom.timeline.append(breakItem);
    }
  }
  for (const item of timeline.breaks.filter((entry) => entry.status === "unassigned")) {
    const breakItem = document.createElement("li");
    breakItem.className = "schedule-timeline-break schedule-timeline-warning";
    breakItem.textContent = `Break ${item.slot} · 30 minutes · choose a planned run`;
    dom.timeline.append(breakItem);
  }
  if (!schedule.runs.length) {
    const item = document.createElement("li");
    item.textContent = "Add runs to estimate the planned timeline.";
    dom.timeline.append(item);
  }
  dom.finish.textContent = timeline.projectedFinishMs === undefined
    ? "Planned finish is unknown until every run has enough duration inputs and enabled breaks are assigned."
    : `Estimated planned finish: ${formatClock(timeline.projectedFinishMs)}. This is not an actual run completion time.`;
  dom.timelineNote.textContent = `Times use ${schedule.timeZone}. Estimates start at ${schedule.productionStartTime} unless production has already begun today. Missing inputs remain unknown.`;
  renderLiveRuns();
}

function renderSchedule() {
  if (!schedule || !catalog) return;
  dom.revision.textContent = `Confirmed revision ${schedule.revision}`;
  dom.runs.replaceChildren();
  dom.empty.hidden = schedule.runs.length > 0;
  schedule.runs.forEach((run, index) => dom.runs.append(createRunCard(run, index)));
  if (draftOverlay?.isNew) {
    dom.runs.append(createRunCard(draftOverlay.run, schedule.runs.length, true));
  }
  renderSwapOptions();
  renderBreaks();
  renderTimeline();
  updateControls();
}

function applyCachedSchedule(date) {
  const cache = readCachedPlan(date);
  if (!cache) return false;
  schedule = cache.schedule;
  catalog = cache.catalog ?? catalog;
  renderSchedule();
  setStatus(`Offline read-only view · last confirmed ${new Date(cache.cachedAt).toLocaleString()}. Customer and PO notes are not stored on this device.`);
  return true;
}

async function fetchCatalog(requestGeneration) {
  const response = await fetch(`${API}/catalog`, { credentials: "same-origin", headers: { Accept: "application/json" } });
  const body = await readJson(response);
  if (requestGeneration !== generation || !staff) return;
  if (!Array.isArray(body.products) || !Array.isArray(body.templates)) throw new Error("The schedule catalog could not be loaded.");
  catalog = body;
}

async function fetchCanonicalSchedule(date, requestGeneration) {
  const response = await fetch(`${API}?date=${encodeURIComponent(date)}`, {
    credentials: "same-origin",
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  const body = await readJson(response);
  if (requestGeneration !== generation || !staff) return;
  schedule = body.schedule;
  cacheConfirmedPlan(schedule);
  renderSchedule();
}

async function fetchLiveRuns(requestGeneration) {
  const response = await fetch(`${RUNS_API}?limit=100`, {
    credentials: "same-origin",
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  const body = await readJson(response);
  if (requestGeneration !== generation || !staff) return;
  liveRuns = Array.isArray(body.runs) ? body.runs : [];
  renderLiveRuns();
}

async function loadCanonical({ quiet = false } = {}) {
  if (!staff) return;
  if (navigator.onLine === false) {
    applyCachedSchedule(dom.date.value);
    setWriteGate(false);
    return;
  }
  const requestGeneration = generation;
  isLoading = true;
  updateControls();
  if (!quiet) setStatus("Loading the server schedule…");
  try {
    const results = await Promise.allSettled([
      catalog ? Promise.resolve() : fetchCatalog(requestGeneration),
      fetchCanonicalSchedule(dom.date.value, requestGeneration),
      fetchLiveRuns(requestGeneration),
    ]);
    if (requestGeneration !== generation || !staff) return;
    const scheduleLoaded = results[1].status === "fulfilled";
    const catalogLoaded = results[0].status === "fulfilled";
    const failed = results.find((result) => result.status === "rejected");
    if (!scheduleLoaded || !catalogLoaded) {
      if (scheduleLoaded) {
        setStatus("The server plan loaded, but the setup catalog is unavailable. Editing is paused until refresh.");
        setAlert(failed?.reason?.message || "Schedule catalog unavailable.");
        setWriteGate(false);
      } else {
        const cached = applyCachedSchedule(dom.date.value);
        setStatus(cached
          ? `The server could not be reached. Showing the last confirmed read-only plan. ${failed?.reason?.message || ""}`
          : failed?.reason?.message || "The schedule could not be loaded.");
        setAlert(cached ? "" : "No confirmed plan is cached for this date. Reconnect to view the server schedule.");
        setWriteGate(false);
      }
      return;
    }
    if (!schedule || !catalog) throw new Error("The confirmed schedule is incomplete.");
    cacheConfirmedPlan(schedule);
    if (failed) setAlert("The schedule is current. The separate live-run list could not be refreshed.");
    else setAlert("");
    setStatus(`Server schedule loaded · ${schedule.timeZone}. Live runs are shown separately.`);
    setWriteGate(writeGate);
    renderSchedule();
  } catch (error) {
    if (requestGeneration !== generation || !staff) return;
    setStatus(error instanceof Error ? error.message : "The schedule could not be loaded.");
    setWriteGate(false);
  } finally {
    isLoading = false;
    updateControls();
  }
}

async function sendPending(pending) {
  if (requestInFlight || navigator.onLine === false || !writeGate) return;
  requestInFlight = true;
  updateControls();
  setAlert("");
  setStatus("Saving the schedule change…");
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${API}/commands`, {
      method: "POST",
      credentials: "same-origin",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken() },
      body: JSON.stringify(pending),
    });
    const body = await response.json().catch(() => ({}));
    if (response.status === 409) {
      clearPending(pending.date);
      if (body.schedule) {
        schedule = body.schedule;
        cacheConfirmedPlan(schedule);
      } else {
        await fetchCanonicalSchedule(pending.date, generation);
      }
      draftOverlay = pending.command.type === "add"
        ? { isNew: true, run: pending.command.run }
        : pending.command.type === "update"
          ? { runId: pending.command.runId, values: pending.command.changes }
          : null;
      renderSchedule();
      setAlert("Another manager changed this date. The latest confirmed plan is loaded; this change was not saved. Review and submit it again if it is still wanted.");
      setStatus("Schedule conflict · the latest server plan remains confirmed.");
      refreshMixPlan();
      return;
    }
    if (!response.ok) {
      const error = new Error(typeof body?.error === "string" ? body.error : "The schedule change could not be saved.");
      error.status = response.status;
      if (response.status < 500) clearPending(pending.date);
      throw error;
    }
    if (body.outcome !== "accepted" || !body.schedule) {
      const error = new Error("The server did not confirm the schedule change.");
      error.status = 502;
      throw error;
    }
    clearPending(pending.date);
    if (body.replayed) {
      await fetchCanonicalSchedule(pending.date, generation);
      setStatus("The previous save was confirmed. The current server plan has been reloaded.");
    } else {
      schedule = body.schedule;
      cacheConfirmedPlan(schedule);
      renderSchedule();
      setStatus("Schedule change saved to the server.");
    }
    draftOverlay = null;
    setAlert("");
    refreshMixPlan();
  } catch (error) {
    if (error?.status === 401) {
      setWriteGate(false);
      setAlert("Your manager session expired. Sign in again; the same request is retained for safe retry.");
    } else if (error?.status === 409) {
      clearPending(pending.date);
      await fetchCanonicalSchedule(pending.date, generation).catch(() => {});
      setAlert(error.message || "Review the latest plan before retrying this schedule change.");
      setStatus("Schedule conflict · no stale change was applied.");
      renderSchedule();
      refreshMixPlan();
    } else if (error?.status >= 400 && error?.status < 500) {
      clearPending(pending.date);
      setAlert(error instanceof Error ? error.message : "The schedule change was rejected.");
    } else if (error?.status >= 500 || error?.name === "AbortError" || !error?.status) {
      setAlert("The save was not confirmed. Retry the same request; its request ID prevents duplicate changes.");
      setStatus(error?.name === "AbortError" ? "Schedule save timed out." : "Schedule save not confirmed.");
    } else {
      setAlert(error instanceof Error ? error.message : "The schedule change could not be saved.");
    }
  } finally {
    window.clearTimeout(timeout);
    requestInFlight = false;
    updateControls();
  }
}

function createPending(command, date = schedule.date) {
  return {
    requestId: crypto.randomUUID(),
    date,
    expectedRevision: schedule.revision,
    command,
  };
}

function submitCommand(command) {
  if (!schedule || !writeGate || requestInFlight) return;
  const pending = createPending(command);
  try {
    savePending(pending);
    void sendPending(pending);
  } catch {
    setAlert("This device could not retain the pending request. No change was sent; check browser storage and try again.");
  }
}

function formRun(row) {
  const productCode = row.querySelector('[data-field="productCode"]').value;
  const productionSetupCode = row.querySelector('[data-field="productionSetupCode"]').value;
  const runTemplateCode = row.querySelector('[data-field="runTemplateCode"]').value;
  const targetValue = row.querySelector('[data-field="targetCases"]').value;
  const notes = row.querySelector('[data-field="notes"]').value.trim();
  if (!productCode || !productionSetupCode || !runTemplateCode || !targetValue) {
    throw new Error("Choose a product, production setup, run template, and target cases.");
  }
  const targetCases = Number(targetValue);
  if (!Number.isSafeInteger(targetCases) || targetCases < 1 || targetCases > 1_000_000) {
    throw new Error("Target cases must be a whole number from 1 to 1,000,000.");
  }
  if (!getProduct(productCode)?.productionSetups?.some((item) => item.code === productionSetupCode)) {
    throw new Error("Choose a production setup for the selected product.");
  }
  if (!getTemplate(runTemplateCode)) throw new Error("Choose an available run template.");
  return { productCode, productionSetupCode, runTemplateCode, targetCases, notes };
}

function handleRunClick(event) {
  const button = event.target.closest("[data-action]");
  const row = event.target.closest(".schedule-run");
  if (!button || !row) return;
  const id = row.dataset.runId;
  const index = schedule.runs.findIndex((run) => run.id === id);
  if (button.dataset.action === "remove-run" && row.dataset.isNew === "true") {
    draftOverlay = null;
    renderSchedule();
    return;
  }
  if (button.dataset.action === "remove-run") {
    if (!window.confirm("Remove this planned run from the selected date?")) return;
    submitCommand({ type: "remove", runId: id });
    return;
  }
  if (button.dataset.action === "move-up" || button.dataset.action === "move-down") {
    submitCommand({ type: "move", runId: id, toIndex: index + (button.dataset.action === "move-up" ? -1 : 1) });
    return;
  }
  if (button.dataset.action === "save-run") {
    try {
      const fields = formRun(row);
      if (row.dataset.isNew === "true") {
        submitCommand({ type: "add", run: { id: crypto.randomUUID(), ...fields } });
        draftOverlay = null;
      } else {
        const existing = schedule.runs[index];
        const changes = Object.fromEntries(Object.entries(fields).filter(([key, value]) => existing[key] !== value));
        if (Object.keys(changes).length > 0) submitCommand({ type: "update", runId: id, changes });
      }
    } catch (error) {
      setAlert(error instanceof Error ? error.message : "Check the planned-run fields.");
    }
  }
}

function collectBreaks() {
  return [...dom.breaks.querySelectorAll(".schedule-break-row")].map((row, index) => ({
    slot: index + 1,
    enabled: row.querySelector('[data-field="enabled"]').checked,
    runId: row.querySelector('[data-field="runId"]').value || null,
  }));
}

function makeLabel(text) {
  const label = document.createElement("label");
  label.className = "field";
  const title = document.createElement("span");
  title.textContent = text;
  const select = document.createElement("select");
  label.append(title, select);
  return { label, select };
}

function rowProductCandidates(row) {
  const name = `${row.brand} ${row.flavor}`.trim().toLocaleLowerCase("en-US");
  const flavor = row.flavor.trim().toLocaleLowerCase("en-US");
  return catalog.products.filter((product) => [product.name, product.code].some((value) => value.trim().toLocaleLowerCase("en-US") === name)
    || product.name.trim().toLocaleLowerCase("en-US") === flavor);
}

function rowTemplateCandidates(row) {
  const brand = row.brand.trim().toLocaleLowerCase("en-US");
  const flavor = row.flavor.trim().toLocaleLowerCase("en-US");
  return catalog.templates.filter((template) => (template.brand ?? "").trim().toLocaleLowerCase("en-US") === brand
    && (template.flavor ?? "").trim().toLocaleLowerCase("en-US") === flavor);
}

function renderImportRow(imported, index, date) {
  const article = document.createElement("article");
  article.className = "schedule-import-row";
  article.dataset.importIndex = String(index);
  const heading = document.createElement("h5");
  heading.textContent = `${imported.brand}${imported.flavor ? ` · ${imported.flavor}` : ""}`;
  const source = document.createElement("p");
  source.className = "schedule-import-source";
  source.textContent = `${imported.sheet} · row ${imported.sourceRow}${imported.sourceCells?.brand ? ` · ${imported.sourceCells.brand}` : ""}${date ? ` · ${date}` : ""}`;
  const productMatches = rowProductCandidates(imported);
  const product = makeLabel(`Product · ${productMatches.length === 1 ? "one exact name match" : productMatches.length > 1 ? `${productMatches.length} exact matches; choose one` : "choose manually"}`);
  product.select.dataset.importField = "productCode";
  addOption(product.select, "", "Choose product");
  for (const item of catalog.products) addOption(product.select, item.code, `${item.name} (${item.code})`);
  if (productMatches.length === 1) product.select.value = productMatches[0].code;
  imported.productCode = product.select.value;
  const setups = makeLabel("Production setup");
  setups.select.dataset.importField = "productionSetupCode";
  const templates = makeLabel(`Run template · ${rowTemplateCandidates(imported).length === 1 ? "one exact name match" : "choose manually"}`);
  templates.select.dataset.importField = "runTemplateCode";
  addOption(templates.select, "", "Choose run template");
  for (const template of catalog.templates) {
    addOption(templates.select, template.code, `${template.name}${template.brand || template.flavor ? ` · ${[template.brand, template.flavor].filter(Boolean).join(" ")}` : ""}`);
  }
  const templateMatches = rowTemplateCandidates(imported);
  if (templateMatches.length === 1) templates.select.value = templateMatches[0].code;
  imported.runTemplateCode = templates.select.value;
  const target = makeLabel("Target cases");
  target.select.remove();
  const targetInput = document.createElement("input");
  targetInput.type = "number";
  targetInput.min = "1";
  targetInput.max = "1000000";
  targetInput.step = "1";
  targetInput.value = imported.targetCases > 0 ? String(imported.targetCases) : "";
  targetInput.dataset.importField = "targetCases";
  targetInput.setAttribute("aria-label", "Target cases");
  target.label.append(targetInput);
  imported.targetCases = targetInput.value ? Number(targetInput.value) : null;
  const notes = document.createElement("label");
  notes.className = "field";
  const notesTitle = document.createElement("span");
  notesTitle.textContent = "Customer, PO, ship-date notes";
  const notesInput = document.createElement("input");
  notesInput.type = "text";
  notesInput.maxLength = 500;
  notesInput.value = imported.notes ?? "";
  notesInput.dataset.importField = "notes";
  notesInput.setAttribute("aria-label", "Customer, PO, ship-date notes");
  notes.append(notesTitle, notesInput);
  const feedback = document.createElement("p");
  feedback.className = "schedule-import-row-status";
  feedback.setAttribute("role", "status");
  const updateFeedback = () => {
    const issues = [];
    if (!imported.productCode) {
      issues.push(productMatches.length > 1 ? "Choose one of multiple product matches." : "Choose a product.");
    }
    if (!imported.productionSetupCode) issues.push("Choose a production setup.");
    if (!imported.runTemplateCode) {
      issues.push(templateMatches.length > 1 ? "Choose one of multiple template matches." : "Choose a run template.");
    }
    if (!Number.isSafeInteger(imported.targetCases) || imported.targetCases < 1) {
      issues.push("Enter a positive whole-number target.");
    }
    feedback.textContent = issues.length ? issues.join(" ") : "Ready to add to the selected production date.";
  };
  const updateSetups = () => {
    const productData = getProduct(product.select.value);
    setups.select.replaceChildren();
    addOption(setups.select, "", "Choose production setup");
    for (const item of productData?.productionSetups ?? []) addOption(setups.select, item.code, `${item.name} (${item.code})`);
    if (!productData?.productionSetups?.some((item) => item.code === imported.productionSetupCode)) {
      imported.productionSetupCode = "";
    }
    setups.select.value = imported.productionSetupCode ?? "";
  };
  product.select.addEventListener("change", () => {
    imported.productCode = product.select.value;
    imported.productionSetupCode = "";
    updateSetups();
    updateFeedback();
  });
  setups.select.addEventListener("change", () => {
    imported.productionSetupCode = setups.select.value;
    updateFeedback();
  });
  templates.select.addEventListener("change", () => {
    imported.runTemplateCode = templates.select.value;
    updateFeedback();
  });
  targetInput.addEventListener("input", () => {
    imported.targetCases = targetInput.value ? Number(targetInput.value) : null;
    updateFeedback();
  });
  notesInput.addEventListener("input", () => { imported.notes = notesInput.value; });
  updateSetups();
  updateFeedback();
  article.append(heading, source, product.label, setups.label, templates.label, target.label, notes, feedback);
  return article;
}

function importRowsForDate(date) {
  if (!importPreview) return [];
  return importPreview.rows
    .filter((row) => (importPreview.multiDay ? row.date : (dom.importDate.value || dom.date.value)) === date)
    .map((row) => ({
      ...row,
      productCode: row.productCode ?? "",
      productionSetupCode: row.productionSetupCode ?? "",
      runTemplateCode: row.runTemplateCode ?? "",
      notes: row.notes ?? "",
    }));
}

function renderImportPreview() {
  dom.importPreview.replaceChildren();
  if (!importPreview || !catalog) {
    dom.importPreview.hidden = true;
    updateControls();
    return;
  }
  dom.importPreview.hidden = false;
  const summary = document.createElement("p");
  summary.textContent = `${importPreview.rows.length} schedule row(s) found · ${importPreview.errors.length} issue(s) · ${importPreview.skipped.length} skipped row(s). Review each date separately.`;
  dom.importPreview.append(summary);
  if (!importPreview.multiDay) {
    dom.importDate.required = importPreview.rows.length > 0;
    if (!dom.importDate.value) dom.importDate.value = dom.date.value || centralDate();
  } else {
    dom.importDate.required = false;
  }
  for (const issue of importPreview.errors) {
    const paragraph = document.createElement("p");
    paragraph.className = "schedule-import-issue";
    paragraph.textContent = `Issue · ${issue.sheet} · row ${issue.rowNumber}${issue.date ? ` · ${issue.date}` : ""}: ${issue.message}`;
    dom.importPreview.append(paragraph);
  }
  for (const item of importPreview.skipped) {
    const paragraph = document.createElement("p");
    paragraph.className = "schedule-import-skipped";
    paragraph.textContent = `Skipped · ${item.sheet} · row ${item.rowNumber}${item.date ? ` · ${item.date}` : ""}: ${item.reason}`;
    dom.importPreview.append(paragraph);
  }
  const dates = [...new Set(importPreview.rows.map((row) => importPreview.multiDay ? row.date : (dom.importDate.value || dom.date.value)))].filter(Boolean).sort();
  if (!dates.length) {
    const message = document.createElement("p");
    message.textContent = "No rows can be applied. Review the issues or select a supported workbook.";
    dom.importPreview.append(message);
    updateControls();
    return;
  }
  for (const date of dates) {
    const group = document.createElement("section");
    group.className = "schedule-import-date-group";
    const heading = document.createElement("h4");
    heading.textContent = `Production date · ${date}`;
    const rows = importRowsForDate(date);
    const list = document.createElement("div");
    list.className = "schedule-import-rows";
    rows.forEach((row, index) => list.append(renderImportRow(row, index, date)));
    const apply = document.createElement("button");
    apply.type = "button";
    apply.className = "button button-primary";
    apply.textContent = `Apply ${rows.length} reviewed run(s) to ${date}`;
    apply.dataset.importApplyDate = date;
    apply.dataset.scheduleWrite = "true";
    apply.addEventListener("click", () => applyReviewedDate(date, rows));
    group.append(heading, list, apply);
    dom.importPreview.append(group);
  }
  updateControls();
}

function validateImportedRows(rows) {
  for (const [index, row] of rows.entries()) {
    if (!row.importRunId || !row.productCode || !row.productionSetupCode || !row.runTemplateCode
      || !Number.isSafeInteger(Number(row.targetCases)) || Number(row.targetCases) < 1) {
      throw new Error(`Review row ${row.rowNumber ?? index + 1}: choose a product, setup, template, and positive whole-case target.`);
    }
    if (!getProduct(row.productCode)?.productionSetups?.some((setup) => setup.code === row.productionSetupCode)) {
      throw new Error(`Review row ${row.rowNumber}: choose a setup for the selected product.`);
    }
    if (!getTemplate(row.runTemplateCode)) throw new Error(`Review row ${row.rowNumber}: choose an available run template.`);
    if (typeof row.notes !== "string" || row.notes.length > 500) throw new Error(`Review row ${row.rowNumber}: notes are too long.`);
  }
}

async function applyReviewedDate(date, rows) {
  if (!schedule || schedule.date !== date) {
    dom.date.value = date;
    await loadCanonical();
    setAlert(`The server plan for ${date} is loaded. Review it, then apply the workbook rows again if still correct.`);
    return;
  }
  try {
    validateImportedRows(rows);
  } catch (error) {
    setAlert(error instanceof Error ? error.message : "Review the imported rows.");
    return;
  }
  const runs = rows.map((row) => ({
    id: row.importRunId,
    productCode: row.productCode,
    productionSetupCode: row.productionSetupCode,
    runTemplateCode: row.runTemplateCode,
    targetCases: Number(row.targetCases),
    notes: row.notes,
  }));
  submitCommand({ type: "merge-import", runs });
}

async function reviewWorkbook(event) {
  event.preventDefault();
  if (!staff || navigator.onLine === false || !dom.importFile.files?.[0]) return;
  const file = dom.importFile.files[0];
  if (file.size > 5 * 1024 * 1024) {
    setAlert("Choose an XLSX workbook no larger than 5 MiB.");
    return;
  }
  requestInFlight = true;
  updateControls();
  setAlert("");
  setStatus("Reviewing workbook contents. Nothing will be applied yet.");
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15_000);
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + chunkSize)));
    }
    const response = await fetch(`${API}/import-preview`, {
      method: "POST",
      credentials: "same-origin",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken() },
      body: JSON.stringify({ fileName: file.name, workbookBase64: btoa(binary) }),
    });
    const body = await readJson(response);
    importPreview = body.preview;
    if (!importPreview.multiDay && !dom.importDate.value) dom.importDate.value = dom.date.value;
    renderImportPreview();
    setStatus("Workbook reviewed. Nothing has been applied; choose mappings and apply each date separately.");
  } catch (error) {
    const message = error?.name === "AbortError"
      ? "Workbook review timed out. No schedule changes were made; try again."
      : error instanceof Error ? error.message : "The workbook could not be reviewed.";
    setAlert(message);
    setStatus("Workbook review failed. No schedule changes were made.");
  } finally {
    window.clearTimeout(timeout);
    requestInFlight = false;
    updateControls();
  }
}

async function retryPending() {
  const pending = getPending();
  if (pending) void sendPending(pending);
}

function bind() {
  dom.date.addEventListener("change", () => {
    if (!dom.date.value) return;
    if (hasScheduleDraft() && !window.confirm("Discard unsaved schedule edits on this device and load another date?")) {
      dom.date.value = schedule?.date ?? centralDate();
      return;
    }
    generation += 1;
    draftOverlay = null;
    loadCanonical();
  });
  dom.refresh.addEventListener("click", () => {
    if (hasScheduleDraft() && !window.confirm("Reloading replaces unsaved schedule edits on this device. Continue?")) return;
    draftOverlay = null;
    void loadCanonical();
  });
  dom.add.addEventListener("click", () => {
    if (!schedule || !writeGate || draftOverlay?.isNew) return;
    draftOverlay = {
      isNew: true,
      run: { id: crypto.randomUUID(), productCode: "", productionSetupCode: "", runTemplateCode: "", targetCases: 0, notes: "" },
    };
    renderSchedule();
    dom.runs.querySelector('[data-is-new="true"] [data-field="productCode"]')?.focus();
  });
  dom.add.dataset.scheduleWrite = "true";
  dom.breakSave.dataset.scheduleWrite = "true";
  dom.importReview.dataset.schedulePreview = "true";
  dom.importFile.dataset.schedulePreview = "true";
  dom.importDate.dataset.schedulePreview = "true";
  dom.runs.addEventListener("click", handleRunClick);
  dom.swapButton.addEventListener("click", () => {
    if (dom.swapFirst.value && dom.swapSecond.value) {
      submitCommand({ type: "swap", firstRunId: dom.swapFirst.value, secondRunId: dom.swapSecond.value });
    } else {
      setAlert("Choose two planned runs to swap.");
    }
  });
  dom.breakSave.addEventListener("click", () => submitCommand({ type: "breaks", breaks: collectBreaks() }));
  dom.importForm.addEventListener("submit", reviewWorkbook);
  dom.retry.addEventListener("click", retryPending);
  dom.importDate.addEventListener("change", () => {
    if (importPreview && !importPreview.multiDay) renderImportPreview();
  });
  window.addEventListener("online", () => {
    setWriteGate(false);
    setStatus("Connection restored. Reloading the canonical server schedule…");
    void loadCanonical();
  });
  window.addEventListener("offline", () => {
    setWriteGate(false);
    applyCachedSchedule(dom.date.value);
    setAlert("Disconnected: schedules are read-only. Reconnect to load the latest server plan.");
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && staff && navigator.onLine !== false && !hasScheduleDraft()) void loadCanonical({ quiet: true });
  });
}

export function updateScheduleContext(nextStaff, writable) {
  const changedUser = staff?.userId !== nextStaff?.userId;
  staff = nextStaff;
  if (changedUser) generation += 1;
  if (!staff || !staff.capabilities?.includes("manage-factory-settings")) {
    writeGate = false;
    schedule = null;
    catalog = null;
    liveRuns = [];
    importPreview = null;
    draftOverlay = null;
    dom.panel.hidden = true;
    dom.runs.replaceChildren();
    dom.timeline.replaceChildren();
    dom.liveRuns.replaceChildren();
    dom.importPreview.replaceChildren();
    window.clearInterval(pollTimer);
    return;
  }
  dom.panel.hidden = false;
  if (changedUser || !dom.date.value) dom.date.value = centralDate();
  if (changedUser) {
    schedule = null;
    catalog = null;
    liveRuns = [];
    importPreview = null;
    draftOverlay = null;
    dom.importPreview.replaceChildren();
    dom.importPreview.hidden = true;
  }
  writeGate = writable === true && navigator.onLine !== false;
  const needsLoad = changedUser || !schedule || schedule.date !== dom.date.value || !catalog;
  updateControls();
  if (navigator.onLine === false) {
    applyCachedSchedule(dom.date.value);
  } else if (needsLoad) {
    void loadCanonical();
  }
  window.clearInterval(pollTimer);
  pollTimer = window.setInterval(() => {
    if (staff && !document.hidden && navigator.onLine !== false && !requestInFlight && !isLoading && !hasScheduleDraft()) {
      void loadCanonical({ quiet: true });
    }
  }, POLL_MS);
}

bind();
