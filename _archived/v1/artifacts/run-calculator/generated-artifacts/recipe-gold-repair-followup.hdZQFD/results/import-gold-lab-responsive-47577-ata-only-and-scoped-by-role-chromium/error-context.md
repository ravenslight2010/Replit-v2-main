# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: import-gold-lab-responsive.spec.ts >> daily retention reminders stay metadata-only and scoped by role
- Location: e2e/import-gold-lab-responsive.spec.ts:313:1

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
  - button "App updates · Current"
  - button "Check for updates"
- main:
  - heading "Production Run Calculator" [level=1]
  - paragraph: Pizza line planning & schedule estimation
  - 'button "Sync status: Synchronized"': Synchronized
  - text: Saved
  - button "Cast to other screens"
  - button "Enter fullscreen / kiosk mode"
  - button "Supervisor"
  - button "More — 1 manager action need attention": "1"
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
  314 |   page,
  315 |   playwright,
  316 | }, testInfo) => {
  317 |   test.setTimeout(180_000);
  318 |   const fixtures = await AuthorizedBrowserFixtures.create(playwright, API_BASE, SIGNUP_CODE);
  319 |   try {
  320 |     const manager = await fixtures.createAccount({
  321 |       username: uniqueTestId("e2e_gold_reminder_manager"),
  322 |       password: PASSWORD,
  323 |       capabilities: DEFAULT_MANAGER_CAPABILITIES,
  324 |       onboardingSeen: true,
  325 |     });
  326 |     const qcManager = await fixtures.createAccount({
  327 |       username: uniqueTestId("e2e_gold_reminder_qc"),
  328 |       password: PASSWORD,
  329 |       capabilities: ["manage-qc"],
  330 |       onboardingSeen: true,
  331 |     });
  332 |     await fixtures.assignQcManagerRole(qcManager);
  333 |     const staff = await fixtures.createAccount({
  334 |       username: uniqueTestId("e2e_gold_reminder_staff"),
  335 |       password: PASSWORD,
  336 |       capabilities: [],
  337 |       onboardingSeen: true,
  338 |     });
  339 | 
  340 |     let retentionRequests = 0;
  341 |     const retentionQueries: Array<{ status: string | null; offset: string | null }> = [];
  342 |     let goldCaseRequests = 0;
  343 |     await page.route("**/api/import-gold/config", (route) => route.fulfill({
  344 |       status: 200,
  345 |       contentType: "application/json",
  346 |       body: JSON.stringify({
  347 |         enabled: true,
  348 |         cleanupEnabled: false,
  349 |         localConfigured: false,
  350 |         localAvailable: false,
  351 |         localScoringSwitchAvailable: false,
  352 |         localScoringEnabled: false,
  353 |         syntheticFixtureAvailable: false,
  354 |         geminiConfigured: false,
  355 |         retention: "Synthetic reminder fixture.",
  356 |         persistsAcrossFactoryPurge: true,
  357 |       }),
  358 |     }));
  359 |     await page.route("**/api/import-gold/retention?*", async (route) => {
  360 |       retentionRequests += 1;
  361 |       const requestUrl = new URL(route.request().url());
  362 |       const status = requestUrl.searchParams.get("status");
  363 |       const offset = requestUrl.searchParams.get("offset");
  364 |       retentionQueries.push({ status, offset });
  365 |       const overdueRecord = {
  366 |         caseId: 91,
  367 |         capturedAt: "2026-09-01T12:00:00.000Z",
  368 |         deleteBy: "2026-10-01T12:00:00.000Z",
  369 |         status: "overdue",
  370 |         verifiedAt: null,
  371 |         verifiedBy: null,
  372 |       };
  373 |       const dueSoonRecord = {
  374 |         caseId: 92,
  375 |         capturedAt: "2026-10-05T12:00:00.000Z",
  376 |         deleteBy: "2026-11-04T12:00:00.000Z",
  377 |         status: "due_soon",
  378 |         verifiedAt: null,
  379 |         verifiedBy: null,
  380 |       };
  381 |       const allRecords = [overdueRecord, dueSoonRecord, { ...dueSoonRecord, caseId: 93 }];
  382 |       const matchingRecords = status === null ? allRecords : allRecords.filter((record) => record.status === status);
  383 |       const pageOffset = Number(offset ?? 0);
  384 |       const filteredRecords = matchingRecords.slice(pageOffset, pageOffset + 1);
  385 |       const hasMore = matchingRecords.length > pageOffset + 1;
  386 |       await route.fulfill({
  387 |         status: 200,
  388 |         contentType: "application/json",
  389 |         body: JSON.stringify({
  390 |           revision: "a".repeat(64),
  391 |           records: filteredRecords,
  392 |           hasMore,
  393 |           nextOffset: hasMore ? pageOffset + 1 : null,
  394 |         }),
  395 |       });
  396 |     });
  397 |     await page.route("**/api/import-gold/cases?*", async (route) => {
  398 |       goldCaseRequests += 1;
  399 |       await route.fulfill({
  400 |         status: 200,
  401 |         contentType: "application/json",
  402 |         body: JSON.stringify({ cases: [] }),
  403 |       });
  404 |     });
  405 | 
  406 |     const openHome = async (token: string) => {
  407 |       await page.context().clearCookies();
  408 |       await page.context().addCookies([{ name: "rc_auth", value: token, url: API_BASE }]);
  409 |       await page.goto("/", { waitUntil: "domcontentloaded" });
  410 |       await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
  411 |     };
  412 |     await openHome(manager.token);
  413 |     const reminders = page.getByTestId("gold-retention-reminders");
> 414 |     await expect(reminders).toBeVisible({ timeout: 15_000 });
      |                             ^ Error: expect(locator).toBeVisible() failed
  415 |     await expect(reminders.getByTestId("gold-retention-due-soon-reminder")).toContainText("2 deadlines due within 7 days");
  416 |     await expect(reminders.getByTestId("gold-retention-overdue-reminder")).toContainText("1 overdue deadline");
  417 |     await expect(reminders).not.toContainText(/SYNTHETIC_PRIVATE|Expected:|Predicted:|Spec import/);
  418 |     await expectResponsiveBounds(reminders);
  419 |     await reminders.getByTestId("gold-retention-overdue-reminder").click();
  420 | 
  421 |     const managerSettings = page.getByRole("dialog", { name: "Manage Lists & Settings" });
  422 |     const managerRetention = managerSettings.getByTestId("import-gold-retention");
  423 |     await expect(managerRetention).toBeVisible({ timeout: 15_000 });
  424 |     await expect(managerRetention.getByTestId("gold-retention-record-91")).toContainText("Overdue");
  425 |     await expect(managerSettings.getByText("Import Gold Lab", { exact: true })).toHaveCount(0);
  426 |     await expect(managerSettings.getByRole("button", { name: /Delete app case/ })).toHaveCount(0);
  427 |     await expect(managerRetention.getByTestId("gold-retention-record-91")).toBeVisible();
  428 |     await expect(managerRetention.getByTestId("gold-retention-record-92")).toHaveCount(0);
  429 |     await managerRetention.getByTestId("button-load-more-gold-retention").click();
  430 |     await expect(managerRetention.getByTestId("gold-retention-record-92")).toBeVisible();
  431 |     await managerRetention.getByTestId("gold-retention-status-filter").selectOption("due_soon");
  432 |     await expect(managerRetention.getByTestId("gold-retention-record-92")).toBeVisible();
  433 |     await expect(managerRetention.getByTestId("gold-retention-record-91")).toHaveCount(0);
  434 |     expect(retentionQueries).toContainEqual({ status: "due_soon", offset: "0" });
  435 |     await managerRetention.getByTestId("button-load-more-gold-retention").click();
  436 |     await expect(managerRetention.getByTestId("gold-retention-record-93")).toBeVisible();
  437 |     expect(retentionQueries).toContainEqual({ status: "due_soon", offset: "1" });
  438 |     await expect(managerRetention.getByTestId("button-load-more-gold-retention")).toHaveCount(0);
  439 |     await expectResponsiveBounds(managerRetention);
  440 |     await managerRetention.screenshot({ path: testInfo.outputPath("retention-status-due-soon.png") });
  441 |     expect(goldCaseRequests).toBe(0);
  442 | 
  443 |     await openHome(qcManager.token);
  444 |     const qcReminders = page.getByTestId("gold-retention-reminders");
  445 |     await expect(qcReminders).toBeVisible({ timeout: 15_000 });
  446 |     await expectResponsiveBounds(qcReminders);
  447 |     await qcReminders.getByTestId("gold-retention-due-soon-reminder").click();
  448 |     const qcSettings = page.getByRole("dialog", { name: "Manage Lists & Settings" });
  449 |     const qcRetention = qcSettings.getByTestId("import-gold-retention");
  450 |     await expect(qcRetention).toBeVisible({ timeout: 15_000 });
  451 |     await expect(qcSettings.getByText("Import Gold Lab", { exact: true })).toHaveCount(0);
  452 |     await expect(qcSettings.getByRole("button", { name: /Delete app case/ })).toHaveCount(0);
  453 |     await qcRetention.getByTestId("gold-retention-status-filter").selectOption("overdue");
  454 |     await expect(qcRetention.getByTestId("gold-retention-record-91")).toBeVisible();
  455 |     await expect(qcRetention.getByTestId("gold-retention-record-92")).toHaveCount(0);
  456 |     expect(retentionQueries).toContainEqual({ status: "overdue", offset: "0" });
  457 |     await expectResponsiveBounds(qcRetention);
  458 |     expect(goldCaseRequests).toBe(0);
  459 | 
  460 |     const retentionRequestsBeforeStaff = retentionRequests;
  461 |     await openHome(staff.token);
  462 |     await expect(page.getByTestId("gold-retention-reminders")).toHaveCount(0);
  463 |     await expect(page.getByTestId("gold-retention-reminder-error")).toHaveCount(0);
  464 |     expect(retentionRequests).toBe(retentionRequestsBeforeStaff);
  465 |     expect(goldCaseRequests).toBe(0);
  466 |   } finally {
  467 |     await fixtures.cleanup();
  468 |   }
  469 | });
  470 | 
```