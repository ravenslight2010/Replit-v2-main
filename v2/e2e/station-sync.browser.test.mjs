import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { access, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { chromium, webkit as pinnedWebkit } from "../../node_modules/.pnpm/node_modules/playwright/index.mjs";
import * as XLSX from "xlsx";
import { parseOpeningCountCsv, parseSetupImportCsv } from "../core/import-csv.mjs";
import {
  analyzeWorkbookCapacityDuplicates,
  linkWorkbookCapacityRows,
  parseDoughCapacityWorkbook,
  parseShippingCapacityWorkbook,
} from "../core/workbook-capacity-import.mjs";
import {
  openingCountCsvTemplate,
  renderImportCsvTemplate,
  setupImportCsvTemplates,
} from "../core/import-csv-templates.mjs";
import { parseSetupCatalogCsv, setupCatalogCsvTemplates } from "../core/setup-catalog-csv.mjs";
import { parseSourceWorkbook } from "../core/source-workbook-import.mjs";
import { applyScheduleCommand, emptySchedule } from "../core/schedule-planning.mjs";

const CSRF_TOKEN = "a".repeat(43);
const STAFF_ID = "72000000-0000-4000-8000-000000000001";
const RUN_ID = "73000000-0000-4000-8000-000000000001";
const webkit = process.env.V2_WEBKIT_PLAYWRIGHT_MODULE
  ? createRequire(import.meta.url)(process.env.V2_WEBKIT_PLAYWRIGHT_MODULE).webkit
  : pinnedWebkit;
const webkitExecutablePath = process.env.V2_WEBKIT_EXECUTABLE_PATH || webkit.executablePath();
let webkitInstalled = true;
try {
  await access(webkitExecutablePath);
} catch {
  webkitInstalled = false;
}
if (process.env.V2_SKIP_WEBKIT === "true") webkitInstalled = false;
if (process.env.V2_REQUIRE_WEBKIT === "true" && !webkitInstalled) {
  throw new Error("Required WebKit coverage cannot be skipped: install its supported runtime first.");
}
const INPUTS = Object.freeze({
  line: ["autoTrackRatePerMinute", "timerDurationSeconds", "casesPerSkid"],
  dough: ["autoTrackRatePerMinute", "timerDurationSeconds", "traysPerBatch"],
  cheese: ["autoTrackRatePerMinute", "timerDurationSeconds", "pizzasPerCase", "ozPerPizza", "batchLbs"],
  pepperoni: ["autoTrackRatePerMinute", "timerDurationSeconds", "pizzasPerCase", "ozPerPizza", "batchLbs"],
  sauce: ["autoTrackRatePerMinute", "timerDurationSeconds", "pizzasPerCase", "ozPerPizza", "barrelLbs"],
  frontline: ["autoTrackRatePerMinute", "timerDurationSeconds", "pizzasPerCase", "ozPerPizza", "batchLbs"],
  packaging: ["autoTrackRatePerMinute", "timerDurationSeconds", "casesPerSkid"],
});
const PROGRESS = Object.freeze({
  line: ["casesProduced", "casesOnLine", "casesInFreezer"],
  dough: ["casesProduced", "traysOnLine", "batchesReady", "batchesMade"],
  cheese: ["casesCompleted", "batchesMade", "stockOnLineLbs"],
  pepperoni: ["casesCompleted", "batchesMade", "stockOnLineLbs"],
  sauce: ["barrelsMade", "stockBarrels"],
  frontline: ["casesCompleted", "batchesMade", "stockOnLineLbs"],
  packaging: ["casesPacked"],
});
const AUTO_FIELD = Object.freeze({
  line: "casesProduced", dough: "casesProduced", cheese: "casesCompleted",
  pepperoni: "casesCompleted", sauce: "barrelsMade", frontline: "batchesMade",
  packaging: "casesPacked",
});
const WEB_ASSETS = new Map([
  ["/", ["../web/index.html", "text/html; charset=utf-8"]],
  ["/v2/web/app-shell.html", ["../web/index.html", "text/html; charset=utf-8"]],
  ["/manifest.webmanifest", ["../web/manifest.webmanifest", "application/manifest+json; charset=utf-8"]],
  ["/v2/web/manifest.webmanifest", ["../web/manifest.webmanifest", "application/manifest+json; charset=utf-8"]],
  ["/service-worker.js", ["../web/service-worker.js", "text/javascript; charset=utf-8"]],
  ["/favicon.ico", ["../web/favicon.svg", "image/svg+xml"]],
  ["/v2/web/favicon.svg", ["../web/favicon.svg", "image/svg+xml"]],
  ["/v2/web/app.js", ["../web/app.js", "text/javascript; charset=utf-8"]],
  ["/v2/web/update-manager.mjs", ["../web/update-manager.mjs", "text/javascript; charset=utf-8"]],
  ["/v2/web/manager-operations.js", ["../web/manager-operations.js", "text/javascript; charset=utf-8"]],
  ["/v2/web/inventory.js", ["../web/inventory.js", "text/javascript; charset=utf-8"]],
  ["/v2/web/inventory-export.mjs", ["../web/inventory-export.mjs", "text/javascript; charset=utf-8"]],
  ["/v2/web/setup-catalog.js", ["../web/setup-catalog.js", "text/javascript; charset=utf-8"]],
  ["/v2/web/manager-operations.js", ["../web/manager-operations.js", "text/javascript; charset=utf-8"]],
  ["/v2/web/schedule.js", ["../web/schedule.js", "text/javascript; charset=utf-8"]],
  ["/v2/web/mix-plan.js", ["../web/mix-plan.js", "text/javascript; charset=utf-8"]],
  ["/v2/core/mix-plan.mjs", ["../core/mix-plan.mjs", "text/javascript; charset=utf-8"]],
  ["/v2/web/qc.js", ["../web/qc.js", "text/javascript; charset=utf-8"]],
  ["/v2/web/styles.css", ["../web/styles.css", "text/css; charset=utf-8"]],
  ["/v2/web/write-gate.mjs", ["../web/write-gate.mjs", "text/javascript; charset=utf-8"]],
  ["/v2/core/import-csv-templates.mjs", ["../core/import-csv-templates.mjs", "text/javascript; charset=utf-8"]],
  ["/v2/core/import-csv.mjs", ["../core/import-csv.mjs", "text/javascript; charset=utf-8"]],
  ["/v2/core/die-defaults.mjs", ["../core/die-defaults.mjs", "text/javascript; charset=utf-8"]],
  ["/v2/core/setup-catalog-csv.mjs", ["../core/setup-catalog-csv.mjs", "text/javascript; charset=utf-8"]],
  ["/v2/core/station-workflows.mjs", ["../core/station-workflows.mjs", "text/javascript; charset=utf-8"]],
  ["/v2/core/schedule-planning.mjs", ["../core/schedule-planning.mjs", "text/javascript; charset=utf-8"]],
]);

function stationSnapshot({ inputs = {}, progress = {}, revision = 0, nextDueAt = null } = {}) {
  return {
    status: "not_started",
    revision,
    inputs,
    progress,
    startedAt: null,
    pausedAt: null,
    completedAt: null,
    nextDueAt,
    updatedAt: new Date().toISOString(),
  };
}

function newRun(overrides = {}) {
  const now = new Date().toISOString();
  return {
    id: RUN_ID,
    status: "running",
    revision: 1,
    createdAt: now,
    updatedAt: now,
    serverNow: now,
    startedAt: now,
    pausedAt: null,
    resumedAt: null,
    completedAt: null,
    setupSnapshot: {
      label: "Browser test run", targetCases: 100, productCode: "DOUGH-A", productionSetupCode: "LINE-A",
    },
    doughCapacity: { status: "available", reasons: [], doughballYield: 645.19, pizzasPerCase: 12 },
    pauseIntervals: [],
    stationProgress: {},
    ...overrides,
  };
}

function snapshot(fixture) {
  fixture.run.serverNow = new Date().toISOString();
  return JSON.parse(JSON.stringify(fixture.run));
}

function operationalStatus(runId) {
  const allergenFootprint = {
    status: "unknown",
    allergens: [],
    ingredientCount: 0,
    unknownIngredients: [],
  };
  return {
    runId,
    substitutions: [],
    allergenFootprint,
    stations: Object.fromEntries(["dough", "cheese", "pepperoni", "sauce", "frontline"].map((key) => [
      key,
      { substitutions: [], allergenFootprint },
    ])),
    limitations: { allergens: "incomplete" },
  };
}

function applyCommand(fixture, command) {
  if (fixture.receipts.has(command.commandId)) {
    return { outcome: "accepted", replayed: true, run: fixture.receipts.get(command.commandId) };
  }
  if (command.expectedRevision !== fixture.run.revision) {
    fixture.stationCommandOutcomes.push({ mode: command.mode, outcome: "conflict" });
    return { outcome: "conflict", currentRun: snapshot(fixture) };
  }
  if (command.mode === "timer_start" && fixture.forceTimerStartConflict) {
    fixture.forceTimerStartConflict = false;
    fixture.stationCommandOutcomes.push({ mode: command.mode, outcome: "conflict" });
    return { outcome: "conflict", currentRun: snapshot(fixture) };
  }
  const key = command.stationKey;
  const previous = fixture.run.stationProgress[key] || stationSnapshot();
  const state = structuredClone(previous);
  const now = new Date().toISOString();
  if (command.mode === "manual") {
    for (const [field, value] of Object.entries(command.changes)) {
      if (INPUTS[key].includes(field)) state.inputs[field] = value;
      if (PROGRESS[key].includes(field)) state.progress[field] = value;
    }
    state.nextDueAt = Number(state.inputs.autoTrackRatePerMinute) > 0
      ? new Date(Date.now() + 1000).toISOString()
      : null;
  } else if (command.mode === "auto_track") {
    const field = AUTO_FIELD[key];
    state.progress[field] = (Number(state.progress[field]) || 0) + 1;
    state.nextDueAt = new Date(Date.now() + 1000).toISOString();
  } else if (command.mode === "timer_start") {
    state.progress.timerStatus = "running";
    state.progress.timerStartedAt = now;
    state.progress.timerElapsedMs = 0;
    state.status = "running";
    state.startedAt ||= now;
  } else if (command.mode === "timer_pause") {
    state.progress.timerElapsedMs = Number(state.progress.timerElapsedMs) || 0;
    state.progress.timerStatus = "paused";
    state.progress.timerStartedAt = null;
    state.progress.timerPausedAt = now;
    state.status = "paused";
  } else if (command.mode === "timer_resume") {
    state.progress.timerStatus = "running";
    state.progress.timerStartedAt = now;
    state.progress.timerPausedAt = null;
    state.status = "running";
  } else if (command.mode === "timer_reset") {
    state.progress.timerStatus = "idle";
    state.progress.timerStartedAt = null;
    state.progress.timerPausedAt = null;
    state.progress.timerElapsedMs = 0;
    state.status = "not_started";
  }
  state.revision += 1;
  state.updatedAt = now;
  fixture.run.stationProgress[key] = state;
  fixture.run.revision += 1;
  fixture.run.updatedAt = now;
  const resultRun = snapshot(fixture);
  fixture.receipts.set(command.commandId, resultRun);
  fixture.stationCommandOutcomes.push({ mode: command.mode, outcome: "accepted" });
  return { outcome: "accepted", replayed: false, run: resultRun };
}

function startMockServerStationWorker(fixture) {
  const worker = setInterval(() => {
    if (fixture.run.status !== "running") return;
    const now = Date.now();
    for (const [stationKey, state] of Object.entries(fixture.run.stationProgress)) {
      const rate = Number(state.inputs.autoTrackRatePerMinute) || 0;
      const current = Number(state.progress[AUTO_FIELD[stationKey]]) || 0;
      const dueAt = Date.parse(state.nextDueAt || "");
      if (rate <= 0 || current >= fixture.run.setupSnapshot.targetCases || !Number.isFinite(dueAt) || dueAt > now) continue;
      applyCommand(fixture, {
        commandId: crypto.randomUUID(),
        expectedRevision: fixture.run.revision,
        runId: fixture.run.id,
        stationKey,
        mode: "auto_track",
        changes: {},
      });
    }
  }, 25);
  return () => clearInterval(worker);
}

async function createFixture(t, viewport = { width: 1440, height: 900 }, { manager = false, browserEngine = chromium } = {}) {
  const fixture = {
    run: newRun(),
    receipts: new Map(),
    pageErrors: [],
    consoleErrors: [],
    imports: [],
    setupCatalogImports: [],
    setupCatalogApplyCalls: 0,
    loseNextApplyResponse: false,
    expectedLostApplyConsoleError: false,
    stationCommandOutcomes: [],
    browserStationCommands: [],
    workbookLinks: new Map(),
    workbookLinkReceipts: new Map(),
    failNextWorkbookLinkResponse: false,
    rejectNextWorkbookLinkResponse: false,
    expectedWorkbookLinkConflictConsoleError: false,
    expectedWorkbookLinkConsoleError: false,
    forceTimerStartConflict: false,
    schedule: null,
    scheduleReceipts: new Map(),
    forceScheduleConflictOnce: false,
    expectedConflictConsoleErrors: 0,
    mixPlanCalls: [],
    mixPlanRevision: 0,
    notFoundRoutes: [],
    operationalStatus: operationalStatus(RUN_ID),
    operationalStatusCalls: 0,
  };
  const server = createServer(async (request, response) => {
    const asset = WEB_ASSETS.get(new URL(request.url, "http://v2.test").pathname);
    if (!asset || !["GET", "HEAD"].includes(request.method)) {
      response.writeHead(404).end();
      return;
    }
    try {
      const file = new URL(asset[0], import.meta.url);
      const content = await readFile(file);
      response.writeHead(200, {
        "Content-Type": asset[1],
        "Cache-Control": "no-cache",
        "Content-Security-Policy": "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self'; img-src 'self' data:; worker-src 'self'",
        "X-Content-Type-Options": "nosniff",
      });
      response.end(request.method === "HEAD" ? undefined : content);
    } catch {
      response.writeHead(500).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const launchOptions = { headless: true };
  if (browserEngine === chromium) {
    launchOptions.executablePath = process.env.CHROMIUM_PATH
      || execFileSync("which", ["chromium"], { encoding: "utf8" }).trim();
    launchOptions.args = ["--no-sandbox"];
  } else if (browserEngine === webkit && process.env.V2_WEBKIT_EXECUTABLE_PATH) {
    launchOptions.executablePath = process.env.V2_WEBKIT_EXECUTABLE_PATH;
  }
  if (browserEngine === webkit && process.env.V2_WEBKIT_SKIP_HOST_REQUIREMENTS === "1") {
    launchOptions.env = {
      ...process.env,
      PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS: "1",
      ...(process.env.V2_WEBKIT_EGL_VENDOR
        ? { __EGL_VENDOR_LIBRARY_FILENAMES: process.env.V2_WEBKIT_EGL_VENDOR }
        : {}),
    };
  }
  const browser = await browserEngine.launch(launchOptions);
  t.after(async () => {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  });
  const baseUrl = `http://127.0.0.1:${address.port}`;

  async function openDevice(deviceViewport = viewport, { canApprove = manager, withQc = false, initScript } = {}) {
    const context = await browser.newContext({
      viewport: deviceViewport,
      ...(browserEngine === webkit ? { serviceWorkers: "block" } : {}),
    });
    if (initScript) await context.addInitScript(initScript);
    const routeApi = async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname === "/api/v2/agent-test-preview/credentials") {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ enabled: false }) });
        return;
      }
      if (url.pathname === "/api/v2/auth/session" && request.method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: { "Set-Cookie": `v2_csrf=${CSRF_TOKEN}; Path=/; SameSite=Strict` },
          body: JSON.stringify({
            staff: {
              userId: STAFF_ID,
              username: "station_tester",
              role: canApprove ? "manager" : "operator",
              capabilities: ["station.command", "run.read", ...(withQc ? ["record-qc"] : []), ...(canApprove ? [
                "manage-inventory", "manage-factory-settings",
              ] : [])],
            },
          }),
        });
        return;
      }
      if (url.pathname === "/api/v2/mix-plan" && request.method() === "GET") {
        const makeDate = url.searchParams.get("makeDate");
        fixture.mixPlanCalls.push(makeDate);
        const quantity = fixture.mixPlanRevision === 0 ? 4 : 5;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            generatedAt: new Date().toISOString(),
            plan: {
              makeDate,
              timeZone: "America/Chicago",
              items: [{
                mixCode: "MIX-PLAN-TEST",
                mixName: "Synthetic Prep Mix",
                mode: "per-batch",
                preparationDate: makeDate,
                batchSizeLbs: 10,
                batchEquivalent: 0.2,
                totalQuantity: quantity,
                totalUnit: "each",
                components: [{
                  index: 0,
                  name: "Synthetic Flour",
                  ingredientCode: "FLOUR-TEST",
                  perPizzaOz: null,
                  perBatchLbs: 2,
                  amount: 0.4,
                  unit: "lb",
                  inventoryQuantity: null,
                  inventoryUnit: null,
                }],
                contributingRuns: [{
                  runId: "75000000-0000-4000-8000-000000000011",
                  label: "Scheduled Test Run",
                  status: "scheduled",
                  productionDate: makeDate,
                  productCode: "PRODUCT",
                  productName: "Brand Flavor",
                  cases: 2,
                  pizzas: 24,
                }],
                warnings: [],
              }],
              warnings: [{
                code: "ingredient-conversion-missing",
                message: "Synthetic Flour has no complete inventory product and stock-unit conversion.",
              }],
              coverage: { scheduledRunCount: 1, activeRunCount: 0, includedRunCount: 1, enabledMixCount: 1 },
            },
          }),
        });
        return;
      }
      if (manager && url.pathname === "/api/v2/schedules/catalog" && request.method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            products: [
              {
                code: "PRODUCT",
                name: "Brand Flavor",
                productionSetups: [{ code: "SETUP", name: "Test Setup" }],
              },
              {
                code: "PRODUCT-ALT",
                name: "Brand Flavor",
                productionSetups: [{ code: "SETUP-ALT", name: "Alternate Test Setup" }],
              },
            ],
            templates: [
              {
                code: "TEMPLATE",
                name: "Test Template",
                brand: "Brand",
                flavor: "Flavor",
                values: { pizzasPerCase: 12, crustsPerCycle: 4, cycleSpeed: 2, freezerTime: 0 },
              },
              {
                code: "TEMPLATE-ALT",
                name: "Alternate Test Template",
                brand: "Brand",
                flavor: "Flavor",
                values: { pizzasPerCase: 12, crustsPerCycle: 4, cycleSpeed: 2, freezerTime: 0 },
              },
            ],
            productionStartTime: "06:00",
            timeZone: "America/Chicago",
          }),
        });
        return;
      }
      if (manager && url.pathname === "/api/v2/schedules" && request.method() === "GET") {
        const date = url.searchParams.get("date") || "2026-11-20";
        if (!fixture.schedule || fixture.schedule.date !== date) fixture.schedule = emptySchedule(date);
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ schedule: fixture.schedule }) });
        return;
      }
      if (manager && url.pathname === "/api/v2/schedules/import-preview" && request.method() === "POST") {
        const body = request.postDataJSON();
        if (!body.fileName || !body.workbookBase64) {
          await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "Workbook fields are required." }) });
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            preview: {
              multiDay: false,
              fileName: body.fileName,
              rows: [{
                rowNumber: 2,
                sheet: "Plan",
                date: null,
                brand: "Brand",
                flavor: "Flavor",
                targetCases: 12,
                notes: "PO 123",
                sourceCells: { brand: "A2", flavor: "B2", targetCases: "C2" },
                sourceRow: 2,
                importRunId: "75000000-0000-4000-8000-000000000001",
              }],
              errors: [{ rowNumber: 3, sheet: "Plan", message: "Brand is missing." }],
              skipped: [{ rowNumber: 4, sheet: "Plan", reason: "Numeric subtotal or running total." }],
            },
          }),
        });
        return;
      }
      if (manager && url.pathname === "/api/v2/schedules/commands" && request.method() === "POST") {
        if (request.headers()["x-csrf-token"] !== CSRF_TOKEN) {
          await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "Invalid CSRF test token." }) });
          return;
        }
        const body = request.postDataJSON();
        if (!fixture.schedule || fixture.schedule.date !== body.date) fixture.schedule = emptySchedule(body.date);
        const replay = fixture.scheduleReceipts.get(body.requestId);
        if (replay) {
          await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...replay, replayed: true }) });
          return;
        }
        if (fixture.forceScheduleConflictOnce) {
          fixture.forceScheduleConflictOnce = false;
          fixture.expectedConflictConsoleErrors += 1;
          fixture.schedule = {
            ...applyScheduleCommand(fixture.schedule, {
              type: "add",
              run: {
                id: "75000000-0000-4000-8000-000000000002",
                productCode: "PRODUCT",
                productionSetupCode: "SETUP",
                runTemplateCode: "TEMPLATE",
                targetCases: 6,
                notes: "",
              },
            }),
            revision: fixture.schedule.revision + 1,
            updatedAt: new Date().toISOString(),
          };
          await route.fulfill({
            status: 409,
            contentType: "application/json",
            body: JSON.stringify({ outcome: "conflict", replayed: false, schedule: fixture.schedule }),
          });
          return;
        }
        if (body.expectedRevision !== fixture.schedule.revision) {
          await route.fulfill({
            status: 409,
            contentType: "application/json",
            body: JSON.stringify({ outcome: "conflict", replayed: false, schedule: fixture.schedule }),
          });
          return;
        }
        fixture.schedule = {
          ...applyScheduleCommand(fixture.schedule, body.command),
          revision: fixture.schedule.revision + 1,
          updatedAt: new Date().toISOString(),
        };
        const accepted = { outcome: "accepted", replayed: false, schedule: fixture.schedule };
        fixture.scheduleReceipts.set(body.requestId, accepted);
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(accepted) });
        return;
      }
      if (manager && url.pathname === "/api/v2/imports" && request.method() === "GET") {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ imports: fixture.imports }) });
        return;
      }
      if (manager && url.pathname === "/api/v2/setup-catalog/imports" && request.method() === "GET") {
        await route.fulfill({
          status: 200, contentType: "application/json",
          body: JSON.stringify({ imports: fixture.setupCatalogImports }),
        });
        return;
      }
      if (manager && url.pathname === "/api/v2/setup-catalog/imports/workbooks/preview" && request.method() === "POST") {
        if (request.headers()["x-csrf-token"] !== CSRF_TOKEN) {
          await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "Invalid CSRF test token." }) });
          return;
        }
        const body = request.postDataJSON();
        const parsed = parseSourceWorkbook(
          body.family,
          Buffer.from(body.workbookBase64, "base64"),
          body.fileName,
        );
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(parsed) });
        return;
      }
      if (manager && url.pathname === "/api/v2/setup-catalog/imports" && request.method() === "POST") {
        if (request.headers()["x-csrf-token"] !== CSRF_TOKEN) {
          await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "Invalid CSRF test token." }) });
          return;
        }
        const body = request.postDataJSON();
        const records = parseSetupCatalogCsv(body.family, body.csv);
        const importId = "74000000-0000-4000-8000-000000000099";
        const item = {
          id: importId, family: body.family, status: "staged", rowCount: records.length,
          records, sourceSummary: body.sourceSummary ?? null, createdAt: new Date().toISOString(),
        };
        fixture.setupCatalogImports = [item, ...fixture.setupCatalogImports.filter((entry) => entry.id !== importId)];
        await route.fulfill({
          status: 201, contentType: "application/json",
          body: JSON.stringify({
            outcome: "staged", importId, family: body.family, rowCount: records.length,
            replayed: false, records, sourceSummary: body.sourceSummary ?? null,
          }),
        });
        return;
      }
      const catalogDetail = url.pathname.match(/^\/api\/v2\/setup-catalog\/imports\/([0-9a-f-]{36})$/i);
      if (manager && catalogDetail && request.method() === "GET") {
        const item = fixture.setupCatalogImports.find((entry) => entry.id === catalogDetail[1]);
        await route.fulfill(item
          ? { status: 200, contentType: "application/json", body: JSON.stringify(item) }
          : { status: 404, contentType: "application/json", body: JSON.stringify({ error: "Import not found." }) });
        return;
      }
      const catalogAction = url.pathname.match(/^\/api\/v2\/setup-catalog\/imports\/([0-9a-f-]{36})\/(apply|undo)$/i);
      if (manager && catalogAction && request.method() === "POST") {
        if (request.headers()["x-csrf-token"] !== CSRF_TOKEN) {
          await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "Invalid CSRF test token." }) });
          return;
        }
        const item = fixture.setupCatalogImports.find((entry) => entry.id === catalogAction[1]);
        if (!item) {
          await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "Import not found." }) });
          return;
        }
        const replayed = catalogAction[2] === "apply" && item.status === "applied";
        if (catalogAction[2] === "apply") fixture.setupCatalogApplyCalls += 1;
        item.status = catalogAction[2] === "apply" ? "applied" : "undone";
        item.createdCount = 1;
        item.updatedCount = 0;
        if (catalogAction[2] === "apply" && fixture.loseNextApplyResponse) {
          fixture.loseNextApplyResponse = false;
          await route.fulfill({ status: 503, contentType: "text/plain", body: "Apply response was lost after commit." });
          return;
        }
        await route.fulfill({
          status: 200, contentType: "application/json",
          body: JSON.stringify({
            outcome: item.status, importId: item.id, family: item.family, replayed,
            createdCount: item.createdCount, updatedCount: item.updatedCount,
            ...(item.sourceSummary ? { sourceSummary: item.sourceSummary } : {}),
          }),
        });
        return;
      }
      if (manager && url.pathname === "/api/v2/inventory/warehouses" && request.method() === "GET") {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ warehouses: [] }) });
        return;
      }
      if (manager && url.pathname === "/api/v2/imports" && request.method() === "GET") {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ imports: [] }) });
        return;
      }
      if (manager && url.pathname === "/api/v2/inventory/die-defaults" && request.method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ defaults: [], history: [] }),
        });
        return;
      }
      if (manager && url.pathname === "/api/v2/inventory/products" && request.method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ products: [
            { code: "DOUGH-A", name: "North Shop", unit: "case" },
            { code: "DOUGH-B", name: "South Shop", unit: "case" },
          ] }),
        });
        return;
      }
      if (manager && url.pathname === "/api/v2/inventory/opening-counts" && request.method() === "GET") {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ counts: [] }) });
        return;
      }
      if (manager && url.pathname === "/api/v2/inventory/preparation-setup" && request.method() === "GET") {
        await route.fulfill({
          status: 200, contentType: "application/json",
          body: JSON.stringify({ ingredients: [], mixes: [] }),
        });
        return;
      }
      if (manager && url.pathname === "/api/v2/inventory/preparations" && request.method() === "GET") {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ preparations: [] }) });
        return;
      }
      if (manager && url.pathname === "/api/v2/inventory/cycle-counts" && request.method() === "GET") {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ counts: [] }) });
        return;
      }
      if (url.pathname === "/api/v2/runs" && request.method() === "GET") {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ runs: [snapshot(fixture)] }) });
        return;
      }
      const operationalStatusMatch = url.pathname.match(
        /^\/api\/v2\/qc\/runs\/([0-9a-f-]{36})\/operational-status$/i,
      );
      if (operationalStatusMatch && request.method() === "GET") {
        fixture.operationalStatusCalls += 1;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ...fixture.operationalStatus, runId: operationalStatusMatch[1] }),
        });
        return;
      }
      if (withQc && /^\/api\/v2\/qc\/runs\/[0-9a-f-]{36}$/i.test(url.pathname)
        && request.method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            run: snapshot(fixture),
            items: [],
            events: [],
            settings: [],
            substitutions: [],
            components: [],
            componentProducts: [],
            review: { status: "needs-review", signedOffAt: null, signedOffBy: null },
            allergenFootprint: fixture.operationalStatus.allergenFootprint,
            limitations: { allergens: "incomplete", components: "available", reason: null },
          }),
        });
        return;
      }
      if (withQc && url.pathname === "/api/v2/qc/history" && request.method() === "GET") {
        await route.fulfill({
          status: 200, contentType: "application/json", body: JSON.stringify({ events: [] }),
        });
        return;
      }
      if (url.pathname === "/api/v2/runs/products" && request.method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            productionWarehouse: { id: "74000000-0000-4000-8000-000000000010", name: "Main Warehouse" },
            dieTypes: [],
            products: [{
              code: "DOUGH-A",
              name: "Dough Product",
              doughCapacity: fixture.run.doughCapacity,
              productionSetups: [{ code: "LINE-A", name: "Main Line", hasDoughRecipe: true }],
            }],
          }),
        });
        return;
      }
      if (manager && url.pathname === "/api/v2/imports/workbooks/preview" && request.method() === "POST") {
        if (request.headers()["x-csrf-token"] !== CSRF_TOKEN) {
          await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "Invalid CSRF test token." }) });
          return;
        }
        const body = request.postDataJSON();
        const workbookBuffer = Buffer.from(body.workbookBase64, "base64");
        const parsed = body.family === "dough-procedure"
          ? parseDoughCapacityWorkbook(workbookBuffer, body.fileName)
          : parseShippingCapacityWorkbook(workbookBuffer, body.fileName);
        const products = [
          { code: "DOUGH-A", name: "North Shop" },
          { code: "DOUGH-B", name: "South Shop" },
        ];
        const priorLinks = [...fixture.workbookLinks.entries()]
          .filter(([identity]) => identity.startsWith(`${body.family}:`))
          .map(([identity, productCode]) => ({ sourceKey: identity.slice(body.family.length + 1), productCode }));
        const rows = linkWorkbookCapacityRows(parsed.rows, products, priorLinks);
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            sourceFamily: body.family,
            fileName: parsed.fileName,
            fileSha256: parsed.fileSha256,
            rows: rows.map((row) => ({
              sourceKey: row.sourceKey,
              name: row.name,
              row: row.source.row,
              reason: row.linkType,
              productCode: row.productCode,
            })),
            products,
            duplicateSources: analyzeWorkbookCapacityDuplicates(rows, products, priorLinks),
          }),
        });
        return;
      }
      if (manager && url.pathname === "/api/v2/imports/workbooks/links" && request.method() === "POST") {
        if (request.headers()["x-csrf-token"] !== CSRF_TOKEN) {
          await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "Invalid CSRF test token." }) });
          return;
        }
        const body = request.postDataJSON();
        const identity = `${body.family}:${body.sourceKey}`;
        if (fixture.rejectNextWorkbookLinkResponse) {
          fixture.rejectNextWorkbookLinkResponse = false;
          fixture.expectedWorkbookLinkConflictConsoleError = true;
          await route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "Saved link changed." }) });
          return;
        }
        const replay = fixture.workbookLinkReceipts.get(body.requestId);
        if (replay) {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ ...replay, replayed: true }),
          });
          return;
        }
        const previousProductCode = fixture.workbookLinks.get(identity);
        if (previousProductCode !== body.expectedProductCode) {
          await route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "Saved link changed." }) });
          return;
        }
        if (body.productCode === null) fixture.workbookLinks.set(identity, null);
        else fixture.workbookLinks.set(identity, body.productCode);
        const result = {
          outcome: body.productCode === null ? "cleared" : "corrected",
          sourceFamily: body.family,
          sourceKey: body.sourceKey,
          previousProductCode,
          productCode: body.productCode,
          replayed: false,
        };
        fixture.workbookLinkReceipts.set(body.requestId, result);
        if (fixture.failNextWorkbookLinkResponse) {
          fixture.failNextWorkbookLinkResponse = false;
          fixture.expectedWorkbookLinkConsoleError = true;
          await route.abort("connectionreset");
          return;
        }
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify(result),
        });
        return;
      }
      if (manager && url.pathname === "/api/v2/imports/workbooks" && request.method() === "POST") {
        if (request.headers()["x-csrf-token"] !== CSRF_TOKEN) {
          await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "Invalid CSRF test token." }) });
          return;
        }
        const body = request.postDataJSON();
        const workbookBuffer = Buffer.from(body.workbookBase64, "base64");
        const parsed = body.family === "dough-procedure"
          ? parseDoughCapacityWorkbook(workbookBuffer, body.fileName)
          : parseShippingCapacityWorkbook(workbookBuffer, body.fileName);
        const products = [
          { code: "DOUGH-A", name: "North Shop" },
          { code: "DOUGH-B", name: "South Shop" },
        ];
        const priorLinks = [...fixture.workbookLinks.entries()]
          .filter(([identity]) => identity.startsWith(`${body.family}:`))
          .map(([identity, productCode]) => ({ sourceKey: identity.slice(body.family.length + 1), productCode }));
        const rows = linkWorkbookCapacityRows(
          parsed.rows,
          products,
          priorLinks,
          body.productLinks || [],
        );
        const records = rows.filter((row) => row.productCode).map((row) => ({
          code: `${body.family === "dough-procedure" ? "DOUGH" : "SHIP"}-${row.sourceKey}`,
          name: row.name,
          productCode: row.productCode,
          data: body.family === "dough-procedure"
            ? {
              sourceFamily: body.family,
              sourceKey: row.sourceKey,
              fileName: parsed.fileName,
              fileSha256: parsed.fileSha256,
              source: row.source,
              doughballYield: row.doughballYield,
              doughballWeightOz: row.doughballWeightOz,
              doughballsPerTray: row.doughballsPerTray,
            }
            : {
              sourceFamily: body.family,
              sourceKey: row.sourceKey,
              fileName: parsed.fileName,
              fileSha256: parsed.fileSha256,
              source: row.source,
              pizzasPerCase: row.pizzasPerCase,
            },
        }));
        const importId = "74000000-0000-4000-8000-000000000001";
        const kind = body.family === "dough-procedure" ? "recipes" : "production-setups";
        const history = {
          id: importId,
          kind,
          status: "staged",
          records,
          rowCount: records.length,
          createdBy: STAFF_ID,
          appliedBy: null,
          undoneBy: null,
          createdAt: new Date().toISOString(),
        };
        fixture.imports = [history, ...fixture.imports];
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({
            outcome: "staged",
            importId,
            kind,
            rowCount: records.length,
            replayed: false,
            records,
            sourceFamily: body.family,
            fileName: parsed.fileName,
            fileSha256: parsed.fileSha256,
            linkedCount: records.length,
            rememberedCount: 0,
            managerMappedCount: rows.filter((row) => row.linkType === "manager").length,
            unmatchedRows: rows.filter((row) => !row.productCode).map((row) => ({
              sourceKey: row.sourceKey, name: row.name, row: row.source.row, reason: row.linkType,
            })),
            unmatchedCount: rows.filter((row) => !row.productCode).length,
            invalidValueCount: records.filter((record) => body.family === "dough-procedure"
              ? record.data.doughballYield === null
              : record.data.pizzasPerCase === null).length,
            duplicateSources: analyzeWorkbookCapacityDuplicates(rows, products, priorLinks, body.productLinks || []),
          }),
        });
        return;
      }
      const applyImport = url.pathname.match(/^\/api\/v2\/imports\/([0-9a-f-]{36})\/apply$/i);
      if (manager && applyImport && request.method() === "POST") {
        if (request.headers()["x-csrf-token"] !== CSRF_TOKEN) {
          await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "Invalid CSRF test token." }) });
          return;
        }
        const item = fixture.imports.find((entry) => entry.id === applyImport[1]);
        if (!item) {
          await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "Import not found." }) });
          return;
        }
        item.status = "applied";
        item.appliedBy = STAFF_ID;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ outcome: "applied", importId: item.id, kind: item.kind, replayed: false }),
        });
        return;
      }
      const undoImport = url.pathname.match(/^\/api\/v2\/imports\/([0-9a-f-]{36})\/undo$/i);
      if (manager && undoImport && request.method() === "POST") {
        if (request.headers()["x-csrf-token"] !== CSRF_TOKEN) {
          await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "Invalid CSRF test token." }) });
          return;
        }
        const item = fixture.imports.find((entry) => entry.id === undoImport[1]);
        if (!item || item.status !== "applied") {
          await route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "Import cannot be undone." }) });
          return;
        }
        item.status = "undone";
        item.undoneBy = STAFF_ID;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ outcome: "undone", importId: item.id, kind: item.kind, replayed: false }),
        });
        return;
      }
      const lifecycle = url.pathname.match(/^\/api\/v2\/runs\/([^/]+)\/commands$/);
      if (lifecycle && request.method() === "POST") {
        assert.equal(request.headers()["x-csrf-token"], CSRF_TOKEN);
        const body = JSON.parse(request.postData() || "{}");
        assert.deepEqual(Object.keys(body).sort(), ["commandId", "commandType", "expectedRevision"]);
        fixture.lifecycleCalls = (fixture.lifecycleCalls || 0) + 1;
        if (fixture.forceRuleBlock) {
          await route.fulfill({ status: 422, contentType: "application/json",
            body: JSON.stringify({ error: "Production rules block this action. Review the imported rules and required setup." }) });
          return;
        }
        fixture.run.status = "running";
        fixture.run.startedAt = new Date().toISOString();
        fixture.run.revision += 1;
        await route.fulfill({ status: 200, contentType: "application/json",
          body: JSON.stringify({ outcome: "accepted", replayed: false, commandId: body.commandId, run: snapshot(fixture) }) });
        return;
      }
      const match = url.pathname.match(/^\/api\/v2\/runs\/([^/]+)\/stations\/([^/]+)\/commands$/);
      if (match && request.method() === "POST") {
        if (request.headers()["x-csrf-token"] !== CSRF_TOKEN) {
          await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "Invalid CSRF test token." }) });
          return;
        }
        const body = JSON.parse(request.postData() || "{}");
        fixture.browserStationCommands.push(body.mode);
        const result = applyCommand(fixture, {
          ...body,
          runId: match[1],
          stationKey: decodeURIComponent(match[2]),
        });
        await route.fulfill({
          status: result.outcome === "conflict" ? 409 : 200,
          contentType: "application/json",
          body: JSON.stringify(result),
        });
        return;
      }
      fixture.notFoundRoutes.push(`${request.method()} ${url.pathname}`);
      await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "Not found." }) });
    };
    await context.route("**/api/v2/**", routeApi);
    const page = await context.newPage();
    page.on("pageerror", (error) => fixture.pageErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() !== "error" || message.text().includes("TLS support is not available")) return;
      if (fixture.expectedRuleBlockConsoleError && message.text().includes("422")) {
        fixture.expectedRuleBlockConsoleError = false;
        return;
      }
      if (message.text().includes("responded with a status of 409 (Conflict)")
        && fixture.expectedConflictConsoleErrors > 0) {
        fixture.expectedConflictConsoleErrors -= 1;
        return;
      }
      if (fixture.expectedLostApplyConsoleError && message.text().includes("503 (Service Unavailable)")) {
        fixture.expectedLostApplyConsoleError = false;
        return;
      }
      if (fixture.expectedWorkbookLinkConsoleError && message.text().includes("ERR_CONNECTION_RESET")) {
        fixture.expectedWorkbookLinkConsoleError = false;
        return;
      }
      if (fixture.expectedWorkbookLinkConflictConsoleError && message.text().includes("409 (Conflict)")) {
        fixture.expectedWorkbookLinkConflictConsoleError = false;
        return;
      }
      fixture.consoleErrors.push(`${message.text()} [${JSON.stringify(message.location())}]`);
    });
    await page.goto(baseUrl);
    try {
      await page.locator("#station-panel:not([hidden])").waitFor({ timeout: 5000 });
    } catch (error) {
      throw new Error(`${error.message}; page errors: ${JSON.stringify(fixture.pageErrors)}; console errors: ${JSON.stringify(fixture.consoleErrors)}`);
    }
    await page.getByTestId("tab-station-line").waitFor();
    return { context, page, routeApi };
  }

  return { baseUrl, browser, fixture, openDevice };
}

async function waitForState(predicate, timeoutMs = 7000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail("Timed out waiting for shared test state.");
}

test("More update check is accessible, distinguishes outcomes, and never reloads active work", async (t) => {
  const initScript = `
    (() => {
      let mode = "current";
      const listeners = new Map();
      const activeWorker = { state: "activated", addEventListener() {} };
      const registration = new EventTarget();
      registration.active = activeWorker;
      registration.waiting = null;
      registration.installing = null;
      registration.update = async () => {
        if (mode === "fail") throw new Error("synthetic update check failure");
        if (mode !== "available") return;
        const worker = new EventTarget();
        worker.state = "installing";
        registration.installing = worker;
        registration.dispatchEvent(new Event("updatefound"));
        queueMicrotask(() => {
          worker.state = "activated";
          registration.active = worker;
          registration.installing = null;
          worker.dispatchEvent(new Event("statechange"));
        });
      };
      const serviceWorker = {
        register: async () => registration,
        getRegistration: async () => mode === "unavailable" ? null : registration,
        addEventListener(type, callback) {
          listeners.set(type, callback);
        },
      };
      Object.defineProperty(Navigator.prototype, "serviceWorker", {
        configurable: true,
        value: serviceWorker,
      });
      window.setV2UpdateMode = (nextMode) => { mode = nextMode; };
    })();
  `;
  const { fixture, openDevice } = await createFixture(t, { width: 1280, height: 900 }, { manager: true });
  const { page } = await openDevice(undefined, { initScript });
  await page.locator("#authenticated-app:not([hidden])").waitFor();
  await page.getByTestId("status-run").getByText("running").waitFor();
  await page.emulateMedia({ reducedMotion: "reduce" });

  const topbarMenu = page.locator("#more-menu");
  await page.getByText("More", { exact: true }).click();
  await page.getByRole("button", { name: "Check for updates" }).click();
  const dialog = page.getByRole("dialog", { name: "App updates" });
  await dialog.waitFor();
  await dialog.getByRole("status").getByText("No new app version is available.").waitFor();
  const reloadButton = dialog.getByRole("button", { name: "Reload page" });
  assert.equal(await reloadButton.isDisabled(), true, "an active run must never be reloaded for a non-critical update");
  assert.match(await dialog.getByRole("status").textContent(), /Finish the run/u);

  await dialog.locator("#update-check-again").focus();
  await page.keyboard.press("Shift+Tab");
  assert.equal(await dialog.locator("#update-close").evaluate((element) => element === document.activeElement),
    true, "Shift+Tab wraps from the first dialog control to the last");
  await page.keyboard.press("Tab");
  assert.equal(await dialog.locator("#update-check-again").evaluate((element) => element === document.activeElement),
    true, "Tab wraps inside the open modal");
  const reducedTransition = await dialog.locator("#update-check-again").evaluate((element) =>
    Number.parseFloat(getComputedStyle(element).transitionDuration));
  assert.ok(reducedTransition <= 0.001, `reduced motion transition must be near-zero, got ${reducedTransition}`);
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector("#update-dialog").open);
  await page.waitForFunction(() => document.activeElement === document.querySelector("#more-menu summary"));
  assert.equal(await page.locator("#more-menu summary").evaluate((element) => element === document.activeElement),
    true, "closing the dialog returns focus to the More menu control");
  assert.equal(await topbarMenu.getAttribute("open"), null);

  await page.evaluate(() => window.setV2UpdateMode("available"));
  await page.locator("#more-menu summary").click();
  await page.locator("#check-updates-button").click();
  await page.getByRole("status").getByText("An app update is ready.").waitFor();
  assert.equal(await page.locator("#update-reload").isDisabled(), true);
  assert.equal(fixture.run.status, "running");

  await page.evaluate(() => window.setV2UpdateMode("fail"));
  await page.locator("#update-check-again").click();
  await page.getByRole("status").getByText("The update check failed.").waitFor();
  assert.equal(await page.getByRole("status").getByText("An app update is ready.").count(), 0,
    "a failed check must not be reported as an available update");
  assert.equal(await page.locator("#update-reload").isDisabled(), true);

  await page.evaluate(() => window.setV2UpdateMode("unavailable"));
  await page.locator("#update-check-again").click();
  await page.getByRole("status").getByText("The app update service is not ready.").waitFor();
  assert.equal(await page.locator("#update-reload").isDisabled(), true);

  await page.keyboard.press("Escape");
  fixture.run.status = "completed";
  fixture.run.completedAt = new Date().toISOString();
  await page.reload();
  await page.getByTestId("status-run").getByText("completed").waitFor();
  await page.evaluate(() => window.setV2UpdateMode("available"));
  await page.locator("#more-menu summary").click();
  await page.locator("#check-updates-button").click();
  await page.getByRole("status").getByText("An app update is ready.").waitFor();
  assert.equal(await page.getByRole("button", { name: "Reload to update" }).isEnabled(), true,
    "a ready update can be applied when there is no active run or pending edit");

  await page.keyboard.press("Escape");
  await page.locator("#setup-label").fill("Unsaved update-safety draft");
  await page.locator("#more-menu summary").click();
  await page.locator("#check-updates-button").click();
  await page.getByRole("status").getByText("An app update is ready.").waitFor();
  assert.equal(await page.getByRole("button", { name: "Reload to update" }).isDisabled(), true,
    "unsaved form edits block an update reload");
  assert.match(await page.locator("#update-status").textContent(), /unsaved edits/u);
  assert.deepEqual(fixture.pageErrors, []);
  assert.deepEqual(fixture.consoleErrors, []);
});

for (const browserEngine of [chromium, webkit]) {
test(`run substitution and allergen status stays run-bound and readable in ${browserEngine.name()}`,
  { skip: browserEngine === webkit && !webkitInstalled ? "Playwright WebKit is not installed on this host." : false },
  async (t) => {
    const state = await createFixture(t, { width: 1440, height: 900 }, { manager: true, browserEngine });
    const replacement = {
      id: "76000000-0000-4000-8000-000000000001",
      revision: 2,
      sourceItems: [{
        productId: "76000000-0000-4000-8000-000000000002",
        productCode: "CHEDDAR",
        productName: "Cheddar",
        recipeCode: "CHEESE-BASE",
        recipeName: "Cheese recipe",
        stationKey: "cheese",
        quantity: "12.5",
        unit: "lb",
      }],
      replacementProductId: "76000000-0000-4000-8000-000000000003",
      replacementProductCode: "ALT-MOZZ",
      replacementProductName: "Alternate mozzarella",
      replacementQuantity: "10",
      replacementUnit: "lb",
      movementGroupId: "76000000-0000-4000-8000-000000000004",
      occurredAt: "2026-11-19T10:00:00.000Z",
    };
    const uncertain = {
      status: "unknown",
      allergens: ["milk"],
      ingredientCount: 2,
      unknownIngredients: [{
        productId: null,
        productCode: null,
        productName: "Approved substitution",
        stationKey: "run",
        reason: "substitution-remaining-quantity-not-final",
      }],
    };
    state.fixture.operationalStatus = operationalStatus(RUN_ID);
    state.fixture.operationalStatus = {
      ...state.fixture.operationalStatus,
      substitutions: [replacement],
      allergenFootprint: uncertain,
      stations: {
        ...state.fixture.operationalStatus.stations,
        cheese: { substitutions: [replacement], allergenFootprint: uncertain },
      },
    };
    const operator = await state.openDevice({ width: 1440, height: 900 }, { canApprove: false });
    const { page } = operator;
    const evidence = page.getByTestId("run-operational-evidence");
    await evidence.getByText(/Cheddar \(CHEDDAR\): 12\.5 lb → Alternate mozzarella \(ALT-MOZZ\): 10 lb/u).waitFor();
    await evidence.getByText(/Known tracked allergens: milk\. Other ingredient facts are unknown/u).waitFor();
    await evidence.getByText(/not safety clearance or label approval/u).waitFor();
    assert.equal(await evidence.getByText(/Inventory movement 76000000-0000-4000-8000-000000000004/u).count(), 1);
    assert.equal(await page.getByRole("link", { name: "Open the QC substitution record" }).count(), 0);
    await page.getByTestId("tab-station-cheese").click();
    const stationEvidence = page.getByTestId("station-operational-evidence");
    await stationEvidence.waitFor({ state: "visible" });
    assert.match(await stationEvidence.innerText(), /1 approved substitution affects this station/u);
    assert.match(await stationEvidence.innerText(), /Cheddar \(CHEDDAR\): 12\.5 lb → Alternate mozzarella/u);
    assert.match(await page.getByTestId("tab-station-cheese").getAttribute("aria-label"), /1 substitution; allergen facts unknown/u);

    const authorized = await state.openDevice({ width: 1280, height: 800 }, { canApprove: false, withQc: true });
    const qcLink = authorized.page.getByRole("link", { name: "Open the QC substitution record" });
    await qcLink.waitFor();
    await qcLink.click();
    assert.equal(new URL(authorized.page.url()).hash, "#qc-panel");
    await authorized.page.locator("#qc-panel:not([hidden])").waitFor();

    const secondSession = await state.openDevice({ width: 390, height: 844 }, { canApprove: false });
    await secondSession.page.getByTestId("run-operational-evidence")
      .getByText(/Alternate mozzarella \(ALT-MOZZ\)/u).waitFor();
    await secondSession.context.setOffline(true);
    await secondSession.page.getByText(/Run substitution and allergen status unavailable: Run status is unavailable while offline/u).waitFor();
    assert.equal(await secondSession.page.getByTestId("run-operational-evidence").getByText(/ALT-MOZZ/u).count(), 0);
    state.fixture.operationalStatus = {
      ...operationalStatus(RUN_ID),
      allergenFootprint: {
        status: "complete",
        allergens: [],
        ingredientCount: 1,
        unknownIngredients: [],
      },
      stations: Object.fromEntries(["dough", "cheese", "pepperoni", "sauce", "frontline"].map((key) => [
        key,
        {
          substitutions: [],
          allergenFootprint: {
            status: "complete",
            allergens: [],
            ingredientCount: key === "cheese" ? 1 : 0,
            unknownIngredients: [],
          },
        },
      ])),
    };
    await evidence.getByText(/No current approved substitutions recorded/u).waitFor({ timeout: 9000 });
    await evidence.getByText(/Reviewed ingredient records list none of the tracked allergens/u).waitFor();
    assert.equal(await evidence.getByText(/ALT-MOZZ/u).count(), 0, "a prior session’s substitution disappears after refresh");
    await secondSession.context.setOffline(false);
    await secondSession.page.getByTestId("run-operational-evidence")
      .getByText(/No current approved substitutions recorded/u).waitFor();
    await secondSession.page.reload();
    const reloadedEvidence = secondSession.page.getByTestId("run-operational-evidence");
    await reloadedEvidence.getByText(/No current approved substitutions recorded/u).waitFor();
    await secondSession.page.getByTestId("tab-station-cheese").click();
    await secondSession.page.getByTestId("station-operational-evidence")
      .getByText(/No current approved substitutions affect this station/u).waitFor();
    assert.match(await secondSession.page.getByTestId("tab-station-cheese").getAttribute("aria-label"), /No substitution; allergen facts reviewed/u);
    for (const size of [
      { width: 390, height: 844 },
      { width: 768, height: 1024 },
      { width: 1024, height: 768 },
    ]) {
      await secondSession.page.setViewportSize(size);
      await reloadedEvidence.waitFor({ state: "visible" });
      await secondSession.page.getByTestId("station-operational-evidence").waitFor();
    }
    assert.ok(state.fixture.operationalStatusCalls >= 3);
    assert.deepEqual(state.fixture.pageErrors, []);
    assert.deepEqual(state.fixture.notFoundRoutes, []);
    assert.deepEqual(state.fixture.consoleErrors, []);
  });

test(`operators can review the read-only Mix Plan across roles, reload, and responsive widths in ${browserEngine.name()}`,
  { skip: browserEngine === webkit && !webkitInstalled ? "Playwright WebKit is not installed on this host." : false },
  async (t) => {
    const browserState = await createFixture(t, { width: 1440, height: 900 }, {
      manager: true, browserEngine,
    });
    const managerDevice = await browserState.openDevice();
    const { page, context } = managerDevice;
    await page.getByRole("link", { name: "Mix Plan", exact: true }).click();
    await page.locator("#mix-plan:not([hidden])").waitFor();
    await page.getByRole("heading", { name: "Synthetic Prep Mix" }).waitFor();
    await page.getByText("Synthetic Flour has no complete inventory product and stock-unit conversion.").waitFor();
    await page.getByText("Scheduled Test Run", { exact: true }).waitFor();
    assert.equal(await page.locator("#mix-plan-recipes-link").isVisible(), true);
    assert.equal(await page.locator("#mix-plan-inventory-link").isVisible(), true);
    assert.equal(await page.locator("#mix-plan form").count(), 0, "the plan surface has no recipe or stock editing form");
    assert.ok(browserState.fixture.mixPlanCalls.length >= 1);
    if (browserEngine === chromium) {
      await page.screenshot({
        path: join(tmpdir(), `v2-mix-plan-${browserEngine.name()}-desktop.png`),
        caret: "initial",
      });
    }

    const mixPlanCallsBeforeScheduleEdit = browserState.fixture.mixPlanCalls.length;
    await page.locator("#schedule-nav-link").click();
    await page.locator("#schedule-tools:not([hidden])").waitFor();
    await page.getByText(/Server schedule loaded/u).waitFor();
    await page.locator("#schedule-add").click();
    const plannedRun = page.locator('.schedule-run[data-is-new="true"]');
    await plannedRun.locator('[data-field="productCode"]').selectOption("PRODUCT");
    await plannedRun.locator('[data-field="productionSetupCode"]').selectOption("SETUP");
    await plannedRun.locator('[data-field="runTemplateCode"]').selectOption("TEMPLATE");
    await plannedRun.locator('[data-field="targetCases"]').fill("3");
    await plannedRun.getByRole("button", { name: "Add to plan" }).click();
    await page.getByText("Schedule change saved to the server.").waitFor();
    await waitForState(() => browserState.fixture.mixPlanCalls.length > mixPlanCallsBeforeScheduleEdit);
    await page.getByRole("link", { name: "Mix Plan", exact: true }).click();

    browserState.fixture.mixPlanRevision = 1;
    await page.locator("#mix-plan-refresh").click();
    await page.getByText("5 each", { exact: true }).waitFor();
    await page.reload();
    await page.locator("#mix-plan:not([hidden])").waitFor();
    await page.getByText("5 each", { exact: true }).waitFor();
    assert.ok(browserState.fixture.mixPlanCalls.length >= 3, "reload requests a fresh canonical plan");

    for (const viewport of [
      { width: 390, height: 844 },
      { width: 768, height: 1024 },
      { width: 1024, height: 768 },
    ]) {
      await page.setViewportSize(viewport);
      const bounds = await page.locator("#mix-plan").evaluate((element) => ({
        width: element.clientWidth,
        scrollWidth: element.scrollWidth,
      }));
      assert.ok(bounds.scrollWidth <= bounds.width, `Mix Plan does not overflow at ${viewport.width}×${viewport.height}`);
    }
    if (browserEngine === chromium) {
      await page.screenshot({
        path: join(tmpdir(), `v2-mix-plan-${browserEngine.name()}-phone.png`),
        caret: "initial",
      });
    }

    await context.setOffline(true);
    await page.getByText(/Offline · showing the last server-confirmed plan/u).waitFor();
    assert.equal(await page.locator("#mix-plan-refresh").isDisabled(), true);
    assert.equal(await page.getByText("5 each", { exact: true }).count(), 1);
    const mixPlanCallsBeforeReconnect = browserState.fixture.mixPlanCalls.length;
    await context.setOffline(false);
    await page.getByText(/Server-confirmed/u).waitFor();
    await waitForState(() => browserState.fixture.mixPlanCalls.length > mixPlanCallsBeforeReconnect);

    await page.locator("#mix-plan-recipes-link").click();
    assert.equal(new URL(page.url()).hash, "#setup-catalog-panel");
    assert.equal(await page.locator("#setup-catalog-family").inputValue(), "mixes");

    const operatorDevice = await browserState.openDevice({ width: 390, height: 844 }, { canApprove: false });
    await operatorDevice.page.getByRole("link", { name: "Mix Plan", exact: true }).click();
    await operatorDevice.page.locator("#mix-plan:not([hidden])").waitFor();
    await operatorDevice.page.getByText("Synthetic Flour has no complete inventory product and stock-unit conversion.").waitFor();
    assert.equal(await operatorDevice.page.locator("#mix-plan-links").isVisible(), false);
    assert.equal(await operatorDevice.page.locator("#setup-nav-link").isVisible(), false);
    assert.equal(await operatorDevice.page.locator("#schedule-nav-link").isVisible(), false);
    assert.deepEqual(browserState.fixture.pageErrors, []);
    assert.deepEqual(browserState.fixture.notFoundRoutes, []);
    assert.deepEqual(browserState.fixture.consoleErrors, []);
  });
}

test("production rules warn, block definitively, and display an approved imported bypass", async (t) => {
  const { fixture, openDevice } = await createFixture(t);
  const finding = { code: "LIMIT", name: "Synthetic case limit", enforcement: "flexible",
    status: "violated", sourceImportId: "99000000-0000-4000-8000-000000000001" };
  fixture.run.productionRules = [finding];
  const { page } = await openDevice();
  await page.getByText(/Warning; review before production/).waitFor();
  fixture.run = newRun({ status: "planned", startedAt: null,
    productionRules: [{ ...finding, enforcement: "strict", status: "unknown" }] });
  await page.reload();
  await page.getByText(/Unknown means the required input is unavailable/).waitFor();
  fixture.forceRuleBlock = true;
  fixture.expectedRuleBlockConsoleError = true;
  await page.locator('[data-command="start"]').click();
  await page.getByText("Production rules require review", { exact: true }).waitFor();
  assert.equal(fixture.run.status, "planned");
  assert.equal(await page.getByTestId("button-retry-command").count(), 0);
  assert.equal(await page.locator('[data-command="start"]').isEnabled(), true);
  fixture.forceRuleBlock = false;
  fixture.run.productionRules = [{ ...finding, enforcement: "strict", status: "bypassed" }];
  await page.locator('[data-command="start"]').click();
  await page.locator('[data-command="pause"]').waitFor();
  await page.getByText(/Approved imported bypass matched/).waitFor();
  assert.equal(fixture.lifecycleCalls, 2);
  assert.deepEqual(fixture.pageErrors, []);
  assert.deepEqual(fixture.consoleErrors, []);
});

test("two live sessions preserve a manual edit when another device wins first", async (t) => {
  const { fixture, openDevice } = await createFixture(t);
  const deviceA = await openDevice();
  const deviceB = await openDevice();

  await deviceA.page.locator('[data-station-field="casesProduced"]').fill("5");
  await deviceA.page.getByTestId("button-save-station").click();
  await deviceA.page.getByText("Saved to the shared run.").waitFor();
  assert.equal(fixture.run.stationProgress.line.progress.casesProduced, 5);

  await deviceB.page.locator('[data-station-field="casesProduced"]').fill("7");
  await deviceB.page.getByTestId("button-save-station").click();
  await deviceB.page.getByText(/Another device changed the run/).waitFor();
  assert.equal(await deviceB.page.locator('[data-station-field="casesProduced"]').inputValue(), "7");
  await deviceB.page.screenshot({ path: join(tmpdir(), "v2-station-conflict-review.png") });

  await deviceB.page.getByTestId("button-save-station").click();
  await deviceB.page.getByText("Saved to the shared run.").waitFor();
  assert.equal(fixture.run.stationProgress.line.progress.casesProduced, 7);
  assert.equal(fixture.run.revision, 3);
  assert.deepEqual(fixture.pageErrors, []);
});

test("dough capacity is derived from the selected product and has no editable override", async (t) => {
  const { fixture, openDevice } = await createFixture(t);
  const { page } = await openDevice();

  await page.getByTestId("tab-station-dough").click();
  assert.match(await page.locator("#run-product").inputValue(), /DOUGH-A/u);
  assert.equal(await page.locator('[data-station-field="casesPerBatch"]').count(), 0);
  assert.equal(await page.getByText("Cases per dough batch").count(), 1);
  assert.equal(await page.getByText("53.7658 cases", { exact: true }).count(), 1);
  await page.locator('[data-station-field="traysPerBatch"]').fill("84");
  await page.getByTestId("button-save-station").click();
  await page.getByText("Saved to the shared run.").waitFor();
  assert.equal(fixture.run.stationProgress.dough.inputs.traysPerBatch, 84);

  await page.reload();
  await page.locator("#station-panel:not([hidden])").waitFor({ timeout: 5000 });
  await page.getByTestId("tab-station-dough").click();
  assert.equal(await page.locator('[data-station-field="casesPerBatch"]').count(), 0);
  assert.equal(await page.getByText("53.7658 cases", { exact: true }).count(), 1);
  assert.equal(await page.locator('[data-station-field="traysPerBatch"]').inputValue(), "84");
  assert.equal(fixture.run.doughCapacity.doughballYield, 645.19);

  fixture.run.doughCapacity = {
    status: "available",
    reasons: [],
    doughballYield: 648,
    pizzasPerCase: 12,
  };
  await page.reload();
  await page.locator("#station-panel:not([hidden])").waitFor({ timeout: 5000 });
  await page.getByTestId("tab-station-dough").click();
  assert.equal(await page.getByText("54.0000 cases", { exact: true }).count(), 1);
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    const help = page.locator(".station-help");
    assert.equal(await help.isVisible(), true);
    const bounds = await help.boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= viewport.width);
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth) <= viewport.width,
      `dough help fits ${viewport.width}×${viewport.height}`,
    );
    await page.screenshot({
      path: join(tmpdir(), `v2-dough-help-${viewport.width}.png`),
      fullPage: true,
    });
  }
  assert.deepEqual(fixture.pageErrors, []);
  assert.deepEqual(fixture.consoleErrors, []);
});

test("manager resolves an unmatched workbook row, reviews its link, and applies it", async (t) => {
  const browserState = await createFixture(t, { width: 1440, height: 900 }, { manager: true });
  const { page } = await browserState.openDevice();
  await page.locator("#manager-tools:not([hidden])").waitFor();
  await page.waitForFunction(() => !document.querySelector("#capacity-workbook-review")?.disabled);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["Customer", "OZ", "LBS", "YIELD", "PER TRAY"],
    ["North Shop", 7.7, 310.5, 645.19, 84],
    ["Nroth Shop", 7.8, 310.5, 646, 84],
  ]), "Procedure");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  const parsedWorkbook = parseDoughCapacityWorkbook(buffer, "north-shop-dough.xlsx");
  browserState.fixture.workbookLinks.set(
    `dough-procedure:${parsedWorkbook.rows[0].sourceKey}`,
    "DOUGH-A",
  );
  await page.locator("#capacity-workbook-file").setInputFiles({
    name: "north-shop-dough.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer,
  });
  await page.getByRole("button", { name: "Preview workbook links" }).click();
  await page.getByText("Previously confirmed link · DOUGH-A").waitFor();
  const savedLink = page.getByLabel("Change saved link for North Shop, workbook row 2");
  await savedLink.selectOption("DOUGH-B");
  browserState.fixture.rejectNextWorkbookLinkResponse = true;
  await page.getByRole("button", { name: "Save link change" }).click();
  await page.getByText(/server rejected this attempt/u).waitFor();
  assert.equal(browserState.fixture.workbookLinks.get(`dough-procedure:${parsedWorkbook.rows[0].sourceKey}`), "DOUGH-A");
  browserState.fixture.failNextWorkbookLinkResponse = true;
  await page.getByRole("button", { name: "Save link change" }).click();
  await page.getByRole("button", { name: "Retry saved request" }).waitFor();
  await page.getByRole("button", { name: "Retry saved request" }).click();
  await page.getByText("Previously confirmed link · DOUGH-B").waitFor();

  await page.getByLabel("Change saved link for North Shop, workbook row 2").selectOption("");
  await page.getByRole("button", { name: "Save link change" }).click();
  await page.getByText(/Saved source link was cleared/u).waitFor();
  await page.getByLabel("Choose a product for North Shop, workbook row 2").selectOption("DOUGH-A");
  await page.getByLabel("Choose a product for Nroth Shop, workbook row 3").selectOption("DOUGH-A");
  await page.getByRole("button", { name: "Stage reviewed workbook" }).click();
  await page.getByText(/Staged · dough-procedure/u).waitFor();
  await page.getByText(/2 rows staged/u).waitFor();
  await page.getByText(/2 manager-selected links included/u).waitFor();
  await page.getByText(/2 rows in this workbook/u).waitFor();
  await page.getByText(/Dough capacity will be unavailable/u).waitFor();
  await page.getByText("North Shop", { exact: true }).first().waitFor();
  await page.getByText(/Product: DOUGH-A/u).first().waitFor();
  await page.getByRole("button", { name: "Apply reviewed workbook" }).click();
  await page.locator("#capacity-workbook-actions").waitFor({ state: "hidden" });
  await page.getByText("recipes · applied", { exact: true }).waitFor();
  page.on("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Undo" }).click();
  await page.getByText("recipes · undone", { exact: true }).waitFor();

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
  ]) {
    await page.setViewportSize(viewport);
    const input = page.locator("#capacity-workbook-file");
    await input.scrollIntoViewIfNeeded();
    const bounds = await input.boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= viewport.width,
      `workbook upload control fits ${viewport.width}×${viewport.height}`);
  }
  assert.ok((await page.locator("body").evaluate(() => document.documentElement.scrollWidth)) <= 1024);
  assert.deepEqual(await page.locator("#capacity-workbook-preview").isVisible(), true);
  assert.deepEqual(browserState.fixture.pageErrors, []);
  assert.deepEqual(browserState.fixture.consoleErrors, []);
});

test("manager can correct and clear a saved shipping workbook link", async (t) => {
  const browserState = await createFixture(t, { width: 1440, height: 900 }, { manager: true });
  const { page } = await browserState.openDevice();
  await page.locator("#manager-tools:not([hidden])").waitFor();
  await page.waitForFunction(() => !document.querySelector("#capacity-workbook-review")?.disabled);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["Pizza", "Notes", "Pizzas/CS"],
    ["North Shop", "", 12],
  ]), "Shipping");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  const parsed = parseShippingCapacityWorkbook(buffer, "north-shop-shipping.xlsx");
  browserState.fixture.workbookLinks.set(`shipping-guide:${parsed.rows[0].sourceKey}`, "DOUGH-A");
  await page.locator("#capacity-workbook-family").selectOption("shipping-guide");
  await page.locator("#capacity-workbook-file").setInputFiles({
    name: "north-shop-shipping.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer,
  });
  await page.getByRole("button", { name: "Preview workbook links" }).click();
  await page.getByText("Previously confirmed link · DOUGH-A").waitFor();
  await page.getByLabel("Change saved link for North Shop, workbook row 2").selectOption("DOUGH-B");
  browserState.fixture.rejectNextWorkbookLinkResponse = true;
  await page.getByRole("button", { name: "Save link change" }).click();
  await page.getByText(/server rejected this attempt/u).waitFor();
  assert.equal(browserState.fixture.workbookLinks.get(`shipping-guide:${parsed.rows[0].sourceKey}`), "DOUGH-A");
  browserState.fixture.failNextWorkbookLinkResponse = true;
  await page.getByRole("button", { name: "Save link change" }).click();
  await page.getByRole("button", { name: "Retry saved request" }).waitFor();
  await page.getByRole("button", { name: "Retry saved request" }).click();
  await page.getByText("Previously confirmed link · DOUGH-B").waitFor();
  await page.getByLabel("Change saved link for North Shop, workbook row 2").selectOption("");
  await page.getByRole("button", { name: "Save link change" }).click();
  await page.getByText(/Saved source link was cleared/u).waitFor();
  assert.equal(await page.getByText("Exact name match · DOUGH-A").count(), 0);
  assert.deepEqual(browserState.fixture.pageErrors, []);
  assert.deepEqual(browserState.fixture.consoleErrors, []);
});

test("missing dough sources display unavailable instead of estimating batches", async (t) => {
  const { fixture, openDevice } = await createFixture(t);
  fixture.run.doughCapacity = {
    status: "unavailable",
    reasons: ["dough_source_missing", "shipping_source_missing"],
    doughballYield: null,
    pizzasPerCase: null,
  };
  const { page } = await openDevice();
  await page.getByTestId("tab-station-dough").click();
  await page.getByText(/Dough capacity unavailable/u).waitFor();
  assert.equal(await page.getByText("53.7658 cases", { exact: true }).count(), 0);
  assert.equal(await page.getByText("Batches needed").count(), 0);
  assert.match(await page.locator("#run-product").inputValue(), /DOUGH-A/u);
  assert.deepEqual(fixture.pageErrors, []);
  assert.deepEqual(fixture.consoleErrors, []);
});

test("offline reload stays read-only and wakes into the latest server state", async (t) => {
  const { fixture, openDevice } = await createFixture(t, { width: 390, height: 844 });
  const pausedAt = new Date().toISOString();
  fixture.run.status = "paused";
  fixture.run.pausedAt = pausedAt;
  fixture.run.pauseIntervals = [{ startedAt: pausedAt, endedAt: null }];
  fixture.run.stationProgress.line = stationSnapshot({ progress: { casesProduced: 12 } });
  const { context, page, routeApi } = await openDevice({ width: 390, height: 844 });
  const otherDevice = await openDevice({ width: 1280, height: 900 });
  await page.evaluate(() => navigator.serviceWorker.ready);
  assert.equal(await page.getByTestId("status-run").textContent(), "paused");
  assert.equal(await page.getByTestId("button-resume").isDisabled(), false);

  await context.unroute("**/api/v2/**", routeApi);
  await context.setOffline(true);
  await page.reload();
  await page.locator("#station-panel:not([hidden])").waitFor({ timeout: 7000 });
  assert.equal(await page.locator('[data-station-field="casesProduced"]').inputValue(), "12");
  assert.equal(await page.getByTestId("status-run").textContent(), "paused");
  assert.equal(await page.getByTestId("button-save-station").isDisabled(), true);
  assert.equal(await page.locator('[data-station-field="casesProduced"]').isDisabled(), true);
  await page.screenshot({ path: join(tmpdir(), "v2-station-offline-readonly.png") });

  await otherDevice.page.getByTestId("button-resume").click();
  await otherDevice.page.getByTestId("status-run").getByText("running").waitFor();
  await otherDevice.page.locator('[data-station-field="casesProduced"]').fill("20");
  await otherDevice.page.getByTestId("button-save-station").click();
  await otherDevice.page.getByText("Saved to the shared run.").waitFor();
  assert.equal(fixture.run.stationProgress.line.progress.casesProduced, 20);
  assert.equal(fixture.run.revision, 3, "the connected session owns the latest run revision");

  await context.route("**/api/v2/**", routeApi);
  await context.setOffline(false);
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.waitForFunction(() => (
    document.querySelector('[data-station-field="casesProduced"]')?.value === "20"
  ), null, { timeout: 7000 });
  assert.equal(await page.getByTestId("status-run").textContent(), "running");
  assert.equal(await page.getByTestId("button-pause").isDisabled(), false);
  assert.equal(await page.getByTestId("button-save-station").isDisabled(), false);
  assert.deepEqual(fixture.pageErrors, []);
});

test("server auto-tracking and station timers are shared across devices", async (t) => {
  const { fixture, openDevice } = await createFixture(t);
  const dueAt = new Date(Date.now() - 1000).toISOString();
  fixture.run.stationProgress.line = stationSnapshot({
    inputs: { autoTrackRatePerMinute: 60, timerDurationSeconds: 10 },
    progress: { casesProduced: 0 },
    nextDueAt: dueAt,
  });
  fixture.forceTimerStartConflict = true;
  t.after(startMockServerStationWorker(fixture));
  const deviceA = await openDevice();
  const deviceB = await openDevice({ width: 390, height: 844 });

  await waitForState(() => fixture.run.stationProgress.line.progress.casesProduced >= 1);
  await deviceB.page.waitForFunction(() => (
    Number(document.querySelector('[data-station-field="casesProduced"]')?.value) >= 1
  ), null, { timeout: 7000 });

  await deviceA.page.getByRole("button", { name: "Start timer" }).click();
  try {
    await waitForState(() => fixture.run.stationProgress.line.progress.timerStatus === "running", 5000);
  } catch {
    assert.fail(`timer command was not accepted: ${JSON.stringify({
      state: fixture.run.stationProgress.line,
      outcomes: fixture.stationCommandOutcomes,
    })}`);
  }
  await deviceA.page.getByText(/Timer running/).waitFor();
  await deviceB.page.getByText(/Timer running/).waitFor();
  const timerStartOutcomes = fixture.stationCommandOutcomes
    .filter(({ mode }) => mode === "timer_start")
    .map(({ outcome }) => outcome);
  assert.ok(timerStartOutcomes.length >= 2);
  assert.equal(timerStartOutcomes[0], "conflict");
  assert.equal(timerStartOutcomes.at(-1), "accepted");
  assert.ok(timerStartOutcomes.slice(1, -1).every((outcome) => outcome === "conflict"));
  await deviceB.page.getByRole("button", { name: "Pause timer" }).click();
  await deviceB.page.getByText(/Timer paused/).waitFor();
  await deviceA.page.getByText(/Timer paused/).waitFor();
  assert.equal(fixture.run.stationProgress.line.progress.timerStatus, "paused");
  assert.ok(Number(fixture.run.stationProgress.line.progress.timerElapsedMs) >= 0);
  assert.ok(!fixture.browserStationCommands.includes("auto_track"));
  assert.deepEqual(fixture.pageErrors, []);
});

test("manager downloads each CSV template with parser-valid synthetic examples", async (t) => {
  const fixture = await createFixture(t, undefined, { manager: true });
  const { page } = await fixture.openDevice();
  await page.locator("#manager-tools:not([hidden])").waitFor();
  await page.getByText("No setup imports recorded yet.").waitFor();
  for (const width of [390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.getByLabel("Production warehouse").count(), 1);
    assert.equal(await page.getByRole("button", { name: "Set production warehouse" }).getAttribute("type"), "button");
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1),
      `manager inventory layout should not overflow at ${width}px`,
    );
  }

  for (const [kind, template] of Object.entries(setupImportCsvTemplates)) {
    await page.locator("#import-kind").selectOption(kind);
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.locator("#csv-template-download").click(),
    ]);
    assert.equal(download.suggestedFilename(), template.fileName);
    const csv = await readFile(await download.path(), "utf8");
    assert.equal(csv, renderImportCsvTemplate(template));
    assert.equal(parseSetupImportCsv(kind, csv).length, template.rows.length);
  }

  const [countDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#opening-count-template-download").click(),
  ]);
  assert.equal(countDownload.suggestedFilename(), openingCountCsvTemplate.fileName);
  const countCsv = await readFile(await countDownload.path(), "utf8");
  assert.equal(countCsv, renderImportCsvTemplate(openingCountCsvTemplate));
  parseOpeningCountCsv(countCsv, setupImportCsvTemplates.products.rows.map(([code]) => code));

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
  ]) {
    await page.setViewportSize(viewport);
    const link = page.locator("#csv-template-download");
    await link.scrollIntoViewIfNeeded();
    const bounds = await link.boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= viewport.width,
      `template download link fits ${viewport.width}×${viewport.height}`);
  }
});

for (const browserEngine of [chromium, webkit]) {
test(`manager reviews, applies, and safely undoes a setup catalog across responsive widths in ${browserEngine.name()}`,
  { skip: browserEngine === webkit && !webkitInstalled ? "Playwright WebKit is not installed on this host." : false },
  async (t) => {
  const { fixture, openDevice } = await createFixture(t, undefined, { manager: true, browserEngine });
  const { page } = await openDevice();
  await page.locator("#setup-catalog-panel:not([hidden])").waitFor();
  await page.getByText("No additional setup imports recorded yet.").waitFor();

  for (const [family, template] of Object.entries(setupCatalogCsvTemplates)) {
    const csv = renderImportCsvTemplate(template);
    assert.equal(parseSetupCatalogCsv(family, csv).length, 1);
    await page.locator("#setup-catalog-family").selectOption(family);
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.locator("#setup-catalog-template-download").click(),
    ]);
    assert.equal(download.suggestedFilename(), template.fileName);
    assert.equal(await readFile(await download.path(), "utf8"), csv);
  }

  const ingredients = 'code,name,categories_json,allergens_json,allergens_reviewed,merged_into_code,enabled\n' +
    'BROWSER-ING,Fixture Flour,"[""dough""]","[]",true,,true\n';
  await page.locator("#setup-catalog-family").selectOption("ingredients");
  await page.locator("#setup-catalog-file").setInputFiles({
    name: "ingredients.csv", mimeType: "text/csv", buffer: Buffer.from(ingredients),
  });
  await page.getByRole("button", { name: "Validate and stage for review" }).click();
  await page.locator("#setup-catalog-status").getByText(/1 setup rows are staged/).waitFor();
  assert.equal(fixture.setupCatalogImports[0].status, "staged");
  assert.equal(await page.getByText("BROWSER-ING · Fixture Flour").count(), 1);
  await page.getByRole("button", { name: "Apply reviewed setup" }).click();
  await page.locator("#setup-catalog-status").getByText("1 setup rows created and 0 updated.").waitFor();
  assert.equal(fixture.setupCatalogImports[0].status, "applied");
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await page.getByText("Applied setup · imported values · 1 rows").waitFor();
  assert.equal(await page.getByText("BROWSER-ING · Fixture Flour").count(), 1);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Undo" }).click();
  await page.locator("#setup-catalog-status").getByText("Setup import undone. Later changes were preserved.").waitFor();
  assert.equal(fixture.setupCatalogImports[0].status, "undone");

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1),
      `setup catalog layout should not overflow at ${viewport.width}×${viewport.height}`,
    );
    const bounds = await page.locator("#setup-catalog-template-download").boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= viewport.width,
      `setup template download fits ${viewport.width}×${viewport.height}`);
  }
  assert.deepEqual(fixture.pageErrors, []);
  assert.deepEqual(fixture.consoleErrors, []);
});
}

test("manager plans dates, imports reviewed workbook rows, resolves conflicts, and reconnects read-only", async (t) => {
  const { fixture, openDevice } = await createFixture(t, undefined, { manager: true });
  const { context, page } = await openDevice();
  await page.locator("#schedule-tools:not([hidden])").waitFor();
  await page.getByText(/Server schedule loaded/u).waitFor();
  const productionDate = await page.locator("#schedule-date").inputValue();

  await page.locator("#schedule-add").click();
  const draft = page.locator('.schedule-run[data-is-new="true"]');
  await draft.locator('[data-field="productCode"]').selectOption("PRODUCT");
  await draft.locator('[data-field="productionSetupCode"]').selectOption("SETUP");
  await draft.locator('[data-field="runTemplateCode"]').selectOption("TEMPLATE");
  await draft.locator('[data-field="targetCases"]').fill("20");
  await draft.getByRole("button", { name: "Add to plan" }).click();
  await page.getByText("Schedule change saved to the server.").waitFor();
  await page.getByText("Confirmed revision 1").waitFor();
  assert.equal(fixture.schedule.runs.length, 1);

  const firstRunId = fixture.schedule.runs[0].id;
  const firstBreak = page.locator(".schedule-break-row").first();
  await firstBreak.locator('input[type="checkbox"]').check();
  await firstBreak.locator("select").selectOption(firstRunId);
  await page.locator("#schedule-break-save").click();
  await page.getByText("Confirmed revision 2").waitFor();
  assert.equal(fixture.schedule.breaks[0].runId, firstRunId);
  assert.match(await page.locator("#schedule-finish").textContent(), /Estimated planned finish/u);

  await page.locator("#schedule-add").click();
  const secondDraft = page.locator('.schedule-run[data-is-new="true"]');
  await secondDraft.locator('[data-field="productCode"]').selectOption("PRODUCT");
  await secondDraft.locator('[data-field="productionSetupCode"]').selectOption("SETUP");
  await secondDraft.locator('[data-field="runTemplateCode"]').selectOption("TEMPLATE");
  await secondDraft.locator('[data-field="targetCases"]').fill("8");
  await secondDraft.getByRole("button", { name: "Add to plan" }).click();
  await page.waitForFunction(() => (
    document.querySelector("#schedule-revision")?.textContent.includes("revision 3")
      || document.querySelector("#schedule-alert")?.textContent.length > 0
  ));
  assert.equal(await page.locator("#schedule-revision").textContent(), "Confirmed revision 3",
    await page.locator("#schedule-alert").textContent());
  const secondRunId = fixture.schedule.runs[1].id;
  await page.locator(`.schedule-run[data-run-id="${firstRunId}"]`).getByRole("button", { name: "Move planned run 1 down" }).click();
  await page.getByText("Confirmed revision 4").waitFor();
  assert.deepEqual(fixture.schedule.runs.map((run) => run.id), [secondRunId, firstRunId]);
  await page.locator("#schedule-swap-first").selectOption(firstRunId);
  await page.locator("#schedule-swap-second").selectOption(secondRunId);
  await page.locator("#schedule-swap-button").click();
  await page.getByText("Confirmed revision 5").waitFor();
  assert.deepEqual(fixture.schedule.runs.map((run) => run.id), [firstRunId, secondRunId]);
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator(`.schedule-run[data-run-id="${secondRunId}"]`).getByRole("button", { name: "Remove run" }).click();
  await page.getByText("Confirmed revision 6").waitFor();
  assert.deepEqual(fixture.schedule.runs.map((run) => run.id), [firstRunId]);
  assert.equal(fixture.schedule.breaks[0].runId, firstRunId);

  const otherDevice = await openDevice();
  await otherDevice.page.locator("#schedule-tools:not([hidden])").waitFor();
  await otherDevice.page.getByText("Confirmed revision 6").waitFor();
  assert.equal(await otherDevice.page.locator(".schedule-run").count(), 1);
  assert.equal(await otherDevice.page.locator("#schedule-date").inputValue(), productionDate);

  fixture.forceScheduleConflictOnce = true;
  const firstRun = page.locator(".schedule-run").first();
  await firstRun.locator('[data-field="targetCases"]').fill("25");
  await firstRun.getByRole("button", { name: "Save run" }).click();
  await page.getByText(/Another manager changed this date/u).waitFor();
  await page.getByText("Confirmed revision 7").waitFor();
  assert.equal(fixture.schedule.runs.length, 2);
  assert.equal(await page.locator(".schedule-run").count(), 2);
  assert.equal(await page.locator('.schedule-run[data-run-id="' + firstRunId + '"] [data-field="targetCases"]').inputValue(), "25");

  await page.locator('.schedule-run[data-run-id="' + firstRunId + '"]').getByRole("button", { name: "Save run" }).click();
  await page.getByText("Confirmed revision 8").waitFor();
  assert.equal(fixture.schedule.runs.length, 2);
  assert.equal(fixture.schedule.runs.find((run) => run.id === firstRunId).targetCases, 25);

  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ["Brand", "Flavor", "Cases Planned", "Notes"],
    ["Brand", "Flavor", 12, "PO 123"],
  ]), "Plan");
  const workbook = XLSX.write(book, { type: "buffer", bookType: "xlsx" });
  await page.locator("#schedule-import-file").setInputFiles({
    name: "daily-plan.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: workbook,
  });
  await page.getByRole("button", { name: "Review workbook", exact: true }).click();
  await page.getByText(/Workbook reviewed/u).waitFor();
  await page.getByText(/Brand is missing/u).waitFor();
  await page.getByText(/Numeric subtotal or running total/u).waitFor();
  assert.equal(fixture.schedule.revision, 8);
  const importRow = page.locator(".schedule-import-row");
  const importFeedback = importRow.locator(".schedule-import-row-status");
  assert.match(await importFeedback.textContent(), /multiple product matches/u);
  assert.match(await importFeedback.textContent(), /multiple template matches/u);
  await importRow.locator('[data-import-field="productCode"]').selectOption("PRODUCT");
  assert.doesNotMatch(await importFeedback.textContent(), /multiple product matches/u);
  assert.match(await importFeedback.textContent(), /multiple template matches/u);
  await importRow.locator('[data-import-field="productionSetupCode"]').selectOption("SETUP");
  await importRow.locator('[data-import-field="runTemplateCode"]').selectOption("TEMPLATE");
  assert.equal(await importFeedback.textContent(), "Ready to add to the selected production date.");
  await page.getByRole("button", { name: /Apply 1 reviewed run/u }).click();
  await page.getByText("Confirmed revision 9").waitFor();
  assert.equal(fixture.schedule.runs.length, 3);
  assert.equal(fixture.schedule.runs.some((run) => run.id === firstRunId && run.targetCases === 25), true);
  assert.equal(fixture.schedule.runs.some((run) => run.notes === "PO 123"), true);

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1),
      `schedule layout should not overflow at ${viewport.width}×${viewport.height}`,
    );
  }

  await context.setOffline(true);
  await page.getByText(/Offline read-only view/u).waitFor();
  assert.equal(await page.locator("#schedule-add").isDisabled(), true);
  assert.equal(await page.locator("#schedule-date").isDisabled(), false);
  assert.equal(fixture.schedule.revision, 9);
  await context.setOffline(false);
  await page.getByText(/Server schedule loaded/u).waitFor();
  await page.getByText("Confirmed revision 9").waitFor();
  assert.equal(fixture.schedule.runs.length, 3);
  assert.deepEqual(fixture.pageErrors, []);
  assert.deepEqual(fixture.consoleErrors, []);
  await otherDevice.context.close();
});

for (const browserEngine of [chromium, webkit]) {
  test(
    `manager previews, applies, and reopens a sauce import in ${browserEngine.name()}`,
    { skip: browserEngine === webkit && !webkitInstalled ? "Playwright WebKit is not installed on this host." : false },
    async (t) => {
      const { fixture, openDevice } = await createFixture(t, undefined, { manager: true, browserEngine });
      fixture.run.status = "completed";
      fixture.run.completedAt = new Date().toISOString();
      const { page } = await openDevice();
      await page.locator("#setup-catalog-panel:not([hidden])").waitFor();
      await page.locator("#source-workbook-family").selectOption("sauce-guides");
      await page.locator("#source-workbook-file").setInputFiles({
        name: "synthetic-sauce.xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        buffer: Buffer.from(XLSX.write((() => {
          const workbook = XLSX.utils.book_new();
          XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
            ["Acme uses House Red on Classic at 3.5oz"],
          ]), "Sauce");
          return workbook;
        })(), { type: "buffer", bookType: "xlsx" })),
      });
      await page.getByRole("button", { name: "Preview source rows" }).click();
      try {
        await page.getByText(/Sauce guide · 1 source rows · 1 proposed V2 records/u).waitFor({ timeout: 5000 });
      } catch {
        assert.fail(`Source preview did not load: ${JSON.stringify({
          status: await page.locator("#setup-catalog-status").innerText(),
          pageErrors: fixture.pageErrors,
          consoleErrors: fixture.consoleErrors,
        })}`);
      }
      if (browserEngine === chromium) {
        await page.evaluate(async () => navigator.serviceWorker.ready);
      }
      await page.locator("#more-menu summary").click();
      await page.locator("#check-updates-button").click();
      await page.waitForFunction(() => {
        const status = document.querySelector("#update-status")?.textContent || "";
        return status.includes("No new app version is available.")
          || status.includes("cannot check for app updates")
          || status.includes("app update service is not ready");
      });
      assert.equal(await page.locator("#update-reload").isDisabled(), true,
        "an unconfirmed workbook preview must block even a manual update reload");
      assert.match(await page.locator("#update-status").textContent(), /awaiting confirmation/u);
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("#source-workbook-preview").isVisible(), true);
      await page.getByText(/Sauce guide: Acme · Classic/u).click();
      await page.getByText("I reviewed and confirmed this mapping", { exact: true }).click();
      await page.getByRole("button", { name: "Stage reviewed rows" }).click();
      try {
        await page.locator("#setup-catalog-status")
          .getByText("1 sauce guide rows are staged; 0 skipped and 0 remain review-only.")
          .waitFor({ timeout: 10000 });
      } catch (error) {
        console.log(JSON.stringify({
          event: "v2.sauce_import_stage_wait_failed",
          status: await page.locator("#setup-catalog-status").innerText(),
          statusKind: await page.locator("#setup-catalog-status").getAttribute("data-kind"),
          previewText: (await page.locator("#source-workbook-preview").innerText()).slice(0, 500),
          stagedImports: fixture.setupCatalogImports.map((item) => ({
            family: item.family,
            status: item.status,
            rowCount: item.rowCount,
            sourceFamily: item.sourceSummary?.sourceFamily ?? null,
            importedRows: item.sourceSummary?.importedRows ?? null,
          })),
          pageErrors: fixture.pageErrors,
          consoleErrors: fixture.consoleErrors.slice(-5),
          notFoundRoutes: fixture.notFoundRoutes.slice(-5),
        }));
        throw error;
      }

      const staged = fixture.setupCatalogImports[0];
      assert.equal(staged.family, "run-templates");
      assert.equal(staged.sourceSummary.sourceFamily, "sauce-guides");
      assert.equal(staged.sourceSummary.importedRows, 1);
      assert.equal(staged.records[0].data.values.sauceOzPerPizza, 3.5);
      fixture.loseNextApplyResponse = true;
      fixture.expectedLostApplyConsoleError = true;
      await page.getByRole("button", { name: "Apply reviewed setup" }).click();
      await page.locator("#setup-catalog-status[data-kind='error']").waitFor();
      assert.equal(fixture.setupCatalogImports[0].status, "applied");
      assert.equal(fixture.setupCatalogApplyCalls, 1);
      await page.getByRole("button", { name: "Apply reviewed setup" }).click();
      await page.locator("#setup-catalog-status").getByText("1 setup rows created and 0 updated.").waitFor();
      assert.equal(fixture.setupCatalogImports[0].status, "applied");
      assert.equal(fixture.setupCatalogApplyCalls, 2);

      await page.reload();
      await page.locator("#setup-catalog-history").waitFor();
      const historyText = await page.locator("#setup-catalog-history").innerText();
      assert.match(historyText, /Sauce guide · 1 source · 1 staged · 0 skipped · 0 unresolved · applied · 1 created · 0 updated/u);
      await page.getByRole("button", { name: "Review", exact: true }).click();
      await page.locator("#setup-catalog-preview").getByText(/Sauce guide · 1 source rows · 1 staged/u).waitFor();
      assert.ok(await page.locator("#setup-catalog-preview").getByText(/Sauce guide: Acme · Classic/u).count() >= 1);

      for (const viewport of [
        { width: 390, height: 844 },
        { width: 768, height: 1024 },
        { width: 1024, height: 768 },
        { width: 1440, height: 900 },
      ]) {
        await page.setViewportSize(viewport);
        const overflow = await page.evaluate(() => ({
          width: document.documentElement.scrollWidth,
          offenders: Array.from(document.querySelectorAll("*")).map((element) => {
            const rect = element.getBoundingClientRect();
            return {
              tag: element.tagName,
              id: element.id,
              className: typeof element.className === "string" ? element.className : "",
              right: Math.round(rect.right),
              width: Math.round(rect.width),
            };
          }).filter((element) => element.right > window.innerWidth + 1),
        }));
        assert.ok(overflow.width <= viewport.width + 1,
          `source import layout should not overflow at ${viewport.width}×${viewport.height}: ${JSON.stringify(overflow.offenders.slice(0, 8))}`);
      }
      assert.deepEqual(fixture.pageErrors, []);
      assert.deepEqual(fixture.consoleErrors, []);
    },
  );
}

test("installed shell serves schedule and setup-import modules offline and after reconnecting", async (t) => {
  const { fixture, openDevice } = await createFixture(t, { width: 1440, height: 900 }, { manager: true });
  const { context, page } = await openDevice();
  const modules = [
    "/v2/web/update-manager.mjs",
    "/v2/web/manager-operations.js",
    "/v2/web/inventory-export.mjs",
    "/v2/web/schedule.js",
    "/v2/core/schedule-planning.mjs",
    "/v2/web/setup-catalog.js",
    "/v2/core/setup-catalog-csv.mjs",
    "/v2/core/import-csv.mjs",
    "/v2/core/import-csv-templates.mjs",
  ];
  const failedRequests = [];
  page.on("requestfailed", (request) => {
    failedRequests.push({
      url: request.url(),
      error: request.failure()?.errorText || "",
    });
  });

  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve) => navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true }));
    }
  });
  const cached = await page.evaluate(async (paths) => {
    const cache = await caches.open("fieldline-v2-shell-11");
    return Promise.all(paths.map(async (path) => ({
      path,
      present: Boolean(await cache.match(path)),
    })));
  }, modules);
  assert.deepEqual(cached, modules.map((path) => ({ path, present: true })));

  const checkModules = async () => page.evaluate(async (paths) => Promise.all(paths.map(async (path) => {
    const response = await fetch(path);
    return {
      path,
      status: response.status,
      contentType: response.headers.get("content-type"),
      body: await response.text(),
    };
  })), modules);

  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  const offline = await checkModules();
  for (const module of offline) {
    assert.equal(module.status, 200, `${module.path} loads while offline`);
    assert.match(module.contentType || "", /javascript/u);
    assert.ok(module.body.length > 0, `${module.path} has module contents while offline`);
  }

  await context.setOffline(false);
  const reconnected = await checkModules();
  for (const module of reconnected) {
    assert.equal(module.status, 200, `${module.path} loads after reconnect`);
    assert.match(module.contentType || "", /javascript/u);
    assert.ok(module.body.length > 0, `${module.path} has module contents after reconnect`);
  }
  assert.deepEqual(fixture.pageErrors, []);
  const unexpectedOfflineErrors = fixture.consoleErrors.filter((message) =>
    !message.includes("https://fonts.googleapis.com/css2?family="));
  assert.deepEqual(unexpectedOfflineErrors, [],
    `only the optional remote font stylesheet may fail offline: ${JSON.stringify(fixture.consoleErrors)}`);
  assert.ok(
    failedRequests.every(({ url, error }) => (
      error === "net::ERR_INTERNET_DISCONNECTED"
      && !modules.includes(new URL(url).pathname)
    )),
    `only non-module resources may fail while offline: ${JSON.stringify(failedRequests)}`,
  );
  await context.close();
});
