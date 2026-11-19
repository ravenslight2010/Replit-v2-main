# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: import-gold-lab-responsive.spec.ts >> QC Manager can use the scoped retention panel without opening the Gold Lab
- Location: e2e/import-gold-lab-responsive.spec.ts:236:1

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: getByRole('dialog', { name: 'Manage Lists & Settings' }).getByTestId('import-gold-retention').getByTestId('gold-retention-record-92')
Expected substring: "Deletion verification needed"
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toContainText" getByRole('dialog', { name: 'Manage Lists & Settings' }).getByTestId('import-gold-retention').getByTestId('gold-retention-record-92') with timeout 5000ms
  - waiting for getByRole('dialog', { name: 'Manage Lists & Settings' }).getByTestId('import-gold-retention').getByTestId('gold-retention-record-92')

```

```yaml
- complementary "App updates":
  - button "App updates · Development preview"
  - status: Development preview. Published updates are not checked in this development preview.
- main:
  - dialog "Manage Lists & Settings":
    - heading "Manage Lists & Settings" [level=2]
    - button "Close settings"
    - button "Recipes"
    - button "Lists"
    - button "Settings"
    - button "Tools"
    - button "Shift Times"
    - button "Gold Lab Retention"
    - button "Gold Lab Approvals"
    - button "Change PIN"
    - group:
      - region "Gold Lab retention":
        - heading "Gold Lab retention" [level=2]
        - paragraph: The 7-day reminder and overdue status are manual reminders; this register does not delete cases.
        - paragraph: This register covers application case and score deletion only. Workbook copies, exports, evaluator or diagnostic copies, and database backups are separate and are not verified here. No automated erasure is performed.
        - text: Filter by status
        - combobox "Filter retention records by status":
          - option "All statuses" [selected]
          - option "Within 30-day limit"
          - option "Due within 7 days"
          - option "Overdue"
          - option "Score history remains"
          - option "Deletion verification needed"
          - option "App deletion verified"
        - paragraph: Use the Gold Lab case controls to delete an application case. Either a Manager or QC Manager can record verification after the case and score history are gone.
        - alert: The retention register changed or returned an unreadable revision. Refresh to retry.
  - heading "Production Run Calculator" [level=1]
  - paragraph: Pizza line planning & schedule estimation
  - 'button "Sync status: Synchronized"': Synchronized
  - text: Saved
  - button "Cast to other screens"
  - button "Enter fullscreen / kiosk mode"
  - button "Operator"
  - button "More — 261 manager actions need attention": "261"
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
  193 | 
  194 |     const lab = settings.getByTestId("import-gold-lab");
  195 |     await expect(lab).toBeVisible({ timeout: 15_000 });
  196 |     const cleanupPanel = lab.getByTestId("import-gold-cleanup-only");
  197 |     await expect(cleanupPanel).toContainText("Source approval is off");
  198 |     await expect(cleanupPanel).toContainText("premix · #92");
  199 |     await expect(cleanupPanel).not.toContainText(/SYNTHETIC_PRIVATE|Expected:|Predicted:/);
  200 |     await expect(lab.getByRole("button", { name: "Export JSONL" })).toHaveCount(0);
  201 |     await expect(lab.getByRole("button", { name: "Score locally" })).toHaveCount(0);
  202 |     await lab.screenshot({ path: testInfo.outputPath("cleanup-only-before.png") });
  203 |     await expectResponsiveBounds(lab);
  204 | 
  205 |     page.once("dialog", (dialog) => dialog.accept());
  206 |     await cleanupPanel.getByRole("button", { name: "Delete case and scores" }).click();
  207 |     await expect(cleanupPanel).toContainText("No retained cases are available for cleanup in this scope.");
  208 |     expect(deletionRequests).toEqual([expect.stringContaining("/api/import-gold/cleanup-cases/92")]);
  209 |     await lab.screenshot({ path: testInfo.outputPath("cleanup-only-after.png") });
  210 |     await expectResponsiveBounds(lab);
  211 |   } finally {
  212 |     await fixtures.cleanup();
  213 |   }
  214 | });
  215 | 
  216 | async function expectResponsiveBounds(lab: Locator): Promise<void> {
  217 |   const geometry = await lab.evaluate((element) => {
  218 |     const rect = element.getBoundingClientRect();
  219 |     const dialog = element.closest('[role="dialog"]');
  220 |     const dialogRect = dialog?.getBoundingClientRect();
  221 |     return {
  222 |       left: rect.left,
  223 |       right: rect.right,
  224 |       viewportWidth: window.innerWidth,
  225 |       dialogLeft: dialogRect?.left ?? 0,
  226 |       dialogRight: dialogRect?.right ?? window.innerWidth,
  227 |       documentWidth: document.documentElement.scrollWidth,
  228 |     };
  229 |   });
  230 |   expect(geometry.left).toBeGreaterThanOrEqual(geometry.dialogLeft);
  231 |   expect(geometry.right).toBeLessThanOrEqual(geometry.dialogRight);
  232 |   expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth);
  233 |   expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  234 | }
  235 | 
  236 | test("QC Manager can use the scoped retention panel without opening the Gold Lab", async ({
  237 |   page,
  238 |   playwright,
  239 | }) => {
  240 |   test.setTimeout(120_000);
  241 |   const fixtures = await AuthorizedBrowserFixtures.create(playwright, API_BASE, SIGNUP_CODE);
  242 |   try {
  243 |     const account = await fixtures.createAccount({
  244 |       username: uniqueTestId("e2e_gold_retention_qc"),
  245 |       password: PASSWORD,
  246 |       capabilities: ["manage-qc"],
  247 |       onboardingSeen: true,
  248 |     });
  249 |     await fixtures.assignQcManagerRole(account);
  250 |     let verified = false;
  251 |     await page.route("**/api/import-gold/retention?*", (route) => route.fulfill({
  252 |       status: 200,
  253 |       contentType: "application/json",
  254 |       body: JSON.stringify({
  255 |         records: [{
  256 |           caseId: 92,
  257 |           capturedAt: "2026-09-05T12:00:00.000Z",
  258 |           deleteBy: "2026-10-05T12:00:00.000Z",
  259 |           status: verified ? "verified" : "verification_needed",
  260 |           verifiedAt: verified ? "2026-10-06T12:00:00.000Z" : null,
  261 |           verifiedBy: verified ? "qc-manager-fixture" : null,
  262 |         }],
  263 |         hasMore: false,
  264 |         nextOffset: null,
  265 |       }),
  266 |     }));
  267 |     await page.route("**/api/import-gold/retention/92/verification", async (route) => {
  268 |       verified = true;
  269 |       await route.fulfill({
  270 |         status: 200,
  271 |         contentType: "application/json",
  272 |         body: JSON.stringify({
  273 |           caseId: 92,
  274 |           verifiedAt: "2026-10-06T12:00:00.000Z",
  275 |           verifiedBy: "qc-manager-fixture",
  276 |         }),
  277 |       });
  278 |     });
  279 |     await page.context().addCookies([{ name: "rc_auth", value: account.token, url: API_BASE }]);
  280 |     await page.goto("/", { waitUntil: "domcontentloaded" });
  281 |     await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
  282 | 
  283 |     await page.locator('button[title="More"]').click();
  284 |     await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
  285 |     const settings = page.getByRole("dialog", { name: "Manage Lists & Settings" });
  286 |     await expect(settings).toBeVisible();
  287 |     await settings.getByRole("button", { name: "Settings", exact: true }).click();
  288 |     await settings.getByRole("button", { name: "Gold Lab Retention", exact: true }).click();
  289 | 
  290 |     const panel = settings.getByTestId("import-gold-retention");
  291 |     await expect(panel).toBeVisible({ timeout: 15_000 });
  292 |     await expect(panel.getByText("Gold Lab retention", { exact: true })).toBeVisible();
> 293 |     await expect(panel.getByTestId("gold-retention-record-92")).toContainText("Deletion verification needed");
      |                                                                 ^ Error: expect(locator).toContainText(expected) failed
  294 |     await expect(settings.getByText("Import Gold Lab", { exact: true })).toHaveCount(0);
  295 |     await panel.getByTestId("button-verify-gold-case-92").click();
  296 |     await expect(panel.getByTestId("gold-retention-record-92")).toContainText("App deletion verified");
  297 |     await expect(panel.getByTestId("gold-retention-verification-92")).toContainText("qc-manager-fixture");
  298 | 
  299 |     const geometry = await panel.evaluate((element) => ({
  300 |       right: element.getBoundingClientRect().right,
  301 |       viewportWidth: window.innerWidth,
  302 |       documentWidth: document.documentElement.scrollWidth,
  303 |     }));
  304 |     expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth);
  305 |     expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  306 |   } finally {
  307 |     await fixtures.cleanup();
  308 |   }
  309 | });
  310 | 
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
```