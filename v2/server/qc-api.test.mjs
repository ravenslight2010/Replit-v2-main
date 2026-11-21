import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createQcApi } from "./qc-api.mjs";

const MANAGER = {
  verified: true,
  facilityId: "10000000-0000-4000-8000-000000000001",
  actorId: "10000000-0000-4000-8000-000000000002",
  capabilities: ["record-qc", "manage-qc", "manage-allergens"],
};
const OPERATOR = {
  ...MANAGER,
  actorId: "10000000-0000-4000-8000-000000000003",
  capabilities: ["record-qc"],
};
const RUN_ID = "10000000-0000-4000-8000-000000000004";
const PRODUCT_ID = "10000000-0000-4000-8000-000000000005";
const RUN = {
  id: RUN_ID,
  status: "running",
  setupSnapshot: {
    productCode: "PIZZA",
    productionPlan: {
      recipes: [{
        code: "DOUGH-BASE",
        name: "Dough base",
        stationKey: "dough",
        ingredients: [{
          productId: PRODUCT_ID,
          productCode: "FLOUR",
          productName: "Flour",
          unit: "lb",
        }],
      }],
    },
  },
};

async function withApi(t, {
  auth = OPERATOR,
  csrf = true,
  query = async () => ({ rows: [{ result: [] }] }),
  logger = () => {},
} = {}) {
  const calls = [];
  const pool = {
    async query(queryConfig) {
      calls.push(queryConfig);
      return query(queryConfig);
    },
  };
  const handler = createQcApi({
    pool,
    authenticate: async () => auth,
    verifyCsrf: async (request) => csrf && request.headers["x-csrf-token"] === "ok",
    logger,
  });
  const server = createServer(handler);
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
    headers: body === undefined ? {} : {
      "content-type": "application/json",
      ...(csrf ? { "x-csrf-token": "ok" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test("QC APIs require QC capability and CSRF before database access", async (t) => {
  const missing = await withApi(t, { auth: null });
  const unauthenticated = await send(missing.baseUrl, "/api/v2/qc/history");
  assert.equal(unauthenticated.status, 401);
  assert.equal(missing.calls.length, 0);

  const warehouse = await withApi(t, { auth: { ...OPERATOR, capabilities: ["manage-inventory"] } });
  const denied = await send(warehouse.baseUrl, "/api/v2/qc/history");
  assert.equal(denied.status, 403);
  assert.equal(warehouse.calls.length, 0);

  const noCsrf = await withApi(t, { csrf: false });
  const rejected = await send(noCsrf.baseUrl, `/api/v2/qc/runs/${RUN_ID}/events`, {
    method: "POST",
    body: { requestId: "qc-write-1", eventType: "cleaning-recorded", method: "wash", cleanedAt: "2026-11-18T10:00:00Z" },
    csrf: false,
  });
  assert.equal(rejected.status, 403);
  assert.equal(noCsrf.calls.length, 0);
});

test("ingredient identity links require the dedicated manager capability", async (t) => {
  const operator = await withApi(t);
  const denied = await send(operator.baseUrl, "/api/v2/qc/ingredient-links");
  assert.equal(denied.status, 403);
  assert.equal(operator.calls.length, 0);

  const linkManager = await withApi(t, {
    auth: { ...OPERATOR, capabilities: ["manage-allergens"] },
    query: async (queryConfig) => {
      if (queryConfig.text.includes("v2.list_qc_ingredient_links")) {
        return { rows: [{ result: { products: [], productsTruncated: false, ingredients: [], ingredientsTruncated: false, events: [] } }] };
      }
      if (queryConfig.text.includes("v2.record_qc_ingredient_link")) {
        return { rows: [{ result: { replayed: false, event: { id: "ingredient-link-event" } } }] };
      }
      throw new Error("unexpected query");
    },
  });
  const listed = await send(linkManager.baseUrl, "/api/v2/qc/ingredient-links");
  assert.equal(listed.status, 200);
  assert.deepEqual((await listed.json()).products, []);
  const saved = await send(linkManager.baseUrl, "/api/v2/qc/ingredient-links", {
    method: "POST",
    body: {
      requestId: "explicit-link",
      productId: PRODUCT_ID,
      ingredientCode: "MILK-BASE",
    },
  });
  assert.equal(saved.status, 201);
  const write = linkManager.calls.find((call) => call.text.includes("v2.record_qc_ingredient_link"));
  assert.equal(write.values[4], PRODUCT_ID);
  assert.equal(write.values[5], "MILK-BASE");
});

test("weight observations use the run snapshot and remain not evaluated without a reviewed target", async (t) => {
  const api = await withApi(t, {
    query: async (queryConfig) => {
      if (queryConfig.text.includes("v2.get_run")) return { rows: [{ result: RUN }] };
      if (queryConfig.text.includes("v2.list_qc_settings")) return { rows: [{ result: [] }] };
      if (queryConfig.text.includes("v2.record_qc_event")) {
        return { rows: [{ result: { replayed: false, event: { id: "qc-event" } } }] };
      }
      throw new Error("unexpected query");
    },
  });
  const response = await send(api.baseUrl, `/api/v2/qc/runs/${RUN_ID}/events`, {
    method: "POST",
    body: {
      requestId: "weight-check-1",
      eventType: "weight-check",
      productId: PRODUCT_ID,
      recipeCode: "DOUGH-BASE",
      stationKey: "dough",
      actual: "2.25",
      reason: "",
    },
  });
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { replayed: false, event: { id: "qc-event" } });
  const write = api.calls.find((call) => call.text.includes("v2.record_qc_event"));
  const payload = JSON.parse(write.values[6]);
  assert.equal(payload.result, "not_evaluated");
  assert.equal(payload.unit, "lb");
  assert.equal(payload.productCode, "FLOUR");
});

test("QC rejects client-invented run ingredients and unsupported fields", async (t) => {
  const api = await withApi(t, {
    query: async (queryConfig) => {
      if (queryConfig.text.includes("v2.get_run")) return { rows: [{ result: RUN }] };
      throw new Error("unexpected query");
    },
  });
  const notInSnapshot = await send(api.baseUrl, `/api/v2/qc/runs/${RUN_ID}/events`, {
    method: "POST",
    body: {
      requestId: "fake-ingredient",
      eventType: "lot-recorded",
      productId: "10000000-0000-4000-8000-000000000099",
      recipeCode: "DOUGH-BASE",
      stationKey: "dough",
      lotCode: "LOT-A",
    },
  });
  assert.equal(notInSnapshot.status, 400);
  assert.equal(api.calls.some((call) => call.text.includes("v2.record_qc_event")), false);

  const extraField = await send(api.baseUrl, `/api/v2/qc/runs/${RUN_ID}/events`, {
    method: "POST",
    body: {
      requestId: "extra-verifier",
      eventType: "cleaning-verified",
      targetEventId: "10000000-0000-4000-8000-000000000006",
      verifierId: OPERATOR.actorId,
    },
  });
  assert.equal(extraField.status, 400);
  assert.equal(api.calls.some((call) => call.text.includes("v2.record_qc_event")), false);
});

test("QC substitution proposals preserve multiple exact source quantities and manager-only approval", async (t) => {
  const subRun = structuredClone(RUN);
  subRun.setupSnapshot.productionPlan.recipes.push({
    code: "CHEESE-BASE",
    name: "Cheese base",
    stationKey: "cheese",
    ingredients: [{
      productId: "10000000-0000-4000-8000-000000000007",
      productCode: "MOZZ",
      productName: "Mozzarella",
      unit: "lb",
    }],
  });
  const products = {
    products: [{
      productId: "10000000-0000-4000-8000-000000000006",
      productCode: "MONTEREY-NEW",
      productName: "Replacement Monterey",
      unit: "lb",
    }],
    productsTruncated: false,
  };
  const operator = await withApi(t, {
    query: async (queryConfig) => {
      if (queryConfig.text.includes("v2.get_run")) return { rows: [{ result: subRun }] };
      if (queryConfig.text.includes("v2.list_qc_component_products")) return { rows: [{ result: products }] };
      if (queryConfig.text.includes("v2.record_qc_substitution")) {
        return { rows: [{ result: { replayed: false, event: { id: "sub-proposal" } } }] };
      }
      throw new Error("unexpected query");
    },
  });
  const proposal = await send(operator.baseUrl, `/api/v2/qc/runs/${RUN_ID}/substitutions`, {
    method: "POST",
    body: {
      requestId: "multi-source-sub",
      sourceItems: [
        { productId: PRODUCT_ID, recipeCode: "DOUGH-BASE", stationKey: "dough", quantity: "5", unit: "lb" },
        { productId: "10000000-0000-4000-8000-000000000007", recipeCode: "CHEESE-BASE", stationKey: "cheese", quantity: "20", unit: "lb" },
      ],
      replacementProductId: products.products[0].productId,
      replacementQuantity: "40",
      replacementUnit: "lb",
      reason: "Replace part of the cheese blend",
    },
  });
  assert.equal(proposal.status, 201);
  const write = operator.calls.find((call) => call.text.includes("v2.record_qc_substitution"));
  assert.equal(write.values[5], "propose");
  const details = JSON.parse(write.values[8]);
  assert.equal(details.sourceItems.length, 2);
  assert.equal(details.replacementQuantity, "40");

  const denied = await send(operator.baseUrl, `/api/v2/qc/runs/${RUN_ID}/substitutions/${RUN_ID}/decision`, {
    method: "POST",
    body: { requestId: "not-manager", decision: "approve" },
  });
  assert.equal(denied.status, 403);
  assert.equal(operator.calls.filter((call) => call.text.includes("v2.record_qc_substitution")).length, 1);

  const manager = await withApi(t, {
    auth: MANAGER,
    query: async (queryConfig) => {
      if (queryConfig.text.includes("v2.get_run")) return { rows: [{ result: subRun }] };
      if (queryConfig.text.includes("v2.record_qc_substitution")) {
        return { rows: [{ result: { replayed: false, event: { id: "sub-approved" } } }] };
      }
      throw new Error("unexpected query");
    },
  });
  const approval = await send(manager.baseUrl, `/api/v2/qc/runs/${RUN_ID}/substitutions/${RUN_ID}/decision`, {
    method: "POST",
    body: { requestId: "approve-sub", decision: "approve" },
  });
  assert.equal(approval.status, 201);
  const approvalCall = manager.calls.find((call) => call.text.includes("v2.record_qc_substitution"));
  assert.equal(approvalCall.values[5], "approve");
  assert.equal(approvalCall.values[6], RUN_ID);
  assert.equal(JSON.parse(approvalCall.values[8]) && Object.keys(JSON.parse(approvalCall.values[8])).length, 0);
});

test("component observations are run-scoped and recorded as advisory evidence", async (t) => {
  const api = await withApi(t, {
    query: async (queryConfig) => {
      if (queryConfig.text.includes("v2.get_run")) return { rows: [{ result: RUN }] };
      if (queryConfig.text.includes("v2.list_qc_run_substitutions")) return { rows: [{ result: [] }] };
      if (queryConfig.text.includes("v2.list_qc_component_products")) {
        return { rows: [{ result: { products: [], productsTruncated: false } }] };
      }
      if (queryConfig.text.includes("v2.record_qc_event")) {
        return { rows: [{ result: { replayed: false, event: { id: "component-check" } } }] };
      }
      throw new Error("unexpected query");
    },
  });
  const response = await send(api.baseUrl, `/api/v2/qc/runs/${RUN_ID}/events`, {
    method: "POST",
    body: {
      requestId: "component-check-1",
      eventType: "run-check-reviewed",
      checkType: "component-presence",
      observations: [{
        productId: PRODUCT_ID,
        recipeCode: "DOUGH-BASE",
        stationKey: "dough",
        status: "present",
        observedProductId: null,
      }],
    },
  });
  assert.equal(response.status, 201);
  const saved = JSON.parse(api.calls.find((call) => call.text.includes("v2.record_qc_event")).values[6]);
  assert.equal(saved.checkType, "component-presence");
  assert.equal(saved.result, "recorded");
  assert.equal(saved.observations[0].expectedProductId, PRODUCT_ID);
});

test("run history keeps unlinked ingredient allergens unknown and lists component support", async (t) => {
  const api = await withApi(t, {
    query: async (queryConfig) => {
      if (queryConfig.text.includes("v2.get_run")) return { rows: [{ result: RUN }] };
      if (queryConfig.text.includes("v2.list_qc_events")) return { rows: [{ result: [] }] };
      if (queryConfig.text.includes("v2.list_qc_settings")) return { rows: [{ result: [] }] };
      if (queryConfig.text.includes("v2.list_qc_run_substitutions")) return { rows: [{ result: [] }] };
      if (queryConfig.text.includes("v2.list_qc_component_products")) {
        return { rows: [{ result: { products: [], productsTruncated: false } }] };
      }
      if (queryConfig.text.includes("v2.get_qc_review_state")) {
        return { rows: [{ result: { status: "needs-review", signedOffAt: null, signedOffBy: null } }] };
      }
      throw new Error("unexpected query");
    },
  });
  const response = await send(api.baseUrl, `/api/v2/qc/runs/${RUN_ID}?limit=100`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.items[0].productId, PRODUCT_ID);
  assert.equal(body.review.status, "needs-review");
  assert.equal(body.allergenFootprint.status, "unknown");
  assert.equal(body.allergenFootprint.unknownIngredients.length, 1);
  assert.equal(body.limitations.allergens, "incomplete");
  assert.equal(body.limitations.components, "available");
});

test("run.read receives only run-scoped substitution and allergen status", async (t) => {
  const substitution = {
    id: "10000000-0000-4000-8000-000000000010",
    proposalEventId: "10000000-0000-4000-8000-000000000011",
    revision: 2,
    sourceItems: [{
      productId: PRODUCT_ID,
      recipeCode: "DOUGH-BASE",
      recipeName: "Dough base",
      stationKey: "dough",
      quantity: "12.5",
      unit: "lb",
    }],
    replacementProductId: "10000000-0000-4000-8000-000000000012",
    replacementProductCode: "ALT-FLOUR",
    replacementProductName: "Alternate flour",
    replacementQuantity: "10",
    replacementUnit: "lb",
    replacementIngredientSnapshot: null,
    movementGroupId: "10000000-0000-4000-8000-000000000013",
    occurredAt: "2026-11-19T10:00:00.000Z",
  };
  const api = await withApi(t, {
    auth: { ...OPERATOR, capabilities: ["run.read"] },
    query: async (queryConfig) => {
      if (queryConfig.text.includes("v2.get_run")) return { rows: [{ result: RUN }] };
      if (queryConfig.text.includes("v2.list_run_operational_substitutions")) {
        return { rows: [{ result: [substitution] }] };
      }
      throw new Error("unexpected query");
    },
  });
  const response = await send(api.baseUrl, `/api/v2/qc/runs/${RUN_ID}/operational-status`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.substitutions[0].sourceItems[0].productName, "Flour");
  assert.equal(body.substitutions[0].replacementProductCode, "ALT-FLOUR");
  assert.equal(body.substitutions[0].replacementQuantity, "10");
  assert.equal(body.substitutions[0].movementGroupId, substitution.movementGroupId);
  assert.equal(body.allergenFootprint.status, "unknown");
  assert.equal(body.stations.dough.substitutions.length, 1);
  assert.equal(body.stations.dough.allergenFootprint.status, "unknown");
  assert.equal(api.calls.some((call) => call.text.includes("list_qc_events")), false);
  assert.equal(api.calls.some((call) => call.text.includes("list_qc_settings")), false);

  const denied = await withApi(t, {
    auth: { ...OPERATOR, capabilities: ["manage-inventory"] },
  });
  assert.equal(
    (await send(denied.baseUrl, `/api/v2/qc/runs/${RUN_ID}/operational-status`)).status,
    403,
  );
  assert.equal(denied.calls.length, 0);
});

test("completed run status reads only the frozen substitution receipt", async (t) => {
  const receiptSubstitution = {
    id: "10000000-0000-4000-8000-000000000020",
    revision: 1,
    sourceItems: [{
      productId: PRODUCT_ID,
      recipeCode: "DOUGH-BASE",
      stationKey: "dough",
      quantity: "12.5",
      unit: "lb",
    }],
    replacementProductId: "10000000-0000-4000-8000-000000000021",
    replacementProductCode: "ALT-FLOUR",
    replacementProductName: "Alternate flour",
    replacementQuantity: "10",
    replacementUnit: "lb",
    replacementIngredientSnapshot: {
      status: "linked",
      ingredientCode: "ALT-FLOUR",
      ingredientName: "Alternate flour",
      allergens: [],
      allergensReviewed: true,
    },
    movementGroupId: "10000000-0000-4000-8000-000000000022",
    occurredAt: "2026-11-19T10:00:00.000Z",
  };
  const completed = {
    ...RUN,
    status: "completed",
    inventoryConsumption: {
      componentDemand: [],
      qcSubstitutions: [receiptSubstitution],
    },
  };
  const api = await withApi(t, {
    auth: { ...OPERATOR, capabilities: ["run.read"] },
    query: async (queryConfig) => {
      if (queryConfig.text.includes("v2.get_run")) return { rows: [{ result: completed }] };
      throw new Error("Completed evidence must not re-read the mutable QC substitution table.");
    },
  });
  const response = await send(api.baseUrl, `/api/v2/qc/runs/${RUN_ID}/operational-status`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.substitutions[0].id, receiptSubstitution.id);
  assert.equal(body.substitutions[0].sourceItems[0].productName, "Flour");
  assert.equal(body.allergenFootprint.status, "complete");
  assert.deepEqual(body.allergenFootprint.allergens, []);
  assert.equal(api.calls.length, 1);
});

test("reviewed-empty means none of the nine while unreviewed facts remain unknown", async (t) => {
  async function getFootprint(run) {
    const api = await withApi(t, {
      query: async (queryConfig) => {
        if (queryConfig.text.includes("v2.get_run")) return { rows: [{ result: run }] };
        if (queryConfig.text.includes("v2.list_qc_events")) return { rows: [{ result: [] }] };
        if (queryConfig.text.includes("v2.list_qc_settings")) return { rows: [{ result: [] }] };
        if (queryConfig.text.includes("v2.list_qc_run_substitutions")) return { rows: [{ result: [] }] };
        if (queryConfig.text.includes("v2.list_qc_component_products")) {
          return { rows: [{ result: { products: [], productsTruncated: false } }] };
        }
        if (queryConfig.text.includes("v2.get_qc_review_state")) {
          return { rows: [{ result: { status: "needs-review", signedOffAt: null, signedOffBy: null } }] };
        }
        throw new Error("unexpected query");
      },
    });
    const response = await send(api.baseUrl, `/api/v2/qc/runs/${RUN_ID}`);
    assert.equal(response.status, 200);
    return (await response.json()).allergenFootprint;
  }
  const reviewedEmpty = structuredClone(RUN);
  reviewedEmpty.setupSnapshot.productionPlan.recipes[0].ingredients[0].ingredientSnapshot = {
    status: "linked",
    ingredientCode: "EMPTY-BASE",
    ingredientName: "Reviewed empty base",
    allergens: [],
    allergensReviewed: true,
    linkEventId: "10000000-0000-4000-8000-000000000006",
    ingredientUpdatedAt: "2026-11-18T10:00:00.000Z",
  };
  const emptyFootprint = await getFootprint(reviewedEmpty);
  assert.equal(emptyFootprint.status, "complete");
  assert.deepEqual(emptyFootprint.allergens, []);
  assert.deepEqual(emptyFootprint.unknownIngredients, []);

  const unreviewed = structuredClone(reviewedEmpty);
  unreviewed.setupSnapshot.productionPlan.recipes[0].ingredients[0].ingredientSnapshot.allergensReviewed = false;
  const unknownFootprint = await getFootprint(unreviewed);
  assert.equal(unknownFootprint.status, "unknown");
  assert.deepEqual(unknownFootprint.allergens, []);
  assert.equal(unknownFootprint.unknownIngredients[0].reason, "allergen-facts-unreviewed");
});

test("allergen review uses only frozen reviewed facts and never accepts client claims", async (t) => {
  const linkedRun = structuredClone(RUN);
  linkedRun.setupSnapshot.productionPlan.recipes[0].ingredients[0].ingredientSnapshot = {
    status: "linked",
    ingredientCode: "MILK-BASE",
    ingredientName: "Milk base",
    allergens: ["milk"],
    allergensReviewed: true,
    linkEventId: "10000000-0000-4000-8000-000000000006",
    ingredientUpdatedAt: "2026-11-18T10:00:00.000Z",
  };
  const api = await withApi(t, {
    query: async (queryConfig) => {
      if (queryConfig.text.includes("v2.get_run")) return { rows: [{ result: linkedRun }] };
      if (queryConfig.text.includes("v2.list_qc_run_substitutions")) return { rows: [{ result: [] }] };
      if (queryConfig.text.includes("v2.record_qc_event")) {
        return { rows: [{ result: { replayed: false, event: { id: "allergen-event" } } }] };
      }
      throw new Error("unexpected query");
    },
  });
  const rejectedClaim = await send(api.baseUrl, `/api/v2/qc/runs/${RUN_ID}/events`, {
    method: "POST",
    body: {
      requestId: "invented-footprint",
      eventType: "run-check-reviewed",
      checkType: "allergen-footprint",
      allergens: [],
    },
  });
  assert.equal(rejectedClaim.status, 400);

  const saved = await send(api.baseUrl, `/api/v2/qc/runs/${RUN_ID}/events`, {
    method: "POST",
    body: {
      requestId: "review-footprint",
      eventType: "run-check-reviewed",
      checkType: "allergen-footprint",
    },
  });
  assert.equal(saved.status, 201);
  const payload = JSON.parse(api.calls.find((call) => call.text.includes("v2.record_qc_event")).values[6]);
  assert.deepEqual(payload.allergens, ["milk"]);
  assert.equal(payload.result, "reviewed");
  assert.equal(payload.unknownCount, 0);
  assert.equal(payload.clearance, undefined);
});

test("literal date-code observations preserve exact text and stay not evaluated", async (t) => {
  const api = await withApi(t, {
    query: async (queryConfig) => {
      if (queryConfig.text.includes("v2.get_run")) return { rows: [{ result: RUN }] };
      if (queryConfig.text.includes("v2.record_qc_event")) return { rows: [{ result: { replayed: false, event: { id: "date-event" } } }] };
      throw new Error("unexpected query");
    },
  });
  const response = await send(api.baseUrl, `/api/v2/qc/runs/${RUN_ID}/events`, {
    method: "POST",
    body: { requestId: "literal-code", eventType: "date-code-observed", observedText: " LOT 2026 " },
  });
  assert.equal(response.status, 201);
  const write = api.calls.find((call) => call.text.includes("v2.record_qc_event"));
  const payload = JSON.parse(write.values[6]);
  assert.equal(payload.observedText, " LOT 2026 ");
  assert.equal(payload.result, "not_evaluated");
});

test("QC temperature and elapsed-time checkpoints stay observation-only and use run stations", async (t) => {
  const completedRun = { ...structuredClone(RUN), status: "completed" };
  const api = await withApi(t, {
    query: async (queryConfig) => {
      if (queryConfig.text.includes("v2.get_run")) return { rows: [{ result: completedRun }] };
      if (queryConfig.text.includes("v2.record_qc_event")) {
        return { rows: [{ result: { replayed: false, event: { id: "checkpoint-event" } } }] };
      }
      throw new Error("unexpected query");
    },
  });
  const response = await send(api.baseUrl, `/api/v2/qc/runs/${RUN_ID}/events`, {
    method: "POST",
    body: {
      requestId: "temp-observation",
      eventType: "checkpoint-observed",
      checkpointType: "temperature",
      stationKey: "dough",
      checkpointLabel: "Mixer display",
      observedValue: "-2.5",
      unit: "°C",
      note: "",
    },
  });
  assert.equal(response.status, 201);
  const write = api.calls.find((call) => call.text.includes("v2.record_qc_event"));
  const payload = JSON.parse(write.values[6]);
  assert.deepEqual(payload, {
    checkpointType: "temperature",
    stationKey: "dough",
    checkpointLabel: "Mixer display",
    observedValue: "-2.5",
    unit: "°C",
    evaluationStatus: "not_evaluated",
  });
  assert.equal(write.values[2], RUN_ID);
  assert.equal(payload.result, undefined);
  assert.equal(payload.target, undefined);

  const elapsedApi = await withApi(t, {
    query: async (queryConfig) => {
      if (queryConfig.text.includes("v2.get_run")) return { rows: [{ result: RUN }] };
      if (queryConfig.text.includes("v2.record_qc_event")) return { rows: [{ result: { replayed: false } }] };
      throw new Error("unexpected query");
    },
  });
  const elapsed = await send(elapsedApi.baseUrl, `/api/v2/qc/runs/${RUN_ID}/events`, {
    method: "POST",
    body: {
      requestId: "time-observation",
      eventType: "checkpoint-observed",
      checkpointType: "time",
      stationKey: "dough",
      checkpointLabel: "Observed duration",
      observedValue: "3.5",
      unit: "min",
      note: "",
    },
  });
  assert.equal(elapsed.status, 201);
});

test("QC checkpoint API rejects unsupported stations, units, evaluations, and negative elapsed time", async (t) => {
  const api = await withApi(t, {
    query: async (queryConfig) => {
      if (queryConfig.text.includes("v2.get_run")) return { rows: [{ result: RUN }] };
      throw new Error("invalid checkpoint reached the write command");
    },
  });
  const invalid = [
    {
      requestId: "unknown-station",
      eventType: "checkpoint-observed",
      checkpointType: "temperature",
      stationKey: "warehouse",
      checkpointLabel: "Display",
      observedValue: "4",
      unit: "°C",
      note: "",
    },
    {
      requestId: "invalid-unit",
      eventType: "checkpoint-observed",
      checkpointType: "temperature",
      stationKey: "dough",
      checkpointLabel: "Display",
      observedValue: "4",
      unit: "degrees",
      note: "",
    },
    {
      requestId: "negative-duration",
      eventType: "checkpoint-observed",
      checkpointType: "time",
      stationKey: "dough",
      checkpointLabel: "Observed duration",
      observedValue: "-1",
      unit: "min",
      note: "",
    },
    {
      requestId: "forged-result",
      eventType: "checkpoint-observed",
      checkpointType: "temperature",
      stationKey: "dough",
      checkpointLabel: "Display",
      observedValue: "4",
      unit: "°C",
      note: "",
      result: "pass",
    },
  ];
  for (const body of invalid) {
    const response = await send(api.baseUrl, `/api/v2/qc/runs/${RUN_ID}/events`, {
      method: "POST",
      body,
    });
    assert.equal(response.status, 400);
  }
  assert.equal(api.calls.filter((call) => call.text.includes("v2.record_qc_event")).length, 0);
});

test("QC corrective actions and run or lot review flags use linked append-only evidence", async (t) => {
  const api = await withApi(t, {
    query: async (queryConfig) => {
      if (queryConfig.text.includes("v2.get_run")) return { rows: [{ result: RUN }] };
      if (queryConfig.text.includes("v2.record_qc_event")) {
        return { rows: [{ result: { replayed: false, event: { id: "review-event" } } }] };
      }
      throw new Error("unexpected query");
    },
  });
  const checkpointId = "10000000-0000-4000-8000-000000000008";
  const action = await send(api.baseUrl, `/api/v2/qc/runs/${RUN_ID}/events`, {
    method: "POST",
    body: {
      requestId: "action-observed",
      eventType: "corrective-action-observed",
      targetEventId: checkpointId,
      actionObserved: "Adjusted the observed setting",
      followUpNote: "",
    },
  });
  assert.equal(action.status, 201);
  let write = api.calls.filter((call) => call.text.includes("v2.record_qc_event")).at(-1);
  assert.equal(write.values[5], "corrective-action-observed");
  assert.deepEqual(JSON.parse(write.values[6]), {
    targetEventId: checkpointId,
    actionObserved: "Adjusted the observed setting",
  });

  const runFlag = await send(api.baseUrl, `/api/v2/qc/runs/${RUN_ID}/events`, {
    method: "POST",
    body: {
      requestId: "run-needs-review",
      eventType: "review-flag-raised",
      targetType: "run",
      reason: "Run details need review",
    },
  });
  assert.equal(runFlag.status, 201);
  write = api.calls.filter((call) => call.text.includes("v2.record_qc_event")).at(-1);
  assert.deepEqual(JSON.parse(write.values[6]), {
    targetType: "run",
    reason: "Run details need review",
  });

  const lotFlag = await send(api.baseUrl, `/api/v2/qc/runs/${RUN_ID}/events`, {
    method: "POST",
    body: {
      requestId: "lot-needs-review",
      eventType: "review-flag-raised",
      targetType: "lot",
      targetEventId: checkpointId,
      reason: "Lot record needs review",
    },
  });
  assert.equal(lotFlag.status, 201);
  write = api.calls.filter((call) => call.text.includes("v2.record_qc_event")).at(-1);
  assert.deepEqual(JSON.parse(write.values[6]), {
    targetType: "lot",
    targetEventId: checkpointId,
    reason: "Lot record needs review",
  });
});

test("QC review flag decisions are manager-only at the API boundary", async (t) => {
  const operator = await withApi(t);
  const denied = await send(operator.baseUrl, `/api/v2/qc/runs/${RUN_ID}/events`, {
    method: "POST",
    body: {
      requestId: "operator-resolve-flag",
      eventType: "review-flag-reviewed",
      targetEventId: "10000000-0000-4000-8000-000000000009",
      reviewNote: "Reviewed the evidence",
    },
  });
  assert.equal(denied.status, 403);
  assert.equal(operator.calls.length, 0);

  const manager = await withApi(t, {
    auth: MANAGER,
    query: async (queryConfig) => {
      if (queryConfig.text.includes("v2.get_run")) return { rows: [{ result: RUN }] };
      if (queryConfig.text.includes("v2.record_qc_event")) {
        return { rows: [{ result: { replayed: false, event: { id: "manager-review" } } }] };
      }
      throw new Error("unexpected query");
    },
  });
  const reviewed = await send(manager.baseUrl, `/api/v2/qc/runs/${RUN_ID}/events`, {
    method: "POST",
    body: {
      requestId: "manager-review-flag",
      eventType: "review-flag-reviewed",
      targetEventId: "10000000-0000-4000-8000-000000000009",
      reviewNote: "Reviewed the evidence",
    },
  });
  assert.equal(reviewed.status, 201);
  const write = manager.calls.find((call) => call.text.includes("v2.record_qc_event"));
  assert.equal(write.values[5], "review-flag-reviewed");
});

test("QC target settings and full-history export are manager-only", async (t) => {
  const operator = await withApi(t);
  const denied = await send(operator.baseUrl, "/api/v2/qc/settings", {
    method: "POST",
    body: {
      requestId: "setting-operator",
      settingType: "brix",
      subjectCode: "PIZZA",
      stationKey: null,
      target: "4.5",
      tolerance: "0.2",
      unit: "°Bx",
      sourceReference: "Approved review",
    },
  });
  assert.equal(denied.status, 403);
  assert.equal(operator.calls.length, 0);
  const exportDenied = await send(operator.baseUrl, "/api/v2/qc/export.csv");
  assert.equal(exportDenied.status, 403);
  assert.equal(operator.calls.length, 0);

  const manager = await withApi(t, {
    auth: MANAGER,
    query: async (queryConfig) => {
      if (queryConfig.text.includes("v2.record_qc_event")) {
        return { rows: [{ result: { replayed: false, event: { id: "setting-event" } } }] };
      }
      if (queryConfig.text.includes("v2.list_qc_events")) return { rows: [{ result: [] }] };
      throw new Error("unexpected query");
    },
  });
  const saved = await send(manager.baseUrl, "/api/v2/qc/settings", {
    method: "POST",
    body: {
      requestId: "setting-manager",
      settingType: "brix",
      subjectCode: "PIZZA",
      stationKey: null,
      target: "4.5",
      tolerance: "0.2",
      unit: "°Bx",
      sourceReference: "Approved review",
    },
  });
  assert.equal(saved.status, 201);
  const savedCall = manager.calls.find((call) => call.text.includes("v2.record_qc_event"));
  assert.equal(JSON.parse(savedCall.values[6]).tolerance, "0.2");

  const exported = await send(manager.baseUrl, "/api/v2/qc/export.csv");
  assert.equal(exported.status, 200);
  assert.match(exported.headers.get("content-type"), /text\/csv/);
  assert.match(await exported.text(), /"event_id","run_id","actor_id"/);

  const scopedExport = await send(manager.baseUrl, `/api/v2/qc/export.csv?runId=${RUN_ID}`);
  assert.equal(scopedExport.status, 200);
  const exportCall = manager.calls.filter((call) => call.text.includes("v2.list_qc_events")).at(-1);
  assert.equal(exportCall.values[2], RUN_ID);
});

test("manager settings redaction appends a facility-scoped audit event", async (t) => {
  const manager = await withApi(t, {
    auth: MANAGER,
    query: async (queryConfig) => {
      if (queryConfig.text.includes("v2.record_qc_event")) {
        return { rows: [{ result: { replayed: false, event: { id: "redaction-event" } } }] };
      }
      throw new Error("unexpected query");
    },
  });
  const response = await send(manager.baseUrl, "/api/v2/qc/settings/redactions", {
    method: "POST",
    body: {
      requestId: "redact-qc-setting",
      eventType: "redaction",
      targetEventId: "10000000-0000-4000-8000-000000000009",
      reason: "Source review withdrawn",
    },
  });
  assert.equal(response.status, 201);
  const write = manager.calls.find((call) => call.text.includes("v2.record_qc_event"));
  assert.equal(write.values[2], null);
  assert.equal(write.values[5], "redaction");
  assert.equal(JSON.parse(write.values[6]).targetEventId, "10000000-0000-4000-8000-000000000009");
});

test("QC failures return safe JSON and bounded history rejects oversized limits", async (t) => {
  const api = await withApi(t, {
    query: async () => {
      throw Object.assign(new Error("database detail"), { code: "XX000" });
    },
  });
  const failed = await send(api.baseUrl, "/api/v2/qc/history");
  assert.equal(failed.status, 500);
  assert.deepEqual(await failed.json(), { error: "The QC request could not be completed. Refresh and try again." });
  const tooLarge = await send(api.baseUrl, "/api/v2/qc/history?limit=101");
  assert.equal(tooLarge.status, 400);
});
