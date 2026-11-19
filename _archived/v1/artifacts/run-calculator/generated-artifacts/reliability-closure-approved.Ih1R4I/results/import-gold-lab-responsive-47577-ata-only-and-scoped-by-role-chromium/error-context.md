# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: import-gold-lab-responsive.spec.ts >> daily retention reminders stay metadata-only and scoped by role
- Location: e2e/import-gold-lab-responsive.spec.ts:311:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByTestId('gold-retention-reminders')
Expected: visible
Timeout: 15000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByTestId('gold-retention-reminders') with timeout 15000ms
  - waiting for getByTestId('gold-retention-reminders')

```

```yaml
- complementary "App updates":
  - button "App updates · Development preview"
  - status: Development preview. Published updates are not checked in this development preview.
- main:
  - heading "Production Run Calculator" [level=1]
  - paragraph: Pizza line planning & schedule estimation
  - 'button "Sync status: Synchronized"': Synchronized
  - text: Saved
  - button "Cast to other screens"
  - button "Enter fullscreen / kiosk mode"
  - button "Supervisor"
  - button "More — 263 manager actions need attention": "263"
  - status:
    - text: Gold Lab deadline reminders are unavailable. Open the retention register to retry.
    - button "Open retention register"
  - group "production-line department":
    - tabpanel "Run":
      - text: Provisional — awaiting server confirmation
      - button "Line Map"
      - text: Run 1 of 1 1/30
      - button "New Run"
      - text: Run Setup Brand & Flavor
      - textbox "Brand…"
      - text: —
      - textbox "Flavor…"
      - text: Target Cases
      - spinbutton "0"
      - paragraph: ⚠ Enter cases to enable calculations
      - button "START RUN"
      - text: Line Details Cases Left to Run 0 Approx. Cases on Line 0 Dough Status Balanced Cases on Last Skid 0
      - heading "Temporary Adjustments" [level=3]
      - button "Clear All"
      - text: Freeze Tunnel Time
      - spinbutton "Freeze Tunnel Time": "0"
      - text: Crusts/Cycle
      - spinbutton "Crusts/Cycle": "0"
      - text: Cycle Speed
      - spinbutton "Cycle Speed": "0"
      - paragraph: For this run only — leave at 0 to use the Setup value. Setup stays unchanged.
      - group: Line Setup
  - group "production-line department"
  - tablist:
    - tab "Run" [selected]
    - tab "Dough"
    - tab "Sauce"
    - tab "Front"
    - tab "Pack"
    - tab "Warehouse"
  - group "production-line department"
  - group "production-line department"
  - group "production-line department"
- region "Notifications (F8)":
  - list
```

# Test source

```ts
  311 | test("daily retention reminders stay metadata-only and scoped by role", async ({
  312 |   page,
  313 |   playwright,
  314 | }, testInfo) => {
  315 |   test.setTimeout(180_000);
  316 |   const fixtures = await AuthorizedBrowserFixtures.create(playwright, API_BASE, SIGNUP_CODE);
  317 |   try {
  318 |     const manager = await fixtures.createAccount({
  319 |       username: uniqueTestId("e2e_gold_reminder_manager"),
  320 |       password: PASSWORD,
  321 |       capabilities: DEFAULT_MANAGER_CAPABILITIES,
  322 |       onboardingSeen: true,
  323 |     });
  324 |     const qcManager = await fixtures.createAccount({
  325 |       username: uniqueTestId("e2e_gold_reminder_qc"),
  326 |       password: PASSWORD,
  327 |       capabilities: ["manage-qc"],
  328 |       onboardingSeen: true,
  329 |     });
  330 |     await fixtures.assignQcManagerRole(qcManager);
  331 |     const staff = await fixtures.createAccount({
  332 |       username: uniqueTestId("e2e_gold_reminder_staff"),
  333 |       password: PASSWORD,
  334 |       capabilities: [],
  335 |       onboardingSeen: true,
  336 |     });
  337 | 
  338 |     let retentionRequests = 0;
  339 |     const retentionQueries: Array<{ status: string | null; offset: string | null }> = [];
  340 |     let goldCaseRequests = 0;
  341 |     await page.route("**/api/import-gold/config", (route) => route.fulfill({
  342 |       status: 200,
  343 |       contentType: "application/json",
  344 |       body: JSON.stringify({
  345 |         enabled: true,
  346 |         cleanupEnabled: false,
  347 |         localConfigured: false,
  348 |         localAvailable: false,
  349 |         localScoringSwitchAvailable: false,
  350 |         localScoringEnabled: false,
  351 |         syntheticFixtureAvailable: false,
  352 |         geminiConfigured: false,
  353 |         retention: "Synthetic reminder fixture.",
  354 |         persistsAcrossFactoryPurge: true,
  355 |       }),
  356 |     }));
  357 |     await page.route("**/api/import-gold/retention?*", async (route) => {
  358 |       retentionRequests += 1;
  359 |       const requestUrl = new URL(route.request().url());
  360 |       const status = requestUrl.searchParams.get("status");
  361 |       const offset = requestUrl.searchParams.get("offset");
  362 |       retentionQueries.push({ status, offset });
  363 |       const overdueRecord = {
  364 |         caseId: 91,
  365 |         capturedAt: "2026-09-01T12:00:00.000Z",
  366 |         deleteBy: "2026-10-01T12:00:00.000Z",
  367 |         status: "overdue",
  368 |         verifiedAt: null,
  369 |         verifiedBy: null,
  370 |       };
  371 |       const dueSoonRecord = {
  372 |         caseId: 92,
  373 |         capturedAt: "2026-10-05T12:00:00.000Z",
  374 |         deleteBy: "2026-11-04T12:00:00.000Z",
  375 |         status: "due_soon",
  376 |         verifiedAt: null,
  377 |         verifiedBy: null,
  378 |       };
  379 |       const allRecords = [overdueRecord, dueSoonRecord, { ...dueSoonRecord, caseId: 93 }];
  380 |       const matchingRecords = status === null ? allRecords : allRecords.filter((record) => record.status === status);
  381 |       const pageOffset = Number(offset ?? 0);
  382 |       const filteredRecords = matchingRecords.slice(pageOffset, pageOffset + 1);
  383 |       const hasMore = matchingRecords.length > pageOffset + 1;
  384 |       await route.fulfill({
  385 |         status: 200,
  386 |         contentType: "application/json",
  387 |         body: JSON.stringify({
  388 |           records: filteredRecords,
  389 |           hasMore,
  390 |           nextOffset: hasMore ? pageOffset + 1 : null,
  391 |         }),
  392 |       });
  393 |     });
  394 |     await page.route("**/api/import-gold/cases?*", async (route) => {
  395 |       goldCaseRequests += 1;
  396 |       await route.fulfill({
  397 |         status: 200,
  398 |         contentType: "application/json",
  399 |         body: JSON.stringify({ cases: [] }),
  400 |       });
  401 |     });
  402 | 
  403 |     const openHome = async (token: string) => {
  404 |       await page.context().clearCookies();
  405 |       await page.context().addCookies([{ name: "rc_auth", value: token, url: API_BASE }]);
  406 |       await page.goto("/", { waitUntil: "domcontentloaded" });
  407 |       await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
  408 |     };
  409 |     await openHome(manager.token);
  410 |     const reminders = page.getByTestId("gold-retention-reminders");
> 411 |     await expect(reminders).toBeVisible({ timeout: 15_000 });
      |                             ^ Error: expect(locator).toBeVisible() failed
  412 |     await expect(reminders.getByTestId("gold-retention-due-soon-reminder")).toContainText("2 deadlines due within 7 days");
  413 |     await expect(reminders.getByTestId("gold-retention-overdue-reminder")).toContainText("1 overdue deadline");
  414 |     await expect(reminders).not.toContainText(/SYNTHETIC_PRIVATE|Expected:|Predicted:|Spec import/);
  415 |     await expectResponsiveBounds(reminders);
  416 |     await reminders.getByTestId("gold-retention-overdue-reminder").click();
  417 | 
  418 |     const managerSettings = page.getByRole("dialog", { name: "Manage Lists & Settings" });
  419 |     const managerRetention = managerSettings.getByTestId("import-gold-retention");
  420 |     await expect(managerRetention).toBeVisible({ timeout: 15_000 });
  421 |     await expect(managerRetention.getByTestId("gold-retention-record-91")).toContainText("Overdue");
  422 |     await expect(managerSettings.getByText("Import Gold Lab", { exact: true })).toHaveCount(0);
  423 |     await expect(managerSettings.getByRole("button", { name: /Delete app case/ })).toHaveCount(0);
  424 |     await expect(managerRetention.getByTestId("gold-retention-record-91")).toBeVisible();
  425 |     await expect(managerRetention.getByTestId("gold-retention-record-92")).toHaveCount(0);
  426 |     await managerRetention.getByTestId("button-load-more-gold-retention").click();
  427 |     await expect(managerRetention.getByTestId("gold-retention-record-92")).toBeVisible();
  428 |     await managerRetention.getByTestId("gold-retention-status-filter").selectOption("due_soon");
  429 |     await expect(managerRetention.getByTestId("gold-retention-record-92")).toBeVisible();
  430 |     await expect(managerRetention.getByTestId("gold-retention-record-91")).toHaveCount(0);
  431 |     expect(retentionQueries).toContainEqual({ status: "due_soon", offset: "0" });
  432 |     await managerRetention.getByTestId("button-load-more-gold-retention").click();
  433 |     await expect(managerRetention.getByTestId("gold-retention-record-93")).toBeVisible();
  434 |     expect(retentionQueries).toContainEqual({ status: "due_soon", offset: "1" });
  435 |     await expect(managerRetention.getByTestId("button-load-more-gold-retention")).toHaveCount(0);
  436 |     await expectResponsiveBounds(managerRetention);
  437 |     await managerRetention.screenshot({ path: testInfo.outputPath("retention-status-due-soon.png") });
  438 |     expect(goldCaseRequests).toBe(0);
  439 | 
  440 |     await openHome(qcManager.token);
  441 |     const qcReminders = page.getByTestId("gold-retention-reminders");
  442 |     await expect(qcReminders).toBeVisible({ timeout: 15_000 });
  443 |     await expectResponsiveBounds(qcReminders);
  444 |     await qcReminders.getByTestId("gold-retention-due-soon-reminder").click();
  445 |     const qcSettings = page.getByRole("dialog", { name: "Manage Lists & Settings" });
  446 |     const qcRetention = qcSettings.getByTestId("import-gold-retention");
  447 |     await expect(qcRetention).toBeVisible({ timeout: 15_000 });
  448 |     await expect(qcSettings.getByText("Import Gold Lab", { exact: true })).toHaveCount(0);
  449 |     await expect(qcSettings.getByRole("button", { name: /Delete app case/ })).toHaveCount(0);
  450 |     await qcRetention.getByTestId("gold-retention-status-filter").selectOption("overdue");
  451 |     await expect(qcRetention.getByTestId("gold-retention-record-91")).toBeVisible();
  452 |     await expect(qcRetention.getByTestId("gold-retention-record-92")).toHaveCount(0);
  453 |     expect(retentionQueries).toContainEqual({ status: "overdue", offset: "0" });
  454 |     await expectResponsiveBounds(qcRetention);
  455 |     expect(goldCaseRequests).toBe(0);
  456 | 
  457 |     const retentionRequestsBeforeStaff = retentionRequests;
  458 |     await openHome(staff.token);
  459 |     await expect(page.getByTestId("gold-retention-reminders")).toHaveCount(0);
  460 |     await expect(page.getByTestId("gold-retention-reminder-error")).toHaveCount(0);
  461 |     expect(retentionRequests).toBe(retentionRequestsBeforeStaff);
  462 |     expect(goldCaseRequests).toBe(0);
  463 |   } finally {
  464 |     await fixtures.cleanup();
  465 |   }
  466 | });
  467 | 
```