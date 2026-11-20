import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createMixPlanApi } from "./mix-plan-api.mjs";

const FACILITY = "10000000-0000-4000-8000-000000000001";
const OPERATOR = {
  verified: true,
  facilityId: FACILITY,
  actorId: "10000000-0000-4000-8000-000000000002",
  capabilities: ["run.read"],
};
const sources = {
  makeDate: "2026-02-28",
  timeZone: "America/Chicago",
  mixes: [{
    code: "MIX-A",
    name: "Plain mix",
    enabled: true,
    isPrep: false,
    brand: "Brand A",
    flavor: "Plain",
    daysEarly: 1,
    batchSizeLbs: 10,
    components: [{ ingredientName: "Flour", perPizzaOz: 1 }],
  }],
  schedules: [{
    date: "2026-03-01",
    revision: 1,
    runs: [{
      id: "10000000-0000-4000-8000-000000000003",
      productCode: "PRODUCT-A",
      productionSetupCode: "SETUP-A",
      runTemplateCode: "TEMPLATE-A",
      targetCases: 2,
    }],
  }],
  templates: [{
    code: "TEMPLATE-A",
    name: "Brand A Plain",
    brand: "Brand A",
    flavor: "Plain",
    values: { pizzasPerCase: 8 },
  }],
  setups: [{ productCode: "PRODUCT-A", productionSetupCode: "SETUP-A", recipes: [] }],
  activeRuns: [],
  substitutions: [],
  scheduleHorizonTruncated: false,
};

async function withApi(t, { auth = OPERATOR, source = sources, queryError = null } = {}) {
  const calls = [];
  const api = createMixPlanApi({
    pool: {
      async query(query) {
        calls.push(query);
        if (queryError) throw queryError;
        return { rows: [{ result: source }] };
      },
    },
    authenticate: async () => auth,
    logger: () => {},
  });
  const server = createServer(api);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  return { baseUrl: `http://127.0.0.1:${server.address().port}`, calls };
}

test("operators can read the make-day plan from a single facility-scoped canonical read", async (t) => {
  const api = await withApi(t);
  const response = await fetch(`${api.baseUrl}/api/v2/mix-plan?makeDate=2026-02-28`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.plan.items[0].totalQuantity, 1);
  assert.equal(body.plan.items[0].totalUnit, "lb");
  assert.equal(body.plan.items[0].contributingRuns[0].productionDate, "2026-03-01");
  assert.equal(api.calls.length, 1);
  assert.equal(api.calls[0].text, "SELECT v2.get_operational_mix_plan_sources($1::uuid, $2::date) AS result");
  assert.deepEqual(api.calls[0].values, [FACILITY, "2026-02-28"]);
  assert.equal(api.calls[0].query_timeout, 5_000);
});

test("mix plan rejects unauthorized roles, writes, and invalid or duplicate dates before reading", async (t) => {
  const denied = await withApi(t, { auth: { ...OPERATOR, capabilities: [] } });
  assert.equal((await fetch(`${denied.baseUrl}/api/v2/mix-plan?makeDate=2026-02-28`)).status, 403);
  assert.equal(denied.calls.length, 0);

  const api = await withApi(t);
  assert.equal((await fetch(`${api.baseUrl}/api/v2/mix-plan?makeDate=2026-02-30`)).status, 400);
  assert.equal((await fetch(`${api.baseUrl}/api/v2/mix-plan?makeDate=2026-02-28&makeDate=2026-03-01`)).status, 400);
  assert.equal((await fetch(`${api.baseUrl}/api/v2/mix-plan?makeDate=2026-02-28&facilityId=other`)).status, 400);
  assert.equal((await fetch(`${api.baseUrl}/api/v2/mix-plan?makeDate=2026-02-28`, { method: "POST" })).status, 405);
  assert.equal(api.calls.length, 0);
});

test("mix plan fails explicitly when canonical sources or the database are unavailable", async (t) => {
  const incomplete = await withApi(t, { source: { ...sources, setups: null } });
  assert.equal((await fetch(`${incomplete.baseUrl}/api/v2/mix-plan?makeDate=2026-02-28`)).status, 502);
  assert.deepEqual(await (await fetch(`${incomplete.baseUrl}/api/v2/mix-plan?makeDate=2026-02-28`)).json(), {
    error: "Canonical mix plan sources are incomplete. Refresh to try again.",
  });

  const unavailable = await withApi(t, { queryError: new Error("private database details") });
  const response = await fetch(`${unavailable.baseUrl}/api/v2/mix-plan?makeDate=2026-02-28`);
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "The mix plan could not be loaded. Refresh to try again." });
});

test("API adds a clear warning when the bounded schedule source horizon is truncated", async (t) => {
  const api = await withApi(t, { source: { ...sources, scheduleHorizonTruncated: true } });
  const body = await (await fetch(`${api.baseUrl}/api/v2/mix-plan?makeDate=2026-02-28`)).json();
  assert.ok(body.plan.warnings.some((warning) => warning.code === "schedule-horizon-truncated"));
});
