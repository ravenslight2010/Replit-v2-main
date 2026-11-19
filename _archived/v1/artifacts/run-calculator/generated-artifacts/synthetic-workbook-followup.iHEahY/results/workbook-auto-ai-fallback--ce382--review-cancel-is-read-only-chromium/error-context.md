# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: workbook-auto-ai-fallback.spec.ts >> manager gets three synthetic products in review; cancel is read-only
- Location: e2e/workbook-auto-ai-fallback.spec.ts:751:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('dialog', { name: 'Import Spec Sheet' }).getByText('Local Fixture Bakery — Garden', { exact: true })
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByRole('dialog', { name: 'Import Spec Sheet' }).getByText('Local Fixture Bakery — Garden', { exact: true }) with timeout 5000ms
  - waiting for getByRole('dialog', { name: 'Import Spec Sheet' }).getByText('Local Fixture Bakery — Garden', { exact: true })

```

```yaml
- complementary "App updates":
  - button "App updates · Current"
  - button "Check for updates"
- main:
  - dialog "Manage Lists & Settings":
    - heading "Manage Lists & Settings" [level=2]
    - button "Close settings"
    - button "Recipes"
    - button "Lists"
    - button "Settings"
    - button "Tools"
    - button "Import"
    - button "Setup Profiles"
    - button "Merge"
    - group:
      - paragraph: Import spec sheets & recipes, or a production schedule, from an Excel workbook.
      - group: Optional blank import templates
      - text: Mixed workbook review queue 0/20 files · 0 settled
      - paragraph: Files stay in this browser tab's memory only and are dropped on reload or sign-out. Each file opens its own existing review; nothing is applied automatically, and every Apply needs its own confirmation. There is no Apply all and no shared transaction.
      - text: Workbook type for these files
      - combobox "Workbook type for these files":
        - option "Choose a type…" [selected]
        - option "Spec / recipe workbook"
        - option "Premix"
        - option "Cheese"
        - option "Shipping guide"
        - option "Sauce guide"
        - option "Dough guide"
        - option "Schedule"
      - text: Files (.xlsx .xls .xlsm .xlsb .csv .ods .docx .doc .txt)
      - button "Files (.xlsx .xls .xlsm .xlsb .csv .ods .docx .doc .txt)"
      - button "Add to queue" [disabled]
      - paragraph: The type is never guessed from the filename. Add one group per type, then correct any file's type below before reviewing it.
      - status
      - paragraph: No workbooks queued
      - paragraph: Choose a type, pick one or more files, and add them. Each one is reviewed separately.
      - button "Cancel queued" [disabled]
      - button "Clear group" [disabled]
      - text: Finish or close the open review first.
      - list:
        - listitem: Sauce guides use .docx, .doc or .txt documents. Other types use spreadsheet workbooks; file format and layout checks still belong to each importer.
        - listitem: Shipping, sauce and dough guide Applies write local guide data; schedule Applies write each production day separately. Neither is grouped with other files.
        - listitem: Cancelling or closing a review never rolls back files already applied.
        - listitem: Outcomes, retries and guarded Undo stay in Import review history below.
      - text: Import review history
      - button "Refresh"
      - paragraph: Importer operations
      - paragraph: Each import remains review-first. Partial and failed work can be resumed from a saved review or retried with the original source.
      - paragraph: Pizza spec sheets
      - paragraph: AI-assisted product and recipe setup
      - text: Ready
      - paragraph: "Next: Select a source file and review it before applying changes."
      - button "Start import"
      - paragraph: Premix sheets
      - paragraph: Mix formulas and freezer pulls
      - text: Ready
      - paragraph: "Next: Select a source file and review it before applying changes."
      - button "Start import"
      - paragraph: Cheese mix recipe specs
      - paragraph: Cheese recipes and recipe links
      - text: Ready
      - paragraph: "Next: Select a source file and review it before applying changes."
      - button "Start import"
      - paragraph: Shipping & palletizing guides
      - paragraph: Packaging profile patches
      - text: Ready
      - paragraph: "Next: Select a source file and review it before applying changes."
      - button "Start import"
      - paragraph: Sauce recipe guides
      - paragraph: Sauce assignments for saved profiles
      - text: Ready
      - paragraph: "Next: Select a source file and review it before applying changes."
      - button "Start import"
      - paragraph: Dough recipe guides
      - paragraph: Dough assignments for saved profiles
      - text: Ready
      - paragraph: "Next: Select a source file and review it before applying changes."
      - button "Start import"
      - paragraph: Production schedules
      - paragraph: Reviewed production-day runs
      - text: Ready
      - paragraph: "Next: Select a source file and review it before applying changes."
      - button "Start import"
      - textbox "Filter import history by customer scope":
        - /placeholder: Customer scope
      - combobox "Filter import history by import type":
        - option "All import types" [selected]
        - option "Spec sheets"
        - option "Premix sheets"
        - option "Cheese"
        - option "Sauce"
        - option "Dough"
        - option "Schedule"
        - option "Shipping"
        - option "Recipe"
      - combobox "Filter import history by outcome":
        - option "All outcomes" [selected]
        - option "Complete"
        - option "Partial"
        - option "Failed"
      - paragraph: No workbook imports recorded yet.
      - paragraph: Best import order
      - paragraph: "Import the pizza spec sheet first — it sets the master names for every pizza, ingredient, and weight. Then import the rest, ending with cheese & premix, so their shorthand names get matched back to the spec instead of creating duplicates:"
      - list:
        - listitem: Pizza Spec Sheets — Import Spec Sheet (below), first
        - listitem: Dough recipe sheets — Import Spec Sheet (below)
        - listitem: Sauce recipe sheets — Import Spec Sheet (below)
        - listitem: Pre-Mix Sheets — Manage Lists ▸ Mix Recipes
        - listitem: Cheese Mix Recipe Specs — Manage Lists ▸ Cheese Recipes, last
      - paragraph: If a name still doesn't match (e.g. an extra word or a typo), confirm the match once in the review step — the app remembers it next time.
      - paragraph: Import one customer's spec sheet at a time. Importing several customers' sheets in one go can mix up their look-alike recipe names (e.g. two different "Spinach Cheese Mix" blends) — and a wrong match confirmed once gets remembered for future imports.
      - paragraph: Photograph spec sheets or recipe pages
      - paragraph: Add one or more clear pages. They will be transcribed and shown in the same two-step review before anything is changed.
      - paragraph: Selected photos are sent to the configured AI provider for transcription. Credentials, logs, unrelated production records, and user details are not included.
      - button "Take photo with camera": Take photo
      - button "Upload photo": Upload photos
      - paragraph: Workbooks are checked locally first. If valid spec or recipe content remains unresolved, authorized users automatically send extracted text from the selected workbook—including supporting rows and source context—plus bounded saved-name candidates and confirmed name corrections to the configured AI provider. Users without AI access get unresolved-content guidance. Nothing is applied until you review and confirm. Credentials, logs, and user details are not included.
      - button "Import Spec Sheet"
      - button "Import Shipping & Palletizing Guide"
      - button "Import Sauce Guide"
      - button "Import Dough Recipe Guide"
      - button "Import Excel"
      - paragraph: Download separate, re-importable Excel workbooks. Selecting all five downloads five files.
      - checkbox "Specs" [checked]
      - text: Specs
      - checkbox "Dough" [checked]
      - text: Dough
      - checkbox "Sauce" [checked]
      - text: Sauce
      - checkbox "Cheese" [checked]
      - text: Cheese
      - checkbox "Mixes" [checked]
      - text: Mixes
      - button "Download Workbooks"
  - heading "Production Run Calculator" [level=1]
  - paragraph: Pizza line planning & schedule estimation
  - 'button "Sync status: Synchronized"': Synchronized 1
  - text: Saved
  - button "Cast to other screens"
  - button "Enter fullscreen / kiosk mode"
  - button "Operator"
  - button "More"
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
  - dialog "Import Spec Sheet":
    - heading "Import Spec Sheet" [level=2]
    - button "Close"
    - group "Spec import review":
      - text: Spec import review
      - paragraph: Step 1 of 2 — products. First, confirm each product's brand and flavor, and uncheck any you don't want. You'll review the recipes and details next.
      - text: 0 of 0 spec profiles 0 of 0 recipes Note from the parser
      - paragraph: 1 source row need review; no guesses were applied. This workbook does not match a supported pizza-spec, dough, or sauce recipe layout. Choose its dedicated importer or a supported workbook.
      - status:
        - paragraph: 1 unresolved source section
        - paragraph: This workbook is not a supported pizza-spec, dough, or sauce recipe source. Use its dedicated importer or choose a supported workbook.
      - status: No products or recipes could be prepared. This is an incomplete review, not a successful empty import. Choose the workbook's dedicated importer.
    - button "Cancel"
    - button "Next" [disabled]
- region "Notifications (F8)":
  - list
```

# Test source

```ts
  690 |   };
  691 |   await writeFile(matrixPath, `${JSON.stringify(matrix, null, 2)}\n`);
  692 |   const ledgerPath = path.join(evidenceDir, "failure-ledger.json");
  693 |   const ledger = JSON.parse(await readFile(ledgerPath, "utf8")) as {
  694 |     entries?: Array<Record<string, unknown> & { sha256?: string; status?: string }>;
  695 |     [key: string]: unknown;
  696 |   };
  697 |   ledger.entries = getWorkbookAuditFailureEntries(ledger).map((finding) => {
  698 |     if (finding.status !== "NEEDS_AI" && finding.status !== "PARTIAL_NEEDS_AI") {
  699 |       return finding;
  700 |     }
  701 |     const ai = aiByHash.get(String(finding.sha256));
  702 |     if (!ai) {
  703 |       return {
  704 |         ...finding,
  705 |         status: "AI_AUDIT_NOT_RUN",
  706 |         failureCode: "AI_NOT_RUN",
  707 |         nextAction: "Re-run the authorized real-AI audit for this source hash.",
  708 |       };
  709 |     }
  710 |     const status = String(ai.status);
  711 |     const completeEnough = status === "AI_PARSED_REVIEW_REQUIRED";
  712 |     const failureCodes = Array.isArray(ai.failureCodes)
  713 |       ? ai.failureCodes.filter((code): code is string => typeof code === "string")
  714 |       : [];
  715 |     return {
  716 |       ...finding,
  717 |       status,
  718 |       failureCode: completeEnough ? null : failureCodes[0] ?? status,
  719 |       nextAction: completeEnough
  720 |         ? "Manager review is still required; no workbook values were applied."
  721 |         : status === "AI_PROVIDER_FAILURE"
  722 |           ? `No parse result was available (${failureCodes.join(", ") || "provider failure"}). Do not auto-reparse; the manager may use the bounded Retry action after provider availability is restored.`
  723 |           : status === "AI_EMPTY"
  724 |             ? "The parser returned no usable products or recipes. Correct the source or use the bounded Retry action, then review before applying."
  725 |             : "Inspect source-backed fields in the review and resolve flagged gaps before any apply.",
  726 |     };
  727 |   });
  728 |   await writeFile(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
  729 |   const stagePath = path.join(evidenceDir, "stage-counts.json");
  730 |   const stages = JSON.parse(await readFile(stagePath, "utf8")) as Record<string, unknown>;
  731 |   await writeFile(stagePath, `${JSON.stringify({
  732 |     ...stages,
  733 |     aiParserEndpointRequests: parseRequestCount,
  734 |     aiDistinctInputs: aiEntries.length,
  735 |     aiParserAuditStatus: permissionBlocked ? "BLOCKED_AUTHORIZATION" : "COMPLETED",
  736 |   }, null, 2)}\n`);
  737 | 
  738 |   expect(permissionBlocked).toBe(false);
  739 |   expect(aiEntries).toHaveLength(byHash.size);
  740 |   expect(aiEntries.every((entry) =>
  741 |     entry.status === "AI_PARSED_REVIEW_REQUIRED" ||
  742 |     entry.status === "AI_PARTIAL_REVIEW_REQUIRED" ||
  743 |     entry.status === "AI_OUTPUT_REQUIRES_REVIEW" ||
  744 |     (entry.status === "AI_PROVIDER_FAILURE" &&
  745 |       Array.isArray(entry.failureCodes) && entry.failureCodes.length > 0) ||
  746 |     (entry.status === "AI_EMPTY" &&
  747 |       Array.isArray(entry.failureCodes) && entry.failureCodes.includes("AI_EMPTY_OUTPUT")),
  748 |   )).toBe(true);
  749 | });
  750 | 
  751 | test("manager gets three synthetic products in review; cancel is read-only", async ({
  752 |   page,
  753 |   browserName,
  754 | }) => {
  755 |   await signInManager(page, true);
  756 |   const before = await masterDataCounts(page);
  757 |   let parserRequests = 0;
  758 |   const commitRequests: string[] = [];
  759 |   page.on("request", (request) => {
  760 |     if (
  761 |       ["POST", "PUT", "PATCH", "DELETE"].includes(request.method()) &&
  762 |       /\/api\/(brand-profiles|dough-recipes|sauce-recipes|cheese-recipes|mixes)(?:\/|$)/.test(new URL(request.url()).pathname)
  763 |     ) commitRequests.push(request.method());
  764 |   });
  765 |   await page.route("**/api/ai/parse-spec-sheet", async (route) => {
  766 |     parserRequests++;
  767 |     await route.fulfill({
  768 |       status: 200,
  769 |       contentType: "application/json",
  770 |       body: JSON.stringify(syntheticReviewParse()),
  771 |     });
  772 |   });
  773 |   await openWorkbookImport(page);
  774 |   await page.getByTestId("spec-workbook-input").setInputFiles({
  775 |     name: "synthetic-local-review.xlsx",
  776 |     mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  777 |     buffer: syntheticReviewWorkbook(),
  778 |   });
  779 |   const dialog = page.getByRole("dialog", { name: "Import Spec Sheet" });
  780 |   await expect(dialog.getByText("Step 1 of 2 — products.")).toBeVisible();
  781 |   const viewportChecks = [];
  782 |   for (const viewport of [
  783 |     { width: 1440, height: 900 },
  784 |     { width: 390, height: 844 },
  785 |     { width: 768, height: 1024 },
  786 |     { width: 1024, height: 768 },
  787 |   ]) {
  788 |     await page.setViewportSize(viewport);
  789 |     for (const flavor of SYNTHETIC_REVIEW_FLAVORS) {
> 790 |       await expect(dialog.getByText(`${SYNTHETIC_REVIEW_BRAND} — ${flavor}`, { exact: true })).toBeVisible();
      |                                                                                                ^ Error: expect(locator).toBeVisible() failed
  791 |     }
  792 |     await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
  793 |     const width = await page.evaluate(() => document.documentElement.scrollWidth);
  794 |     expect(width).toBeLessThanOrEqual(viewport.width + 1);
  795 |     viewportChecks.push({ ...viewport, documentWidth: width });
  796 |   }
  797 |   expect(await dialog.locator('li[data-testid^="spec-profile-"]').count()).toBe(3);
  798 |   expect(parserRequests).toBe(1);
  799 |   await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  800 |   await expect(dialog).toBeHidden();
  801 |   const after = await masterDataCounts(page);
  802 |   expect(after).toEqual(before);
  803 |   expect(commitRequests).toEqual([]);
  804 |   await saveBrowserEvidence(`browser-synthetic-review-${browserName}.json`, {
  805 |     engine: browserName,
  806 |     sourceClass: "synthetic-in-memory",
  807 |     aiEvidence: "mocked-provider",
  808 |     reviewReached: true,
  809 |     canceledWithoutApply: true,
  810 |     masterDataUnchanged: true,
  811 |     masterDataWriteRequests: commitRequests.length,
  812 |     parserRequests,
  813 |     viewportChecks,
  814 |     limitations: "No provider quality, real-source accuracy or physical-device evidence.",
  815 |   });
  816 | });
  817 | 
  818 | test("deterministic exported workbook stays model-free", async ({ page, browserName }) => {
  819 |   await signInManager(page, true);
  820 |   const sourceBytes = deterministicExportBytes();
  821 |   let parserRequests = 0;
  822 |   await page.route("**/api/ai/parse-spec-sheet", async (route) => {
  823 |     parserRequests++;
  824 |     await route.abort("blockedbyclient");
  825 |   });
  826 |   await openWorkbookImport(page);
  827 |   await page.getByTestId("spec-workbook-input").setInputFiles({
  828 |     name: "deterministic-export.xlsx",
  829 |     mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  830 |     buffer: sourceBytes,
  831 |   });
  832 |   const dialog = page.getByRole("dialog", { name: "Import Spec Sheet" });
  833 |   await expect(dialog.getByText("Step 1 of 2 — products.")).toBeVisible();
  834 |   await expect(dialog.getByText("Audit Fixture Bakery — Classic", { exact: true })).toBeVisible();
  835 |   expect(parserRequests).toBe(0);
  836 |   await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  837 |   await saveBrowserEvidence(`browser-deterministic-export-${browserName}.json`, {
  838 |     engine: browserName,
  839 |     sourceClass: "synthetic-in-memory",
  840 |     modelRequests: parserRequests,
  841 |     completeDeterministicReviewReached: true,
  842 |     canceledBeforeApply: true,
  843 |     sourceSha256: createHash("sha256").update(sourceBytes).digest("hex"),
  844 |   });
  845 | });
  846 | 
  847 | test("profile importer without AI permission sees guidance and sends no parse request", async ({
  848 |   page,
  849 |   browserName,
  850 | }) => {
  851 |   await signInManager(page, false);
  852 |   let parserRequests = 0;
  853 |   await page.route("**/api/ai/parse-spec-sheet", async (route) => {
  854 |     parserRequests++;
  855 |     await route.abort("blockedbyclient");
  856 |   });
  857 |   await openWorkbookImport(page);
  858 |   await page.getByTestId("spec-workbook-input").setInputFiles({
  859 |     name: "synthetic-no-permission.xlsx",
  860 |     mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  861 |     buffer: syntheticReviewWorkbook(),
  862 |   });
  863 |   const dialog = page.getByRole("dialog", { name: "Import Spec Sheet" });
  864 |   await expect(dialog.getByTestId("spec-import-unresolved")).toContainText(
  865 |     "AI interpretation is unavailable for your account",
  866 |   );
  867 |   expect(parserRequests).toBe(0);
  868 |   await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  869 |   await saveBrowserEvidence(`browser-no-ai-permission-${browserName}.json`, {
  870 |     engine: browserName,
  871 |     sourceClass: "synthetic-in-memory",
  872 |     parserRequests,
  873 |     unresolvedGuidanceShown: true,
  874 |     canceledBeforeApply: true,
  875 |   });
  876 | });
  877 | 
  878 | test("provider failure preserves an incomplete review and one retry can recover", async ({
  879 |   page,
  880 |   browserName,
  881 | }) => {
  882 |   await signInManager(page, true);
  883 |   const before = await masterDataCounts(page);
  884 |   let parserRequests = 0;
  885 |   const mockStatusSequence: number[] = [];
  886 |   const commitRequests: string[] = [];
  887 |   page.on("request", (request) => {
  888 |     const url = new URL(request.url());
  889 |     if (
  890 |       ["POST", "PUT", "PATCH", "DELETE"].includes(request.method()) &&
```