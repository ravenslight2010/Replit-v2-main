# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: visual-regression.spec.ts >> intentional visual regression baselines >> desktop production states: live run, Mix Plan, import review, and alert dialog
- Location: e2e/visual-regression.spec.ts:248:3

# Error details

```
Error: expect(page).toHaveScreenshot(expected) failed

  71615 pixels (ratio 0.07 of all image pixels) are different.

  Snapshot: live-run-desktop.png

Call log:
  - Expect "toHaveScreenshot(live-run-desktop.png)" with timeout 5000ms
    - verifying given screenshot expectation
  - taking page screenshot
    - disabled all CSS animations
  - waiting for fonts to load...
  - fonts loaded
  - 71615 pixels (ratio 0.07 of all image pixels) are different.
  - waiting 100ms before taking screenshot
  - taking page screenshot
    - disabled all CSS animations
  - waiting for fonts to load...
  - fonts loaded
  - captured a stable screenshot
  - 71615 pixels (ratio 0.07 of all image pixels) are different.

```

# Test source

```ts
  184 |     if (!process.env.DATABASE_URL) return;
  185 |     requireIsolatedTestDatabase("visual regression beforeAll");
  186 |     cleanupDb = new Client({ connectionString: process.env.DATABASE_URL });
  187 |     await cleanupDb.connect();
  188 |     await cleanupDb.query("DELETE FROM daily_sync WHERE date = $1", [
  189 |       new Date().toLocaleDateString("en-CA"),
  190 |     ]);
  191 |     for (const scope of ["live", "sandbox"]) {
  192 |       await cleanupDb.query(
  193 |         `INSERT INTO mixes
  194 |            (id, scope, name, brand, flavor, batch_size, days_early, notes,
  195 |             amount_already_made, components, is_prep, enabled, created_at, updated_at)
  196 |          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, true, NOW(), NOW())
  197 |          ON CONFLICT (id, scope) DO UPDATE SET
  198 |            name = EXCLUDED.name,
  199 |            brand = EXCLUDED.brand,
  200 |            flavor = EXCLUDED.flavor,
  201 |            batch_size = EXCLUDED.batch_size,
  202 |            days_early = EXCLUDED.days_early,
  203 |            notes = EXCLUDED.notes,
  204 |            amount_already_made = EXCLUDED.amount_already_made,
  205 |            components = EXCLUDED.components,
  206 |            is_prep = EXCLUDED.is_prep,
  207 |            enabled = true,
  208 |            updated_at = NOW()`,
  209 |         [
  210 |           visualMixFixture.id,
  211 |           scope,
  212 |           visualMixFixture.name,
  213 |           visualMixFixture.brand,
  214 |           visualMixFixture.flavor,
  215 |           visualMixFixture.batchSize,
  216 |           visualMixFixture.daysEarly,
  217 |           visualMixFixture.notes,
  218 |           visualMixFixture.amountAlreadyMade,
  219 |           JSON.stringify(visualMixFixture.components),
  220 |           visualMixFixture.isPrep,
  221 |         ],
  222 |       );
  223 |     }
  224 |   });
  225 | 
  226 |   test.beforeEach(async () => {
  227 |     requireIsolatedTestDatabase("visual regression beforeEach");
  228 |     await cleanupDb?.query("DELETE FROM daily_sync WHERE date = $1", [
  229 |       new Date().toLocaleDateString("en-CA"),
  230 |     ]);
  231 |   });
  232 | 
  233 |   test.afterAll(async () => {
  234 |     if (!cleanupDb) return;
  235 |     try {
  236 |       await cleanupDb.query("DELETE FROM mixes WHERE id = $1 AND scope IN ('live', 'sandbox')", [
  237 |         visualMixFixture.id,
  238 |       ]);
  239 |       await cleanupDb.query("DELETE FROM users WHERE username = ANY($1::text[])", [
  240 |         [username, phoneUsername, tabletUsername],
  241 |       ]);
  242 |     } finally {
  243 |       await cleanupDb.end().catch(() => {});
  244 |       cleanupDb = undefined;
  245 |     }
  246 |   });
  247 | 
  248 |   test("desktop production states: live run, Mix Plan, import review, and alert dialog", async ({
  249 |     page,
  250 |   }) => {
  251 |     await signUp(page, phoneUsername);
  252 |     const startRun = page.getByRole("button", { name: /start run/i });
  253 |     if (await startRun.isVisible({ timeout: 2_000 }).catch(() => false)) {
  254 |       await startRun.click();
  255 |     }
  256 |     await page.getByRole("button", { name: /pause run/i }).waitFor({
  257 |       state: "visible",
  258 |       timeout: 10_000,
  259 |     });
  260 |     await expect(page.getByTestId("operational-state-badge")).toHaveText(
  261 |       "Confirmed server baseline",
  262 |     );
  263 |     // Foreground reconciliation can display an outcome notice after Start.
  264 |     // Dismiss that transient state rather than recording it in the baseline.
  265 |     const syncOutcome = page.getByTestId("foreground-recovery-status");
  266 |     if (await syncOutcome.isVisible().catch(() => false)) {
  267 |       await expect(syncOutcome).toHaveAttribute("data-foreground-recovery-state", "outcome");
  268 |       const message = await syncOutcome.locator("span").first().innerText();
  269 |       expect([
  270 |         "Production state synchronized.",
  271 |         "Latest production snapshot received. Unsaved edits are not confirmed by this refresh; resolve any section warning before saving again.",
  272 |       ]).toContain(message);
  273 |       await syncOutcome.getByRole("button", { name: "Dismiss", exact: true }).click();
  274 |       await expect(syncOutcome).toBeHidden();
  275 |     }
  276 |     await expect(page.getByTestId("badge-qc-import-review")).toBeVisible({
  277 |       timeout: 15_000,
  278 |     });
  279 |     await expect(page.getByTestId("text-qc-import-badge-pending")).toBeVisible();
  280 |     await expect(page.getByTestId("text-qc-import-badge-rejected")).toBeVisible();
  281 |     await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  282 |     await waitForSavedFlashToSettle(page);
  283 | 
> 284 |     await expect(page).toHaveScreenshot("live-run-desktop.png", {
      |                        ^ Error: expect(page).toHaveScreenshot(expected) failed
  285 |       fullPage: false,
  286 |       mask: dynamicMask(page),
  287 |       maxDiffPixels: 80,
  288 |       threshold: 0.2,
  289 |     });
  290 | 
  291 |     await goToMixPlan(page);
  292 |     // Opening the header menu can leave its trigger focused in some Chromium
  293 |     // runs. Clear that transient focus ring so the Mix Plan baseline captures
  294 |     // the page, not the menu interaction that navigated to it.
  295 |     await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  296 |     await expect(page.getByText(
  297 |       "No mixes to make for this day. Pick a make-day with scheduled runs whose product matches a mix (within its days-early window).",
  298 |       { exact: true },
  299 |     )).toBeVisible();
  300 |     await expect(page).toHaveScreenshot("mix-plan-desktop.png", {
  301 |       fullPage: false,
  302 |       mask: dynamicMask(page),
  303 |       maxDiffPixels: 80,
  304 |       threshold: 0.2,
  305 |     });
  306 | 
  307 |     // Feed a deterministic workbook directly to the same hidden input used by
  308 |     // the Import Excel button. This exercises the real parse and review UI
  309 |     // without depending on a filesystem fixture or shared master-data counts.
  310 |     await page.locator('input[type="file"]').first().setInputFiles({
  311 |       name: "visual-review.xlsx",
  312 |       mimeType:
  313 |         "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  314 |       buffer: importWorkbook(),
  315 |     });
  316 |     await page.getByText("Import Excel", { exact: true }).waitFor({
  317 |       state: "visible",
  318 |       timeout: 10_000,
  319 |     });
  320 |     await expect(page.locator(
  321 |       'select option[value="Visual Regression Existing Brand"]',
  322 |     )).toHaveCount(1);
  323 |     await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  324 |     await expect(page).toHaveScreenshot("import-review-desktop.png", {
  325 |       fullPage: false,
  326 |       mask: dynamicMask(page),
  327 |       maxDiffPixels: 80,
  328 |       threshold: 0.2,
  329 |     });
  330 |     // The review dialog's close control is icon-only; scope the click to the
  331 |     // modal so unrelated page buttons cannot be selected.
  332 |     await page.locator(".responsive-dialog-overlay").filter({ hasText: "Import Excel" })
  333 |       .locator("button").first().click();
  334 | 
  335 |     await page.locator('[data-testid="tab-run"]').click();
  336 |     await expect(page).toHaveScreenshot("compact-run-tablet.png", {
  337 |       fullPage: false,
  338 |       mask: dynamicMask(page),
  339 |       maxDiffPixels: 80,
  340 |       threshold: 0.2,
  341 |     });
  342 |   });
  343 | 
  344 |   test("phone compact presentation and stop dialog", async ({ page }) => {
  345 |     await page.setViewportSize({ width: 390, height: 844 });
  346 |     await signUp(page);
  347 |     await page.locator('[data-testid="tab-run"]').click();
  348 |     const startRun = page.getByRole("button", { name: /start run/i });
  349 |     if (await startRun.isVisible({ timeout: 2_000 }).catch(() => false)) {
  350 |       await startRun.click();
  351 |     }
  352 |     await page.getByRole("button", { name: /pause run/i }).waitFor({
  353 |       state: "visible",
  354 |       timeout: 10_000,
  355 |     });
  356 |     await expect(page.getByTestId("operational-state-badge")).toHaveText(
  357 |       "Confirmed server baseline",
  358 |       { timeout: 15_000 },
  359 |     );
  360 |     await expect(page.getByTestId("operational-state-badge")).toBeVisible();
  361 |     // Running controls can render before the canonical run's start timestamp
  362 |     // reaches the compact timer. Wait for the complete running state so this
  363 |     // screenshot does not capture a transient half-started layout.
  364 |     await expect(page.getByTestId("elapsed-card-value")).toBeVisible({
  365 |       timeout: 10_000,
  366 |     });
  367 |     // Match the desktop/tablet capture boundary: the foreground sync outcome
  368 |     // is transient and shifts the whole phone layout while it is displayed.
  369 |     const syncOutcome = page.getByTestId("foreground-recovery-status");
  370 |     if (await syncOutcome.isVisible().catch(() => false)) {
  371 |       await expect(syncOutcome).toHaveAttribute("data-foreground-recovery-state", "outcome");
  372 |       const message = await syncOutcome.locator("span").first().innerText();
  373 |       expect([
  374 |         "Production state synchronized.",
  375 |         "Latest production snapshot received. Unsaved edits are not confirmed by this refresh; resolve any section warning before saving again.",
  376 |       ]).toContain(message);
  377 |       await syncOutcome.getByRole("button", { name: "Dismiss", exact: true }).click();
  378 |       await expect(syncOutcome).toBeHidden();
  379 |     }
  380 |     await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  381 |     await expect(page).toHaveScreenshot("run-overview-phone.png", {
  382 |       fullPage: false,
  383 |       mask: dynamicMask(page),
  384 |       maxDiffPixels: 80,
```