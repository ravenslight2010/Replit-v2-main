const PATH = "/api/v2/agent-test-preview/credentials";

function sendJson(response, status, body) {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(body));
}

function isSameOrigin(request) {
  if (request.headers["sec-fetch-site"] === "cross-site") return false;
  const origin = request.headers.origin;
  if (origin === undefined) return true;
  if (typeof origin !== "string" || origin.length > 512) return false;
  try {
    const parsed = new URL(origin);
    return (parsed.protocol === "http:" || parsed.protocol === "https:")
      && parsed.host.toLowerCase() === String(request.headers.host || "").toLowerCase()
      && !parsed.username && !parsed.password
      && parsed.pathname === "/" && !parsed.search && !parsed.hash;
  } catch {
    return false;
  }
}

export function createAgentPreviewApi({ enabled = false, username, password } = {}) {
  if (enabled && (typeof username !== "string" || typeof password !== "string")) {
    throw new TypeError("Preview credentials are required when the agent preview is enabled.");
  }
  return async function handleAgentPreview(request, response) {
    let url;
    try {
      url = new URL(request.url || "/", "http://v2.local");
    } catch {
      return false;
    }
    if (url.pathname !== PATH) return false;
    if (!enabled) {
      sendJson(response, 200, { enabled: false });
      return true;
    }
    if (request.method !== "GET") {
      sendJson(response, 405, { error: "This method is not allowed for preview access." });
      return true;
    }
    if (url.search || !isSameOrigin(request)) {
      sendJson(response, 403, { error: "Preview access is available only to this origin." });
      return true;
    }
    sendJson(response, 200, { enabled: true, username, password });
    return true;
  };
}
