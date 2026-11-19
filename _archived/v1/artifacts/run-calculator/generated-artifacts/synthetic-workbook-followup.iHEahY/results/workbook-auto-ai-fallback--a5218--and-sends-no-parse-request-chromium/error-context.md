# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: workbook-auto-ai-fallback.spec.ts >> profile importer without AI permission sees guidance and sends no parse request
- Location: e2e/workbook-auto-ai-fallback.spec.ts:847:1

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: getByRole('dialog', { name: 'Import Spec Sheet' }).getByTestId('spec-import-unresolved')
Expected substring: "AI interpretation is unavailable for your account"
Received string:    "1 unresolved source sectionThis workbook is not a supported pizza-spec, dough, or sauce recipe source. Use its dedicated importer or choose a supported workbook."
Timeout: 5000ms

Call log:
  - Expect "toContainText" getByRole('dialog', { name: 'Import Spec Sheet' }).getByTestId('spec-import-unresolved') with timeout 5000ms
  - waiting for getByRole('dialog', { name: 'Import Spec Sheet' }).getByTestId('spec-import-unresolved')
    12 × locator resolved to <div role="status" data-testid="spec-import-unresolved" class="rounded-md border border-amber-400/60 bg-amber-500/10 p-3">…</div>
       - unexpected value "1 unresolved source sectionThis workbook is not a supported pizza-spec, dough, or sauce recipe source. Use its dedicated importer or choose a supported workbook."

```

```yaml
- status:
  - paragraph: 1 unresolved source section
  - paragraph: This workbook is not a supported pizza-spec, dough, or sauce recipe source. Use its dedicated importer or choose a supported workbook.
```

# Test source

```ts
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
  790 |       await expect(dialog.getByText(`${SYNTHETIC_REVIEW_BRAND} — ${flavor}`, { exact: true })).toBeVisible();
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
> 864 |   await expect(dialog.getByTestId("spec-import-unresolved")).toContainText(
      |                                                              ^ Error: expect(locator).toContainText(expected) failed
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
  891 |       /\/api\/(brand-profiles|dough-recipes|sauce-recipes|cheese-recipes|mixes)(?:\/|$)/.test(url.pathname)
  892 |     ) {
  893 |       commitRequests.push(`${request.method()} ${url.pathname}`);
  894 |     }
  895 |   });
  896 |   await page.route("**/api/ai/parse-spec-sheet", async (route) => {
  897 |     parserRequests++;
  898 |     if (parserRequests === 1) {
  899 |       mockStatusSequence.push(503);
  900 |       await route.fulfill({
  901 |         status: 503,
  902 |         contentType: "application/json",
  903 |         body: JSON.stringify({ error: "Provider unavailable for this request." }),
  904 |       });
  905 |       return;
  906 |     }
  907 |     mockStatusSequence.push(200);
  908 |     await route.fulfill({
  909 |       status: 200,
  910 |       contentType: "application/json",
  911 |       body: JSON.stringify(syntheticReviewParse()),
  912 |     });
  913 |   });
  914 |   await openWorkbookImport(page);
  915 |   await page.getByTestId("spec-workbook-input").setInputFiles({
  916 |     name: "synthetic-retry-review.xlsx",
  917 |     mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  918 |     buffer: syntheticReviewWorkbook(),
  919 |   });
  920 |   const dialog = page.getByRole("dialog", { name: "Import Spec Sheet" });
  921 |   await expect(dialog.getByTestId("spec-import-unresolved")).toBeVisible({
  922 |     timeout: 8 * 60_000,
  923 |   });
  924 |   await expect(dialog.getByTestId("spec-import-unresolved")).toContainText(
  925 |     "Automatic AI interpretation did not resolve all content",
  926 |   );
  927 |   await dialog.getByRole("button", { name: "Retry AI interpretation", exact: true }).click();
  928 |   for (const flavor of SYNTHETIC_REVIEW_FLAVORS) {
  929 |     await expect(dialog.getByText(`${SYNTHETIC_REVIEW_BRAND} — ${flavor}`, { exact: true })).toBeVisible({
  930 |       timeout: 8 * 60_000,
  931 |     });
  932 |   }
  933 |   const citedCells = dialog.getByText("View cited cells").first();
  934 |   await expect(citedCells).toBeVisible();
  935 |   await citedCells.click();
  936 |   await expect(
  937 |     dialog.getByRole("button", { name: /Open .*OZ![A-Z]+\d+/ }).first(),
  938 |   ).toBeVisible();
  939 |   expect(parserRequests).toBe(2);
  940 |   const viewportChecks: Array<Record<string, unknown>> = [];
  941 |   for (const viewport of [
  942 |     { width: 1440, height: 900 },
  943 |     { width: 390, height: 844 },
  944 |     { width: 768, height: 1024 },
  945 |     { width: 1024, height: 768 },
  946 |   ]) {
  947 |     await page.setViewportSize(viewport);
  948 |     await expect(dialog).toBeVisible();
  949 |     await expect(dialog.getByText(`${SYNTHETIC_REVIEW_BRAND} — ${SYNTHETIC_REVIEW_FLAVORS[0]}`, { exact: true }))
  950 |       .toBeVisible();
  951 |     const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  952 |     expect(documentWidth).toBeLessThanOrEqual(viewport.width);
  953 |     viewportChecks.push({ ...viewport, documentWidth, status: "PASS" });
  954 |   }
  955 |   await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  956 |   const after = await masterDataCounts(page);
  957 |   expect(after.snapshot).toEqual(before.snapshot);
  958 |   expect(commitRequests).toEqual([]);
  959 |   await saveBrowserEvidence(`browser-provider-retry-${browserName}.json`, {
  960 |     engine: browserName,
  961 |     sourceClass: "synthetic-in-memory",
  962 |     aiEvidence: "mocked-provider",
  963 |     mockedStatusSequence: mockStatusSequence,
  964 |     incompleteReviewShownAfterProviderFailure: true,
```