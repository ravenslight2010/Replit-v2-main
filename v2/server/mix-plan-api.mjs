import { buildMixPlan } from "../core/mix-plan.mjs";
import { isValidProductionDate } from "../core/schedule-planning.mjs";

const PATH = "/api/v2/mix-plan";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

class MixPlanApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "MixPlanApiError";
    this.status = status;
  }
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(body));
}

function safeStatus(error) {
  if (error instanceof MixPlanApiError) return error.status;
  if (error?.code === "42501") return 403;
  if (error?.code === "22023" || error?.code === "22008") return 400;
  return 500;
}

export function createMixPlanApi({ pool, authenticate, logger = () => {} } = {}) {
  if (!pool || typeof pool.query !== "function") throw new TypeError("A V2 PostgreSQL pool is required.");
  if (typeof authenticate !== "function") throw new TypeError("A V2 session verifier is required.");
  if (typeof logger !== "function") throw new TypeError("A structured logger is required.");

  return async function handleMixPlanApi(request, response) {
    const url = new URL(request.url || "/", "http://v2.local");
    if (url.pathname !== PATH) return false;
    try {
      if (request.method !== "GET") {
        sendJson(response, 405, { error: "Only read-only mix plan requests are allowed." });
        return true;
      }
      const keys = [...url.searchParams.keys()];
      const dates = url.searchParams.getAll("makeDate");
      if (keys.length !== 1 || keys[0] !== "makeDate" || dates.length !== 1
        || !isValidProductionDate(dates[0])) {
        throw new MixPlanApiError(400, "Choose one valid mix preparation date.");
      }
      const auth = await authenticate(request);
      if (auth?.verified !== true) throw new MixPlanApiError(401, "Sign in to view the mix plan.");
      if (typeof auth.actorId !== "string" || !UUID.test(auth.actorId)
        || typeof auth.facilityId !== "string" || !UUID.test(auth.facilityId)) {
        throw new MixPlanApiError(401, "Refresh your V2 session before continuing.");
      }
      const capabilities = Array.isArray(auth.capabilities) ? auth.capabilities : [];
      if (!["run.read", "manage-inventory", "manage-factory-settings"].some((capability) => capabilities.includes(capability))) {
        throw new MixPlanApiError(403, "Run access is required to view the mix plan.");
      }
      const result = await pool.query({
        text: "SELECT v2.get_operational_mix_plan_sources($1::uuid, $2::date) AS result",
        values: [auth.facilityId.toLowerCase(), dates[0]],
        query_timeout: 5_000,
      });
      const sources = result?.rows?.[0]?.result;
      if (!sources || sources.makeDate !== dates[0]
        || sources.timeZone !== "America/Chicago"
        || typeof sources.scheduleHorizonTruncated !== "boolean"
        || !["mixes", "schedules", "templates", "setups", "activeRuns", "substitutions"]
          .every((key) => Array.isArray(sources[key]))) {
        throw new MixPlanApiError(502, "Canonical mix plan sources are incomplete. Refresh to try again.");
      }
      const plan = buildMixPlan({
        makeDate: dates[0],
        mixes: sources.mixes,
        schedules: sources.schedules,
        templates: sources.templates,
        setups: sources.setups,
        activeRuns: sources.activeRuns,
        substitutions: sources.substitutions,
      });
      if (sources.scheduleHorizonTruncated === true) {
        plan.warnings.push({
          code: "schedule-horizon-truncated",
          message: "Only the next 366 calendar days of scheduled runs are included.",
        });
      }
      if (plan.coverage.activeRunCount > 0 && plan.coverage.enabledMixCount > 0
        && sources.mixes.some((mix) => mix.enabled === true && mix.isPrep !== true)) {
        plan.warnings.push({
          code: "active-run-product-identity-unavailable",
          message: "Active run snapshots do not include brand/flavor identity, so they are excluded from per-pizza mix matching.",
        });
      }
      sendJson(response, 200, { plan, generatedAt: new Date().toISOString() });
      return true;
    } catch (error) {
      const status = safeStatus(error);
      const message = error instanceof MixPlanApiError
        ? error.message
        : status === 403
          ? "This mix plan is not available to your account."
          : status === 400
            ? "The mix plan date is invalid."
            : "The mix plan could not be loaded. Refresh to try again.";
      if (status >= 500) {
        logger({
          event: "v2.mix_plan.request_failed",
          requestId: request.v2RequestId,
          errorName: typeof error?.name === "string" ? error.name.slice(0, 80) : "UnknownError",
        });
      }
      sendJson(response, status, { error: message });
      return true;
    }
  };
}
