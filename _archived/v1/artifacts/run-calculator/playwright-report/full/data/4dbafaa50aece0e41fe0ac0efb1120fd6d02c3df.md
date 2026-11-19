# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: field-check-diagnostics.spec.ts >> manager sees safe sync categories and performance sources from isolated API evidence
- Location: e2e/field-check-diagnostics.spec.ts:20:1

# Error details

```
Error: expect(received).toMatch(expected)

Expected pattern: /^field-check-report-v1-\d{4}-[\dTZ-]+\.json$/
Received string:  "field-check-report-v2-2026-11-16T16-07-02-248Z.json"
```

# Test source

```ts
  251 |   expect(await page.evaluate((key) => localStorage.getItem(key), unrelatedKey)).toBe(unrelatedRaw);
  252 |   reloading = true;
  253 |   await page.reload();
  254 |   await expect(page.getByTestId("shared-records-status"))
  255 |     .toContainText("Saved record on this device. Date: 2026-10-21.");
  256 |   await expect(page.getByTestId("shared-records-status"))
  257 |     .not.toContainText("2026-10-20");
  258 |   expect(await page.evaluate((key) => localStorage.getItem(key), unrelatedKey)).toBe(unrelatedRaw);
  259 |   await page.getByRole("button", { name: /^More/ }).click();
  260 |   await page.getByRole("menuitem", { name: "Reported issues" }).click();
  261 |   await finishManagerReload();
  262 |   const failures = page.getByLabel("Actionable field-check failures");
  263 |   await expect(failures).toBeVisible();
  264 |   await expect(page.getByText(incidentData.correlationId, { exact: true }).first()).toBeVisible();
  265 |   for (const { status, correlationId } of guidanceIncidents) {
  266 |     const incidentRow = page.getByTestId("incident-row").filter({ hasText: correlationId }).first();
  267 |     await expect(incidentRow.getByText(correlationId, { exact: true })).toBeVisible();
  268 |     if (status === 403) {
  269 |       await expect(incidentRow.getByText(/This request was denied because this account does not currently have permission/)).toBeVisible();
  270 |       await expect(incidentRow.getByText(/support route: not identified in the available diagnostics/)).toBeVisible();
  271 |     } else if (status === 409) {
  272 |       await expect(incidentRow.getByText(/The shared value changed before this save reached the server/)).toBeVisible();
  273 |     } else {
  274 |       await expect(incidentRow.getByText(/This sync update did not pass a validation check/)).toBeVisible();
  275 |       await expect(incidentRow.getByText("Support code: SYNC_VALIDATION_FAILED")).toBeVisible();
  276 |     }
  277 |   }
  278 |   await expect(page.getByText(incidentRequestReference, { exact: true })).toBeVisible();
  279 |   const serverErrorRow = page.getByTestId("incident-row").filter({ hasText: incidentData.correlationId }).first();
  280 |   await expect(serverErrorRow.getByText(/Syncing saved changes · the server reported an error · HTTP 500/)).toBeVisible();
  281 |   await expect(serverErrorRow.getByText(/Observed by this browser at/)).toBeVisible();
  282 |   await expect(serverErrorRow.getByText(/browser waited 4023360 ms/)).toBeVisible();
  283 |   await expect(serverErrorRow.getByText(/No background change was detected; the operating-system pause state is unknown/)).toBeVisible();
  284 |   await expect(serverErrorRow.getByText(/The browser wait is not server processing time/)).toBeVisible();
  285 |   await expect(serverErrorRow.getByText(/build reference app-build:identified/)).toBeVisible();
  286 |   const fieldChecks = page.getByTestId("field-checks-panel");
  287 |   await expect(fieldChecks.getByText("Evidence coverage: Never observed").first()).toBeVisible();
  288 |   const recoveryCard = fieldChecks.getByText("Stale-deployment recovery", { exact: true }).locator("../..");
  289 |   await expect(recoveryCard).toContainText("Evidence coverage: Observed, no success");
  290 |   await expect(recoveryCard).toContainText(
  291 |     "Accumulated totals (not daily): 0 failed · 1 incomplete · No issue recorded",
  292 |   );
  293 |   await expect(recoveryCard).toContainText("Last success: Not yet");
  294 |   await expect(fieldChecks.getByText(/Server receipt delay estimate: Unknown\/unconfirmed/).first()).toBeVisible();
  295 |   await expect(fieldChecks.getByText(/Server receipt delay estimate: .*after the browser timestamp/).first()).toBeVisible();
  296 |   for (const label of [
  297 |     "The account or permission was rejected",
  298 |     "The saved update was out of date or came after a reset",
  299 |     "The app tried to sync again but did not receive confirmation",
  300 |     "Home screen did not load · browser wait 20001 ms. Browser wait is not server processing time.",
  301 |     "Page did not open · browser wait 20002 ms. Browser wait is not server processing time.",
  302 |   ]) {
  303 |     await expect(failures.getByText(label, { exact: true })).toBeVisible();
  304 |   }
  305 |   await expect(failures.getByText(/Server returned an error · syncing · server error · HTTP 500 · browser wait 4023360 ms/))
  306 |     .toBeVisible();
  307 |   await expect(failures.getByText(requestReference, { exact: true })).toBeVisible();
  308 |   for (const viewport of [
  309 |     { width: 1440, height: 900 },
  310 |     { width: 390, height: 844 },
  311 |     { width: 844, height: 390 },
  312 |     { width: 820, height: 1180 },
  313 |     { width: 1180, height: 820 },
  314 |   ]) {
  315 |     await page.setViewportSize(viewport);
  316 |     await expect(failures).toContainText(requestReference);
  317 |     await expect(page.getByText(incidentData.correlationId, { exact: true }).first()).toBeVisible();
  318 |     expect(await page.locator("html").evaluate((html) => html.scrollWidth))
  319 |       .toBeLessThanOrEqual(viewport.width);
  320 |   }
  321 |   await page.setViewportSize({ width: 1440, height: 900 });
  322 |   // The UI intentionally shows three failures per check; the API retains all four sources.
  323 |   const report = await request.get(`${API_BASE}/api/field-checks`, { headers: { Authorization: `Bearer ${account.token}` } });
  324 |   const data = await report.json();
  325 |   expect(data.checks.find((check: { name: string }) => check.name === "performance").recentFailures)
  326 |     .toEqual(expect.arrayContaining([expect.objectContaining({ metrics: { sourceCode: 4, durationMs: 20004 } })]));
  327 |   expect(await failures.innerText()).not.toMatch(/Bearer|field_view|field_diagnostics|\/api\//);
  328 |   await expect(failures.getByText("Unidentified local build; not release verification evidence.").first()).toBeVisible();
  329 |   await expect(page.locator("html")).toHaveJSProperty("scrollWidth", await page.evaluate(() => innerWidth));
  330 |   await failures.screenshot({ path: testInfo.outputPath("safe-field-check-details.png") });
  331 | 
  332 |   const downloadButton = page.getByRole("button", { name: "Download safe field-check report" });
  333 |   await expect(downloadButton).toBeVisible();
  334 |   // Preserve the support-download regression alongside filtering: a failed
  335 |   // download must never delete or recover observations.
  336 |   const before = await failures.innerText();
  337 |   browserPhase = "simulated-export-failure";
  338 |   await page.evaluate(() => {
  339 |     const original = URL.createObjectURL;
  340 |     URL.createObjectURL = () => { throw new Error("isolated download failure"); };
  341 |     (window as unknown as { restoreExportUrl: () => void }).restoreExportUrl = () => { URL.createObjectURL = original; };
  342 |   });
  343 |   await downloadButton.click();
  344 |   await expect(page.getByRole("alert").filter({ hasText: "Couldn’t download the report" })).toBeVisible();
  345 |   expect(await failures.innerText()).toBe(before);
  346 |   browserPhase = "manager-view";
  347 |   await page.evaluate(() => (window as unknown as { restoreExportUrl: () => void }).restoreExportUrl());
  348 |   const downloadEvent = page.waitForEvent("download");
  349 |   await downloadButton.click();
  350 |   const download = await downloadEvent;
> 351 |   expect(download.suggestedFilename()).toMatch(/^field-check-report-v1-\d{4}-[\dTZ-]+\.json$/);
      |                                        ^ Error: expect(received).toMatch(expected)
  352 |   expect(await download.failure()).toBeNull();
  353 |   const stream = await download.createReadStream();
  354 |   const chunks = [];
  355 |   for await (const chunk of stream!) chunks.push(chunk);
  356 |   const text = Buffer.concat(chunks).toString("utf8");
  357 |   expect(Buffer.byteLength(text)).toBeLessThan(64_000);
  358 |   expect(text).not.toMatch(/Bearer|field_view|field_diagnostics|\/api\/|observationId|userId|clientId|runId/);
  359 |   const exported = JSON.parse(text);
  360 |   expect(exported).toMatchObject({ schemaVersion: 1, facilityScope: "current facility",
  361 |     provenance: { kind: "advisory-field-evidence", environment: "unknown", buildIdentity: "unknown" } });
  362 |   expect(exported.checks.find((check: { name: string }) => check.name === "performance").recentFailures)
  363 |     .toEqual(expect.arrayContaining([expect.objectContaining({
  364 |       buildCategory: "unknown-local", deviceCategory: "mobile-chrome",
  365 |       diagnostics: expect.objectContaining({ sourceCode: 4, durationMs: 20004 }),
  366 |     })]));
  367 |   expect(exported.checks.find((check: { name: string }) => check.name === "performance").recentFailures)
  368 |     .toEqual(expect.arrayContaining([expect.objectContaining({
  369 |       reportedRequestCorrelationId: requestReference,
  370 |       diagnostics: expect.objectContaining({ requestOutcomeCode: 1, httpStatusCode: 500 }),
  371 |     })]));
  372 |   await expect(page.getByRole("alert").filter({ hasText: "Couldn’t download the report" })).toHaveCount(0);
  373 |   expect(await failures.innerText()).toBe(before);
  374 |   const after = await request.get(`${API_BASE}/api/field-checks`, { headers: { Authorization: `Bearer ${account.token}` } });
  375 |   expect((await after.json()).checks).toEqual(data.checks);
  376 |   await expect(page.locator("html")).toHaveJSProperty("scrollWidth", await page.evaluate(() => innerWidth));
  377 | 
  378 |   // These older failures are outside the five most recent global rows. Filtering
  379 |   // must query the full retained population, not those five rows in the browser.
  380 |   const selectedSamples = Array.from({ length: 7 }, (_, i) => ({
  381 |     observationId: `${uniqueTestId("selected_field")}-${i}`,
  382 |     checkName: "sync-acknowledgment", checkVersion: "3", outcome: "failure",
  383 |     observedAt: new Date(Date.now() - 120_000 - i * 1000).toISOString(),
  384 |     appBuild: "fixture-build-a", deviceCategory: "mobile-safari", metrics: { failureCode: 2 },
  385 |   }));
  386 |   expect((await request.post(`${API_BASE}/api/field-checks/observations`, {
  387 |     headers: { Authorization: `Bearer ${account.token}` }, data: { observations: selectedSamples },
  388 |   })).status()).toBe(202);
  389 |   const panel = page.getByTestId("field-checks-panel");
  390 |   const filters = page.getByRole("group", { name: "Field evidence filters" });
  391 |   const population = page.getByTestId("field-evidence-population");
  392 |   await expect(population).toContainText("Unfiltered:");
  393 |   await filters.getByLabel("Build", { exact: true }).selectOption("exact");
  394 |   await filters.getByLabel("Exact build identifier", { exact: true }).fill("fixture-build-a");
  395 |   await filters.getByLabel("Browser category").selectOption("mobile-safari");
  396 |   await filters.getByRole("button", { name: "Apply field filters" }).click();
  397 |   await expect(population).toContainText("Selected population: fixture-build-a · mobile-safari");
  398 |   await expect(panel.getByText(
  399 |     "Accumulated totals (not daily): 7 failed · 0 incomplete · Open",
  400 |     { exact: true },
  401 |   )).toBeVisible();
  402 |   await expect(failures).toContainText("fixture-build-a");
  403 |   await expect(failures).not.toContainText("build local");
  404 |   await expect(panel.getByText("The saved update was out of date or came after a reset", { exact: true }).first()).toBeVisible();
  405 | 
  406 |   await filters.getByLabel("Browser category").selectOption("desktop-firefox");
  407 |   await filters.getByRole("button", { name: "Apply field filters" }).click();
  408 |   await expect(panel.getByText(
  409 |     "Accumulated totals (not daily): 7 failed · 0 incomplete · Open",
  410 |     { exact: true },
  411 |   )).toHaveCount(0);
  412 |   await expect(failures).toHaveCount(0);
  413 |   await expect(population).toContainText("desktop-firefox");
  414 | 
  415 |   await filters.getByLabel("Build", { exact: true }).selectOption("unknown");
  416 |   await filters.getByLabel("Browser category").selectOption("mobile-chrome");
  417 |   await filters.getByRole("button", { name: "Apply field filters" }).click();
  418 |   await expect(population).toContainText("Unknown build (local)");
  419 |   await expect(failures.getByText("Unidentified local build; not release verification evidence.").first()).toBeVisible();
  420 |   await expect(failures).not.toContainText("fixture-build-a");
  421 |   await expect(page.locator("html")).toHaveJSProperty("scrollWidth", await page.evaluate(() => innerWidth));
  422 |   await filters.scrollIntoViewIfNeeded();
  423 |   await filters.screenshot({ path: testInfo.outputPath("field-evidence-filters.png") });
  424 | 
  425 |   // A rejected read must not leave previous population results displayed.
  426 |   browserPhase = "simulated-read-rejection";
  427 |   await page.route("**/api/field-checks?*", (route) => route.fulfill({
  428 |     status: 400, json: { error: "Invalid field-check filters" },
  429 |   }));
  430 |   await filters.getByLabel("Build", { exact: true }).selectOption("exact");
  431 |   await filters.getByLabel("Exact build identifier", { exact: true }).fill("fixture-error");
  432 |   await filters.getByRole("button", { name: "Apply field filters" }).click();
  433 |   await expect(panel.getByText("Couldn’t load field-check evidence.", { exact: true })).toBeVisible({ timeout: 20_000 });
  434 |   await expect(failures).toHaveCount(0);
  435 |   await page.unroute("**/api/field-checks?*");
  436 |   browserPhase = "manager-recovery";
  437 |   await filters.getByRole("button", { name: "Clear field filters" }).click();
  438 |   await expect(population).toContainText("Unfiltered:");
  439 |   await expect(failures).toBeVisible();
  440 |   reloading = true;
  441 |   await page.reload();
  442 |   await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 30_000 });
  443 |   await page.getByRole("button", { name: /^More/ }).click();
  444 |   await page.getByRole("menuitem", { name: "Reported issues" }).click();
  445 |   await expect(page.getByTestId("field-evidence-population")).toContainText("Unfiltered:");
  446 |   await finishManagerReload();
  447 |   await expect(page.locator("html")).toHaveJSProperty("scrollWidth", await page.evaluate(() => innerWidth));
  448 |   const restricted = await fixtures.createAccount({
  449 |     username: uniqueTestId("field_no_review"), password: "TestPass123!",
  450 |     capabilities: DEFAULT_MANAGER_CAPABILITIES.filter((capability) => capability !== "review-incidents"),
  451 |   });
```