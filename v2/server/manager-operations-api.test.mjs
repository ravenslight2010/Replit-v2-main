import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createManagerOperationsApi } from "./manager-operations-api.mjs";

const FACILITY = "10000000-0000-4000-8000-000000000001";
const MANAGER_ID = "10000000-0000-4000-8000-000000000002";
const RUN_ID = "10000000-0000-4000-8000-000000000003";
const ACTION_KEY = `run-pause:${RUN_ID}:2`;
const CURSOR = Buffer.from(JSON.stringify({
  createdAt: "2026-11-18T10:00:00.000Z",
  runId: RUN_ID,
})).toString("base64url");
const EVENT_CURSOR = Buffer.from(JSON.stringify({
  occurredAt: "2026-11-18T10:00:00.000Z",
  runId: RUN_ID,
  revision: 2,
})).toString("base64url");

const snapshot = {
  timeZone: "America/Chicago",
  fromDate: "2026-11-18",
  toDate: "2026-11-20",
  generatedAt: "2026-11-20T16:00:00.000Z",
  runs: { items: [], hasMore: true, nextCursor: { createdAt: "2026-11-18T10:00:00.000Z", runId: RUN_ID } },
  summary: { runsCreated: 0, planned: 0, running: 0, paused: 0, completed: 0, targetCases: 0 },
  activeRuns: [],
  pauseTrend: [],
  eventPatterns: [],
  actions: [],
  dataHealth: { unknownIngredientReferences: 0 },
  coverage: { syncConflicts: { status: "unavailable" } },
};

async function withApi(t, {
  auth = { verified: true, facilityId: FACILITY, actorId: MANAGER_ID, capabilities: ["review-incidents"] },
  csrf = true,
  query = async () => ({ rows: [{ result: structuredClone(snapshot) }] }),
  logger = () => {},
} = {}) {
  const calls = [];
  const server = createServer(createManagerOperationsApi({
    pool: {
      async query(config) {
        calls.push(config);
        return query(config);
      },
    },
    authenticate: async () => auth,
    verifyCsrf: async (request) => csrf && request.headers["x-csrf-token"] === "ok",
    logger,
  }));
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  return { baseUrl: `http://127.0.0.1:${server.address().port}`, calls };
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

test("manager operations require an authenticated manager capability before reading data", async (t) => {
  const unauthenticated = await withApi(t, { auth: null });
  assert.equal((await send(unauthenticated.baseUrl, "/api/v2/manager-operations?from=2026-11-18&to=2026-11-20")).status, 401);
  assert.equal(unauthenticated.calls.length, 0);

  const operator = await withApi(t, {
    auth: { verified: true, facilityId: FACILITY, actorId: MANAGER_ID, capabilities: ["run.read"] },
  });
  assert.equal((await send(operator.baseUrl, "/api/v2/manager-operations?from=2026-11-18&to=2026-11-20")).status, 403);
  assert.equal(operator.calls.length, 0);
});

test("manager summary applies facility identity, bounded date range, and cursor pagination", async (t) => {
  const api = await withApi(t);
  const response = await send(api.baseUrl, `/api/v2/manager-operations?from=2026-11-18&to=2026-11-20&limit=1&cursor=${CURSOR}`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.timeZone, "America/Chicago");
  assert.equal(body.coverage.syncConflicts.status, "unavailable");
  assert.equal(typeof body.runs.nextCursor, "string");
  assert.equal(api.calls.length, 1);
  assert.equal(api.calls[0].values[0], FACILITY);
  assert.equal(api.calls[0].values[1], MANAGER_ID);
  assert.deepEqual(api.calls[0].values.slice(2, 5), ["2026-11-18", "2026-11-20", 1]);
  assert.equal(api.calls[0].values[5], "2026-11-18T10:00:00.000Z");
  assert.equal(api.calls[0].values[6], RUN_ID);
});

test("manager read requests reject bad ranges, repeated parameters, cursors and unsupported fields", async (t) => {
  const api = await withApi(t);
  const paths = [
    "/api/v2/manager-operations?from=2026-02-30&to=2026-03-01",
    "/api/v2/manager-operations?from=2026-01-01&to=2026-04-01",
    "/api/v2/manager-operations?from=2026-11-18&to=2026-11-20&facilityId=other",
    "/api/v2/manager-operations?from=2026-11-18&from=2026-11-19&to=2026-11-20",
    "/api/v2/manager-operations?from=2026-11-18&to=2026-11-20&cursor=not_a_cursor",
  ];
  for (const path of paths) assert.equal((await send(api.baseUrl, path)).status, 400);
  assert.equal(api.calls.length, 0);
  assert.equal((await send(api.baseUrl, "/api/v2/manager-operations?from=2026-11-18&to=2026-11-20", {
    method: "POST",
  })).status, 405);
});

test("manager event history supports run filtering and returns no event payloads", async (t) => {
  const eventPage = {
    events: [{ eventId: `${RUN_ID}:2`, runId: RUN_ID, actorId: MANAGER_ID, eventType: "run.paused", occurredAt: "2026-11-20T10:00:00Z" }],
    hasMore: false,
    nextCursor: null,
    timeZone: "America/Chicago",
    fromDate: "2026-11-18",
    toDate: "2026-11-20",
  };
  const api = await withApi(t, { query: async () => ({ rows: [{ result: eventPage }] }) });
  const response = await send(api.baseUrl, `/api/v2/manager-operations/events?from=2026-11-18&to=2026-11-20&runId=${RUN_ID}&cursor=${EVENT_CURSOR}`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.events[0].eventType, "run.paused");
  assert.equal(JSON.stringify(body).includes("payload"), false);
  assert.equal(api.calls[0].values[5], RUN_ID);
  assert.equal(api.calls[0].values[6], "2026-11-18T10:00:00.000Z");
  assert.equal(api.calls[0].values[7], RUN_ID);
  assert.equal(api.calls[0].values[8], 2);
});

test("manager action status writes require CSRF and are attributed to the verified actor", async (t) => {
  const responseBody = {
    replayed: false,
    event: {
      actionKey: ACTION_KEY,
      revision: 1,
      status: "acknowledged",
      actorId: MANAGER_ID,
      note: "Reviewed the pause evidence",
    },
  };
  const api = await withApi(t, { query: async () => ({ rows: [{ result: responseBody }] }) });
  const actionPath = `/api/v2/manager-operations/actions/${encodeURIComponent(ACTION_KEY)}/status`;
  const body = {
    requestId: "manager-action-1",
    expectedRevision: 0,
    status: "acknowledged",
    note: "Reviewed the pause evidence",
  };
  const denied = await send(api.baseUrl, actionPath, { method: "POST", body, csrf: false });
  assert.equal(denied.status, 403);
  assert.equal(api.calls.length, 0);

  const saved = await send(api.baseUrl, actionPath, { method: "POST", body });
  assert.equal(saved.status, 201);
  assert.deepEqual(await saved.json(), responseBody);
  assert.equal(api.calls[0].values[0], FACILITY);
  assert.equal(api.calls[0].values[1], MANAGER_ID);
  assert.equal(api.calls[0].values[2], ACTION_KEY);
  assert.equal(api.calls[0].values[3], 0);
  assert.match(api.calls[0].values[5], /^[0-9a-f]{64}$/u);
});

test("stale status replies and database errors stay safe", async (t) => {
  const logs = [];
  const stale = await withApi(t, {
    query: async () => { throw Object.assign(new Error("private SQL detail"), { code: "40001" }); },
    logger: (record) => logs.push(record),
  });
  const response = await send(stale.baseUrl, `/api/v2/manager-operations/actions/${encodeURIComponent(ACTION_KEY)}/status`, {
    method: "POST",
    body: { requestId: "manager-action-stale", expectedRevision: 2, status: "resolved", note: "Resolve after review" },
  });
  assert.equal(response.status, 409);
  assert.doesNotMatch(await response.text(), /private SQL detail/u);
  assert.doesNotMatch(JSON.stringify(logs), /private SQL detail/u);
});
