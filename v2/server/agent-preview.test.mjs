import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  AgentPreviewConfigError,
  assertAgentPreviewTarget,
} from "./agent-preview-config.mjs";
import { createAgentPreviewApi } from "./agent-preview-api.mjs";
import { startV2Server } from "./main.mjs";
import { startStationWorkerProcess } from "./worker-main.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const LOCAL_URL = "postgresql://runner@127.0.0.1:43123/v2_agent_preview";
const PREVIEW_ENV = {
  NODE_ENV: "development",
  V2_AGENT_TEST_PREVIEW: "true",
};

async function withServer(handler, run) {
  const server = createServer(async (request, response) => {
    if (!await handler(request, response)) {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("agent preview accepts only an explicit loopback disposable database", () => {
  assert.equal(assertAgentPreviewTarget(PREVIEW_ENV, LOCAL_URL), true);
  assert.equal(assertAgentPreviewTarget({}, "postgresql://remote.example/shared"), false);
  for (const [env, url, code] of [
    [{ ...PREVIEW_ENV, NODE_ENV: "production" }, LOCAL_URL, "V2_AGENT_PREVIEW_ENVIRONMENT"],
    [{ ...PREVIEW_ENV, V2_USE_PROJECT_DATABASE: "true" }, LOCAL_URL, "V2_AGENT_PREVIEW_PROJECT_DATABASE"],
    [{ ...PREVIEW_ENV, DATABASE_URL: LOCAL_URL }, LOCAL_URL, "V2_AGENT_PREVIEW_PROJECT_DATABASE"],
    [PREVIEW_ENV, "postgresql://remote.example/v2_agent_preview", "V2_AGENT_PREVIEW_DATABASE_UNSAFE"],
    [PREVIEW_ENV, "postgresql://127.0.0.1:43123/other", "V2_AGENT_PREVIEW_DATABASE_UNSAFE"],
    [PREVIEW_ENV, "postgresql://127.0.0.1/v2_agent_preview", "V2_AGENT_PREVIEW_DATABASE_UNSAFE"],
    [PREVIEW_ENV, "postgresql://127.0.0.1:43123/v2_agent_preview?host=remote.example", "V2_AGENT_PREVIEW_DATABASE_UNSAFE"],
  ]) {
    assert.throws(
      () => assertAgentPreviewTarget(env, url),
      (error) => error instanceof AgentPreviewConfigError && error.code === code,
    );
  }
});

test("API and worker refuse a shared or production target before connecting", async () => {
  for (const env of [
    { ...PREVIEW_ENV, NODE_ENV: "production" },
    { ...PREVIEW_ENV, V2_USE_PROJECT_DATABASE: "true" },
    { ...PREVIEW_ENV, V2_DATABASE_URL: "postgresql://remote.example/v2_agent_preview" },
  ]) {
    const expectedCode = env.NODE_ENV === "production"
      ? "V2_AGENT_PREVIEW_ENVIRONMENT"
      : env.V2_USE_PROJECT_DATABASE === "true"
        ? "V2_AGENT_PREVIEW_PROJECT_DATABASE"
        : "V2_AGENT_PREVIEW_DATABASE_UNSAFE";
    const invalidEnv = { ...env, V2_DATABASE_URL: env.V2_DATABASE_URL || LOCAL_URL };
    await assert.rejects(startV2Server({ env: invalidEnv }), (error) => error.code === expectedCode);
    await assert.rejects(startStationWorkerProcess({ env: invalidEnv }), (error) => error.code === expectedCode);
  }
});

test("agent preview credentials are available only through its same-origin preview route", async () => {
  const previewHandler = createAgentPreviewApi({
    enabled: true,
    username: "synthetic-manager",
    password: "synthetic-password",
  });
  await withServer(previewHandler, async (baseUrl) => {
    const allowed = await fetch(`${baseUrl}/api/v2/agent-test-preview/credentials`, {
      headers: { Origin: baseUrl, "Sec-Fetch-Site": "same-origin" },
    });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get("cache-control"), "no-store");
    assert.deepEqual(await allowed.json(), {
      enabled: true,
      username: "synthetic-manager",
      password: "synthetic-password",
    });

    const crossOrigin = await fetch(`${baseUrl}/api/v2/agent-test-preview/credentials`, {
      headers: { Origin: "https://attacker.example", "Sec-Fetch-Site": "cross-site" },
    });
    assert.equal(crossOrigin.status, 403);
    const query = await fetch(`${baseUrl}/api/v2/agent-test-preview/credentials?debug=1`);
    assert.equal(query.status, 403);
  });

  const disabledHandler = createAgentPreviewApi();
  await withServer(disabledHandler, async (baseUrl) => {
    const hidden = await fetch(`${baseUrl}/api/v2/agent-test-preview/credentials`);
    assert.equal(hidden.status, 200);
    assert.deepEqual(await hidden.json(), { enabled: false });
  });
});

test("preview launcher refuses explicit project database or production settings", () => {
  const script = fileURLToPath(new URL("../../scripts/start-v2-agent-preview.sh", import.meta.url));
  for (const env of [
    { V2_DATABASE_URL: LOCAL_URL },
    { V2_USE_PROJECT_DATABASE: "true" },
    { NODE_ENV: "production" },
  ]) {
    const run = spawnSync("bash", [script], {
      cwd: ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        V2_DATABASE_URL: "",
        V2_USE_PROJECT_DATABASE: "",
        NODE_ENV: "development",
        ...env,
      },
      timeout: 5000,
    });
    assert.equal(run.status, 1);
    assert.doesNotMatch(run.stdout + run.stderr, /runner@127\.0\.0\.1/);
  }
});

test("existing Project workflow still points at the shared-database launcher", async () => {
  const config = await readFile(`${ROOT}/.replit`, "utf8");
  const launcher = await readFile(`${ROOT}/scripts/start-v2.sh`, "utf8");
  assert.match(config, /runButton = "Project"/);
  assert.match(config, /args = "V2_USE_PROJECT_DATABASE=true NODE_ENV=development bash scripts\/start-v2\.sh"/);
  assert.match(config, /name = "V2 Agent Test Preview"/);
  assert.match(config, /args = "bash scripts\/start-v2-agent-preview\.sh"/);
  assert.match(launcher, /V2_USE_PROJECT_DATABASE/);
});
