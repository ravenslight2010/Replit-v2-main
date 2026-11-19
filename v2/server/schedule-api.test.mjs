import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import * as XLSX from "xlsx";
import { applyScheduleCommand, emptySchedule } from "../core/schedule-planning.mjs";
import { createScheduleApi } from "./schedule-api.mjs";

const FACILITY_ID = "00000000-0000-4000-8000-000000000001";
const ACTOR_ID = "00000000-0000-4000-8000-000000000002";
const RUN_A = "00000000-0000-4000-8000-000000000003";
const RUN_B = "00000000-0000-4000-8000-000000000004";
const RUN_C = "00000000-0000-4000-8000-000000000005";
const AUTH = { verified: true, facilityId: FACILITY_ID, actorId: ACTOR_ID, capabilities: ["manage-factory-settings"] };
const RUN = {
  id: RUN_A,
  productCode: "PRODUCT",
  productionSetupCode: "SETUP",
  runTemplateCode: "TEMPLATE",
  targetCases: 20,
  notes: "",
};
const CATALOG = {
  products: [{ code: "PRODUCT", name: "Product", productionSetups: [{ code: "SETUP", name: "Setup" }] }],
  templates: [{ code: "TEMPLATE", name: "Template", brand: "Brand", flavor: "Flavor", values: {} }],
  productionStartTime: "06:00",
  timeZone: "America/Chicago",
};

async function withApi(t, { auth = AUTH, csrf = true } = {}) {
  const calls = [];
  let schedule = emptySchedule("2026-11-18");
  const receipts = new Map();
  const pool = {
    async query(config) {
      assert.equal(config.query_timeout, 5_000);
      calls.push(config.text);
      if (config.text.includes("list_run_products")) return { rows: [{ result: { products: CATALOG.products } }] };
      if (config.text.includes("list_schedule_run_templates")) return { rows: [{ result: CATALOG.templates }] };
      if (config.text.includes("schedule_default_start_time")) return { rows: [{ result: "06:00" }] };
      if (config.text.includes("get_production_schedule")) {
        const date = config.values[1];
        if (date !== schedule.date) schedule = emptySchedule(date);
        return { rows: [{ result: schedule }] };
      }
      if (config.text.includes("apply_production_schedule_command")) {
        const [facility, actor, date, requestId, requestHash, expectedRevision, jsonCommand] = config.values;
        assert.equal(facility, FACILITY_ID);
        assert.equal(actor, ACTOR_ID);
        assert.equal(date, schedule.date);
        const previous = receipts.get(requestId);
        if (previous) {
          if (previous.hash !== requestHash) {
            const error = new Error("request id reused");
            error.code = "22023";
            throw error;
          }
          return { rows: [{ result: { ...previous.response, replayed: true, schedule } }] };
        }
        if (Number(expectedRevision) !== schedule.revision) {
          return { rows: [{ result: { outcome: "conflict", replayed: false, schedule } }] };
        }
        const command = JSON.parse(jsonCommand);
        const next = applyScheduleCommand(schedule, command);
        schedule = { ...next, revision: schedule.revision + 1, updatedAt: "2026-11-18T12:00:00.000Z" };
        const response = { outcome: "accepted", replayed: false, schedule };
        receipts.set(requestId, { hash: requestHash, response: { outcome: "accepted" } });
        return { rows: [{ result: response }] };
      }
      throw new Error(`Unexpected database query: ${config.text}`);
    },
  };
  const handler = createScheduleApi({
    pool,
    authenticate: async () => auth,
    verifyCsrf: async (request) => csrf && request.headers["x-csrf-token"] === "ok",
    logger: () => {},
  });
  const server = createServer(async (request, response) => {
    await handler(request, response);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  return { baseUrl: `http://127.0.0.1:${address.port}`, calls };
}

function send(baseUrl, path, { method = "GET", body, csrf = true } = {}) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(csrf ? { "x-csrf-token": "ok" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test("schedule catalog and date reads require a manager and return scoped server state", async (t) => {
  const fixture = await withApi(t);
  const catalogResponse = await send(fixture.baseUrl, "/api/v2/schedules/catalog");
  assert.equal(catalogResponse.status, 200);
  assert.equal(catalogResponse.headers.get("cache-control"), "no-store");
  assert.deepEqual(await catalogResponse.json(), CATALOG);

  const dateResponse = await send(fixture.baseUrl, "/api/v2/schedules?date=2026-11-18");
  assert.equal(dateResponse.status, 200);
  assert.equal((await dateResponse.json()).schedule.timeZone, "America/Chicago");

  const denied = await withApi(t, { auth: { ...AUTH, capabilities: [] } });
  const forbidden = await send(denied.baseUrl, "/api/v2/schedules?date=2026-11-18");
  assert.equal(forbidden.status, 403);
  assert.equal(denied.calls.length, 0);
});

test("schedule commands are revision-fenced and exact retries do not duplicate runs", async (t) => {
  const { baseUrl } = await withApi(t);
  const firstRequest = {
    requestId: "00000000-0000-4000-8000-000000000011",
    date: "2026-11-18",
    expectedRevision: 0,
    command: { type: "add", run: RUN },
  };
  const first = await send(baseUrl, "/api/v2/schedules/commands", { method: "POST", body: firstRequest });
  assert.equal(first.status, 200);
  assert.equal((await first.json()).schedule.revision, 1);
  const retry = await send(baseUrl, "/api/v2/schedules/commands", { method: "POST", body: firstRequest });
  assert.equal(retry.status, 200);
  const replay = await retry.json();
  assert.equal(replay.replayed, true);
  assert.equal(replay.schedule.runs.length, 1);

  const second = await send(baseUrl, "/api/v2/schedules/commands", {
    method: "POST",
    body: {
      requestId: "00000000-0000-4000-8000-000000000012",
      date: "2026-11-18",
      expectedRevision: 1,
      command: { type: "add", run: { ...RUN, id: RUN_B, targetCases: 5 } },
    },
  });
  assert.equal(second.status, 200);
  const stale = await send(baseUrl, "/api/v2/schedules/commands", {
    method: "POST",
    body: {
      requestId: "00000000-0000-4000-8000-000000000013",
      date: "2026-11-18",
      expectedRevision: 1,
      command: { type: "add", run: { ...RUN, id: RUN_C, targetCases: 4 } },
    },
  });
  assert.equal(stale.status, 409);
  const conflict = await stale.json();
  assert.equal(conflict.schedule.revision, 2);
  assert.deepEqual(conflict.schedule.runs.map((run) => run.id), [RUN_A, RUN_B]);
});

test("schedule workbook preview is manager-only, CSRF-protected, and never applies data", async (t) => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["Brand", "Flavor", "Cases Planned", "Notes"],
    ["Brand", "Flavor", 12, "PO 123"],
  ]), "Plan");
  const bytes = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  const fixture = await withApi(t);
  const denied = await send(fixture.baseUrl, "/api/v2/schedules/import-preview", {
    method: "POST",
    body: { fileName: "plan.xlsx", workbookBase64: bytes.toString("base64") },
    csrf: false,
  });
  assert.equal(denied.status, 403);
  assert.equal(fixture.calls.length, 0);

  const preview = await send(fixture.baseUrl, "/api/v2/schedules/import-preview", {
    method: "POST",
    body: { fileName: "plan.xlsx", workbookBase64: bytes.toString("base64") },
  });
  assert.equal(preview.status, 200);
  const result = await preview.json();
  assert.equal(result.preview.rows.length, 1);
  assert.match(result.preview.rows[0].importRunId, /^[0-9a-f-]{36}$/u);
  assert.equal(result.preview.rows[0].date, null);
  assert.equal(fixture.calls.length, 0);

  const updatedWorkbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(updatedWorkbook, XLSX.utils.aoa_to_sheet([
    ["Brand", "Flavor", "Cases Planned", "Notes"],
    ["Brand", "Flavor", 13, "PO 124"],
  ]), "Plan");
  const updatedBytes = XLSX.write(updatedWorkbook, { type: "buffer", bookType: "xlsx" });
  const updated = await send(fixture.baseUrl, "/api/v2/schedules/import-preview", {
    method: "POST",
    body: { fileName: "plan.xlsx", workbookBase64: updatedBytes.toString("base64") },
  });
  const updatedPreview = await updated.json();
  assert.equal(updatedPreview.preview.rows[0].targetCases, 13);
  assert.equal(updatedPreview.preview.rows[0].importRunId, result.preview.rows[0].importRunId);
  assert.equal(fixture.calls.length, 0);
});
