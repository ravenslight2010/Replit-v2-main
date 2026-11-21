import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium, webkit as localWebkit } from "../../node_modules/.pnpm/node_modules/playwright/index.mjs";
import { captureFailureScreenshots } from "./browser-failure-screenshot.mjs";

const webkit = process.env.V2_WEBKIT_PLAYWRIGHT_MODULE
  ? createRequire(import.meta.url)(process.env.V2_WEBKIT_PLAYWRIGHT_MODULE).webkit
  : localWebkit;

const QC_API = "/api/v2/qc";
const RUN_ID = "88000000-0000-4000-8000-000000000001";
const PRODUCT_ID = "88000000-0000-4000-8000-000000000002";
const MANAGER_ID = "88000000-0000-4000-8000-000000000003";
const OPERATOR_ID = "88000000-0000-4000-8000-000000000004";
const MOZZ_ID = "88000000-0000-4000-8000-000000000005";
const REPLACEMENT_ID = "88000000-0000-4000-8000-000000000006";

const panelHtml = `
  <main style="max-width:1200px;margin:0 auto;padding:16px">
    <section class="qc-panel" id="qc-panel" aria-labelledby="qc-heading" hidden>
      <div class="qc-panel-heading">
        <div><p class="eyebrow intro-kicker">QUALITY RECORDS · ADVISORY</p><h2 id="qc-heading">QC and run review</h2>
        <p class="manager-tools-copy">Records stay linked to this run. QC outcomes do not stop production or shipping.</p></div>
        <span class="qc-review-badge" id="qc-review-badge">Loading review</span>
      </div>
      <p class="qc-status" id="qc-status" role="status" aria-live="polite"></p>
      <div class="qc-error" id="qc-error" role="alert" hidden></div>
      <div class="qc-grid" id="qc-forms"></div>
      <section class="qc-history" aria-labelledby="qc-history-heading">
        <div class="qc-history-heading">
          <div><p class="eyebrow">FACILITY-RETAINED · SERVER-TIMESTAMPED</p><h3 id="qc-history-heading">Run QC history</h3></div>
          <div class="qc-history-actions">
            <button class="button button-secondary button-small" id="qc-export" type="button" hidden>Export facility history</button>
            <button class="button button-secondary button-small" id="qc-refresh" type="button">Refresh QC</button>
          </div>
        </div>
        <ol class="qc-event-list" id="qc-event-list" aria-live="polite"></ol>
      </section>
      <section class="qc-history" aria-labelledby="qc-facility-history-heading">
        <div class="qc-history-heading"><div><p class="eyebrow">FACILITY-SCOPED · MOST RECENT 100</p><h3 id="qc-facility-history-heading">Facility QC history</h3></div></div>
        <ol class="qc-event-list" id="qc-facility-event-list" aria-live="polite"></ol>
      </section>
    </section>
  </main>
  <script type="module">
    import { initializeQc } from "/v2/web/qc.js";
    const qc = initializeQc();
    window.setQcContext = (staff, run, writable) => qc.updateContext({ staff, run, writable });
  </script>`;

function staff(id, role) {
  return {
    userId: id,
    capabilities: role === "manager" ? ["record-qc", "manage-qc", "manage-allergens"] : ["record-qc"],
  };
}

function eventRecord(eventType, payload, actorId = MANAGER_ID, runId = RUN_ID) {
  return {
    id: crypto.randomUUID(),
    runId,
    actorId,
    eventType,
    payload,
    occurredAt: new Date().toISOString(),
  };
}

test("QC manager and operator screens preserve advisory states and fit phone/tablet layouts", { timeout: 60_000 }, async (t) => {
  const webDir = fileURLToPath(new URL("../web/", import.meta.url));
  const qcSource = await readFile(new URL("../web/qc.js", import.meta.url));
  const cssSource = await readFile(new URL("../web/styles.css", import.meta.url));
  let settings = [];
  let events = [];
  const ingredientLinks = {
    products: [{
      productId: PRODUCT_ID,
      productCode: "FLOUR-QC",
      productName: "Flour",
      ingredientCode: null,
      ingredientName: null,
    }],
    productsTruncated: false,
    ingredients: [{
      ingredientCode: "FLOUR-BASE",
      ingredientName: "Flour",
      allergens: [],
      allergensReviewed: true,
      updatedAt: new Date().toISOString(),
    }],
    ingredientsTruncated: false,
    events: [],
  };
  const items = [{
    productId: PRODUCT_ID,
    productCode: "FLOUR-QC",
    productName: "Flour",
    unit: "lb",
    recipeCode: "DOUGH-BASE",
    recipeName: "Dough base",
    stationKey: "dough",
  }, {
    productId: MOZZ_ID,
    productCode: "MOZZ-QC",
    productName: "Mozzarella",
    unit: "lb",
    recipeCode: "CHEESE-BASE",
    recipeName: "Cheese base",
    stationKey: "cheese",
  }];
  const componentProducts = [
    { productId: PRODUCT_ID, productCode: "FLOUR-QC", productName: "Flour", unit: "lb" },
    { productId: MOZZ_ID, productCode: "MOZZ-QC", productName: "Mozzarella", unit: "lb" },
    { productId: REPLACEMENT_ID, productCode: "MONTEREY-QC", productName: "Monterey", unit: "lb" },
  ];
  let substitutions = [];
  const components = items.map((item) => ({ ...item, substitution: false }));
  const run = {
    id: RUN_ID,
    status: "running",
    setupSnapshot: { productCode: "PIZZA-QC", productionPlan: { recipes: [
      { code: "DOUGH-BASE", stationKey: "dough", ingredients: [] },
      { code: "CHEESE-BASE", stationKey: "cheese", ingredients: [] },
    ] } },
  };
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url, "http://v2.test").pathname;
    if (pathname === "/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<link rel="stylesheet" href="/v2/web/styles.css">${panelHtml}`);
      return;
    }
    if (pathname === "/v2/web/qc.js") {
      response.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
      response.end(qcSource);
      return;
    }
    if (pathname === "/v2/web/styles.css") {
      response.writeHead(200, { "content-type": "text/css; charset=utf-8" });
      response.end(cssSource);
      return;
    }
    if (pathname === "/favicon.ico") {
      response.writeHead(204).end();
      return;
    }
    if (!pathname.startsWith(QC_API)) {
      response.writeHead(404).end();
      return;
    }
    const json = (status, body) => {
      response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      response.end(JSON.stringify(body));
    };
    if (pathname === `${QC_API}/runs/${RUN_ID}/operational-status` && request.method === "GET") {
      const allergenFootprint = {
        status: "unknown",
        allergens: [],
        ingredientCount: items.length,
        unknownIngredients: [],
      };
      json(200, {
        runId: RUN_ID,
        substitutions,
        allergenFootprint,
        stations: Object.fromEntries(["dough", "cheese", "pepperoni", "sauce", "frontline"].map((key) => [
          key,
          {
            substitutions: substitutions.filter((substitution) =>
              substitution.sourceItems.some((source) => source.stationKey === key)),
            allergenFootprint,
          },
        ])),
        limitations: { allergens: "incomplete" },
      });
      return;
    }
    if (pathname === `${QC_API}/runs/${RUN_ID}` && request.method === "GET") {
      json(200, {
        run,
        items,
        substitutions,
        components: [
          ...components,
          ...substitutions.map((substitution) => ({
            productId: substitution.replacementProductId,
            productCode: substitution.replacementProductCode,
            productName: substitution.replacementProductName,
            recipeCode: "QC-SUBSTITUTION",
            recipeName: "Approved substitution",
            stationKey: substitution.sourceItems[0].stationKey,
            unit: substitution.replacementUnit,
            substitution: true,
          })),
        ],
        componentProducts,
        events: events.filter((event) => event.runId === RUN_ID).slice(-100).reverse(),
        settings,
        review: { status: events.some((event) => event.eventType === "review-signed-off") ? "signed-off" : "needs-review", signedOffAt: null, signedOffBy: null },
        allergenFootprint: {
          status: "unknown",
          allergens: [],
          ingredientCount: items.length,
          unknownIngredients: [{
            productId: PRODUCT_ID,
            productCode: "FLOUR-QC",
            productName: "Flour",
            stationKey: "dough",
            reason: "missing-link",
          }],
        },
        limitations: { allergens: "incomplete", components: "available", reason: null },
      });
      return;
    }
    if (pathname === `${QC_API}/ingredient-links` && request.method === "GET") {
      json(200, ingredientLinks);
      return;
    }
    if (pathname === `${QC_API}/ingredient-links` && request.method === "POST") {
      const body = await readRequest(request);
      const product = ingredientLinks.products.find((item) => item.productId === body.productId);
      const ingredient = ingredientLinks.ingredients.find((item) => item.ingredientCode === body.ingredientCode);
      const event = {
        id: crypto.randomUUID(),
        actorId: MANAGER_ID,
        productId: product.productId,
        productCode: product.productCode,
        productName: product.productName,
        action: body.ingredientCode ? "linked" : "unlinked",
        previousIngredientCode: product.ingredientCode,
        previousIngredientName: product.ingredientName,
        ingredientCode: body.ingredientCode,
        ingredientName: ingredient?.ingredientName ?? null,
        occurredAt: new Date().toISOString(),
      };
      Object.assign(product, { ingredientCode: event.ingredientCode, ingredientName: event.ingredientName });
      ingredientLinks.events.unshift(event);
      json(201, { event, replayed: false });
      return;
    }
    if (pathname === `${QC_API}/runs/${RUN_ID}/substitutions` && request.method === "POST") {
      const body = await readRequest(request);
      const product = componentProducts.find((item) => item.productId === body.replacementProductId);
      const proposal = eventRecord("run-substitution-proposed", {
        sourceItems: body.sourceItems,
        replacementProductId: body.replacementProductId,
        replacementProductCode: product.productCode,
        replacementProductName: product.productName,
        replacementQuantity: body.replacementQuantity,
        replacementUnit: body.replacementUnit,
        reason: body.reason,
      }, OPERATOR_ID);
      events.push(proposal);
      json(201, { event: proposal, replayed: false });
      return;
    }
    const decisionPath = pathname.match(/^\/api\/v2\/qc\/runs\/([^/]+)\/substitutions\/([^/]+)\/decision$/);
    if (decisionPath && request.method === "POST") {
      const body = await readRequest(request);
      const proposal = events.find((event) => event.id === decisionPath[2]);
      const event = eventRecord(body.decision === "approve" ? "run-substitution-approved" : "run-substitution-rejected", {
        proposalEventId: decisionPath[2],
        replacementProductId: proposal.payload.replacementProductId,
        replacementProductCode: proposal.payload.replacementProductCode,
        replacementProductName: proposal.payload.replacementProductName,
        replacementQuantity: proposal.payload.replacementQuantity,
        replacementUnit: proposal.payload.replacementUnit,
        sourceItems: proposal.payload.sourceItems,
        reason: body.reason ?? proposal.payload.reason,
      });
      events.push(event);
      if (body.decision === "approve") {
        substitutions = [{
          id: crypto.randomUUID(),
          proposalEventId: proposal.id,
          revision: 1,
          sourceItems: proposal.payload.sourceItems.map((source) => {
            const item = items.find((candidate) => candidate.productId === source.productId);
            return { ...source, productCode: item.productCode, productName: item.productName, recipeName: item.recipeName };
          }),
          replacementProductId: proposal.payload.replacementProductId,
          replacementProductCode: proposal.payload.replacementProductCode,
          replacementProductName: proposal.payload.replacementProductName,
          replacementQuantity: proposal.payload.replacementQuantity,
          replacementUnit: proposal.payload.replacementUnit,
          replacementIngredientSnapshot: null,
          actorId: MANAGER_ID,
          movementGroupId: event.id,
          occurredAt: event.occurredAt,
        }];
      }
      json(201, { event, replayed: false });
      return;
    }
    const correctionPath = pathname.match(/^\/api\/v2\/qc\/runs\/([^/]+)\/substitutions\/([^/]+)\/corrections$/);
    if (correctionPath && request.method === "POST") {
      const body = await readRequest(request);
      const current = substitutions.find((item) => item.id === correctionPath[2]);
      const product = componentProducts.find((item) => item.productId === body.replacementProductId);
      const event = eventRecord("run-substitution-corrected", {
        targetSubstitutionId: current.id,
        replacementProductId: body.replacementProductId,
        replacementProductName: product.productName,
        replacementQuantity: body.replacementQuantity,
        replacementUnit: body.replacementUnit,
        reason: body.reason,
      });
      events.push(event);
      current.revision += 1;
      current.replacementProductId = body.replacementProductId;
      current.replacementProductCode = product.productCode;
      current.replacementProductName = product.productName;
      current.replacementQuantity = body.replacementQuantity;
      current.replacementUnit = body.replacementUnit;
      json(201, { event, replayed: false });
      return;
    }
    if (pathname === `${QC_API}/history` && request.method === "GET") {
      json(200, { events: [...events].slice(-100).reverse() });
      return;
    }
    if (pathname === `${QC_API}/settings` && request.method === "POST") {
      const body = await readRequest(request);
      const setting = {
        id: crypto.randomUUID(),
        actorId: MANAGER_ID,
        settingKey: body.settingType === "brix"
          ? `brix:${body.subjectCode.toLowerCase()}`
          : `weight:${body.subjectCode.toLowerCase()}:${body.stationKey}:${body.unit}`,
        ...body,
        tolerance: body.settingType === "weight-override" && !body.tolerance ? "0.1" : body.tolerance,
        occurredAt: new Date().toISOString(),
      };
      settings = [...settings.filter((candidate) => candidate.settingKey !== setting.settingKey), setting];
      events.push(eventRecord("qc-setting-reviewed", setting, MANAGER_ID, null));
      json(201, { event: eventRecord("qc-setting-reviewed", setting, MANAGER_ID, null), replayed: false });
      return;
    }
    if (pathname === `${QC_API}/settings/redactions` && request.method === "POST") {
      const body = await readRequest(request);
      settings = settings.filter((setting) => setting.id !== body.targetEventId);
      events.push(eventRecord("redaction", { targetEventId: body.targetEventId, reason: body.reason }, MANAGER_ID, null));
      json(201, { event: events.at(-1), replayed: false });
      return;
    }
    const eventPath = pathname.match(/^\/api\/v2\/qc\/runs\/([^/]+)\/events$/);
    if (eventPath && request.method === "POST") {
      const body = await readRequest(request);
      const actorId = body.eventType === "cleaning-verified" ? OPERATOR_ID : MANAGER_ID;
      if (body.eventType === "cleaning-verified") {
        const target = events.find((event) => event.id === body.targetEventId);
        if (!target || target.actorId === actorId) {
          json(403, { error: "A different authenticated QC staff member must verify cleaning." });
          return;
        }
      }
      if (body.eventType === "review-flag-reviewed"
        && !events.some((event) => event.id === body.targetEventId && event.eventType === "review-flag-raised")) {
        json(404, { error: "QC review flag is unavailable." });
        return;
      }
      const event = eventRecord(body.eventType, payloadFor(body, settings), actorId, eventPath[1]);
      events.push(event);
      json(201, { event, replayed: false });
      return;
    }
    if (pathname === `${QC_API}/export.csv` && request.method === "GET") {
      response.writeHead(200, { "content-type": "text/csv; charset=utf-8" });
      response.end('"event_id","run_id","actor_id"\r\n');
      return;
    }
    json(404, { error: "Not found." });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));

  const browserType = process.env.QC_BROWSER === "webkit" ? webkit : chromium;
  const launchOptions = { headless: true };
  if (browserType === chromium) {
    launchOptions.executablePath = process.env.CHROMIUM_PATH
      || execFileSync("which", ["chromium"], { encoding: "utf8" }).trim();
    launchOptions.args = ["--no-sandbox"];
  } else if (process.env.V2_WEBKIT_SKIP_HOST_REQUIREMENTS === "1") {
    if (process.env.V2_WEBKIT_EXECUTABLE_PATH) {
      launchOptions.executablePath = process.env.V2_WEBKIT_EXECUTABLE_PATH;
    }
  }
  const browserEnvOverrides = browserType === webkit && process.env.V2_WEBKIT_SKIP_HOST_REQUIREMENTS === "1"
    ? {
      PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS: "1",
      ...(process.env.V2_WEBKIT_EGL_VENDOR
        ? { __EGL_VENDOR_LIBRARY_FILENAMES: process.env.V2_WEBKIT_EGL_VENDOR }
        : {}),
    }
    : {};
  const previousBrowserEnv = new Map(
    Object.keys(browserEnvOverrides).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, browserEnvOverrides);
  let browser;
  const failureScreenshotPages = [];
  try {
    browser = await browserType.launch(launchOptions);
  } finally {
    for (const [key, previousValue] of previousBrowserEnv) {
      if (previousValue === undefined) delete process.env[key];
      else process.env[key] = previousValue;
    }
  }
  t.after(async () => {
    await captureFailureScreenshots({
      testContext: t,
      browserType,
      suiteFile: "e2e/qc-workflow.browser.test.mjs",
      pages: failureScreenshotPages,
    });
    await browser.close();
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  failureScreenshotPages.push(page);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => typeof window.setQcContext === "function");
  await page.evaluate(({ manager, runData }) => {
    window.setQcContext(manager, runData, true);
  }, { manager: staff(MANAGER_ID, "manager"), runData: run });
  await page.locator("#qc-panel:not([hidden])").waitFor();
  await page.getByRole("heading", { name: "QC target settings" }).waitFor();
  await page.getByText("at least one ingredient link or allergen fact is missing or unreviewed", { exact: false }).waitFor();
  await page.getByRole("button", { name: "Record that I reviewed this footprint" }).click();
  await page.getByText("Footprint review recorded. Unknown ingredients remain unknown; this is not a clearance.").waitFor();
  assert.ok(events.some((event) => event.eventType === "run-check-reviewed"));
  const componentForm = page.locator('form[data-qc-action="component-check"]');
  await componentForm.locator('select[name="componentStatus-0"]').selectOption("present");
  await componentForm.getByRole("button", { name: "Record component observations" }).click();
  await page.getByText("Component observations recorded. This check does not block production.").waitFor();
  assert.equal(events.find((event) => event.payload.checkType === "component-presence")?.payload.observations.length, 2);

  const lotForm = page.locator('form[data-qc-action="lot"]');
  await lotForm.locator('input[name="lotCode"]').fill(" LOT 77 ");
  await lotForm.getByRole("button", { name: "Record lot" }).click();
  await page.getByText("Saved to the facility QC history.").first().waitFor();
  await page.locator('form[data-qc-action="weight"] input[name="actual"]').fill("3.25");
  await page.locator('form[data-qc-action="weight"] button[type="submit"]').click();
  await page.getByText("Saved. This reading is not evaluated because no approved target is available.").waitFor();
  assert.ok(events.some((event) => event.eventType === "weight-check"), `server did not receive weight event: ${JSON.stringify(events)}`);
  await page.waitForFunction(() => document.querySelector("#qc-event-list")?.textContent.includes("Weight 3.25 lb"), null, { timeout: 2000 })
    .catch(async () => {
      throw new Error(JSON.stringify({
        events,
        runHistory: await page.locator("#qc-event-list").innerText(),
        facilityHistory: await page.locator("#qc-facility-event-list").innerText(),
        status: await page.locator("#qc-status").innerText(),
        error: await page.locator("#qc-error").innerText(),
      }));
    });
  const weightHistory = await page.locator("#qc-event-list").innerText();
  assert.match(weightHistory, /Weight 3\.25 lb · not evaluated/, `unexpected run history:\n${weightHistory}; server events ${JSON.stringify(events)}`);

  await page.locator('form[data-qc-action="date-code"] input[name="observedText"]').fill("LOT 2026");
  await page.locator('form[data-qc-action="date-code"] button[type="submit"]').click();
  await page.getByText(/Printed text “LOT 2026” · not evaluated/).first().waitFor();

  const checkpointForm = page.locator('form[data-qc-action="checkpoint"]');
  await checkpointForm.locator('select[name="checkpointType"]').selectOption("time");
  await checkpointForm.locator('select[name="stationKey"]').selectOption("dough");
  await checkpointForm.locator('input[name="checkpointLabel"]').fill("Cooling observation");
  await checkpointForm.locator('input[name="observedValue"]').fill("2.5");
  await checkpointForm.locator('select[name="unit"]').selectOption("min");
  await checkpointForm.getByRole("button", { name: "Record checkpoint" }).click();
  await page.getByText("Checkpoint observation saved. No safety criterion was evaluated.").waitFor();
  await page.locator("#qc-event-list").getByText(/Elapsed time · Cooling observation · 2\.5 min · not evaluated/).first().waitFor();
  const checkpointEvent = events.find((event) => event.eventType === "checkpoint-observed");
  assert.equal(checkpointEvent.payload.evaluationStatus, "not_evaluated");
  assert.equal(checkpointEvent.payload.target, undefined);

  const actionForm = page.locator('form[data-qc-action="corrective-action"]');
  await actionForm.locator('select[name="targetEventId"]').selectOption(checkpointEvent.id);
  await actionForm.locator('input[name="actionObserved"]').fill("Moved product to the next station");
  await actionForm.locator('input[name="followUpNote"]').fill("QC review still needed");
  await actionForm.getByRole("button", { name: "Record action observation" }).click();
  await page.getByText("Corrective-action observation saved to QC history.").waitFor();
  await page.locator("#qc-event-list").getByText(/Corrective-action observation · Moved product to the next station/).first().waitFor();

  const lotRecord = events.find((event) => event.eventType === "lot-recorded");
  const flagForm = page.locator('form[data-qc-action="review-flag"]');
  await flagForm.locator('select[name="targetType"]').selectOption("lot");
  await flagForm.locator('select[name="targetEventId"]').selectOption(lotRecord.id);
  await flagForm.locator('input[name="reason"]').fill("Lot identity needs manager review");
  await flagForm.getByRole("button", { name: "Flag for manager review" }).click();
  await page.getByText("Review flag saved. Production and shipping remain available.").waitFor();
  await page.locator("#qc-event-list").getByText(/Needs review · lot record · Lot identity needs manager review/).first().waitFor();
  const reviewFlag = events.find((event) => event.eventType === "review-flag-raised");
  const managerReviewForm = page.locator(`form[data-qc-action="review-flag-review"][data-target-event-id="${reviewFlag.id}"]`);
  await managerReviewForm.locator('input[name="reviewNote"]').fill("Lot record checked; keep observing.");
  await managerReviewForm.getByRole("button", { name: "Record manager review" }).click();
  await page.getByText("Manager review added to the flag history.").waitFor();
  await page.locator("#qc-event-list").getByText(/Manager review recorded · Lot record checked; keep observing\./).first().waitFor();
  assert.ok(events.some((event) => event.eventType === "review-flag-reviewed"
    && event.payload.targetEventId === reviewFlag.id));

  const runFlagForm = page.locator('form[data-qc-action="review-flag"]');
  await runFlagForm.locator('select[name="targetType"]').selectOption("run");
  await runFlagForm.locator('input[name="reason"]').fill("Cooling observation needs manager follow-up");
  await runFlagForm.getByRole("button", { name: "Flag for manager review" }).click();
  await page.getByText("Review flag saved. Production and shipping remain available.").waitFor();
  const runReviewFlag = events.find((event) =>
    event.eventType === "review-flag-raised" && event.payload.targetType === "run");

  const correctionForm = page.locator(`form[data-qc-action="correction"][data-target-event-id="${checkpointEvent.id}"]`);
  await correctionForm.locator("..").locator("summary").click();
  await correctionForm.locator('input[name="correctedText"]').fill("Corrected display label");
  await correctionForm.locator('input[name="reason"]').fill("Transcription correction");
  await correctionForm.getByRole("button", { name: "Add correction" }).click();
  await page.locator("#qc-event-list").getByText(/Correction: Corrected display label · Transcription correction/).first().waitFor();
  assert.ok(events.some((event) => event.id === checkpointEvent.id && event.eventType === "checkpoint-observed"));
  assert.ok(events.some((event) => event.eventType === "correction"
    && event.payload.targetEventId === checkpointEvent.id));

  const cleaningForm = page.locator('form[data-qc-action="cleaning"]');
  await cleaningForm.locator('input[name="method"]').fill("Approved wash");
  await cleaningForm.locator('input[name="cleanedAt"]').fill("2026-11-18T10:15");
  await cleaningForm.getByRole("button", { name: "Record cleaning" }).click();
  await page.getByText(/Cleaning Approved wash · completed/).first().waitFor();
  const cleaningEvent = events.find((event) => event.eventType === "cleaning-recorded");
  assert.ok(cleaningEvent);

  await page.evaluate((operator) => {
    globalThis.activeQcActor = operator.userId;
    window.setQcContext(operator, { id: "88000000-0000-4000-8000-000000000001" }, true);
  }, staff(OPERATOR_ID, "operator"));
  await page.getByText("QC history is current on this device.").waitFor();
  assert.equal(await page.getByRole("heading", { name: "QC target settings" }).count(), 0);
  assert.equal(await page.locator("#qc-export").isVisible(), false);
  assert.equal(await page.locator('form[data-qc-action="review-flag-review"]').count(), 0);
  const verify = page.getByRole("button", { name: "Verify as a second staff member" });
  await verify.first().waitFor();
  await verify.first().click();
  await page.getByText(/verified by a second staff member/).first().waitFor();
  assert.notEqual(cleaningEvent.actorId, OPERATOR_ID);
  const substitutionForm = page.locator('form[data-qc-action="substitution-propose"]');
  const sourceRows = substitutionForm.locator("[data-source-row]");
  await sourceRows.nth(0).locator('select[name="sourceItemIndex"]').selectOption("0");
  await sourceRows.nth(0).locator('input[name="sourceQuantity"]').fill("5");
  await substitutionForm.getByRole("button", { name: "Add another source component" }).click();
  await sourceRows.nth(1).locator('select[name="sourceItemIndex"]').selectOption("1");
  await sourceRows.nth(1).locator('input[name="sourceQuantity"]').fill("20");
  await substitutionForm.locator('select[name="replacementProductId"]').selectOption(REPLACEMENT_ID);
  await substitutionForm.locator('input[name="replacementQuantity"]').fill("40");
  await substitutionForm.locator('input[name="reason"]').fill("Partial cheese blend replacement");
  await substitutionForm.getByRole("button", { name: "Submit for QC approval" }).click();
  await page.getByText(/Substitution proposed · 2 source components to 40 lb Monterey/).first().waitFor();
  const proposal = events.find((event) => event.eventType === "run-substitution-proposed");
  assert.equal(proposal.payload.sourceItems[0].quantity, "5");
  assert.equal(proposal.payload.sourceItems[1].quantity, "20");

  await page.evaluate((manager) => {
    globalThis.activeQcActor = manager.userId;
    window.setQcContext(manager, { id: "88000000-0000-4000-8000-000000000001" }, true);
  }, staff(MANAGER_ID, "manager"));
  const runReviewForm = page.locator(`form[data-qc-action="review-flag-review"][data-target-event-id="${runReviewFlag.id}"]`);
  await runReviewForm.waitFor({ state: "attached" });
  assert.equal(await runReviewForm.count(), 1);
  await runReviewForm.locator('input[name="reviewNote"]').fill("Run follow-up documented.");
  await runReviewForm.getByRole("button", { name: "Record manager review" }).click();
  await page.getByText("Manager review added to the flag history.").waitFor();
  await page.locator("#qc-event-list").getByText(/Manager review recorded · Run follow-up documented\./).first().waitFor();
  await page.getByRole("button", { name: "Approve and adjust stock" }).click();
  await page.getByText(/Substitution approved · 40 lb Monterey posted to inventory/).first().waitFor();
  await page.getByText("Correct substitution Monterey", { exact: true }).click();
  const correction = page.locator('form[data-qc-action="substitution-correction"]');
  await correction.locator('input[name="replacementQuantity"]').fill("35");
  await correction.locator('input[name="reason"]').fill("Corrected replacement amount");
  await correction.getByRole("button", { name: "Save correction and adjust stock" }).click();
  await page.getByText("Correction recorded with a compensating stock movement.").waitFor();

  const linkForm = page.locator('form[data-qc-action="ingredient-link"]');
  await linkForm.locator('select[name="ingredientCode"]').selectOption("FLOUR-BASE");
  await linkForm.locator('button[type="submit"]').click();
  await page.waitForFunction(() => {
    const status = document.querySelector('form[data-qc-action="ingredient-link"] [data-form-status]')?.textContent;
    return status?.length > 0;
  }, null, { timeout: 5000 }).catch(async () => {
    throw new Error(JSON.stringify({
      status: await linkForm.locator("[data-form-status]").textContent(),
      error: await page.locator("#qc-error").textContent(),
      buttonDisabled: await linkForm.locator("button[type=submit]").isDisabled(),
      productId: await linkForm.locator('select[name="productId"]').inputValue(),
      ingredientCode: await linkForm.locator('select[name="ingredientCode"]').inputValue(),
      events: ingredientLinks.events,
    }));
  });
  await page.getByText("Link recorded. Existing run snapshots do not change.").waitFor();
  assert.equal(ingredientLinks.events[0]?.ingredientCode, "FLOUR-BASE");
  await page.getByText("linked to Flour").last().waitFor();
  await page.locator('form[data-qc-action="weight-setting"] input[name="target"]').fill("1.5");
  await page.locator('form[data-qc-action="weight-setting"] input[name="sourceReference"]').fill("Approved reference 12");
  await page.locator('form[data-qc-action="weight-setting"] button[type="submit"]').click();
  await page.getByText(/Current reviewed settings/).waitFor();
  const weightForm = page.locator('form[data-qc-action="weight"]');
  await weightForm.locator('input[name="actual"]').fill("1.8");
  await weightForm.locator('input[name="reason"]').fill("Scale correction");
  await weightForm.locator('button[type="submit"]').click();
  await page.getByText(/Weight 1\.8 lb · out of tolerance/).first().waitFor();
  await page.locator('form[data-qc-action="brix-setting"] input[name="target"]').fill("5");
  await page.locator('form[data-qc-action="brix-setting"] input[name="tolerance"]').fill("0.25");
  await page.locator('form[data-qc-action="brix-setting"] input[name="sourceReference"]').fill("Approved Brix review");
  await page.locator('form[data-qc-action="brix-setting"] button[type="submit"]').click();
  await page.getByText(/Reviewed target 5 ± 0\.25 °Bx/).waitFor();

  await page.locator('form[data-qc-action="brix"] input[name="actual"]').fill("5.5");
  await page.locator('form[data-qc-action="brix"] button[type="submit"]').click();
  await page.getByText(/Brix 5\.5 °Bx · out of tolerance/).first().waitFor();
  await page.locator('form[data-qc-action="signoff"] button[type="submit"]').click();
  await page.getByText("Signed off", { exact: true }).waitFor();

  const settingsRedaction = page.locator('form[data-qc-action="setting-redaction"]').first();
  await page.getByText("Redact this setting", { exact: true }).first().click();
  await settingsRedaction.locator('input[name="reason"]').fill("Source reference withdrawn");
  await settingsRedaction.getByRole("button", { name: "Redact setting" }).click();
  await page.getByText("A prior record was redacted: Source reference withdrawn").waitFor();

  const secondDevice = await context.newPage();
  failureScreenshotPages.push(secondDevice);
  await secondDevice.goto(`http://127.0.0.1:${server.address().port}/`);
  await secondDevice.waitForFunction(() => typeof window.setQcContext === "function");
  await secondDevice.evaluate(({ operator, runData }) => {
    window.setQcContext(operator, runData, true);
  }, { operator: staff(OPERATOR_ID, "operator"), runData: run });
  const secondDeviceResponse = await secondDevice.evaluate(async ({ runId, productId }) => {
    const response = await fetch(`/api/v2/qc/runs/${runId}/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requestId: "cross-device-lot",
        eventType: "lot-recorded",
        productId,
        recipeCode: "DOUGH-BASE",
        stationKey: "dough",
        lotCode: "REMOTE-LOT",
      }),
    });
    return { status: response.status, body: await response.json() };
  }, { runId: RUN_ID, productId: PRODUCT_ID });
  assert.equal(secondDeviceResponse.status, 201);
  await page.getByText(/Lot REMOTE-LOT/).first().waitFor({ timeout: 10_000 });
  await secondDevice.close();

  await page.reload();
  await page.waitForFunction(() => typeof window.setQcContext === "function");
  await page.evaluate(({ manager, runData }) => {
    window.setQcContext(manager, runData, true);
  }, { manager: staff(MANAGER_ID, "manager"), runData: run });
  await page.getByText("QC history is current on this device.").waitFor();
  await page.locator("#qc-event-list").getByText(/Elapsed time · Cooling observation · 2\.5 min · not evaluated/).first().waitFor();
  await page.locator("#qc-event-list").getByText(/Manager review recorded · Lot record checked; keep observing\./).first().waitFor();
  assert.ok(events.some((event) => event.id === checkpointEvent.id));

  for (const viewport of [
    { width: 402, height: 874 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
  ]) {
    await page.setViewportSize(viewport);
    const dimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      page: document.documentElement.scrollWidth,
      panel: document.querySelector("#qc-panel").scrollWidth,
      panelWidth: document.querySelector("#qc-panel").clientWidth,
      internallyOverflowing: [...document.querySelectorAll("body *")].flatMap((element) =>
        element.scrollWidth > element.clientWidth + 1
          ? [{ tag: element.tagName, id: element.id, className: element.className, client: element.clientWidth, scroll: element.scrollWidth, text: element.textContent.trim().slice(0, 90) }]
          : [],
      ).slice(0, 12),
      overflow: [...document.querySelectorAll("body *")].flatMap((element) => {
        const rect = element.getBoundingClientRect();
        return rect.right > document.documentElement.clientWidth + 1 || rect.left < -1
          ? [{ tag: element.tagName, className: element.className, right: Math.round(rect.right), width: Math.round(rect.width), text: element.textContent.trim().slice(0, 90) }]
          : [];
      }).slice(0, 8),
    }));
    assert.ok(dimensions.page <= dimensions.viewport, `horizontal page overflow at ${viewport.width}×${viewport.height}: ${JSON.stringify(dimensions)}`);
    assert.ok(dimensions.panel <= dimensions.panelWidth, `QC panel overflow at ${viewport.width}×${viewport.height}: ${JSON.stringify(dimensions)}`);
  }

  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.getByText("QC history is current on this device.").waitFor();
  assert.deepEqual(errors, []);
  await context.close();
});

function payloadFor(body, settings) {
  switch (body.eventType) {
    case "lot-recorded":
      return { productId: body.productId, productCode: "FLOUR-QC", productName: "Flour", recipeCode: body.recipeCode, stationKey: body.stationKey, unit: "lb", lotCode: body.lotCode };
    case "weight-check":
      {
        const setting = settings.find((candidate) => candidate.settingType === "weight-override");
        const result = setting && Math.abs(Number(body.actual) - Number(setting.target)) > Number(setting.tolerance)
          ? "out_of_tolerance"
          : "within_tolerance";
        return {
          productId: body.productId,
          productCode: "FLOUR-QC",
          productName: "Flour",
          recipeCode: body.recipeCode,
          stationKey: body.stationKey,
          unit: "lb",
          actual: body.actual,
          result: setting ? result : "not_evaluated",
        };
      }
    case "date-code-observed":
      return { observedText: body.observedText, result: "not_evaluated" };
    case "checkpoint-observed":
      return {
        checkpointType: body.checkpointType,
        stationKey: body.stationKey,
        checkpointLabel: body.checkpointLabel,
        observedValue: body.observedValue,
        unit: body.unit,
        evaluationStatus: "not_evaluated",
        ...(body.note ? { note: body.note } : {}),
      };
    case "corrective-action-observed":
      return {
        targetEventId: body.targetEventId,
        actionObserved: body.actionObserved,
        ...(body.followUpNote ? { followUpNote: body.followUpNote } : {}),
      };
    case "review-flag-raised":
      return {
        targetType: body.targetType,
        ...(body.targetEventId ? { targetEventId: body.targetEventId } : {}),
        reason: body.reason,
      };
    case "review-flag-reviewed":
      return { targetEventId: body.targetEventId, reviewNote: body.reviewNote };
    case "cleaning-recorded":
      return { method: body.method, cleanedAt: body.cleanedAt };
    case "cleaning-verified":
      return { targetEventId: body.targetEventId };
    case "brix-check":
      return { actual: body.actual, unit: "°Bx", result: "out_of_tolerance" };
    case "review-signed-off":
      return { review: "signed-off" };
    case "run-check-reviewed":
      return {
        checkType: body.checkType,
        result: body.checkType === "allergen-footprint" ? "not_evaluated" : "recorded",
        observations: body.observations,
        allergens: [],
        unknownCount: 1,
      };
    default:
      return body;
  }
}

async function readRequest(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
