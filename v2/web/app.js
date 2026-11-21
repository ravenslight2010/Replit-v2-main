import { canWriteRunState } from "./write-gate.mjs";
import { STATIONS, calculateStationMetrics } from "/v2/core/station-workflows.mjs";
import { DIE_DEFAULT_FIELDS, isDieLineSettings, resolveDieLineDefaults, resolveDieLineDefaultsOnSwitch } from "../core/die-defaults.mjs";
import { initializeInventory, updateInventoryContext } from "./inventory.js";
import { updateMixPlanContext } from "./mix-plan.js";
import { updateScheduleContext } from "./schedule.js";
import { initializeManagerOperations, updateManagerOperationsContext } from "./manager-operations.js";
import { initializeQc } from "./qc.js";

const API = "/api/v2/runs";
const AUTH_API = "/api/v2/auth";
const RUN_INVENTORY_API = "/api/v2/inventory";
const qc = initializeQc();
const POLL_INTERVAL_MS = 3000;
const STATION_STATUSES = new Set(["not_started", "running", "paused", "completed"]);
const TIMER_STATUSES = new Set(["idle", "running", "paused"]);
const TIMER_FIELDS = new Set(["timerStatus", "timerStartedAt", "timerPausedAt", "timerElapsedMs"]);
const TRACKING_FIELDS = new Set(["autoTrackLastAt", "autoTrackRemainder"]);
const PENDING_PREFIX = "fieldline:v2:pending-command:";
const PENDING_CREATE_KEY = "fieldline:v2:pending-create";
const PENDING_STATION_PREFIX = "fieldline:v2:pending-station:";
const OFFLINE_CACHE_KEY = "fieldline:v2:last-confirmed-state";
const RUN_STATUSES = new Set(["planned", "running", "paused", "completed"]);
const COMMANDS = new Set(["start", "pause", "resume", "complete"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const el = {
  authPanel: document.querySelector("#auth-panel"),
  authStatus: document.querySelector("#auth-status"),
  authError: document.querySelector("#auth-error"),
  authErrorTitle: document.querySelector("#auth-error-title"),
  authErrorMessage: document.querySelector("#auth-error-message"),
  authForm: document.querySelector("#auth-form"),
  authUsername: document.querySelector("#auth-username"),
  authPassword: document.querySelector("#auth-password"),
  authSubmit: document.querySelector("#auth-submit"),
  authRetry: document.querySelector("#auth-retry"),
  passwordRecoveryLinks: document.querySelector("#password-recovery-links"),
  passwordResetRequestToggle: document.querySelector("#password-reset-request-toggle"),
  passwordResetCompletionToggle: document.querySelector("#password-reset-completion-toggle"),
  passwordResetRequestForm: document.querySelector("#password-reset-request-form"),
  passwordResetRequestUsername: document.querySelector("#password-reset-username"),
  passwordResetRequestSubmit: document.querySelector("#password-reset-request-submit"),
  passwordResetRequestCancel: document.querySelector("#password-reset-request-cancel"),
  passwordResetCompletionForm: document.querySelector("#password-reset-completion-form"),
  passwordResetCompletionUsername: document.querySelector("#password-reset-completion-username"),
  passwordResetCodeInput: document.querySelector("#password-reset-code"),
  passwordResetNewPassword: document.querySelector("#password-reset-new-password"),
  passwordResetCompletionSubmit: document.querySelector("#password-reset-completion-submit"),
  passwordResetCompletionCancel: document.querySelector("#password-reset-completion-cancel"),
  passwordResetStatus: document.querySelector("#password-reset-status"),
  setupToggle: document.querySelector("#setup-toggle"),
  bootstrapForm: document.querySelector("#bootstrap-form"),
  bootstrapCode: document.querySelector("#bootstrap-code"),
  bootstrapUsername: document.querySelector("#bootstrap-username"),
  bootstrapPassword: document.querySelector("#bootstrap-password"),
  bootstrapSubmit: document.querySelector("#bootstrap-submit"),
  setupCancel: document.querySelector("#setup-cancel"),
  authenticatedApp: document.querySelector("#authenticated-app"),
  staffPanel: document.querySelector("#staff-panel"),
  staffStatus: document.querySelector("#staff-status"),
  staffError: document.querySelector("#staff-error"),
  staffCreateForm: document.querySelector("#staff-create-form"),
  staffUsername: document.querySelector("#new-staff-username"),
  staffPassword: document.querySelector("#new-staff-password"),
  staffRole: document.querySelector("#new-staff-role"),
  staffCreateButton: document.querySelector("#create-staff-button"),
  staffList: document.querySelector("#staff-list"),
  stationWorkerStatus: document.querySelector("#station-worker-status"),
  stationWorkerLastCycle: document.querySelector("#station-worker-last-cycle"),
  stationWorkerCycleAge: document.querySelector("#station-worker-cycle-age"),
  stationWorkerFailures: document.querySelector("#station-worker-failures"),
  stationWorkerProcessed: document.querySelector("#station-worker-processed"),
  stationWorkerNextStep: document.querySelector("#station-worker-next-step"),
  stationWorkerRefresh: document.querySelector("#station-worker-refresh"),
  staffHistoryStatus: document.querySelector("#staff-history-status"),
  staffHistoryList: document.querySelector("#staff-history-list"),
  staffHistoryMore: document.querySelector("#staff-history-more"),
  passwordResetPanel: document.querySelector("#password-reset-panel"),
  passwordResetQueueStatus: document.querySelector("#password-reset-queue-status"),
  passwordResetRefresh: document.querySelector("#password-reset-refresh"),
  passwordResetQueueError: document.querySelector("#password-reset-queue-error"),
  passwordResetQueue: document.querySelector("#password-reset-queue"),
  passwordResetCodePanel: document.querySelector("#password-reset-code-panel"),
  passwordResetIssuedCode: document.querySelector("#password-reset-issued-code"),
  passwordResetCodeExpiry: document.querySelector("#password-reset-code-expiry"),
  accountControls: document.querySelector("#account-controls"),
  staffLabel: document.querySelector("#staff-label"),
  signOut: document.querySelector("#sign-out-button"),
  connection: document.querySelector("#connection-indicator"),
  connectionLabel: document.querySelector("#connection-label"),
  lastCheck: document.querySelector("#last-check"),
  globalError: document.querySelector("#global-error"),
  errorTitle: document.querySelector("#error-title"),
  errorMessage: document.querySelector("#error-message"),
  refresh: document.querySelector("#refresh-button"),
  runContent: document.querySelector("#run-content"),
  revision: document.querySelector("#revision-value"),
  runsList: document.querySelector("#runs-list"),
  runCount: document.querySelector("#run-count"),
  createForm: document.querySelector("#create-form"),
  createButton: document.querySelector("#create-button"),
  createNote: document.querySelector("#create-note"),
  label: document.querySelector("#setup-label"),
  target: document.querySelector("#target-cases"),
  product: document.querySelector("#run-product"),
  productionSetup: document.querySelector("#run-production-setup"),
  dieCard: document.querySelector("#die-setup-card"),
  dieType: document.querySelector("#run-die-type"),
  dieStatus: document.querySelector("#die-setup-status"),
  dieFields: document.querySelector("#die-line-fields"),
  announcer: document.querySelector("#live-announcer"),
  stationPanel: document.querySelector("#station-panel"),
  stationTabs: document.querySelector("#station-tabs"),
  stationLabel: document.querySelector("#station-label"),
  stationState: document.querySelector("#station-state"),
  stationRevision: document.querySelector("#station-revision"),
  stationMetrics: document.querySelector("#station-metrics"),
  stationForm: document.querySelector("#station-form"),
  stationFields: document.querySelector("#station-fields"),
  stationSaveButton: document.querySelector("#station-save-button"),
  stationSaveNote: document.querySelector("#station-save-note"),
  stationTimerValue: document.querySelector("#station-timer-value"),
  stationTimerControls: document.querySelector("#station-timer-controls"),
  runSupplyPanel: document.querySelector("#run-supply-panel"),
  runSupplyStatus: document.querySelector("#run-supply-status"),
  runSupplyForm: document.querySelector("#run-supply-form"),
  runSupplyPlanned: document.querySelector("#run-supply-planned"),
  runSupplyActual: document.querySelector("#run-supply-actual"),
  runSupplyQuantity: document.querySelector("#run-supply-quantity"),
  runSupplyReason: document.querySelector("#run-supply-reason"),
  runSupplySubmit: document.querySelector("#run-supply-submit"),
  runSupplyRetry: document.querySelector("#run-supply-retry"),
  runSupplyHistory: document.querySelector("#run-supply-history"),
};

let runs = [];
let selectedRunId = null;
let refreshInFlight = false;
let createInFlight = false;
let commandInFlight = false;
let authCheckInFlight = false;
let authInFlight = false;
let passwordResetInFlight = false;
let passwordResetActionInFlight = false;
let signOutInFlight = false;
let currentStaff = null;
let runProducts = [];
let dieTypes = [];
let lastSelectedDieCode = "";
let productionWarehouse = null;
let runInventoryProducts = [];
let runInventoryProductsLoaded = false;
let stagedSupplies = [];
let stagedSuppliesRunId = null;
let stagedSuppliesLoadedAt = 0;
let stagedSuppliesLoading = false;
let stagedSuppliesDirty = true;
let runSupplyBusy = false;
let stageSupplyError = "";
let supplyPanelRunId = null;
let authGeneration = 0;
let bootstrapAvailable = false;
let bootstrapStatusInFlight = false;
let bootstrapInFlight = false;
let staffInFlight = false;
let staffGeneration = 0;
let staffDirectory = null;
let staffHistoryCursor = null;
let staffHistoryInFlight = false;
let managerDiagnosticsInFlight = false;
let managerDiagnosticsGeneration = 0;
let serverStateConfirmed = false;
let lastKnownRun = null;
let selectedStationKey = "line";
let stationActionInFlight = false;
let stationConflictDraft = null;
let cachedServerClock = null;
let pendingCreate = loadPendingCreate();

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function getCsrfHeaders() {
  try {
    const cookie = document.cookie.split(";").map((part) => part.trim());
    const values = cookie.filter((part) => part.startsWith("v2_csrf="));
    if (values.length !== 1) return null;
    const token = values[0].slice("v2_csrf=".length);
    return /^[A-Za-z0-9_-]{43}$/.test(token) ? { "X-CSRF-Token": token } : null;
  } catch {
    return null;
  }
}

function isTimestamp(value, nullable = false) {
  if (nullable && value === null) return true;
  if (typeof value !== "string") return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString() === value;
}

function isIngredientSnapshot(value) {
  if (value === undefined) return true;
  if (!isObject(value) || !["linked", "unknown"].includes(value.status)) return false;
  if (value.status === "unknown") {
    return typeof value.reason === "string" && value.reason.length >= 1 && value.reason.length <= 80
      && (value.linkEventId === undefined || UUID.test(value.linkEventId));
  }
  return typeof value.ingredientCode === "string"
    && /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u.test(value.ingredientCode)
    && typeof value.ingredientName === "string" && value.ingredientName.length >= 1 && value.ingredientName.length <= 200
    && Array.isArray(value.allergens) && value.allergens.length <= 32
    && value.allergens.every((allergen) => typeof allergen === "string" && allergen.length <= 80)
    && typeof value.allergensReviewed === "boolean"
    && UUID.test(value.linkEventId)
    && isTimestamp(value.ingredientUpdatedAt);
}

function isInventoryPlanLine(line) {
  return isObject(line) && typeof line.productId === "string" && UUID.test(line.productId)
    && typeof line.productCode === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u.test(line.productCode)
    && typeof line.productName === "string" && line.productName.length >= 1 && line.productName.length <= 120
    && typeof line.unit === "string" && /^[A-Za-z][A-Za-z0-9._/-]{0,15}$/u.test(line.unit)
    && typeof line.quantity === "string"
    && /^(0|[1-9][0-9]{0,11})(\.[0-9]{1,6})?$/u.test(line.quantity)
    && Number(line.quantity) > 0
    && isIngredientSnapshot(line.ingredientSnapshot);
}

function isProductionPlan(value) {
  return isObject(value)
    && typeof value.code === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u.test(value.code)
    && typeof value.name === "string" && value.name.length >= 1 && value.name.length <= 120
    && isObject(value.warehouse) && typeof value.warehouse.id === "string" && UUID.test(value.warehouse.id)
    && typeof value.warehouse.name === "string" && value.warehouse.name.length >= 1 && value.warehouse.name.length <= 120
    && Array.isArray(value.recipes) && value.recipes.length >= 1 && value.recipes.length <= 20
    && value.recipes.every((recipe) => isObject(recipe)
      && typeof recipe.code === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u.test(recipe.code)
      && typeof recipe.name === "string" && recipe.name.length >= 1 && recipe.name.length <= 120
      && ["dough", "cheese", "pepperoni", "sauce", "frontline"].includes(recipe.stationKey)
      && Array.isArray(recipe.ingredients) && recipe.ingredients.length >= 1 && recipe.ingredients.length <= 200
      && recipe.ingredients.every(isInventoryPlanLine))
    && Array.isArray(value.packagingPerCase) && value.packagingPerCase.length >= 1 && value.packagingPerCase.length <= 200
    && value.packagingPerCase.every(isInventoryPlanLine);
}

function validateRun(run) {
  if (!isObject(run) || typeof run.id !== "string" || !UUID.test(run.id)
    || !RUN_STATUSES.has(run.status) || !Number.isSafeInteger(run.revision) || run.revision < 0
    || !isTimestamp(run.createdAt) || !isTimestamp(run.updatedAt)
    || !isTimestamp(run.startedAt, true) || !isTimestamp(run.pausedAt, true)
    || !isTimestamp(run.resumedAt, true) || !isTimestamp(run.completedAt, true)
    || !isObject(run.setupSnapshot) || typeof run.setupSnapshot.label !== "string"
    || !run.setupSnapshot.label.trim() || !Number.isSafeInteger(run.setupSnapshot.targetCases)
    || run.setupSnapshot.targetCases < 1 || !Array.isArray(run.pauseIntervals)) {
    throw new Error("The server returned run data in an unexpected format. Refresh to load the current state.");
  }
  if (run.setupSnapshot.productCode !== undefined
    && (typeof run.setupSnapshot.productCode !== "string"
      || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u.test(run.setupSnapshot.productCode))) {
    throw new Error("The server returned a run with an invalid product link. Refresh to load the current state.");
  }
  if (run.setupSnapshot.productionSetupCode !== undefined
    && (typeof run.setupSnapshot.productionSetupCode !== "string"
      || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u.test(run.setupSnapshot.productionSetupCode))) {
    throw new Error("The server returned a run with an invalid production setup link. Refresh to load the current state.");
  }
  if (run.setupSnapshot.productionPlan !== undefined
    && (!run.setupSnapshot.productCode || !run.setupSnapshot.productionSetupCode
      || !isProductionPlan(run.setupSnapshot.productionPlan))) {
    throw new Error("The server returned an invalid frozen production plan. Refresh to load the current state.");
  }
  if (run.setupSnapshot.dieSetup !== undefined) {
    const die = run.setupSnapshot.dieSetup;
    if (!isObject(die)
      || typeof die.dieTypeCode !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u.test(die.dieTypeCode)
      || typeof die.dieTypeName !== "string" || !die.dieTypeName.trim() || die.dieTypeName.length > 120
      || !["active", "disabled", "unreviewed"].includes(die.defaultStatus)
      || !Number.isSafeInteger(die.defaultRevision) || die.defaultRevision < 0
      || !isDieLineSettings(die.lineSettings)
      || Object.keys(die.lineSettings).sort().join("\u0000") !== [...DIE_DEFAULT_FIELDS].sort().join("\u0000")
      || Object.keys(die).sort().join(",")
        !== ["defaultRevision", "defaultStatus", "dieTypeCode", "dieTypeName", "lineSettings"].sort().join(",")) {
      throw new Error("The server returned invalid frozen die setup. Refresh to load the current state.");
    }
  }
  if (run.doughCapacity !== undefined
    && (!isObject(run.doughCapacity)
      || !["available", "unavailable"].includes(run.doughCapacity.status)
      || !Array.isArray(run.doughCapacity.reasons)
      || run.doughCapacity.reasons.some((reason) => typeof reason !== "string" || reason.length > 80)
      || (run.doughCapacity.status === "available"
        && (typeof run.doughCapacity.doughballYield !== "number"
          || !Number.isFinite(run.doughCapacity.doughballYield)
          || typeof run.doughCapacity.pizzasPerCase !== "number"
          || !Number.isSafeInteger(run.doughCapacity.pizzasPerCase))))) {
    throw new Error("The server returned invalid dough source status. Refresh to load the current state.");
  }
  if (run.serverNow !== undefined && !isTimestamp(run.serverNow)) {
    throw new Error("The server returned an invalid server clock. Refresh to load the current state.");
  }
  if (run.inventoryConsumption !== undefined && run.inventoryConsumption !== null) {
    const receipt = run.inventoryConsumption;
    if (!isObject(receipt) || receipt.status !== "completed" || receipt.runId !== run.id
      || !UUID.test(receipt.warehouseId) || typeof receipt.warehouseName !== "string"
      || !isTimestamp(receipt.occurredAt) || !Array.isArray(receipt.lines)
      || receipt.lines.some((line) => !isObject(line) || !UUID.test(line.productId)
        || typeof line.productCode !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u.test(line.productCode)
        || typeof line.productName !== "string" || typeof line.unit !== "string"
        || ["required", "deducted", "shortfall"].some((key) =>
          typeof line[key] !== "string" || !/^(0|[1-9][0-9]{0,13})(\.[0-9]{1,6})?$/u.test(line[key])))) {
      throw new Error("The server returned invalid inventory usage details. Refresh to load the current state.");
    }
  }
  if (typeof run.serverNow === "string") {
    cachedServerClock = { serverMs: Date.parse(run.serverNow), receivedAt: performance.now() };
  }
  if (run.stationProgress !== undefined) {
    if (!isObject(run.stationProgress)) {
      throw new Error("The server returned station data in an unexpected format. Refresh to load the current state.");
    }
    for (const [stationKey, state] of Object.entries(run.stationProgress)) {
      const definition = STATIONS[stationKey];
      const progressFields = new Set([...definition?.progress || [], ...TIMER_FIELDS, ...TRACKING_FIELDS]);
      if (!Object.hasOwn(STATIONS, stationKey) || !isObject(state)
        || !Number.isSafeInteger(state.revision) || state.revision < 0
        || !STATION_STATUSES.has(state.status)
        || !isObject(state.inputs) || !isObject(state.progress)
        || Object.entries(state.inputs).some(([key, value]) =>
          !definition.inputs.includes(key) || typeof value !== "number" || !Number.isFinite(value) || value < 0)
        || Object.entries(state.progress).some(([key, value]) => {
          if (!progressFields.has(key)) return true;
          if (key === "timerStatus") return !TIMER_STATUSES.has(value);
          if (key === "timerStartedAt" || key === "timerPausedAt" || key === "autoTrackLastAt") return !isTimestamp(value, true);
          return typeof value !== "number" || !Number.isFinite(value) || value < 0;
        })
        || !isTimestamp(state.updatedAt)
        || !isTimestamp(state.startedAt, true)
        || !isTimestamp(state.pausedAt, true)
        || !isTimestamp(state.completedAt, true)
        || !isTimestamp(state.nextDueAt, true)) {
        throw new Error("The server returned invalid station progress. Refresh to load the current state.");
      }
    }
  }
  for (const interval of run.pauseIntervals) {
    if (!isObject(interval) || !isTimestamp(interval.startedAt) || !isTimestamp(interval.endedAt, true)) {
      throw new Error("The server returned run history in an unexpected format. Refresh to load the current state.");
    }
  }
  return run;
}

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function readJson(response, { allowCommandConflict = false, allowStationConflict = false } = {}) {
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error("The server response could not be read. Refresh and try again.");
  }
  const knownCommandConflict = allowCommandConflict && response.status === 409
    && ["conflict", "invalid_transition"].includes(body?.outcome);
  const knownStationConflict = allowStationConflict && response.status === 409
    && ["conflict", "invalid_transition"].includes(body?.outcome);
  if (!response.ok && !knownCommandConflict && !knownStationConflict) {
    const message = isObject(body) && typeof body.error === "string"
      ? body.error
      : "The request was not accepted. Refresh the run state before trying again.";
    throw new ApiError(response.status, message);
  }
  if (!isObject(body)) throw new Error("The server returned an unexpected response. Refresh and try again.");
  return body;
}

function announce(message) {
  el.announcer.textContent = "";
  window.setTimeout(() => { el.announcer.textContent = message; }, 20);
}

function showError(message, title = "Could not update run state") {
  el.errorTitle.textContent = title;
  el.errorMessage.textContent = message;
  el.globalError.hidden = false;
}

function clearError() {
  el.globalError.hidden = true;
}

function isStaffRecord(staff) {
  return isObject(staff)
    && typeof staff.userId === "string"
    && UUID.test(staff.userId)
    && typeof staff.username === "string"
    && staff.username.length >= 3
    && staff.username.length <= 40
    && typeof staff.role === "string"
    && staff.role.length > 0
    && Array.isArray(staff.capabilities)
    && staff.capabilities.length <= 100
    && staff.capabilities.every((capability) => typeof capability === "string" && capability.length <= 80);
}

function clearUserScopedState() {
  authGeneration += 1;
  staffGeneration += 1;
  staffHistoryCursor = null;
  staffHistoryInFlight = false;
  managerDiagnosticsGeneration += 1;
  managerDiagnosticsInFlight = false;
  qc.clear();
  runs = [];
  selectedRunId = null;
  lastKnownRun = null;
  serverStateConfirmed = false;
  stationConflictDraft = null;
  runInventoryProducts = [];
  runInventoryProductsLoaded = false;
  stagedSupplies = [];
  stagedSuppliesRunId = null;
  stagedSuppliesLoadedAt = 0;
  supplyPanelRunId = null;
  updateInventoryContext(currentStaff, false);
  updateScheduleContext(currentStaff, false);
  updateMixPlanContext(currentStaff, serverStateConfirmed);
  render();
}

function canWriteNow() {
  return canWriteRunState({
    authenticated: Boolean(currentStaff),
    online: typeof navigator === "undefined" || navigator.onLine !== false,
    serverStateConfirmed,
  });
}

function enterOfflineMode() {
  serverStateConfirmed = false;
  updateInventoryContext(currentStaff, false);
  updateScheduleContext(currentStaff, false);
  updateMixPlanContext(currentStaff, serverStateConfirmed);
  setConnection(false);
  updateCreateFormForAuth();
  renderRun(selectedRun());
  renderStationPanel(selectedRun());
  if (currentStaff) {
    saveOfflineCache();
    showError("This device is offline. V2 is read-only until a fresh server check succeeds.", "Offline — read-only");
  }
}

function saveOfflineCache() {
  if (!currentStaff || runs.length === 0) return;
  try {
    localStorage.setItem(OFFLINE_CACHE_KEY, JSON.stringify({
      savedAt: new Date().toISOString(),
      staff: {
        userId: currentStaff.userId,
        username: currentStaff.username,
        role: currentStaff.role,
        capabilities: currentStaff.capabilities,
      },
      runs,
      selectedRunId,
      stationKey: selectedStationKey,
    }));
  } catch {
    // A full browser store must not prevent online or offline read-only use.
  }
}

function clearOfflineCache() {
  try {
    localStorage.removeItem(OFFLINE_CACHE_KEY);
  } catch {
    // Cache cleanup is best-effort; it never changes server authorization.
  }
}

function restoreOfflineCache() {
  try {
    const saved = JSON.parse(localStorage.getItem(OFFLINE_CACHE_KEY) || "null");
    if (!isObject(saved) || !isStaffRecord(saved.staff) || !Array.isArray(saved.runs)
      || saved.runs.length > 100 || !isTimestamp(saved.savedAt)) return null;
    const cachedRuns = saved.runs.map(validateRun);
    if (!cachedRuns.length) return null;
    return {
      staff: saved.staff,
      runs: cachedRuns,
      selectedRunId: UUID.test(saved.selectedRunId || "") ? saved.selectedRunId : null,
      stationKey: Object.hasOwn(STATIONS, saved.stationKey) ? saved.stationKey : "line",
      savedAt: saved.savedAt,
    };
  } catch {
    return null;
  }
}

function showOfflineCachedSession(saved) {
  authGeneration += 1;
  currentStaff = saved.staff;
  runs = saved.runs;
  selectedRunId = runs.some((run) => run.id === saved.selectedRunId)
    ? saved.selectedRunId
    : runs.find((run) => run.status === "running" || run.status === "paused")?.id || runs[0]?.id || null;
  selectedStationKey = saved.stationKey;
  lastKnownRun = selectedRun();
  serverStateConfirmed = false;
  el.authPanel.hidden = true;
  el.authenticatedApp.hidden = false;
  el.accountControls.hidden = false;
  el.staffLabel.textContent = `${saved.staff.username} · ${saved.staff.role}`;
  el.signOut.disabled = false;
  setConnection(false);
  updateCreateFormForAuth();
  render();
  const savedTime = new Intl.DateTimeFormat(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  }).format(new Date(saved.savedAt));
  showError(`Showing the last server-confirmed state saved ${savedTime}. Changes are unavailable until the connection is confirmed.`, "Offline — read-only");
}

function requireWritableState() {
  if (!currentStaff) {
    showSignIn("Sign in to load the current server state before changing anything.");
    return false;
  }
  if (navigator.onLine === false) {
    enterOfflineMode();
    return false;
  }
  if (!serverStateConfirmed) {
    showError("The server has not confirmed current state. Refresh and wait for confirmation before changing anything.", "Read-only until refreshed");
    return false;
  }
  return true;
}

function updateCreateFormForAuth() {
  const writable = canWriteNow();
  const selectedProduct = runProducts.find((product) => product.code === el.product.value);
  const hasSetups = Array.isArray(selectedProduct?.productionSetups) && selectedProduct.productionSetups.length > 0;
  const hasProductionWarehouse = productionWarehouse !== null;
  const setupSelected = hasSetups && selectedProduct.productionSetups.some((setup) => setup.code === el.productionSetup.value);
  const selectedSetup = selectedProduct?.productionSetups?.find((setup) => setup.code === el.productionSetup.value);
  el.dieType.disabled = createInFlight || !writable || Boolean(pendingCreate)
    || !selectedSetup?.hasDoughRecipe || dieTypes.length === 0;
  el.dieFields.querySelectorAll("input").forEach((input) => {
    input.disabled = createInFlight || !writable || Boolean(pendingCreate) || !selectedSetup?.hasDoughRecipe;
  });
  if (!pendingCreate) {
    el.label.disabled = createInFlight || !writable;
    el.target.disabled = createInFlight || !writable;
    el.product.disabled = createInFlight || !writable || runProducts.length === 0;
    el.productionSetup.disabled = createInFlight || !writable || !hasSetups;
    el.createButton.disabled = createInFlight || !writable || runProducts.length === 0
      || !hasProductionWarehouse || !setupSelected;
    el.createButton.textContent = "Prepare run";
    el.createNote.textContent = !writable
      ? "The server creates the run in planned status. No run starts until an operator starts it."
      : runProducts.length === 0
        ? "Import products before preparing a run."
        : !hasProductionWarehouse
          ? "A manager must designate an active warehouse with an applied opening count before preparing runs."
          : !hasSetups
            ? "Import a production setup with linked station recipes and packaging for this product."
            : "The server freezes this recipe and warehouse on the run. Completion deducts actual tracked batches and packed cases once, and records any shortage.";
    return;
  }
  el.label.disabled = true;
  el.target.disabled = true;
  el.product.disabled = true;
  el.productionSetup.disabled = true;
  const belongsToCurrentStaff = currentStaff?.userId === pendingCreate.actorId;
  el.createButton.disabled = !belongsToCurrentStaff || createInFlight || !writable;
  el.createButton.textContent = belongsToCurrentStaff ? "Retry same request" : "Another account's request";
  el.createNote.textContent = belongsToCurrentStaff
    ? "The server may have received this request. Retry uses the same request ID and run details."
    : "This unconfirmed request belongs to another staff account. Sign in as that person to confirm it.";
}

function showAuthError(title, message) {
  el.authErrorTitle.textContent = title;
  el.authErrorMessage.textContent = message;
  el.authError.hidden = false;
}

function showSignIn(message = null, { title = "Sign-in needed", retry = false } = {}) {
  if (currentStaff) {
    clearOfflineCache();
    clearUserScopedState();
  }
  currentStaff = null;
  staffGeneration += 1;
  staffDirectory = null;
  staffHistoryCursor = null;
  staffHistoryInFlight = false;
  managerDiagnosticsGeneration += 1;
  managerDiagnosticsInFlight = false;
  updateInventoryContext(null, false);
  updateScheduleContext(null, false);
  updateMixPlanContext(null, false);
  updateManagerOperationsContext(null);
  el.authPanel.hidden = false;
  el.authForm.hidden = false;
  el.passwordRecoveryLinks.hidden = false;
  el.passwordResetRequestForm.hidden = true;
  el.passwordResetCompletionForm.hidden = true;
  el.passwordResetStatus.hidden = true;
  el.bootstrapForm.hidden = true;
  el.setupToggle.hidden = !bootstrapAvailable;
  el.setupToggle.setAttribute("aria-expanded", "false");
  el.authSubmit.disabled = authInFlight;
  el.authRetry.hidden = !retry;
  el.authStatus.textContent = message ? "Your session is not confirmed." : "Sign in to load the current server state.";
  el.accountControls.hidden = true;
  el.staffPanel.hidden = true;
  el.passwordResetPanel.hidden = true;
  el.passwordResetCodePanel.hidden = true;
  el.passwordResetIssuedCode.textContent = "";
  el.passwordResetCodeExpiry.textContent = "";
  el.authenticatedApp.hidden = true;
  if (message) showAuthError(title, message);
  else el.authError.hidden = true;
  updateCreateFormForAuth();
  if (!authInFlight) {
    window.requestAnimationFrame(() => el.authUsername.focus());
  }
  void refreshBootstrapAvailability();
}

function showAuthenticated(staff) {
  if (!isStaffRecord(staff)) {
    throw new Error("The server returned an unexpected staff session. Sign in again.");
  }
  if (currentStaff?.userId !== staff.userId) clearUserScopedState();
  currentStaff = staff;
  serverStateConfirmed = false;
  updateInventoryContext(currentStaff, false);
  updateScheduleContext(currentStaff, false);
  updateMixPlanContext(currentStaff, serverStateConfirmed);
  updateManagerOperationsContext(currentStaff);
  el.authPanel.hidden = true;
  el.passwordRecoveryLinks.hidden = true;
  el.passwordResetRequestForm.hidden = true;
  el.passwordResetCompletionForm.hidden = true;
  el.passwordResetStatus.hidden = true;
  el.bootstrapForm.hidden = true;
  el.setupToggle.hidden = true;
  el.authError.hidden = true;
  el.accountControls.hidden = false;
  el.authenticatedApp.hidden = false;
  el.staffLabel.textContent = `${staff.username} · ${staff.role}`;
  el.signOut.disabled = false;
  updateCreateFormForAuth();
  const canManageStaff = staffManagementAllowed(staff);
  el.staffPanel.hidden = !canManageStaff;
  if (canManageStaff) {
    void loadStaffDirectory();
    void loadStaffHistory();
    void loadStationWorkerStatus();
  }
  const canApprovePasswordResets = staff.capabilities.includes("approve-password-resets");
  document.querySelector("#schedule-nav-link").hidden = !staff.capabilities.includes("manage-factory-settings");
  document.querySelector("#setup-nav-link").hidden = !staff.capabilities.includes("manage-inventory");
  el.passwordResetPanel.hidden = !canApprovePasswordResets;
  if (canApprovePasswordResets) void loadPasswordResetQueue();
  announce(`Signed in as ${staff.username}.`);
  setConnection(true);
  document.querySelector("#page-title")?.focus();
  void fetchRuns();
}

function staffManagementAllowed(staff = currentStaff) {
  return isStaffRecord(staff) && staff.capabilities.includes("manage-staff");
}

async function refreshBootstrapAvailability() {
  if (currentStaff || bootstrapInFlight || bootstrapStatusInFlight) return;
  bootstrapStatusInFlight = true;
  const requestGeneration = authGeneration;
  let available = false;
  let statusError = false;
  try {
    const response = await fetch(`${AUTH_API}/bootstrap-status`, {
      method: "GET",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    const body = await readJson(response);
    if (typeof body.available !== "boolean") throw new Error("Setup status was incomplete.");
    available = body.available;
  } catch {
    available = false;
    statusError = true;
  } finally {
    bootstrapStatusInFlight = false;
  }
  if (currentStaff || requestGeneration !== authGeneration) return;
  if (statusError) {
    bootstrapAvailable = false;
    el.setupToggle.hidden = true;
    el.bootstrapForm.hidden = true;
    el.authForm.hidden = false;
    el.authStatus.textContent = "First-manager setup could not be checked.";
    el.authRetry.hidden = false;
    showAuthError("Setup status unavailable", "The app could not confirm whether first-manager setup is available. Check the connection, then try again.");
    return;
  }
  bootstrapAvailable = available;
  el.setupToggle.hidden = !bootstrapAvailable;
  if (!bootstrapAvailable) {
    el.bootstrapForm.hidden = true;
    el.authForm.hidden = false;
    el.setupToggle.setAttribute("aria-expanded", "false");
  }
}

function toggleBootstrapForm(show) {
  if (!bootstrapAvailable || bootstrapInFlight) return;
  el.authForm.hidden = show;
  el.passwordRecoveryLinks.hidden = show;
  el.passwordResetRequestForm.hidden = true;
  el.passwordResetCompletionForm.hidden = true;
  el.bootstrapForm.hidden = !show;
  el.setupToggle.hidden = show;
  el.setupToggle.setAttribute("aria-expanded", String(show));
  el.authError.hidden = true;
  if (show) el.bootstrapCode.focus();
  else el.authUsername.focus();
}

async function submitBootstrap(event) {
  event.preventDefault();
  if (bootstrapInFlight || !bootstrapAvailable) return;
  bootstrapInFlight = true;
  el.bootstrapSubmit.disabled = true;
  el.authError.hidden = true;
  try {
    const response = await fetch(`${AUTH_API}/bootstrap`, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        bootstrapCode: el.bootstrapCode.value,
        username: el.bootstrapUsername.value,
        password: el.bootstrapPassword.value,
      }),
    });
    const body = await readJson(response);
    if (!isStaffRecord(body.staff) || !isTimestamp(body.expiresAt)) {
      throw new Error("The server returned an incomplete setup result. Try again.");
    }
    bootstrapAvailable = false;
    el.bootstrapForm.reset();
    showAuthenticated(body.staff);
  } catch (error) {
    el.bootstrapCode.value = "";
    el.bootstrapPassword.value = "";
    showAuthError(
      error instanceof ApiError && error.status === 409 ? "Setup already completed" : "First-manager setup failed",
      error instanceof Error ? error.message : "Check the setup code and try again.",
    );
    if (error instanceof ApiError && error.status === 409) void refreshBootstrapAvailability();
  } finally {
    bootstrapInFlight = false;
    el.bootstrapSubmit.disabled = false;
  }
}

function showPasswordResetForm(kind) {
  if (authInFlight || bootstrapInFlight || passwordResetInFlight) return;
  el.authForm.hidden = true;
  el.bootstrapForm.hidden = true;
  el.setupToggle.hidden = true;
  el.passwordRecoveryLinks.hidden = true;
  el.passwordResetRequestForm.hidden = kind !== "request";
  el.passwordResetCompletionForm.hidden = kind !== "complete";
  el.passwordResetStatus.hidden = true;
  el.authError.hidden = true;
  if (kind === "request") el.passwordResetRequestUsername.focus();
  else el.passwordResetCompletionUsername.focus();
}

function returnToSignIn() {
  el.passwordResetRequestForm.hidden = true;
  el.passwordResetCompletionForm.hidden = true;
  el.authForm.hidden = false;
  el.passwordRecoveryLinks.hidden = false;
  el.setupToggle.hidden = !bootstrapAvailable;
  el.authError.hidden = true;
  el.authUsername.focus();
}

async function submitPasswordResetRequest(event) {
  event.preventDefault();
  if (passwordResetInFlight) return;
  if (navigator.onLine === false) {
    el.passwordResetStatus.textContent = "Reconnect before sending a recovery request.";
    el.passwordResetStatus.hidden = false;
    return;
  }
  passwordResetInFlight = true;
  el.passwordResetRequestSubmit.disabled = true;
  el.passwordResetStatus.hidden = true;
  try {
    const response = await fetch(`${AUTH_API}/password-reset-requests`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ username: el.passwordResetRequestUsername.value }),
    });
    const body = await readJson(response);
    if (response.status !== 202 || body.accepted !== true) {
      throw new Error("The recovery request could not be confirmed. Try again.");
    }
    el.passwordResetRequestForm.reset();
    el.passwordResetStatus.textContent = "If the account is active, a manager will review the request. Contact a manager for the one-time code after approval.";
    el.passwordResetStatus.hidden = false;
  } catch (error) {
    el.passwordResetStatus.textContent = error instanceof Error
      ? error.message
      : "The recovery request could not be confirmed. Check the connection and try again.";
    el.passwordResetStatus.hidden = false;
  } finally {
    passwordResetInFlight = false;
    el.passwordResetRequestSubmit.disabled = false;
  }
}

async function submitPasswordResetCompletion(event) {
  event.preventDefault();
  if (passwordResetInFlight) return;
  if (navigator.onLine === false) {
    showAuthError("Recovery unavailable", "Reconnect before setting a new password.");
    return;
  }
  passwordResetInFlight = true;
  el.passwordResetCompletionSubmit.disabled = true;
  el.authError.hidden = true;
  const username = el.passwordResetCompletionUsername.value;
  try {
    const response = await fetch(`${AUTH_API}/password-reset-completions`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        username,
        code: el.passwordResetCodeInput.value,
        newPassword: el.passwordResetNewPassword.value,
      }),
    });
    if (response.status !== 204) await readJson(response);
    el.passwordResetCompletionForm.reset();
    el.authUsername.value = username;
    returnToSignIn();
    el.authStatus.textContent = "Password updated. Sign in with the new password. If the reply was lost, try signing in or ask a manager for a replacement code.";
  } catch (error) {
    showAuthError(
      "Password recovery could not be completed",
      error instanceof Error
        ? `${error.message} If a previous reply was lost, try signing in with the new password; otherwise ask a manager for a replacement code.`
        : "Check the code and try again, or ask a manager for a replacement code.",
    );
    if (error instanceof ApiError && error.status === 401) {
      el.passwordResetCodeInput.value = "";
      el.passwordResetNewPassword.value = "";
    }
  } finally {
    passwordResetInFlight = false;
    el.passwordResetCompletionSubmit.disabled = false;
  }
}

function clearPasswordResetQueueError() {
  el.passwordResetQueueError.hidden = true;
  el.passwordResetQueueError.textContent = "";
}

function showPasswordResetQueueError(message) {
  el.passwordResetQueueError.textContent = message;
  el.passwordResetQueueError.hidden = false;
}

function isPasswordResetQueue(body) {
  return isObject(body)
    && Array.isArray(body.requests)
    && body.requests.length <= 100
    && body.requests.every((request) => isObject(request)
      && typeof request.requestId === "string" && UUID.test(request.requestId)
      && typeof request.staffId === "string" && UUID.test(request.staffId)
      && typeof request.username === "string" && request.username.length >= 3 && request.username.length <= 40
      && ["pending", "approved"].includes(request.state)
      && isTimestamp(request.requestedAt)
      && isTimestamp(request.decidedAt, true)
      && (request.state === "pending"
        ? request.codeExpiresAt === null
        : isTimestamp(request.codeExpiresAt)));
}

function renderPasswordResetQueue(requests) {
  if (requests.length === 0) {
    el.passwordResetQueue.innerHTML = '<li class="manager-list-notice">No recovery requests need review.</li>';
    return;
  }
  el.passwordResetQueue.innerHTML = requests.map((request) => {
    const requestedAt = new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(request.requestedAt));
    const isApproved = request.state === "approved";
    const expiryLabel = isApproved
      ? `Code active until ${new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(new Date(request.codeExpiresAt))}.`
      : `Requested ${requestedAt}.`;
    const actions = isApproved
      ? `<button type="button" class="staff-action-button" data-reset-action="reissue" data-reset-id="${escapeHtml(request.requestId)}" ${passwordResetActionInFlight ? "disabled" : ""}>Issue new code</button>
         <button type="button" class="staff-action-button danger" data-reset-action="deny" data-reset-id="${escapeHtml(request.requestId)}" ${passwordResetActionInFlight ? "disabled" : ""}>Cancel recovery</button>`
      : `<button type="button" class="staff-action-button" data-reset-action="approve" data-reset-id="${escapeHtml(request.requestId)}" ${passwordResetActionInFlight ? "disabled" : ""}>Approve</button>
         <button type="button" class="staff-action-button danger" data-reset-action="deny" data-reset-id="${escapeHtml(request.requestId)}" ${passwordResetActionInFlight ? "disabled" : ""}>Deny</button>`;
    return `<li class="manager-list-item">
      <span class="manager-list-copy"><strong>${escapeHtml(request.username)}</strong><span>${isApproved ? "Approved · " : ""}${escapeHtml(expiryLabel)}</span></span>
      <span class="manager-list-actions">${actions}</span>
    </li>`;
  }).join("");
}

async function loadPasswordResetQueue() {
  if (!currentStaff?.capabilities.includes("approve-password-resets") || passwordResetActionInFlight) return;
  el.passwordResetQueueStatus.textContent = "Loading recovery requests…";
  clearPasswordResetQueueError();
  try {
    const response = await fetch(`${AUTH_API}/password-reset-requests`, {
      method: "GET",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    const body = await readJson(response);
    if (!isPasswordResetQueue(body)) throw new Error("The server returned an unexpected recovery request list.");
    if (!currentStaff?.capabilities.includes("approve-password-resets")) return;
    renderPasswordResetQueue(body.requests);
    el.passwordResetQueueStatus.textContent = `${body.requests.length} active recovery request${body.requests.length === 1 ? "" : "s"}`;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      showSignIn("Your session has ended. Sign in again to review recovery requests.");
      return;
    }
    el.passwordResetQueueStatus.textContent = "Recovery requests could not be loaded.";
    showPasswordResetQueueError(error instanceof Error ? error.message : "Refresh and try again.");
  }
}

function showIssuedPasswordResetCode(result) {
  if (!isObject(result) || typeof result.code !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(result.code)
    || !isTimestamp(result.expiresAt)) {
    throw new Error("The server returned an incomplete recovery code. Refresh the queue and issue a new code.");
  }
  el.passwordResetIssuedCode.textContent = result.code;
  el.passwordResetCodeExpiry.textContent = `Expires ${new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(result.expiresAt))}.`;
  el.passwordResetCodePanel.hidden = false;
}

function clearIssuedPasswordResetCode() {
  el.passwordResetIssuedCode.textContent = "";
  el.passwordResetCodeExpiry.textContent = "";
  el.passwordResetCodePanel.hidden = true;
}

async function handlePasswordResetAction(event) {
  const button = event.target.closest("[data-reset-action]");
  if (!button || passwordResetActionInFlight) return;
  if (!currentStaff?.capabilities.includes("approve-password-resets")) return;
  const action = button.dataset.resetAction;
  const requestId = button.dataset.resetId;
  if (!UUID.test(requestId || "") || !["approve", "deny", "reissue"].includes(action)) return;
  if (navigator.onLine === false) {
    showPasswordResetQueueError("Reconnect before changing recovery requests.");
    return;
  }
  const csrf = getCsrfHeaders();
  if (!csrf) {
    showPasswordResetQueueError("Refresh your session before changing recovery requests.");
    return;
  }
  passwordResetActionInFlight = true;
  clearIssuedPasswordResetCode();
  clearPasswordResetQueueError();
  let refreshQueue = false;
  try {
    const endpoint = action === "reissue"
      ? `${AUTH_API}/password-reset-requests/${encodeURIComponent(requestId)}/reissue`
      : `${AUTH_API}/password-reset-requests/${encodeURIComponent(requestId)}/decision`;
    const response = await fetch(endpoint, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...csrf,
      },
      body: JSON.stringify(action === "reissue" ? {} : { decision: action }),
    });
    const result = await readJson(response);
    if (action === "approve" || action === "reissue") showIssuedPasswordResetCode(result);
    else if (result.outcome !== "denied") throw new Error("The recovery decision was not confirmed. Refresh and try again.");
    el.passwordResetQueueStatus.textContent = action === "deny"
      ? "Recovery request denied."
      : action === "reissue" ? "A replacement recovery code is ready." : "Recovery request approved.";
    refreshQueue = true;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      showSignIn("Your session has ended. Sign in again to review recovery requests.");
      return;
    }
    showPasswordResetQueueError(
      error instanceof Error
        ? `${error.message} Refresh the queue; if approval succeeded but its reply was lost, issue a replacement code.`
        : "The decision could not be confirmed. Refresh the queue before trying again.",
    );
    refreshQueue = true;
  } finally {
    passwordResetActionInFlight = false;
    if (refreshQueue && currentStaff?.capabilities.includes("approve-password-resets")) {
      void loadPasswordResetQueue();
    }
  }
}

function isStaffDirectory(body) {
  return isObject(body)
    && Array.isArray(body.staff)
    && body.staff.length <= 200
    && body.staff.every((staff) => isObject(staff)
      && typeof staff.userId === "string"
      && UUID.test(staff.userId)
      && typeof staff.username === "string"
      && staff.username.length >= 3
      && staff.username.length <= 40
      && typeof staff.role === "string"
      && staff.role.length > 0
      && typeof staff.disabled === "boolean"
      && isTimestamp(staff.createdAt))
    && Array.isArray(body.roles)
    && body.roles.length <= 100
    && body.roles.every((role) => isObject(role)
      && typeof role.name === "string"
      && role.name.length > 0
      && role.name.length <= 80
      && Array.isArray(role.capabilities)
      && role.capabilities.length <= 100
      && role.capabilities.every((capability) => typeof capability === "string" && capability.length <= 80));
}

function isStaffAccountState(value) {
  return isObject(value)
    && Object.keys(value).sort().join(",") === "disabled,roleName"
    && typeof value.disabled === "boolean"
    && typeof value.roleName === "string"
    && value.roleName.length > 0
    && value.roleName.length <= 80;
}

function isStaffHistoryPage(body) {
  return isObject(body)
    && Array.isArray(body.events)
    && body.events.length <= 50
    && body.events.every((event) => isObject(event)
      && UUID.test(event.id || "")
      && (event.actorType === "staff" && UUID.test(event.actorId || "")
        || event.actorType === "bootstrap" && event.actorId === null)
      && UUID.test(event.targetId || "")
      && typeof event.actorUsername === "string" && event.actorUsername.length >= 3 && event.actorUsername.length <= 40
      && typeof event.targetUsername === "string" && event.targetUsername.length >= 3 && event.targetUsername.length <= 40
      && ["created", "updated"].includes(event.changeType)
      && (event.before === null || isStaffAccountState(event.before))
      && isStaffAccountState(event.after)
      && isTimestamp(event.occurredAt))
    && typeof body.hasMore === "boolean"
    && (body.nextCursor === null || typeof body.nextCursor === "string"
      && body.nextCursor.length > 0 && body.nextCursor.length <= 256);
}

function isStationWorkerDiagnostic(value) {
  return isObject(value)
    && ["active", "standby", "degraded", "stale", "unavailable"].includes(value.status)
    && isTimestamp(value.checkedAt)
    && isTimestamp(value.lastCycleAt, true)
    && (value.ageSeconds === null || Number.isSafeInteger(value.ageSeconds) && value.ageSeconds >= 0)
    && (value.consecutiveFailures === null
      || Number.isSafeInteger(value.consecutiveFailures) && value.consecutiveFailures >= 0)
    && (value.processedLastCycle === null
      || Number.isSafeInteger(value.processedLastCycle) && value.processedLastCycle >= 0)
    && typeof value.nextStep === "string" && value.nextStep.length > 0 && value.nextStep.length <= 160
    && Object.keys(value).sort().join(",")
      === ["ageSeconds", "checkedAt", "consecutiveFailures", "lastCycleAt", "nextStep", "processedLastCycle", "status"].sort().join(",");
}

function staffChangeSummary(event) {
  if (event.changeType === "created") {
    return `Created account · ${event.after.roleName} · ${event.after.disabled ? "disabled" : "enabled"}`;
  }
  const changes = [];
  if (event.before.roleName !== event.after.roleName) {
    changes.push(`Role ${event.before.roleName} → ${event.after.roleName}`);
  }
  if (event.before.disabled !== event.after.disabled) {
    changes.push(event.after.disabled ? "Account disabled" : "Account enabled");
  }
  return changes.length ? changes.join(" · ") : "Account settings updated";
}

function renderStaffHistory(events, { append = false } = {}) {
  if (!append) el.staffHistoryList.replaceChildren();
  const markup = events.map((event) => `<li class="staff-history-item">
    <div><strong>${escapeHtml(event.targetUsername)}</strong><span>${escapeHtml(staffChangeSummary(event))}</span></div>
    <div class="staff-history-attribution"><span>${escapeHtml(event.actorUsername)}</span><time datetime="${escapeHtml(event.occurredAt)}">${escapeHtml(new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(event.occurredAt)))}</time></div>
  </li>`).join("");
  if (append) el.staffHistoryList.insertAdjacentHTML("beforeend", markup);
  else el.staffHistoryList.innerHTML = markup;
}

async function loadStaffHistory({ append = false } = {}) {
  if (!staffManagementAllowed() || staffHistoryInFlight) return;
  if (!append) staffHistoryCursor = null;
  staffHistoryInFlight = true;
  const generation = staffGeneration;
  el.staffHistoryStatus.textContent = append ? "Loading older account changes…" : "Loading account history…";
  el.staffHistoryMore.disabled = true;
  try {
    const params = new URLSearchParams({ limit: "20" });
    if (append && staffHistoryCursor) params.set("cursor", staffHistoryCursor);
    const response = await fetch(`${AUTH_API}/staff-history?${params}`, {
      method: "GET",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    const body = await readJson(response);
    if (!isStaffHistoryPage(body)) throw new Error("The server returned an unexpected account history page.");
    if (generation !== staffGeneration || !staffManagementAllowed()) return;
    renderStaffHistory(body.events, { append });
    staffHistoryCursor = body.nextCursor;
    el.staffHistoryMore.hidden = !body.hasMore;
    el.staffHistoryStatus.textContent = body.events.length
      ? `${append ? "More" : "Recent"} changes · ${body.events.length} shown on this page`
      : append ? "No older account changes." : "No account changes have been recorded.";
  } catch (error) {
    if (generation !== staffGeneration) return;
    if (error instanceof ApiError && error.status === 401) {
      showSignIn("Your session has ended. Sign in again to view account history.");
      return;
    }
    el.staffHistoryStatus.textContent = "Account history could not be loaded.";
  } finally {
    staffHistoryInFlight = false;
    el.staffHistoryMore.disabled = false;
  }
}

async function loadStationWorkerStatus() {
  if (!staffManagementAllowed() || managerDiagnosticsInFlight) return;
  managerDiagnosticsInFlight = true;
  const generation = managerDiagnosticsGeneration;
  el.stationWorkerRefresh.disabled = true;
  el.stationWorkerStatus.textContent = "Checking worker status…";
  try {
    const response = await fetch("/api/v2/manager-diagnostics/station-worker", {
      method: "GET",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    const body = await readJson(response);
    if (!isStationWorkerDiagnostic(body.stationWorker)) {
      throw new Error("The server returned unexpected station-worker status.");
    }
    if (generation !== managerDiagnosticsGeneration || !staffManagementAllowed()) return;
    const status = body.stationWorker;
    el.stationWorkerStatus.textContent = status.status;
    el.stationWorkerStatus.dataset.state = status.status;
    el.stationWorkerLastCycle.textContent = status.lastCycleAt
      ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(status.lastCycleAt))
      : "Not recorded";
    el.stationWorkerCycleAge.textContent = status.ageSeconds === null
      ? "Unknown"
      : status.ageSeconds < 60
        ? `${status.ageSeconds} seconds`
        : `${Math.floor(status.ageSeconds / 60)} minutes`;
    el.stationWorkerFailures.textContent = status.consecutiveFailures === null
      ? "Unknown"
      : String(status.consecutiveFailures);
    el.stationWorkerProcessed.textContent = status.processedLastCycle === null
      ? "Unknown"
      : String(status.processedLastCycle);
    el.stationWorkerNextStep.textContent = status.nextStep;
  } catch (error) {
    if (generation !== managerDiagnosticsGeneration) return;
    if (error instanceof ApiError && error.status === 401) {
      showSignIn("Your session has ended. Sign in again to view station-worker status.");
      return;
    }
    el.stationWorkerStatus.textContent = "Status unavailable";
    el.stationWorkerStatus.dataset.state = "unavailable";
    el.stationWorkerLastCycle.textContent = "Not available";
    el.stationWorkerCycleAge.textContent = "Unknown";
    el.stationWorkerFailures.textContent = "Unknown";
    el.stationWorkerProcessed.textContent = "Unknown";
    el.stationWorkerNextStep.textContent = "Refresh the status; if it remains unavailable, check the V2 services.";
  } finally {
    managerDiagnosticsInFlight = false;
    el.stationWorkerRefresh.disabled = false;
  }
}

function showStaffError(message) {
  el.staffError.textContent = message;
  el.staffError.hidden = false;
}

function clearStaffError() {
  el.staffError.hidden = true;
  el.staffError.textContent = "";
}

function renderStaffDirectory(directory) {
  staffDirectory = directory;
  el.staffRole.innerHTML = directory.roles
    .map((role) => `<option value="${escapeHtml(role.name)}">${escapeHtml(role.name)}</option>`)
    .join("");
  if (directory.staff.length === 0) {
    el.staffList.innerHTML = '<tr><td colspan="4">No staff accounts yet.</td></tr>';
    return;
  }
  el.staffList.innerHTML = directory.staff.map((staff) => {
    const self = staff.userId === currentStaff?.userId;
    const roleOptions = directory.roles.map((role) => `<option value="${escapeHtml(role.name)}" ${role.name === staff.role ? "selected" : ""}>${escapeHtml(role.name)}</option>`).join("");
    const actionMarkup = self
      ? '<span class="staff-self-note">Your account</span>'
      : `<div class="staff-actions">
          <label class="visually-hidden" for="staff-role-${escapeHtml(staff.userId)}">Role for ${escapeHtml(staff.username)}</label>
          <select id="staff-role-${escapeHtml(staff.userId)}" data-staff-role="${escapeHtml(staff.userId)}" ${staffInFlight ? "disabled" : ""}>${roleOptions}</select>
          <button type="button" class="staff-action-button" data-staff-action="role" data-staff-id="${escapeHtml(staff.userId)}" ${staffInFlight ? "disabled" : ""}>Save role</button>
          <button type="button" class="staff-action-button ${staff.disabled ? "" : "danger"}" data-staff-action="status" data-staff-id="${escapeHtml(staff.userId)}" ${staffInFlight ? "disabled" : ""}>${staff.disabled ? "Enable" : "Disable"}</button>
        </div>`;
    return `<tr>
      <th scope="row">${escapeHtml(staff.username)}</th>
      <td data-label="Status"><span class="staff-state ${staff.disabled ? "disabled" : "enabled"}">${staff.disabled ? "Disabled" : "Enabled"}</span></td>
      <td data-label="Role">${escapeHtml(staff.role)}</td>
      <td data-label="Actions">${actionMarkup}</td>
    </tr>`;
  }).join("");
}

async function loadStaffDirectory() {
  if (!staffManagementAllowed() || staffInFlight) return;
  const generation = ++staffGeneration;
  el.staffStatus.textContent = "Loading staff accounts…";
  clearStaffError();
  try {
    const response = await fetch(`${AUTH_API}/staff`, {
      method: "GET",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    const body = await readJson(response);
    if (!isStaffDirectory(body)) throw new Error("The server returned an unexpected staff list.");
    if (generation !== staffGeneration || !staffManagementAllowed()) return;
    renderStaffDirectory(body);
    el.staffStatus.textContent = `${body.staff.length} staff account${body.staff.length === 1 ? "" : "s"}`;
  } catch (error) {
    if (generation !== staffGeneration) return;
    if (error instanceof ApiError && error.status === 401) {
      showSignIn("Your session has ended. Sign in again to manage staff accounts.");
      return;
    }
    el.staffStatus.textContent = "Staff accounts could not be loaded.";
    showStaffError(error instanceof Error ? error.message : "Refresh and try again.");
  }
}

async function sendStaffMutation(url, method, body) {
  if (!staffManagementAllowed() || staffInFlight) return;
  if (navigator.onLine === false) {
    showStaffError("Reconnect before changing staff accounts.");
    return;
  }
  const csrf = getCsrfHeaders();
  if (!csrf) {
    showStaffError("Refresh your session before changing staff accounts.");
    return;
  }
  staffInFlight = true;
  el.staffCreateButton.disabled = true;
  clearStaffError();
  try {
    const response = await fetch(url, {
      method,
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...csrf,
      },
      body: JSON.stringify(body),
    });
    const result = await readJson(response);
    if (!isStaffDirectory(result)) throw new Error("The server returned an unexpected staff list.");
    renderStaffDirectory(result);
    el.staffStatus.textContent = `${result.staff.length} staff account${result.staff.length === 1 ? "" : "s"}`;
    void loadStaffHistory();
    announce("Staff account changes saved.");
    return result;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      showSignIn("Your session has ended. Sign in again to manage staff accounts.");
      return;
    }
    showStaffError(error instanceof Error ? error.message : "The change could not be confirmed. Refresh and try again.");
  } finally {
    staffInFlight = false;
    el.staffCreateButton.disabled = false;
    if (staffDirectory) renderStaffDirectory(staffDirectory);
  }
}

async function submitStaffCreate(event) {
  event.preventDefault();
  if (staffInFlight) return;
  const result = await sendStaffMutation(`${AUTH_API}/staff`, "POST", {
    username: el.staffUsername.value,
    password: el.staffPassword.value,
    roleName: el.staffRole.value,
  });
  if (result) {
    el.staffCreateForm.reset();
    if (staffDirectory?.roles.length) el.staffRole.value = staffDirectory.roles[0].name;
  } else {
    el.staffPassword.value = "";
  }
}

async function handleStaffAction(event) {
  const button = event.target.closest("[data-staff-action]");
  if (!button || staffInFlight) return;
  const staff = staffDirectory?.staff.find((item) => item.userId === button.dataset.staffId);
  if (!staff || staff.userId === currentStaff?.userId) return;
  const patch = button.dataset.staffAction === "role"
    ? { roleName: el.staffList.querySelector(`[data-staff-role="${CSS.escape(staff.userId)}"]`)?.value }
    : { disabled: !staff.disabled };
  if (patch.roleName === undefined && button.dataset.staffAction === "role") {
    showStaffError("Choose a role before saving.");
    return;
  }
  await sendStaffMutation(`${AUTH_API}/staff/${encodeURIComponent(staff.userId)}`, "PATCH", patch);
}

async function checkSession() {
  if (authCheckInFlight || authInFlight) return;
  authCheckInFlight = true;
  el.authStatus.textContent = "Checking your saved session…";
  el.authForm.hidden = true;
  el.authRetry.hidden = true;
  el.authError.hidden = true;
  try {
    const response = await fetch(`${AUTH_API}/session`, {
      method: "GET",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    if (response.status === 401) {
      setConnection(true);
      clearOfflineCache();
      showSignIn();
      return;
    }
    const body = await readJson(response);
    showAuthenticated(body.staff);
  } catch (error) {
    setConnection(false);
    const saved = restoreOfflineCache();
    if (saved) {
      showOfflineCachedSession(saved);
      return;
    }
    showSignIn(
      "The app could not verify the saved session. Check the connection, then try again.",
      { title: "Session check unavailable", retry: true },
    );
  } finally {
    authCheckInFlight = false;
  }
}

async function submitSignIn(event) {
  event.preventDefault();
  if (authInFlight) return;
  authInFlight = true;
  el.authSubmit.disabled = true;
  el.authStatus.textContent = "Checking your staff account…";
  el.authError.hidden = true;
  el.authUsername.removeAttribute("aria-invalid");
  el.authPassword.removeAttribute("aria-invalid");
  try {
    const response = await fetch(`${AUTH_API}/sign-in`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        username: el.authUsername.value,
        password: el.authPassword.value,
      }),
    });
    const body = await readJson(response);
    if (!isStaffRecord(body.staff) || !isTimestamp(body.expiresAt)) {
      throw new Error("The server returned an incomplete sign-in result. Try again.");
    }
    el.authForm.reset();
    showAuthenticated(body.staff);
  } catch (error) {
    el.authPassword.value = "";
    if (error instanceof ApiError && error.status === 401) {
      el.authUsername.setAttribute("aria-invalid", "true");
      el.authPassword.setAttribute("aria-invalid", "true");
    }
    showAuthError(
      error instanceof ApiError && error.status === 401 ? "Sign-in failed" : "Sign-in could not be completed",
      error instanceof Error ? error.message : "Check your connection and try again.",
    );
    el.authStatus.textContent = "Your run state is not loaded until sign-in succeeds.";
  } finally {
    authInFlight = false;
    if (!currentStaff) el.authSubmit.disabled = false;
  }
}

async function signOut() {
  if (!currentStaff || authInFlight || signOutInFlight || createInFlight || commandInFlight || stationActionInFlight) return;
  const csrf = getCsrfHeaders();
  if (!csrf) {
    showError("Your CSRF session token is unavailable. Refresh the session before signing out.", "Sign-out unavailable");
    return;
  }
  signOutInFlight = true;
  el.signOut.disabled = true;
  try {
    const response = await fetch(`${AUTH_API}/sign-out`, {
      method: "POST",
      credentials: "same-origin",
      headers: { Accept: "application/json", ...csrf },
    });
    if (response.status !== 204) await readJson(response);
    clearOfflineCache();
    showSignIn("You are signed out. Sign in again to load current server state.");
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      clearOfflineCache();
      showSignIn("Your session has ended. Sign in again to load current server state.");
    } else {
      showError(error instanceof Error ? error.message : "The sign-out result is not confirmed. Check the connection and try again.", "Sign-out not confirmed");
    }
  } finally {
    signOutInFlight = false;
    el.signOut.disabled = false;
  }
}

function setConnection(online) {
  el.connection.dataset.state = online ? "online" : "offline";
  el.connectionLabel.textContent = online ? "Connected" : "Offline";
}

function setLastCheck() {
  el.lastCheck.textContent = new Intl.DateTimeFormat(undefined, {
    hour: "numeric", minute: "2-digit", second: "2-digit",
  }).format(new Date());
}

function formatDate(value) {
  if (!value) return "Not started";
  return new Intl.DateTimeFormat(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  }).format(new Date(value));
}

function statusLabel(status) {
  return status.replace("_", " ");
}

function pendingStorageKey(runId) {
  return `${PENDING_PREFIX}${runId}`;
}

function loadPendingCreate() {
  try {
    const raw = localStorage.getItem(PENDING_CREATE_KEY);
    if (!raw) return null;
    const pending = JSON.parse(raw);
    if (!isObject(pending) || !UUID.test(pending.requestId) || !UUID.test(pending.actorId)
      || !isObject(pending.setupSnapshot)
      || typeof pending.setupSnapshot.label !== "string" || !pending.setupSnapshot.label.trim()
       || !Number.isSafeInteger(pending.setupSnapshot.targetCases) || pending.setupSnapshot.targetCases < 1
       || (pending.setupSnapshot.productCode !== undefined
         && (typeof pending.setupSnapshot.productCode !== "string"
           || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u.test(pending.setupSnapshot.productCode)))
       || (pending.setupSnapshot.productionSetupCode !== undefined
         && (typeof pending.setupSnapshot.productionSetupCode !== "string"
           || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u.test(pending.setupSnapshot.productionSetupCode)))
       || (pending.setupSnapshot.dieSetup !== undefined && (
         !isObject(pending.setupSnapshot.dieSetup)
         || typeof pending.setupSnapshot.dieSetup.dieTypeCode !== "string"
         || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u.test(pending.setupSnapshot.dieSetup.dieTypeCode)
         || !Number.isSafeInteger(pending.setupSnapshot.dieSetup.expectedRevision)
         || pending.setupSnapshot.dieSetup.expectedRevision < 0
         || !isDieLineSettings(pending.setupSnapshot.dieSetup.lineSettings)
         || Object.keys(pending.setupSnapshot.dieSetup).sort().join(",")
           !== ["dieTypeCode", "expectedRevision", "lineSettings"].sort().join(",")
         || Object.keys(pending.setupSnapshot.dieSetup.lineSettings).sort().join("\u0000")
           !== [...DIE_DEFAULT_FIELDS].sort().join("\u0000")
       ))) return null;
    return pending;
  } catch {
    return null;
  }
}

function savePendingCreate(pending) {
  try {
    localStorage.setItem(PENDING_CREATE_KEY, JSON.stringify(pending));
    pendingCreate = pending;
    el.label.value = pending.setupSnapshot.label;
    el.target.value = String(pending.setupSnapshot.targetCases);
    if (pending.setupSnapshot.productCode) el.product.value = pending.setupSnapshot.productCode;
    if (pending.setupSnapshot.productionSetupCode) el.productionSetup.value = pending.setupSnapshot.productionSetupCode;
    updateCreateFormForAuth();
  } catch {
    pendingCreate = null;
    showError("This device could not save the request identity. Run creation is paused; refresh the register before trying again.", "Retry protection unavailable");
  }
}

function clearPendingCreate() {
  try {
    localStorage.removeItem(PENDING_CREATE_KEY);
    pendingCreate = null;
    updateCreateFormForAuth();
  } catch {
    showError("The server returned a result, but this device could not clear the saved request identity. Refresh the register before creating another run.", "Local storage unavailable");
  }
}

function getPending(runId) {
  try {
    const raw = localStorage.getItem(pendingStorageKey(runId));
    if (!raw) return null;
    const pending = JSON.parse(raw);
    if (!isObject(pending) || !UUID.test(pending.commandId) || !UUID.test(pending.actorId)
      || !COMMANDS.has(pending.commandType)
      || !Number.isSafeInteger(pending.expectedRevision) || pending.expectedRevision < 0
      || pending.runId !== runId) return null;
    return pending;
  } catch {
    return null;
  }
}

function storePending(pending) {
  try {
    localStorage.setItem(pendingStorageKey(pending.runId), JSON.stringify(pending));
    return true;
  } catch {
    showError("This device could not save the retry identity. Do not repeat the action on another device; refresh to check the server state.", "Retry protection unavailable");
    return false;
  }
}

function clearPending(runId) {
  try {
    localStorage.removeItem(pendingStorageKey(runId));
  } catch {
    showError("The server responded, but this device could not clear its saved retry identity. Refresh state before another action.", "Local storage unavailable");
  }
}

function renderRun(run) {
  el.revision.textContent = run ? `REV ${String(run.revision).padStart(2, "0")}` : "—";
  if (!run) {
    el.runContent.innerHTML = `<div class="status-row"><span class="status-pill planned">No run selected</span></div>
      <h2 class="run-label" id="run-label">Ready when you are</h2>
      <p class="run-meta">Prepare a run below to begin production control.</p>
      <div class="run-divider"></div><p class="control-label">RUN CONTROLS</p>
      <p class="control-note">Create a planned run before starting production.</p>`;
    return;
  }
  const pending = getPending(run.id);
  const pendingOwnedByCurrentStaff = pending?.actorId === currentStaff?.userId;
  const actions = {
    planned: [["start", "Start run", "primary"]],
    running: [["pause", "Pause run", "secondary"], ["complete", "Finish run", "caution"]],
    paused: [["resume", "Resume run", "primary"], ["complete", "Finish run", "caution"]],
    completed: [],
  }[run.status];
  const actionMarkup = actions.length
    ? actions.map(([command, label, style]) => `<button class="button button-${style}" type="button" data-command="${command}" data-testid="button-${command}" ${pending || commandInFlight || !canWriteNow() ? "disabled" : ""}>${label}${command === "start" || command === "resume" ? '<span class="button-arrow" aria-hidden="true">→</span>' : ""}</button>`).join("")
    : `<p class="control-note">This run is finished. Its state remains available in the server register.</p>`;
  const pendingMarkup = pending
    ? `<div class="pending-box" role="status"><p><strong>${pendingOwnedByCurrentStaff ? `${escapeHtml(commandTitle(pending.commandType))} needs confirmation.` : "This saved action belongs to another staff account."}</strong> ${pendingOwnedByCurrentStaff ? "The request may have reached the server. Retry sends the same command identity." : "Sign in as the original operator to confirm it. It will not be resent under this account."}</p>${pendingOwnedByCurrentStaff ? `<button type="button" data-retry-command="true" data-testid="button-retry-command" ${commandInFlight || !canWriteNow() ? "disabled" : ""}>Retry same action</button>` : ""}</div>`
    : "";
  const inventoryMarkup = run.inventoryConsumption
    ? renderInventoryReceipt(run.inventoryConsumption)
    : "";
  el.runContent.innerHTML = `<div class="status-row"><span class="status-pill ${run.status}" data-testid="status-run">${statusLabel(run.status)}</span></div>
    <h2 class="run-label" id="run-label" data-testid="text-run-label">${escapeHtml(run.setupSnapshot.label)}</h2>
    <div class="run-meta"><span><i class="meta-marker" aria-hidden="true"></i>${run.setupSnapshot.targetCases.toLocaleString()} target cases</span><span><i class="meta-marker" aria-hidden="true"></i>${run.setupSnapshot.productCode ? escapeHtml(productName(run.setupSnapshot.productCode)) : "Product not linked"}</span><span><i class="meta-marker" aria-hidden="true"></i>${run.setupSnapshot.productionPlan ? `Setup ${escapeHtml(run.setupSnapshot.productionPlan.name)}` : "Production setup not linked"}</span><span><i class="meta-marker" aria-hidden="true"></i>${run.startedAt ? `Started ${escapeHtml(formatDate(run.startedAt))}` : `Created ${escapeHtml(formatDate(run.createdAt))}`}</span></div>
    <div class="run-divider"></div><p class="control-label">RUN CONTROLS</p>
    ${renderProductionRules(run.productionRules)}
    <div class="controls">${actionMarkup}</div>${pendingMarkup}${inventoryMarkup}`;
  el.runContent.querySelectorAll("[data-command]").forEach((button) => {
    button.addEventListener("click", () => beginCommand(run, button.dataset.command));
  });
  const retry = el.runContent.querySelector("[data-retry-command]");
  if (retry) retry.addEventListener("click", () => retryCommand(run.id));
}

function renderProductionRules(findings) {
  if (!Array.isArray(findings)) return "";
  const warnings = findings.filter((item) => isObject(item)
    && ["unknown", "violated", "bypassed"].includes(item.status));
  if (!warnings.length) return "";
  return `<section class="pending-box" aria-label="Production rule review"><h3>Production rules</h3><ul>${
    warnings.map((item) => `<li>${escapeHtml(item.name)}: ${escapeHtml(item.status)} · ${
      item.enforcement === "strict" && item.status !== "bypassed"
        ? "Start blocked; correct the required setup or review the imported rule."
        : item.status === "bypassed"
          ? "Approved imported bypass matched."
          : "Warning; review before production."
    }</li>`).join("")
  }</ul><p>Unknown means the required input is unavailable, not that the rule passed.</p></section>`;
}

function renderInventoryReceipt(receipt) {
  const shortages = receipt.lines.filter((line) => Number(line.shortfall) > 0);
  const lines = receipt.lines.slice(0, 20).map((line) => {
    const shortage = Number(line.shortfall) > 0
      ? ` · short by ${escapeHtml(line.shortfall)} ${escapeHtml(line.unit)}`
      : "";
    const substitution = line.plannedProductCode && line.plannedProductCode !== line.productCode
      ? ` · for ${escapeHtml(line.plannedProductCode)}`
      : "";
    const staged = line.staged ? " · staged" : "";
    return `<li><span>${escapeHtml(line.productName)} · ${escapeHtml(line.productCode)}${substitution}${staged}</span><span>${escapeHtml(line.deducted)} ${escapeHtml(line.unit)} deducted${shortage}</span></li>`;
  }).join("");
  const extra = receipt.lines.length > 20
    ? `<p class="manager-help">${receipt.lines.length - 20} additional inventory lines are included in the receipt.</p>`
    : "";
  return `<section class="inventory-receipt${shortages.length ? " has-shortage" : ""}" aria-label="Completed run inventory receipt">
    <h3>Inventory receipt</h3>
    <p>Stock deducted from ${escapeHtml(receipt.warehouseName)} at ${escapeHtml(formatDate(receipt.occurredAt))}.</p>
    ${shortages.length
      ? `<p role="status">${shortages.length} product${shortages.length === 1 ? "" : "s"} had less stock than required. The run still completed; review the shortage.</p>`
      : ""}
    ${lines ? `<ul>${lines}</ul>` : "<p>No tracked recipe or packaging quantities were consumed.</p>"}${extra}
  </section>`;
}

function isRunStageItem(item) {
  return isObject(item) && UUID.test(item.id) && UUID.test(item.runId)
    && UUID.test(item.warehouseId) && typeof item.plannedProductCode === "string"
    && typeof item.plannedProductName === "string" && typeof item.actualProductCode === "string"
    && typeof item.actualProductName === "string" && typeof item.unit === "string"
    && typeof item.quantity === "string" && /^(0|[1-9][0-9]{0,11})(\.[0-9]{1,6})?$/u.test(item.quantity)
    && typeof item.used === "string" && typeof item.released === "string"
    && typeof item.reason === "string" && typeof item.actorId === "string"
    && UUID.test(item.actorId) && typeof item.occurredAt === "string"
    && Number.isFinite(Date.parse(item.occurredAt));
}

function stagePendingKey(runId) {
  return `fieldline:v2:staged-supply:${runId}`;
}

function loadStagePending(runId) {
  try {
    const value = JSON.parse(localStorage.getItem(stagePendingKey(runId)) || "null");
    const payload = value?.payload;
    if (!isObject(value) || !UUID.test(value.actorId) || !isObject(payload)
      || typeof payload.commandId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(payload.commandId)
      || payload.runId !== runId || typeof payload.plannedProductCode !== "string"
      || typeof payload.actualProductCode !== "string" || typeof payload.quantity !== "string"
      || typeof payload.reason !== "string") return null;
    return value;
  } catch {
    return null;
  }
}

function plannedInventoryProducts(run) {
  const plan = run?.setupSnapshot?.productionPlan;
  if (!plan) return [];
  const lines = [
    ...plan.recipes.flatMap((recipe) => recipe.ingredients),
    ...plan.packagingPerCase,
  ];
  const unique = new Map(lines.map((line) => [line.productId, line]));
  return [...unique.values()].sort((a, b) => a.productName.localeCompare(b.productName));
}

function fillSupplySelect(select, records, preferred, label) {
  select.replaceChildren();
  records.forEach((record) => {
    const option = document.createElement("option");
    option.value = record.productCode;
    option.textContent = `${record.productName} · ${record.productCode} (${record.unit})${label ? ` · ${label}` : ""}`;
    select.append(option);
  });
  if (records.some((record) => record.productCode === preferred)) select.value = preferred;
}

function updateSupplyActualChoices(run) {
  const planned = plannedInventoryProducts(run).find((item) => item.productCode === el.runSupplyPlanned.value);
  const matching = runInventoryProducts.filter((item) => item.unit.toLowerCase() === planned?.unit.toLowerCase());
  fillSupplySelect(el.runSupplyActual, matching, el.runSupplyActual.value);
  if (!matching.length) {
    el.runSupplyStatus.textContent = "No same-unit products are available to stage.";
  }
}

function renderStagedSupplies() {
  el.runSupplyHistory.replaceChildren();
  if (!stagedSupplies.length) {
    const empty = document.createElement("li");
    empty.className = "manager-list-notice";
    empty.textContent = "No staged supply substitutions are recorded for this run.";
    el.runSupplyHistory.append(empty);
    return;
  }
  stagedSupplies.forEach((item) => {
    const li = document.createElement("li");
    li.className = "manager-list-item";
    const copy = document.createElement("div");
    copy.className = "manager-list-copy";
    const title = document.createElement("strong");
    title.textContent = `${item.quantity} ${item.unit} · ${item.actualProductName} for ${item.plannedProductName}`;
    const detail = document.createElement("span");
    detail.textContent = `${item.reason} · used ${item.used} · released ${item.released} · staff ${item.actorId.slice(0, 8)} · ${formatDate(item.occurredAt)}`;
    copy.append(title, detail);
    li.append(copy);
    el.runSupplyHistory.append(li);
  });
}

async function loadRunInventoryProducts() {
  if (runInventoryProductsLoaded) return;
  const response = await fetch(`${RUN_INVENTORY_API}/run-products`, {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  const body = await readJson(response);
  if (!Array.isArray(body.products) || body.products.some((item) =>
    !isObject(item) || !UUID.test(item.id) || typeof item.code !== "string"
      || typeof item.name !== "string" || typeof item.unit !== "string")) {
    throw new Error("The server returned an invalid stock-product list. Refresh the page to retry.");
  }
  runInventoryProducts = body.products.map((item) => ({
    productId: item.id, productCode: item.code, productName: item.name, unit: item.unit,
  }));
  runInventoryProductsLoaded = true;
}

async function refreshStagedSupplies(run, { force = false } = {}) {
  if (!run?.id || stagedSuppliesLoading || (!force && Date.now() - stagedSuppliesLoadedAt < 10_000)) return;
  stagedSuppliesLoading = true;
  try {
    const response = await fetch(`${RUN_INVENTORY_API}/run-staged-supplies?runId=${encodeURIComponent(run.id)}`, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    const body = await readJson(response);
    if (!Array.isArray(body.supplies) || body.supplies.some((item) => !isRunStageItem(item))) {
      throw new Error("The server returned invalid staged supply records. Refresh to retry.");
    }
    if (supplyPanelRunId === run.id) {
      stagedSupplies = body.supplies;
      stagedSuppliesRunId = run.id;
      stagedSuppliesLoadedAt = Date.now();
      stagedSuppliesDirty = false;
      stageSupplyError = "";
      renderStagedSupplies();
    }
  } catch (error) {
    stageSupplyError = error instanceof Error ? error.message : "Staged supplies could not be refreshed.";
    if (supplyPanelRunId === run.id) el.runSupplyStatus.textContent = stageSupplyError;
  } finally {
    stagedSuppliesLoading = false;
  }
}

function renderRunSupplyPanel(run) {
  const canRead = currentStaff?.capabilities?.includes("run.read")
    || currentStaff?.capabilities?.includes("manage-inventory");
  if (!run || !run.setupSnapshot.productionPlan || !canRead) {
    el.runSupplyPanel.hidden = true;
    supplyPanelRunId = null;
    return;
  }
  el.runSupplyPanel.hidden = false;
  const changedRun = supplyPanelRunId !== run.id;
  if (changedRun) {
    supplyPanelRunId = run.id;
    stagedSupplies = [];
    stagedSuppliesRunId = run.id;
    stagedSuppliesLoadedAt = 0;
    stagedSuppliesDirty = true;
    stageSupplyError = "";
    el.runSupplyHistory.replaceChildren();
    const planned = plannedInventoryProducts(run);
    fillSupplySelect(el.runSupplyPlanned, planned, planned[0]?.productCode);
    if (runInventoryProductsLoaded) updateSupplyActualChoices(run);
    else {
      el.runSupplyActual.replaceChildren();
      void loadRunInventoryProducts().then(() => {
        if (supplyPanelRunId === run.id) updateSupplyActualChoices(run);
      }).catch((error) => {
        stageSupplyError = error instanceof Error ? error.message : "Stock products could not be loaded.";
        el.runSupplyStatus.textContent = stageSupplyError;
      });
    }
    void refreshStagedSupplies(run, { force: true });
  }
  const canStage = run.status !== "completed" && canWriteNow()
    && (currentStaff?.capabilities?.includes("run.lifecycle.command")
      || currentStaff?.capabilities?.includes("manage-inventory"));
  const pending = loadStagePending(run.id);
  const pendingOwned = pending?.actorId === currentStaff?.userId;
  const unresolvedOther = pending && !pendingOwned;
  el.runSupplyForm.hidden = run.status === "completed" || !canStage;
  el.runSupplySubmit.disabled = !canStage || runSupplyBusy || Boolean(pending);
  el.runSupplyRetry.hidden = !pendingOwned;
  el.runSupplyRetry.disabled = !canStage || runSupplyBusy;
  if (unresolvedOther) el.runSupplyStatus.textContent = "A saved request belongs to another staff account.";
  else if (stageSupplyError) el.runSupplyStatus.textContent = stageSupplyError;
  else if (!canWriteNow()) el.runSupplyStatus.textContent = "Read-only until the server confirms a fresh run state.";
  else if (run.status === "completed") el.runSupplyStatus.textContent = "Run complete; staged stock has been reconciled.";
  else if (pendingOwned) el.runSupplyStatus.textContent = "Confirm the saved request before staging another supply.";
  else if (stagedSuppliesRunId === run.id) el.runSupplyStatus.textContent = "Supply changes are recorded against this run.";
  void refreshStagedSupplies(run);
}

async function submitRunStagedSupply(event, retry = false) {
  event.preventDefault();
  const run = selectedRun();
  if (!run || !canWriteNow() || runSupplyBusy) return;
  let pending = loadStagePending(run.id);
  if (!retry) {
    if (pending) {
      el.runSupplyStatus.textContent = pending.actorId === currentStaff?.userId
        ? "Retry the saved request before starting another supply change."
        : "A saved request belongs to another staff account.";
      return;
    }
    const plannedProductCode = el.runSupplyPlanned.value;
    const actualProductCode = el.runSupplyActual.value;
    const quantity = el.runSupplyQuantity.value.trim();
    const reason = el.runSupplyReason.value.trim();
    const planned = plannedInventoryProducts(run).find((item) => item.productCode === plannedProductCode);
    const actual = runInventoryProducts.find((item) => item.productCode === actualProductCode);
    if (!planned || !actual || planned.unit.toLowerCase() !== actual.unit.toLowerCase()
      || !/^(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,6})?$/u.test(quantity) || Number(quantity) <= 0
      || reason.length < 3 || reason.length > 500) {
      el.runSupplyStatus.textContent = "Choose products with the same stock unit and enter a positive quantity and reason.";
      return;
    }
    pending = {
      actorId: currentStaff.userId,
      payload: {
        commandId: crypto.randomUUID(),
        runId: run.id,
        plannedProductCode,
        actualProductCode,
        quantity,
        reason,
      },
    };
    try {
      localStorage.setItem(stagePendingKey(run.id), JSON.stringify(pending));
    } catch {
      el.runSupplyStatus.textContent = "This device could not save a retry identity. No request was sent.";
      return;
    }
  }
  if (!pending || pending.actorId !== currentStaff?.userId || pending.payload.runId !== run.id) {
    el.runSupplyStatus.textContent = "Sign in as the original staff member to confirm the saved request.";
    return;
  }
  runSupplyBusy = true;
  renderRunSupplyPanel(run);
  const csrf = getCsrfHeaders();
  if (!csrf) {
    runSupplyBusy = false;
    el.runSupplyStatus.textContent = "The secure session token is unavailable. Refresh your session before changing stock.";
    return;
  }
  try {
    const response = await fetch(`${RUN_INVENTORY_API}/run-staged-supplies`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json", ...csrf },
      body: JSON.stringify(pending.payload),
    });
    const body = await readJson(response);
    if (!isObject(body) || body.outcome !== "staged" || !UUID.test(body.stageId)
      || body.runId !== run.id || typeof body.quantity !== "string") {
      throw new Error("The server did not confirm the staged supply. Retry the same request.");
    }
    localStorage.removeItem(stagePendingKey(run.id));
    el.runSupplyForm.reset();
    stageSupplyError = "";
    stagedSuppliesDirty = true;
    stagedSuppliesLoadedAt = 0;
    announce("Run supply staged and confirmed by the server.");
    await refreshStagedSupplies(run, { force: true });
  } catch (error) {
    if (error instanceof ApiError && [400, 409].includes(error.status)) {
      localStorage.removeItem(stagePendingKey(run.id));
      stageSupplyError = `${error.message} Review the current run and stock before trying again.`;
    } else {
      stageSupplyError = error instanceof Error ? error.message : "The staged supply was not confirmed.";
    }
    el.runSupplyStatus.textContent = stageSupplyError;
  } finally {
    runSupplyBusy = false;
    renderRunSupplyPanel(selectedRun());
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function commandTitle(command) {
  return ({ start: "Start run", pause: "Pause run", resume: "Resume run", complete: "Finish run" })[command] || "Run action";
}

function renderRuns() {
  el.runCount.textContent = String(runs.length);
  if (runs.length === 0) {
    el.runsList.innerHTML = `<div class="empty-runs">No runs are registered yet. Prepare a run to put it on the floor.</div>`;
    return;
  }
  const ordered = [...runs].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  el.runsList.innerHTML = ordered.map((run) => `<button type="button" class="run-item" data-run-id="${escapeHtml(run.id)}" aria-current="${run.id === selectedRunId ? "true" : "false"}" data-testid="button-select-run-${escapeHtml(run.id)}">
    <span class="run-item-top"><span class="run-item-name">${escapeHtml(run.setupSnapshot.label)}</span><span class="mini-status" data-status="${run.status}">${statusLabel(run.status)}</span></span>
    <span class="run-item-detail"><span>${run.setupSnapshot.targetCases.toLocaleString()} cases</span><span>REV ${run.revision}</span></span>
  </button>`).join("");
  el.runsList.querySelectorAll("[data-run-id]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedRunId = button.dataset.runId;
      lastKnownRun = selectedRun();
      render();
    });
  });
}

function selectedRun() {
  return runs.find((run) => run.id === selectedRunId) || null;
}

function mergeServerRuns(serverRuns, currentRuns) {
  const currentById = new Map(currentRuns.map((run) => [run.id, run]));
  const merged = serverRuns.map((serverRun) => {
    const currentRun = currentById.get(serverRun.id);
    currentById.delete(serverRun.id);
    return currentRun && currentRun.revision > serverRun.revision ? currentRun : serverRun;
  });
  merged.push(...currentById.values());
  return merged;
}

function validateRunProduct(product) {
  return isObject(product)
    && typeof product.code === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u.test(product.code)
    && typeof product.name === "string" && product.name.length >= 1 && product.name.length <= 120
    && Array.isArray(product.productionSetups)
    && product.productionSetups.every((setup) => isObject(setup)
      && typeof setup.code === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u.test(setup.code)
      && typeof setup.name === "string" && setup.name.length >= 1 && setup.name.length <= 120
      && typeof setup.hasDoughRecipe === "boolean")
    && isObject(product.doughCapacity)
    && ["available", "unavailable"].includes(product.doughCapacity.status)
    && Array.isArray(product.doughCapacity.reasons)
    && product.doughCapacity.reasons.every((reason) => typeof reason === "string" && reason.length <= 80)
    && (product.doughCapacity.status !== "available"
      || (typeof product.doughCapacity.doughballYield === "number"
        && Number.isFinite(product.doughCapacity.doughballYield)
        && typeof product.doughCapacity.pizzasPerCase === "number"
        && Number.isSafeInteger(product.doughCapacity.pizzasPerCase)));
}

function validateDieType(die) {
  const validDefaults = (value) => value === null || (
    isDieLineSettings(value)
    && Object.keys(value).sort().join("\u0000") === [...DIE_DEFAULT_FIELDS].sort().join("\u0000")
  );
  return isObject(die)
    && typeof die.code === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u.test(die.code)
    && typeof die.name === "string" && die.name.length >= 1 && die.name.length <= 120
    && ["active", "disabled", "unreviewed"].includes(die.status)
    && Number.isSafeInteger(die.revision) && die.revision >= 0
    && validDefaults(die.defaults)
    && validDefaults(die.suggestedDefaults);
}

function readDieLineSettings() {
  return Object.fromEntries(DIE_DEFAULT_FIELDS.map((key) => {
    const input = el.dieFields.querySelector(`[data-die-field="${key}"]`);
    return [key, input.value === "" ? "" : Number(input.value)];
  }));
}

function writeDieLineSettings(values) {
  for (const key of DIE_DEFAULT_FIELDS) {
    const input = el.dieFields.querySelector(`[data-die-field="${key}"]`);
    const value = values?.[key];
    input.value = typeof value === "number" && Number.isFinite(value) ? String(value) : "";
  }
}

function renderRunDieSetup() {
  if (!el.dieType) return;
  const product = runProducts.find((item) => item.code === el.product.value);
  const setup = product?.productionSetups?.find((item) => item.code === el.productionSetup.value);
  if (!setup?.hasDoughRecipe) {
    const previous = dieTypes.find((die) => die.code === lastSelectedDieCode);
    if (previous?.status === "active") {
      const current = readDieLineSettings();
      const cleared = resolveDieLineDefaultsOnSwitch(null, current, [previous.defaults]);
      writeDieLineSettings({ ...current, ...cleared });
    }
    el.dieCard.hidden = true;
    el.dieType.replaceChildren(new Option("No die selected", ""));
    lastSelectedDieCode = "";
    return;
  }
  el.dieCard.hidden = false;
  const preferred = pendingCreate?.setupSnapshot.dieSetup?.dieTypeCode || el.dieType.value;
  el.dieType.replaceChildren(new Option("No die selected", ""));
  for (const die of dieTypes) {
    const option = new Option(`${die.name} · ${die.status}`, die.code);
    el.dieType.append(option);
  }
  if (dieTypes.some((die) => die.code === preferred)) el.dieType.value = preferred;
  if (pendingCreate?.setupSnapshot.dieSetup) {
    writeDieLineSettings(pendingCreate.setupSnapshot.dieSetup.lineSettings);
    lastSelectedDieCode = pendingCreate.setupSnapshot.dieSetup.dieTypeCode;
  }
  const selected = dieTypes.find((die) => die.code === el.dieType.value);
  if (!selected) {
    lastSelectedDieCode = "";
    el.dieStatus.textContent = "Choose a die only when this setup uses a dough line. Reviewed defaults fill blank fields; you can change any value.";
  } else if (selected.status === "active") {
    el.dieStatus.textContent = `Reviewed defaults for ${selected.name} are available. Blank fields are filled; values you change remain part of this run snapshot.`;
    if (!pendingCreate) lastSelectedDieCode = selected.code;
  } else {
    el.dieStatus.textContent = selected.status === "disabled"
      ? `Defaults for ${selected.name} are disabled. No defaults will be applied; enter any needed settings explicitly.`
      : `Defaults for ${selected.name} have not been reviewed. Imported suggestions are not applied until a manager reviews them.`;
    if (!pendingCreate) lastSelectedDieCode = selected.code;
  }
  const writable = canWriteNow() && !createInFlight && !pendingCreate;
  el.dieType.disabled = !writable || dieTypes.length === 0;
  el.dieFields.querySelectorAll("input").forEach((input) => { input.disabled = !writable; });
}

function selectRunDie() {
  const selected = dieTypes.find((die) => die.code === el.dieType.value);
  const current = readDieLineSettings();
  const previous = dieTypes.find((die) => die.code === lastSelectedDieCode);
  const knownDefaults = previous?.status === "active" ? [previous.defaults] : [];
  if (!selected) {
    if (knownDefaults.length) {
      const cleared = resolveDieLineDefaultsOnSwitch(null, current, knownDefaults);
      writeDieLineSettings({ ...current, ...cleared });
    }
    lastSelectedDieCode = "";
    el.dieStatus.textContent = "No die is selected. Line values will not be attached to this run.";
    return;
  }
  if (selected.status === "active" && !lastSelectedDieCode) {
    const fills = resolveDieLineDefaults(selected.defaults, current);
    writeDieLineSettings({ ...current, ...fills });
    el.dieStatus.textContent = `Reviewed defaults for ${selected.name} are available. Blank fields are filled; values you change remain part of this run snapshot.`;
  } else {
    const targetDefaults = selected.status === "active" ? selected.defaults : null;
    const fills = resolveDieLineDefaultsOnSwitch(targetDefaults, current, knownDefaults);
    writeDieLineSettings({ ...current, ...fills });
    if (selected.status === "active") {
      el.dieStatus.textContent = `Reviewed defaults for ${selected.name} are available. Blank fields are filled; values you change remain part of this run snapshot.`;
    } else {
      el.dieStatus.textContent = selected.status === "disabled"
        ? `Defaults for ${selected.name} are disabled. No defaults were applied; enter any needed settings explicitly.`
        : `Defaults for ${selected.name} have not been reviewed. Imported suggestions are not applied until a manager reviews them.`;
    }
  }
  lastSelectedDieCode = selected.code;
}

function productName(code) {
  const match = runProducts.find((product) => product.code.toLocaleLowerCase("en-US") === code.toLocaleLowerCase("en-US"));
  return match ? `${match.name} · ${match.code}` : code;
}

function renderRunProducts() {
  if (!el.product) return;
  const preferred = pendingCreate?.setupSnapshot.productCode || el.product.value;
  el.product.replaceChildren();
  if (runProducts.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No products available";
    el.product.append(option);
    return;
  }
  for (const product of runProducts) {
    const option = document.createElement("option");
    option.value = product.code;
    const capacity = product.doughCapacity;
    const derived = capacity.status === "available"
      ? Number(capacity.doughballYield / capacity.pizzasPerCase).toFixed(4)
      : null;
    option.textContent = `${product.name} · ${product.code} · ${derived ? `${derived} cases/batch` : "dough capacity unavailable"}`;
    el.product.append(option);
  }
  if (runProducts.some((product) => product.code === preferred)) el.product.value = preferred;
  else if (!pendingCreate) el.product.value = runProducts[0].code;
  el.product.disabled = !canWriteNow() || createInFlight || Boolean(pendingCreate);
  renderRunProductionSetups();
}

function renderRunProductionSetups() {
  const product = runProducts.find((item) => item.code === el.product.value);
  const setups = product?.productionSetups || [];
  const preferred = pendingCreate?.setupSnapshot.productionSetupCode || el.productionSetup.value;
  el.productionSetup.replaceChildren();
  if (setups.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No linked setup available";
    el.productionSetup.append(option);
  } else {
    for (const setup of setups) {
      const option = document.createElement("option");
      option.value = setup.code;
      option.textContent = `${setup.name} · ${setup.code}`;
      el.productionSetup.append(option);
    }
    if (setups.some((setup) => setup.code === preferred)) el.productionSetup.value = preferred;
    else if (!pendingCreate) el.productionSetup.value = setups[0].code;
  }
  el.productionSetup.disabled = !canWriteNow() || createInFlight || Boolean(pendingCreate) || setups.length === 0;
  renderRunDieSetup();
  updateCreateFormForAuth();
}

function render() {
  renderRuns();
  renderRun(selectedRun());
  renderStationPanel(selectedRun());
  renderRunSupplyPanel(selectedRun());
  qc.updateContext({ staff: currentStaff, run: selectedRun(), writable: canWriteNow() });
}

const STATION_FIELD_META = Object.freeze({
  autoTrackRatePerMinute: ["Auto-track rate", "cases / minute"],
  timerDurationSeconds: ["Timer duration", "seconds"],
  casesPerSkid: ["Cases per skid", "cases"],
  casesPerBatch: ["Cases per dough batch", "cases"],
  traysPerBatch: ["Trays per dough batch", "trays"],
  pizzasPerCase: ["Pizzas per case", "pizzas"],
  ozPerPizza: ["Ounces per pizza", "oz"],
  batchLbs: ["Pounds per batch", "lb"],
  barrelLbs: ["Pounds per Sauce barrel", "lb"],
  casesProduced: ["Cases produced", "cases"],
  casesOnLine: ["Cases on line", "cases"],
  casesInFreezer: ["Cases in freezer", "cases"],
  traysOnLine: ["Trays on line", "trays"],
  batchesReady: ["Batches ready", "batches"],
  batchesMade: ["Batches made", "batches"],
  casesCompleted: ["Cases completed", "cases"],
  stockOnLineLbs: ["Stock on line", "lb"],
  casesPacked: ["Cases packed", "cases"],
  barrelsMade: ["Full barrels made", "barrels"],
  stockBarrels: ["Barrels on hand", "barrels"],
  stockConsumedLbs: ["Stock consumed", "lb"],
});

const STATION_METRIC_LABELS = Object.freeze({
  targetCases: "Run target",
  casesRemaining: "Cases remaining",
  workInProgress: "Work in progress",
  completionPercent: "Run completion",
  casesProduced: "Cases produced",
  casesPerBatch: "Cases per dough batch",
  batchesNeeded: "Batches needed",
  batchesRemaining: "Batches remaining",
  casesPacked: "Cases packed",
  skidsNeeded: "Skids needed",
  completedSkids: "Completed skids",
  casesOnCurrentSkid: "Cases on current skid",
  casesCompleted: "Cases completed",
  ingredientLbsNeeded: "Ingredient needed",
  totalIngredientLbs: "Total ingredient needed",
  barrelsNeeded: "Barrels needed",
  barrelsMade: "Barrels made",
  barrelsRemaining: "Barrels remaining",
  stockBarrels: "Barrels on hand",
  stockOnLineLbs: "Stock on line",
  stockConsumedLbs: "Stock consumed",
  batchesToMake: "Batches still to make",
});

function stationPendingKey(runId, stationKey) {
  return `${PENDING_STATION_PREFIX}${runId}:${stationKey}`;
}

function loadPendingStation(runId, stationKey) {
  try {
    const pending = JSON.parse(localStorage.getItem(stationPendingKey(runId, stationKey)) || "null");
    if (!isObject(pending) || pending.runId !== runId || pending.stationKey !== stationKey
      || !UUID.test(pending.commandId) || !UUID.test(pending.actorId)
      || !Number.isSafeInteger(pending.expectedRevision) || pending.expectedRevision < 0
      || !["manual", "timer_start", "timer_pause", "timer_resume", "timer_reset"].includes(pending.mode)
      || !isObject(pending.changes)) return null;
    return pending;
  } catch {
    return null;
  }
}

function savePendingStation(pending) {
  try {
    localStorage.setItem(stationPendingKey(pending.runId, pending.stationKey), JSON.stringify(pending));
    return true;
  } catch {
    showError("This device could not save the station retry identity. Refresh the run before making another edit.", "Retry protection unavailable");
    return false;
  }
}

function clearPendingStation(runId, stationKey) {
  try {
    localStorage.removeItem(stationPendingKey(runId, stationKey));
  } catch {
    showError("The server responded, but this device could not clear its saved station action. Refresh state before another edit.", "Local storage unavailable");
  }
}

function hasPendingStationCommand(runId) {
  return Object.keys(STATIONS).some((stationKey) => loadPendingStation(runId, stationKey) !== null);
}

function currentServerNowMs(run) {
  if (cachedServerClock && Number.isFinite(cachedServerClock.serverMs)) {
    return cachedServerClock.serverMs + Math.max(0, performance.now() - cachedServerClock.receivedAt);
  }
  return run?.serverNow ? Date.parse(run.serverNow) : Date.now();
}

function activeTimerElapsedMs(run, stationState) {
  const progress = stationState?.progress || {};
  const stored = Math.max(0, Number(progress.timerElapsedMs) || 0);
  if (progress.timerStatus !== "running" || !isTimestamp(progress.timerStartedAt)) return stored;
  const started = Date.parse(progress.timerStartedAt);
  const now = currentServerNowMs(run);
  if (!Number.isFinite(started) || !Number.isFinite(now)) return stored;
  let pausedMs = 0;
  for (const interval of run.pauseIntervals || []) {
    const pauseStart = Date.parse(interval.startedAt);
    const pauseEnd = interval.endedAt ? Date.parse(interval.endedAt) : now;
    if (!Number.isFinite(pauseStart) || !Number.isFinite(pauseEnd)) continue;
    pausedMs += Math.max(0, Math.min(now, pauseEnd) - Math.max(started, pauseStart));
  }
  return stored + Math.max(0, now - started - pausedMs);
}

function formatTimer(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

function stationStateFor(run, stationKey) {
  return run?.stationProgress?.[stationKey] || { status: "not_started", revision: 0, inputs: {}, progress: {} };
}

function setStationSaveNote(message, state = "") {
  el.stationSaveNote.textContent = message;
  el.stationSaveNote.dataset.state = state;
}

function renderStationPanel(run) {
  if (!run || !currentStaff) {
    el.stationPanel.hidden = true;
    return;
  }
  el.stationPanel.hidden = false;
  if (!Object.hasOwn(STATIONS, selectedStationKey)) selectedStationKey = "line";
  el.stationRevision.textContent = `RUN REV ${String(run.revision).padStart(2, "0")}`;
  el.stationTabs.innerHTML = Object.entries(STATIONS).map(([key, station]) => `
    <button type="button" class="station-tab" role="tab" aria-selected="${key === selectedStationKey}"
      aria-controls="station-fields" data-station-key="${key}" data-testid="tab-station-${key}">${station.label}</button>
  `).join("");
  el.stationTabs.querySelectorAll("[data-station-key]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedStationKey = button.dataset.stationKey;
      stationConflictDraft = null;
      renderStationPanel(selectedRun());
    });
  });

  const station = STATIONS[selectedStationKey];
  const state = stationStateFor(run, selectedStationKey);
  const readOnly = !canWriteNow() || run.status === "completed";
  const draft = stationConflictDraft?.runId === run.id
    && stationConflictDraft.stationKey === selectedStationKey
    ? stationConflictDraft.changes
    : {};
  const inputs = { ...state.inputs, ...Object.fromEntries(Object.entries(draft).filter(([key]) => station.inputs.includes(key))) };
  const progress = { ...state.progress, ...Object.fromEntries(Object.entries(draft).filter(([key]) => station.progress.includes(key))) };
  el.stationLabel.textContent = station.label.toUpperCase();
  el.stationState.textContent = state.progress.timerStatus
    ? `Timer ${state.progress.timerStatus.replace("_", " ")}`
    : state.status.replace("_", " ");
  const metrics = calculateStationMetrics({ stationKey: selectedStationKey, run, state: { inputs, progress } });
  const metricMarkup = Object.entries(metrics)
    .filter(([key, value]) => value !== null && value !== undefined && STATION_METRIC_LABELS[key])
    .map(([key, value]) => `<div class="station-metric"><span>${STATION_METRIC_LABELS[key]}</span><strong>${escapeHtml(formatMetric(value, key))}</strong></div>`)
    .join("");
  const capacityNotice = selectedStationKey === "dough" && run.doughCapacity?.status !== "available"
    ? `<p class="station-capacity-notice" role="status">Dough capacity unavailable: ${escapeHtml(describeDoughCapacity(run.doughCapacity))}</p>`
    : "";
  const doughHelp = selectedStationKey === "dough"
    ? `<p class="station-help">Example: 645.19 doughballs ÷ 12 pizzas per case = 53.7658 cases per batch. Batch estimates round up to whole batches: 53 cases needs 1; 54 needs 2.</p>`
    : "";
  el.stationMetrics.innerHTML = `${metricMarkup}${doughHelp}${capacityNotice}`;

  const makeFields = (title, group, fields) => `
    <div class="station-field-group">
      <h3>${title}</h3>
      ${fields.filter((field) => !(selectedStationKey === "dough" && field === "casesPerBatch")).map((field) => {
        const [label, unit] = STATION_FIELD_META[field] || [field, ""];
        const raw = group[field];
        const fallback = station.progress.includes(field) ? 0 : (field === "autoTrackRatePerMinute" ? 0 : "");
        const value = raw === undefined || raw === null ? fallback : raw;
        const step = field === "casesPerBatch"
          ? "0.0001"
          : ["stockOnLineLbs", "stockConsumedLbs", "stockBarrels", "autoTrackRatePerMinute", "ozPerPizza", "batchLbs", "barrelLbs"].includes(field)
            ? "0.001"
            : "1";
        return `<label class="field station-field" for="station-${field}">
          <span>${label}${unit ? ` · ${unit}` : ""}</span>
          <input id="station-${field}" name="${field}" type="number" inputmode="decimal" min="0" max="1000000"
            step="${step}" value="${escapeHtml(value)}" data-station-field="${field}" ${readOnly ? "disabled" : ""} />
        </label>`;
      }).join("")}
    </div>`;
  el.stationFields.innerHTML = `
    <div class="station-field-groups">
      ${makeFields("Station setup", inputs, station.inputs)}
      ${makeFields("Recorded progress", progress, station.progress)}
    </div>
    <div class="station-pending" id="station-pending" hidden></div>`;

  const pending = loadPendingStation(run.id, selectedStationKey);
  const pendingBox = document.querySelector("#station-pending");
  if (pending) {
    pendingBox.hidden = false;
    const mine = pending.actorId === currentStaff.userId;
    pendingBox.innerHTML = `<span>${mine ? "A station update needs confirmation. Retry uses the same request ID." : "A saved update belongs to another staff account."}</span>${mine ? '<button type="button" data-retry-station="true">Retry same update</button>' : ""}`;
    pendingBox.querySelector("[data-retry-station]")?.addEventListener("click", () => { void retryStationCommand(pending); });
  }

  const canMutate = canWriteNow() && run.status !== "completed" && !stationActionInFlight
    && !hasPendingStationCommand(run.id);
  el.stationSaveButton.disabled = !canMutate;
  el.stationSaveButton.textContent = stationConflictDraft?.runId === run.id
    && stationConflictDraft.stationKey === selectedStationKey
    ? "Review and save my values"
    : "Save station values";
  if (!canWriteNow()) {
    setStationSaveNote("Read-only until the server confirms this run again.", "warning");
  } else if (stationConflictDraft?.runId === run.id && stationConflictDraft.stationKey === selectedStationKey) {
    setStationSaveNote("Another device changed the run. Your entries remain here; review them and save again.", "warning");
  } else if (pending) {
    setStationSaveNote("Confirm the saved update before making another station edit.", "warning");
  } else {
    setStationSaveNote("", "");
  }

  renderStationTimerControls(run, state, canMutate);
  updateStationTimer();
}

function formatMetric(value, key) {
  if (key === "completionPercent") return `${Number(value).toFixed(1)}%`;
  if (key === "casesPerBatch") return `${Number(value).toFixed(4)} cases`;
  if (["ingredientLbsNeeded", "totalIngredientLbs", "stockOnLineLbs", "stockConsumedLbs"].includes(key)) return `${Number(value).toFixed(2)} lb`;
  if (key === "barrelsNeeded" || key === "stockBarrels") return `${Number(value).toFixed(2)} barrels`;
  return Number.isInteger(value) ? value.toLocaleString() : Number(value).toFixed(2);
}

function describeDoughCapacity(capacity) {
  const labels = {
    product_not_selected: "this run has no linked product",
    dough_source_missing: "no single matching dough yield was imported",
    shipping_source_missing: "no single matching pizzas-per-case value was imported",
    dough_source_ambiguous: "more than one dough yield matches this product",
    shipping_source_ambiguous: "more than one shipping row matches this product",
    dough_yield_invalid: "the linked dough yield is unavailable",
    pizzas_per_case_invalid: "the linked case size is unavailable",
  };
  if (!Array.isArray(capacity?.reasons) || capacity.reasons.length === 0) {
    return "review the product’s dough and shipping workbook sources";
  }
  return capacity.reasons.map((reason) => labels[reason] || "review the linked workbook sources").join("; ");
}

function renderStationTimerControls(run, state, canMutate) {
  const timerStatus = state.progress.timerStatus || "idle";
  const duration = Number(state.inputs.timerDurationSeconds) || 0;
  const actions = [];
  if (timerStatus === "idle") actions.push(["timer_start", "Start timer"]);
  if (timerStatus === "running") actions.push(["timer_pause", "Pause timer"]);
  if (timerStatus === "paused") actions.push(["timer_resume", "Resume timer"]);
  if (timerStatus !== "idle") actions.push(["timer_reset", "Reset"]);
  el.stationTimerControls.innerHTML = actions.map(([mode, label]) => `
    <button type="button" data-timer-mode="${mode}" ${!canMutate
      || stationActionInFlight
      || ((mode === "timer_start" || mode === "timer_resume") && (duration <= 0 || run.status !== "running"))
      ? "disabled" : ""}>${label}</button>
  `).join("");
  el.stationTimerControls.querySelectorAll("[data-timer-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      void submitStationCommand({
        runId: run.id,
        stationKey: selectedStationKey,
        mode: button.dataset.timerMode,
        changes: {},
      });
    });
  });
}

function updateStationTimer() {
  const run = selectedRun();
  if (!run || !Object.hasOwn(STATIONS, selectedStationKey)) return;
  const state = stationStateFor(run, selectedStationKey);
  const progress = state.progress || {};
  const status = progress.timerStatus || "idle";
  if (status === "idle") {
    el.stationTimerValue.textContent = "Not started";
    return;
  }
  const elapsed = activeTimerElapsedMs(run, state);
  const duration = (Number(state.inputs?.timerDurationSeconds) || 0) * 1000;
  const remaining = Math.max(0, duration - elapsed);
  el.stationTimerValue.textContent = status === "running" && duration > 0 && remaining === 0
    ? `Done · ${formatTimer(elapsed)}`
    : `${formatTimer(remaining > 0 ? remaining : elapsed)}${status === "paused" ? " · paused" : ""}`;
}

async function submitStationForm(event) {
  event.preventDefault();
  const run = selectedRun();
  if (!run || !requireWritableState()) return;
  if (run.status === "completed") {
    setStationSaveNote("Completed runs are read-only.", "warning");
    return;
  }
  const changes = {};
  const station = STATIONS[selectedStationKey];
  const current = stationStateFor(run, selectedStationKey);
  const currentValues = { ...current.inputs, ...current.progress };
  for (const input of el.stationFields.querySelectorAll("[data-station-field]")) {
    if (input.value === "") continue;
    const value = Number(input.value);
    if (!Number.isFinite(value)) {
      input.focus();
      setStationSaveNote("Enter a valid number for each station value.", "error");
      return;
    }
    const field = input.dataset.stationField;
    const knownValue = currentValues[field]
      ?? (station.progress.includes(field) || field === "autoTrackRatePerMinute" ? 0 : null);
    if (knownValue === null || value !== Number(knownValue)) changes[field] = value;
  }
  if (Object.keys(changes).length === 0) {
    setStationSaveNote("Enter at least one station value before saving.", "warning");
    return;
  }
  await submitStationCommand({
    runId: run.id,
    stationKey: selectedStationKey,
    mode: "manual",
    changes,
  });
}

async function submitStationCommand({ runId, stationKey, mode, changes }) {
  if (!requireWritableState()) return;
  if (stationActionInFlight || hasPendingStationCommand(runId)) {
    setStationSaveNote("Confirm the earlier station update before sending another one.", "warning");
    return;
  }
  const run = runs.find((item) => item.id === runId);
  if (!run) {
    setStationSaveNote("This run is no longer in the current register. Refresh before editing.", "error");
    return;
  }
  const csrf = getCsrfHeaders();
  if (!csrf) {
    setStationSaveNote("Your secure session is unavailable. Sign in again before editing.", "error");
    return;
  }
  const pending = {
    runId,
    stationKey,
    actorId: currentStaff.userId,
    commandId: crypto.randomUUID(),
    expectedRevision: run.revision,
    mode,
    changes,
  };
  if (mode !== "auto_track" && !savePendingStation(pending)) return;
  await sendStationCommand(pending);
}

async function retryStationCommand(pending) {
  if (stationActionInFlight || !currentStaff || pending.actorId !== currentStaff.userId) return;
  if (!requireWritableState()) return;
  await sendStationCommand(pending);
}

function timerConflictResolution(mode, run, stationKey) {
  if (!mode.startsWith("timer_")) return "show-latest";
  const timerStatus = run.stationProgress?.[stationKey]?.progress?.timerStatus || "idle";
  if (mode === "timer_start") {
    if (timerStatus === "running") return "already-applied";
    if (timerStatus === "idle" && run.status === "running") return "retry";
  }
  if (mode === "timer_pause") {
    if (timerStatus === "paused") return "already-applied";
    if (timerStatus === "running" && run.status === "running") return "retry";
  }
  if (mode === "timer_resume") {
    if (timerStatus === "running") return "already-applied";
    if (timerStatus === "paused" && run.status === "running") return "retry";
  }
  return "show-latest";
}

async function sendStationCommand(pending, timerRebaseAttempt = 0) {
  if (!currentStaff || pending.actorId !== currentStaff.userId) {
    setStationSaveNote("Sign in as the staff member who created this update before retrying.", "error");
    return;
  }
  if (!requireWritableState()) return;
  const csrf = getCsrfHeaders();
  if (!csrf) {
    setStationSaveNote("Your secure session is unavailable. Sign in again, then retry the same update.", "error");
    return;
  }
  stationActionInFlight = true;
  renderStationPanel(selectedRun());
  try {
    const response = await fetch(`${API}/${encodeURIComponent(pending.runId)}/stations/${encodeURIComponent(pending.stationKey)}/commands`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", Accept: "application/json", ...csrf },
      body: JSON.stringify({
        commandId: pending.commandId,
        expectedRevision: pending.expectedRevision,
        mode: pending.mode,
        changes: pending.changes,
      }),
    });
    const body = await readJson(response, { allowStationConflict: true });
    if (!["accepted", "conflict", "invalid_transition", "not_due", "not_enabled"].includes(body.outcome)) {
      throw new Error("The server returned an unknown station result. Retry the same update to confirm it.");
    }
    if (body.outcome === "accepted") {
      if (!body.run) throw new Error("The server accepted the station update but did not return canonical state. Retry the same update.");
      const canonical = validateRun(body.run);
      if (canonical.id !== pending.runId) throw new Error("The server returned a different run for this station action.");
      upsertRun(canonical);
      clearPendingStation(pending.runId, pending.stationKey);
      if (pending.mode === "manual" || pending.mode.startsWith("timer_")) stationConflictDraft = null;
      setConnection(true);
      setLastCheck();
      serverStateConfirmed = true;
      clearError();
      setStationSaveNote(
        pending.mode === "auto_track" ? "Automatic progress saved by the server." : "Saved to the shared run.",
        "success",
      );
      announce(`${STATIONS[pending.stationKey].label} update saved.`);
      saveOfflineCache();
    } else if (body.outcome === "conflict") {
      const canonical = validateRun(body.currentRun);
      upsertRun(canonical);
      clearPendingStation(pending.runId, pending.stationKey);
      stationConflictDraft = pending.mode === "manual"
        ? { runId: pending.runId, stationKey: pending.stationKey, changes: pending.changes }
        : null;
      serverStateConfirmed = true;
      setConnection(true);
      setLastCheck();
      saveOfflineCache();
      const timerResolution = timerConflictResolution(pending.mode, canonical, pending.stationKey);
      if (timerResolution === "retry" && timerRebaseAttempt < 3) {
        const rebased = {
          ...pending,
          commandId: crypto.randomUUID(),
          expectedRevision: canonical.revision,
        };
        if (!savePendingStation(rebased)) return;
        setStationSaveNote("The run advanced during auto-tracking. Reapplying this timer action to the latest shared state.", "warning");
        await sendStationCommand(rebased, timerRebaseAttempt + 1);
        return;
      }
      setStationSaveNote(
        pending.mode === "manual"
          ? "Another device changed the run. Your entries are kept below; review and save them again."
          : timerResolution === "already-applied"
            ? "The shared timer already reflects that action."
            : pending.mode.startsWith("timer_")
              ? "Another device changed the timer. The latest shared state is shown; choose its next action."
              : "Another device advanced the run. The current server state is shown.",
        "warning",
      );
    } else {
      const canonical = validateRun(body.currentRun || body.run);
      upsertRun(canonical);
      clearPendingStation(pending.runId, pending.stationKey);
      serverStateConfirmed = true;
      setConnection(true);
      if (body.outcome === "invalid_transition") {
        setStationSaveNote("This station action is not available in the current run state.", "warning");
      }
    }
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      clearOfflineCache();
      showSignIn("Your sign-in has expired. The saved station update remains available to retry after signing in again.");
    } else if (error instanceof ApiError && [400, 403, 404, 413].includes(error.status)) {
      if (pending.mode !== "auto_track") clearPendingStation(pending.runId, pending.stationKey);
      setConnection(true);
      setStationSaveNote(error.message, "error");
      showError(error.message, "Station update not saved");
    } else {
      serverStateConfirmed = false;
      setConnection(false);
      setStationSaveNote(
        error instanceof Error
          ? (pending.mode === "auto_track"
            ? `${error.message} Automatic progress will retry after reconnecting.`
            : `${error.message} The same update is saved for retry.`)
          : (pending.mode === "auto_track" ? "Automatic progress will retry after reconnecting." : "The update is not confirmed. Retry the saved update."),
        "error",
      );
      showError(
        pending.mode === "auto_track"
          ? "Automatic progress is temporarily unavailable and will resume after reconnection."
          : "The station update is not confirmed. Reconnect and retry the same saved action.",
        pending.mode === "auto_track" ? "Automatic tracking paused" : "Station update needs confirmation",
      );
    }
  } finally {
    stationActionInFlight = false;
    render();
  }
}

async function fetchRuns({ quiet = false } = {}) {
  if (!currentStaff) return false;
  if (navigator.onLine === false) {
    enterOfflineMode();
    return false;
  }
  if (refreshInFlight) return false;
  serverStateConfirmed = false;
  updateInventoryContext(currentStaff, false);
  updateScheduleContext(currentStaff, false);
  updateMixPlanContext(currentStaff, serverStateConfirmed);
  updateCreateFormForAuth();
  renderRun(selectedRun());
  refreshInFlight = true;
  const requestGeneration = authGeneration;
  if (!quiet) el.refresh.disabled = true;
  try {
    const [response, productResponse] = await Promise.all([
      fetch(API, { method: "GET", credentials: "include", headers: { Accept: "application/json" } }),
      fetch(`${API}/products`, { method: "GET", credentials: "include", headers: { Accept: "application/json" } }),
    ]);
    const [body, productBody] = await Promise.all([readJson(response), readJson(productResponse)]);
    if (requestGeneration !== authGeneration || !currentStaff) return;
    if (navigator.onLine === false) {
      enterOfflineMode();
      return false;
    }
    if (!Array.isArray(body.runs)) throw new Error("The server returned an unexpected run list. Refresh again to retry.");
    if (!isObject(productBody) || !Array.isArray(productBody.products)
      || !productBody.products.every(validateRunProduct)
      || !Array.isArray(productBody.dieTypes) || !productBody.dieTypes.every(validateDieType)
      || (productBody.productionWarehouse !== null
        && (!isObject(productBody.productionWarehouse) || !UUID.test(productBody.productionWarehouse.id)
          || typeof productBody.productionWarehouse.name !== "string"
          || productBody.productionWarehouse.name.length < 1 || productBody.productionWarehouse.name.length > 120))) {
      throw new Error("The server returned an unexpected run setup list. Refresh again to retry.");
    }
    runProducts = productBody.products;
    dieTypes = productBody.dieTypes;
    productionWarehouse = productBody.productionWarehouse;
    const nextRuns = body.runs.map(validateRun);
    runs = mergeServerRuns(nextRuns, runs);
    if (!runs.some((run) => run.id === selectedRunId)) {
      const activeRun = runs.find((run) => run.status === "running" || run.status === "paused");
      selectedRunId = activeRun?.id || [...runs].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0]?.id || null;
    }
    lastKnownRun = selectedRun();
    clearError();
    setConnection(true);
    setLastCheck();
    serverStateConfirmed = true;
    updateInventoryContext(currentStaff, canWriteNow());
    updateScheduleContext(currentStaff, canWriteNow());
    updateMixPlanContext(currentStaff, serverStateConfirmed);
    renderRunProducts();
    updateCreateFormForAuth();
    render();
    saveOfflineCache();
    return true;
  } catch (error) {
    if (requestGeneration !== authGeneration || !currentStaff) return false;
    if (error instanceof ApiError && error.status === 401) {
      setConnection(true);
      clearOfflineCache();
      showSignIn("Your sign-in has expired. Sign in again to reload the current server state.");
      return false;
    }
    serverStateConfirmed = false;
    updateInventoryContext(currentStaff, false);
    updateScheduleContext(currentStaff, false);
    updateMixPlanContext(currentStaff, serverStateConfirmed);
    setConnection(false);
    saveOfflineCache();
    showError(error instanceof Error ? error.message : "Check the connection and refresh state.", "Could not load current state");
    updateCreateFormForAuth();
    if (runs.length === 0) {
      el.runContent.innerHTML = `<div class="status-row"><span class="status-pill planned">State unavailable</span></div><h2 class="run-label" id="run-label">Waiting for server state</h2><p class="control-note">Run controls stay unavailable until the canonical state loads. Check the connection, then refresh.</p>`;
      el.runsList.innerHTML = `<div class="empty-runs">Run register is unavailable. Refresh to try again.</div>`;
    } else render();
    return false;
  } finally {
    refreshInFlight = false;
    el.refresh.disabled = false;
    if (requestGeneration !== authGeneration && currentStaff) {
      queueMicrotask(() => { void fetchRuns({ quiet: true }); });
    }
  }
}

async function fetchOneRun(runId) {
  const response = await fetch(`${API}/${encodeURIComponent(runId)}`, {
    method: "GET", credentials: "include", headers: { Accept: "application/json" },
  });
  const body = await readJson(response);
  const run = validateRun(body.run);
  if (run.id !== runId) throw new Error("The server returned a different run than requested. Refresh the register.");
  const index = runs.findIndex((item) => item.id === runId);
  if (index === -1) runs.push(run);
  else runs[index] = run;
  return run;
}

async function beginCommand(run, commandType) {
  if (!currentStaff) {
    showSignIn("Sign in to load the current server state before changing a run.");
    return;
  }
  if (!requireWritableState()) return;
  if (commandInFlight || getPending(run.id)) return;
  if (!getCsrfHeaders()) {
    showError("Your secure session is unavailable. Sign in again before changing run state.", "Sign-in required");
    return;
  }
  const payload = {
    commandId: crypto.randomUUID(),
    commandType,
    expectedRevision: run.revision,
  };
  const pending = { ...payload, runId: run.id, actorId: currentStaff.userId };
  await sendCommand(pending);
}

async function retryCommand(runId) {
  if (commandInFlight) return;
  const pending = getPending(runId);
  if (!pending) {
    showError("No saved command is available to retry. Refresh the run state before acting.", "Retry unavailable");
    return;
  }
  if (pending.actorId !== currentStaff?.userId) {
    showError("This saved action belongs to a different staff account. Sign in as its original operator to retry it.", "Action belongs to another account");
    return;
  }
  if (!requireWritableState()) return;
  await sendCommand(pending);
}

async function sendCommand(pending) {
  if (!currentStaff || pending.actorId !== currentStaff.userId) {
    showError("Sign in as the staff member who created this action before retrying it.", "Action belongs to another account");
    return;
  }
  if (!requireWritableState()) return;
  const csrf = getCsrfHeaders();
  if (!csrf) {
    showError("Your secure session is unavailable. Sign in again, then retry the same saved action.", "Sign-in required");
    return;
  }
  if (!getPending(pending.runId) && !storePending(pending)) return;
  commandInFlight = true;
  render();
    let definitive = false;
    let conflictNotice = null;
  try {
    const response = await fetch(`${API}/${encodeURIComponent(pending.runId)}/commands`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", Accept: "application/json", ...csrf },
      body: JSON.stringify({
        commandId: pending.commandId,
        commandType: pending.commandType,
        expectedRevision: pending.expectedRevision,
      }),
    });
    const body = await readJson(response, { allowCommandConflict: true });
    if (!["accepted", "conflict", "invalid_transition"].includes(body.outcome)) {
      throw new Error("The server returned an unknown command result. The same command can be retried safely.");
    }
    if (body.outcome === "accepted") {
      if (!body.run) throw new Error("The server accepted the action but did not return canonical state. Retry the same action to confirm it.");
      const run = validateRun(body.run);
      if (run.id !== pending.runId) throw new Error("The server returned a different run. Retry the same action to confirm the result.");
      upsertRun(run);
      definitive = true;
      clearPending(pending.runId);
      announce(`${commandTitle(pending.commandType)} accepted. Current state is ${run.status}.`);
    } else {
      const canonical = body.currentRun ? validateRun(body.currentRun) : await fetchOneRun(pending.runId);
      if (canonical.id !== pending.runId) throw new Error("The server returned a different run. Refresh to load the current state.");
      upsertRun(canonical);
      definitive = true;
      clearPending(pending.runId);
      conflictNotice = body.outcome === "conflict"
        ? "The run changed on another device. The latest server state is shown; review it before choosing an action."
        : `That action is not valid while the run is ${canonical.status}. The latest server state is shown.`;
    }
    selectedRunId = pending.runId;
    lastKnownRun = selectedRun();
    const refreshed = await fetchRuns({ quiet: true });
    if (refreshed && conflictNotice) {
      showError(conflictNotice, body.outcome === "conflict" ? "Run changed elsewhere" : "Action not available");
      announce(conflictNotice);
    }
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      showSignIn("Your sign-in has expired. The saved action is retained; sign in as the same operator to confirm it.");
      return;
    }
    if (error instanceof ApiError && error.status === 422) {
      definitive = true;
      clearPending(pending.runId);
      showError(error.message, "Production rules require review");
      return;
    }
    serverStateConfirmed = false;
    updateInventoryContext(currentStaff, false);
    updateScheduleContext(currentStaff, false);
    updateMixPlanContext(currentStaff, serverStateConfirmed);
    setConnection(false);
    updateCreateFormForAuth();
    showError(error instanceof Error ? error.message : "The result is uncertain. Retry the same action; its command identity will be preserved.", "Action needs confirmation");
  } finally {
    if (definitive) clearPending(pending.runId);
    commandInFlight = false;
    render();
  }
}

function upsertRun(run) {
  const index = runs.findIndex((item) => item.id === run.id);
  if (index < 0) runs.push(run);
  else if (runs[index].revision <= run.revision) runs[index] = run;
}

async function createRun(event) {
  event.preventDefault();
  if (createInFlight) return;
  if (!currentStaff) {
    showSignIn("Sign in to load the current server state before preparing a run.");
    return;
  }
  if (pendingCreate && pendingCreate.actorId !== currentStaff.userId) {
    showError("This unconfirmed run request belongs to another staff account. Sign in as that person to confirm it.", "Request belongs to another account");
    return;
  }
  if (!requireWritableState()) return;
  const csrf = getCsrfHeaders();
  if (!csrf) {
    showError("Your secure session is unavailable. Sign in again before creating a run.", "Sign-in required");
    return;
  }
  const label = pendingCreate?.setupSnapshot.label ?? el.label.value.trim();
  const targetCases = pendingCreate?.setupSnapshot.targetCases ?? Number(el.target.value);
  const productCode = pendingCreate?.setupSnapshot.productCode ?? el.product.value;
  const productionSetupCode = pendingCreate?.setupSnapshot.productionSetupCode ?? el.productionSetup.value;
  const selectedProduct = runProducts.find((product) => product.code === productCode);
  const selectedSetup = selectedProduct?.productionSetups?.find((setup) => setup.code === productionSetupCode);
  if (!label || !Number.isSafeInteger(targetCases) || targetCases < 1
    || !selectedSetup
    || !productionWarehouse) {
    showError("Choose a product and linked production setup, and confirm a production warehouse is available.", "Check run details");
    return;
  }
  let dieSetup = pendingCreate?.setupSnapshot.dieSetup;
  if (!pendingCreate && el.dieType.value) {
    const selectedDie = dieTypes.find((die) => die.code === el.dieType.value);
    if (!selectedSetup.hasDoughRecipe || !selectedDie) {
      showError("This die is not available for the selected production setup. Refresh and review the setup.", "Check die selection");
      return;
    }
    const lineSettings = Object.fromEntries(DIE_DEFAULT_FIELDS.map((key) => {
      const input = el.dieFields.querySelector(`[data-die-field="${key}"]`);
      return [key, input.value === "" ? null : Number(input.value)];
    }));
    if (!isDieLineSettings(lineSettings)
      || Object.keys(lineSettings).sort().join("\u0000") !== [...DIE_DEFAULT_FIELDS].sort().join("\u0000")) {
      showError("Enter valid non-negative line settings before preparing this run.", "Check die settings");
      return;
    }
    dieSetup = {
      dieTypeCode: selectedDie.code,
      expectedRevision: selectedDie.revision,
      lineSettings,
    };
  }
  const request = pendingCreate || {
    requestId: crypto.randomUUID(),
    actorId: currentStaff.userId,
    setupSnapshot: {
      label,
      targetCases,
      productCode,
      productionSetupCode,
      ...(dieSetup ? { dieSetup } : {}),
    },
  };
  if (!pendingCreate) {
    savePendingCreate(request);
    if (!pendingCreate) return;
  }
  createInFlight = true;
  el.createButton.disabled = true;
  el.createNote.textContent = pendingCreate ? "Retrying the same request with its saved identity…" : "Sending to the server…";
  try {
    const response = await fetch(API, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json", Accept: "application/json", ...csrf },
      body: JSON.stringify({ requestId: request.requestId, setupSnapshot: request.setupSnapshot }),
    });
    const body = await readJson(response);
    if (body.outcome !== "created" || typeof body.replayed !== "boolean") {
      throw new Error("The server returned an unexpected creation result. Retry the same request to confirm it.");
    }
    const run = validateRun(body.run);
    if (run.status !== "planned" || run.setupSnapshot.label !== request.setupSnapshot.label
      || run.setupSnapshot.targetCases !== request.setupSnapshot.targetCases
      || run.setupSnapshot.productCode !== request.setupSnapshot.productCode
      || run.setupSnapshot.productionSetupCode !== request.setupSnapshot.productionSetupCode
      || (request.setupSnapshot.dieSetup && (
        run.setupSnapshot.dieSetup?.dieTypeCode !== request.setupSnapshot.dieSetup.dieTypeCode
        || run.setupSnapshot.dieSetup?.defaultRevision !== request.setupSnapshot.dieSetup.expectedRevision
        || !DIE_DEFAULT_FIELDS.every((key) =>
          run.setupSnapshot.dieSetup?.lineSettings?.[key] === request.setupSnapshot.dieSetup.lineSettings[key])
      ))) {
      throw new Error("The server returned a run that does not match this request. Retry the same request to confirm it.");
    }
    upsertRun(run);
    selectedRunId = run.id;
    lastKnownRun = run;
    clearPendingCreate();
    clearError();
    el.createForm.reset();
    lastSelectedDieCode = "";
    renderRunProducts();
    el.createNote.textContent = body.replayed
      ? "Existing server-created run confirmed. Start it when production is ready."
      : "Prepared by the server. Start the run when production is ready.";
    setConnection(true);
    setLastCheck();
    announce(body.replayed ? "Previously prepared run confirmed on the server." : "Run prepared on the server.");
    await fetchRuns({ quiet: true });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      showSignIn("Your sign-in has expired. The saved run request is retained; sign in as the same operator to confirm it.");
      return;
    }
    if (error instanceof ApiError && error.status === 422) {
      clearPendingCreate();
      showError(error.message, "Production rules require review");
      return;
    }
    if (error instanceof ApiError && error.status === 409
      && error.message.includes("Die defaults changed while this run was being prepared")) {
      clearPendingCreate();
      showError("Die defaults changed before this run was saved. Review the refreshed setup and submit again.", "Die defaults changed");
      el.createNote.textContent = "The previous run was not created. The saved request was cleared so you can review current defaults.";
      await fetchRuns({ quiet: true });
      return;
    }
    serverStateConfirmed = false;
    updateInventoryContext(currentStaff, false);
    updateScheduleContext(currentStaff, false);
    updateMixPlanContext(currentStaff, serverStateConfirmed);
    showError(error instanceof Error ? error.message : "Run creation could not be confirmed. Retry the same request; its identity and details are preserved.", "Run not confirmed");
    el.createNote.textContent = "Not confirmed. Retry uses the same request ID and details; do not start a different creation request.";
    setConnection(false);
  } finally {
    createInFlight = false;
    updateCreateFormForAuth();
    render();
  }
}

if (pendingCreate) {
  el.label.value = pendingCreate.setupSnapshot.label;
  el.target.value = String(pendingCreate.setupSnapshot.targetCases);
  if (pendingCreate.setupSnapshot.productCode) el.product.value = pendingCreate.setupSnapshot.productCode;
  if (pendingCreate.setupSnapshot.productionSetupCode) el.productionSetup.value = pendingCreate.setupSnapshot.productionSetupCode;
  el.label.disabled = true;
  el.target.disabled = true;
  el.createButton.textContent = "Retry same request";
  el.createNote.textContent = "A previous request needs confirmation. Retry sends the same request ID and run details; it will not retry automatically.";
}

initializeInventory();
initializeManagerOperations();
el.runSupplyForm.addEventListener("submit", (event) => { void submitRunStagedSupply(event); });
el.runSupplyRetry.addEventListener("click", (event) => { void submitRunStagedSupply(event, true); });
el.runSupplyPlanned.addEventListener("change", () => {
  const run = selectedRun();
  if (run) updateSupplyActualChoices(run);
});
el.refresh.addEventListener("click", () => fetchRuns());
el.createForm.addEventListener("submit", createRun);
el.product.addEventListener("change", renderRunProductionSetups);
el.productionSetup.addEventListener("change", renderRunDieSetup);
el.dieType.addEventListener("change", selectRunDie);
el.stationForm.addEventListener("submit", submitStationForm);
el.authForm.addEventListener("submit", submitSignIn);
el.passwordResetRequestForm.addEventListener("submit", submitPasswordResetRequest);
el.passwordResetCompletionForm.addEventListener("submit", submitPasswordResetCompletion);
el.passwordResetRequestToggle.addEventListener("click", () => showPasswordResetForm("request"));
el.passwordResetCompletionToggle.addEventListener("click", () => showPasswordResetForm("complete"));
el.passwordResetRequestCancel.addEventListener("click", returnToSignIn);
el.passwordResetCompletionCancel.addEventListener("click", returnToSignIn);
el.bootstrapForm.addEventListener("submit", submitBootstrap);
el.setupToggle.addEventListener("click", () => toggleBootstrapForm(true));
el.setupCancel.addEventListener("click", () => toggleBootstrapForm(false));
el.staffCreateForm.addEventListener("submit", submitStaffCreate);
el.staffList.addEventListener("click", handleStaffAction);
el.stationWorkerRefresh.addEventListener("click", () => void loadStationWorkerStatus());
el.staffHistoryMore.addEventListener("click", () => void loadStaffHistory({ append: true }));
el.passwordResetQueue.addEventListener("click", handlePasswordResetAction);
el.passwordResetRefresh.addEventListener("click", () => void loadPasswordResetQueue());
el.authRetry.addEventListener("click", checkSession);
el.signOut.addEventListener("click", signOut);
window.addEventListener("v2:select-run", async (event) => {
  const runId = event.detail?.runId;
  if (!currentStaff || !UUID.test(runId || "")) return;
  try {
    const run = runs.find((item) => item.id === runId) || await fetchOneRun(runId);
    selectedRunId = run.id;
    lastKnownRun = run;
    render();
    document.querySelector("#workspace")?.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    showError(error instanceof Error ? error.message : "The selected run could not be loaded.", "Run unavailable");
  }
});
window.addEventListener("offline", enterOfflineMode);
window.addEventListener("online", () => {
  if (currentStaff) void fetchRuns({ quiet: true });
  else void checkSession();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  if (currentStaff) {
    fetchRuns({ quiet: true });
    if (staffManagementAllowed()) void loadStationWorkerStatus();
  }
  else checkSession();
});
window.addEventListener("focus", () => {
  if (currentStaff) {
    fetchRuns({ quiet: true });
    if (staffManagementAllowed()) void loadStationWorkerStatus();
  }
  else checkSession();
});
window.setInterval(() => {
  if (!document.hidden && currentStaff && navigator.onLine !== false) {
    fetchRuns({ quiet: true });
  }
}, POLL_INTERVAL_MS);
window.setInterval(() => {
  if (!document.hidden && currentStaff && navigator.onLine !== false && staffManagementAllowed()) {
    void loadStationWorkerStatus();
  }
}, 15_000);
window.setInterval(updateStationTimer, 500);
if ("serviceWorker" in navigator) {
  void navigator.serviceWorker.register("/service-worker.js", { scope: "/" }).catch(() => {
    // The live app still works when a browser or host disables service workers.
  });
}

void checkSession();
