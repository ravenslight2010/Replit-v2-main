import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chromium } from "../node_modules/playwright/index.mjs";
import { startV2Server } from "./main.mjs";

const MANAGER_USERNAME = "V2IntegrationManager";
const MANAGER_PASSWORD = "v2-test-manager-password";

async function signIn(baseUrl, context) {
  const unauthenticated = await fetch(`${baseUrl}/api/v2/auth/session`);
  assert.equal(unauthenticated.status, 401, "a fresh browser context must start unauthenticated");
  const response = await fetch(`${baseUrl}/api/v2/auth/sign-in`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: baseUrl,
      "Sec-Fetch-Site": "same-origin",
    },
    body: JSON.stringify({ username: MANAGER_USERNAME, password: MANAGER_PASSWORD }),
  });
  assert.equal(response.status, 200, "the seeded manager account must sign in");
  const cookies = response.headers.getSetCookie().map((cookie) => {
    const [pair, ...attributes] = cookie.split(";");
    const separator = pair.indexOf("=");
    const flags = attributes.map((attribute) => attribute.trim().toLowerCase());
    return {
      name: pair.slice(0, separator),
      value: pair.slice(separator + 1),
      url: baseUrl,
      httpOnly: flags.includes("httponly"),
      secure: flags.includes("secure"),
      sameSite: "Lax",
    };
  });
  await context.addCookies(cookies);
}

async function main() {
  const databaseUrl = process.env.V2_DATABASE_URL;
  if (!databaseUrl) throw new Error("The disposable V2 PostgreSQL URL is required.");
  const parsedDatabaseUrl = new URL(databaseUrl);
  assert.equal(parsedDatabaseUrl.hostname, "127.0.0.1", "QC browser integration must use local disposable PostgreSQL");
  assert.equal(parsedDatabaseUrl.pathname, "/v2_test", "QC browser integration must use the disposable v2_test database");

  const errors = [];
  let serverInstance;
  let browser;
  let context;
  try {
    serverInstance = await startV2Server({
      env: {
        ...process.env,
        NODE_ENV: "development",
        PORT: "0",
        V2_DATABASE_URL: databaseUrl,
      },
      logger: (entry) => {
        if (entry?.level === "error") errors.push("server emitted an error");
      },
    });
    const address = serverInstance.server.address();
    assert.ok(address && typeof address !== "string");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const chromiumPath = process.env.CHROMIUM_PATH
      || execFileSync("which", ["chromium"], { encoding: "utf8" }).trim();
    browser = await chromium.launch({
      headless: true,
      executablePath: chromiumPath,
      args: ["--no-sandbox"],
    });
    context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error" && !message.text().includes("Failed to preconnect to https://fonts.")) {
        errors.push(message.text());
      }
    });

    await signIn(baseUrl, context);
    await page.goto(baseUrl);
    await page.locator("#authenticated-app:not([hidden])").waitFor();
    await page.locator("#manager-tools:not([hidden])").waitFor();
    await page.locator("#run-product").selectOption("DOUGH-A");
    await page.locator("#run-production-setup").selectOption("LINE-A");
    await page.locator("#setup-label").fill(`QC observation ${randomUUID().slice(0, 8)}`);
    await page.locator("#target-cases").fill("1");
    await page.waitForFunction(() => {
      const button = document.querySelector("#create-button");
      return button instanceof HTMLButtonElement && !button.disabled;
    });
    const runResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/v2/runs" && response.request().method() === "POST");
    await page.getByTestId("button-create-run").click();
    const runResponse = await runResponsePromise;
    const created = await runResponse.json();
    assert.equal(runResponse.status(), 201, JSON.stringify(created));
    assert.ok(Array.isArray(created.run?.setupSnapshot?.productionPlan?.recipes));
    await page.locator("#qc-panel:not([hidden])").waitFor();
    await page.getByRole("heading", { name: "QC target settings" }).waitFor();

    const checkpoint = page.locator('form[data-qc-action="checkpoint"]');
    await checkpoint.locator('select[name="checkpointType"]').selectOption("temperature");
    await checkpoint.locator('select[name="stationKey"]').selectOption("dough");
    await checkpoint.locator('input[name="checkpointLabel"]').fill("Mixer display observation");
    await checkpoint.locator('input[name="observedValue"]').fill("42");
    await checkpoint.locator('select[name="unit"]').selectOption("°C");
    const checkpointResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === `/api/v2/qc/runs/${created.run.id}/events`
      && response.request().method() === "POST");
    await checkpoint.getByRole("button", { name: "Record checkpoint" }).click();
    const checkpointResponse = await checkpointResponsePromise;
    assert.equal(checkpointResponse.status(), 201);
    await page.getByText("Checkpoint observation saved. No safety criterion was evaluated.").waitFor();
    await page.locator("#qc-event-list")
      .getByText(/Temperature · Mixer display observation · 42 °C · not evaluated/)
      .waitFor({ timeout: 5000 }).catch(async () => {
        const history = await page.evaluate(async (runId) => {
          const response = await fetch(`/api/v2/qc/runs/${runId}`);
          const body = await response.json();
          return {
            status: response.status,
            events: Array.isArray(body.events)
              ? body.events.map((event) => ({ eventType: event.eventType, payload: event.payload }))
              : null,
          };
        }, created.run.id);
        throw new Error(JSON.stringify({
          runId: created.run.id,
          postPath: new URL(checkpointResponse.url()).pathname,
          historyText: await page.locator("#qc-event-list").innerText(),
          qcError: await page.locator("#qc-error").innerText(),
          history,
        }));
      });

    const checkpointEventId = await page.locator('#qc-event-list .qc-event[data-event-type="checkpoint-observed"]')
      .first().getAttribute("data-event-id");
    assert.match(checkpointEventId ?? "", /^[0-9a-f-]{36}$/i);
    const correction = page.locator(`form[data-qc-action="correction"][data-target-event-id="${checkpointEventId}"]`);
    await correction.locator("..").locator("summary").click();
    await correction.locator('input[name="correctedText"]').fill("Corrected observation label");
    await correction.locator('input[name="reason"]').fill("Transcription correction");
    await correction.getByRole("button", { name: "Add correction" }).click();
    await page.locator("#qc-event-list").getByText(/Correction: Corrected observation label · Transcription correction/).waitFor();

    const reviewFlag = page.locator('form[data-qc-action="review-flag"]');
    await reviewFlag.locator('select[name="targetType"]').selectOption("run");
    await reviewFlag.locator('input[name="reason"]').fill("Manager review requested");
    await reviewFlag.getByRole("button", { name: "Flag for manager review" }).click();
    await page.getByText("Review flag saved. Production and shipping remain available.").waitFor();
    await page.locator("#qc-event-list").getByText(/Needs review · run · Manager review requested/).waitFor();

    const flagId = await page.locator('#qc-event-list .qc-event[data-event-type="review-flag-raised"]')
      .first().getAttribute("data-event-id");
    assert.match(flagId ?? "", /^[0-9a-f-]{36}$/i);
    const managerReview = page.locator(`form[data-qc-action="review-flag-review"][data-target-event-id="${flagId}"]`);
    await managerReview.locator('input[name="reviewNote"]').fill("Reviewed; follow-up remains advisory.");
    await managerReview.getByRole("button", { name: "Record manager review" }).click();
    await page.getByText("Manager review added to the flag history.").waitFor();
    await page.locator("#qc-event-list").getByText(/Manager review recorded · Reviewed; follow-up remains advisory\./).waitFor();

    await page.reload();
    await page.locator("#authenticated-app:not([hidden])").waitFor();
    await page.locator(`#runs-list button[data-run-id="${created.run.id}"]`).click();
    await page.locator("#qc-panel:not([hidden])").waitFor();
    await page.locator("#qc-event-list")
      .getByText(/Temperature · Mixer display observation · 42 °C · not evaluated/)
      .waitFor({ timeout: 5000 }).catch(async () => {
        const state = await page.evaluate(async (runId) => {
          const selected = document.querySelector("#runs-list [aria-current=true]")?.getAttribute("data-run-id");
          const response = await fetch(`/api/v2/qc/runs/${runId}`);
          const body = await response.json();
          return {
            selectedRunId: selected,
            historyStatus: response.status,
            eventSummaries: Array.isArray(body.events)
              ? body.events.map((event) => ({ eventType: event.eventType, payload: event.payload }))
              : null,
            renderedHistory: document.querySelector("#qc-event-list")?.innerText,
            qcStatus: document.querySelector("#qc-status")?.textContent,
            qcError: document.querySelector("#qc-error")?.textContent,
          };
        }, created.run.id);
        throw new Error(JSON.stringify(state));
      });
    await page.locator("#qc-event-list").getByText(/Correction: Corrected observation label · Transcription correction/).waitFor();
    await page.locator("#qc-event-list").getByText(/Manager review recorded · Reviewed; follow-up remains advisory\./).waitFor();
    assert.deepEqual(errors, []);
    console.log("V2 authenticated QC Chromium journey passed: manager sign-in, run-linked observation, append-only correction, advisory run flag, manager review, and reload persistence.");
  } finally {
    await context?.close();
    await browser?.close();
    await serverInstance?.close();
  }
}

await main();
