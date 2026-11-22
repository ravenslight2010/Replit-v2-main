import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, webkit as localWebkit } from "../node_modules/playwright/index.mjs";
import {
  AGENT_PREVIEW_PASSWORD,
  AGENT_PREVIEW_USERNAME,
} from "./agent-preview-config.mjs";
import { startV2Server } from "./main.mjs";

const webkit = process.env.V2_WEBKIT_PLAYWRIGHT_MODULE
  ? createRequire(import.meta.url)(process.env.V2_WEBKIT_PLAYWRIGHT_MODULE).webkit
  : localWebkit;

const MANAGER_USERNAME = AGENT_PREVIEW_USERNAME;
const MANAGER_PASSWORD = AGENT_PREVIEW_PASSWORD;
const csvCell = (value) => `"${String(value).replaceAll('"', '""')}"`;

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

async function inventoryPanelDimensions(page) {
  return page.locator("#manager-tools").evaluate((container) => {
    const panel = container.getBoundingClientRect();
    const rightEdge = panel.left + container.clientWidth;
    return {
      width: container.clientWidth,
      offenders: [...container.querySelectorAll("*")].map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName,
          id: element.id,
          className: typeof element.className === "string" ? element.className : "",
          leftOverflow: Math.round(panel.left - rect.left),
          rightOverflow: Math.round(rect.right - rightEdge),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      }).filter((element) => element.width > 0 && element.height > 0
        && (element.leftOverflow > 2 || element.rightOverflow > 2))
        .sort((a, b) => Math.max(b.leftOverflow, b.rightOverflow)
          - Math.max(a.leftOverflow, a.rightOverflow)).slice(0, 8),
    };
  });
}

async function main() {
  const databaseUrl = process.env.V2_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("The disposable V2 PostgreSQL URL is required for browser integration.");
  }

  const errors = [];
  const failedResponses = [];
  async function waitForSetupReview(page, family) {
    try {
      await page.locator("#setup-catalog-preview")
        .getByText("Validated setup · review before applying").waitFor();
    } catch (error) {
      console.log(JSON.stringify({
        event: "v2.setup_catalog_browser_stage_failed",
        family,
        status: (await page.locator("#setup-catalog-status").textContent())?.slice(0, 200) ?? "",
        failedResponses: failedResponses.slice(-8),
      }));
      throw error;
    }
  }
  let offlineCheckActive = false;
  let expectedManagerForbidden = false;
  let managerForbiddenSeen = false;
  let serverInstance;
  let browser;
  let webkitBrowser;
  let recoveryContext;
  let webkitContext;
  let webkitManagerContext;
  let webkitManagerPage;
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
        if (entry?.event === "v2.qc_api.error") {
          errors.push([
            entry.event,
            typeof entry.operation === "string" ? entry.operation : "unknown",
            typeof entry.databaseCode === "string" ? entry.databaseCode : "no-database-code",
          ].join(":"));
        } else if (entry?.level === "error") {
          errors.push("server emitted an error");
        }
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
    function watchPage(watchedPage) {
      let expectedSessionChallenge = false;
      watchedPage.on("pageerror", (error) => errors.push(error.message));
      watchedPage.on("console", (message) => {
        if (message.type() !== "error") return;
        const text = message.text();
        const fontPreconnectFailure = text.includes("Failed to preconnect to https://fonts.googleapis.com/")
          || text.includes("Failed to preconnect to https://fonts.gstatic.com/");
        const optionalFontTlsFailure = process.env.V2_IGNORE_FONT_TLS_FAILURES === "1"
          && text === "Failed to load resource: TLS support is not available";
        if (fontPreconnectFailure || optionalFontTlsFailure) {
          return;
        }
        if (offlineCheckActive && text.includes("net::ERR_INTERNET_DISCONNECTED")) return;
        if (expectedSessionChallenge && text.includes("Failed to load resource")) {
          expectedSessionChallenge = false;
          return;
        }
        errors.push(text);
      });
      watchedPage.on("response", (response) => {
        if (response.status() >= 400) {
          const url = new URL(response.url());
          if (expectedManagerForbidden && response.status() === 403
            && url.pathname === "/api/v2/manager-operations") {
            managerForbiddenSeen = true;
            return;
          }
          failedResponses.push(`${response.status()} ${url.pathname}`);
          if (response.status() === 401 && url.pathname === "/api/v2/auth/session") {
            expectedSessionChallenge = true;
          }
        }
      });
    }
    watchPage(page);

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
    await page.locator("#staff-panel:not([hidden])").waitFor();
    await page.locator("#staff-history-list li").first().waitFor();
    await page.waitForFunction(() =>
      ["active", "standby", "degraded", "stale", "unavailable"].includes(
        document.querySelector("#station-worker-status")?.textContent?.trim() ?? "",
      ));
    for (const username of [AGENT_PREVIEW_USERNAME, "V2IntegrationOperator", "V2RecoveryOperator"]) {
      await page.locator("#staff-history-list").getByText(username, { exact: false }).first().waitFor();
    }
    for (const viewport of [
      { name: "phone", width: 390, height: 844 },
      { name: "tablet portrait", width: 768, height: 1024 },
      { name: "tablet landscape", width: 1024, height: 768 },
    ]) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const layout = await page.locator("#staff-panel").evaluate((panel) => {
        const grid = panel.querySelector(".manager-diagnostics-grid");
        return {
          panelVisible: panel instanceof HTMLElement && !panel.hidden,
          panelOverflow: panel.scrollWidth > panel.clientWidth + 1,
          gridOverflow: grid instanceof HTMLElement && grid.scrollWidth > grid.clientWidth + 1,
          pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        };
      });
      assert.deepEqual(layout, {
        panelVisible: true,
        panelOverflow: false,
        gridOverflow: false,
        pageOverflow: false,
      }, `Manager diagnostics must fit ${viewport.name}`);
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({ path: join(evidenceDir, "manager-diagnostics-desktop.png"), fullPage: true });
    await page.reload();
    await page.locator("#staff-panel:not([hidden])").waitFor();
    await page.locator("#staff-history-list").getByText("V2RecoveryOperator", { exact: false }).first().waitFor();
    assert.equal(await page.locator("#staff-history-list li").count() >= 3, true);

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

    recoveryContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const recoveryPage = await recoveryContext.newPage();
    watchPage(recoveryPage);
    await recoveryPage.goto(baseUrl);
    await recoveryPage.locator("#auth-form:not([hidden])").waitFor();
    await recoveryPage.locator("#password-recovery-links:not([hidden])").waitFor();
    await recoveryPage.locator("#password-reset-request-toggle").click();
    await recoveryPage.locator("#password-reset-request-form:not([hidden])").waitFor();
    await recoveryPage.locator("#password-reset-username").fill("V2RecoveryOperator");
    await recoveryPage.locator("#password-reset-request-submit").click();
    await recoveryPage.locator("#password-reset-status")
      .getByText("If the account is active, a manager will review the request.").waitFor();
    await recoveryPage.locator("#password-reset-request-cancel").click();

    await page.reload();
    await page.locator("#password-reset-panel:not([hidden])").waitFor();
    const approveButton = page.locator("#password-reset-queue [data-reset-action='approve']").first();
    await approveButton.waitFor();
    const browserRequestId = await approveButton.getAttribute("data-reset-id");
    assert.match(browserRequestId ?? "", /^[0-9a-f-]{36}$/i);
    await approveButton.click();
    await page.locator("#password-reset-code-panel:not([hidden])").waitFor();
    const browserRecoveryCode = (await page.locator("#password-reset-issued-code").textContent()).trim();
    assert.match(browserRecoveryCode, /^[A-Za-z0-9_-]{43}$/);

    for (const viewport of [
      { name: "phone", width: 390, height: 844 },
      { name: "tablet portrait", width: 768, height: 1024 },
      { name: "tablet landscape", width: 1024, height: 768 },
      { name: "desktop", width: 1280, height: 900 },
    ]) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const overflow = await page.locator("#password-reset-panel").evaluate((panel) =>
        panel.scrollWidth > panel.clientWidth + 1);
      assert.equal(overflow, false, `${viewport.name} recovery queue should not overflow horizontally`);
    }
    await page.setViewportSize({ width: 1280, height: 900 });

    await recoveryPage.locator("#password-reset-completion-toggle").click();
    await recoveryPage.locator("#password-reset-completion-form:not([hidden])").waitFor();
    await recoveryPage.locator("#password-reset-completion-username").fill("V2RecoveryOperator");
    await recoveryPage.locator("#password-reset-code").fill(browserRecoveryCode);
    await recoveryPage.locator("#password-reset-new-password").fill("v2-test-browser-recovery-password");
    await recoveryPage.locator("#password-reset-completion-submit").click();
    await recoveryPage.locator("#auth-status")
      .getByText("Password updated. Sign in with the new password.").waitFor();
    await recoveryPage.locator("#auth-username").fill("V2RecoveryOperator");
    await recoveryPage.locator("#auth-password").fill("v2-test-browser-recovery-password");
    await recoveryPage.locator("#auth-submit").click();
    await recoveryPage.locator("#authenticated-app:not([hidden])").waitFor();
    await recoveryPage.locator("#sign-out-button").click();
    await recoveryPage.locator("#auth-form:not([hidden])").waitFor();

    await recoveryPage.locator("#password-reset-request-toggle").click();
    await recoveryPage.locator("#password-reset-username").fill("V2RecoveryOperator");
    await recoveryPage.locator("#password-reset-request-submit").click();
    await recoveryPage.locator("#password-reset-status")
      .getByText("If the account is active, a manager will review the request.").waitFor();
    await page.reload();
    await page.locator("#password-reset-panel:not([hidden])").waitFor();
    const denyButton = page.locator("#password-reset-queue .manager-list-item")
      .filter({ hasText: "V2RecoveryOperator" })
      .getByRole("button", { name: "Deny" });
    await denyButton.click();
    await page.locator("#password-reset-queue")
      .getByText("No recovery requests need review.").waitFor();
    assert.equal(await page.locator("#password-reset-code-panel").isVisible(), false);
    await page.reload();
    await page.locator("#password-reset-panel:not([hidden])").waitFor();
    await page.locator("#password-reset-queue")
      .getByText("No recovery requests need review.").waitFor();

    let webkitLane = "BLOCKED: Playwright WebKit is not installed in this test environment.";
    const webkitPath = webkit.executablePath();
    try {
      await access(webkitPath);
      const previousHostCheck = process.env.PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS;
      if (process.env.V2_WEBKIT_SKIP_HOST_REQUIREMENTS === "1") {
        process.env.PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = "1";
      }
      try {
        webkitBrowser = await webkit.launch({
          headless: true,
          env: {
            ...process.env,
            ...(process.env.V2_WEBKIT_EGL_VENDOR
              ? { __EGL_VENDOR_LIBRARY_FILENAMES: process.env.V2_WEBKIT_EGL_VENDOR }
              : {}),
          },
        });
      } finally {
        if (previousHostCheck === undefined) delete process.env.PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS;
        else process.env.PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = previousHostCheck;
      }
      webkitLane = "AVAILABLE";
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      webkitLane = message.includes("missing dependencies")
        ? "BLOCKED: this NixOS environment lacks compatible native WebKit libraries."
        : `BLOCKED: ${message.split("\n").find((line) => line.trim().length > 0)?.slice(0, 180) || "WebKit could not start."}`;
    }
    if (!webkitBrowser && process.env.V2_WEBKIT_REQUIRED === "1") {
      throw new Error(`Required WebKit browser journey failed: ${webkitLane}`);
    }
    if (webkitBrowser) {
      webkitManagerContext = await webkitBrowser.newContext({ viewport: { width: 1280, height: 900 } });
      webkitManagerPage = await webkitManagerContext.newPage();
      watchPage(webkitManagerPage);
      await webkitManagerPage.goto(baseUrl);
      await webkitManagerPage.locator("#auth-username").fill(MANAGER_USERNAME);
      await webkitManagerPage.locator("#auth-password").fill(MANAGER_PASSWORD);
      await webkitManagerPage.locator("#auth-submit").click();
      await webkitManagerPage.locator("#password-reset-panel:not([hidden])").waitFor();
      webkitContext = await webkitBrowser.newContext({ viewport: { width: 390, height: 844 } });
      const webkitStaffPage = await webkitContext.newPage();
      watchPage(webkitStaffPage);
      await webkitStaffPage.goto(baseUrl);
      await webkitStaffPage.locator("#password-recovery-links:not([hidden])").waitFor();
      await webkitStaffPage.locator("#password-reset-request-toggle").click();
      await webkitStaffPage.locator("#password-reset-username").fill("V2RecoveryOperator");
      await webkitStaffPage.locator("#password-reset-request-submit").click();
      await webkitStaffPage.locator("#password-reset-status")
        .getByText("If the account is active, a manager will review the request.").waitFor();
      await webkitStaffPage.locator("#password-reset-request-cancel").click();
      await webkitManagerPage.reload();
      const webkitApprove = webkitManagerPage.locator("#password-reset-queue [data-reset-action='approve']").first();
      await webkitApprove.waitFor();
      await webkitApprove.click();
      await webkitManagerPage.locator("#password-reset-code-panel:not([hidden])").waitFor();
      const webkitCode = (await webkitManagerPage.locator("#password-reset-issued-code").textContent()).trim();
      assert.match(webkitCode, /^[A-Za-z0-9_-]{43}$/);
      for (const viewport of [
        { name: "phone", width: 390, height: 844 },
        { name: "tablet portrait", width: 768, height: 1024 },
        { name: "tablet landscape", width: 1024, height: 768 },
        { name: "desktop", width: 1280, height: 900 },
      ]) {
        await webkitManagerPage.setViewportSize({ width: viewport.width, height: viewport.height });
        const overflow = await webkitManagerPage.locator("#password-reset-panel").evaluate((panel) =>
          panel.scrollWidth > panel.clientWidth + 1);
        assert.equal(overflow, false, `WebKit ${viewport.name} recovery queue should not overflow horizontally`);
      }
      await webkitStaffPage.locator("#password-reset-completion-toggle").click();
      await webkitStaffPage.locator("#password-reset-completion-form:not([hidden])").waitFor();
      await webkitStaffPage.locator("#password-reset-completion-username").fill("V2RecoveryOperator");
      await webkitStaffPage.locator("#password-reset-code").fill(webkitCode);
      await webkitStaffPage.locator("#password-reset-new-password").fill("v2-test-webkit-recovery-password");
      await webkitStaffPage.locator("#password-reset-completion-submit").click();
      await webkitStaffPage.locator("#auth-status")
        .getByText("Password updated. Sign in with the new password.").waitFor();
      await webkitStaffPage.locator("#auth-username").fill("V2RecoveryOperator");
      await webkitStaffPage.locator("#auth-password").fill("v2-test-webkit-recovery-password");
      await webkitStaffPage.locator("#auth-submit").click();
      await webkitStaffPage.locator("#authenticated-app:not([hidden])").waitFor();
      await webkitManagerPage.reload();
      await webkitManagerPage.locator("#password-reset-queue")
        .getByText("No recovery requests need review.").waitFor();

      await webkitManagerPage.locator("#die-default-type").selectOption("DIE-UNREVIEWED-TEST");
      await webkitManagerPage.locator("#run-product").selectOption("DOUGH-A");
      await webkitManagerPage.locator("#run-production-setup").selectOption("LINE-A");
      await webkitManagerPage.locator("#run-die-type").selectOption("DIE-UNREVIEWED-TEST");
      assert.equal(await webkitManagerPage.locator('[data-die-field="crustsPerCycle"]').inputValue(), "8");
      console.log("V2 WebKit/Safari engine die-default selection passed.");
      webkitLane = `PASS (WebKit ${webkitBrowser.version()})`;
    }

    const suffix = randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
    const productCode = `UI${suffix}`;
    const productName = `Browser Test Product ${suffix}`;
    const rawCode = `RAW${suffix}`;
    const preparedCode = `PREP${suffix}`;
    const boxCode = `BOX${suffix}`;
    const ingredientCode = `ING${suffix}`;
    const mixCode = `MIX${suffix}`;
    const recipeCode = `REC${suffix}`;
    const productionSetupCode = `LINE${suffix}`;
    const firstWarehouse = `Browser Test Main ${suffix}`;
    const secondWarehouse = `Browser Test Overflow ${suffix}`;

    await page.locator("#import-kind").selectOption("products");
    await page.locator("#import-file").setInputFiles({
      name: "browser-test-products.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        `code,name,unit\n${productCode},${productName},each\n${rawCode},Browser raw ingredient ${suffix},lb\n${preparedCode},Browser prepared mix ${suffix},lb\n${boxCode},Browser package ${suffix},each\n`,
      ),
    });
    await page.getByRole("button", { name: "Validate and review" }).click();
    try {
      await page.locator("#import-preview").getByText("Staged · products").waitFor();
    } catch (error) {
      const state = await page.evaluate(() => {
        const preview = document.querySelector("#import-preview");
        const managerError = document.querySelector("#manager-error");
        return {
          previewHidden: preview?.hidden ?? null,
          previewText: preview?.textContent?.slice(0, 300) ?? "",
          importActionsHidden: document.querySelector("#import-actions")?.hidden ?? null,
          retryHidden: document.querySelector("#import-retry-button")?.hidden ?? null,
          managerErrorVisible: managerError instanceof HTMLElement && !managerError.hidden,
          managerErrorKind: managerError?.dataset.kind ?? "",
          managerErrorText: managerError?.textContent?.slice(0, 300) ?? "",
        };
      });
      console.log(JSON.stringify({ event: "v2.setup_import_preview_wait_failed", ...state }));
      throw error;
    }
    await page.locator("#import-preview").getByText(productCode, { exact: true }).waitFor();
    await page.getByRole("button", { name: "Apply reviewed import" }).click();
    await page.locator("#import-history").getByText("products · applied").first().waitFor();
    await page.waitForFunction((code) =>
      [...document.querySelectorAll("#movement-product option")].some((option) => option.value === code),
    productCode);

    await page.locator("#setup-catalog-family").selectOption("ingredients");
    await page.locator("#setup-catalog-file").setInputFiles({
      name: "browser-test-ingredients.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        `code,name,categories_json,allergens_json,allergens_reviewed,merged_into_code,enabled\n${ingredientCode},Browser raw ingredient ${suffix},"[]","[]",true,,true\n`,
      ),
    });
    await page.getByRole("button", { name: "Validate and stage for review" }).click();
    await waitForSetupReview(page, "ingredients");
    await page.getByRole("button", { name: "Apply reviewed setup" }).click();
    await page.locator("#setup-catalog-history").getByText("ingredients · 1 rows · applied").first().waitFor();

    const components = JSON.stringify([{
      ingredientName: `Browser raw ingredient ${suffix}`,
      ingredientCode,
      perPizzaOz: 0.1,
      perBatchLbs: 2,
    }]).replaceAll('"', '""');
    await page.locator("#setup-catalog-family").selectOption("mixes");
    await page.locator("#setup-catalog-file").setInputFiles({
      name: "browser-test-mixes.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        `code,name,brand,flavor,batch_size_lbs,days_early,notes,is_prep,enabled,components_json\n${mixCode},Browser prepared mix ${suffix},Test,Plain,20,0,,true,true,"${components}"\n`,
      ),
    });
    await page.getByRole("button", { name: "Validate and stage for review" }).click();
    await waitForSetupReview(page, "dough");
    await page.getByRole("button", { name: "Apply reviewed setup" }).click();
    await page.locator("#setup-catalog-history").getByText("mixes · 1 rows · applied").first().waitFor();

    await page.locator("#import-kind").selectOption("recipes");
    await page.locator("#import-file").setInputFiles({
      name: "browser-test-recipes.csv",
      mimeType: "text/csv",
      buffer: Buffer.from([
        "code,name,product_code,definition_json",
        [recipeCode, `Browser recipe ${suffix}`, productCode, JSON.stringify({
          station_key: "dough",
          ingredients: [{ product_code: rawCode, quantity: 2, unit: "lb" }],
        })].map(csvCell).join(","),
      ].join("\n") + "\n"),
    });
    await page.getByRole("button", { name: "Validate and review" }).click();
    await page.locator("#import-preview").getByText("Staged · recipes").waitFor();
    await page.getByRole("button", { name: "Apply reviewed import" }).click();
    await page.locator("#import-history").getByText("recipes · applied").first().waitFor();

    await page.locator("#import-kind").selectOption("production-setups");
    await page.locator("#import-file").setInputFiles({
      name: "browser-test-production-setups.csv",
      mimeType: "text/csv",
      buffer: Buffer.from([
        "code,name,product_code,config_json",
        [productionSetupCode, `Browser setup ${suffix}`, productCode, JSON.stringify({
          recipe_codes: [recipeCode],
          packaging_per_case: [{ product_code: boxCode, quantity: 1, unit: "each" }],
        })].map(csvCell).join(","),
      ].join("\n") + "\n"),
    });
    await page.getByRole("button", { name: "Validate and review" }).click();
    try {
      await page.locator("#import-preview").getByText("Staged · production-setups").waitFor();
    } catch (error) {
      const state = await page.evaluate(() => {
        const preview = document.querySelector("#import-preview");
        const managerError = document.querySelector("#manager-error");
        return {
          previewHidden: preview?.hidden ?? null,
          importActionsHidden: document.querySelector("#import-actions")?.hidden ?? null,
          managerErrorVisible: managerError instanceof HTMLElement && !managerError.hidden,
          managerErrorKind: managerError?.dataset.kind ?? "",
        };
      });
      console.log(JSON.stringify({
        event: "v2.production_setup_import_preview_wait_failed",
        ...state,
        failedResponses: failedResponses.slice(-8),
      }));
      throw error;
    }
    await page.getByRole("button", { name: "Apply reviewed import" }).click();
    await page.locator("#import-history").getByText("production-setups · applied").first().waitFor();

    await page.reload();
    await page.locator("#manager-tools:not([hidden])").waitFor();
    await page.waitForFunction((code) =>
      [...document.querySelectorAll("#movement-product option")].some((option) => option.value === code),
    rawCode);

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
    await page.locator("#movement-lot").fill(`CASE-LOT-${suffix}`);
    await page.locator("#movement-source").fill(`Delivery ${suffix}`);
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

    await page.locator("#movement-product").selectOption(rawCode);
    await page.locator("#movement-quantity").fill("20");
    await page.locator("#movement-reason").fill(`Raw receipt ${suffix}`);
    await page.locator("#movement-lot").fill(`RAW-LOT-${suffix}`);
    await page.locator("#movement-source").fill(`Raw delivery ${suffix}`);
    await page.getByRole("button", { name: "Record stock change" }).click();
    await page.locator("#movement-history").getByText(`Raw receipt ${suffix}`).waitFor();

    await page.locator("#preparation-link-kind").selectOption("ingredient");
    await page.locator("#preparation-link-source").selectOption(ingredientCode);
    await page.locator("#preparation-link-product").selectOption(rawCode);
    await page.locator("#preparation-link-rate").fill("1");
    await page.getByRole("button", { name: "Save link" }).click();
    await page.locator("#preparation-link-status").getByText(`Linked to Browser raw ingredient ${suffix}`).waitFor();

    await page.locator("#preparation-link-kind").selectOption("mix");
    await page.locator("#preparation-link-source").selectOption(mixCode);
    await page.locator("#preparation-link-product").selectOption(preparedCode);
    await page.locator("#preparation-link-rate").fill("1");
    await page.getByRole("button", { name: "Save link" }).click();
    await page.locator("#preparation-link-status").getByText(`Linked to Browser prepared mix ${suffix}`).waitFor();

    await page.locator("#preparation-mix").selectOption(mixCode);
    await page.locator("#preparation-source-warehouse").selectOption({ label: firstWarehouse });
    await page.locator("#preparation-output-warehouse").selectOption({ label: firstWarehouse });
    await page.locator("#preparation-batches").fill("2");
    await page.locator("#preparation-lot").fill(`PREP-LOT-${suffix}`);
    await page.locator("#preparation-source").fill(`Mix sheet ${suffix}`);
    await page.locator("#preparation-reason").fill(`Prepare two batches ${suffix}`);
    await page.waitForFunction(() => {
      const button = document.querySelector("#preparation-form button[type='submit']");
      return button instanceof HTMLButtonElement && !button.disabled;
    }, null, { timeout: 7000 }).catch(async () => {
      const setupResponse = await page.evaluate(async () => {
        const response = await fetch("/api/v2/inventory/preparation-setup");
        return response.json();
      });
      throw new Error(JSON.stringify({
        readiness: await page.locator("#preparation-readiness").textContent(),
        selectedMix: await page.locator("#preparation-mix").inputValue(),
        mixOptions: await page.locator("#preparation-mix").locator("option").allTextContents(),
        ingredientStatus: await page.locator("#preparation-link-status").innerText(),
        setupMix: setupResponse.mixes?.find((item) => item.code === mixCode),
        selectedWarehouses: {
          source: await page.locator("#preparation-source-warehouse").inputValue(),
          output: await page.locator("#preparation-output-warehouse").inputValue(),
        },
        failedResponses,
      }));
    });
    await page.getByRole("button", { name: "Record preparation" }).click();
    await page.locator("#preparation-history").getByText(`40.000000 lb ${preparedCode}`).waitFor({ timeout: 10000 }).catch(async () => {
      throw new Error(JSON.stringify({
        managerMessage: await page.locator("#manager-error").textContent(),
        preparationHistory: await page.locator("#preparation-history").innerText(),
        preparationReadiness: await page.locator("#preparation-readiness").textContent(),
        pendingInventoryRequest: await page.evaluate(() => localStorage.getItem("fieldline:v2:inventory-pending")),
        failedResponses,
      }));
    });
    await page.waitForFunction((code) => {
      const row = [...document.querySelectorAll("#stock-rows tr")].find((item) => item.textContent?.includes(code));
      return row?.querySelector(".quantity-cell")?.textContent === "16.000000";
    }, rawCode);

    await page.getByTestId("input-run-label").fill(`Substitution run ${suffix}`);
    await page.getByTestId("input-target-cases").fill("1");
    await page.getByTestId("select-run-product").selectOption(productCode);
    await page.waitForFunction((setupCode) =>
      [...document.querySelectorAll("#run-production-setup option")].some((option) => option.value === setupCode),
    productionSetupCode, { timeout: 10000 }).catch(async () => {
      const catalog = await page.evaluate(async () => {
        const response = await fetch("/api/v2/runs/products");
        return { status: response.status, body: await response.json() };
      });
      throw new Error(JSON.stringify({
        setupOptions: await page.locator("#run-production-setup").locator("option").allTextContents(),
        productOptions: await page.locator("#run-product").locator("option").allTextContents(),
        runProduct: catalog.body.products?.find((item) => item.code === productCode),
        failedResponses,
      }));
    });
    await page.getByTestId("select-run-production-setup").selectOption(productionSetupCode);
    await page.getByTestId("button-create-run").click();
    await page.locator("#run-supply-panel:not([hidden])").waitFor();
    await page.locator("#run-supply-planned").selectOption(rawCode);
    await page.locator("#run-supply-actual").selectOption(preparedCode);
    await page.locator("#run-supply-quantity").fill("2");
    await page.locator("#run-supply-reason").fill(`Use prepared substitute ${suffix}`);
    await page.getByRole("button", { name: "Stage supply" }).click();
    await page.getByRole("status").getByText("Supply changes are recorded against this run.").waitFor();
    await page.locator("#run-supply-history").getByText(
      `Browser prepared mix ${suffix} for Browser raw ingredient ${suffix}`,
    ).waitFor().catch(async () => {
      throw new Error(JSON.stringify({
        stagedSupplyHistory: await page.locator("#run-supply-history").innerText(),
        runSupplyStatus: await page.locator("#run-supply-status").textContent(),
        failedResponses,
      }));
    });

    await page.getByTestId("button-start").click();
    await page.getByTestId("status-run").getByText("running").waitFor();
    await page.locator('[data-station-field="casesProduced"]').fill("1");
    await page.getByTestId("button-save-station").click();
    await page.getByText("Saved to the shared run.").waitFor();
    await page.reload();
    await page.getByTestId("status-run").getByText("running").waitFor();
    assert.equal(await page.locator('[data-station-field="casesProduced"]').inputValue(), "1",
      "server-owned station progress must survive a browser reload");

    await page.getByTestId("button-complete").click();
    await page.getByTestId("status-run").getByText("completed").waitFor();
    await page.locator(".inventory-receipt").getByText("Inventory receipt").waitFor();
    const completedRunId = await page.locator("#runs-list [aria-current='true']").getAttribute("data-run-id");
    assert.ok(completedRunId, "the completed run remains selectable before reload");
    await page.reload();
    await page.getByTestId(`button-select-run-${completedRunId}`).waitFor();
    await page.getByTestId(`button-select-run-${completedRunId}`).click();
    await page.getByTestId("status-run").getByText("completed").waitFor();
    await page.locator(".inventory-receipt").getByText("Inventory receipt").waitFor();
    assert.equal(await page.getByTestId("button-complete").count(), 0,
      "a completed run cannot be completed again from the manager screen");

    await page.locator("#transfer-from").selectOption({ label: firstWarehouse });
    await page.locator("#transfer-to").selectOption({ label: secondWarehouse });
    await page.locator("#transfer-product").selectOption(productCode);
    await page.locator("#transfer-quantity").fill("2");
    await page.locator("#transfer-reason").fill(`Browser transfer ${suffix}`);
    await page.getByRole("button", { name: "Transfer stock" }).click();
    await page.locator("#movement-history").getByText(`Browser transfer ${suffix}`).waitFor();
    await page.waitForFunction((code) => {
      const row = [...document.querySelectorAll("#stock-rows tr")].find((item) => item.textContent?.includes(code));
      return row?.querySelector(".quantity-cell")?.textContent === "14.000000";
    }, productCode);
    await page.screenshot({ path: join(evidenceDir, "manager-inventory-after-transfer.png"), fullPage: true });

    await page.locator("#cycle-count-warehouse").selectOption({ label: secondWarehouse });
    await page.locator("#cycle-count-file").setInputFiles({
      name: "browser-test-cycle-count.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(`product_code,quantity\n${productCode},1\n`),
    });
    await page.locator("#cycle-count-reason").fill(`Verified cycle count ${suffix}`);
    await page.getByRole("button", { name: "Stage cycle count" }).click();
    await page.locator("#cycle-count-preview").getByText("staged · 1 counted products").waitFor();
    await page.getByRole("button", { name: "Review fresh balances" }).click();
    await page.locator("#cycle-count-preview").getByText("reviewed · 1 counted products").waitFor();
    await page.getByRole("button", { name: "Confirm and apply count" }).click();
    await page.locator("#cycle-count-preview").getByText("applied · 1 counted products").waitFor();
    await page.locator("#cycle-count-history").getByText(`${secondWarehouse} · applied`).waitFor();

    await page.locator("#warehouse-select").selectOption({ label: secondWarehouse });
    await page.waitForFunction((code) => {
      const row = [...document.querySelectorAll("#stock-rows tr")].find((item) => item.textContent?.includes(code));
      return row?.querySelector(".quantity-cell")?.textContent === "1.000000";
    }, productCode);
    await page.reload();
    await page.locator("#manager-tools:not([hidden])").waitFor();
    await page.locator("#warehouse-select").selectOption({ label: secondWarehouse });
    await page.waitForFunction((code) => {
      const row = [...document.querySelectorAll("#stock-rows tr")].find((item) => item.textContent?.includes(code));
      return row?.querySelector(".quantity-cell")?.textContent === "1.000000";
    }, productCode);
    await page.locator("#opening-count-history").getByText(`${secondWarehouse} · applied`).waitFor();
    await page.locator("#preparation-history").getByText(`40.000000 lb ${preparedCode}`).waitFor();
    await page.locator("#cycle-count-history").getByText(`${secondWarehouse} · applied`).waitFor();
    await page.screenshot({ path: join(evidenceDir, "manager-inventory-after-reload.png"), fullPage: true });

    await page.locator(`#runs-list [data-run-id="${createdRun.id}"]`).click();
    await page.getByTestId("button-start").click();
    await page.getByTestId("button-pause").click();
    await page.locator("#manager-operations-nav-link").click();
    await page.locator("#manager-operations:not([hidden])").waitFor();
    await page.locator("#manager-operations-refresh").click();
    await page.waitForFunction(() => document.querySelector("#manager-operations-status")
      ?.textContent?.startsWith("Report refreshed at") === true);
    const actionRow = page.locator("#manager-operations-actions .ops-action")
      .filter({ hasText: "Review paused run" }).first();
    await actionRow.waitFor();
    await actionRow.locator('select[name="status"]').selectOption("acknowledged");
    await actionRow.locator('input[name="note"]').fill("Reviewed the persisted pause event.");
    await actionRow.getByRole("button", { name: "Save status" }).click();
    await page.locator("#manager-operations-actions")
      .getByText("Acknowledged by staff", { exact: false }).waitFor();
    await page.locator("#manager-operations-actions")
      .getByText("Reviewed the persisted pause event.").waitFor();
    await page.locator("#manager-operations-coverage .ops-source-status[data-status='unavailable']").first().waitFor();
    await page.locator("#ops-inventory-link:not([hidden])").waitFor();
    await page.locator("#ops-schedule-link:not([hidden])").waitFor();
    await page.locator("#ops-qc-link:not([hidden])").waitFor();

    const downloadPromise = page.waitForEvent("download");
    await page.locator("#manager-operations-export").click();
    const download = await downloadPromise;
    const csvPath = join(evidenceDir, "manager-summary.csv");
    await download.saveAs(csvPath);
    const exportedCsv = await readFile(csvPath, "utf8");
    assert.match(exportedCsv, /V2 manager operations summary/u);
    assert.ok(exportedCsv.includes('"source_coverage:syncConflicts","unavailable"'));
    assert.doesNotMatch(exportedCsv, /must not be returned|v2-test-browser-recovery-password|V2RecoveryOperator/i);
    assert.equal(exportedCsv.includes(AGENT_PREVIEW_PASSWORD), false);

    await page.reload();
    await page.locator("#manager-operations-nav-link").click();
    await page.locator("#manager-operations-actions")
      .getByText("Reviewed the persisted pause event.").waitFor();
    for (const viewport of [
      { name: "phone", width: 390, height: 844 },
      { name: "tablet portrait", width: 768, height: 1024 },
      { name: "tablet landscape", width: 1024, height: 768 },
      { name: "desktop", width: 1280, height: 900 },
    ]) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const layout = await page.evaluate(() => {
        const panel = document.querySelector("#manager-operations");
        return {
          panelVisible: panel instanceof HTMLElement && !panel.hidden,
          panelOverflow: panel instanceof HTMLElement && panel.scrollWidth > panel.clientWidth + 1,
          pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        };
      });
      assert.deepEqual(layout, { panelVisible: true, panelOverflow: false, pageOverflow: false },
        `manager operations must fit ${viewport.name}`);
    }
    await page.screenshot({ path: join(evidenceDir, "manager-operations-phone.png"), fullPage: true });

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

    if (errors.length) {
      console.log(JSON.stringify({
        event: "v2.browser_test_console_errors",
        errors: errors.slice(0, 10).map((message) => message.slice(0, 240)),
        failedResponses: failedResponses.slice(0, 20),
      }));
    }
    assert.deepEqual(errors, [], "manager recovery, inventory, die-default, and schedule journeys should have no browser or server errors");
    assert.ok(
      failedResponses.length > 0 && failedResponses.every((response) => response === "401 /api/v2/auth/session"),
      `only unauthenticated session challenges should be rejected; received: ${failedResponses.join(", ")}`,
    );
    console.log("V2 authenticated Chromium journeys passed: reviewed die defaults, switch-aware run snapshot, inventory, schedule convergence, and reload persistence. Responsive emulation passed at desktop, phone, tablet portrait, and tablet landscape sizes.");
    console.log(`Password recovery browser coverage: Chromium PASS across phone, tablet portrait/landscape, and desktop; WebKit ${webkitLane}`);
    await page.locator("#manager-tools:not([hidden])").waitFor();
    for (const viewport of [
      { width: 402, height: 874 },
      { width: 768, height: 1024 },
      { width: 1024, height: 768 },
    ]) {
      await page.setViewportSize(viewport);
      const dimensions = await inventoryPanelDimensions(page);
      assert.ok(
        dimensions.offenders.length === 0,
        `Chromium inventory controls escape their panel at ${viewport.width}×${viewport.height}: ${JSON.stringify(dimensions)}`,
      );
      await page.screenshot({
        path: join(evidenceDir, `chromium-inventory-${viewport.width}x${viewport.height}.png`),
      });
    }

    if (webkitManagerPage) {
      await webkitManagerPage.locator("#manager-tools:not([hidden])").waitFor();
      for (const viewport of [
        { width: 390, height: 844 },
        { width: 768, height: 1024 },
        { width: 1024, height: 768 },
      ]) {
        await webkitManagerPage.setViewportSize(viewport);
        const dimensions = await inventoryPanelDimensions(webkitManagerPage);
        assert.ok(
          dimensions.offenders.length === 0,
          `WebKit inventory controls escape their panel at ${viewport.width}×${viewport.height}: ${JSON.stringify(dimensions)}`,
        );
        await webkitManagerPage.screenshot({
          path: join(evidenceDir, `webkit-inventory-${viewport.width}x${viewport.height}.png`),
        });
      }
      console.log("V2 authenticated WebKit inventory layout passed at phone, tablet, and landscape sizes.");
      await webkitManagerPage.locator("#manager-operations-nav-link").click();
      await webkitManagerPage.locator("#manager-operations:not([hidden])").waitFor();
      for (const viewport of [
        { name: "phone", width: 390, height: 844 },
        { name: "tablet portrait", width: 768, height: 1024 },
        { name: "tablet landscape", width: 1024, height: 768 },
      ]) {
        await webkitManagerPage.setViewportSize({ width: viewport.width, height: viewport.height });
        const layout = await webkitManagerPage.evaluate(() => {
          const panel = document.querySelector("#manager-operations");
          return {
            panelVisible: panel instanceof HTMLElement && !panel.hidden,
            panelOverflow: panel instanceof HTMLElement && panel.scrollWidth > panel.clientWidth + 1,
            pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
          };
        });
        if (!layout.panelVisible || layout.panelOverflow || layout.pageOverflow) {
          const diagnostics = await webkitManagerPage.evaluate(() => ({
            pageSize: {
              clientWidth: document.documentElement.clientWidth,
              scrollWidth: document.documentElement.scrollWidth,
              pageScrollLeft: document.documentElement.scrollLeft,
              bodyScrollLeft: document.body.scrollLeft,
            },
            containerSizes: [".page", "#authenticated-app", ".operations-nav", ".station-tabs",
              ".workspace", ".primary-column", ".station-panel"].map((selector) => {
              const element = document.querySelector(selector);
              if (!(element instanceof HTMLElement)) return { selector, missing: true };
              const rect = element.getBoundingClientRect();
              const style = getComputedStyle(element);
              return {
                selector,
                left: Math.round(rect.left),
                right: Math.round(rect.right),
                width: Math.round(rect.width),
                clientWidth: element.clientWidth,
                scrollWidth: element.scrollWidth,
                scrollLeft: element.scrollLeft,
                overflowX: style.overflowX,
                minWidth: style.minWidth,
                maxWidth: style.maxWidth,
              };
            }),
            overflowingElements: Array.from(document.body.querySelectorAll("*"))
              .map((element) => {
                const rect = element.getBoundingClientRect();
                return {
                  tag: element.tagName.toLowerCase(),
                  id: element.id,
                  className: typeof element.className === "string" ? element.className : "",
                  left: Math.round(rect.left),
                  right: Math.round(rect.right),
                  width: Math.round(rect.width),
                  scrollWidth: element.scrollWidth,
                  clientWidth: element.clientWidth,
                };
              })
              .filter((element) => element.width > 0 && (element.left < -1 || element.right > document.documentElement.clientWidth + 1))
              .slice(0, 8),
          }));
          console.log(JSON.stringify({
            event: "v2.manager_operations_layout_overflow",
            viewport: viewport.name,
            ...layout,
            ...diagnostics,
          }));
        }
        assert.deepEqual(layout, { panelVisible: true, panelOverflow: false, pageOverflow: false },
          `WebKit manager operations must fit ${viewport.name}`);
      }
    }

    await recoveryPage.goto(baseUrl);
    await recoveryPage.locator("#auth-form:not([hidden])").waitFor();
    await recoveryPage.locator("#auth-username").fill("V2RecoveryOperator");
    await recoveryPage.locator("#auth-password").fill("v2-test-browser-recovery-password");
    await recoveryPage.locator("#auth-submit").click();
    await recoveryPage.locator("#authenticated-app:not([hidden])").waitFor({ timeout: 20000 }).catch(async () => {
      const diag = {
        step: "late-operator-sign-in",
        authStatus: await recoveryPage.locator("#auth-status").textContent().catch(() => ""),
        authError: await recoveryPage.locator("#auth-error-message").textContent().catch(() => ""),
        formHidden: await recoveryPage.locator("#auth-form").getAttribute("hidden"),
        url: recoveryPage.url(),
      };
      console.log(JSON.stringify({ event: "v2.late_operator_sign_in_diag", ...diag }));
      throw new Error("late operator sign-in did not reach the authenticated app");
    });
    await recoveryPage.locator("#manager-operations-nav-link").waitFor({ state: "hidden" });
    await recoveryPage.locator("#manager-operations").waitFor({ state: "hidden" });
    await recoveryPage.locator("#staff-panel").waitFor({ state: "hidden" });
    const managerDiagnosticsDenied = await recoveryPage.evaluate(async () => {
      const [history, stationWorker] = await Promise.all([
        fetch("/api/v2/auth/staff-history", { credentials: "same-origin" }),
        fetch("/api/v2/manager-diagnostics/station-worker", { credentials: "same-origin" }),
      ]);
      return [history.status, stationWorker.status];
    });
    assert.deepEqual(managerDiagnosticsDenied, [403, 403],
      "operator browser session must not read staff history or station-worker status");
    expectedManagerForbidden = true;
    const operatorReadStatus = await recoveryPage.evaluate(async () => {
      const response = await fetch("/api/v2/manager-operations?from=2026-01-01&to=2026-01-01", {
        credentials: "same-origin", headers: { Accept: "application/json" },
      });
      return response.status;
    });
    expectedManagerForbidden = false;
    assert.equal(operatorReadStatus, 403, "operator browser session must not read manager operations");
    assert.equal(managerForbiddenSeen, true, "the authenticated operator request must be denied by the server");
    console.log("V2 authenticated Chromium inventory parity passed: receipts, formula-based preparation, staging, transfers, cycle counts, and reload persistence.");
  } finally {
    if (webkitContext) await webkitContext.close();
    if (webkitManagerContext) await webkitManagerContext.close();
    if (recoveryContext) await recoveryContext.close();
    if (webkitBrowser) await webkitBrowser.close();
    if (browser) await browser.close();
    if (serverInstance) await serverInstance.close();
    await rm(evidenceDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  const sourceFrame = error instanceof Error
    ? error.stack?.split("\n").slice(1)
      .find((line) => line.includes("http-postgres.browser.integration.mjs"))?.trim()
    : undefined;
  console.error(JSON.stringify({
    event: "v2.http_postgres_browser_integration.failed",
    errorName: typeof error?.name === "string" ? error.name : "UnknownError",
    location: sourceFrame || "browser integration source location unavailable",
    message: "Browser integration failed; sensitive test values are not logged.",
  }));
  process.exitCode = 1;
});
