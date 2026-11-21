import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createManagerDiagnosticsApi } from "./manager-diagnostics-api.mjs";

const MANAGER = {
  verified: true,
  actorId: "10000000-0000-4000-8000-000000000001",
  capabilities: ["manage-staff"],
};
const OPERATOR = { ...MANAGER, capabilities: ["run.read"] };
const NOW = Date.parse("2026-11-16T12:00:30.000Z");

async function withServer(handler, run) {
  const server = createServer(async (request, response) => {
    if (!await handler(request, response)) {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("manager station-worker diagnostics distinguish active, standby, stale, degraded, and unavailable", async () => {
  const samples = [
    [{
      status: "active",
      lastCycleAt: "2026-11-16T12:00:25.000Z",
      consecutiveFailures: 0,
      processedLastCycle: 3,
      ownerId: "must-not-escape",
      privateError: "secret",
    }, "active", 5],
    [{
      status: "standby",
      lastCycleAt: null,
      consecutiveFailures: 0,
      processedLastCycle: 0,
    }, "standby", null],
    [{
      status: "active",
      lastCycleAt: "2026-11-16T11:59:00.000Z",
      consecutiveFailures: 0,
      processedLastCycle: 1,
    }, "stale", 90],
    [{
      status: "degraded",
      lastCycleAt: "2026-11-16T12:00:28.000Z",
      consecutiveFailures: 2,
      processedLastCycle: 0,
    }, "degraded", 2],
    [null, "unavailable", null],
  ];

  for (const [snapshot, status, ageSeconds] of samples) {
    const handler = createManagerDiagnosticsApi({
      authenticate: async () => MANAGER,
      workerHealth: async () => snapshot,
      clock: () => NOW,
    });
    await withServer(handler, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/v2/manager-diagnostics/station-worker`);
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.stationWorker.status, status);
      assert.equal(body.stationWorker.ageSeconds, ageSeconds);
      assert.equal(typeof body.stationWorker.nextStep, "string");
      assert.equal("ownerId" in body.stationWorker, false);
      assert.equal("privateError" in body.stationWorker, false);
    });
  }

  const unavailable = createManagerDiagnosticsApi({
    authenticate: async () => MANAGER,
    workerHealth: async () => { throw new Error("private network endpoint detail"); },
    clock: () => NOW,
  });
  await withServer(unavailable, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v2/manager-diagnostics/station-worker`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).stationWorker.status, "unavailable");
  });
});

test("station-worker diagnostics deny non-managers and reject unsupported requests", async () => {
  let current = null;
  let workerReads = 0;
  const handler = createManagerDiagnosticsApi({
    authenticate: async () => current,
    workerHealth: async () => {
      workerReads += 1;
      return { status: "standby", lastCycleAt: null, consecutiveFailures: 0, processedLastCycle: 0 };
    },
    clock: () => NOW,
  });
  await withServer(handler, async (baseUrl) => {
    const unauthenticated = await fetch(`${baseUrl}/api/v2/manager-diagnostics/station-worker`);
    assert.equal(unauthenticated.status, 401);
    current = OPERATOR;
    const forbidden = await fetch(`${baseUrl}/api/v2/manager-diagnostics/station-worker`);
    assert.equal(forbidden.status, 403);
    assert.equal(workerReads, 0);

    current = MANAGER;
    const query = await fetch(`${baseUrl}/api/v2/manager-diagnostics/station-worker?detail=true`);
    assert.equal(query.status, 400);
    const method = await fetch(`${baseUrl}/api/v2/manager-diagnostics/station-worker`, { method: "POST" });
    assert.equal(method.status, 405);
    assert.equal(method.headers.get("allow"), "GET");
    assert.equal(workerReads, 0);
  });
});
