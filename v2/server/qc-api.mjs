import { createHash } from "node:crypto";

const QC_PATH = "/api/v2/qc";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const CODE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const TRACKED_ALLERGENS = ["egg", "soy", "milk", "wheat", "peanuts", "tree nuts", "fish", "shellfish", "sesame"];
const NUMBER = /^(?:0|[1-9][0-9]{0,8})(?:\.[0-9]{1,6})?$/;
const POSITIVE = /^(?:0|[1-9][0-9]{0,8})(?:\.[0-9]{1,6})?$/;
const SIGNED_NUMBER = /^-?(?:0|[1-9][0-9]{0,8})(?:\.[0-9]{1,6})?$/;
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_EXPORT_ROWS = 10_000;
const STATIONS = new Set(["dough", "cheese", "pepperoni", "sauce", "frontline"]);
const INGREDIENT_LINKS_PATH = `${QC_PATH}/ingredient-links`;

class QcApiError extends Error {
  constructor(status, message, retryAfterSeconds) {
    super(message);
    this.name = "QcApiError";
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function sendJson(response, status, body, headers = {}) {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  response.end(JSON.stringify(body));
}

async function readJsonBody(request) {
  const contentType = request.headers["content-type"];
  if (typeof contentType !== "string" || !/^application\/json(?:\s*;|$)/i.test(contentType)) {
    throw new QcApiError(415, "Send this request as JSON.");
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new QcApiError(413, "The request is too large.");
    chunks.push(chunk);
  }
  if (!size) throw new QcApiError(400, "A JSON request body is required.");
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new QcApiError(400, "The request body is not valid JSON.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new QcApiError(400, "The JSON request body must be an object.");
  }
  return body;
}

function requireKeys(body, expected) {
  const actual = Object.keys(body).sort();
  const allowed = [...expected].sort();
  if (actual.length !== allowed.length || actual.some((key, index) => key !== allowed[index])) {
    throw new QcApiError(400, "The request contains missing or unsupported fields.");
  }
}

function validateUuid(value, label) {
  if (typeof value !== "string" || !UUID.test(value)) throw new QcApiError(400, `${label} is invalid.`);
  return value.toLowerCase();
}

function decodePathUuid(value, label) {
  try {
    return validateUuid(decodeURIComponent(value), label);
  } catch (error) {
    if (error instanceof QcApiError) throw error;
    throw new QcApiError(400, `${label} is invalid.`);
  }
}

function validateRequestId(value) {
  if (typeof value !== "string" || !REQUEST_ID.test(value)) {
    throw new QcApiError(400, "Enter a valid request ID.");
  }
  return value;
}

function validateText(value, label, { min = 1, max = 300 } = {}) {
  if (typeof value !== "string" || value.trim().length < min || value.trim().length > max
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) {
    throw new QcApiError(400, `${label} must be ${min} to ${max} characters.`);
  }
  return value.trim();
}

function validateLiteralText(value, label, { min = 1, max = 300 } = {}) {
  if (typeof value !== "string" || value.trim().length < min || value.length > max
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) {
    throw new QcApiError(400, `${label} must be ${min} to ${max} characters.`);
  }
  return value;
}

function validateNumber(value, label, { positive = false } = {}) {
  if (typeof value !== "string" || !NUMBER.test(value)
    || (positive && Number(value) <= 0)) {
    throw new QcApiError(400, `${label} must be a ${positive ? "positive " : ""}number with up to six decimals.`);
  }
  return value;
}

function validateSignedNumber(value, label) {
  if (typeof value !== "string" || !SIGNED_NUMBER.test(value)) {
    throw new QcApiError(400, `${label} must be a number with up to six decimals.`);
  }
  return value;
}

function runHasStation(run, stationKey) {
  const recipes = run?.setupSnapshot?.productionPlan?.recipes;
  return Array.isArray(recipes) && recipes.some((recipe) => recipe?.stationKey === stationKey);
}

function hashRequest(value) {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function resultValue(result) {
  return result?.rows?.[0]?.result ?? null;
}

function safeStatus(error) {
  if (error instanceof QcApiError) return error.status;
  switch (error?.code) {
    case "P0002": return 404;
    case "42501": return 403;
    case "23505":
    case "40001":
    case "55000":
    case "22003": return 409;
    case "22023":
    case "23514": return 400;
    default: return 500;
  }
}

function safeMessage(error) {
  if (error instanceof QcApiError) return error.message;
  switch (error?.code) {
    case "P0002": return "That run or QC record is not available.";
    case "42501": return "Your account does not have access to this QC action.";
    case "23505": return "That QC action was already recorded.";
    case "40001": return "The QC data changed. Refresh and try again.";
    case "55000": return "That QC action is no longer available.";
    case "22003": return "There is not enough available stock for that QC-approved substitution.";
    case "22023":
    case "23514": return "The QC request is invalid. Review the fields and try again.";
    default: return "The QC request could not be completed. Refresh and try again.";
  }
}

function createRateLimiter({ maxRequests = 60, windowMs = 60_000, maxKeys = 10_000, clock = Date.now } = {}) {
  const entries = new Map();
  return {
    consume(key) {
      const now = clock();
      for (const [existingKey, entry] of entries) {
        if (entry.resetAt <= now) entries.delete(existingKey);
      }
      let entry = entries.get(key);
      if (!entry || entry.resetAt <= now) {
        entry = { count: 0, resetAt: now + windowMs };
        entries.delete(key);
        entries.set(key, entry);
      }
      if (entries.size > maxKeys) entries.delete(entries.keys().next().value);
      if (entry.count >= maxRequests) {
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) };
      }
      entry.count += 1;
      return { allowed: true };
    },
  };
}

function requireQcAccess(auth, capability) {
  if (auth?.verified !== true) throw new QcApiError(401, "Sign in to access QC.");
  if (!Array.isArray(auth.capabilities)) {
    throw new QcApiError(403, "A QC role is required for this action.");
  }
  const hasQcAccess = auth.capabilities.includes("record-qc") || auth.capabilities.includes("manage-qc");
  const hasRequestedCapability = capability && auth.capabilities.includes(capability);
  if (!hasQcAccess && !hasRequestedCapability) {
    throw new QcApiError(403, "A QC role is required for this action.");
  }
  if (capability && !auth.capabilities.includes(capability)) {
    throw new QcApiError(403, "A QC manager must approve this action.");
  }
  if (!UUID.test(auth.actorId || "") || !UUID.test(auth.facilityId || "")) {
    throw new QcApiError(401, "Refresh your V2 session before continuing.");
  }
}

function requireOperationalEvidenceAccess(auth) {
  if (auth?.verified !== true) throw new QcApiError(401, "Sign in to access run details.");
  if (!Array.isArray(auth.capabilities)
    || !auth.capabilities.some((capability) =>
      ["run.read", "record-qc", "manage-qc"].includes(capability))) {
    throw new QcApiError(403, "Run read access is required for substitution status.");
  }
  if (!UUID.test(auth.actorId || "") || !UUID.test(auth.facilityId || "")) {
    throw new QcApiError(401, "Refresh your V2 session before continuing.");
  }
}

function parseLimit(url, maximum = 100) {
  for (const key of url.searchParams.keys()) {
    if (key !== "limit") throw new QcApiError(400, "Unsupported QC history query parameter.");
  }
  const values = url.searchParams.getAll("limit");
  if (values.length > 1) throw new QcApiError(400, "Specify QC history limit once.");
  if (values.length === 0) return Math.min(50, maximum);
  if (!/^[1-9][0-9]*$/u.test(values[0]) || Number(values[0]) > maximum) {
    throw new QcApiError(400, `limit must be from 1 to ${maximum}.`);
  }
  return Number(values[0]);
}

function parseExportRunId(url) {
  for (const key of url.searchParams.keys()) {
    if (key !== "runId") throw new QcApiError(400, "Unsupported QC export query parameter.");
  }
  const values = url.searchParams.getAll("runId");
  if (values.length > 1) throw new QcApiError(400, "Specify one run ID.");
  return values.length ? validateUuid(values[0], "Run ID") : null;
}

function flattenRunItems(run) {
  const plan = run?.setupSnapshot?.productionPlan;
  if (!plan || !Array.isArray(plan.recipes)) return [];
  const lines = [];
  for (const recipe of plan.recipes) {
    if (!recipe || !STATIONS.has(recipe.stationKey) || !Array.isArray(recipe.ingredients)) continue;
    for (const item of recipe.ingredients) {
      if (!item || !UUID.test(item.productId || "") || !CODE.test(item.productCode || "")
        || typeof item.productName !== "string" || item.productName.length < 1 || item.productName.length > 120
        || typeof item.unit !== "string" || !/^[A-Za-z][A-Za-z0-9._/-]{0,15}$/u.test(item.unit)) continue;
      lines.push({
        productId: item.productId.toLowerCase(),
        productCode: item.productCode,
        productName: item.productName,
        recipeCode: recipe.code,
        recipeName: typeof recipe.name === "string" ? recipe.name : recipe.code,
        unit: item.unit,
        stationKey: recipe.stationKey,
        ingredientSnapshot: item.ingredientSnapshot ?? null,
      });
    }
  }
  return lines;
}

function deriveAllergenFootprint(run, items = flattenRunItems(run), substitutions = []) {
  let effectiveItems = [...items];
  let substitutionQuantityPending = false;
  if (run?.status === "completed" && run.inventoryConsumption) {
    const consumedComponents = new Set(
      (run.inventoryConsumption.componentDemand ?? [])
        .filter((line) => Number(line.remainingQuantity) > 0)
        .map((line) => `${String(line.productId).toLowerCase()}:${line.stationKey}:${line.recipeCode}`),
    );
    effectiveItems = items.filter((item) => consumedComponents.has(
      `${item.productId}:${item.stationKey}:${item.recipeCode}`,
    ));
    for (const substitution of run.inventoryConsumption.qcSubstitutions ?? []) {
      const snapshot = substitution.replacementIngredientSnapshot ?? null;
      effectiveItems.push({
        productId: substitution.replacementProductId,
        productCode: substitution.replacementProductCode,
        productName: substitution.replacementProductName,
        stationKey: substitution.sourceItems?.[0]?.stationKey ?? "substitution",
        unit: substitution.replacementUnit,
        ingredientSnapshot: snapshot,
      });
    }
  } else if (substitutions.length) {
    substitutionQuantityPending = true;
    for (const substitution of substitutions) {
      effectiveItems.push({
        productId: substitution.replacementProductId,
        productCode: substitution.replacementProductCode,
        productName: substitution.replacementProductName,
        stationKey: substitution.sourceItems?.[0]?.stationKey ?? "substitution",
        unit: substitution.replacementUnit,
        ingredientSnapshot: substitution.replacementIngredientSnapshot ?? null,
      });
    }
  }
  effectiveItems = [...new Map(effectiveItems.map((item) => [
    `${item.productId}:${item.stationKey}`,
    item,
  ])).values()];
  const allergens = new Set();
  const unknownIngredients = [];
  for (const item of effectiveItems) {
    const snapshot = item.ingredientSnapshot;
    const validFacts = snapshot?.status === "linked"
      && snapshot.allergensReviewed === true
      && Array.isArray(snapshot.allergens)
      && snapshot.allergens.every((allergen) => TRACKED_ALLERGENS.includes(allergen));
    if (!validFacts) {
      unknownIngredients.push({
        productId: item.productId,
        productCode: item.productCode,
        productName: item.productName,
        stationKey: item.stationKey,
        reason: snapshot?.status === "unknown"
          ? snapshot.reason
          : (snapshot?.allergensReviewed === false ? "allergen-facts-unreviewed" : "invalid-allergen-facts"),
      });
      continue;
    }
    for (const allergen of snapshot.allergens) allergens.add(allergen);
  }
  if (substitutionQuantityPending) {
    unknownIngredients.push({
      productId: null,
      productCode: null,
      productName: "Approved substitution",
      stationKey: "run",
      reason: "substitution-remaining-quantity-not-final",
    });
  }
  return {
    status: unknownIngredients.length === 0 && effectiveItems.length > 0 ? "complete" : "unknown",
    allergens: TRACKED_ALLERGENS.filter((allergen) => allergens.has(allergen)),
    ingredientCount: effectiveItems.length,
    unknownIngredients,
  };
}

function validateSubstitutionSources(value, run) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) {
    throw new QcApiError(400, "Add one to twenty source components.");
  }
  const seen = new Set();
  return value.map((source) => {
    if (!source || typeof source !== "object" || Array.isArray(source)) {
      throw new QcApiError(400, "A source component is invalid.");
    }
    requireKeys(source, ["productId", "recipeCode", "stationKey", "quantity", "unit"]);
    const productId = validateUuid(source.productId, "Source product");
    const recipeCode = validateText(source.recipeCode, "Recipe code", { max: 80 });
    if (!CODE.test(recipeCode) || !STATIONS.has(source.stationKey)) {
      throw new QcApiError(400, "Choose a recipe and production station from this run.");
    }
    const line = flattenRunItems(run).find((item) =>
      item.productId === productId
      && item.recipeCode.toLocaleLowerCase("en-US") === recipeCode.toLocaleLowerCase("en-US")
      && item.stationKey === source.stationKey);
    if (!line) throw new QcApiError(400, "Choose each source component from this run’s saved setup.");
    const quantity = validateNumber(source.quantity, "Source quantity", { positive: true });
    const unit = validateText(source.unit, "Source unit", { max: 16 });
    if (unit !== line.unit) throw new QcApiError(400, "Use the source component’s exact run unit.");
    const key = `${line.recipeCode.toLocaleLowerCase("en-US")}:${line.stationKey}:${line.productId}`;
    if (seen.has(key)) throw new QcApiError(400, "Each source component can appear only once.");
    seen.add(key);
    return { productId, recipeCode: line.recipeCode, stationKey: line.stationKey, quantity, unit };
  });
}

function componentChecklist(run, items, substitutions) {
  let candidates = items.map((item) => ({ ...item, substitution: false }));
  let effectiveSubstitutions = substitutions;
  if (run?.status === "completed" && run.inventoryConsumption) {
    const consumedComponents = new Set(
      (run.inventoryConsumption.componentDemand ?? [])
        .filter((line) => Number(line.remainingQuantity) > 0)
        .map((line) => `${String(line.productId).toLowerCase()}:${line.stationKey}:${line.recipeCode}`),
    );
    candidates = candidates.filter((item) => consumedComponents.has(
      `${item.productId}:${item.stationKey}:${item.recipeCode}`,
    ));
    effectiveSubstitutions = run.inventoryConsumption.qcSubstitutions ?? [];
  }
  for (const substitution of effectiveSubstitutions) {
    const sources = Array.isArray(substitution.sourceItems) ? substitution.sourceItems : [];
    candidates.push({
      productId: substitution.replacementProductId,
      productCode: substitution.replacementProductCode,
      productName: substitution.replacementProductName,
      recipeCode: "QC-SUBSTITUTION",
      recipeName: "Approved substitution",
      stationKey: sources[0]?.stationKey ?? "sauce",
      unit: substitution.replacementUnit,
      ingredientSnapshot: substitution.replacementIngredientSnapshot ?? null,
      substitution: true,
    });
  }
  return [...new Map(candidates.map((item) => [
    `${item.productId}:${item.stationKey}:${item.recipeCode}`,
    item,
  ])).values()];
}

function deriveStationEvidence(run, items, substitutions) {
  return Object.fromEntries([...STATIONS].map((stationKey) => {
    const stationItems = items.filter((item) => item.stationKey === stationKey);
    const stationSubstitutions = substitutions.filter((substitution) =>
      (substitution.sourceItems ?? []).some((source) => source.stationKey === stationKey));
    const stationFootprintSubstitutions = stationSubstitutions.map((substitution) => ({
      ...substitution,
      sourceItems: substitution.sourceItems.filter((source) => source.stationKey === stationKey),
    }));
    const stationRun = run?.status === "completed" && run.inventoryConsumption
      ? {
        ...run,
        inventoryConsumption: {
          ...run.inventoryConsumption,
          qcSubstitutions: stationFootprintSubstitutions,
        },
      }
      : run;
    return [stationKey, {
      substitutions: stationSubstitutions,
      allergenFootprint: deriveAllergenFootprint(
        stationRun,
        stationItems,
        stationFootprintSubstitutions,
      ),
    }];
  }));
}

function enrichOperationalSubstitutions(substitutions, items, consumption) {
  const consumedItems = Array.isArray(consumption?.componentDemand)
    ? consumption.componentDemand
    : [];
  return substitutions.map((substitution) => ({
    ...substitution,
    sourceItems: (Array.isArray(substitution.sourceItems) ? substitution.sourceItems : []).map((source) => {
      const item = items.find((candidate) =>
        candidate.productId === String(source.productId).toLowerCase()
        && candidate.stationKey === source.stationKey
        && candidate.recipeCode === source.recipeCode);
      const consumed = consumedItems.find((candidate) =>
        String(candidate.productId).toLowerCase() === String(source.productId).toLowerCase()
        && candidate.stationKey === source.stationKey
        && candidate.recipeCode === source.recipeCode);
      return {
        ...source,
        productCode: source.productCode ?? item?.productCode ?? consumed?.productCode,
        productName: source.productName ?? item?.productName ?? consumed?.productName,
        recipeName: source.recipeName ?? item?.recipeName ?? consumed?.recipeName,
      };
    }),
  }));
}

function findRunItem(run, input) {
  const productId = validateUuid(input.productId, "Ingredient");
  const stationKey = typeof input.stationKey === "string" ? input.stationKey : "";
  const recipeCode = typeof input.recipeCode === "string" ? input.recipeCode : "";
  const line = flattenRunItems(run).find((item) => item.productId === productId
    && item.stationKey === stationKey && (!recipeCode || item.recipeCode === recipeCode));
  if (!line) {
    throw new QcApiError(400, "Choose an ingredient and station from this run’s saved setup.");
  }
  return line;
}

function fixedScale(value, scale = 6) {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 10n ** BigInt(scale) + BigInt(fraction.padEnd(scale, "0"));
}

function weightSettingKey({ productCode, stationKey, unit }) {
  return `weight:${productCode.toLocaleLowerCase("en-US")}:${stationKey}:${unit}`;
}

function brixSettingKey(productCode) {
  return `brix:${productCode.toLocaleLowerCase("en-US")}`;
}

function buildCsv(events) {
  const headers = ["event_id", "run_id", "actor_id", "event_type", "occurred_at", "payload_json"];
  const csvCell = (value) => {
    let text = value === null || value === undefined ? "" : String(value);
    if (/^[\t\r ]*[=+\-@]/u.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return [
    headers.map(csvCell).join(","),
    ...events.map((event) => [
      event.id,
      event.runId,
      event.actorId,
      event.eventType,
      event.occurredAt,
      JSON.stringify(event.payload),
    ].map(csvCell).join(",")),
  ].join("\r\n");
}

export function createQcApi({ pool, authenticate, verifyCsrf, logger = () => {} } = {}) {
  if (!pool || typeof pool.query !== "function") throw new TypeError("A V2 PostgreSQL pool is required.");
  if (typeof authenticate !== "function") throw new TypeError("A V2 session verifier is required.");
  if (typeof verifyCsrf !== "function") throw new TypeError("A V2 CSRF verifier is required.");
  if (typeof logger !== "function") throw new TypeError("A structured logger is required.");
  const limiter = createRateLimiter();

  async function loadRun(facilityId, runId) {
    const result = await pool.query({
      text: "SELECT v2.get_run($1::uuid, $2::uuid) AS result",
      values: [facilityId, runId],
      query_timeout: 3000,
    });
    const run = resultValue(result);
    if (!run || run.id !== runId) throw new QcApiError(404, "That run is not available for QC.");
    return run;
  }

  async function listEvents(auth, runId, limit) {
    const result = await pool.query({
      text: "SELECT v2.list_qc_events($1::uuid, $2::uuid, $3::uuid, $4::integer) AS result",
      values: [auth.facilityId.toLowerCase(), auth.actorId.toLowerCase(), runId, limit],
      query_timeout: 3000,
    });
    const events = resultValue(result);
    if (!Array.isArray(events)) throw new QcApiError(502, "QC history is temporarily unavailable.");
    return events;
  }

  async function listSettings(auth) {
    const result = await pool.query({
      text: "SELECT v2.list_qc_settings($1::uuid, $2::uuid) AS result",
      values: [auth.facilityId.toLowerCase(), auth.actorId.toLowerCase()],
      query_timeout: 3000,
    });
    const settings = resultValue(result);
    if (!Array.isArray(settings)) throw new QcApiError(502, "QC settings are temporarily unavailable.");
    return settings;
  }

  async function listIngredientLinks(auth) {
    const result = await pool.query({
      text: "SELECT v2.list_qc_ingredient_links($1::uuid, $2::uuid) AS result",
      values: [auth.facilityId.toLowerCase(), auth.actorId.toLowerCase()],
      query_timeout: 3000,
    });
    const links = resultValue(result);
    if (!links || !Array.isArray(links.products) || !Array.isArray(links.ingredients) || !Array.isArray(links.events)) {
      throw new QcApiError(502, "Ingredient-link records are temporarily unavailable.");
    }
    return links;
  }

  async function listComponentProducts(auth) {
    const result = await pool.query({
      text: "SELECT v2.list_qc_component_products($1::uuid, $2::uuid) AS result",
      values: [auth.facilityId.toLowerCase(), auth.actorId.toLowerCase()],
      query_timeout: 3000,
    });
    const products = resultValue(result);
    if (!products || !Array.isArray(products.products)) {
      throw new QcApiError(502, "QC component identities are temporarily unavailable.");
    }
    return products;
  }

  async function listSubstitutions(auth, runId) {
    const result = await pool.query({
      text: "SELECT v2.list_qc_run_substitutions($1::uuid, $2::uuid, $3::uuid) AS result",
      values: [auth.facilityId.toLowerCase(), auth.actorId.toLowerCase(), runId],
      query_timeout: 3000,
    });
    const substitutions = resultValue(result);
    if (!Array.isArray(substitutions)) {
      throw new QcApiError(502, "QC substitution records are temporarily unavailable.");
    }
    return substitutions;
  }

  async function listOperationalSubstitutions(auth, runId) {
    const result = await pool.query({
      text: "SELECT v2.list_run_operational_substitutions($1::uuid, $2::uuid, $3::uuid) AS result",
      values: [auth.facilityId.toLowerCase(), auth.actorId.toLowerCase(), runId],
      query_timeout: 3000,
    });
    const substitutions = resultValue(result);
    if (!Array.isArray(substitutions)) {
      throw new QcApiError(502, "Run substitution status is temporarily unavailable.");
    }
    return substitutions;
  }

  async function recordSubstitution(auth, runId, requestId, action, proposalEventId, targetSubstitutionId, details) {
    const requestHash = hashRequest({
      runId, action, proposalEventId, targetSubstitutionId, details,
    });
    const result = await pool.query({
      text: `SELECT v2.record_qc_substitution(
        $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text,
        $7::uuid, $8::uuid, $9::jsonb
      ) AS result`,
      values: [
        auth.facilityId.toLowerCase(),
        auth.actorId.toLowerCase(),
        runId,
        requestId,
        requestHash,
        action,
        proposalEventId,
        targetSubstitutionId,
        JSON.stringify(details),
      ],
      query_timeout: 3000,
    });
    return resultValue(result);
  }

  async function appendEvent(auth, runId, requestId, eventType, payload) {
    const requestHash = hashRequest({ runId, eventType, payload });
    const result = await pool.query({
      text: "SELECT v2.record_qc_event($1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text, $7::jsonb) AS result",
      values: [
        auth.facilityId.toLowerCase(),
        auth.actorId.toLowerCase(),
        runId,
        requestId,
        requestHash,
        eventType,
        JSON.stringify(payload),
      ],
      query_timeout: 3000,
    });
    return resultValue(result);
  }

  return async function handleQcApi(request, response) {
    let url;
    try {
      url = new URL(request.url || "/", "http://v2.local");
    } catch {
      sendJson(response, 400, { error: "The request URL is invalid." });
      return false;
    }
    if (url.pathname !== QC_PATH && !url.pathname.startsWith(`${QC_PATH}/`)) return false;

    let operation = "unknown";
    let actorId = null;
    try {
      const auth = await authenticate(request);
      const operationalStatusMatch = url.pathname.match(
        /^\/api\/v2\/qc\/runs\/([^/]+)\/operational-status$/,
      );
      if (operationalStatusMatch && request.method === "GET") {
        requireOperationalEvidenceAccess(auth);
      } else {
        requireQcAccess(auth, url.pathname === INGREDIENT_LINKS_PATH ? "manage-allergens" : undefined);
      }
      actorId = auth.actorId.toLowerCase();

      if (request.method !== "GET") {
        if (request.method !== "POST") throw new QcApiError(405, "This method is not allowed.");
        if (await verifyCsrf(request, auth) !== true) {
          throw new QcApiError(403, "Refresh your session before changing QC records.");
        }
        const rate = limiter.consume(actorId);
        if (!rate.allowed) throw new QcApiError(429, "Too many QC changes. Wait briefly, then try again.", rate.retryAfterSeconds);
      }

      const scope = auth.facilityId.toLowerCase();
      const actor = auth.actorId.toLowerCase();

      if (operationalStatusMatch && request.method === "GET") {
        operation = "get_run_operational_status";
        if (url.search) throw new QcApiError(400, "Run operational status does not accept query parameters.");
        const runId = decodePathUuid(operationalStatusMatch[1], "Run ID");
        const run = await loadRun(scope, runId);
        const items = flattenRunItems(run);
        const rawSubstitutions = run.status === "completed" && Array.isArray(run.inventoryConsumption?.qcSubstitutions)
          ? run.inventoryConsumption.qcSubstitutions
          : await listOperationalSubstitutions(auth, runId);
        const substitutions = enrichOperationalSubstitutions(
          rawSubstitutions,
          items,
          run.inventoryConsumption,
        );
        const allergenFootprint = deriveAllergenFootprint(run, items, substitutions);
        sendJson(response, 200, {
          runId,
          substitutions,
          allergenFootprint,
          stations: deriveStationEvidence(run, items, substitutions),
          limitations: {
            allergens: allergenFootprint.status === "unknown" ? "incomplete" : "available",
          },
        });
        return true;
      }

      if (url.pathname === INGREDIENT_LINKS_PATH && request.method === "GET") {
        operation = "list_ingredient_links";
        if (url.search) throw new QcApiError(400, "Ingredient links do not accept query parameters.");
        requireQcAccess(auth, "manage-allergens");
        sendJson(response, 200, await listIngredientLinks(auth));
        return true;
      }

      if (url.pathname === INGREDIENT_LINKS_PATH && request.method === "POST") {
        operation = "record_ingredient_link";
        requireQcAccess(auth, "manage-allergens");
        const body = await readJsonBody(request);
        requireKeys(body, ["requestId", "productId", "ingredientCode"]);
        const requestId = validateRequestId(body.requestId);
        const productId = validateUuid(body.productId, "Inventory product");
        let ingredientCode = null;
        if (body.ingredientCode !== null) {
          ingredientCode = validateText(body.ingredientCode, "Ingredient code", { max: 80 });
          if (!CODE.test(ingredientCode)) throw new QcApiError(400, "Ingredient code is invalid.");
        }
        const requestHash = hashRequest({ productId, ingredientCode });
        const result = await pool.query({
          text: "SELECT v2.record_qc_ingredient_link($1::uuid, $2::uuid, $3::text, $4::text, $5::uuid, $6::text) AS result",
          values: [scope, actor, requestId, requestHash, productId, ingredientCode],
          query_timeout: 3000,
        });
        const saved = resultValue(result);
        sendJson(response, saved?.replayed ? 200 : 201, saved);
        return true;
      }

      if (url.pathname === `${QC_PATH}/settings` && request.method === "GET") {
        operation = "list_settings";
        if (url.search) throw new QcApiError(400, "QC settings do not accept query parameters.");
        const settings = await listSettings(auth);
        sendJson(response, 200, { settings });
        return true;
      }

      if (url.pathname === `${QC_PATH}/settings` && request.method === "POST") {
        operation = "review_setting";
        requireQcAccess(auth, "manage-qc");
        const body = await readJsonBody(request);
        requireKeys(body, [
          "requestId", "settingType", "subjectCode", "stationKey", "target",
          "tolerance", "unit", "sourceReference",
        ]);
        const requestId = validateRequestId(body.requestId);
        if (!["weight-override", "brix"].includes(body.settingType)) {
          throw new QcApiError(400, "Choose a weight override or Brix target.");
        }
        const subjectCode = validateText(body.subjectCode, "Product code", { max: 80 });
        if (!CODE.test(subjectCode)) throw new QcApiError(400, "Product code is invalid.");
        const stationKey = body.stationKey;
        if (body.settingType === "weight-override" && !STATIONS.has(stationKey)) {
          throw new QcApiError(400, "Choose a production station.");
        }
        if (body.settingType === "brix" && stationKey !== null) {
          throw new QcApiError(400, "Brix settings do not use a station.");
        }
        const target = validateNumber(body.target, "Target", { positive: body.settingType === "weight-override" });
        const tolerance = body.settingType === "brix"
          ? validateNumber(body.tolerance, "Tolerance")
          : (body.tolerance === "" ? "0.1" : validateNumber(body.tolerance, "Tolerance"));
        const unit = body.settingType === "brix"
          ? "°Bx"
          : validateText(body.unit, "Target unit", { max: 16 });
        if (body.settingType === "brix" && Number(tolerance) <= 0) {
          throw new QcApiError(400, "Brix tolerance must be greater than zero.");
        }
        const sourceReference = validateText(body.sourceReference, "Source or approval reference", { min: 3, max: 300 });
        const settingKey = body.settingType === "brix"
          ? brixSettingKey(subjectCode)
          : weightSettingKey({ productCode: subjectCode, stationKey, unit });
        const payload = {
          settingKey,
          settingType: body.settingType,
          subjectCode,
          stationKey,
          target,
          tolerance,
          unit,
          sourceReference,
        };
        const saved = await appendEvent(auth, null, requestId, "qc-setting-reviewed", payload);
        sendJson(response, saved?.replayed ? 200 : 201, saved);
        return true;
      }

      if (url.pathname === `${QC_PATH}/settings/redactions` && request.method === "POST") {
        operation = "redact_setting";
        requireQcAccess(auth, "manage-qc");
        const body = await readJsonBody(request);
        requireKeys(body, ["requestId", "eventType", "targetEventId", "reason"]);
        if (body.eventType !== "redaction") throw new QcApiError(400, "Choose a settings redaction.");
        const saved = await appendEvent(auth, null, validateRequestId(body.requestId), "redaction", {
          targetEventId: validateUuid(body.targetEventId, "QC setting"),
          reason: validateText(body.reason, "Reason", { min: 3, max: 500 }),
        });
        sendJson(response, saved?.replayed ? 200 : 201, saved);
        return true;
      }

      if (url.pathname === `${QC_PATH}/history` && request.method === "GET") {
        operation = "list_history";
        const events = await listEvents(auth, null, parseLimit(url));
        sendJson(response, 200, { events });
        return true;
      }

      if (url.pathname === `${QC_PATH}/export.csv` && request.method === "GET") {
        operation = "export_history";
        requireQcAccess(auth, "manage-qc");
        const runId = parseExportRunId(url);
        const events = await listEvents(auth, runId, MAX_EXPORT_ROWS + 1);
        if (events.length > MAX_EXPORT_ROWS) {
          throw new QcApiError(409, "The history is larger than one export. Export one run at a time.");
        }
        response.writeHead(200, {
          "Cache-Control": "no-store",
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="v2-qc-history.csv"',
          "X-Content-Type-Options": "nosniff",
        });
        response.end(`\uFEFF${buildCsv(events)}`);
        return true;
      }

      const substitutionProposalMatch = url.pathname.match(/^\/api\/v2\/qc\/runs\/([^/]+)\/substitutions$/);
      if (substitutionProposalMatch && request.method === "POST") {
        operation = "propose_substitution";
        const runId = decodePathUuid(substitutionProposalMatch[1], "Run ID");
        const body = await readJsonBody(request);
        requireKeys(body, ["requestId", "sourceItems", "replacementProductId", "replacementQuantity", "replacementUnit", "reason"]);
        const runData = await loadRun(scope, runId);
        if (runData.status === "completed") {
          throw new QcApiError(409, "Completed runs cannot receive substitution changes.");
        }
        const sourceItems = validateSubstitutionSources(body.sourceItems, runData);
        const componentProducts = await listComponentProducts(auth);
        const replacementProductId = validateUuid(body.replacementProductId, "Replacement product");
        const replacement = componentProducts.products.find((product) =>
          product.productId.toLowerCase() === replacementProductId);
        if (!replacement) throw new QcApiError(400, "Choose an active replacement product.");
        const replacementQuantity = validateNumber(body.replacementQuantity, "Replacement quantity", { positive: true });
        const replacementUnit = validateText(body.replacementUnit, "Replacement unit", { max: 16 });
        if (replacementUnit !== replacement.unit) {
          throw new QcApiError(400, "Use the replacement product’s exact inventory unit.");
        }
        const details = {
          sourceItems,
          replacementProductId,
          replacementQuantity,
          replacementUnit,
          reason: validateText(body.reason, "Reason", { min: 3, max: 500 }),
        };
        const saved = await recordSubstitution(
          auth, runId, validateRequestId(body.requestId), "propose", null, null, details,
        );
        sendJson(response, saved?.replayed ? 200 : 201, saved);
        return true;
      }

      const substitutionDecisionMatch = url.pathname.match(
        /^\/api\/v2\/qc\/runs\/([^/]+)\/substitutions\/([^/]+)\/decision$/,
      );
      if (substitutionDecisionMatch && request.method === "POST") {
        operation = "decide_substitution";
        requireQcAccess(auth, "manage-qc");
        const runId = decodePathUuid(substitutionDecisionMatch[1], "Run ID");
        const proposalEventId = decodePathUuid(substitutionDecisionMatch[2], "Substitution proposal");
        const body = await readJsonBody(request);
        if (body.decision === "approve") {
          requireKeys(body, ["requestId", "decision"]);
        } else if (body.decision === "reject") {
          requireKeys(body, ["requestId", "decision", "reason"]);
        } else {
          throw new QcApiError(400, "Choose approve or reject.");
        }
        const runData = await loadRun(scope, runId);
        if (runData.status === "completed") {
          throw new QcApiError(409, "Completed runs cannot receive substitution changes.");
        }
        const details = body.decision === "reject"
          ? { reason: validateText(body.reason, "Rejection reason", { min: 3, max: 500 }) }
          : {};
        const saved = await recordSubstitution(
          auth, runId, validateRequestId(body.requestId), body.decision,
          proposalEventId, null, details,
        );
        sendJson(response, saved?.replayed ? 200 : 201, saved);
        return true;
      }

      const substitutionCorrectionMatch = url.pathname.match(
        /^\/api\/v2\/qc\/runs\/([^/]+)\/substitutions\/([^/]+)\/corrections$/,
      );
      if (substitutionCorrectionMatch && request.method === "POST") {
        operation = "correct_substitution";
        requireQcAccess(auth, "manage-qc");
        const runId = decodePathUuid(substitutionCorrectionMatch[1], "Run ID");
        const targetSubstitutionId = decodePathUuid(substitutionCorrectionMatch[2], "Approved substitution");
        const body = await readJsonBody(request);
        requireKeys(body, ["requestId", "sourceItems", "replacementProductId", "replacementQuantity", "replacementUnit", "reason"]);
        const runData = await loadRun(scope, runId);
        if (runData.status === "completed") {
          throw new QcApiError(409, "Completed runs cannot receive substitution changes.");
        }
        const sourceItems = validateSubstitutionSources(body.sourceItems, runData);
        const componentProducts = await listComponentProducts(auth);
        const replacementProductId = validateUuid(body.replacementProductId, "Replacement product");
        const replacement = componentProducts.products.find((product) =>
          product.productId.toLowerCase() === replacementProductId);
        if (!replacement) throw new QcApiError(400, "Choose an active replacement product.");
        const replacementUnit = validateText(body.replacementUnit, "Replacement unit", { max: 16 });
        if (replacementUnit !== replacement.unit) {
          throw new QcApiError(400, "Use the replacement product’s exact inventory unit.");
        }
        const details = {
          sourceItems,
          replacementProductId,
          replacementQuantity: validateNumber(body.replacementQuantity, "Replacement quantity", { positive: true }),
          replacementUnit,
          reason: validateText(body.reason, "Correction reason", { min: 3, max: 500 }),
        };
        const saved = await recordSubstitution(
          auth, runId, validateRequestId(body.requestId), "correct",
          null, targetSubstitutionId, details,
        );
        sendJson(response, saved?.replayed ? 200 : 201, saved);
        return true;
      }

      const runMatch = url.pathname.match(/^\/api\/v2\/qc\/runs\/([^/]+)$/);
      if (runMatch && request.method === "GET") {
        operation = "get_run_history";
        const runId = decodePathUuid(runMatch[1], "Run ID");
        const limit = parseLimit(url);
        const run = await loadRun(scope, runId);
        const items = flattenRunItems(run);
        const [events, settings, substitutions, componentProducts, reviewResult] = await Promise.all([
          listEvents(auth, runId, limit),
          listSettings(auth),
          listSubstitutions(auth, runId),
          listComponentProducts(auth),
          pool.query({
            text: "SELECT v2.get_qc_review_state($1::uuid, $2::uuid, $3::uuid) AS result",
            values: [scope, actor, runId],
            query_timeout: 3000,
          }),
        ]);
        const review = resultValue(reviewResult);
        if (!review || !["needs-review", "signed-off"].includes(review.status)) {
          throw new QcApiError(502, "QC review status is temporarily unavailable.");
        }
        const allergenFootprint = deriveAllergenFootprint(run, items, substitutions);
        const components = componentChecklist(run, items, substitutions);
        sendJson(response, 200, {
          run: { id: run.id, status: run.status, setupSnapshot: run.setupSnapshot },
          items,
          events,
          settings,
          substitutions,
          components,
          componentProducts: componentProducts.products,
          review,
          allergenFootprint,
          limitations: {
            allergens: allergenFootprint.status === "unknown" ? "incomplete" : "available",
            components: componentProducts.productsTruncated ? "limited" : "available",
            reason: componentProducts.productsTruncated
              ? "Only the first 2,000 active inventory products are available for component checks."
              : null,
          },
        });
        return true;
      }

      const eventMatch = url.pathname.match(/^\/api\/v2\/qc\/runs\/([^/]+)\/events$/);
      if (eventMatch && request.method === "POST") {
        operation = "record_event";
        const runId = decodePathUuid(eventMatch[1], "Run ID");
        const body = await readJsonBody(request);
        if (typeof body.eventType !== "string") throw new QcApiError(400, "Choose a supported QC record type.");
        const eventType = body.eventType;
        if (eventType === "review-signed-off" || eventType === "review-flag-reviewed") {
          requireQcAccess(auth, "manage-qc");
        }
        if (eventType === "redaction") requireQcAccess(auth, "manage-qc");
        const run = await loadRun(scope, runId);
        const requestId = validateRequestId(body.requestId);
        let payload;

        if (eventType === "lot-recorded") {
          requireKeys(body, ["requestId", "eventType", "productId", "recipeCode", "stationKey", "lotCode"]);
          const item = findRunItem(run, body);
          payload = {
            ...item,
            lotCode: validateText(body.lotCode, "Lot code", { max: 120 }),
          };
        } else if (eventType === "weight-check") {
          requireKeys(body, ["requestId", "eventType", "productId", "recipeCode", "stationKey", "actual", "reason"]);
          const item = findRunItem(run, body);
          const actual = validateNumber(body.actual, "Actual weight");
          const settings = await listSettings(auth);
          const setting = settings.find((candidate) =>
            candidate.settingKey === weightSettingKey(item) && candidate.unit === item.unit);
          let result = "not_evaluated";
          let targetSnapshot = null;
          if (setting) {
            const tolerance = setting.tolerance ?? "0.1";
            const delta = fixedScale(actual) - fixedScale(setting.target);
            const absoluteDelta = delta < 0n ? -delta : delta;
            if (absoluteDelta > fixedScale(tolerance)) {
              result = "out_of_tolerance";
              if (typeof body.reason !== "string" || body.reason.trim().length < 3) {
                throw new QcApiError(400, "Add a reason when the weight is outside its reviewed target.");
              }
            } else {
              result = "within_tolerance";
            }
            targetSnapshot = {
              settingEventId: setting.id,
              target: setting.target,
              tolerance,
              unit: setting.unit,
              sourceReference: setting.sourceReference,
            };
          }
          payload = {
            ...item,
            actual,
            result,
            ...(targetSnapshot ? { target: targetSnapshot } : {}),
            ...(result === "out_of_tolerance" ? { reason: validateText(body.reason, "Reason", { min: 3, max: 500 }) } : {}),
          };
        } else if (eventType === "cleaning-recorded") {
          requireKeys(body, ["requestId", "eventType", "method", "cleanedAt"]);
          if (typeof body.cleanedAt !== "string" || !ISO_DATE_TIME.test(body.cleanedAt)
            || !Number.isFinite(Date.parse(body.cleanedAt))) {
            throw new QcApiError(400, "Enter the cleaning time with its time zone.");
          }
          payload = {
            method: validateText(body.method, "Cleaning method", { max: 120 }),
            cleanedAt: new Date(body.cleanedAt).toISOString(),
          };
        } else if (eventType === "cleaning-verified") {
          requireKeys(body, ["requestId", "eventType", "targetEventId"]);
          payload = { targetEventId: validateUuid(body.targetEventId, "Cleaning record") };
        } else if (eventType === "date-code-observed") {
          requireKeys(body, ["requestId", "eventType", "observedText"]);
          payload = {
            productCode: run.setupSnapshot.productCode ?? null,
            observedText: validateLiteralText(body.observedText, "Printed date-code text", { max: 200 }),
            result: "not_evaluated",
            reason: "No applicable exact-text reference is configured.",
          };
        } else if (eventType === "brix-check") {
          requireKeys(body, ["requestId", "eventType", "actual"]);
          const actual = validateNumber(body.actual, "Brix reading");
          const productCode = run.setupSnapshot.productCode;
          const settings = await listSettings(auth);
          const setting = typeof productCode === "string"
            ? settings.find((candidate) => candidate.settingKey === brixSettingKey(productCode))
            : null;
          let result = "not_evaluated";
          let target = null;
          if (setting) {
            const difference = fixedScale(actual) - fixedScale(setting.target);
            const absoluteDifference = difference < 0n ? -difference : difference;
            result = absoluteDifference <= fixedScale(setting.tolerance) ? "within_tolerance" : "out_of_tolerance";
            target = {
              settingEventId: setting.id,
              value: setting.target,
              tolerance: setting.tolerance,
              unit: "°Bx",
              sourceReference: setting.sourceReference,
            };
          }
          payload = {
            productCode: productCode ?? null,
            actual,
            unit: "°Bx",
            result,
            ...(target ? { target } : {}),
          };
        } else if (eventType === "run-check-reviewed") {
          if (body.checkType === "allergen-footprint") {
            requireKeys(body, ["requestId", "eventType", "checkType"]);
            const substitutions = await listSubstitutions(auth, runId);
            const footprint = deriveAllergenFootprint(run, undefined, substitutions);
            payload = {
              checkType: "allergen-footprint",
              result: footprint.status === "complete" ? "reviewed" : "not_evaluated",
              allergens: footprint.allergens,
              ingredientCount: footprint.ingredientCount,
              unknownCount: footprint.unknownIngredients.length,
              ...(footprint.status !== "complete"
                ? { reason: "One or more ingredient identities, allergen facts, or substitution quantities are unknown." }
                : {}),
            };
          } else if (body.checkType === "component-presence") {
            requireKeys(body, ["requestId", "eventType", "checkType", "observations"]);
            if (!Array.isArray(body.observations) || body.observations.length < 1
              || body.observations.length > 200) {
              throw new QcApiError(400, "Record one to two hundred component observations.");
            }
            const substitutions = await listSubstitutions(auth, runId);
            const expected = componentChecklist(run, flattenRunItems(run), substitutions);
            const products = await listComponentProducts(auth);
            const expectedByKey = new Map(expected.map((item) => [
              `${item.productId}:${item.stationKey}:${item.recipeCode}`,
              item,
            ]));
            const seen = new Set();
            const observations = body.observations.map((observation) => {
              if (!observation || typeof observation !== "object" || Array.isArray(observation)) {
                throw new QcApiError(400, "A component observation is invalid.");
              }
              requireKeys(observation, ["productId", "stationKey", "recipeCode", "status", "observedProductId"]);
              const expectedProductId = validateUuid(observation.productId, "Expected component");
              const key = `${expectedProductId}:${observation.stationKey}:${observation.recipeCode}`;
              const item = expectedByKey.get(key);
              if (!item || seen.has(key)) throw new QcApiError(400, "Choose each expected component once.");
              seen.add(key);
              if (!["present", "missing", "identity-mismatch", "not-observed"].includes(observation.status)) {
                throw new QcApiError(400, "Choose a supported component observation.");
              }
              let observedProduct = null;
              if (observation.status === "identity-mismatch") {
                const observedProductId = validateUuid(observation.observedProductId, "Observed product");
                observedProduct = products.products.find((product) =>
                  product.productId.toLowerCase() === observedProductId);
                if (!observedProduct || observedProductId === expectedProductId) {
                  throw new QcApiError(400, "Choose a different active inventory identity for a mismatch.");
                }
              } else if (observation.observedProductId !== null) {
                throw new QcApiError(400, "Only an identity mismatch can name a different product.");
              }
              return {
                expectedProductId,
                expectedProductCode: item.productCode,
                expectedProductName: item.productName,
                recipeCode: item.recipeCode,
                stationKey: item.stationKey,
                status: observation.status,
                observedProductId: observedProduct?.productId ?? null,
                observedProductCode: observedProduct?.productCode ?? null,
                observedProductName: observedProduct?.productName ?? null,
              };
            });
            if (seen.size !== expected.length) {
              throw new QcApiError(400, "Record an observation for every expected component.");
            }
            payload = {
              checkType: "component-presence",
              result: "recorded",
              observations,
              unknownCount: observations.filter((item) => item.status === "not-observed").length,
            };
          } else {
            throw new QcApiError(400, "Choose a supported run checklist.");
          }
        } else if (eventType === "checkpoint-observed") {
          requireKeys(body, [
            "requestId", "eventType", "checkpointType", "stationKey",
            "checkpointLabel", "observedValue", "unit", "note",
          ]);
          if (!["temperature", "time"].includes(body.checkpointType)) {
            throw new QcApiError(400, "Choose a temperature or elapsed-time observation.");
          }
          if (!STATIONS.has(body.stationKey) || !runHasStation(run, body.stationKey)) {
            throw new QcApiError(400, "Choose a production station from this run.");
          }
          const unitOptions = body.checkpointType === "temperature"
            ? ["°C", "°F"]
            : ["s", "min", "h"];
          if (!unitOptions.includes(body.unit)) {
            throw new QcApiError(400, "Choose a unit that matches this observation type.");
          }
          const observedValue = validateSignedNumber(body.observedValue, "Observed value");
          if (body.checkpointType === "time" && Number(observedValue) < 0) {
            throw new QcApiError(400, "Elapsed time cannot be negative.");
          }
          const note = body.note === "" ? null : validateText(body.note, "Observation note", { max: 500 });
          payload = {
            checkpointType: body.checkpointType,
            stationKey: body.stationKey,
            checkpointLabel: validateText(body.checkpointLabel, "Checkpoint label", { max: 100 }),
            observedValue,
            unit: body.unit,
            evaluationStatus: "not_evaluated",
            ...(note ? { note } : {}),
          };
        } else if (eventType === "corrective-action-observed") {
          requireKeys(body, ["requestId", "eventType", "targetEventId", "actionObserved", "followUpNote"]);
          const followUpNote = body.followUpNote === ""
            ? null
            : validateText(body.followUpNote, "Follow-up note", { max: 500 });
          payload = {
            targetEventId: validateUuid(body.targetEventId, "QC checkpoint or review flag"),
            actionObserved: validateText(body.actionObserved, "Action observed", { max: 500 }),
            ...(followUpNote ? { followUpNote } : {}),
          };
        } else if (eventType === "review-flag-raised") {
          if (body.targetType === "run") {
            requireKeys(body, ["requestId", "eventType", "targetType", "reason"]);
            payload = {
              targetType: "run",
              reason: validateText(body.reason, "Review reason", { min: 3, max: 500 }),
            };
          } else if (body.targetType === "lot") {
            requireKeys(body, ["requestId", "eventType", "targetType", "targetEventId", "reason"]);
            payload = {
              targetType: "lot",
              targetEventId: validateUuid(body.targetEventId, "Lot record"),
              reason: validateText(body.reason, "Review reason", { min: 3, max: 500 }),
            };
          } else {
            throw new QcApiError(400, "Choose a run or recorded lot to flag for review.");
          }
        } else if (eventType === "review-flag-reviewed") {
          requireQcAccess(auth, "manage-qc");
          requireKeys(body, ["requestId", "eventType", "targetEventId", "reviewNote"]);
          payload = {
            targetEventId: validateUuid(body.targetEventId, "Review flag"),
            reviewNote: validateText(body.reviewNote, "Manager review note", { min: 3, max: 500 }),
          };
        } else if (eventType === "review-signed-off") {
          requireKeys(body, ["requestId", "eventType"]);
          payload = { review: "signed-off" };
        } else if (eventType === "correction") {
          requireKeys(body, ["requestId", "eventType", "targetEventId", "correctedText", "reason"]);
          payload = {
            targetEventId: validateUuid(body.targetEventId, "QC record"),
            correctedText: validateText(body.correctedText, "Corrected information", { max: 500 }),
            reason: validateText(body.reason, "Reason", { min: 3, max: 500 }),
          };
        } else if (eventType === "redaction") {
          requireKeys(body, ["requestId", "eventType", "targetEventId", "reason"]);
          payload = {
            targetEventId: validateUuid(body.targetEventId, "QC record"),
            reason: validateText(body.reason, "Reason", { min: 3, max: 500 }),
          };
        } else {
          throw new QcApiError(400, "This QC record type is not available.");
        }

        const saved = await appendEvent(auth, runId, requestId, eventType, payload);
        sendJson(response, saved?.replayed ? 200 : 201, saved);
        return true;
      }

      throw new QcApiError(404, "QC route not found.");
    } catch (error) {
      const status = safeStatus(error);
      if (status >= 500) {
        logger({
          event: "v2.qc_api.error",
          requestId: request.v2RequestId ?? null,
          operation,
          actorId,
          status,
          errorName: typeof error?.name === "string" ? error.name.slice(0, 80) : "UnknownError",
          databaseCode: typeof error?.code === "string" && /^[0-9A-Z]{5}$/.test(error.code)
            ? error.code
            : undefined,
        });
      }
      sendJson(response, status, { error: safeMessage(error) }, Number.isSafeInteger(error?.retryAfterSeconds)
        ? { "Retry-After": String(error.retryAfterSeconds) }
        : {});
      return true;
    }
  };
}
