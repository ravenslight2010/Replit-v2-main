import {
  openingCountCsvTemplate,
  renderImportCsvTemplate,
  setupImportCsvTemplates,
} from "../core/import-csv-templates.mjs";
import { DIE_DEFAULT_FIELDS, REQUIRED_DIE_DEFAULT_FIELDS, isDieLineSettings } from "../core/die-defaults.mjs";
import { updateSetupCatalogContext } from "./setup-catalog.js";

const IMPORTS = "/api/v2/imports";
const INVENTORY = "/api/v2/inventory";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CODE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const QTY = /^-?(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,6})?$/;
const PENDING_KEY = "fieldline:v2:inventory-pending";
const IMPORT_KINDS = new Set(["products", "recipes", "production-setups"]);
const WORKBOOK_IMPORT_FAMILIES = new Set(["dough-procedure", "shipping-guide"]);
const MAX_WORKBOOK_BYTES = 5 * 1024 * 1024;
const DIE_DEFAULTS = `${INVENTORY}/die-defaults`;

const byId = (id) => document.getElementById(id);
const dom = {
  panel: byId("manager-tools"), error: byId("manager-error"),
  importForm: byId("setup-import-form"), importKind: byId("import-kind"), importFile: byId("import-file"),
  workbookForm: byId("capacity-workbook-form"), workbookFamily: byId("capacity-workbook-family"),
  workbookFile: byId("capacity-workbook-file"), workbookRetry: byId("capacity-workbook-retry"),
  workbookPreview: byId("capacity-workbook-preview"), workbookActions: byId("capacity-workbook-actions"),
  workbookStage: byId("capacity-workbook-stage"), workbookApply: byId("capacity-workbook-apply"),
  templateColumns: byId("csv-template-columns"), templateDownload: byId("csv-template-download"),
  openingTemplateDownload: byId("opening-count-template-download"),
  importPreview: byId("import-preview"), importActions: byId("import-actions"),
  importApply: byId("import-apply-button"), importRetry: byId("import-retry-button"), importHistory: byId("import-history"),
  warehouseForm: byId("warehouse-create-form"), warehouseName: byId("warehouse-name"), warehouseSelect: byId("warehouse-select"),
  productionWarehouse: byId("production-warehouse-select"), productionWarehouseSet: byId("production-warehouse-set"),
  productionWarehouseStatus: byId("production-warehouse-status"),
  stockRows: byId("stock-rows"), stockEmpty: byId("stock-empty"), movementHistory: byId("movement-history"),
  movementMore: byId("movement-load-more"), lotHistory: byId("lot-history"),
  movementForm: byId("movement-form"), movementType: byId("movement-type"), movementProduct: byId("movement-product"),
  movementQuantity: byId("movement-quantity"), movementReason: byId("movement-reason"),
  movementLot: byId("movement-lot"), movementSource: byId("movement-source"),
  transferForm: byId("transfer-form"), transferFrom: byId("transfer-from"), transferTo: byId("transfer-to"),
  transferProduct: byId("transfer-product"), transferQuantity: byId("transfer-quantity"), transferReason: byId("transfer-reason"),
  openingForm: byId("opening-count-form"), openingWarehouse: byId("opening-warehouse"), openingFile: byId("opening-count-file"),
  openingRetry: byId("opening-count-retry"), openingPreview: byId("opening-count-preview"), openingActions: byId("opening-count-actions"),
  openingReview: byId("opening-count-mark-reviewed"), openingApply: byId("opening-count-apply"),
  openingHistory: byId("opening-count-history"),
  dieDefaultForm: byId("die-default-form"), dieDefaultType: byId("die-default-type"),
  dieDefaultState: byId("die-default-state"), dieDefaultSuggestion: byId("die-default-use-suggestion"),
  dieDefaultRetire: byId("die-default-retire"), dieDefaultHistory: byId("die-default-history"),
  prepLinkForm: byId("preparation-link-form"), prepLinkKind: byId("preparation-link-kind"),
  prepLinkSource: byId("preparation-link-source"), prepLinkProduct: byId("preparation-link-product"),
  prepLinkRate: byId("preparation-link-rate"), prepLinkStatus: byId("preparation-link-status"),
  prepForm: byId("preparation-form"), prepMix: byId("preparation-mix"),
  prepSourceWarehouse: byId("preparation-source-warehouse"), prepOutputWarehouse: byId("preparation-output-warehouse"),
  prepBatches: byId("preparation-batches"), prepLot: byId("preparation-lot"),
  prepSource: byId("preparation-source"), prepReason: byId("preparation-reason"),
  prepReadiness: byId("preparation-readiness"), prepHistory: byId("preparation-history"),
  cycleForm: byId("cycle-count-form"), cycleWarehouse: byId("cycle-count-warehouse"),
  cycleFile: byId("cycle-count-file"), cycleReason: byId("cycle-count-reason"),
  cyclePreview: byId("cycle-count-preview"), cycleActions: byId("cycle-count-actions"),
  cycleReview: byId("cycle-count-review"), cycleApply: byId("cycle-count-apply"),
  cycleHistory: byId("cycle-count-history"),
};

let staff = null;
let writeGate = false;
let imports = [];
let warehouses = [];
let products = [];
let stock = [];
let movements = [];
let movementNextCursor = null;
let movementWarehouseId = null;
let openingCounts = [];
let dieDefaults = [];
let dieDefaultHistory = [];
let currentCount = null;
let preparationSetup = { ingredients: [], mixes: [] };
let preparations = [];
let cycleCounts = [];
let currentCycleCount = null;
let pending = loadPending();
let loading = false;
let inFlight = false;
let workbookPreparing = false;
let workbookDraft = null;
let lastConfirmed = false;

function object(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function uuid(value) { return typeof value === "string" && UUID.test(value); }
function uuidOrNull(value) { return value === null || uuid(value); }
function text(value, max = 500) { return typeof value === "string" && value.length <= max; }
function quantity(value, allowNegative = false) {
  return typeof value === "string" && QTY.test(value) && (allowNegative || !value.startsWith("-"));
}
function unitRate(value) {
  return typeof value === "string"
    && /^(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,8})?$/u.test(value)
    && Number(value) > 0;
}
function announce(message) {
  const live = byId("live-announcer");
  if (live) { live.textContent = ""; window.setTimeout(() => { live.textContent = message; }, 20); }
}
function message(textValue, kind = "info") {
  dom.error.textContent = textValue;
  dom.error.dataset.kind = kind;
  dom.error.hidden = !textValue;
  if (textValue) announce(textValue);
}
function clearMessage() { message(""); }
function make(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined) node.textContent = String(value);
  return node;
}
function actionButton(label, handler, className = "button button-secondary") {
  const button = make("button", className, label);
  button.type = "button";
  button.dataset.actionControl = "true";
  button.disabled = !writeGate || !lastConfirmed || inFlight;
  button.addEventListener("click", handler);
  return button;
}
function listNotice(list, value) {
  list.replaceChildren();
  const li = make("li", "manager-list-notice", value);
  list.append(li);
}
function safeDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Time unavailable" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}
function csrfHeaders() {
  try {
    const matches = document.cookie.split(";").map((item) => item.trim()).filter((item) => item.startsWith("v2_csrf="));
    if (matches.length !== 1) return null;
    const token = matches[0].slice(8);
    return /^[A-Za-z0-9_-]{43}$/.test(token) ? { "X-CSRF-Token": token } : null;
  } catch { return null; }
}
function loadPending() {
  try {
    const value = JSON.parse(localStorage.getItem(PENDING_KEY) || "null");
    if (!object(value) || !uuid(value.actorId) || !text(value.kind, 40) || !object(value.payload)
      || !validPendingRoute(value.kind, value.endpoint)) return null;
    return value;
  } catch { return null; }
}
function validPendingRoute(kind, endpoint) {
  if (typeof endpoint !== "string") return false;
  if (kind === "setup-import") return endpoint === IMPORTS;
  if (kind === "workbook-import") return endpoint === `${IMPORTS}/workbooks`;
  if (kind === "warehouse-create") return endpoint === `${INVENTORY}/warehouses`;
  if (kind === "production-warehouse") return endpoint === `${INVENTORY}/production-warehouse`;
  if (kind === "movement") return endpoint === `${INVENTORY}/movements`;
  if (kind === "transfer") return endpoint === `${INVENTORY}/transfers`;
  if (kind === "opening-count") return endpoint === `${INVENTORY}/opening-counts`;
  if (kind === "die-default") return endpoint === DIE_DEFAULTS;
  if (kind === "cycle-count") return endpoint === `${INVENTORY}/cycle-counts`;
  if (kind === "prep-link") return endpoint === `${INVENTORY}/preparation-links`;
  if (kind === "prep-run") return endpoint === `${INVENTORY}/preparations`;
  if (kind === "import-apply" || kind === "import-undo") {
    return new RegExp(`^${IMPORTS}/[0-9a-f-]{36}/${kind.slice(7)}$`, "i").test(endpoint);
  }
  if (kind === "count-review" || kind === "count-apply") {
    return new RegExp(`^${INVENTORY}/opening-counts/[0-9a-f-]{36}/${kind.slice(6)}$`, "i").test(endpoint);
  }
  if (kind === "cycle-review" || kind === "cycle-apply") {
    return new RegExp(`^${INVENTORY}/cycle-counts/[0-9a-f-]{36}/${kind.slice(6)}$`, "i").test(endpoint);
  }
  return false;
}
function persistPending(value) {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(value));
    pending = value;
    return true;
  } catch {
    message("This device could not save a retry identity. No request was sent; check storage and try again.", "error");
    return false;
  }
}
function clearPending() {
  try { localStorage.removeItem(PENDING_KEY); pending = null; }
  catch { message("The server replied, but this device could not clear the saved retry identity. Refresh before making another change.", "error"); }
}
function ensureWrite() {
  if (!staff || !staff.capabilities?.includes("manage-inventory")) {
    message("A manager account with inventory access is required.", "error"); return false;
  }
  if (!writeGate || !lastConfirmed) { message("Read-only until the server confirms a fresh run state and current manager inventory. Refresh, then retry.", "error"); return false; }
  if (!csrfHeaders()) { message("The secure session token is unavailable. Refresh your session before changing inventory.", "error"); return false; }
  return true;
}
class RequestError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
async function request(path, { method = "GET", body, allowEmpty = false } = {}) {
  const headers = { Accept: "application/json" };
  const options = { method, credentials: "same-origin", headers };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    Object.assign(headers, csrfHeaders() || {});
    options.body = JSON.stringify(body);
  }
  let response;
  try { response = await fetch(path, options); }
  catch { throw new Error("Connection lost before the server confirmed the request. Retry the same saved request."); }
  if (allowEmpty && response.status === 204) return {};
  let data;
  try { data = await response.json(); }
  catch { throw new Error("The server response could not be read. The result is not confirmed; retry the same request."); }
  if (!response.ok) {
    const serverMessage = object(data) && text(data.error, 500) ? data.error : "";
    const fallback = response.status === 409
      ? "The inventory changed or conflicts with a floor rule. Refresh and review the current server state."
      : response.status === 400 ? "Check the highlighted values and correct the request."
        : response.status === 401 ? "Your session expired. Sign in again as the original staff member."
          : response.status === 403 ? "Manager access or a fresh secure session is required."
            : "The server did not accept this request. Retry the same request only after reviewing its status.";
    throw new RequestError(response.status, serverMessage || fallback);
  }
  if (!object(data)) throw new Error("The server returned an unexpected response. The result is not confirmed; retry the same request.");
  return data;
}
function validateRecord(record, importKind = null) {
  if (!object(record) || !text(record.code, 80) || !CODE.test(record.code) || !text(record.name, 120)) return false;
  if (record.kind !== undefined && (!text(record.kind, 40) || importKind && record.kind !== importKind)) return false;
  const kind = importKind || record.kind;
  if (kind === "products") return text(record.unit, 16);
  return text(record.productCode, 80) && CODE.test(record.productCode) && object(record.data);
}
function validateImport(item) {
  return object(item) && uuid(item.id) && IMPORT_KINDS.has(item.kind) && text(item.status, 40)
    && uuid(item.createdBy) && uuidOrNull(item.appliedBy) && uuidOrNull(item.undoneBy)
    && (Array.isArray(item.records)
      ? item.records.length <= 2000 && item.records.every((record) => validateRecord(record, item.kind))
      : Number.isSafeInteger(item.rowCount) && item.rowCount >= 1 && item.rowCount <= 2000)
    && (item.createdAt === undefined || text(item.createdAt, 40));
}
function validateWarehouse(item) {
  return object(item) && uuid(item.id) && text(item.name, 120) && typeof item.active === "boolean"
    && typeof item.openingCountApplied === "boolean"
    && (item.isProduction === undefined || typeof item.isProduction === "boolean");
}
function validateProduct(item) {
  return object(item) && CODE.test(item.code) && text(item.name, 120) && text(item.unit, 16);
}
function validateStock(item) {
  return object(item) && uuid(item.productId) && CODE.test(item.code) && text(item.name, 120)
    && text(item.unit, 16) && quantity(item.quantity) && quantity(item.stagedQuantity)
    && quantity(item.availableQuantity) && quantity(item.lotQuantity)
    && Number.isSafeInteger(item.revision) && item.revision >= 0;
}
function validateMovement(item) {
  return object(item) && text(item.type, 40) && quantity(item.quantityDelta, true)
    && text(item.reason, 500) && uuid(item.actorId) && text(item.occurredAt, 40)
    && text(item.lotNumber, 120) && text(item.sourceReference, 200)
    && Array.isArray(item.lotAllocations) && item.lotAllocations.every((allocation) =>
      object(allocation) && uuid(allocation.lotId) && text(allocation.lotNumber, 120)
        && quantity(allocation.quantityDelta, true));
}
function validateMovementCursor(value) {
  return value === null || object(value) && uuid(value.id) && text(value.occurredAt, 40);
}
function validateLot(item) {
  return object(item) && uuid(item.id) && uuid(item.productId) && CODE.test(item.productCode)
    && text(item.productName, 120) && text(item.unit, 16) && text(item.lotNumber, 120)
    && text(item.sourceReference, 200) && text(item.receivedAt, 40)
    && quantity(item.quantityReceived) && quantity(item.quantityRemaining)
    && uuidOrNull(item.sourceLotId);
}
function validateCount(item) {
  return object(item) && uuid(item.id) && uuid(item.warehouseId) && text(item.status, 40)
    && uuid(item.createdBy) && uuidOrNull(item.reviewedBy) && uuidOrNull(item.appliedBy)
    && Array.isArray(item.rows) && item.rows.length <= 2000
    && item.rows.every((row) => object(row) && CODE.test(row.productCode) && quantity(row.quantity));
}
function validateCountSummary(item) {
  return object(item) && uuid(item.id) && uuid(item.warehouseId) && text(item.warehouseName, 120)
    && uuid(item.createdBy) && uuidOrNull(item.reviewedBy) && uuidOrNull(item.appliedBy)
    && ["staged", "reviewed", "applied"].includes(item.status)
    && Number.isSafeInteger(item.rowCount) && item.rowCount >= 1 && item.rowCount <= 2000
    && text(item.createdAt, 40);
}
function validateCycleSummary(item) {
  return object(item) && uuid(item.id) && uuid(item.warehouseId) && text(item.warehouseName, 120)
    && ["staged", "reviewed", "applied", "stale"].includes(item.status)
    && Number.isSafeInteger(item.rowCount) && item.rowCount > 0 && item.rowCount <= 2000
    && uuid(item.createdBy) && uuidOrNull(item.reviewedBy) && uuidOrNull(item.appliedBy)
    && text(item.createdAt, 40);
}
function validateCycleCount(item) {
  return object(item) && uuid(item.id) && uuid(item.warehouseId)
    && ["staged", "reviewed", "applied", "stale"].includes(item.status)
    && Array.isArray(item.rows) && item.rows.length > 0 && item.rows.length <= 2000
    && item.rows.every((row) => object(row) && CODE.test(row.productCode)
      && quantity(row.quantity) && quantity(row.baselineQuantity)
      && (row.baselineRevision === undefined || Number.isSafeInteger(row.baselineRevision)))
    && uuid(item.createdBy) && uuidOrNull(item.reviewedBy) && uuidOrNull(item.appliedBy);
}
function validatePreparation(item) {
  return object(item) && uuid(item.id) && CODE.test(item.mixCode) && text(item.mixName, 120)
    && uuid(item.sourceWarehouseId) && text(item.sourceWarehouseName, 120)
    && uuid(item.outputWarehouseId) && text(item.outputWarehouseName, 120)
    && quantity(item.batchCount) && CODE.test(item.preparedProductCode)
    && text(item.preparedProductName, 120) && text(item.preparedUnit, 16)
    && quantity(item.preparedQuantity) && text(item.lotNumber, 120)
    && text(item.sourceReference, 200) && text(item.reason, 500)
    && uuid(item.actorId) && text(item.occurredAt, 40) && Array.isArray(item.components);
}
function setBusy(busy) {
  inFlight = busy;
  [dom.importApply, dom.workbookStage, dom.workbookApply, ...dom.importForm.querySelectorAll("button"),
    ...dom.workbookForm.querySelectorAll("button"), ...dom.warehouseForm.querySelectorAll("button"),
    ...dom.movementForm.querySelectorAll("button"), ...dom.transferForm.querySelectorAll("button"),
    ...dom.openingForm.querySelectorAll("button"), ...dom.dieDefaultForm.querySelectorAll("button"),
    ...dom.prepLinkForm.querySelectorAll("button"), ...dom.prepForm.querySelectorAll("button"),
    ...dom.cycleForm.querySelectorAll("button"),
    dom.openingReview, dom.openingApply, dom.cycleReview, dom.cycleApply].filter(Boolean)
    .forEach((button) => { button.disabled = busy || (button.dataset.requiresWrite === "true" && !writeGate); });
  updateReadOnly();
}
function updateReadOnly() {
  const writable = writeGate && lastConfirmed && staff?.capabilities?.includes("manage-inventory") === true;
  updateSetupCatalogContext(staff, writable);
  dom.panel.dataset.mode = writable ? "writable" : "readonly";
  dom.panel.querySelectorAll("input,select,button").forEach((control) => {
    if (control.dataset.preservePending === "true") return;
    if (control.dataset.actionControl === "true") control.disabled = !writable || inFlight;
  });
  if (!writable) dom.panel.setAttribute("aria-label", "Manager workspace, read-only until fresh server confirmation");
  else dom.panel.setAttribute("aria-label", "Manager workspace");
  renderPending();
  updateStockWriteState();
}
function renderPending() {
  const owned = pending && pending.actorId === staff?.userId;
  if (pending && !owned) {
    message("An unconfirmed inventory request belongs to another staff account. Sign in as its original manager to retry; it will not be resent under this account.", "warning");
  }
  dom.importRetry.hidden = !(pending && pending.kind === "setup-import" && owned);
  dom.workbookRetry.hidden = !(pending && pending.kind === "workbook-import" && owned);
  dom.openingRetry.hidden = !(pending && pending.kind === "opening-count" && owned);
  const existing = dom.error.querySelector("[data-retry-pending]");
  if (existing) existing.remove();
  if (pending && owned) {
    if (dom.error.hidden) message("An inventory request needs confirmation. Retry the same saved request; do not submit a duplicate.", "warning");
    if (!["setup-import", "opening-count", "workbook-import"].includes(pending.kind)) {
      const retry = actionButton("Retry saved request", retrySavedRequest, "button button-secondary button-small pending-retry");
      retry.dataset.retryPending = "true";
      retry.disabled = !writeGate || !lastConfirmed || inFlight;
      dom.error.append(retry);
    }
  }
}
function updateTemplates() {
  const template = setupImportCsvTemplates[dom.importKind.value];
  if (!template) {
    dom.templateColumns.textContent = "";
    dom.templateDownload.hidden = true;
    return;
  }
  dom.templateColumns.textContent = `Columns: ${template.headers.join(", ")}. `;
  updateTemplateDownload(dom.templateDownload, template);
  dom.templateDownload.hidden = false;
}
function updateTemplateDownload(link, template) {
  if (link.dataset.objectUrl) URL.revokeObjectURL(link.dataset.objectUrl);
  const objectUrl = URL.createObjectURL(new Blob([renderImportCsvTemplate(template)], { type: "text/csv;charset=utf-8" }));
  link.dataset.objectUrl = objectUrl;
  link.href = objectUrl;
  link.download = template.fileName;
}
function renderImports() {
  dom.importHistory.replaceChildren();
  if (!imports.length) { listNotice(dom.importHistory, "No setup imports recorded yet."); return; }
  imports.forEach((item) => {
    const li = make("li", "manager-list-item");
    const details = make("div", "manager-list-copy");
    details.append(make("strong", "", `${item.kind} · ${item.status}`));
    details.append(make("span", "", `${item.records?.length ?? item.rowCount} records · manager ${item.createdBy.slice(0, 8)}${item.createdAt ? ` · ${safeDate(item.createdAt)}` : ""}`));
    li.append(details);
    const actions = make("div", "manager-list-actions");
    if (item.status === "staged") {
      actions.append(actionButton("Review", () => { void openImport(item.id); }, "button button-secondary button-small"));
    }
    if (item.status === "applied") actions.append(actionButton("Undo", () => actOnImport(item, "undo"), "button button-secondary button-small"));
    li.append(actions);
    dom.importHistory.append(li);
  });
}
function validDieDefaults(value) {
  return object(value)
    && Object.keys(value).sort().join("\u0000") === [...DIE_DEFAULT_FIELDS].sort().join("\u0000")
    && isDieLineSettings(value)
    && REQUIRED_DIE_DEFAULT_FIELDS.every((key) => typeof value[key] === "number");
}
function validateDieType(item) {
  return object(item) && CODE.test(item.code) && text(item.name, 120) && item.name.length > 0
    && ["active", "disabled", "unreviewed"].includes(item.status)
    && Number.isSafeInteger(item.revision) && item.revision >= 0
    && (item.defaults === null || validDieDefaults(item.defaults))
    && (item.suggestedDefaults === null || validDieDefaults(item.suggestedDefaults));
}
function validateDieDefaultHistory(item) {
  return object(item) && uuid(item.id) && CODE.test(item.dieCode) && uuid(item.actorId)
    && ["created", "updated", "retired", "re-enabled"].includes(item.action)
    && Number.isSafeInteger(item.revision) && item.revision > 0
    && (item.before === null || object(item.before)) && object(item.after)
    && text(item.occurredAt, 40);
}
function setManagerDieFields(value) {
  for (const key of DIE_DEFAULT_FIELDS) {
    const input = dom.dieDefaultForm.querySelector(`[data-manager-die-field="${key}"]`);
    const item = value?.[key];
    input.value = typeof item === "number" && Number.isFinite(item) ? String(item) : "";
  }
}
function selectedManagerDie() {
  return dieDefaults.find((item) => item.code === dom.dieDefaultType.value) || null;
}
function renderDieDefaults() {
  const selectedCode = dom.dieDefaultType.value;
  dom.dieDefaultType.replaceChildren(new Option("Choose a die type", ""));
  for (const die of dieDefaults) {
    dom.dieDefaultType.append(new Option(`${die.name} · ${die.status}`, die.code));
  }
  if (dieDefaults.some((die) => die.code === selectedCode)) dom.dieDefaultType.value = selectedCode;
  const selected = selectedManagerDie();
  if (selected) {
    dom.dieDefaultState.textContent = selected.status === "unreviewed"
      ? selected.suggestedDefaults
        ? "Not reviewed. Imported values are available as a suggestion but are not used by operators."
        : "Not reviewed. Enter all required values; optional times may remain blank."
      : `Revision ${selected.revision} is ${selected.status}. Saving records your reviewed values and actor.`;
    dom.dieDefaultSuggestion.hidden = !selected.suggestedDefaults;
    dom.dieDefaultRetire.hidden = selected.status !== "active";
    if (selected.defaults) setManagerDieFields(selected.defaults);
    else setManagerDieFields(null);
  } else {
    dom.dieDefaultState.textContent = "Choose a die type to review its values.";
    dom.dieDefaultSuggestion.hidden = true;
    dom.dieDefaultRetire.hidden = true;
    setManagerDieFields(null);
  }
  if (dieDefaultHistory.length) {
    dom.dieDefaultHistory.replaceChildren(...dieDefaultHistory.map((item) => {
      const li = make("li", "manager-list-item");
      const heading = make("strong", "", `${item.action} · ${item.dieCode} · revision ${item.revision}`);
      const details = make("span", "manager-list-meta", `${safeDate(item.occurredAt)} · manager ${item.actorId}`);
      li.append(heading, details);
      return li;
    }));
  } else listNotice(dom.dieDefaultHistory, "No reviewed die-default changes yet.");
}
function readManagerDieFields() {
  const values = {};
  for (const key of DIE_DEFAULT_FIELDS) {
    const input = dom.dieDefaultForm.querySelector(`[data-manager-die-field="${key}"]`);
    if (input.value === "") {
      values[key] = null;
    } else {
      const parsed = Number(input.value);
      if (!Number.isFinite(parsed) || parsed < 0) throw new Error("Enter non-negative numbers or leave optional times blank.");
      values[key] = parsed;
    }
  }
  if (REQUIRED_DIE_DEFAULT_FIELDS.some((key) => typeof values[key] !== "number")) {
    throw new Error("Enter values for all five required die fields.");
  }
  return values;
}
function validDieDefaultResult(value) {
  return object(value) && ["created", "updated", "retired", "re-enabled"].includes(value.outcome)
    && CODE.test(value.dieCode) && Number.isSafeInteger(value.revision) && value.revision > 0
    && ["active", "disabled"].includes(value.status) && validDieDefaults(value.defaults)
    && typeof value.replayed === "boolean";
}
async function saveDieDefault(enabled) {
  if (!ensureWrite()) return;
  const selected = selectedManagerDie();
  if (!selected) { message("Choose a catalog die type first.", "warning"); return; }
  let values;
  try {
    values = enabled ? readManagerDieFields() : selected.defaults;
    if (!validDieDefaults(values)) throw new Error("Reviewed defaults are missing or invalid. Refresh the manager data.");
  } catch (error) {
    message(error instanceof Error ? error.message : "Die defaults are invalid.", "warning");
    return;
  }
  await operation({
    kind: "die-default",
    endpoint: DIE_DEFAULTS,
    payload: {
      requestId: crypto.randomUUID(),
      dieCode: selected.code,
      expectedRevision: selected.revision,
      defaults: values,
      enabled,
    },
    validate: validDieDefaultResult,
    refresh: async () => { await loadAll(); },
    label: enabled ? "Reviewed die defaults" : "Die defaults retirement",
  });
}
function useDieDefaultSuggestion() {
  const selected = selectedManagerDie();
  if (selected?.suggestedDefaults) setManagerDieFields(selected.suggestedDefaults);
}
function renderPreview(container, records, label) {
  container.replaceChildren();
  container.hidden = false;
  const heading = make("strong", "", label);
  const summary = make("p", "preview-summary", `${records.length} server-confirmed records`);
  const list = make("ul", "preview-records");
  records.slice(0, 12).forEach((record) => {
    const line = make("li");
    line.append(make("span", "preview-code", record.code), make("span", "", record.name));
    const details = record.unit
      ? `Unit: ${record.unit}`
      : record.data
        ? `Product: ${record.productCode} · ${JSON.stringify(record.data).slice(0, 500)}`
        : "";
    if (details) line.append(make("span", "preview-detail", details));
    list.append(line);
  });
  container.append(heading, summary, list);
  if (records.length > 12) container.append(make("p", "manager-help", `${records.length - 12} more records are included in the staged server import.`));
}
function renderWarehouses() {
  const active = warehouses.filter((item) => item.active);
  const selected = dom.warehouseSelect.value || active[0]?.id || "";
  const fill = (select, preferred = selected) => {
    const old = preferred;
    select.replaceChildren();
    active.forEach((item) => {
      const option = make("option", "", item.name);
      option.value = item.id;
      select.append(option);
    });
    if (active.some((item) => item.id === old)) select.value = old;
    else if (active[0]) select.value = active[0].id;
  };
  fill(dom.warehouseSelect, selected);
  fill(dom.transferFrom, selected);
  fill(dom.transferTo, active.find((item) => item.id !== dom.transferFrom.value)?.id || "");
  const counted = active.filter((item) => item.openingCountApplied);
  const productionPreferred = counted.some((item) => item.id === dom.productionWarehouse.value)
    ? dom.productionWarehouse.value
    : counted.find((item) => item.isProduction)?.id || counted[0]?.id || "";
  dom.productionWarehouse.replaceChildren();
  counted.forEach((item) => {
    const option = make("option", "", item.name);
    option.value = item.id;
    dom.productionWarehouse.append(option);
  });
  if (productionPreferred) dom.productionWarehouse.value = productionPreferred;
  dom.productionWarehouseStatus.textContent = active.some((item) => item.isProduction)
    ? `Production inventory will be deducted from ${active.find((item) => item.isProduction)?.name}.`
    : counted.length
      ? "Choose a warehouse that has an applied physical opening count."
      : "Apply an opening physical count before designating a production warehouse.";
  const countable = active.filter((item) => !item.openingCountApplied
    && !openingCounts.some((count) => count.warehouseId === item.id && count.status !== "applied"));
  const openingPreferred = countable.some((item) => item.id === dom.openingWarehouse.value)
    ? dom.openingWarehouse.value
    : countable[0]?.id || "";
  dom.openingWarehouse.replaceChildren();
  countable.forEach((item) => {
    const option = make("option", "", item.name);
    option.value = item.id;
    dom.openingWarehouse.append(option);
  });
  if (openingPreferred) dom.openingWarehouse.value = openingPreferred;
  const cyclePreferred = counted.some((item) => item.id === dom.cycleWarehouse.value)
    ? dom.cycleWarehouse.value : counted[0]?.id || "";
  dom.cycleWarehouse.replaceChildren();
  counted.forEach((item) => {
    const option = make("option", "", item.name);
    option.value = item.id;
    dom.cycleWarehouse.append(option);
  });
  if (cyclePreferred) dom.cycleWarehouse.value = cyclePreferred;
  const prepSourcePreferred = counted.some((item) => item.id === dom.prepSourceWarehouse.value)
    ? dom.prepSourceWarehouse.value : counted[0]?.id || "";
  const prepOutputPreferred = counted.some((item) => item.id === dom.prepOutputWarehouse.value)
    ? dom.prepOutputWarehouse.value : counted[0]?.id || "";
  [dom.prepSourceWarehouse, dom.prepOutputWarehouse].forEach((select) => {
    select.replaceChildren();
    counted.forEach((item) => {
      const option = make("option", "", item.name);
      option.value = item.id;
      select.append(option);
    });
  });
  if (prepSourcePreferred) dom.prepSourceWarehouse.value = prepSourcePreferred;
  if (prepOutputPreferred) dom.prepOutputWarehouse.value = prepOutputPreferred;
  renderProducts();
  renderPreparationSetup();
  if (!active.length) {
    dom.stockRows.replaceChildren();
    dom.stockEmpty.hidden = false;
    dom.stockEmpty.textContent = "No active warehouse. Add one to begin recording server-backed stock.";
  } else dom.stockEmpty.hidden = true;
  updateStockWriteState();
}
function renderProducts() {
  const active = products;
  [dom.movementProduct, dom.transferProduct].forEach((select) => {
    const previous = select.value;
    select.replaceChildren();
    active.forEach((product) => {
      const option = make("option", "", `${product.name} · ${product.code} (${product.unit})`);
      option.value = product.code;
      select.append(option);
    });
    if (active.some((product) => product.code === previous)) select.value = previous;
  });
  [dom.movementProduct, dom.transferProduct].forEach((select) => { select.disabled = !writeGate || !products.length || inFlight; });
}
function renderPreparationSetup() {
  const kind = dom.prepLinkKind.value === "mix" ? "mixes" : "ingredients";
  const sourceList = preparationSetup[kind] || [];
  const previous = dom.prepLinkSource.value;
  dom.prepLinkSource.replaceChildren();
  sourceList.forEach((item) => {
    const label = `${item.name} · ${item.code}${item.productCode ? ` → ${item.productCode}` : " · mapping needed"}`;
    const option = make("option", "", label);
    option.value = item.code;
    dom.prepLinkSource.append(option);
  });
  if (sourceList.some((item) => item.code === previous)) dom.prepLinkSource.value = previous;
  const previousProduct = dom.prepLinkProduct.value;
  dom.prepLinkProduct.replaceChildren();
  products.forEach((product) => {
    const option = make("option", "", `${product.name} · ${product.code} (${product.unit})`);
    option.value = product.code;
    dom.prepLinkProduct.append(option);
  });
  if (products.some((item) => item.code === previousProduct)) dom.prepLinkProduct.value = previousProduct;
  const mixOptions = preparationSetup.mixes.filter((item) => item.isPrep === true);
  const oldMix = dom.prepMix.value;
  dom.prepMix.replaceChildren();
  mixOptions.forEach((item) => {
    const missing = !item.productCode || !Array.isArray(item.components)
      || item.components.some((component) => !component.productCode || !unitRate(component.stockUnitsPerLb));
    const option = make("option", "", `${item.name} · ${item.code}${missing ? " · incomplete links" : ""}`);
    option.value = item.code;
    dom.prepMix.append(option);
  });
  if (mixOptions.some((item) => item.code === oldMix)) dom.prepMix.value = oldMix;
  const mix = mixOptions.find((item) => item.code === dom.prepMix.value);
  const ready = Boolean(mix?.productCode && unitRate(mix.stockUnitsPerLb)
    && Array.isArray(mix.components) && mix.components.length > 0
    && mix.components.every((component) => component.productCode
      && unitRate(component.stockUnitsPerLb) && quantity(component.perBatchLbs)));
  dom.prepReadiness.textContent = mix
    ? ready ? `Formula ready: output ${mix.productCode}; ${mix.components.length} linked raw ingredient${mix.components.length === 1 ? "" : "s"}.`
      : "This mix cannot be prepared until its output, every ingredient, and unit conversions are linked."
    : "No enabled prep mix is available.";
  renderPreparationLinkStatus();
  updateStockWriteState();
}
function renderPreparationLinkStatus() {
  dom.prepLinkStatus.replaceChildren();
  const rows = [
    ...(preparationSetup.ingredients || []).map((item) => ({ ...item, kind: "Ingredient" })),
    ...(preparationSetup.mixes || []).filter((item) => item.isPrep).map((item) => ({ ...item, kind: "Prepared mix" })),
  ];
  if (!rows.length) { listNotice(dom.prepLinkStatus, "No enabled ingredient or preparation-mix identities are available."); return; }
  rows.forEach((item) => {
    const li = make("li", "manager-list-item");
    const copy = make("div", "manager-list-copy");
    copy.append(make("strong", "", `${item.kind} · ${item.name} · ${item.code}`));
    const details = item.productCode
      ? `Linked to ${item.productName} · ${item.productCode} at ${item.stockUnitsPerLb} stock units/lb`
      : "Inventory product or stock-unit conversion is not linked";
    copy.append(make("span", "", details));
    li.append(copy);
    dom.prepLinkStatus.append(li);
  });
}
function renderPreparationHistory() {
  dom.prepHistory.replaceChildren();
  if (!preparations.length) { listNotice(dom.prepHistory, "No preparation batches have been recorded."); return; }
  preparations.forEach((item) => {
    const li = make("li", "manager-list-item");
    const copy = make("div", "manager-list-copy");
    copy.append(make("strong", "", `${item.mixName} · ${item.batchCount} batches → ${item.preparedQuantity} ${item.preparedUnit} ${item.preparedProductCode}`));
    copy.append(make("span", "", `${item.sourceWarehouseName} → ${item.outputWarehouseName} · lot ${item.lotNumber || "not supplied"} · ${item.sourceReference || "no source reference"} · ${item.reason} · ${safeDate(item.occurredAt)} · staff ${item.actorId.slice(0, 8)}`));
    li.append(copy);
    dom.prepHistory.append(li);
  });
}
function renderStock() {
  dom.stockRows.replaceChildren();
  stock.forEach((item) => {
    const row = document.createElement("tr");
    const productCell = document.createElement("td");
    productCell.append(make("strong", "", item.name), make("span", "table-code", `${item.code} · ${item.unit}`));
    const qtyCell = make("td", "quantity-cell", item.quantity);
    const stagedCell = make("td", "quantity-cell", item.stagedQuantity);
    const availableCell = make("td", "quantity-cell", item.availableQuantity);
    row.append(productCell, qtyCell, stagedCell, availableCell);
    dom.stockRows.append(row);
  });
  dom.stockEmpty.hidden = stock.length > 0 || !warehouses.some((item) => item.active);
  if (!stock.length && warehouses.some((item) => item.active)) dom.stockEmpty.textContent = "No stock rows returned for this warehouse. Check the product register or opening count.";
}
function renderLots(lots) {
  dom.lotHistory.replaceChildren();
  if (!lots.length) { listNotice(dom.lotHistory, "No lot records are available for this warehouse."); return; }
  lots.forEach((lot) => {
    const li = make("li", "manager-list-item");
    const copy = make("div", "manager-list-copy");
    copy.append(make("strong", "", `${lot.productName} · ${lot.productCode} · lot ${lot.lotNumber || "not provided"}`));
    copy.append(make("span", "", `${lot.quantityRemaining} ${lot.unit} remaining of ${lot.quantityReceived} · ${lot.sourceReference || "no source reference"} · received ${safeDate(lot.receivedAt)}`));
    li.append(copy);
    dom.lotHistory.append(li);
  });
}
function renderMovements() {
  dom.movementHistory.replaceChildren();
  if (!movements.length) {
    listNotice(dom.movementHistory, "No stock movements recorded for this warehouse.");
    dom.movementMore.hidden = true;
    return;
  }
  movements.forEach((item) => {
    const li = make("li", "manager-list-item");
    const detail = make("div", "manager-list-copy");
    detail.append(make("strong", "", `${item.type} · ${item.quantityDelta}`));
    const lot = item.lotNumber ? ` · lot ${item.lotNumber}` : "";
    const source = item.sourceReference ? ` · ${item.sourceReference}` : "";
    detail.append(make("span", "", `${item.reason}${lot}${source} · staff ${item.actorId.slice(0, 8)} · ${safeDate(item.occurredAt)}`));
    li.append(detail);
    dom.movementHistory.append(li);
  });
  dom.movementMore.hidden = !movementNextCursor;
}
function renderCountHistory() {
  dom.openingHistory.replaceChildren();
  if (!openingCounts.length) {
    listNotice(dom.openingHistory, "No physical counts have been staged.");
    return;
  }
  openingCounts.forEach((count) => {
    const item = make("li", "manager-list-item");
    const detail = make("div", "manager-list-copy");
    detail.append(make("strong", "", `${count.warehouseName} · ${count.status}`));
    detail.append(make("span", "", `${count.rowCount} products · manager ${count.createdBy.slice(0, 8)} · ${safeDate(count.createdAt)}`));
    const button = make("button", "button button-secondary button-small", count.status === "applied" ? "View count" : "Open count");
    button.type = "button";
    button.addEventListener("click", () => { void openCount(count.id); });
    item.append(detail, button);
    dom.openingHistory.append(item);
  });
}
function renderCycleHistory() {
  dom.cycleHistory.replaceChildren();
  if (!cycleCounts.length) { listNotice(dom.cycleHistory, "No cycle counts have been staged."); return; }
  cycleCounts.forEach((count) => {
    const li = make("li", "manager-list-item");
    const detail = make("div", "manager-list-copy");
    detail.append(make("strong", "", `${count.warehouseName} · ${count.status}`));
    detail.append(make("span", "", `${count.rowCount} products · staff ${count.createdBy.slice(0, 8)} · ${safeDate(count.createdAt)}`));
    const button = make("button", "button button-secondary button-small", "Open count");
    button.type = "button";
    button.addEventListener("click", () => { void openCycleCount(count.id); });
    li.append(detail, button);
    dom.cycleHistory.append(li);
  });
}
function renderCycleCount(count) {
  currentCycleCount = count;
  dom.cyclePreview.replaceChildren();
  const heading = make("strong", "", `${count.status} · ${count.rows.length} counted products`);
  const list = make("ul", "manager-list");
  count.rows.forEach((row) => {
    const li = make("li", "manager-list-item");
    const copy = make("div", "manager-list-copy");
    copy.append(make("strong", "", row.productCode));
    const current = row.currentQuantity ?? row.baselineQuantity;
    const variance = row.variance === undefined ? "not reviewed" : `${row.variance} ${row.unit || ""}`;
    copy.append(make("span", "", `Counted ${row.quantity} · current ${current}${row.unit ? ` ${row.unit}` : ""} · variance ${variance}`));
    li.append(copy);
    list.append(li);
  });
  dom.cyclePreview.append(heading, list);
  dom.cyclePreview.hidden = false;
  dom.cycleActions.hidden = count.status === "applied";
  if (count.status === "stale") dom.cycleActions.hidden = true;
  dom.cycleReview.disabled = !writeGate || !lastConfirmed || count.status !== "staged" || inFlight;
  dom.cycleApply.disabled = !writeGate || !lastConfirmed || count.status !== "reviewed" || inFlight;
}
async function refreshCycleCount(id) {
  const body = await request(`${INVENTORY}/cycle-counts/${encodeURIComponent(id)}`);
  if (!validateCycleCount(body.count) || body.count.id !== id) {
    throw new Error("The server returned an invalid cycle count. Refresh before applying it.");
  }
  renderCycleCount(body.count);
}
async function openCycleCount(id) {
  try {
    await refreshCycleCount(id);
    dom.cyclePreview.scrollIntoView({ block: "nearest", behavior: "smooth" });
  } catch (error) {
    message(error instanceof Error ? error.message : "Cycle count could not be loaded.", "error");
  }
}
async function loadWarehouseData({ appendMovements = false } = {}) {
  const id = dom.warehouseSelect.value;
  if (!id) {
    stock = []; movements = []; movementNextCursor = null; movementWarehouseId = null;
    renderStock(); renderMovements(); renderLots([]); return;
  }
  if (!appendMovements || movementWarehouseId !== id) {
    movementNextCursor = null;
    movementWarehouseId = id;
    movements = [];
  }
  const params = new URLSearchParams({ warehouseId: id, limit: "50" });
  if (appendMovements && movementNextCursor) {
    params.set("beforeAt", movementNextCursor.occurredAt);
    params.set("beforeId", movementNextCursor.id);
  }
  const [stockBody, moveBody] = await Promise.all([
    request(`${INVENTORY}/stock?warehouseId=${encodeURIComponent(id)}`),
    request(`${INVENTORY}/movements?${params.toString()}`),
  ]);
  const lotBody = appendMovements
    ? null
    : await request(`${INVENTORY}/lots?warehouseId=${encodeURIComponent(id)}&limit=100`);
  if (!Array.isArray(stockBody.stock) || !stockBody.stock.every(validateStock)
    || !Array.isArray(moveBody.movements) || !moveBody.movements.every(validateMovement)
    || !validateMovementCursor(moveBody.nextCursor)
    || lotBody && (!Array.isArray(lotBody.lots) || !lotBody.lots.every(validateLot))) {
    throw new Error("The server returned an unexpected stock or movement list. Refresh to reload canonical inventory.");
  }
  stock = stockBody.stock;
  movements = appendMovements ? [...movements, ...moveBody.movements] : moveBody.movements;
  movementNextCursor = moveBody.nextCursor;
  movementWarehouseId = id;
  renderStock(); renderMovements();
  if (lotBody) renderLots(lotBody.lots);
}
async function loadOlderMovements() {
  if (!movementNextCursor || inFlight || !lastConfirmed) return;
  dom.movementMore.disabled = true;
  try { await loadWarehouseData({ appendMovements: true }); }
  catch (error) { message(error instanceof Error ? error.message : "Older movements could not be loaded.", "error"); }
  finally { dom.movementMore.disabled = false; }
}
async function loadAll() {
  if (!staff?.capabilities?.includes("manage-inventory")) {
    dom.panel.hidden = true; return;
  }
  dom.panel.hidden = false;
  if (loading) return;
  loading = true;
  dom.importHistory.setAttribute("aria-busy", "true");
  try {
    const [importsBody, warehousesBody, productsBody, countsBody, dieDefaultsBody,
      prepSetupBody, prepHistoryBody, cycleCountsBody] = await Promise.all([
      request(`${IMPORTS}?limit=50`), request(`${INVENTORY}/warehouses`), request(`${INVENTORY}/products`),
      request(`${INVENTORY}/opening-counts?limit=50`), request(`${DIE_DEFAULTS}?limit=50`),
      request(`${INVENTORY}/preparation-setup`), request(`${INVENTORY}/preparations?limit=50`),
      request(`${INVENTORY}/cycle-counts?limit=50`),
    ]);
    if (!Array.isArray(importsBody.imports) || !importsBody.imports.every(validateImport)
      || !Array.isArray(warehousesBody.warehouses) || !warehousesBody.warehouses.every(validateWarehouse)
      || !Array.isArray(productsBody.products) || !productsBody.products.every(validateProduct)
      || !Array.isArray(countsBody.counts) || !countsBody.counts.every(validateCountSummary)
      || !Array.isArray(dieDefaultsBody.defaults) || !dieDefaultsBody.defaults.every(validateDieType)
      || !Array.isArray(dieDefaultsBody.history) || !dieDefaultsBody.history.every(validateDieDefaultHistory)
      || !object(prepSetupBody) || !Array.isArray(prepSetupBody.ingredients) || !Array.isArray(prepSetupBody.mixes)
      || !Array.isArray(prepHistoryBody.preparations) || !prepHistoryBody.preparations.every(validatePreparation)
      || !Array.isArray(cycleCountsBody.counts) || !cycleCountsBody.counts.every(validateCycleSummary)) {
      throw new Error("The server returned inventory data in an unexpected format. Refresh run state and reload manager data.");
    }
    imports = importsBody.imports;
    warehouses = warehousesBody.warehouses;
    products = productsBody.products;
    openingCounts = countsBody.counts;
    dieDefaults = dieDefaultsBody.defaults;
    dieDefaultHistory = dieDefaultsBody.history;
    preparationSetup = prepSetupBody;
    preparations = prepHistoryBody.preparations;
    cycleCounts = cycleCountsBody.counts;
    renderImports(); renderWarehouses(); renderCountHistory(); renderDieDefaults();
    renderPreparationHistory(); renderCycleHistory();
    await loadWarehouseData();
    clearMessage();
    lastConfirmed = true;
  } catch (error) {
    lastConfirmed = false;
    message(error instanceof Error ? error.message : "Manager data could not be loaded. Retry after reconnecting.", "error");
    const retry = make("button", "button button-secondary button-small pending-retry", "Retry manager data");
    retry.type = "button";
    retry.addEventListener("click", () => { void loadAll(); });
    dom.error.append(retry);
    if (!imports.length) listNotice(dom.importHistory, "Import history is unavailable. Retry after the server confirms.");
  } finally {
    loading = false;
    dom.importHistory.removeAttribute("aria-busy");
    updateReadOnly();
  }
}
async function operation({ kind, endpoint, payload, requestBody = null, responseKey, validate, refresh, label }) {
  if (inFlight || !ensureWrite()) return null;
  if (pending && pending.actorId !== staff.userId) {
    message("The saved request belongs to another manager. Sign in as that person before retrying.", "warning"); return null;
  }
  if (pending && (pending.kind !== kind || pending.endpoint !== endpoint)) {
    message("Resolve the saved request first. Retry its exact saved action before starting another change.", "warning"); return null;
  }
  const attempt = pending ? pending : { actorId: staff.userId, kind, endpoint, payload };
  if (!persistPending(attempt)) return null;
  setBusy(true);
  let confirmed = false;
  try {
    const body = await request(attempt.endpoint, {
      method: "POST",
      body: requestBody ?? attempt.payload,
    });
    if (responseKey && !(responseKey in body)) throw new Error(`The server response did not confirm ${label}. Retry the same request.`);
    const result = responseKey ? body[responseKey] : body;
    if (validate && !validate(result)) throw new Error(`The server returned an unexpected ${label} result. Retry the same request to confirm it.`);
    clearPending();
    confirmed = true;
    if (refresh) {
      await refresh(result);
      if (!lastConfirmed) throw new Error("The change was confirmed, but fresh manager data is not available yet.");
    }
    message(`${label} confirmed by the server.`, "success");
    return result;
  } catch (error) {
    const validation = error instanceof RequestError && [400, 409].includes(error.status);
    if (validation) {
      clearPending();
      if (error.status === 409) {
        try { await loadAll(); } catch { /* loadAll reports its own safe refresh error */ }
      }
    }
    message(confirmed
      ? `${label} was accepted by the server, but its latest details could not be refreshed. Refresh manager data before continuing.`
      : `${error instanceof Error ? error.message : `${label} was not confirmed.`}${validation ? " The server rejected this attempt; correct the input or refresh before starting a new request." : " The same request identity is saved; retry it to confirm the result."}`,
    confirmed ? "warning" : validation ? "warning" : "error");
    return null;
  } finally { setBusy(false); }
}
function validateWarehouseResult(value) {
  return validateWarehouse(value) || object(value) && validateWarehouse(value.warehouse);
}
function importResponse(item) {
  return object(item) && uuid(item.importId) && IMPORT_KINDS.has(item.kind) && item.outcome === "staged"
    && Array.isArray(item.records) && item.records.every((record) => validateRecord(record, item.kind));
}
function validateImportDetail(item) {
  return object(item) && uuid(item.id) && IMPORT_KINDS.has(item.kind)
    && ["staged", "applied", "undone"].includes(item.status)
    && Array.isArray(item.records) && item.records.length >= 1 && item.records.length <= 2000
    && item.records.every((record) => validateRecord(record, item.kind))
    && uuid(item.createdBy) && uuidOrNull(item.appliedBy) && uuidOrNull(item.undoneBy);
}
async function openImport(id) {
  try {
    const body = await request(`${IMPORTS}/${encodeURIComponent(id)}`);
    if (!validateImportDetail(body.import) || body.import.id !== id) {
      throw new Error("The saved import details could not be validated. Refresh history and try again.");
    }
    renderPreview(dom.importPreview, body.import.records, `${body.import.kind} · ${body.import.status}`);
    dom.importActions.hidden = body.import.status !== "staged";
    dom.importApply.dataset.importId = body.import.id;
    dom.importPreview.scrollIntoView({ block: "nearest" });
    clearMessage();
  } catch (error) {
    message(error instanceof Error ? error.message : "The saved import could not be reopened.", "error");
  }
}
async function stageImport(csv, kind, requestId) {
  return operation({
    kind: "setup-import", endpoint: IMPORTS, payload: { requestId, kind, csv }, responseKey: null,
    validate: (result) => importResponse(result) && result.kind === kind,
    label: "Setup import",
    refresh: async (result) => {
      renderPreview(dom.importPreview, result.records, `Staged · ${result.kind}`);
      dom.importActions.hidden = false;
      dom.importApply.dataset.importId = result.importId;
      await refreshImportHistory();
    },
  });
}
async function refreshImportHistory() {
  const data = await request(`${IMPORTS}?limit=50`);
  if (!Array.isArray(data.imports) || !data.imports.every(validateImport)) throw new Error("Import history could not be validated. Refresh to retry.");
  imports = data.imports; renderImports();
}
async function refreshOpeningHistory() {
  const data = await request(`${INVENTORY}/opening-counts?limit=50`);
  if (!Array.isArray(data.counts) || !data.counts.every(validateCountSummary)) {
    throw new Error("Physical count history could not be validated. Refresh to retry.");
  }
  openingCounts = data.counts;
  renderCountHistory();
  renderWarehouses();
}
async function submitImport(event) {
  event.preventDefault();
  if (!ensureWrite()) return;
  if (pending) { renderPending(); message("Resolve the saved request first. Use its retry action; do not stage a different import.", "warning"); return; }
  const file = dom.importFile.files?.[0], kind = dom.importKind.value;
  if (!file || !IMPORT_KINDS.has(kind)) { message("Choose a supported CSV and import type.", "warning"); return; }
  if (file.size > 1024 * 1024) { message("CSV files must be 1 MiB or smaller.", "warning"); return; }
  try { await stageImport(await file.text(), kind, crypto.randomUUID()); }
  catch { message("The CSV file could not be read. Choose it again and retry.", "error"); }
}
function workbookImportResponse(value, family = null, fileSha256 = null) {
  return object(value) && value.outcome === "staged" && uuid(value.importId)
    && IMPORT_KINDS.has(value.kind)
    && value.kind === (value.sourceFamily === "dough-procedure" ? "recipes" : "production-setups")
    && WORKBOOK_IMPORT_FAMILIES.has(value.sourceFamily)
    && (!family || value.sourceFamily === family)
    && text(value.fileName, 120)
    && /^[0-9a-f]{64}$/u.test(value.fileSha256)
    && (!fileSha256 || value.fileSha256 === fileSha256)
    && Number.isSafeInteger(value.linkedCount) && value.linkedCount >= 1
    && Number.isSafeInteger(value.rememberedCount) && value.rememberedCount >= 0
    && Number.isSafeInteger(value.managerMappedCount) && value.managerMappedCount >= 0
    && Number.isSafeInteger(value.unmatchedCount) && value.unmatchedCount >= 0
    && Number.isSafeInteger(value.invalidValueCount) && value.invalidValueCount >= 0
    && Array.isArray(value.unmatchedRows) && value.unmatchedRows.length <= 100
    && value.unmatchedRows.every((row) => object(row) && /^[0-9a-f]{64}$/u.test(row.sourceKey)
      && text(row.name, 120)
      && Number.isSafeInteger(row.row) && row.row > 0
      && ["unmatched", "ambiguous"].includes(row.reason))
    && Array.isArray(value.records) && value.records.length === value.linkedCount
    && value.records.every((record) => validateRecord(record, value.kind));
}
function workbookLinkPreviewResponse(value, family, fileSha256) {
  return object(value) && value.sourceFamily === family && WORKBOOK_IMPORT_FAMILIES.has(value.sourceFamily)
    && text(value.fileName, 120) && /^[0-9a-f]{64}$/u.test(value.fileSha256)
    && value.fileSha256 === fileSha256
    && Array.isArray(value.rows) && value.rows.length >= 1 && value.rows.length <= 2000
    && value.rows.every((row) => object(row) && /^[0-9a-f]{64}$/u.test(row.sourceKey)
      && text(row.name, 120) && Number.isSafeInteger(row.row) && row.row > 0
      && ["exact", "remembered", "unmatched", "ambiguous"].includes(row.reason)
      && (row.productCode === null || typeof row.productCode === "string" && CODE.test(row.productCode)))
    && Array.isArray(value.products) && value.products.length <= 2000
    && value.products.every((product) => object(product) && CODE.test(product.code) && text(product.name, 120));
}
function renderWorkbookLinkReview(preview) {
  dom.workbookPreview.replaceChildren();
  dom.workbookPreview.hidden = false;
  dom.workbookPreview.append(
    make("strong", "", `Preview · ${preview.sourceFamily} · ${preview.fileName}`),
    make("p", "preview-summary", `${preview.rows.length} workbook rows · ${preview.products.length} active products available`),
    make("p", "manager-help", "Exact and previously confirmed links are automatic. Select an active product for any unmatched or ambiguous row you want included. Unresolved rows will stay out of this import."),
  );
  const list = make("ul", "preview-records");
  preview.rows.forEach((row) => {
    const line = make("li");
    line.append(make("span", "preview-code", `Row ${row.row}`), make("span", "", row.name));
    if (row.productCode) {
      const description = row.reason === "remembered" ? "Previously confirmed link" : "Exact name match";
      line.append(make("span", "preview-detail", `${description} · ${row.productCode}`));
    } else {
      const select = make("select", "workbook-product-link");
      select.dataset.actionControl = "true";
      select.dataset.sourceKey = row.sourceKey;
      select.setAttribute("aria-label", `Choose a product for ${row.name}, workbook row ${row.row}`);
      const placeholder = make("option", "", row.reason === "ambiguous"
        ? "Choose a product · multiple exact matches"
        : "Choose an active product");
      placeholder.value = "";
      select.append(placeholder);
      preview.products.forEach((product) => {
        const option = make("option", "", `${product.name} · ${product.code}`);
        option.value = product.code;
        select.append(option);
      });
      line.append(make("span", "preview-detail", row.reason === "ambiguous"
        ? "Multiple exact product matches · manager selection required"
        : "No exact product match · manager selection required"));
      line.append(select);
    }
    list.append(line);
  });
  dom.workbookPreview.append(list);
  dom.workbookActions.hidden = false;
  dom.workbookStage.hidden = false;
  dom.workbookStage.dataset.actionControl = "true";
  dom.workbookApply.hidden = true;
  updateReadOnly();
}
function renderWorkbookPreview(result) {
  renderPreview(dom.workbookPreview, result.records, `Staged · ${result.sourceFamily} · ${result.fileName}`);
  dom.workbookPreview.insertBefore(
    make("p", "manager-help", `${result.linkedCount} rows staged; ${result.rememberedCount} previously confirmed links retained; ${result.managerMappedCount} manager-selected links included; ${result.unmatchedCount} rows remain unavailable; ${result.invalidValueCount} linked rows have a missing or invalid source value.`),
    dom.workbookPreview.children[1] || null,
  );
  if (result.unmatchedCount > 0) {
    const details = make("details", "workbook-unmatched");
    details.append(make("summary", "", `Show up to ${result.unmatchedRows.length} unmatched workbook rows`));
    const list = make("ul", "preview-records");
    result.unmatchedRows.forEach((row) => {
      list.append(make("li", "", `${row.name} · row ${row.row} · ${row.reason === "ambiguous" ? "multiple exact product matches" : "no exact product match"}`));
    });
    details.append(list);
    dom.workbookPreview.append(details);
  }
  dom.workbookActions.hidden = false;
  dom.workbookStage.hidden = true;
  dom.workbookApply.hidden = false;
  dom.workbookApply.dataset.importId = result.importId;
}
async function workbookFileDetails(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const fileSha256 = [...new Uint8Array(digest)].map((part) => part.toString(16).padStart(2, "0")).join("");
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  }
  return { fileSha256, workbookBase64: btoa(binary) };
}
async function uploadCapacityWorkbook(file, saved = null) {
  if (!ensureWrite()) return null;
  if (workbookPreparing) return null;
  if (pending && !saved) {
    message("Resolve the saved request first. Retry its exact action before starting another import.", "warning");
    return null;
  }
  workbookPreparing = true;
  dom.workbookForm.querySelectorAll("button").forEach((button) => { button.disabled = true; });
  try {
  if (!file || file.size < 22 || file.size > MAX_WORKBOOK_BYTES
    || !/\.xlsx$/iu.test(file.name) || file.name.length > 120) {
    message("Choose a standard .xlsx workbook no larger than 5 MiB.", "warning");
    return null;
  }
  const family = saved?.payload.family || dom.workbookFamily.value;
  if (!WORKBOOK_IMPORT_FAMILIES.has(family)) {
    message("Choose a dough procedure or shipping guide workbook.", "warning");
    return null;
  }
  if (saved && (file.name !== saved.payload.fileName || family !== saved.payload.family)) {
    message("Choose the same workbook type and file name used for the saved request.", "warning");
    return null;
  }
  let details;
  try { details = await workbookFileDetails(file); }
  catch {
    message("The workbook could not be read for a safe retry. Choose it again.", "error");
    return null;
  }
  if (saved && details.fileSha256 !== saved.payload.fileSha256) {
    message("This is not the same workbook as the saved request. Keep the saved request and choose its original file.", "warning");
    return null;
  }
  const payload = saved?.payload || {
    requestId: crypto.randomUUID(),
    family,
    fileName: file.name,
    fileSha256: details.fileSha256,
    productLinks: selectedWorkbookProductLinks(),
  };
  const requestBody = {
    requestId: payload.requestId,
    family: payload.family,
    fileName: payload.fileName,
    workbookBase64: details.workbookBase64,
    productLinks: payload.productLinks || [],
  };
  return operation({
    kind: "workbook-import",
    endpoint: `${IMPORTS}/workbooks`,
    payload,
    requestBody,
    validate: (result) => workbookImportResponse(result, payload.family, payload.fileSha256),
    label: "Workbook import",
    refresh: async (result) => {
      renderWorkbookPreview(result);
      workbookDraft = null;
      await refreshImportHistory();
    },
  });
  } finally {
    workbookPreparing = false;
    updateReadOnly();
  }
}
async function submitCapacityWorkbook(event) {
  event.preventDefault();
  const saved = pending?.kind === "workbook-import" ? pending : null;
  if (pending && !saved) {
    renderPending();
    message("Resolve the saved request first. Retry its exact action before starting another import.", "warning");
    return;
  }
  if (saved) {
    await uploadCapacityWorkbook(dom.workbookFile.files?.[0], saved);
    return;
  }
  await previewCapacityWorkbook(dom.workbookFile.files?.[0]);
}
function selectedWorkbookProductLinks() {
  return [...dom.workbookPreview.querySelectorAll("select[data-source-key]")]
    .filter((select) => select.value)
    .map((select) => ({ sourceKey: select.dataset.sourceKey, productCode: select.value }));
}
async function previewCapacityWorkbook(file) {
  if (!ensureWrite() || workbookPreparing) return null;
  if (pending) {
    message("Resolve the saved request first. Retry its exact action before starting another import.", "warning");
    return null;
  }
  workbookPreparing = true;
  dom.workbookForm.querySelectorAll("button").forEach((button) => { button.disabled = true; });
  try {
    if (!file || file.size < 22 || file.size > MAX_WORKBOOK_BYTES
      || !/\.xlsx$/iu.test(file.name) || file.name.length > 120) {
      message("Choose a standard .xlsx workbook no larger than 5 MiB.", "warning");
      return null;
    }
    const family = dom.workbookFamily.value;
    if (!WORKBOOK_IMPORT_FAMILIES.has(family)) {
      message("Choose a dough procedure or shipping guide workbook.", "warning");
      return null;
    }
    let details;
    try { details = await workbookFileDetails(file); }
    catch {
      message("The workbook could not be read for a safe preview. Choose it again.", "error");
      return null;
    }
    const preview = await request(`${IMPORTS}/workbooks/preview`, {
      method: "POST",
      body: {
        family,
        fileName: file.name,
        workbookBase64: details.workbookBase64,
      },
    });
    if (!workbookLinkPreviewResponse(preview, family, details.fileSha256)) {
      throw new Error("The server returned an unexpected workbook preview. Refresh and try again.");
    }
    workbookDraft = {
      family,
      fileName: file.name,
      fileSha256: details.fileSha256,
      workbookBase64: details.workbookBase64,
    };
    renderWorkbookLinkReview(preview);
    clearMessage();
    return preview;
  } catch (error) {
    workbookDraft = null;
    dom.workbookActions.hidden = true;
    message(error instanceof Error ? error.message : "The workbook could not be previewed. Refresh and try again.", "error");
    return null;
  } finally {
    workbookPreparing = false;
    updateReadOnly();
  }
}
async function stageCapacityWorkbook() {
  if (!workbookDraft || !ensureWrite()) return;
  const file = dom.workbookFile.files?.[0];
  if (!file || file.name !== workbookDraft.fileName || dom.workbookFamily.value !== workbookDraft.family) {
    message("Choose the same workbook and type used for the current preview.", "warning");
    return;
  }
  let details;
  try { details = await workbookFileDetails(file); }
  catch {
    message("The workbook could not be rechecked. Preview it again before staging.", "error");
    return;
  }
  if (details.fileSha256 !== workbookDraft.fileSha256) {
    message("The selected workbook changed after preview. Preview it again before staging.", "warning");
    return;
  }
  await uploadCapacityWorkbook(file);
}
async function retryImport() {
  if (!pending || pending.kind !== "setup-import" || pending.actorId !== staff?.userId) return;
  await operation({
    kind: pending.kind, endpoint: pending.endpoint, payload: pending.payload,
    validate: (result) => importResponse(result) && result.kind === pending.payload.kind,
    label: "Setup import retry",
     refresh: async (result) => { renderPreview(dom.importPreview, result.records, `Staged · ${result.kind}`); dom.importActions.hidden = false; dom.importApply.dataset.importId = result.importId; await refreshImportHistory(); },
  });
}
async function actOnImport(item, action) {
  if (!ensureWrite()) return;
  if (action === "undo" && !window.confirm(`Undo the applied ${item.kind} import? The server will validate whether this is still safe.`)) return;
  const result = await operation({
    kind: `import-${action}`, endpoint: `${IMPORTS}/${encodeURIComponent(item.id)}/${action}`, payload: {},
    responseKey: null, validate: (result) => object(result) && (result.id === undefined || result.id === item.id),
    label: `Import ${action}`,
    refresh: async () => { await refreshImportHistory(); await loadAll(); },
  });
  if (result && action === "apply" && dom.workbookApply.dataset.importId === item.id) {
    dom.workbookActions.hidden = true;
  }
}
async function createWarehouse(event) {
  event.preventDefault();
  if (!ensureWrite() || pending) { if (pending) message("Resolve the saved request before creating another warehouse.", "warning"); return; }
  const name = dom.warehouseName.value.trim();
  if (name.length < 1 || name.length > 120) { message("Warehouse names must be 1–120 characters.", "warning"); dom.warehouseName.focus(); return; }
  await operation({
    kind: "warehouse-create", endpoint: `${INVENTORY}/warehouses`,
    payload: { requestId: crypto.randomUUID(), name }, validate: validateWarehouseResult,
    label: "Warehouse",
    refresh: async (value) => {
      const item = validateWarehouse(value) ? value : value.warehouse;
      warehouses = [...warehouses.filter((old) => old.id !== item.id), item];
      renderWarehouses(); dom.warehouseSelect.value = item.id; dom.warehouseName.value = ""; await loadWarehouseData();
    },
  });
}
async function setProductionWarehouse() {
  if (!ensureWrite() || pending) {
    if (pending) message("Resolve the saved request before changing the production warehouse.", "warning");
    return;
  }
  const warehouse = warehouses.find((item) =>
    item.id === dom.productionWarehouse.value && item.active && item.openingCountApplied);
  if (!warehouse) {
    message("Choose an active warehouse with an applied physical opening count.", "warning");
    return;
  }
  await operation({
    kind: "production-warehouse",
    endpoint: `${INVENTORY}/production-warehouse`,
    payload: { requestId: crypto.randomUUID(), warehouseId: warehouse.id },
    responseKey: "warehouse",
    validate: validateWarehouse,
    label: "Production warehouse",
    refresh: async (result) => {
      warehouses = warehouses.map((item) => ({ ...item, isProduction: item.id === result.id }));
      renderWarehouses();
      clearMessage();
    },
  });
}
function validateMovementResult(result) {
  return object(result) && result.outcome === "accepted" && uuid(result.movementId)
    && uuid(result.warehouseId) && CODE.test(result.productCode) && quantity(result.quantity)
    && Number.isSafeInteger(result.revision) && result.revision >= 1;
}
function validateTransferResult(result) {
  return object(result) && result.outcome === "accepted" && uuid(result.transferId)
    && CODE.test(result.productCode) && quantity(result.quantity)
    && uuid(result.sourceWarehouseId) && uuid(result.targetWarehouseId)
    && quantity(result.sourceQuantity) && quantity(result.targetQuantity)
    && Number.isSafeInteger(result.sourceRevision) && result.sourceRevision >= 1
    && Number.isSafeInteger(result.targetRevision) && result.targetRevision >= 1;
}
function parseMovementQuantity(value, type) {
  const input = value.trim();
  if (!QTY.test(input) || /^-?0(?:\.0{1,6})?$/.test(input) || type === "receipt" && input.startsWith("-")) return false;
  return true;
}
async function submitMovement(event) {
  event.preventDefault();
  if (!ensureWrite() || pending) { if (pending) message("Resolve the saved request before recording another stock change.", "warning"); return; }
  const productCode = dom.movementProduct.value, type = dom.movementType.value;
  const quantityValue = dom.movementQuantity.value.trim(), reason = dom.movementReason.value.trim();
  if (!CODE.test(productCode) || !["receipt", "adjustment"].includes(type) || !parseMovementQuantity(quantityValue, type)
    || reason.length < 3 || reason.length > 500) {
    message("Check product, quantity and reason. Use a non-zero quantity with up to six decimals; receipts must be positive.", "warning"); return;
  }
  const lotNumber = dom.movementLot.value.trim(), sourceReference = dom.movementSource.value.trim();
  if (lotNumber.length > 120 || sourceReference.length > 200
    || /[\u0000-\u001f\u007f]/u.test(lotNumber + sourceReference)) {
    message("Lot and source references must be valid text within their length limits.", "warning"); return;
  }
  const payload = {
    commandId: crypto.randomUUID(), warehouseId: dom.warehouseSelect.value, productCode,
    type, quantity: quantityValue, reason, lotNumber, sourceReference,
  };
  await operation({ kind: "movement", endpoint: `${INVENTORY}/movements`, payload, validate: validateMovementResult,
    label: "Stock change", refresh: async () => { dom.movementForm.reset(); await loadWarehouseData(); } });
}
async function submitPreparationLink(event) {
  event.preventDefault();
  if (!ensureWrite() || pending) { if (pending) message("Resolve the saved request before changing another inventory link.", "warning"); return; }
  const kind = dom.prepLinkKind.value, sourceCode = dom.prepLinkSource.value, productCode = dom.prepLinkProduct.value;
  const stockUnitsPerLb = dom.prepLinkRate.value.trim();
  if (!["ingredient", "mix"].includes(kind) || !CODE.test(sourceCode) || !CODE.test(productCode)
    || !QTY.test(stockUnitsPerLb) || stockUnitsPerLb.startsWith("-") || /^0(?:\.0{1,6})?$/.test(stockUnitsPerLb)) {
    message("Choose a setup record and product, and enter a positive stock-units-per-pound conversion.", "warning"); return;
  }
  const payload = { commandId: crypto.randomUUID(), kind, sourceCode, productCode, stockUnitsPerLb };
  await operation({ kind: "prep-link", endpoint: `${INVENTORY}/preparation-links`, payload,
    validate: preparationLinkResponse, label: "Inventory product link", refresh: loadAll });
}
async function submitPreparation(event) {
  event.preventDefault();
  if (!ensureWrite() || pending) { if (pending) message("Resolve the saved request before recording another preparation.", "warning"); return; }
  const mixCode = dom.prepMix.value, sourceWarehouseId = dom.prepSourceWarehouse.value;
  const outputWarehouseId = dom.prepOutputWarehouse.value, batchCount = dom.prepBatches.value.trim();
  const lotNumber = dom.prepLot.value.trim(), sourceReference = dom.prepSource.value.trim();
  const reason = dom.prepReason.value.trim();
  if (!CODE.test(mixCode) || !uuid(sourceWarehouseId) || !uuid(outputWarehouseId)
    || !QTY.test(batchCount) || batchCount.startsWith("-") || /^0(?:\.0{1,6})?$/.test(batchCount)
    || lotNumber.length > 120 || sourceReference.length > 200 || reason.length < 3 || reason.length > 500
    || /[\u0000-\u001f\u007f]/u.test(lotNumber + sourceReference)) {
    message("Check the mix, warehouses, positive batch count, lot/source references, and reason.", "warning"); return;
  }
  const payload = {
    commandId: crypto.randomUUID(), mixCode, sourceWarehouseId, outputWarehouseId,
    batchCount, lotNumber, sourceReference, reason,
  };
  await operation({ kind: "prep-run", endpoint: `${INVENTORY}/preparations`, payload,
    validate: preparationResponse, label: "Preparation batch", refresh: async () => { dom.prepForm.reset(); await loadAll(); } });
}
async function submitCycleCount(event) {
  event.preventDefault();
  if (!ensureWrite() || pending) { if (pending) message("Resolve the saved request before staging another cycle count.", "warning"); return; }
  const warehouseId = dom.cycleWarehouse.value, reason = dom.cycleReason.value.trim();
  const file = dom.cycleFile.files?.[0];
  if (!uuid(warehouseId) || !file || file.size > 1024 * 1024 || reason.length < 3 || reason.length > 500) {
    message("Choose a warehouse and CSV up to 1 MiB, and enter a 3–500 character reason.", "warning"); return;
  }
  let csv;
  try { csv = await file.text(); } catch {
    message("The cycle-count CSV could not be read. Choose it again and retry.", "error");
    return;
  }
  const payload = { requestId: crypto.randomUUID(), warehouseId, csv, reason };
  await operation({ kind: "cycle-count", endpoint: `${INVENTORY}/cycle-counts`, payload,
    validate: cycleStageResponse, label: "Cycle count",
    refresh: async (result) => { await refreshCycleCount(result.countId); await loadAll(); } });
}
async function cycleAction(action) {
  if (!currentCycleCount || !ensureWrite()) return;
  const countId = currentCycleCount.id;
  const payload = action === "apply" ? { acknowledged: true } : {};
  await operation({
    kind: `cycle-${action}`,
    endpoint: `${INVENTORY}/cycle-counts/${encodeURIComponent(countId)}/${action}`,
    payload,
    validate: cycleActionResponse,
    label: action === "review" ? "Cycle count review" : "Cycle count application",
    refresh: async (result) => { await refreshCycleCount(result.countId); await loadAll(); },
  });
}
function submitTransfer(event) {
  event.preventDefault();
  if (!ensureWrite() || pending) { if (pending) message("Resolve the saved request before starting another transfer.", "warning"); return; }
  const sourceWarehouseId = dom.transferFrom.value, targetWarehouseId = dom.transferTo.value;
  const productCode = dom.transferProduct.value, quantityValue = dom.transferQuantity.value.trim();
  const reason = dom.transferReason.value.trim();
  if (!uuid(sourceWarehouseId) || !uuid(targetWarehouseId) || sourceWarehouseId === targetWarehouseId
    || !CODE.test(productCode) || !QTY.test(quantityValue) || quantityValue.startsWith("-")
    || /^0(?:\.0{1,6})?$/.test(quantityValue) || reason.length < 3 || reason.length > 500) {
    message("Choose two different warehouses and enter a positive quantity and a 3–500 character reason.", "warning"); return;
  }
  const payload = { commandId: crypto.randomUUID(), sourceWarehouseId, targetWarehouseId, productCode, quantity: quantityValue, reason };
  void operation({ kind: "transfer", endpoint: `${INVENTORY}/transfers`, payload,
    validate: validateTransferResult,
    label: "Transfer", refresh: async () => { dom.transferForm.reset(); await loadAll(); } });
}
function openingCountValid(item) { return validateCount(item); }
function stagedCountResponse(item) {
  return object(item) && uuid(item.countId) && uuid(item.warehouseId) && item.outcome === "staged"
    && Number.isSafeInteger(item.rowCount) && item.rowCount >= 1 && item.rowCount <= 2000
    && Array.isArray(item.rows) && item.rows.length === item.rowCount
    && item.rows.every((row) => object(row) && CODE.test(row.productCode) && quantity(row.quantity));
}
function countActionResponse(item) {
  return object(item) && uuid(item.countId) && uuid(item.warehouseId)
    && ["reviewed", "applied"].includes(item.outcome)
    && Number.isSafeInteger(item.rowCount) && item.rowCount >= 1 && item.rowCount <= 2000;
}
function cycleStageResponse(item) {
  return object(item) && uuid(item.countId) && uuid(item.warehouseId) && ["staged", "stale"].includes(item.outcome)
    && Number.isSafeInteger(item.rowCount) && item.rowCount >= 1 && item.rowCount <= 2000;
}
function cycleActionResponse(item) {
  return object(item) && uuid(item.countId) && uuid(item.warehouseId)
    && ["reviewed", "applied"].includes(item.outcome) && Array.isArray(item.rows);
}
function preparationLinkResponse(item) {
  return object(item) && item.outcome === "linked"
    && ["ingredient", "mix"].includes(item.kind) && CODE.test(item.sourceCode)
    && CODE.test(item.productCode) && unitRate(item.stockUnitsPerLb);
}
function preparationResponse(item) {
  return object(item) && item.outcome === "prepared" && uuid(item.preparationId)
    && CODE.test(item.mixCode) && CODE.test(item.preparedProductCode)
    && quantity(item.batchCount) && quantity(item.preparedQuantity)
    && Array.isArray(item.components) && text(item.occurredAt, 40);
}
function renderCount(count) {
  currentCount = count;
  renderPreview(dom.openingPreview, count.rows.map((row) => ({
    code: row.productCode, name: `${row.quantity} counted`,
  })), `Physical count · ${count.status}`);
  dom.openingActions.hidden = false;
  const isStaged = ["staged", "pending_review"].includes(count.status);
  const reviewed = ["reviewed", "ready_to_apply"].includes(count.status);
  dom.openingReview.hidden = !isStaged;
  dom.openingApply.disabled = !reviewed || !writeGate || inFlight;
  dom.openingApply.textContent = count.status === "applied" ? "Opening count applied" : "Apply opening count";
  if (count.status === "applied") {
    const warehouse = warehouses.find((item) => item.id === count.warehouseId);
    if (warehouse) warehouse.openingCountApplied = true;
  }
  updateStockWriteState();
}
function updateStockWriteState() {
  if (!dom.panel) return;
  const writable = writeGate && lastConfirmed && staff?.capabilities?.includes("manage-inventory") === true && !inFlight;
  const selected = warehouses.find((item) => item.id === dom.warehouseSelect.value && item.active);
  const movementReady = writable && products.length > 0 && selected?.openingCountApplied === true;
  const source = warehouses.find((item) => item.id === dom.transferFrom.value && item.active);
  const target = warehouses.find((item) => item.id === dom.transferTo.value && item.active);
  const transferReady = writable && products.length > 0
    && source?.openingCountApplied === true && target?.openingCountApplied === true && source.id !== target.id;
  const movementButton = dom.movementForm.querySelector('button[type="submit"]');
  const transferButton = dom.transferForm.querySelector('button[type="submit"]');
  const openingButton = dom.openingForm.querySelector('button[type="submit"]');
  const prepLinkButton = dom.prepLinkForm.querySelector('button[type="submit"]');
  const prepButton = dom.prepForm.querySelector('button[type="submit"]');
  const cycleButton = dom.cycleForm.querySelector('button[type="submit"]');
  const selectedProduction = warehouses.find((item) =>
    item.id === dom.productionWarehouse.value && item.active && item.openingCountApplied);
  dom.productionWarehouseSet.disabled = !writable || !selectedProduction
    || selectedProduction.isProduction === true;
  if (movementButton) movementButton.disabled = !movementReady;
  if (transferButton) transferButton.disabled = !transferReady;
  const countWarehouse = warehouses.find((item) => item.id === dom.openingWarehouse.value && item.active);
  if (openingButton) openingButton.disabled = !writable || products.length === 0 || !countWarehouse;
  const countedWarehouses = warehouses.filter((item) => item.active && item.openingCountApplied);
  const prepMix = preparationSetup.mixes.find((item) => item.code === dom.prepMix.value && item.isPrep);
  const prepReady = Boolean(prepMix?.productCode && unitRate(prepMix.stockUnitsPerLb)
    && prepMix.components?.length && prepMix.components.every((component) =>
      component.productCode && unitRate(component.stockUnitsPerLb) && quantity(component.perBatchLbs)));
  if (prepLinkButton) prepLinkButton.disabled = !writable || !products.length || !dom.prepLinkSource.value;
  if (prepButton) prepButton.disabled = !writable || !prepReady || countedWarehouses.length === 0;
  if (cycleButton) cycleButton.disabled = !writable || !countedWarehouses.some((item) => item.id === dom.cycleWarehouse.value);
  const movementNotice = byId("movement-stock-gate");
  if (movementNotice) {
    movementNotice.hidden = movementReady;
    movementNotice.textContent = !selected
      ? "Choose an active warehouse."
      : !products.length
        ? "Import products before recording stock."
        : !selected.openingCountApplied
          ? "Review and apply this warehouse’s physical opening count before receiving or adjusting stock."
          : "";
  }
  const transferNotice = byId("transfer-stock-gate");
  if (transferNotice) {
    transferNotice.hidden = transferReady;
    transferNotice.textContent = !source || !target || source.id === target.id
      ? "Choose two different active warehouses."
      : !products.length
        ? "Import products before transferring stock."
        : source.openingCountApplied && target.openingCountApplied
          ? ""
          : "Review and apply a physical opening count in both warehouses before transferring stock.";
  }
  if (dom.openingReview) {
    dom.openingReview.disabled = !writable || currentCount?.status !== "staged";
  }
  if (dom.openingApply) {
    dom.openingApply.disabled = !writable || currentCount?.status !== "reviewed";
  }
  if (dom.cycleReview) dom.cycleReview.disabled = !writable || currentCycleCount?.status !== "staged";
  if (dom.cycleApply) dom.cycleApply.disabled = !writable || currentCycleCount?.status !== "reviewed";
}
async function refreshCount(id) {
  const body = await request(`${INVENTORY}/opening-counts/${encodeURIComponent(id)}`);
  if (!openingCountValid(body.count) || body.count.id !== id) throw new Error("The server returned an invalid opening count. Refresh to reload its status.");
  renderCount(body.count);
}
async function openCount(id) {
  try {
    await refreshCount(id);
    dom.openingPreview.scrollIntoView({ block: "nearest", behavior: "smooth" });
  } catch (error) {
    message(error instanceof Error ? error.message : "Physical count could not be loaded. Refresh to retry.", "error");
  }
}
async function submitOpeningCount(event) {
  event.preventDefault();
  if (!ensureWrite() || pending) { if (pending) message("Resolve the saved request before staging another count.", "warning"); return; }
  const warehouseId = dom.openingWarehouse.value;
  const file = dom.openingFile.files?.[0];
  if (!uuid(warehouseId) || !file) { message("Choose a warehouse and physical-count CSV.", "warning"); return; }
  if (file.size > 1024 * 1024) { message("CSV files must be 1 MiB or smaller.", "warning"); return; }
  try {
    const csv = await file.text();
    await operation({ kind: "opening-count", endpoint: `${INVENTORY}/opening-counts`,
      payload: { requestId: crypto.randomUUID(), warehouseId, csv },
       validate: (result) => stagedCountResponse(result) && result.warehouseId === warehouseId,
      label: "Opening count",
       refresh: async (result) => { await refreshCount(result.countId); await refreshOpeningHistory(); } });
  } catch { message("The physical-count CSV could not be read. Choose it again and retry.", "error"); }
}
async function retryOpeningCount() {
  if (!pending || pending.kind !== "opening-count" || pending.actorId !== staff?.userId) return;
  await operation({ kind: pending.kind, endpoint: pending.endpoint, payload: pending.payload,
     validate: stagedCountResponse, label: "Opening count retry",
     refresh: async (result) => { await refreshCount(result.countId); await refreshOpeningHistory(); } });
}
async function retrySavedRequest() {
  const saved = pending;
  if (!saved || saved.actorId !== staff?.userId || !ensureWrite()) return;
  if (saved.kind === "workbook-import") {
    await uploadCapacityWorkbook(dom.workbookFile.files?.[0], saved);
    return;
  }
  const validator = saved.kind === "setup-import"
    ? (value) => importResponse(value)
             : saved.kind === "opening-count" ? stagedCountResponse
      : saved.kind === "warehouse-create" ? validateWarehouseResult
        : saved.kind === "movement" ? validateMovementResult
          : saved.kind === "transfer" ? validateTransferResult
            : saved.kind === "cycle-count" ? cycleStageResponse
              : saved.kind === "cycle-review" || saved.kind === "cycle-apply" ? cycleActionResponse
                : saved.kind === "prep-link" ? preparationLinkResponse
                  : saved.kind === "prep-run" ? preparationResponse
            : (value) => object(value);
  await operation({
    kind: saved.kind, endpoint: saved.endpoint, payload: saved.payload,
    validate: validator, label: "Saved inventory request",
    refresh: async (result) => {
      if (saved.kind === "setup-import") {
        renderPreview(dom.importPreview, result.records, `Staged · ${result.kind}`);
        dom.importActions.hidden = false; dom.importApply.dataset.importId = result.importId;
      } else if (saved.kind === "opening-count") {
         await refreshCount(result.countId);
      } else if (saved.kind === "warehouse-create") {
        const item = validateWarehouse(result) ? result : result.warehouse;
        warehouses = [...warehouses.filter((old) => old.id !== item.id), item];
        renderWarehouses(); dom.warehouseSelect.value = item.id;
      } else if (saved.kind === "cycle-count" || saved.kind === "cycle-review" || saved.kind === "cycle-apply") {
        await refreshCycleCount(result.countId);
      }
      await loadAll();
    },
  });
}
async function countAction(action) {
  if (!currentCount || !ensureWrite()) return;
  const countId = currentCount.id;
  await operation({ kind: `count-${action}`, endpoint: `${INVENTORY}/opening-counts/${encodeURIComponent(countId)}/${action}`,
     payload: {}, validate: countActionResponse, label: action === "review" ? "Count review" : "Opening count apply",
     refresh: async (result) => { await refreshCount(result.countId); await loadAll(); } });
}
function bind() {
  dom.importKind.addEventListener("change", updateTemplates);
  dom.importForm.addEventListener("submit", submitImport);
  dom.importRetry.addEventListener("click", retryImport);
  dom.workbookForm.addEventListener("submit", submitCapacityWorkbook);
  const discardWorkbookPreview = () => {
    if (!workbookDraft) return;
    workbookDraft = null;
    dom.workbookPreview.replaceChildren();
    dom.workbookPreview.hidden = true;
    dom.workbookActions.hidden = true;
  };
  dom.workbookFamily.addEventListener("change", discardWorkbookPreview);
  dom.workbookFile.addEventListener("change", discardWorkbookPreview);
  dom.workbookRetry.addEventListener("click", retrySavedRequest);
  dom.workbookStage.addEventListener("click", () => { void stageCapacityWorkbook(); });
  dom.importApply.addEventListener("click", () => {
    const item = imports.find((entry) => entry.id === dom.importApply.dataset.importId);
    if (item) void actOnImport(item, "apply");
  });
  dom.workbookApply.addEventListener("click", () => {
    const item = imports.find((entry) => entry.id === dom.workbookApply.dataset.importId);
    if (item) void actOnImport(item, "apply");
  });
  dom.warehouseForm.addEventListener("submit", createWarehouse);
  dom.productionWarehouseSet.addEventListener("click", () => { void setProductionWarehouse(); });
  dom.warehouseSelect.addEventListener("change", () => {
    movementNextCursor = null;
    movementWarehouseId = null;
    updateStockWriteState();
    if (lastConfirmed) void loadWarehouseData().catch((error) => message(error.message, "error"));
  });
  dom.movementMore.addEventListener("click", () => { void loadOlderMovements(); });
  dom.transferFrom.addEventListener("change", () => {
    const other = warehouses.find((item) => item.active && item.id !== dom.transferFrom.value);
    if (other) dom.transferTo.value = other.id;
    updateStockWriteState();
  });
  dom.transferTo.addEventListener("change", updateStockWriteState);
  dom.openingWarehouse.addEventListener("change", updateStockWriteState);
  dom.movementForm.addEventListener("submit", submitMovement);
  dom.prepLinkKind.addEventListener("change", renderPreparationSetup);
  dom.prepMix.addEventListener("change", updateStockWriteState);
  dom.prepLinkForm.addEventListener("submit", submitPreparationLink);
  dom.prepForm.addEventListener("submit", submitPreparation);
  dom.cycleForm.addEventListener("submit", submitCycleCount);
  dom.cycleReview.addEventListener("click", () => { void cycleAction("review"); });
  dom.cycleApply.addEventListener("click", () => { void cycleAction("apply"); });
  dom.transferForm.addEventListener("submit", submitTransfer);
  dom.openingForm.addEventListener("submit", submitOpeningCount);
  dom.dieDefaultForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void saveDieDefault(true);
  });
  dom.dieDefaultType.addEventListener("change", renderDieDefaults);
  dom.dieDefaultSuggestion.addEventListener("click", useDieDefaultSuggestion);
  dom.dieDefaultRetire.addEventListener("click", () => { void saveDieDefault(false); });
  dom.openingRetry.addEventListener("click", retryOpeningCount);
  dom.openingReview.addEventListener("click", () => { void countAction("review"); });
  dom.openingApply.addEventListener("click", () => { void countAction("apply"); });
  dom.movementType.addEventListener("change", () => {
    const receipt = dom.movementType.value === "receipt";
    dom.movementQuantity.setAttribute("aria-describedby", "movement-quantity-help");
    dom.movementQuantity.min = receipt ? "0" : "";
  });
  updateTemplates();
  dom.panel.querySelectorAll("input,select,button").forEach((control) => { control.dataset.actionControl = "true"; });
}
export function initializeInventory() {
  updateTemplateDownload(dom.openingTemplateDownload, openingCountCsvTemplate);
  bind();
  updateReadOnly();
}
export function updateInventoryContext(nextStaff, canWrite) {
  const changedUser = staff?.userId !== nextStaff?.userId;
  staff = nextStaff;
  writeGate = canWrite === true && typeof navigator !== "undefined" && navigator.onLine !== false;
  if (!staff || !staff.capabilities?.includes("manage-inventory")) {
    dom.panel.hidden = true;
    imports = []; warehouses = []; products = []; stock = []; movements = []; currentCount = null;
    openingCounts = [];
    dieDefaults = []; dieDefaultHistory = [];
    preparationSetup = { ingredients: [], mixes: [] }; preparations = []; cycleCounts = []; currentCycleCount = null;
    dom.importHistory.replaceChildren(); dom.stockRows.replaceChildren(); dom.movementHistory.replaceChildren(); dom.openingHistory.replaceChildren();
    dom.lotHistory.replaceChildren(); dom.prepHistory.replaceChildren(); dom.cycleHistory.replaceChildren();
    dom.dieDefaultHistory.replaceChildren();
    return;
  }
  dom.panel.hidden = false;
  if (changedUser) {
    imports = []; warehouses = []; products = []; stock = []; movements = []; openingCounts = []; currentCount = null;
     dieDefaults = []; dieDefaultHistory = [];
    preparationSetup = { ingredients: [], mixes: [] }; preparations = []; cycleCounts = []; currentCycleCount = null;
    dom.importPreview.hidden = true; dom.importActions.hidden = true; dom.workbookPreview.hidden = true; dom.workbookActions.hidden = true;
    dom.openingPreview.hidden = true; dom.openingActions.hidden = true;
  }
  if (writeGate) lastConfirmed = false;
  updateReadOnly();
  if (writeGate) void loadAll();
}
