import { createHash } from "node:crypto";
import { isValidProductionDate } from "../core/schedule-planning.mjs";

const API_PATH = "/api/v2/manager-operations";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ACTION_KEY = /^run-pause:[0-9a-f-]{36}:[1-9][0-9]{0,15}$/u;
const MAX_BODY_BYTES = 8_192;

export class ManagerOperationsApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "ManagerOperationsApiError";
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

function exactKeys(value, expected) {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  if (actual.length !== sorted.length || actual.some((key, index) => key !== sorted[index])) {
    throw new ManagerOperationsApiError(400, "The request contains missing or unsupported fields.");
  }
}

async function readJsonBody(request) {
  const contentType = request.headers["content-type"];
  if (typeof contentType !== "string" || !/^application\/json(?:\s*;|$)/iu.test(contentType)) {
    throw new ManagerOperationsApiError(415, "Send this request as JSON.");
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new ManagerOperationsApiError(413, "The request is too large.");
    chunks.push(chunk);
  }
  if (size === 0) throw new ManagerOperationsApiError(400, "A JSON request body is required.");
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ManagerOperationsApiError(400, "The request body is not valid JSON.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ManagerOperationsApiError(400, "The JSON request body must be an object.");
  }
  return body;
}

function requireManager(auth) {
  if (auth?.verified !== true) throw new ManagerOperationsApiError(401, "Sign in to view manager operations.");
  if (!Array.isArray(auth.capabilities) || !auth.capabilities.includes("review-incidents")) {
    throw new ManagerOperationsApiError(403, "Manager operations are not available to this account.");
  }
  if (!UUID.test(auth.actorId || "") || !UUID.test(auth.facilityId || "")) {
    throw new ManagerOperationsApiError(401, "Refresh your V2 session before continuing.");
  }
  return { actorId: auth.actorId.toLowerCase(), facilityId: auth.facilityId.toLowerCase() };
}

function parseQuery(url, allowedKeys) {
  const keys = [...url.searchParams.keys()];
  if (keys.some((key) => !allowedKeys.includes(key))) {
    throw new ManagerOperationsApiError(400, "The manager operations query contains unsupported fields.");
  }
  const values = {};
  for (const key of allowedKeys) {
    const items = url.searchParams.getAll(key);
    if (items.length > 1) throw new ManagerOperationsApiError(400, `Specify ${key} once.`);
    if (items.length === 1) values[key] = items[0];
  }
  if (!isValidProductionDate(values.from) || !isValidProductionDate(values.to)) {
    throw new ManagerOperationsApiError(400, "Choose valid start and end dates.");
  }
  const from = Date.parse(`${values.from}T00:00:00Z`);
  const to = Date.parse(`${values.to}T00:00:00Z`);
  if (to < from || (to - from) / 86_400_000 > 89) {
    throw new ManagerOperationsApiError(400, "Choose a date range of 1 to 90 days.");
  }
  return { ...values, fromDate: values.from, toDate: values.to };
}

function decodeCursor(value, kind) {
  if (value === undefined) return null;
  if (typeof value !== "string" || value.length > 800 || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new ManagerOperationsApiError(400, "The history cursor is invalid.");
  }
  let cursor;
  try {
    cursor = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw new ManagerOperationsApiError(400, "The history cursor is invalid.");
  }
  const timestamp = kind === "run" ? cursor?.createdAt : cursor?.occurredAt;
  const id = cursor?.runId;
  const eventRevision = cursor?.revision;
  if (typeof timestamp !== "string" || Number.isNaN(Date.parse(timestamp)) || !UUID.test(id || "")
    || (kind === "event" && (!Number.isSafeInteger(eventRevision) || eventRevision < 0))) {
    throw new ManagerOperationsApiError(400, "The history cursor is invalid.");
  }
  return {
    timestamp: new Date(timestamp).toISOString(),
    id: id.toLowerCase(),
    ...(kind === "event" ? { revision: eventRevision } : {}),
  };
}

function encodeCursor(value) {
  return value ? Buffer.from(JSON.stringify(value)).toString("base64url") : null;
}

function safeStatus(error) {
  if (error instanceof ManagerOperationsApiError) return error.status;
  if (error?.code === "42501") return 403;
  if (error?.code === "P0002") return 404;
  if (error?.code === "40001" || error?.code === "23505") return 409;
  if (error?.code === "22023" || error?.code === "22P02" || error?.code === "23514") return 400;
  return 500;
}

function safeMessage(error, status) {
  if (error instanceof ManagerOperationsApiError) return error.message;
  if (status === 403) return "Manager operations are not available to this account.";
  if (status === 404) return "The selected evidence is no longer available.";
  if (status === 409) return "Another manager changed this action. Refresh before trying again.";
  if (status === 400) return "The manager operations request is invalid.";
  return "Manager operations could not be loaded. Refresh to try again.";
}

function validateSnapshot(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    && value.timeZone === "America/Chicago"
    && isValidProductionDate(value.fromDate) && isValidProductionDate(value.toDate)
    && value.runs && Array.isArray(value.runs.items)
    && typeof value.runs.hasMore === "boolean"
    && (value.runs.nextCursor === null || (typeof value.runs.nextCursor === "object"
      && typeof value.runs.nextCursor.createdAt === "string" && UUID.test(value.runs.nextCursor.runId || "")))
    && value.summary && value.activeRuns && Array.isArray(value.activeRuns)
    && Array.isArray(value.pauseTrend) && Array.isArray(value.eventPatterns)
    && Array.isArray(value.actions) && value.dataHealth && value.coverage;
}

export function createManagerOperationsApi({ pool, authenticate, verifyCsrf, logger = () => {} } = {}) {
  if (!pool || typeof pool.query !== "function") throw new TypeError("A V2 PostgreSQL pool is required.");
  if (typeof authenticate !== "function") throw new TypeError("A V2 session verifier is required.");
  if (typeof verifyCsrf !== "function") throw new TypeError("A V2 CSRF verifier is required.");
  if (typeof logger !== "function") throw new TypeError("A structured logger is required.");

  return async function handleManagerOperationsApi(request, response) {
    const url = new URL(request.url || "/", "http://v2.local");
    const actionMatch = url.pathname.match(/^\/api\/v2\/manager-operations\/actions\/([^/]+)\/status$/u);
    if (url.pathname !== API_PATH && url.pathname !== `${API_PATH}/events` && !actionMatch) return false;

    let operation = "read";
    try {
      const auth = await authenticate(request);
      const { actorId, facilityId } = requireManager(auth);
      if (request.method === "POST") {
        operation = "record_action";
        if (!actionMatch) throw new ManagerOperationsApiError(405, "This method is not allowed for manager operations.");
        if (url.search) throw new ManagerOperationsApiError(400, "Status changes do not accept query parameters.");
        if (await verifyCsrf(request, auth) !== true) {
          throw new ManagerOperationsApiError(403, "Refresh your session before changing manager action status.");
        }
        let actionKey;
        try {
          actionKey = decodeURIComponent(actionMatch[1]);
        } catch {
          throw new ManagerOperationsApiError(400, "The manager action key is invalid.");
        }
        if (!ACTION_KEY.test(actionKey)) throw new ManagerOperationsApiError(400, "The manager action key is invalid.");
        const body = await readJsonBody(request);
        exactKeys(body, ["requestId", "expectedRevision", "status", "note"]);
        if (typeof body.requestId !== "string" || body.requestId.length < 1 || body.requestId.length > 200
          || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0
          || !["acknowledged", "resolved", "unavailable-evidence"].includes(body.status)
          || typeof body.note !== "string" || body.note.trim().length < 3 || body.note.length > 500) {
          throw new ManagerOperationsApiError(400, "Provide a valid status, current revision, request ID, and note.");
        }
        const requestHash = createHash("sha256").update(JSON.stringify({
          actionKey,
          expectedRevision: body.expectedRevision,
          status: body.status,
          note: body.note.trim(),
        })).digest("hex");
        const result = await pool.query({
          text: "SELECT v2.record_manager_action_status($1::uuid, $2::uuid, $3::text, $4::bigint, $5::text, $6::text, $7::text, $8::text) AS result",
          values: [facilityId, actorId, actionKey, body.expectedRevision, body.requestId, requestHash, body.status, body.note],
          query_timeout: 5_000,
        });
        const saved = result?.rows?.[0]?.result;
        if (!saved?.event || saved.event.actionKey !== actionKey || saved.event.status !== body.status
          || saved.event.actorId !== actorId || !Number.isSafeInteger(saved.event.revision)) {
          throw new ManagerOperationsApiError(502, "The manager action result was incomplete. Refresh before continuing.");
        }
        sendJson(response, saved.replayed ? 200 : 201, saved);
        return true;
      }

      if (request.method !== "GET") {
        throw new ManagerOperationsApiError(405, "This method is not allowed for manager operations.");
      }

      if (url.pathname === `${API_PATH}/events`) {
        operation = "list_events";
        const query = parseQuery(url, ["from", "to", "runId", "limit", "cursor"]);
        const limit = query.limit === undefined ? 50 : Number(query.limit);
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
          throw new ManagerOperationsApiError(400, "limit must be from 1 to 100.");
        }
        if (query.runId !== undefined && !UUID.test(query.runId)) {
          throw new ManagerOperationsApiError(400, "The selected run ID is invalid.");
        }
        const cursor = decodeCursor(query.cursor, "event");
        const result = await pool.query({
          text: "SELECT v2.list_manager_operation_events($1::uuid, $2::uuid, $3::date, $4::date, $5::integer, $6::uuid, $7::timestamptz, $8::uuid, $9::bigint) AS result",
          values: [facilityId, actorId, query.fromDate, query.toDate, limit, query.runId?.toLowerCase() ?? null, cursor?.timestamp ?? null, cursor?.id ?? null, cursor?.revision ?? null],
          query_timeout: 5_000,
        });
        const body = result?.rows?.[0]?.result;
        if (!body || !Array.isArray(body.events) || typeof body.hasMore !== "boolean") {
          throw new ManagerOperationsApiError(502, "Run event history is incomplete. Refresh to try again.");
        }
        body.nextCursor = encodeCursor(body.nextCursor);
        sendJson(response, 200, body);
        return true;
      }

      const query = parseQuery(url, ["from", "to", "limit", "cursor"]);
      const limit = query.limit === undefined ? 50 : Number(query.limit);
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
        throw new ManagerOperationsApiError(400, "limit must be from 1 to 100.");
      }
      const cursor = decodeCursor(query.cursor, "run");
      const result = await pool.query({
        text: "SELECT v2.get_manager_operations_snapshot($1::uuid, $2::uuid, $3::date, $4::date, $5::integer, $6::timestamptz, $7::uuid) AS result",
        values: [facilityId, actorId, query.fromDate, query.toDate, limit, cursor?.timestamp ?? null, cursor?.id ?? null],
        query_timeout: 7_000,
      });
      const snapshot = result?.rows?.[0]?.result;
      if (!validateSnapshot(snapshot)) {
        throw new ManagerOperationsApiError(502, "The manager operations summary was incomplete. Refresh to try again.");
      }
      snapshot.runs.nextCursor = encodeCursor(snapshot.runs.nextCursor);
      sendJson(response, 200, snapshot);
      return true;
    } catch (error) {
      const status = safeStatus(error);
      if (status >= 500) {
        logger({
          event: "v2.manager_operations.request_failed",
          requestId: request.v2RequestId ?? null,
          operation,
          errorName: typeof error?.name === "string" ? error.name.slice(0, 80) : "UnknownError",
          errorCode: typeof error?.code === "string" && /^[0-9A-Z]{5}$/u.test(error.code) ? error.code : null,
        });
      }
      sendJson(response, status, { error: safeMessage(error, status) });
      return true;
    }
  };
}
