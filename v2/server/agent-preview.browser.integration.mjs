import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { createServer as createTcpServer } from "node:net";
import { chromium } from "../node_modules/playwright/index.mjs";
import pg from "pg";
import { applyAgentPreviewSchema } from "../db/agent-preview-schema.mjs";
import { startStationWorkerProcess } from "./worker-main.mjs";
import {
  AGENT_PREVIEW_PASSWORD,
  AGENT_PREVIEW_USERNAME,
  seedAgentPreviewFixture,
} from "./agent-preview-fixture.mjs";
import { startV2Server } from "./main.mjs";

const { Pool } = pg;
const tempDir = await mkdtemp(join(tmpdir(), "v2-agent-preview-browser-"));
const dataDir = join(tempDir, "data");
const databasePort = Number(execFileSync("python3", ["-c", [
  "import socket",
  "s=socket.socket()",
  "s.bind(('127.0.0.1', 0))",
  "print(s.getsockname()[1])",
  "s.close()",
].join(";")], { encoding: "utf8" }).trim());
const pgBin = dirname(execFileSync("which", ["initdb"], { encoding: "utf8" }).trim());
const databaseUser = execFileSync("id", ["-un"], { encoding: "utf8" }).trim();
const databaseUrl = `postgresql://${encodeURIComponent(databaseUser)}@127.0.0.1:${databasePort}/v2_agent_preview`;
const adminPool = new Pool({
  connectionString: databaseUrl,
  max: 2,
  connectionTimeoutMillis: 3000,
});
let postgresStarted = false;
let worker;
let app;
let browser;

async function nextLoopbackPort() {
  const server = createTcpServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  return port;
}

try {
  execFileSync(`${pgBin}/initdb`, [
    "-D", dataDir,
    "-U", databaseUser,
    "--no-locale",
    "--encoding=UTF8",
    "--auth-local=reject",
    "--auth-host=trust",
  ], { stdio: "ignore" });
  execFileSync(`${pgBin}/pg_ctl`, [
    "-D", dataDir,
    "-o", `-F -p ${databasePort} -h 127.0.0.1 -k ${tempDir}`,
    "-l", join(tempDir, "postgres.log"),
    "-w", "start",
  ], { stdio: "ignore" });
  postgresStarted = true;
  execFileSync(`${pgBin}/createdb`, [
    "-h", "127.0.0.1",
    "-p", String(databasePort),
    "-U", databaseUser,
    "v2_agent_preview",
  ], { stdio: "ignore" });

  await applyAgentPreviewSchema(adminPool);
  await seedAgentPreviewFixture(adminPool);
  const identity = await adminPool.query(
    "SELECT current_database() AS database_name, host(inet_server_addr()) AS server_address",
  );
  assert.deepEqual(identity.rows[0], {
    database_name: "v2_agent_preview",
    server_address: "127.0.0.1",
  });
  assert.equal(
    (await adminPool.query("SELECT count(*)::int AS count FROM v2.staff_accounts")).rows[0].count,
    1,
    "the preview contains only its seeded manager before browser mutations",
  );
  assert.equal(
    (await adminPool.query("SELECT count(*)::int AS count FROM v2.runs")).rows[0].count,
    1,
    "the preview contains only its synthetic run",
  );
  assert.equal(
    (await adminPool.query("SELECT count(*)::int AS count FROM v2.products")).rows[0].count,
    3,
    "the preview contains only synthetic products",
  );

  const workerHealthPort = await nextLoopbackPort();
  const runtimeEnv = {
    NODE_ENV: "development",
    V2_AGENT_TEST_PREVIEW: "true",
    V2_DATABASE_URL: databaseUrl,
    V2_WORKER_HEALTH_PORT: String(workerHealthPort),
  };
  worker = await startStationWorkerProcess({
    env: runtimeEnv,
    logger: () => {},
  });
  app = await startV2Server({
    env: {
      ...runtimeEnv,
      PORT: "0",
    },
    logger: () => {},
  });
  const baseUrl = `http://127.0.0.1:${app.server.address().port}`;
  let readyResponse;
  let readiness;
  const readinessDeadline = Date.now() + 10_000;
  while (Date.now() < readinessDeadline) {
    readyResponse = await fetch(`${baseUrl}/api/healthz`);
    if (readyResponse.ok) {
      readiness = await readyResponse.json();
      if (["active", "standby"].includes(readiness.stationWorker?.status)) break;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(readyResponse.status, 200, "the V2 readiness endpoint includes the started station worker");
  assert.equal(readiness.status, "ok");
  assert.ok(
    ["active", "standby"].includes(readiness.stationWorker?.status),
    `the V2 station worker must be ready, received ${readiness.stationWorker?.status ?? "no status"}`,
  );
  const chromiumPath = process.env.CHROMIUM_PATH
    || execFileSync("which", ["chromium"], { encoding: "utf8" }).trim();
  browser = await chromium.launch({ headless: true, executablePath: chromiumPath, args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto(baseUrl);
  await page.locator("#auth-panel:not([hidden])").waitFor();
  await page.getByRole("heading", { name: "Sign in to the floor." }).waitFor();
  const previewSignIn = page.getByTestId("button-agent-preview-sign-in");
  await previewSignIn.waitFor({ state: "visible" });
  const signInRequest = page.waitForRequest((request) =>
    new URL(request.url()).pathname === "/api/v2/auth/sign-in" && request.method() === "POST");
  await previewSignIn.click();
  const submitted = await signInRequest;
  assert.deepEqual(submitted.postDataJSON(), {
    username: AGENT_PREVIEW_USERNAME,
    password: AGENT_PREVIEW_PASSWORD,
  });
  await page.locator("#authenticated-app:not([hidden])").waitFor();
  await page.getByTestId("text-current-staff").getByText(`${AGENT_PREVIEW_USERNAME} · manager`).waitFor();
  await page.getByText("Synthetic Preview Run", { exact: false }).first().waitFor();

  const cookies = await context.cookies(baseUrl);
  const sessionCookie = cookies.find((cookie) => cookie.name === "v2_session");
  const csrfCookie = cookies.find((cookie) => cookie.name === "v2_csrf");
  assert.equal(sessionCookie?.httpOnly, true, "the regular V2 session cookie remains HttpOnly");
  assert.equal(csrfCookie?.httpOnly, false, "the regular V2 CSRF cookie remains readable by the app");
  assert.equal(csrfCookie?.value.length, 43);

  await page.locator("#setup-nav-link").waitFor({ state: "visible" });
  await page.locator("#setup-nav-link").click();
  assert.equal(new URL(page.url()).hash, "#manager-tools");
  await page.locator("#manager-tools:not([hidden])").waitFor();
  await page.locator("#staff-panel:not([hidden])").waitFor();

  await page.reload();
  await page.locator("#authenticated-app:not([hidden])").waitFor();
  await page.locator("#staff-panel:not([hidden])").waitFor();
  await page.getByText("Synthetic Preview Run", { exact: false }).first().waitFor();

  await page.locator("#new-staff-username").fill("preview-write-check");
  await page.locator("#new-staff-password").fill("synthetic-write-check-password");
  await page.locator("#new-staff-role").selectOption("operator");
  const staffWrite = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/v2/auth/staff"
    && response.request().method() === "POST");
  await page.locator("#create-staff-button").click();
  const staffWriteResponse = await staffWrite;
  assert.equal(staffWriteResponse.status(), 201);
  await page.locator("#staff-list").getByText("preview-write-check", { exact: true }).waitFor();
  assert.equal(
    (await adminPool.query("SELECT count(*)::int AS count FROM v2.staff_accounts")).rows[0].count,
    2,
    "the browser write is confined to the disposable preview database",
  );

  const signOutResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/v2/auth/sign-out");
  await page.getByTestId("button-sign-out").click();
  assert.equal((await signOutResponse).status(), 204);
  await page.locator("#auth-panel:not([hidden])").waitFor();
  assert.equal(await page.locator("#agent-preview-sign-in").isVisible(), true);
  const signedOutSession = await page.evaluate(async () =>
    (await fetch("/api/v2/auth/session", { credentials: "same-origin" })).status);
  assert.equal(signedOutSession, 401);

  assert.deepEqual(pageErrors, [], "the authenticated browser journey has no uncaught page errors");
  console.log("V2 agent preview browser sign-in, navigation, reload, writes, and sign-out passed.");
} finally {
  await browser?.close();
  await app?.close();
  await worker?.close();
  await adminPool.end();
  if (postgresStarted) {
    execFileSync(`${pgBin}/pg_ctl`, ["-D", dataDir, "-m", "immediate", "-w", "stop"], { stdio: "ignore" });
  }
  await rm(tempDir, { recursive: true, force: true });
  await assert.rejects(access(tempDir), { code: "ENOENT" });
}
