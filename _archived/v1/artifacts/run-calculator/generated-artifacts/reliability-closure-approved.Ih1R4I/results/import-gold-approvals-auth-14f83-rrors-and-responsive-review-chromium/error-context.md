# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: import-gold-approvals-authenticated.spec.ts >> Gold Lab approval metadata lifecycle, authorization, errors, and responsive review
- Location: e2e/import-gold-approvals-authenticated.spec.ts:16:1

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: getByRole('dialog', { name: 'Manage Lists & Settings' }).getByTestId('import-gold-approvals').getByTestId('gold-approvals-load-error')
Expected substring: "Try again"
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toContainText" getByRole('dialog', { name: 'Manage Lists & Settings' }).getByTestId('import-gold-approvals').getByTestId('gold-approvals-load-error') with timeout 5000ms
  - waiting for getByRole('dialog', { name: 'Manage Lists & Settings' }).getByTestId('import-gold-approvals').getByTestId('gold-approvals-load-error')

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
    - button "Gold Lab Approvals"
    - button "Change PIN"
    - button "Manage Runs"
    - group:
      - region "Gold Lab approvals":
        - heading "Gold Lab approvals" [level=2]
        - paragraph: Metadata-only register. Enter opaque reference IDs only, never approval documents, customer workbooks, names, emails, URLs or source locations. Private evidence is reviewed outside this app.
        - list:
          - listitem: Review the referenced owner approval, privacy review and conditions privately, outside this app.
          - listitem: Delete cases, scores and evaluation working copies manually within 30 days, or earlier if the owner asks. Backups are handled separately under the documented backup reference.
          - listitem: This metadata does not replace the evidence, does not grant Gemini or export permission, and does not enable capture.
        - paragraph: 0 verified approvals expire within the next 7 days
        - paragraph: "Counted across this whole scope (not just the rows shown or the current lookup), as of 11/1/2026, 7:36:29 AM. No reminder is sent. Expiry cannot be extended: once an approval passes Valid until, record new metadata and have it verified separately."
        - text: Find by record reference
        - paragraph: Exact match, checked by the server across this scope, not only loaded rows.
        - textbox "Find by record reference"
        - button "Find"
        - button "Record new approval metadata"
        - button "Refresh"
        - text: No approvals recorded in this scope yet. Record metadata once the owner and privacy review are complete.
      - region "Shared master-data history":
        - heading "Shared change history" [level=3]
        - button "Refresh history"
        - paragraph: Manager-only, server-recorded changes for this scope. Undo checks the current records and pending-run references before restoring anything. Import and Data Health repairs keep their own guarded Undo actions.
        - button "Import history"
        - button "Data Health"
        - list:
          - listitem:
            - paragraph: "add brand: guarded_undo_mvxiia4z_syked8yf_chromium_page_24_mvxij5u2_955pudc9"
            - paragraph: 11/1/2026, 7:32:55 AM · Actor 409359f5-1243-49b5-bb55-948d30c5f603
            - paragraph: 2 records · 0 pending-run references · applied
            - button "Undo"
          - listitem:
            - paragraph: "add brand: guarded_undo_mvxiia4z_syked8yf_chromium_page_23_mvxij5u2_b95l8wgd"
            - paragraph: 11/1/2026, 7:32:54 AM · Actor 409359f5-1243-49b5-bb55-948d30c5f603
            - paragraph: 2 records · 0 pending-run references · applied
            - button "Undo"
          - listitem:
            - paragraph: "add brand: guarded_undo_mvxiia4z_syked8yf_chromium_page_22_mvxij5u2_km5b65b7"
            - paragraph: 11/1/2026, 7:32:54 AM · Actor 409359f5-1243-49b5-bb55-948d30c5f603
            - paragraph: 2 records · 0 pending-run references · applied
            - button "Undo"
          - listitem:
            - paragraph: "add brand: guarded_undo_mvxiia4z_syked8yf_chromium_page_21_mvxij5u2_uuri9dmp"
            - paragraph: 11/1/2026, 7:32:54 AM · Actor 409359f5-1243-49b5-bb55-948d30c5f603
            - paragraph: 2 records · 0 pending-run references · applied
            - button "Undo"
          - listitem:
            - paragraph: "add brand: guarded_undo_mvxiia4z_syked8yf_chromium_page_20_mvxij5u2_jhpntws8"
            - paragraph: 11/1/2026, 7:32:54 AM · Actor 409359f5-1243-49b5-bb55-948d30c5f603
            - paragraph: 2 records · 0 pending-run references · applied
            - button "Undo"
          - listitem:
            - paragraph: "add brand: guarded_undo_mvxiia4z_syked8yf_chromium_page_19_mvxij5u2_g0axd2ux"
            - paragraph: 11/1/2026, 7:32:54 AM · Actor 409359f5-1243-49b5-bb55-948d30c5f603
            - paragraph: 2 records · 0 pending-run references · applied
            - button "Undo"
          - listitem:
            - paragraph: "add brand: guarded_undo_mvxiia4z_syked8yf_chromium_page_18_mvxij5u2_fdhbmz65"
            - paragraph: 11/1/2026, 7:32:54 AM · Actor 409359f5-1243-49b5-bb55-948d30c5f603
            - paragraph: 2 records · 0 pending-run references · applied
            - button "Undo"
          - listitem:
            - paragraph: "add brand: guarded_undo_mvxiia4z_syked8yf_chromium_page_17_mvxij5u2_t1l9f7ps"
            - paragraph: 11/1/2026, 7:32:54 AM · Actor 409359f5-1243-49b5-bb55-948d30c5f603
            - paragraph: 2 records · 0 pending-run references · applied
            - button "Undo"
          - listitem:
            - paragraph: "add brand: guarded_undo_mvxiia4z_syked8yf_chromium_page_16_mvxij5u2_d39ck5fe"
            - paragraph: 11/1/2026, 7:32:54 AM · Actor 409359f5-1243-49b5-bb55-948d30c5f603
            - paragraph: 2 records · 0 pending-run references · applied
            - button "Undo"
          - listitem:
            - paragraph: "add brand: guarded_undo_mvxiia4z_syked8yf_chromium_page_15_mvxij5u2_ubgqgi4w"
            - paragraph: 11/1/2026, 7:32:54 AM · Actor 409359f5-1243-49b5-bb55-948d30c5f603
            - paragraph: 2 records · 0 pending-run references · applied
            - button "Undo"
          - listitem:
            - paragraph: "add brand: guarded_undo_mvxiia4z_syked8yf_chromium_page_14_mvxij5u2_kbby6vep"
            - paragraph: 11/1/2026, 7:32:54 AM · Actor 409359f5-1243-49b5-bb55-948d30c5f603
            - paragraph: 2 records · 0 pending-run references · applied
            - button "Undo"
          - listitem:
            - paragraph: "add brand: guarded_undo_mvxiia4z_syked8yf_chromium_page_13_mvxij5u2_ljnspyem"
            - paragraph: 11/1/2026, 7:32:54 AM · Actor 409359f5-1243-49b5-bb55-948d30c5f603
            - paragraph: 2 records · 0 pending-run references · applied
            - button "Undo"
          - listitem:
            - paragraph: "add brand: guarded_undo_mvxiia4z_syked8yf_chromium_page_12_mvxij5u2_vi5ak0gy"
            - paragraph: 11/1/2026, 7:32:54 AM · Actor 409359f5-1243-49b5-bb55-948d30c5f603
            - paragraph: 2 records · 0 pending-run references · applied
            - button "Undo"
          - listitem:
            - paragraph: "add brand: guarded_undo_mvxiia4z_syked8yf_chromium_page_11_mvxij5u2_wy2bhy9w"
            - paragraph: 11/1/2026, 7:32:54 AM · Actor 409359f5-1243-49b5-bb55-948d30c5f603
            - paragraph: 2 records · 0 pending-run references · applied
            - button "Undo"
          - listitem:
            - paragraph: "add brand: guarded_undo_mvxiia4z_syked8yf_chromium_page_10_mvxij5u2_qqyjuso6"
            - paragraph: 11/1/2026, 7:32:54 AM · Actor 409359f5-1243-49b5-bb55-948d30c5f603
            - paragraph: 2 records · 0 pending-run references · applied
            - button "Undo"
          - listitem:
            - paragraph: "add brand: guarded_undo_mvxiia4z_syked8yf_chromium_page_9_mvxij5u2_odttfmut"
            - paragraph: 11/1/2026, 7:32:54 AM · Actor 409359f5-1243-49b5-bb55-948d30c5f603
            - paragraph: 2 records · 0 pending-run references · applied
            - button "Undo"
          - listitem:
            - paragraph: "add brand: guarded_undo_mvxiia4z_syked8yf_chromium_page_8_mvxij5u2_afn424k6"
            - paragraph: 11/1/2026, 7:32:53 AM · Actor 409359f5-1243-49b5-bb55-948d30c5f603
            - paragraph: 2 records · 0 pending-run references · applied
            - button "Undo"
          - listitem:
            - paragraph: "add brand: guarded_undo_mvxiia4z_syked8yf_chromium_page_7_mvxij5u2_l9j5zfdu"
            - paragraph: 11/1/2026, 7:32:53 AM · Actor 409359f5-1243-49b5-bb55-948d30c5f603
            - paragraph: 2 records · 0 pending-run references · applied
            - button "Undo"
          - listitem:
            - paragraph: "add brand: guarded_undo_mvxiia4z_syked8yf_chromium_page_6_mvxij5u2_08yyzn59"
            - paragraph: 11/1/2026, 7:32:53 AM · Actor 409359f5-1243-49b5-bb55-948d30c5f603
            - paragraph: 2 records · 0 pending-run references · applied
            - button "Undo"
          - listitem:
            - paragraph: "add brand: guarded_undo_mvxiia4z_syked8yf_chromium_page_5_mvxij5u2_hp9rs2b3"
            - paragraph: 11/1/2026, 7:32:53 AM · Actor 409359f5-1243-49b5-bb55-948d30c5f603
            - paragraph: 2 records · 0 pending-run references · applied
            - button "Undo"
        - button "Load older changes"
      - heading "Device-only change notices" [level=3]
      - paragraph: These notices are not server-confirmed Undo receipts. Legacy evidence is non-portable and retained on this device, but cannot restore shared records. Use Import history or Data Health for their supported guarded Undo actions.
      - paragraph: No recent changes.
  - heading "Production Run Calculator" [level=1]
  - paragraph: Pizza line planning & schedule estimation
  - 'button "Sync status: Synchronized"': Synchronized
  - text: Saved
  - button "Cast to other screens"
  - button "Enter fullscreen / kiosk mode"
  - button "Supervisor"
  - button "More — 244 manager actions need attention": "244"
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
  1   | import { Client } from "pg";
  2   | import { expect, test, type Locator, type Page } from "@playwright/test";
  3   | import {
  4   |   AuthorizedBrowserFixtures,
  5   |   DEFAULT_MANAGER_CAPABILITIES,
  6   |   requireIsolatedTestDatabase,
  7   |   uniqueTestId,
  8   | } from "./isolation";
  9   | import { requireLocalFixtureApiOrigin } from "./isolatedApiOrigin";
  10  | 
  11  | const API_BASE = requireLocalFixtureApiOrigin("Gold Lab approvals browser journey");
  12  | const PASSWORD = "GoldApprovalSynthetic123!";
  13  | const SIGNUP_CODE = process.env.STAFF_SIGNUP_CODE ?? "";
  14  | const DIGEST = "a".repeat(64);
  15  | 
  16  | test("Gold Lab approval metadata lifecycle, authorization, errors, and responsive review", async ({
  17  |   page,
  18  |   playwright,
  19  | }, testInfo) => {
  20  |   test.setTimeout(210_000);
  21  |   const fixtures = await AuthorizedBrowserFixtures.create(playwright, API_BASE, SIGNUP_CODE);
  22  |   const ownedRecordRefs: string[] = [];
  23  |   try {
  24  |     const manager = await fixtures.createAccount({
  25  |       username: uniqueTestId("gold_approval_manager"),
  26  |       password: PASSWORD,
  27  |       capabilities: DEFAULT_MANAGER_CAPABILITIES,
  28  |       onboardingSeen: true,
  29  |     });
  30  |     await fixtures.assignManagerRole(manager);
  31  |     const qcManager = await fixtures.createAccount({
  32  |       username: uniqueTestId("gold_approval_qc"),
  33  |       password: PASSWORD,
  34  |       capabilities: ["manage-qc"],
  35  |       onboardingSeen: true,
  36  |     });
  37  |     await fixtures.assignQcManagerRole(qcManager);
  38  |     const staffWithCapability = await fixtures.createAccount({
  39  |       username: uniqueTestId("gold_approval_staff"),
  40  |       password: PASSWORD,
  41  |       capabilities: ["manage-qc"],
  42  |       onboardingSeen: true,
  43  |     });
  44  | 
  45  |     let failFirstList = true;
  46  |     await page.route("**/api/import-gold/approvals*", async (route) => {
  47  |       if (route.request().method() === "GET" && failFirstList) {
  48  |         failFirstList = false;
  49  |         await route.fulfill({
  50  |           status: 503,
  51  |           contentType: "application/json",
  52  |           body: JSON.stringify({ error: "Synthetic temporary list failure" }),
  53  |         });
  54  |       } else {
  55  |         await route.continue();
  56  |       }
  57  |     });
  58  | 
  59  |     await openAs(page, manager.token);
  60  |     const settings = await openManageSettings(page);
  61  |     await expect(settings.getByRole("button", { name: "Gold Lab Approvals", exact: true })).toBeVisible();
  62  |     await settings.getByRole("button", { name: "Gold Lab Approvals", exact: true }).click();
  63  |     const card = settings.getByTestId("import-gold-approvals");
  64  |     await expect(card).toBeVisible();
> 65  |     await expect(card.getByTestId("gold-approvals-load-error")).toContainText("Try again");
      |                                                                 ^ Error: expect(locator).toContainText(expected) failed
  66  |     await card.getByTestId("button-retry-gold-approvals").click();
  67  |     await expect(card.getByTestId("gold-approvals-empty")).toBeVisible();
  68  |     await page.unroute("**/api/import-gold/approvals*");
  69  |     await expectResponsiveBounds(card);
  70  | 
  71  |     await card.getByTestId("button-toggle-gold-approval-form").click();
  72  |     const form = card.getByTestId("gold-approval-form");
  73  |     await expect(form).toBeVisible();
  74  |     const mutationRequests: string[] = [];
  75  |     page.on("request", (request) => {
  76  |       const pathname = new URL(request.url()).pathname;
  77  |       if (request.method() !== "GET" && pathname.startsWith("/api/")) {
  78  |         mutationRequests.push(`${request.method()} ${pathname}`);
  79  |       }
  80  |     });
  81  | 
  82  |     await form.getByTestId("input-gold-recordRef").fill("https://synthetic.invalid/private");
  83  |     await form.getByTestId("input-gold-sourceDigest").fill("ABC");
  84  |     await form.getByTestId("input-gold-recordRef").press("Enter");
  85  |     expect(mutationRequests).toEqual([]);
  86  |     await form.getByTestId("button-review-gold-approval").click();
  87  |     await expect(form.getByText(/Record reference must be an opaque ID/)).toBeVisible();
  88  |     await expect(form.getByText(/exactly 64 lowercase hex characters/)).toBeVisible();
  89  |     expect(mutationRequests).toEqual([]);
  90  | 
  91  |     const past = new Date(Date.now() - 60 * 60_000).toISOString().slice(0, 16);
  92  |     const future = new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString().slice(0, 16);
  93  |     const refs = {
  94  |       recordRef: uniqueTestId("synthetic-record"),
  95  |       ownerRef: uniqueTestId("synthetic-owner"),
  96  |       privacyReviewerRef: uniqueTestId("synthetic-reviewer"),
  97  |       conditionsRef: uniqueTestId("synthetic-conditions"),
  98  |       externalCopiesRef: uniqueTestId("synthetic-copies"),
  99  |       backupHandlingRef: uniqueTestId("synthetic-backup"),
  100 |     };
  101 |     ownedRecordRefs.push(refs.recordRef);
  102 |     for (const [key, value] of Object.entries(refs)) {
  103 |       await form.getByTestId(`input-gold-${key}`).fill(value);
  104 |     }
  105 |     await form.getByTestId("input-gold-sourceDigest").fill(DIGEST);
  106 |     await form.getByTestId("select-gold-importType").selectOption("spec");
  107 |     await form.getByTestId("select-gold-privacyStatus").selectOption("approved");
  108 |     await form.getByTestId("input-gold-ownerApprovedAt").fill(past);
  109 |     await form.getByTestId("input-gold-privacyReviewedAt").fill(past);
  110 |     await form.getByTestId("input-gold-validUntil").fill(future);
  111 |     await form.getByTestId("checkbox-gold-manualDeletionAccepted").check();
  112 |     await form.getByTestId("checkbox-gold-conditionsSatisfied").check();
  113 |     await form.getByTestId("button-review-gold-approval").click();
  114 |     const review = form.getByTestId("gold-approval-review");
  115 |     await expect(review).toBeVisible();
  116 |     for (const value of [...Object.values(refs), DIGEST, "local_spec_import_accuracy"]) {
  117 |       await expect(review).toContainText(value);
  118 |     }
  119 |     await expect(review).toContainText("30 days");
  120 |     await expect(review).toContainText("Retention");
  121 |     await expectResponsiveBounds(card);
  122 |     await card.screenshot({ path: testInfo.outputPath("approval-review-synthetic-metadata.png") });
  123 | 
  124 |     await form.getByTestId("button-submit-gold-approval").click();
  125 |     await expect(card.getByTestId("gold-approvals-notice")).toContainText("recorded as pending");
  126 |     const pending = card.locator('[data-testid^="gold-approval-"]').filter({ hasText: refs.recordRef });
  127 |     await expect(pending).toHaveCount(1);
  128 |     const pendingId = await pending.getAttribute("data-testid");
  129 |     expect(pendingId).toMatch(/^gold-approval-\d+$/);
  130 |     const id = pendingId!.replace("gold-approval-", "");
  131 |     await pending.getByTestId(`button-toggle-gold-approval-${id}`).click();
  132 |     await expect(pending.getByTestId(`gold-approval-status-${id}`)).toHaveText("Pending verification");
  133 |     await expectAllMetadata(pending, refs, DIGEST);
  134 |     const verifyButton = pending.getByTestId(`button-verify-gold-approval-${id}`);
  135 |     await expect(verifyButton).toBeDisabled();
  136 |     await page.reload({ waitUntil: "domcontentloaded" });
  137 |     const reloadedSettings = await openManageSettings(page);
  138 |     await reloadedSettings.getByRole("button", { name: "Gold Lab Approvals", exact: true }).click();
  139 |     const persistedPending = reloadedSettings.getByTestId("import-gold-approvals")
  140 |       .getByTestId(`gold-approval-${id}`);
  141 |     await expect(persistedPending).toBeVisible();
  142 |     await persistedPending.getByTestId(`button-toggle-gold-approval-${id}`).click();
  143 |     await expectAllMetadata(persistedPending, refs, DIGEST);
  144 |     await persistedPending.getByTestId(`checkbox-gold-attest-${id}`).check();
  145 |     await expect(persistedPending.getByTestId(`button-verify-gold-approval-${id}`)).toBeEnabled();
  146 |     await persistedPending.getByTestId(`button-verify-gold-approval-${id}`).click();
  147 |     await expect(persistedPending.getByTestId(`gold-approval-status-${id}`)).toHaveText("Verified");
  148 |     await expect(persistedPending).toContainText("Verified by");
  149 | 
  150 |     await page.reload({ waitUntil: "domcontentloaded" });
  151 |     const verifiedSettings = await openManageSettings(page);
  152 |     await verifiedSettings.getByRole("button", { name: "Gold Lab Approvals", exact: true }).click();
  153 |     const verified = verifiedSettings.getByTestId("import-gold-approvals").getByTestId(`gold-approval-${id}`);
  154 |     await expect(verified.getByTestId(`gold-approval-status-${id}`)).toHaveText("Verified");
  155 |     await verified.getByTestId(`button-toggle-gold-approval-${id}`).click();
  156 |     await expectAllMetadata(verified, refs, DIGEST);
  157 |     await expect(verified.getByTestId(`checkbox-gold-attest-${id}`)).toHaveCount(0);
  158 |     await verified.getByTestId(`button-revoke-gold-approval-${id}`).click();
  159 |     const confirm = verified.getByRole("alertdialog", { name: `Confirm revoking approval ${id}` });
  160 |     await expect(confirm).toContainText("Revocation is permanent");
  161 |     await confirm.getByTestId(`button-cancel-revoke-gold-approval-${id}`).click();
  162 |     await expect(confirm).toHaveCount(0);
  163 |     await verified.getByTestId(`button-revoke-gold-approval-${id}`).click();
  164 |     await verified.getByRole("alertdialog").getByTestId(`button-confirm-revoke-gold-approval-${id}`).click();
  165 |     await expect(verified.getByTestId(`gold-approval-status-${id}`)).toHaveText("Revoked");
```