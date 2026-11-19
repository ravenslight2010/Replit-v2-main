# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: import-gold-lab-responsive.spec.ts >> Import Gold manager panel fits and remains reviewable at this browser viewport
- Location: e2e/import-gold-lab-responsive.spec.ts:14:1

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: getByRole('dialog', { name: 'Manage Lists & Settings' }).getByTestId('import-gold-lab').getByTestId('gold-retention-record-91')
Expected substring: "Overdue"
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toContainText" getByRole('dialog', { name: 'Manage Lists & Settings' }).getByTestId('import-gold-lab').getByTestId('gold-retention-record-91') with timeout 5000ms
  - waiting for getByRole('dialog', { name: 'Manage Lists & Settings' }).getByTestId('import-gold-lab').getByTestId('gold-retention-record-91')

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
    - button "Rules"
    - button "Die Defaults"
    - button "Freezer Pull"
    - button "Cycle Counts"
    - button "Staff"
    - button "Data Health & Audit"
    - button "AI Memory"
    - button "Gold Lab Retention"
    - button "Change PIN"
    - button "Manage Runs"
    - group:
      - text: Data health workspace
      - button "Run check"
      - paragraph: One scoped review of factory data health. Exact repairs show their change preview; uncertain findings stay in the specialized workflow that owns the decision.
      - paragraph: Canonical sync self-check
      - paragraph: Read-only production checks for the daily snapshot, operational state, and command history.
      - button "Run self-check"
      - paragraph: Run the self-check to review the current production sync evidence.
      - paragraph: Run a check to review production master-data findings.
      - text: Sync conflict monitor
      - button "Refresh"
      - paragraph: Protected sync merges from your local calendar day and the previous six days.
      - paragraph: Conflicts today
      - paragraph: "0"
      - paragraph: No protected merges recorded today.
      - paragraph: Seven-day trend
      - paragraph: "0"
      - paragraph: Mon, 10/26
      - paragraph: "0"
      - paragraph: Tue, 10/27
      - paragraph: "0"
      - paragraph: Wed, 10/28
      - paragraph: "0"
      - paragraph: Thu, 10/29
      - paragraph: "0"
      - paragraph: Fri, 10/30
      - paragraph: "0"
      - paragraph: Sat, 10/31
      - paragraph: "0"
      - paragraph: Sun, 11/1
      - paragraph: Most-conflicted fields
      - paragraph: No conflicts in this seven-day window.
      - paragraph: Runs most affected
      - paragraph: No run-specific conflicts in this seven-day window.
      - text: Audit Log
      - paragraph: "Read-only record of high-stakes actions: factory resets, production rule changes, and similar manager-level events. Stored server-side and cannot be edited or deleted."
      - text: From
      - textbox: 2026-10-02
      - text: To
      - textbox: 2026-11-01
      - text: Max rows
      - spinbutton: "100"
      - button "Apply"
      - button "Refresh"
      - button "PDF"
      - table:
        - rowgroup:
          - row "Timestamp Actor Action Resource Summary":
            - columnheader "Timestamp"
            - columnheader "Actor"
            - columnheader "Action"
            - columnheader "Resource"
            - columnheader "Summary"
        - rowgroup:
          - 'row "Nov 1, 2026, 07:36 AM 51d6b618-8199-46f7-bbb6-62a9406ac15e import_gold_approval_created import_gold_approval outcome: \"success\" · targetId: \"1\""':
            - cell "Nov 1, 2026, 07:36 AM"
            - cell "51d6b618-8199-46f7-bbb6-62a9406ac15e"
            - cell "import_gold_approval_created"
            - cell "import_gold_approval"
            - 'cell "outcome: \"success\" · targetId: \"1\""'
          - 'row "Nov 1, 2026, 07:36 AM e53ec423-33c2-473f-9372-a6c5dd835a70 dough_recipe_created dough_recipe:ignoredFilterDough_mvxingf0_bpb5v59z fieldNames: [\"name\",\"notes\",\"components\",\"enabled\",\" · correlationId: \"3d7d020b-fd06-472e-9d74-b7ed916a5ad0\""':
            - cell "Nov 1, 2026, 07:36 AM"
            - cell "e53ec423-33c2-473f-9372-a6c5dd835a70"
            - cell "dough_recipe_created"
            - cell "dough_recipe:ignoredFilterDough_mvxingf0_bpb5v59z"
            - 'cell "fieldNames: [\"name\",\"notes\",\"components\",\"enabled\",\" · correlationId: \"3d7d020b-fd06-472e-9d74-b7ed916a5ad0\""'
          - 'row "Nov 1, 2026, 07:36 AM e53ec423-33c2-473f-9372-a6c5dd835a70 dough_recipe_created dough_recipe:ignoredFilterDough_mvxingf0_qdxoc0hl fieldNames: [\"name\",\"notes\",\"components\",\"enabled\",\" · correlationId: \"3d7d020b-fd06-472e-9d74-b7ed916a5ad0\""':
            - cell "Nov 1, 2026, 07:36 AM"
            - cell "e53ec423-33c2-473f-9372-a6c5dd835a70"
            - cell "dough_recipe_created"
            - cell "dough_recipe:ignoredFilterDough_mvxingf0_qdxoc0hl"
            - 'cell "fieldNames: [\"name\",\"notes\",\"components\",\"enabled\",\" · correlationId: \"3d7d020b-fd06-472e-9d74-b7ed916a5ad0\""'
          - 'row "Nov 1, 2026, 07:36 AM e53ec423-33c2-473f-9372-a6c5dd835a70 dough_recipe_created dough_recipe:ignoredFilterDough_mvxingf0_yt9j8hia fieldNames: [\"name\",\"notes\",\"components\",\"enabled\",\" · correlationId: \"3d7d020b-fd06-472e-9d74-b7ed916a5ad0\""':
            - cell "Nov 1, 2026, 07:36 AM"
            - cell "e53ec423-33c2-473f-9372-a6c5dd835a70"
            - cell "dough_recipe_created"
            - cell "dough_recipe:ignoredFilterDough_mvxingf0_yt9j8hia"
            - 'cell "fieldNames: [\"name\",\"notes\",\"components\",\"enabled\",\" · correlationId: \"3d7d020b-fd06-472e-9d74-b7ed916a5ad0\""'
          - 'row "Nov 1, 2026, 07:36 AM e53ec423-33c2-473f-9372-a6c5dd835a70 dough_recipe_created dough_recipe:ignoredFilterDough_mvxingf0_msqxzd99 fieldNames: [\"name\",\"notes\",\"components\",\"enabled\",\" · correlationId: \"3d7d020b-fd06-472e-9d74-b7ed916a5ad0\""':
            - cell "Nov 1, 2026, 07:36 AM"
            - cell "e53ec423-33c2-473f-9372-a6c5dd835a70"
            - cell "dough_recipe_created"
            - cell "dough_recipe:ignoredFilterDough_mvxingf0_msqxzd99"
            - 'cell "fieldNames: [\"name\",\"notes\",\"components\",\"enabled\",\" · correlationId: \"3d7d020b-fd06-472e-9d74-b7ed916a5ad0\""'
          - 'row "Nov 1, 2026, 07:25 AM audit_maintenance audit_log_deleted audit_logs:9 outcome: \"success\" · targetId: 9 · reasonCode: \"browser_fixture_cleanup\""':
            - cell "Nov 1, 2026, 07:25 AM"
            - cell "audit_maintenance"
            - cell "audit_log_deleted"
            - cell "audit_logs:9"
            - 'cell "outcome: \"success\" · targetId: 9 · reasonCode: \"browser_fixture_cleanup\""'
          - 'row "Nov 1, 2026, 07:25 AM audit_maintenance audit_log_deleted audit_logs:7 outcome: \"success\" · targetId: 7 · reasonCode: \"browser_fixture_cleanup\""':
            - cell "Nov 1, 2026, 07:25 AM"
            - cell "audit_maintenance"
            - cell "audit_log_deleted"
            - cell "audit_logs:7"
            - 'cell "outcome: \"success\" · targetId: 7 · reasonCode: \"browser_fixture_cleanup\""'
          - 'row "Nov 1, 2026, 07:24 AM audit_maintenance audit_log_deleted audit_logs:3 outcome: \"success\" · targetId: 3 · reasonCode: \"browser_fixture_cleanup\""':
            - cell "Nov 1, 2026, 07:24 AM"
            - cell "audit_maintenance"
            - cell "audit_log_deleted"
            - cell "audit_logs:3"
            - 'cell "outcome: \"success\" · targetId: 3 · reasonCode: \"browser_fixture_cleanup\""'
          - 'row "Nov 1, 2026, 07:24 AM audit_maintenance audit_log_deleted audit_logs:2 outcome: \"success\" · targetId: 2 · reasonCode: \"browser_fixture_cleanup\""':
            - cell "Nov 1, 2026, 07:24 AM"
            - cell "audit_maintenance"
            - cell "audit_log_deleted"
            - cell "audit_logs:2"
            - 'cell "outcome: \"success\" · targetId: 2 · reasonCode: \"browser_fixture_cleanup\""'
          - 'row "Nov 1, 2026, 07:24 AM audit_maintenance audit_log_deleted audit_logs:1 outcome: \"success\" · targetId: 1 · reasonCode: \"browser_fixture_cleanup\""':
            - cell "Nov 1, 2026, 07:24 AM"
            - cell "audit_maintenance"
            - cell "audit_log_deleted"
            - cell "audit_logs:1"
            - 'cell "outcome: \"success\" · targetId: 1 · reasonCode: \"browser_fixture_cleanup\""'
      - paragraph: 10 events shown
      - region "Import Gold Lab":
        - heading "Import Gold Lab" [level=2]
        - paragraph: Evaluation cases use only results that a person reviewed and successfully applied. Scoring never writes to recipes or inventory.
        - button "Export JSONL"
        - paragraph: Local scoring controls are available only in a development workspace.
        - region "Deletion deadlines":
          - heading "Deletion deadlines" [level=2]
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
          - alert: The retention register changed or returned an unreadable revision. Refresh to retry.
        - text: "1 active / 1 cases local: 66.7% average field agreement (1 successful scores) gemini: not scored (0 successful scores)"
        - paragraph: Cases remain until a manager deletes them. Factory purge does not delete these cases; delete them here by the displayed deadline.
        - article:
          - text: "spec · Spec import · #91 10/21/2026, 12:00:00 PM local: 66.67% (2/3)"
          - button "Exclude"
          - button "Delete"
          - group: Review field differences
  - heading "Production Run Calculator" [level=1]
  - paragraph: Pizza line planning & schedule estimation
  - 'button "Sync status: Synchronized"': Synchronized
  - text: Saved
  - button "Cast to other screens"
  - button "Enter fullscreen / kiosk mode"
  - button "Supervisor"
  - button "More — 256 manager actions need attention": "256"
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
  21  |     const account = await fixtures.createAccount({
  22  |       username: uniqueTestId("e2e_import_gold"),
  23  |       password: PASSWORD,
  24  |       capabilities: DEFAULT_MANAGER_CAPABILITIES,
  25  |       onboardingSeen: true,
  26  |     });
  27  |     await page.route("**/api/import-gold/config", (route) => route.fulfill({
  28  |       status: 200,
  29  |       contentType: "application/json",
  30  |       body: JSON.stringify({
  31  |         enabled: true,
  32  |         cleanupEnabled: false,
  33  |         localConfigured: false,
  34  |         localAvailable: false,
  35  |         localScoringSwitchAvailable: false,
  36  |         localScoringEnabled: false,
  37  |         syntheticFixtureAvailable: false,
  38  |         geminiConfigured: false,
  39  |         retention: "Cases remain until a manager deletes them.",
  40  |         persistsAcrossFactoryPurge: true,
  41  |       }),
  42  |     }));
  43  |     await page.route("**/api/import-gold/cases?*", (route) => route.fulfill({
  44  |       status: 200,
  45  |       contentType: "application/json",
  46  |       body: JSON.stringify({
  47  |         cases: [{
  48  |           id: 91,
  49  |           importType: "spec",
  50  |           sourceLabel: "Spec import",
  51  |           excluded: false,
  52  |           createdAt: "2026-10-21T12:00:00.000Z",
  53  |           scores: [{
  54  |             id: 7,
  55  |             provider: "local",
  56  |             status: "scored",
  57  |             accuracy: 66.67,
  58  |             comparedFields: 3,
  59  |             equalFields: 2,
  60  |             errorCode: null,
  61  |             fieldDiffs: [{ field: "recipes[0].rows[0].lbs", expected: 1, predicted: 2 }],
  62  |             createdAt: "2026-10-21T12:01:00.000Z",
  63  |           }],
  64  |         }],
  65  |       }),
  66  |     }));
  67  |     let deletionVerified = false;
  68  |     await page.route("**/api/import-gold/retention?*", (route) => route.fulfill({
  69  |       status: 200,
  70  |       contentType: "application/json",
  71  |       body: JSON.stringify({
  72  |         records: [
  73  |           {
  74  |             caseId: 91,
  75  |             capturedAt: "2026-09-01T12:00:00.000Z",
  76  |             deleteBy: "2026-10-01T12:00:00.000Z",
  77  |             status: "overdue",
  78  |             verifiedAt: null,
  79  |             verifiedBy: null,
  80  |           },
  81  |           {
  82  |             caseId: 92,
  83  |             capturedAt: "2026-09-05T12:00:00.000Z",
  84  |             deleteBy: "2026-10-05T12:00:00.000Z",
  85  |             status: deletionVerified ? "verified" : "verification_needed",
  86  |             verifiedAt: deletionVerified ? "2026-10-06T12:00:00.000Z" : null,
  87  |             verifiedBy: deletionVerified ? "manager-fixture" : null,
  88  |           },
  89  |         ],
  90  |         hasMore: false,
  91  |         nextOffset: null,
  92  |       }),
  93  |     }));
  94  |     await page.route("**/api/import-gold/retention/92/verification", async (route) => {
  95  |       deletionVerified = true;
  96  |       await route.fulfill({
  97  |         status: 200,
  98  |         contentType: "application/json",
  99  |         body: JSON.stringify({
  100 |           caseId: 92,
  101 |           verifiedAt: "2026-10-06T12:00:00.000Z",
  102 |           verifiedBy: "manager-fixture",
  103 |         }),
  104 |       });
  105 |     });
  106 |     await page.context().addCookies([{ name: "rc_auth", value: account.token, url: API_BASE }]);
  107 |     await page.goto("/", { waitUntil: "domcontentloaded" });
  108 |     await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
  109 | 
  110 |     await page.locator('button[title="More"]').click();
  111 |     await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
  112 |     const settings = page.getByRole("dialog", { name: "Manage Lists & Settings" });
  113 |     await expect(settings).toBeVisible();
  114 |     await settings.getByRole("button", { name: "Settings", exact: true }).click();
  115 |     await settings.getByRole("button", { name: "Data Health & Audit", exact: true }).click();
  116 | 
  117 |     const lab = settings.getByTestId("import-gold-lab");
  118 |     await expect(lab).toBeVisible({ timeout: 15_000 });
  119 |     await expect(lab.getByText("Import Gold Lab", { exact: true })).toBeVisible();
  120 |     await expect(lab.getByText("local: 66.67% (2/3)", { exact: true })).toBeVisible();
> 121 |     await expect(lab.getByTestId("gold-retention-record-91")).toContainText("Overdue");
      |                                                               ^ Error: expect(locator).toContainText(expected) failed
  122 |     await expect(lab.getByTestId("gold-retention-record-92")).toContainText("Deletion verification needed");
  123 |     await expect(lab.getByText("This register covers application case and score deletion only.", { exact: false })).toBeVisible();
  124 |     await lab.getByTestId("button-verify-gold-case-92").click();
  125 |     await expect(lab.getByTestId("gold-retention-record-92")).toContainText("App deletion verified");
  126 |     await expect(lab.getByTestId("gold-retention-verification-92")).toContainText("manager-fixture");
  127 |     await lab.getByText("Review field differences", { exact: true }).click();
  128 |     await expect(lab.getByText("Expected: 1", { exact: false })).toBeVisible();
  129 | 
  130 |     await expectResponsiveBounds(lab);
  131 |   } finally {
  132 |     await fixtures.cleanup();
  133 |   }
  134 | });
  135 | 
  136 | test("Import Gold cleanup-only manager panel fits, deletes, and refreshes in this browser viewport", async ({
  137 |   page,
  138 |   playwright,
  139 | }, testInfo) => {
  140 |   test.setTimeout(120_000);
  141 |   const fixtures = await AuthorizedBrowserFixtures.create(playwright, API_BASE, SIGNUP_CODE);
  142 |   try {
  143 |     const account = await fixtures.createAccount({
  144 |       username: uniqueTestId("e2e_import_gold_cleanup"),
  145 |       password: PASSWORD,
  146 |       capabilities: DEFAULT_MANAGER_CAPABILITIES,
  147 |       onboardingSeen: true,
  148 |     });
  149 |     let caseDeleted = false;
  150 |     const deletionRequests: string[] = [];
  151 |     await page.route("**/api/import-gold/config", (route) => route.fulfill({
  152 |       status: 200,
  153 |       contentType: "application/json",
  154 |       body: JSON.stringify({
  155 |         enabled: false,
  156 |         cleanupEnabled: true,
  157 |         localConfigured: false,
  158 |         localAvailable: false,
  159 |         localScoringSwitchAvailable: false,
  160 |         localScoringEnabled: false,
  161 |         syntheticFixtureAvailable: false,
  162 |         geminiConfigured: false,
  163 |         retention: "Synthetic cleanup fixture only.",
  164 |         persistsAcrossFactoryPurge: true,
  165 |       }),
  166 |     }));
  167 |     await page.route("**/api/import-gold/cleanup-cases", (route) => route.fulfill({
  168 |       status: 200,
  169 |       contentType: "application/json",
  170 |       body: JSON.stringify({
  171 |         cases: caseDeleted ? [] : [{
  172 |           id: 92,
  173 |           importType: "premix",
  174 |           createdAt: "2026-10-21T12:00:00.000Z",
  175 |         }],
  176 |       }),
  177 |     }));
  178 |     await page.route("**/api/import-gold/cleanup-cases/*", async (route) => {
  179 |       deletionRequests.push(route.request().url());
  180 |       caseDeleted = true;
  181 |       await route.fulfill({ status: 204, body: "" });
  182 |     });
  183 |     await page.context().addCookies([{ name: "rc_auth", value: account.token, url: API_BASE }]);
  184 |     await page.goto("/", { waitUntil: "domcontentloaded" });
  185 |     await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
  186 | 
  187 |     await page.locator('button[title="More"]').click();
  188 |     await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
  189 |     const settings = page.getByRole("dialog", { name: "Manage Lists & Settings" });
  190 |     await expect(settings).toBeVisible();
  191 |     await settings.getByRole("button", { name: "Settings", exact: true }).click();
  192 |     await settings.getByRole("button", { name: "Data Health & Audit", exact: true }).click();
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
```