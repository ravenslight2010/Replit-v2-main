const PATH = "/api/v2/manager-diagnostics/station-worker";
const DEFAULT_STALE_AFTER_MS = 15_000;

function sendJson(response, status, body, headers = {}) {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  response.end(JSON.stringify(body));
}

function safeTimestamp(value) {
  if (typeof value !== "string") return null;
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.valueOf()) ? null : timestamp.toISOString();
}

function buildStationWorkerStatus(snapshot, checkedAt, staleAfterMs) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return {
      status: "unavailable",
      checkedAt,
      lastCycleAt: null,
      ageSeconds: null,
      consecutiveFailures: null,
      processedLastCycle: null,
      nextStep: "Check that the V2 API and station-worker services are running.",
    };
  }

  const lastCycleAt = safeTimestamp(snapshot.lastCycleAt);
  const cycleAgeMs = lastCycleAt === null ? null : Math.max(0, Date.parse(checkedAt) - Date.parse(lastCycleAt));
  const failed = snapshot.status === "degraded" || snapshot.status === "stopped" || snapshot.status === "starting";
  let status;
  let nextStep;
  if (failed) {
    status = "degraded";
    nextStep = "Check the station-worker service and its database connection.";
  } else if (snapshot.status === "standby") {
    status = "standby";
    nextStep = "No worker action is needed unless station progress is due.";
  } else if (snapshot.status === "active" && (cycleAgeMs === null || cycleAgeMs > staleAfterMs)) {
    status = "stale";
    nextStep = "Check that the station worker is running and can reach the V2 database.";
  } else if (snapshot.status === "active") {
    status = "active";
    nextStep = "No action needed; check again if automatic progress stops.";
  } else {
    status = "unavailable";
    nextStep = "Refresh the status; if it remains unavailable, check the V2 services.";
  }

  return {
    status,
    checkedAt,
    lastCycleAt,
    ageSeconds: cycleAgeMs === null ? null : Math.floor(cycleAgeMs / 1000),
    consecutiveFailures: Number.isSafeInteger(snapshot.consecutiveFailures)
      ? Math.min(1_000_000, Math.max(0, snapshot.consecutiveFailures))
      : null,
    processedLastCycle: Number.isSafeInteger(snapshot.processedLastCycle)
      ? Math.min(1_000_000, Math.max(0, snapshot.processedLastCycle))
      : null,
    nextStep,
  };
}

export function createManagerDiagnosticsApi({
  authenticate,
  workerHealth,
  clock = Date.now,
  staleAfterMs = DEFAULT_STALE_AFTER_MS,
} = {}) {
  if (typeof authenticate !== "function") throw new TypeError("A V2 authentication function is required.");
  if (typeof workerHealth !== "function") throw new TypeError("A station-worker health reader is required.");
  if (typeof clock !== "function") throw new TypeError("A clock function is required.");
  if (!Number.isSafeInteger(staleAfterMs) || staleAfterMs < 1_000 || staleAfterMs > 300_000) {
    throw new TypeError("staleAfterMs must be between 1000 and 300000.");
  }

  return async function handleManagerDiagnosticsApi(request, response) {
    let url;
    try {
      url = new URL(request.url || "/", "http://v2.local");
    } catch {
      return false;
    }
    if (url.pathname !== PATH) return false;
    if (request.method !== "GET") {
      sendJson(response, 405, { error: "This method is not allowed for station-worker status." }, { Allow: "GET" });
      return true;
    }
    if (url.search) {
      sendJson(response, 400, { error: "Station-worker status does not accept query parameters." });
      return true;
    }

    try {
      const current = await authenticate(request);
      if (current?.verified !== true) {
        sendJson(response, 401, { error: "Sign in to view station-worker status." });
        return true;
      }
      if (!Array.isArray(current.capabilities) || !current.capabilities.includes("manage-staff")) {
        sendJson(response, 403, { error: "You do not have permission to view station-worker status." });
        return true;
      }
      let snapshot = null;
      try {
        snapshot = await workerHealth();
      } catch {
        // Keep internal worker errors and network details out of manager-facing diagnostics.
      }
      const checkedAt = new Date(clock()).toISOString();
      sendJson(response, 200, {
        stationWorker: buildStationWorkerStatus(snapshot, checkedAt, staleAfterMs),
      });
      return true;
    } catch {
      sendJson(response, 503, { error: "Station-worker status is temporarily unavailable." });
      return true;
    }
  };
}

export { buildStationWorkerStatus };
