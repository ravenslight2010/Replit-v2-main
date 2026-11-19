import { createHash, randomUUID } from "node:crypto";
import {
  isValidProductionDate,
  normalizeScheduleBreaks,
  normalizeScheduleRun,
  normalizeSchedule,
  ScheduleValidationError,
  SCHEDULE_TIME_ZONE,
} from "../core/schedule-planning.mjs";
import { parseScheduleWorkbook, scheduleWorkbookLimits } from "../core/schedule-workbook-import.mjs";

const API_PREFIX = "/api/v2/schedules";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CODE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u;
const MAX_BODY_BYTES = 7_200_000;

export class ScheduleApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "ScheduleApiError";
    this.status = status;
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
  if (typeof contentType !== "string" || !/^application\/json(?:\s*;|$)/iu.test(contentType)) {
    throw new ScheduleApiError(415, "Send this request as JSON.");
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new ScheduleApiError(413, "The request is too large.");
    chunks.push(chunk);
  }
  if (size === 0) throw new ScheduleApiError(400, "A JSON request body is required.");
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ScheduleApiError(400, "The request body is not valid JSON.");
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new ScheduleApiError(400, "The request body must be an object.");
  }
  return body;
}

function exactKeys(value, expected) {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  if (actual.length !== sorted.length || actual.some((key, index) => key !== sorted[index])) {
    throw new ScheduleApiError(400, "The request contains missing or unsupported fields.");
  }
}

function oneOfKeys(value, allowed) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new ScheduleApiError(400, "The request contains unsupported fields.");
  }
}

function authIdentity(auth) {
  if (typeof auth?.actorId !== "string" || !UUID.test(auth.actorId)
    || typeof auth?.facilityId !== "string" || !UUID.test(auth.facilityId)) {
    throw new ScheduleApiError(401, "Refresh your V2 session before continuing.");
  }
  return { actorId: auth.actorId.toLowerCase(), facilityId: auth.facilityId.toLowerCase() };
}

function requireManager(auth) {
  if (auth?.verified !== true) throw new ScheduleApiError(401, "Sign in to view production schedules.");
  if (!Array.isArray(auth.capabilities) || !auth.capabilities.includes("manage-factory-settings")) {
    throw new ScheduleApiError(403, "A manager must approve this schedule change.");
  }
  return authIdentity(auth);
}

function parseDate(value) {
  if (!isValidProductionDate(value)) throw new ScheduleApiError(400, "Choose a valid production date.");
  return value;
}

function safeDbStatus(error) {
  if (error?.code === "P0002" || error?.code === "23505" || error?.code === "40001") return 409;
  if (error?.code === "42501") return 403;
  if (error?.code === "22023" || error?.code === "22P02" || error?.code === "23514") return 400;
  return 500;
}

function safeDbMessage(error, status) {
  if (status === 409) return "The schedule changed or a referenced run is no longer available. Refresh to review the latest plan.";
  if (status === 403) return "This schedule is not available to your account.";
  if (status === 400) return "The schedule change contains invalid values or references.";
  return "The schedule request could not be completed. Refresh and try again.";
}

function normalizeCommand(command, schedule) {
  if (!command || typeof command !== "object" || Array.isArray(command)) {
    throw new ScheduleApiError(400, "Choose a schedule change.");
  }
  let clean;
  switch (command.type) {
    case "add":
      exactKeys(command, ["type", "run"]);
      clean = { type: "add", run: normalizeScheduleRun(command.run) };
      break;
    case "update": {
      exactKeys(command, ["type", "runId", "changes"]);
      if (typeof command.runId !== "string" || !UUID.test(command.runId)
        || !command.changes || typeof command.changes !== "object" || Array.isArray(command.changes)) {
        throw new ScheduleApiError(400, "Choose a planned run and supported fields.");
      }
      let changes = { ...command.changes };
      oneOfKeys(changes, ["productCode", "productionSetupCode", "runTemplateCode", "targetCases", "notes"]);
      if (Object.keys(changes).length === 0) throw new ScheduleApiError(400, "Choose at least one field to update.");
      const existing = schedule.runs.find((run) => run.id === command.runId.toLowerCase()) ?? {
        id: command.runId.toLowerCase(),
        productCode: "PLACEHOLDER",
        productionSetupCode: "PLACEHOLDER",
        runTemplateCode: "PLACEHOLDER",
        targetCases: 1,
        notes: "",
      };
      const normalized = normalizeScheduleRun({ ...existing, ...changes });
      changes = Object.fromEntries(Object.keys(changes).map((key) => [key, normalized[key]]));
      clean = { type: "update", runId: command.runId.toLowerCase(), changes };
      break;
    }
    case "remove":
      exactKeys(command, ["type", "runId"]);
      if (typeof command.runId !== "string" || !UUID.test(command.runId)) throw new ScheduleApiError(400, "Choose a planned run to remove.");
      clean = { type: "remove", runId: command.runId.toLowerCase() };
      break;
    case "move":
      exactKeys(command, ["type", "runId", "toIndex"]);
      if (typeof command.runId !== "string" || !UUID.test(command.runId)
        || !Number.isSafeInteger(command.toIndex) || command.toIndex < 0 || command.toIndex >= 100) {
        throw new ScheduleApiError(400, "Choose a planned run and position.");
      }
      clean = { type: "move", runId: command.runId.toLowerCase(), toIndex: command.toIndex };
      break;
    case "swap":
      exactKeys(command, ["type", "firstRunId", "secondRunId"]);
      if (typeof command.firstRunId !== "string" || !UUID.test(command.firstRunId)
        || typeof command.secondRunId !== "string" || !UUID.test(command.secondRunId)
        || command.firstRunId.toLowerCase() === command.secondRunId.toLowerCase()) {
        throw new ScheduleApiError(400, "Choose two planned runs.");
      }
      clean = {
        type: "swap",
        firstRunId: command.firstRunId.toLowerCase(),
        secondRunId: command.secondRunId.toLowerCase(),
      };
      break;
    case "breaks":
      exactKeys(command, ["type", "breaks"]);
      clean = {
        type: "breaks",
        breaks: normalizeScheduleBreaks(command.breaks, [
          ...schedule.runs,
          ...(Array.isArray(command.breaks) ? command.breaks : [])
            .filter((item) => typeof item?.runId === "string" && UUID.test(item.runId))
            .map((item) => ({ id: item.runId.toLowerCase() })),
        ]),
      };
      break;
    case "merge-import":
      exactKeys(command, ["type", "runs"]);
      if (!Array.isArray(command.runs) || command.runs.length > 100) {
        throw new ScheduleApiError(400, "The reviewed import contains too many planned runs.");
      }
      clean = { type: "merge-import", runs: command.runs.map(normalizeScheduleRun) };
      if (new Set(clean.runs.map((run) => run.id)).size !== clean.runs.length) {
        throw new ScheduleApiError(400, "The reviewed import contains duplicate planned-run IDs.");
      }
      break;
    default:
      throw new ScheduleApiError(400, "Choose a supported schedule change.");
  }
  return clean;
}

function parseWorkbookBody(body) {
  exactKeys(body, ["fileName", "workbookBase64"]);
  if (typeof body.fileName !== "string" || body.fileName.trim().length === 0
    || /[\u0000-\u001f\u007f]/u.test(body.fileName) || body.fileName.length > 500) {
    throw new ScheduleApiError(400, "Choose an XLSX workbook.");
  }
  const encoded = body.workbookBase64;
  const maxEncoded = Math.ceil(scheduleWorkbookLimits.maxBytes / 3) * 4;
  if (typeof encoded !== "string" || encoded.length > maxEncoded
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(encoded)) {
    throw new ScheduleApiError(400, "Choose a valid XLSX workbook no larger than 5 MiB.");
  }
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.byteLength < 1 || bytes.byteLength > scheduleWorkbookLimits.maxBytes
    || bytes.toString("base64") !== encoded) {
    throw new ScheduleApiError(400, "Choose a valid XLSX workbook no larger than 5 MiB.");
  }
  try {
    const preview = parseScheduleWorkbook(bytes, { fileName: body.fileName });
    const sourceName = (preview.fileName || createHash("sha256").update(bytes).digest("hex"))
      .normalize("NFKC")
      .toLocaleLowerCase("en-US");
    preview.rows = preview.rows.map((row) => {
      const identity = createHash("sha256")
        .update(`${sourceName}\u0000${row.date ?? "flat"}\u0000${row.sheet}\u0000${row.sourceRow}`)
        .digest("hex");
      const idBytes = identity.slice(0, 32).split("");
      idBytes[12] = "5";
      idBytes[16] = (8 + (Number.parseInt(idBytes[16], 16) % 4)).toString(16);
      return { ...row, importRunId: `${idBytes.slice(0, 8).join("")}-${idBytes.slice(8, 12).join("")}-${idBytes.slice(12, 16).join("")}-${idBytes.slice(16, 20).join("")}-${idBytes.slice(20).join("")}` };
    });
    return preview;
  } catch (error) {
    throw new ScheduleApiError(400, error instanceof Error ? error.message : "The workbook could not be reviewed.");
  }
}

export function createScheduleApi({ pool, authenticate, verifyCsrf, logger = () => {} }) {
  if (!pool || typeof pool.query !== "function") throw new TypeError("A V2 PostgreSQL pool is required.");
  if (typeof authenticate !== "function" || typeof verifyCsrf !== "function") {
    throw new TypeError("V2 schedule authentication and CSRF adapters are required.");
  }
  if (typeof logger !== "function") throw new TypeError("A structured logger is required.");

  const rateBuckets = new Map();
  const query = (config) => pool.query({ ...config, query_timeout: 5_000 });
  function rateLimit(identity, route, maximum, windowMs) {
    const now = Date.now();
    const key = `${identity}:${route}`;
    const bucket = (rateBuckets.get(key) ?? []).filter((time) => now - time < windowMs);
    if (bucket.length >= maximum) {
      rateBuckets.set(key, bucket);
      return Math.max(1, Math.ceil((windowMs - (now - bucket[0])) / 1000));
    }
    bucket.push(now);
    rateBuckets.set(key, bucket);
    if (rateBuckets.size > 2_000) {
      for (const [oldKey, times] of rateBuckets) {
        if (!times.length || now - times[times.length - 1] >= 60 * 60 * 1000) rateBuckets.delete(oldKey);
        if (rateBuckets.size <= 1_500) break;
      }
    }
    return 0;
  }

  async function getSchedule(facilityId, date) {
    const result = await query({
      text: "SELECT v2.get_production_schedule($1::uuid, $2::date) AS result",
      values: [facilityId, date],
    });
    return normalizeSchedule(result?.rows?.[0]?.result);
  }

  return async function handleScheduleApi(request, response) {
    const url = new URL(request.url || "/", "http://v2.local");
    if (url.pathname !== API_PREFIX && !url.pathname.startsWith(`${API_PREFIX}/`)) return false;
    try {
      const auth = await authenticate(request);
      const { facilityId, actorId } = requireManager(auth);
      const routeName = url.pathname === `${API_PREFIX}/import-preview`
        ? "import-preview"
        : url.pathname === `${API_PREFIX}/commands`
          ? "command"
          : url.pathname.endsWith("/catalog")
            ? "catalog"
            : "read";
      const limit = rateLimit(actorId, routeName, routeName === "import-preview" ? 5 : routeName === "command" ? 60 : 60, 60_000);
      if (limit > 0) {
        sendJson(response, 429, { error: "Too many schedule requests. Wait briefly and try again." }, { "Retry-After": String(limit) });
        return true;
      }
      if (request.method === "GET" && url.pathname === `${API_PREFIX}/catalog`) {
        if (url.search) throw new ScheduleApiError(400, "Catalog query parameters are not supported.");
        const [productResult, templateResult, startResult] = await Promise.all([
          query({ text: "SELECT v2.list_run_products($1::uuid) AS result", values: [facilityId] }),
          query({ text: "SELECT v2.list_schedule_run_templates($1::uuid) AS result", values: [facilityId] }),
          query({ text: "SELECT v2.schedule_default_start_time($1::uuid) AS result", values: [facilityId] }),
        ]);
        const products = productResult?.rows?.[0]?.result?.products;
        const templates = templateResult?.rows?.[0]?.result;
        const productionStartTime = startResult?.rows?.[0]?.result;
        if (!Array.isArray(products) || !Array.isArray(templates)
          || typeof productionStartTime !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/u.test(productionStartTime)) {
          throw new ScheduleApiError(502, "The schedule catalog is incomplete. Refresh and try again.");
        }
        sendJson(response, 200, { products, templates, productionStartTime, timeZone: SCHEDULE_TIME_ZONE });
        return true;
      }
      if (request.method === "GET" && url.pathname === API_PREFIX) {
        const keys = [...url.searchParams.keys()];
        if (keys.length !== 1 || keys[0] !== "date" || url.searchParams.getAll("date").length !== 1) {
          throw new ScheduleApiError(400, "Specify one production date.");
        }
        sendJson(response, 200, { schedule: await getSchedule(facilityId, parseDate(url.searchParams.get("date"))) });
        return true;
      }
      if (request.method !== "POST") {
        sendJson(response, 405, { error: "This schedule method is not allowed." });
        return true;
      }
      if (await verifyCsrf(request, auth) !== true) {
        throw new ScheduleApiError(403, "Refresh your session before changing a schedule.");
      }
      const body = await readJsonBody(request);
      if (url.pathname === `${API_PREFIX}/import-preview`) {
        sendJson(response, 200, { preview: parseWorkbookBody(body) });
        return true;
      }
      if (url.pathname !== `${API_PREFIX}/commands`) {
        throw new ScheduleApiError(404, "Schedule route not found.");
      }
      exactKeys(body, ["requestId", "date", "expectedRevision", "command"]);
      if (typeof body.requestId !== "string" || !UUID.test(body.requestId)) {
        throw new ScheduleApiError(400, "The schedule request ID is invalid.");
      }
      const date = parseDate(body.date);
      if (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0
        || body.expectedRevision > Number.MAX_SAFE_INTEGER) {
        throw new ScheduleApiError(400, "The schedule revision is invalid.");
      }
      const current = await getSchedule(facilityId, date);
      const command = normalizeCommand(body.command, current);
      const requestHash = createHash("sha256").update(JSON.stringify({
        date, expectedRevision: body.expectedRevision, command,
      })).digest("hex");
      const result = await query({
        text: "SELECT v2.apply_production_schedule_command($1::uuid,$2::uuid,$3::date,$4::text,$5::text,$6::bigint,$7::jsonb) AS result",
        values: [facilityId, actorId, date, body.requestId.toLowerCase(), requestHash, body.expectedRevision, JSON.stringify(command)],
      });
      const responseBody = result?.rows?.[0]?.result;
      if (!responseBody || !["accepted", "conflict"].includes(responseBody.outcome)) {
        throw new ScheduleApiError(502, "The schedule response was incomplete. Refresh and try again.");
      }
      if (responseBody.outcome === "conflict") {
        responseBody.schedule = normalizeSchedule(responseBody.schedule);
        sendJson(response, 409, responseBody);
      } else {
        responseBody.schedule = normalizeSchedule(responseBody.schedule);
        sendJson(response, 200, responseBody);
      }
      return true;
    } catch (error) {
      const status = error instanceof ScheduleApiError
        ? error.status
        : error instanceof ScheduleValidationError
          ? error.status
          : safeDbStatus(error);
      const message = error instanceof ScheduleApiError || error instanceof ScheduleValidationError
        ? error.message
        : safeDbMessage(error, status);
      if (status >= 500) {
        logger({
          event: "v2.schedule.request_failed",
          method: request.method,
          route: url.pathname === `${API_PREFIX}/import-preview` ? "schedules.import_preview" : "schedules.operation",
          errorName: typeof error?.name === "string" ? error.name.slice(0, 80) : "UnknownError",
          requestId: request.v2RequestId ?? randomUUID(),
        });
      }
      sendJson(response, status, { error: message });
      return true;
    }
  };
}
