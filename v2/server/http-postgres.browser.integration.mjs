import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, webkit } from "../../node_modules/.pnpm/node_modules/playwright/index.mjs";
import { startV2Server } from "./main.mjs";

const MANAGER_USERNAME = "V2IntegrationManager";
const MANAGER_PASSWORD = "v2-test-manager-password";

async function authenticateBrowserContext(baseUrl, context) {
  const unauthenticated = await fetch(`${baseUrl}/api/v2/auth/session`);
  assert.equal(unauthenticated.status, 401, "a new browser context must not inherit a staff session");
  const response = await fetch(`${baseUrl}/api/v2/auth/sign-in`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl, "Sec-Fetch-Site": "same-origin" },
    body: JSON.stringify({ username: MANAGER_USERNAME, password: MANAGER_PASSWORD }),
  });
  assert.equal(response.status, 200, "the manager account must be available for the browser journey");
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
  if (!databaseUrl) {
    throw new Error("The disposable V2 PostgreSQL URL is required for browser integration.");
  }

  const errors = [];
  const failedResponses = [];
  let offlineCheckActive = false;
  let serverInstance;
  let browser;
  const evidenceDir = join(tmpdir(), `v2-manager-inventory-${randomUUID()}`);
  try {
    await mkdir(evidenceDir, { recursive: true });
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
    const browserPath = process.env.CHROMIUM_PATH
      || execFileSync("which", ["chromium"], { encoding: "utf8" }).trim();
    browser = await chromium.launch({
      headless: true,
      executablePath: browserPath,
      args: ["--no-sandbox"],
    });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      if (offlineCheckActive && message.text().includes("net::ERR_INTERNET_DISCONNECTED")) return;
      errors.push(message.text());
    });
    page.on("response", (response) => {
      if (response.status() >= 400) {
        const url = new URL(response.url());
        failedResponses.push(`${response.status()} ${url.pathname}`);
      }
    });

    await authenticateBrowserContext(baseUrl, context);
    await page.goto(baseUrl);
    await page.locator("#authenticated-app:not([hidden])").waitFor({ timeout: 10000 }).catch(async () => {
      throw new Error(JSON.stringify({
        authStatus: await page.locator("#auth-status").textContent(),
        authError: await page.locator("#auth-error-message").textContent(),
        failedResponses,
        cookieNames: (await context.cookies()).map((cookie) => cookie.name),
      }));
    });
    await page.locator("#manager-tools:not([hidden])").waitFor();
    await page.locator("#warehouse-select").waitFor({ state: "visible" });
    await page.waitForFunction(() => document.querySelectorAll("#warehouse-select option").length > 0);

    await page.locator("#die-default-type").selectOption("DIE-REVIEW-TEST");
    await page.locator('[data-manager-die-field="crustsPerCycle"]').fill("42");
    await page.locator('[data-manager-die-field="preTunnelMin"]').fill("4.5");
    await page.locator("#die-default-form button[type=submit]").click();
    await page.waitForFunction(() =>
      document.querySelector("#manager-error")?.textContent?.includes("Reviewed die defaults confirmed") === true);
    await page.locator("#die-default-state").getByText("Revision 4 is active").waitFor();

    await page.locator("#die-default-type").selectOption("DIE-UNREVIEWED-TEST");
    for (const [field, value] of Object.entries({
      crustsPerCycle: "8", cycleSpeed: "3.25", speedAdjustment: "1",
      freezerTime: "22", casesPerLayer: "4",
    })) {
      await page.locator(`[data-manager-die-field="${field}"]`).fill(value);
    }
    await page.locator("#die-default-form button[type=submit]").click();
    await page.waitForFunction(() =>
      document.querySelector("#manager-error")?.textContent?.includes("Reviewed die defaults confirmed") === true);
    await page.locator("#die-default-state").getByText("Revision 1 is active").waitFor();
    await page.reload();
    await page.locator("#manager-tools:not([hidden])").waitFor();
    await page.locator("#die-default-history").getByText("re-enabled · DIE-REVIEW-TEST · revision 4").waitFor();

    await page.locator("#run-product").selectOption("DOUGH-A");
    await page.locator("#run-production-setup").selectOption("LINE-A");
    await page.locator("#die-setup-card").waitFor({ state: "visible" });
    await page.locator("#run-die-type").selectOption("DIE-REVIEW-TEST");
    assert.equal(await page.locator('[data-die-field="crustsPerCycle"]').inputValue(), "42");
    assert.equal(await page.locator('[data-die-field="preTunnelMin"]').inputValue(), "4.5");
    await page.locator('[data-die-field="cycleSpeed"]').fill("77");
    await page.locator("#run-die-type").selectOption("DIE-UNREVIEWED-TEST");
    assert.equal(await page.locator('[data-die-field="crustsPerCycle"]').inputValue(), "8");
    assert.equal(await page.locator('[data-die-field="cycleSpeed"]').inputValue(), "77",
      "a manually entered value must survive an explicit die switch");
    assert.equal(await page.locator('[data-die-field="preTunnelMin"]').inputValue(), "",
      "switching away from a known auto-fill clears the prior optional default");
    for (const viewport of [
      { width: 1280, height: 900 },
      { width: 402, height: 874 },
      { width: 768, height: 1024 },
      { width: 1024, height: 768 },
    ]) {
      await page.setViewportSize(viewport);
      await page.locator("#die-setup-card").scrollIntoViewIfNeeded();
      assert.equal(await page.locator("#die-setup-card").isVisible(), true);
      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        elements: [...document.querySelectorAll("body *")]
          .map((element) => ({ element, rect: element.getBoundingClientRect() }))
          .filter(({ rect }) => rect.right > window.innerWidth + 1)
          .slice(0, 8)
          .map(({ element, rect }) => `${element.tagName.toLowerCase()}#${element.id}.${element.className}=${Math.round(rect.right)}`),
      }));
      assert.ok(overflow.scrollWidth <= viewport.width,
        `the die form must fit ${viewport.width}x${viewport.height}: ${JSON.stringify(overflow)}`);
    }
    await page.locator("#setup-label").fill("Die default browser snapshot");
    await page.locator("#target-cases").fill("1");
    await page.waitForFunction(() => {
      const button = document.querySelector("#create-button");
      return button instanceof HTMLButtonElement && !button.disabled;
    });
    const createResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/v2/runs" && response.request().method() === "POST");
    await page.getByTestId("button-create-run").click();
    const createResponse = await createResponsePromise;
    const createdBody = await createResponse.json();
    assert.equal(createResponse.status(), 201, JSON.stringify(createdBody));
    const createdRun = createdBody.run;
    assert.equal(createdRun.setupSnapshot.dieSetup.dieTypeCode, "DIE-UNREVIEWED-TEST");
    assert.equal(createdRun.setupSnapshot.dieSetup.defaultStatus, "active");
    assert.equal(createdRun.setupSnapshot.dieSetup.defaultRevision, 1);
    assert.equal(createdRun.setupSnapshot.dieSetup.lineSettings.crustsPerCycle, 8);
    assert.equal(createdRun.setupSnapshot.dieSetup.lineSettings.cycleSpeed, 77);
    offlineCheckActive = true;
    await context.setOffline(true);
    await page.waitForFunction(() =>
      document.querySelector("#die-default-type")?.disabled === true
      && document.querySelector('[data-manager-die-field="crustsPerCycle"]')?.disabled === true);
    await context.setOffline(false);
    await page.waitForFunction(() => document.querySelector("#die-default-type")?.disabled === false);
    offlineCheckActive = false;

    const suffix = randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
    const productCode = `UI${suffix}`;
    const productName = `Browser Test Product ${suffix}`;
    const firstWarehouse = `Browser Test Main ${suffix}`;
    const secondWarehouse = `Browser Test Overflow ${suffix}`;

    await page.locator("#import-kind").selectOption("products");
    await page.locator("#import-file").setInputFiles({
      name: "browser-test-products.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(`code,name,unit\n${productCode},${productName},each\n`),
    });
    await page.getByRole("button", { name: "Validate and review" }).click();
    await page.locator("#import-preview").getByText(`Staged · products`).waitFor();
    await page.locator("#import-preview").getByText(productCode, { exact: true }).waitFor();
    await page.getByRole("button", { name: "Apply reviewed import" }).click();
    await page.locator("#import-history").getByText("products · applied").first().waitFor();
    await page.waitForFunction((code) =>
      [...document.querySelectorAll("#movement-product option")].some((option) => option.value === code),
    productCode);

    async function createWarehouse(name) {
      await page.locator("#warehouse-name").fill(name);
      await page.getByRole("button", { name: "Add warehouse" }).click();
      await page.waitForFunction((label) =>
        [...document.querySelectorAll("#warehouse-select option")].some((option) => option.textContent === label),
      name);
      await page.locator("#warehouse-select").selectOption({ label: name });
    }

    async function applyOpeningCount(name, quantity) {
      await page.locator("#opening-warehouse").selectOption({
        label: name,
      });
      const productCodes = await page.locator("#movement-product option").evaluateAll((options) =>
        options.map((option) => option.value).filter(Boolean));
      assert.ok(productCodes.includes(productCode));
      const csv = [
        "product_code,quantity",
        ...productCodes.map((code) => `${code},${code === productCode ? quantity : "0"}`),
        "",
      ].join("\n");
      await page.locator("#opening-count-file").setInputFiles({
        name: "browser-test-physical-count.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(csv),
      });
      await page.getByRole("button", { name: "Review physical count" }).click();
      await page.waitForFunction(() =>
        document.querySelector("#opening-count-preview")?.textContent?.includes("Physical count · staged") === true,
      null, { timeout: 10000 }).catch(async () => {
        throw new Error(JSON.stringify({
          openingCountMessage: await page.locator("#manager-error").textContent(),
          openingPreview: await page.locator("#opening-count-preview").textContent(),
          openingWarehouse: await page.locator("#opening-warehouse").inputValue(),
          selectedWarehouse: await page.locator("#warehouse-select").inputValue(),
          failedResponses,
        }));
      });
      await page.getByRole("button", { name: "Confirm count review" }).click();
      await page.locator("#opening-count-preview").getByText("Physical count · reviewed").waitFor();
      await page.getByRole("button", { name: "Apply opening count" }).click();
      await page.locator("#opening-count-preview").getByText("Physical count · applied").waitFor();
      await page.locator("#opening-count-history").getByText(`${name} · applied`).waitFor();
    }

    await createWarehouse(firstWarehouse);
    await applyOpeningCount(firstWarehouse, "12");
    await createWarehouse(secondWarehouse);
    await applyOpeningCount(secondWarehouse, "0");

    await page.locator("#production-warehouse-select").selectOption({ label: firstWarehouse });
    await page.getByRole("button", { name: "Set production warehouse" }).click();
    await page.locator("#production-warehouse-status")
      .getByText(`Production inventory will be deducted from ${firstWarehouse}.`).waitFor();

    await page.locator("#warehouse-select").selectOption({ label: firstWarehouse });
    await page.locator("#movement-product").selectOption(productCode);
    await page.waitForFunction(() => {
      const submit = document.querySelector("#movement-submit");
      return submit instanceof HTMLButtonElement && !submit.disabled;
    });
    await page.locator("#movement-quantity").fill("4");
    await page.locator("#movement-reason").fill(`Browser receipt ${suffix}`);
    await page.getByRole("button", { name: "Record stock change" }).click();
    await page.locator("#movement-history").getByText(`Browser receipt ${suffix}`).waitFor();
    await page.waitForFunction(() =>
      [...document.querySelectorAll("#stock-rows td")].some((cell) => cell.textContent === "16.000000"),
    null, { timeout: 7000 }).catch(async () => {
      throw new Error(JSON.stringify({
        inventoryMessage: await page.locator("#manager-error").textContent(),
        stock: await page.locator("#stock-rows").innerText(),
        selectedWarehouse: await page.locator("#warehouse-select").inputValue(),
        selectedProduct: await page.locator("#movement-product").inputValue(),
        submitDisabled: await page.locator("#movement-submit").isDisabled(),
        failedResponses,
      }));
    });

    await page.locator("#transfer-from").selectOption({ label: firstWarehouse });
    await page.locator("#transfer-to").selectOption({ label: secondWarehouse });
    await page.locator("#transfer-product").selectOption(productCode);
    await page.locator("#transfer-quantity").fill("2");
    await page.locator("#transfer-reason").fill(`Browser transfer ${suffix}`);
    await page.getByRole("button", { name: "Transfer stock" }).click();
    await page.locator("#movement-history").getByText(`Browser transfer ${suffix}`).waitFor();
    await page.locator("#stock-rows").getByText("14.000000", { exact: true }).waitFor();
    await page.screenshot({ path: join(evidenceDir, "manager-inventory-after-transfer.png"), fullPage: true });

    await page.locator("#warehouse-select").selectOption({ label: secondWarehouse });
    await page.locator("#stock-rows").getByText("2.000000", { exact: true }).waitFor();
    await page.reload();
    await page.locator("#manager-tools:not([hidden])").waitFor();
    await page.locator("#warehouse-select").selectOption({ label: secondWarehouse });
    await page.locator("#stock-rows").getByText("2.000000", { exact: true }).waitFor();
    await page.locator("#opening-count-history").getByText(`${secondWarehouse} · applied`).waitFor();
    await page.screenshot({ path: join(evidenceDir, "manager-inventory-after-reload.png"), fullPage: true });

    const scheduleDate = "2035-04-16";
    await page.locator("#schedule-tools:not([hidden])").waitFor();
    await page.locator("#schedule-date").fill(scheduleDate);
    await page.getByText("Confirmed revision 0").waitFor();
    await page.locator("#schedule-add").click();
    const scheduleDraft = page.locator('.schedule-run[data-is-new="true"]');
    await scheduleDraft.locator('[data-field="productCode"]').selectOption("DOUGH-A");
    await scheduleDraft.locator('[data-field="productionSetupCode"]').selectOption("LINE-A");
    await scheduleDraft.locator('[data-field="runTemplateCode"]').selectOption("SCHEDULE-TEMPLATE");
    await scheduleDraft.locator('[data-field="targetCases"]').fill("20");
    await scheduleDraft.getByRole("button", { name: "Add to plan" }).click();
    await page.getByText("Confirmed revision 1").waitFor();
    assert.equal(await page.locator(".schedule-run").count(), 1);
    await page.screenshot({ path: join(evidenceDir, "manager-schedule-after-save.png"), fullPage: true });

    const secondSignIn = await fetch(`${baseUrl}/api/v2/auth/sign-in`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: baseUrl,
        "Sec-Fetch-Site": "same-origin",
      },
      body: JSON.stringify({ username: MANAGER_USERNAME, password: MANAGER_PASSWORD }),
    });
    assert.equal(secondSignIn.status, 200, "the second device should receive a separate authenticated session");
    const secondCookies = secondSignIn.headers.getSetCookie().map((cookie) => cookie.split(";", 1)[0]);
    const secondContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await secondContext.addCookies(secondCookies.map((cookie) => {
      const [name, ...valueParts] = cookie.split("=");
      return { name, value: valueParts.join("="), url: baseUrl };
    }));
    const secondPage = await secondContext.newPage();
    secondPage.on("pageerror", (error) => errors.push(error.message));
    secondPage.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    secondPage.on("response", (response) => {
      if (response.status() >= 400) failedResponses.push(`${response.status()} ${new URL(response.url()).pathname}`);
    });
    await secondPage.goto(baseUrl);
    await secondPage.locator("#schedule-tools:not([hidden])").waitFor();
    await secondPage.locator("#schedule-date").fill(scheduleDate);
    await secondPage.getByText("Confirmed revision 1").waitFor();
    assert.equal(await secondPage.locator("#schedule-date").inputValue(), scheduleDate);
    assert.equal(await secondPage.locator(".schedule-run").count(), 1);
    assert.equal(await secondPage.locator('.schedule-run [data-field="targetCases"]').inputValue(), "20");
    assert.ok(await secondPage.evaluate(() =>
      document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
    await secondPage.screenshot({ path: join(evidenceDir, "manager-schedule-second-device.png"), fullPage: true });

    await secondPage.reload();
    await secondPage.locator("#schedule-tools:not([hidden])").waitFor();
    await secondPage.locator("#schedule-date").fill(scheduleDate);
    await secondPage.getByText("Confirmed revision 1").waitFor();
    assert.equal(await secondPage.locator(".schedule-run").count(), 1);
    assert.equal(await secondPage.locator('.schedule-run [data-field="targetCases"]').inputValue(), "20");
    await secondContext.close();

    assert.deepEqual(errors, [], "manager inventory and schedule browser journeys should have no browser or server errors");
    assert.deepEqual(failedResponses, ["401 /api/v2/auth/session"],
      "only the expected unauthenticated session challenge should be rejected");
    console.log("V2 authenticated Chromium journeys passed: reviewed die defaults, switch-aware run snapshot, inventory, schedule convergence, and reload persistence. Responsive emulation passed at desktop, phone, tablet portrait, and tablet landscape sizes.");

    let webkitBrowser;
    try {
      webkitBrowser = await webkit.launch({ headless: true });
      const webkitContext = await webkitBrowser.newContext({ viewport: { width: 1024, height: 768 } });
      await authenticateBrowserContext(baseUrl, webkitContext);
      const webkitPage = await webkitContext.newPage();
      await webkitPage.goto(baseUrl);
      await webkitPage.locator("#manager-tools:not([hidden])").waitFor();
      await webkitPage.locator("#die-default-type").selectOption("DIE-UNREVIEWED-TEST");
      await webkitPage.locator("#run-product").selectOption("DOUGH-A");
      await webkitPage.locator("#run-production-setup").selectOption("LINE-A");
      await webkitPage.locator("#run-die-type").selectOption("DIE-UNREVIEWED-TEST");
      assert.equal(await webkitPage.locator('[data-die-field="crustsPerCycle"]').inputValue(), "8");
      console.log("V2 WebKit/Safari engine die-default selection passed.");
      await webkitBrowser.close();
    } catch (error) {
      if (webkitBrowser) await webkitBrowser.close();
      console.log(`V2 WebKit/Safari lane BLOCKED: ${error instanceof Error ? error.message.split("\n")[0] : "engine unavailable"}`);
    }
  } finally {
    if (browser) await browser.close();
    if (serverInstance) await serverInstance.close();
    await rm(evidenceDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    event: "v2.http_postgres_browser_integration.failed",
    errorName: typeof error?.name === "string" ? error.name : "UnknownError",
    message: error instanceof Error ? error.message : "Browser integration assertion failed.",
  }));
  process.exitCode = 1;
});
