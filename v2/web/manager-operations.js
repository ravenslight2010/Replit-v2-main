const API = "/api/v2/manager-operations";
const PAGE_SIZE = 50;
const MAX_DAYS = 90;
const REFRESH_MS = 30_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const TIME_ZONE = "America/Chicago";
const $ = (id) => document.getElementById(id);

const dom = {
  panel: $("manager-operations"),
  nav: $("manager-operations-nav-link"),
  status: $("manager-operations-status"),
  alert: $("manager-operations-alert"),
  filter: $("manager-operations-filter"),
  from: $("manager-operations-from"),
  to: $("manager-operations-to"),
  refresh: $("manager-operations-refresh"),
  export: $("manager-operations-export"),
  rangeNote: $("manager-operations-range-note"),
  actions: $("manager-operations-actions"),
  handoff: $("manager-operations-handoff"),
  metrics: $("manager-operations-metrics"),
  downtime: $("manager-operations-downtime"),
  health: $("manager-operations-health"),
  patterns: $("manager-operations-patterns"),
  runs: $("manager-operations-runs"),
  moreRuns: $("manager-operations-more-runs"),
  runCoverage: $("manager-operations-run-coverage"),
  events: $("manager-operations-events"),
  moreEvents: $("manager-operations-more-events"),
  allEvents: $("manager-operations-all-events"),
  eventCoverage: $("manager-operations-event-coverage"),
  coverage: $("manager-operations-coverage"),
  inventoryLink: $("ops-inventory-link"),
  scheduleLink: $("ops-schedule-link"),
  qcLink: $("ops-qc-link"),
};

let staff = null;
let snapshot = null;
let events = [];
let eventRunId = null;
let eventCursor = null;
let overviewRequest = 0;
let eventRequest = 0;
let overviewLoading = false;
let eventLoading = false;
let actionInFlight = false;
let pollTimer = null;

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value, fallback = "—") {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function node(tag, className, content) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (content !== undefined) element.textContent = String(content);
  return element;
}

function centralToday() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

function shiftDate(dateString, days) {
  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function rangeIsValid() {
  if (!dom.from.value || !dom.to.value) return false;
  const from = Date.parse(`${dom.from.value}T00:00:00Z`);
  const to = Date.parse(`${dom.to.value}T00:00:00Z`);
  return Number.isFinite(from) && Number.isFinite(to)
    && to >= from && (to - from) / 86_400_000 < MAX_DAYS;
}

function hasCapability(capability) {
  return Array.isArray(staff?.capabilities) && staff.capabilities.includes(capability);
}

function csrfHeaders() {
  const match = document.cookie.match(/(?:^|;\s*)v2_csrf=([A-Za-z0-9_-]{43})(?:;|$)/u);
  return match ? { "X-CSRF-Token": match[1] } : {};
}

async function responseBody(response) {
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error("The manager operations response could not be read.");
  }
  if (!isObject(body)) throw new Error("The manager operations response was incomplete.");
  if (!response.ok) {
    const error = new Error(text(body.error, "Manager operations could not be confirmed."));
    error.status = response.status;
    throw error;
  }
  return body;
}

function validSnapshot(value) {
  return isObject(value)
    && value.timeZone === TIME_ZONE
    && typeof value.fromDate === "string" && typeof value.toDate === "string"
    && isObject(value.runs) && Array.isArray(value.runs.items)
    && typeof value.runs.hasMore === "boolean"
    && (value.runs.nextCursor === null || typeof value.runs.nextCursor === "string")
    && isObject(value.summary) && Array.isArray(value.activeRuns)
    && Array.isArray(value.pauseTrend) && Array.isArray(value.eventPatterns)
    && Array.isArray(value.actions) && isObject(value.dataHealth) && isObject(value.coverage);
}

function validEventPage(value) {
  return isObject(value) && Array.isArray(value.events)
    && typeof value.hasMore === "boolean"
    && (value.nextCursor === null || typeof value.nextCursor === "string");
}

function setStatus(message) {
  dom.status.textContent = message;
}

function setAlert(message = "") {
  dom.alert.textContent = message;
  dom.alert.hidden = message.length === 0;
}

function formatCentral(value, options = {}) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return "Time unavailable";
  return new Intl.DateTimeFormat(undefined, {
    timeZone: TIME_ZONE,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    ...options,
  }).format(new Date(value));
}

function emptyList(list, message) {
  const item = node("li", "ops-empty", message);
  list.replaceChildren(item);
}

function formatStatus(value) {
  return ({
    pending: "Pending",
    acknowledged: "Acknowledged",
    resolved: "Resolved",
    "unavailable-evidence": "Unavailable evidence",
    planned: "Planned",
    running: "Running",
    paused: "Paused",
    completed: "Completed",
  })[value] || text(value, "Unknown");
}

function makeActionForm(action) {
  const form = node("form", "ops-action-form");
  form.dataset.actionKey = action.actionKey;
  form.dataset.expectedRevision = String(action.revision);

  const statusLabel = node("label", "", "Next status");
  const statusSelect = document.createElement("select");
  statusSelect.name = "status";
  statusSelect.required = true;
  const blank = node("option", "", "Choose status");
  blank.value = "";
  blank.disabled = true;
  blank.selected = true;
  statusSelect.append(blank);
  const transitions = {
    pending: [["acknowledged", "Acknowledge"], ["resolved", "Resolved"], ["unavailable-evidence", "Unavailable evidence"]],
    acknowledged: [["resolved", "Resolved"], ["unavailable-evidence", "Unavailable evidence"]],
    resolved: [["acknowledged", "Reopen as acknowledged"]],
    "unavailable-evidence": [["acknowledged", "Evidence is available"], ["resolved", "Resolved"]],
  };
  for (const [value, label] of transitions[action.status] || []) {
    const option = node("option", "", label);
    option.value = value;
    statusSelect.append(option);
  }
  statusLabel.append(statusSelect);

  const noteLabel = node("label", "", "Reason for this review");
  const note = document.createElement("input");
  note.name = "note";
  note.minLength = 3;
  note.maxLength = 500;
  note.required = true;
  note.autocomplete = "off";
  note.placeholder = "Brief manager note";
  noteLabel.append(note);

  const save = node("button", "button button-secondary button-small", "Save status");
  save.type = "submit";
  save.disabled = actionInFlight || navigator.onLine === false;
  form.append(statusLabel, noteLabel, save);
  return form;
}

function renderActions() {
  dom.actions.replaceChildren();
  const actions = Array.isArray(snapshot?.actions) ? snapshot.actions : [];
  if (!actions.length) {
    emptyList(dom.actions, "No recorded paused-run actions match this date range. This does not confirm that other evidence is absent.");
    return;
  }
  for (const action of actions) {
    const item = node("li", "ops-action");
    const top = node("div", "ops-action-top");
    top.append(node("strong", "", text(action.title, "Manager follow-up")));
    const badge = node("span", "ops-status-badge", formatStatus(action.status));
    badge.dataset.status = action.status;
    top.append(badge);
    item.append(top);
    item.append(node("span", "ops-action-meta", `${text(action.runLabel, "Run")} · ${formatCentral(action.occurredAt)} · source run revision ${action.sourceRevision}`));
    const source = node("button", "button button-secondary button-small ops-open-run", "Open run");
    source.type = "button";
    source.dataset.openRunId = action.runId;
    item.append(source);
    if (action.lastAction) {
      item.append(node("p", "ops-action-last",
        `${formatStatus(action.lastAction.status)} by staff ${text(action.lastAction.actorId)} · ${formatCentral(action.lastAction.occurredAt)} · ${text(action.lastAction.note)}`));
    }
    item.append(makeActionForm(action));
    dom.actions.append(item);
  }
}

function renderHandoff() {
  dom.handoff.replaceChildren();
  const active = Array.isArray(snapshot?.activeRuns) ? snapshot.activeRuns : [];
  if (!active.length) {
    emptyList(dom.handoff, "No running or paused V2 runs are recorded now.");
    return;
  }
  for (const run of active) {
    const item = node("li");
    const row = node("div", "ops-run-row");
    const copy = document.createElement("div");
    copy.append(node("strong", "", text(run.label, "Run")));
    copy.append(node("p", "", `${formatStatus(run.status)} · updated ${formatCentral(run.updatedAt)} · target ${run.targetCases} cases`));
    row.append(copy);
    const button = node("button", "button button-secondary button-small ops-open-run", "Open run");
    button.type = "button";
    button.dataset.openRunId = run.runId;
    row.append(button);
    item.append(row);
    dom.handoff.append(item);
  }
}

function metric(label, value) {
  const wrapper = document.createElement("div");
  wrapper.append(node("dt", "", label), node("dd", "", value));
  return wrapper;
}

function renderMetrics() {
  const summary = snapshot?.summary || {};
  dom.metrics.replaceChildren(
    metric("Runs created", summary.runsCreated ?? "Unknown"),
    metric("Completed runs", summary.completed ?? "Unknown"),
    metric("Currently paused", summary.paused ?? "Unknown"),
    metric("Target cases", summary.targetCases ?? "Unknown"),
    metric("Cases produced · recorded", summary.casesProduced ?? "Unavailable"),
    metric("Average run minutes", summary.averageRunMinutes ?? "Unknown"),
  );
}

function renderDowntime() {
  dom.downtime.replaceChildren();
  const trend = Array.isArray(snapshot?.pauseTrend) ? snapshot.pauseTrend : [];
  if (!trend.length) {
    emptyList(dom.downtime, "No downtime trend is available for this range.");
    return;
  }
  for (const day of trend) {
    const item = node("li");
    item.append(node("strong", "", day.date));
    item.append(node("p", "", `${day.pauseMinutes} recorded pause minutes`));
    dom.downtime.append(item);
  }
}

function renderHealthAndPatterns() {
  dom.health.replaceChildren();
  const health = snapshot?.dataHealth;
  const count = health?.unknownIngredientReferences;
  if (!Number.isSafeInteger(count)) {
    emptyList(dom.health, "Reference-link findings are unavailable.");
  } else {
    const item = node("li");
    item.append(node("strong", "", `${count} ingredient reference${count === 1 ? "" : "s"} not established in run snapshots`));
    item.append(node("p", "", `${health.runsWithUnknownIngredientReferences ?? 0} runs · Unknown is not proof of incorrect or corrupted data; confirm in the owning setup or QC workflow.`));
    dom.health.append(item);
  }
  const patterns = Array.isArray(snapshot?.eventPatterns) ? snapshot.eventPatterns : [];
  dom.patterns.replaceChildren();
  const incidentStatus = snapshot?.coverage?.incidentPatterns;
  const incidentItem = node("li");
  incidentItem.append(node("strong", "", incidentStatus?.status === "unavailable"
    ? "Incident patterns unavailable"
    : "Incident records"));
  incidentItem.append(node("p", "", text(incidentStatus?.note,
    "Incident records are not part of the available V2 sources.")));
  dom.patterns.append(incidentItem);
  if (!patterns.length) {
    const item = node("li");
    item.append(node("strong", "", "No recorded run-event patterns"));
    item.append(node("p", "", "No matching run events were recorded for this range; no incident or sync-conflict count is inferred."));
    dom.patterns.append(item);
  } else {
    for (const pattern of patterns) {
      const item = node("li");
      item.append(node("strong", "", text(pattern.eventType, "Run event")));
      item.append(node("p", "", `${pattern.count} recorded event${pattern.count === 1 ? "" : "s"}; event volume is not an incident or corruption finding.`));
      dom.patterns.append(item);
    }
  }
}

function renderRuns() {
  dom.runs.replaceChildren();
  const runs = Array.isArray(snapshot?.runs?.items) ? snapshot.runs.items : [];
  if (!runs.length) {
    emptyList(dom.runs, "No canonical V2 runs were created during this date range.");
  } else {
    for (const run of runs) {
      const item = node("li");
      const row = node("div", "ops-run-row");
      const copy = document.createElement("div");
      copy.append(node("strong", "", text(run.label, "Run")));
      copy.append(node("p", "", `${formatStatus(run.status)} · ${run.targetCases} target cases · created ${formatCentral(run.createdAt)}`));
      copy.append(node("span", "ops-muted", `Run ${run.runId} · revision ${run.revision}`));
      row.append(copy);
      const controls = node("div", "manager-list-actions");
      const open = node("button", "button button-secondary button-small ops-open-run", "Open run");
      open.type = "button";
      open.dataset.openRunId = run.runId;
      const history = node("button", "button button-secondary button-small", "View events");
      history.type = "button";
      history.dataset.eventsForRun = run.runId;
      controls.append(open, history);
      row.append(controls);
      item.append(row);
      dom.runs.append(item);
    }
  }
  dom.moreRuns.hidden = snapshot?.runs?.hasMore !== true;
  dom.runCoverage.hidden = snapshot?.runs?.hasMore !== true;
  dom.runCoverage.textContent = snapshot?.runs?.hasMore === true
    ? "This page is partial. Load older runs to continue through the selected 90-day range."
    : "";
}

function renderEvents() {
  dom.events.replaceChildren();
  if (!events.length) {
    emptyList(dom.events, eventRunId
      ? "No sanitized run events match this run and date range."
      : "No sanitized run events were recorded during this date range.");
  } else {
    for (const event of events) {
      const item = node("li");
      const row = node("div", "ops-event-row");
      const copy = document.createElement("div");
      copy.append(node("strong", "", text(event.eventType, "Run event")));
      copy.append(node("p", "", `${text(event.runLabel, "Run")} · ${formatCentral(event.occurredAt)}`));
      copy.append(node("span", "ops-muted", `Run ${event.runId} · staff ${text(event.actorId, "system")}`));
      row.append(copy);
      const open = node("button", "button button-secondary button-small ops-open-run", "Open run");
      open.type = "button";
      open.dataset.openRunId = event.runId;
      row.append(open);
      item.append(row);
      dom.events.append(item);
    }
  }
  dom.moreEvents.hidden = !eventCursor;
  dom.allEvents.hidden = !eventRunId;
  dom.eventCoverage.hidden = !eventCursor;
  dom.eventCoverage.textContent = eventCursor ? "This event page is partial. Load older events to continue." : "";
}

const SOURCE_LABELS = {
  runs: "V2 run records",
  runEvents: "Run event history",
  pauseIntervals: "Run pause intervals",
  actualCaseOutput: "Recorded production output",
  runInsights: "Descriptive run insights",
  incidentPatterns: "Incident patterns",
  dataHealth: "Data-health findings",
  referenceLinks: "Run reference links",
  operationalReports: "Run operational report",
  shiftHandoff: "Shift handoff",
  managerActions: "Manager action history",
  qcHistory: "QC history",
  inventoryHistory: "Inventory history",
  importHistory: "Import history",
  scheduleHistory: "Schedule history",
  syncConflicts: "Sync-conflict history",
};

function renderCoverage() {
  dom.coverage.replaceChildren();
  for (const [key, source] of Object.entries(snapshot?.coverage || {})) {
    const item = node("li");
    const row = node("div", "ops-source-row");
    const copy = document.createElement("div");
    copy.append(node("strong", "", SOURCE_LABELS[key] || key));
    const count = Number.isSafeInteger(source?.records) ? ` · ${source.records} records in range` : "";
    const note = text(source?.note, source?.status === "available"
      ? "Canonical server records available for the selected range."
      : "Coverage is incomplete.");
    copy.append(node("p", "", `${note}${count}`));
    const badge = node("span", "ops-source-status", source?.status || "unknown");
    badge.dataset.status = source?.status || "unknown";
    row.append(copy, badge);
    item.append(row);
    dom.coverage.append(item);
  }
}

function render() {
  if (!snapshot) return;
  const items = snapshot.runs.items.length;
  dom.rangeNote.textContent = `Inclusive range ${snapshot.fromDate} through ${snapshot.toDate} · America/Chicago · ${items} run record${items === 1 ? "" : "s"} on this page.`;
  renderActions();
  renderHandoff();
  renderMetrics();
  renderDowntime();
  renderHealthAndPatterns();
  renderRuns();
  renderEvents();
  renderCoverage();
  dom.export.disabled = false;
}

async function loadSnapshot({ append = false } = {}) {
  if (!staff || !hasCapability("review-incidents") || overviewLoading) return;
  if (!rangeIsValid()) {
    setAlert("Choose a valid Central-time range of 1 to 90 days.");
    return;
  }
  if (append && !snapshot?.runs?.nextCursor) return;
  const requestId = ++overviewRequest;
  overviewLoading = true;
  dom.refresh.disabled = true;
  setAlert("");
  setStatus(append ? "Loading older run records…" : "Loading the canonical manager report…");
  const params = new URLSearchParams({
    from: dom.from.value,
    to: dom.to.value,
    limit: String(PAGE_SIZE),
  });
  if (append) params.set("cursor", snapshot.runs.nextCursor);
  try {
    const response = await fetch(`${API}?${params}`, {
      method: "GET", credentials: "same-origin", headers: { Accept: "application/json" },
    });
    const body = await responseBody(response);
    if (!validSnapshot(body)) throw new Error("The manager report did not contain complete summary and coverage data.");
    if (requestId !== overviewRequest || !staff) return;
    if (append && snapshot) {
      body.runs.items = [...snapshot.runs.items, ...body.runs.items];
    }
    snapshot = body;
    if (!append) {
      events = [];
      eventCursor = null;
      eventRunId = null;
    }
    render();
    setStatus(`Report refreshed at ${formatCentral(snapshot.generatedAt)}.`);
    if (!append) await loadEvents({ reset: true });
  } catch (error) {
    if (requestId !== overviewRequest || !staff) return;
    setAlert(error instanceof Error ? error.message : "Manager operations could not be loaded.");
    setStatus("The report is not confirmed by the server.");
    if (!snapshot) {
      for (const list of [dom.actions, dom.handoff, dom.downtime, dom.health, dom.patterns, dom.runs, dom.events, dom.coverage]) {
        emptyList(list, "Source data is not available until the server confirms it.");
      }
    }
  } finally {
    if (requestId === overviewRequest) {
      overviewLoading = false;
      dom.refresh.disabled = false;
    }
  }
}

async function loadEvents({ reset = false, append = false, runId = eventRunId } = {}) {
  if (!staff || !hasCapability("review-incidents") || eventLoading || !rangeIsValid()) return;
  if (reset) {
    eventCursor = null;
    if (runId !== eventRunId) events = [];
    eventRunId = runId ?? null;
  }
  if (append && !eventCursor) return;
  const requestId = ++eventRequest;
  eventLoading = true;
  const params = new URLSearchParams({
    from: dom.from.value,
    to: dom.to.value,
    limit: String(PAGE_SIZE),
  });
  if (eventRunId) params.set("runId", eventRunId);
  if (append && eventCursor) params.set("cursor", eventCursor);
  try {
    const response = await fetch(`${API}/events?${params}`, {
      method: "GET", credentials: "same-origin", headers: { Accept: "application/json" },
    });
    const body = await responseBody(response);
    if (!validEventPage(body)) throw new Error("Run event history is incomplete. Refresh to try again.");
    if (requestId !== eventRequest || !staff) return;
    events = append ? [...events, ...body.events] : body.events;
    eventCursor = body.hasMore ? body.nextCursor : null;
    renderEvents();
  } catch (error) {
    if (requestId === eventRequest && staff) {
      setAlert(error instanceof Error ? error.message : "Run event history could not be loaded.");
      renderEvents();
    }
  } finally {
    if (requestId === eventRequest) eventLoading = false;
  }
}

async function updateAction(event) {
  const form = event.target.closest("form[data-action-key]");
  if (!form || actionInFlight) return;
  event.preventDefault();
  if (!staff || !hasCapability("review-incidents") || navigator.onLine === false) {
    setAlert("A confirmed connection and manager access are required to change action status.");
    return;
  }
  const values = new FormData(form);
  const status = values.get("status");
  const note = values.get("note");
  if (!["acknowledged", "resolved", "unavailable-evidence"].includes(status)
    || typeof note !== "string" || note.trim().length < 3) {
    setAlert("Choose a status and enter a short review note.");
    return;
  }
  actionInFlight = true;
  renderActions();
  setAlert("");
  setStatus("Saving the manager action with its source revision…");
  try {
    const response = await fetch(`${API}/actions/${encodeURIComponent(form.dataset.actionKey)}/status`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json", ...csrfHeaders() },
      body: JSON.stringify({
        requestId: crypto.randomUUID(),
        expectedRevision: Number(form.dataset.expectedRevision),
        status,
        note: note.trim(),
      }),
    });
    const body = await responseBody(response);
    if (!body.event || body.event.actorId !== staff.userId || body.event.status !== status) {
      throw new Error("The server did not confirm the attributed action status. Refresh before retrying.");
    }
    setStatus("Manager action recorded. The run and source evidence were not changed.");
    await loadSnapshot();
  } catch (error) {
    setAlert(error instanceof Error ? error.message : "The manager action could not be confirmed.");
    setStatus(error?.status === 409 ? "The action is stale; refresh its current status before retrying." : "The action was not confirmed.");
  } finally {
    actionInFlight = false;
    renderActions();
  }
}

function csvCell(value) {
  const textValue = String(value ?? "");
  return `"${textValue.replaceAll('"', '""')}"`;
}

function exportReport() {
  if (!snapshot) return;
  const rows = [
    ["report", "V2 manager operations summary"],
    ["from_date", snapshot.fromDate],
    ["to_date", snapshot.toDate],
    ["time_zone", snapshot.timeZone],
    ["metric", "value"],
    ["runs_created", snapshot.summary.runsCreated],
    ["completed_runs", snapshot.summary.completed],
    ["paused_runs", snapshot.summary.paused],
    ["target_cases_not_actual_output", snapshot.summary.targetCases],
    ["average_run_minutes", snapshot.summary.averageRunMinutes ?? "unavailable"],
    ...snapshot.pauseTrend.map((item) => [`pause_minutes:${item.date}`, item.pauseMinutes]),
    ...snapshot.eventPatterns.map((item) => [`recorded_event:${item.eventType}`, item.count]),
    ...Object.entries(snapshot.coverage).map(([key, source]) => [`source_coverage:${key}`, source.status]),
    ["privacy_note", "Summary only; no raw event payloads, credentials, or secrets."],
  ];
  const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `v2-operations-${snapshot.fromDate}-to-${snapshot.toDate}.csv`;
  link.click();
  URL.revokeObjectURL(url);
  setStatus("A summary-only report was downloaded.");
}

function openRun(runId) {
  if (UUID.test(runId || "")) {
    window.dispatchEvent(new CustomEvent("v2:select-run", { detail: { runId } }));
  }
}

function updateDomainLinks() {
  dom.inventoryLink.hidden = !hasCapability("manage-inventory");
  dom.scheduleLink.hidden = !hasCapability("manage-factory-settings");
  dom.qcLink.hidden = !["manage-qc", "manage-allergens", "record-qc"].some(hasCapability);
}

function clearScopedData() {
  snapshot = null;
  events = [];
  eventRunId = null;
  eventCursor = null;
  overviewRequest += 1;
  eventRequest += 1;
  dom.actions.replaceChildren();
  dom.handoff.replaceChildren();
  dom.metrics.replaceChildren();
  dom.downtime.replaceChildren();
  dom.health.replaceChildren();
  dom.patterns.replaceChildren();
  dom.runs.replaceChildren();
  dom.events.replaceChildren();
  dom.coverage.replaceChildren();
  dom.export.disabled = true;
}

export function updateManagerOperationsContext(nextStaff) {
  const changedIdentity = staff?.userId !== nextStaff?.userId;
  staff = isObject(nextStaff) ? nextStaff : null;
  const allowed = hasCapability("review-incidents");
  dom.panel.hidden = !allowed;
  dom.nav.hidden = !allowed;
  updateDomainLinks();
  if (!allowed) {
    if (changedIdentity || snapshot) clearScopedData();
    setStatus(staff ? "Manager operations are not available to this account." : "");
    setAlert("");
    return;
  }
  if (changedIdentity || !dom.from.value || !dom.to.value) {
    clearScopedData();
    const today = centralToday();
    dom.to.value = today;
    dom.from.value = shiftDate(today, -6);
  }
  if (changedIdentity || !snapshot) void loadSnapshot();
}

export function initializeManagerOperations() {
  if (!dom.panel || !dom.filter) return;
  dom.filter.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!rangeIsValid()) {
      setAlert("Choose a valid Central-time range of 1 to 90 days.");
      return;
    }
    snapshot = null;
    events = [];
    eventCursor = null;
    eventRunId = null;
    void loadSnapshot();
  });
  dom.actions.addEventListener("submit", (event) => { void updateAction(event); });
  dom.actions.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-open-run-id]");
    if (button) openRun(button.dataset.openRunId);
  });
  dom.runs.addEventListener("click", (event) => {
    const open = event.target.closest("button[data-open-run-id]");
    const history = event.target.closest("button[data-events-for-run]");
    if (open) openRun(open.dataset.openRunId);
    if (history) void loadEvents({ reset: true, runId: history.dataset.eventsForRun });
  });
  dom.handoff.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-open-run-id]");
    if (button) openRun(button.dataset.openRunId);
  });
  dom.events.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-open-run-id]");
    if (button) openRun(button.dataset.openRunId);
  });
  dom.moreRuns.addEventListener("click", () => void loadSnapshot({ append: true }));
  dom.moreEvents.addEventListener("click", () => void loadEvents({ append: true }));
  dom.allEvents.addEventListener("click", () => void loadEvents({ reset: true, runId: null }));
  dom.export.addEventListener("click", exportReport);
  window.addEventListener("online", () => { if (staff) void loadSnapshot(); });
  window.addEventListener("focus", () => { if (staff && !document.hidden) void loadSnapshot(); });
  document.addEventListener("visibilitychange", () => {
    if (staff && !document.hidden) void loadSnapshot();
  });
  pollTimer = window.setInterval(() => {
    if (staff && !document.hidden && navigator.onLine !== false) void loadSnapshot();
  }, REFRESH_MS);
  if (pollTimer && typeof pollTimer.unref === "function") pollTimer.unref();
}
