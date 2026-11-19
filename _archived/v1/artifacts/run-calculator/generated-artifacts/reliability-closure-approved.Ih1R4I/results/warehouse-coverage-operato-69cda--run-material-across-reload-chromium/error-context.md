# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: warehouse-coverage.spec.ts >> operator staging check persists for a canonical per-run material across reload
- Location: e2e/warehouse-coverage.spec.ts:411:1

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: "true"
Received: null

Call Log:
- Timeout 20000ms exceeded while waiting on the predicate
```

# Test source

```ts
  396 |     }
  397 |   }
  398 | });
  399 | 
  400 | test.afterEach(async () => {
  401 |   if (!process.env.DATABASE_URL) return;
  402 |   const db = new Client({ connectionString: process.env.DATABASE_URL });
  403 |   try {
  404 |     await db.connect();
  405 |     await cleanupInventory(db);
  406 |   } finally {
  407 |     await db.end().catch(() => {});
  408 |   }
  409 | });
  410 | 
  411 | test("operator staging check persists for a canonical per-run material across reload", async ({
  412 |   page,
  413 | }, testInfo) => {
  414 |   const runId = uniqueTestId("warehouse_staging_run");
  415 |   const brand = `Warehouse E2E ${uniqueTestId("brand")}`;
  416 |   const material = `Warehouse E2E Topping ${uniqueTestId("material")}`;
  417 |   const date = await page.evaluate(() => {
  418 |     const now = new Date();
  419 |     return [
  420 |       now.getFullYear(),
  421 |       String(now.getMonth() + 1).padStart(2, "0"),
  422 |       String(now.getDate()).padStart(2, "0"),
  423 |     ].join("-");
  424 |   });
  425 |   const seededAt = Date.now();
  426 |   const payload = {
  427 |     dayState: {
  428 |       date,
  429 |       runs: [{
  430 |         id: runId,
  431 |         brand,
  432 |         flavor: "Staging",
  433 |         startedAt: seededAt,
  434 |         metaUpdatedAt: seededAt,
  435 |       }],
  436 |       currentIndex: 0,
  437 |       currentRunId: runId,
  438 |       resetAt: 0,
  439 |       substitutions: [],
  440 |       substitutionLog: [],
  441 |       stagedItems: {},
  442 |     },
  443 |     runValues: {
  444 |       [runId]: {
  445 |         casesNeeded: 1,
  446 |         pizzasPerCase: 10,
  447 |         app1Type: material,
  448 |         app1OzPerPizza: 1,
  449 |       },
  450 |     },
  451 |     runValuesUpdatedAt: { [runId]: seededAt },
  452 |   };
  453 |   await authorizedFixtures.seedCanonicalTodaySnapshot({
  454 |     token: managerToken,
  455 |     senderId: uniqueTestId("warehouse-staging-seed"),
  456 |     date,
  457 |     payload,
  458 |   });
  459 | 
  460 |   const browserErrors: string[] = [];
  461 |   page.on("pageerror", (error) => browserErrors.push(error.message));
  462 |   page.on("response", (response) => {
  463 |     if (response.status() >= 500) {
  464 |       browserErrors.push(`${response.status()} ${response.request().method()} ${response.url()}`);
  465 |     }
  466 |   });
  467 |   await page.setViewportSize({ width: 1440, height: 900 });
  468 |   await openAuthenticated(page, staffToken);
  469 |   await expect(page.getByTestId("tab-warehouse")).toBeVisible();
  470 |   await page.getByTestId("tab-warehouse").click();
  471 | 
  472 |   const details = page.getByTestId("warehouse-run-details");
  473 |   await expect(details).toBeVisible();
  474 |   await details.locator("summary").click();
  475 |   const stageButton = page.getByTestId(`stage-${runId}-${material}__lbs`);
  476 |   await expect(stageButton).toBeVisible();
  477 |   await expect(stageButton).toHaveAttribute("aria-pressed", "false");
  478 |   await stageButton.click();
  479 |   await expect(stageButton).toHaveAttribute("aria-pressed", "true");
  480 |   await attachVisualEvidence(page, testInfo, "operator-warehouse-staging-before-reload");
  481 | 
  482 |   const readSavedStage = async (): Promise<string | null> => {
  483 |     const db = new Client({ connectionString: process.env.DATABASE_URL });
  484 |     try {
  485 |       await db.connect();
  486 |       const result = await db.query<{ staged: string | null }>(
  487 |         `SELECT data->'dayState'->'stagedItems'->>$1 AS staged
  488 |          FROM daily_sync WHERE date = $2 AND scope = 'live'`,
  489 |         [`${runId}::${material}__lbs`, date],
  490 |       );
  491 |       return result.rows[0]?.staged ?? null;
  492 |     } finally {
  493 |       await db.end().catch(() => {});
  494 |     }
  495 |   };
> 496 |   await expect.poll(readSavedStage, { timeout: 20_000 }).toBe("true");
      |                                                          ^ Error: expect(received).toBe(expected) // Object.is equality
  497 | 
  498 |   await page.reload({ waitUntil: "domcontentloaded" });
  499 |   await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
  500 |   await page.getByTestId("tab-warehouse").click();
  501 |   await expect(details).toBeVisible();
  502 |   await details.locator("summary").click();
  503 |   const reloadedStageButton = page.getByTestId(`stage-${runId}-${material}__lbs`);
  504 |   await expect(reloadedStageButton).toHaveAttribute("aria-pressed", "true");
  505 |   await attachVisualEvidence(page, testInfo, "operator-warehouse-staging-after-reload");
  506 | 
  507 |   for (const viewport of [
  508 |     { width: 390, height: 844 },
  509 |     { width: 768, height: 1024 },
  510 |     { width: 1024, height: 768 },
  511 |   ]) {
  512 |     await page.setViewportSize(viewport);
  513 |     await page.reload({ waitUntil: "domcontentloaded" });
  514 |     await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
  515 |     await page.getByTestId("tab-warehouse").click();
  516 |     await expect(details).toBeVisible();
  517 |     await details.locator("summary").click();
  518 |     const responsiveStageButton = page.getByTestId(`stage-${runId}-${material}__lbs`);
  519 |     await expect(responsiveStageButton).toHaveAttribute("aria-pressed", "true");
  520 |     await responsiveStageButton.scrollIntoViewIfNeeded();
  521 |     await expect(responsiveStageButton).toBeInViewport();
  522 |     await attachVisualEvidence(
  523 |       page,
  524 |       testInfo,
  525 |       `operator-warehouse-staging-${viewport.width}x${viewport.height}`,
  526 |     );
  527 |   }
  528 | 
  529 |   await reloadedStageButton.click();
  530 |   await expect(reloadedStageButton).toHaveAttribute("aria-pressed", "false");
  531 |   await expect.poll(readSavedStage, { timeout: 20_000 }).toBeNull();
  532 |   await page.reload({ waitUntil: "domcontentloaded" });
  533 |   await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
  534 |   await page.getByTestId("tab-warehouse").click();
  535 |   await expect(details).toBeVisible();
  536 |   await details.locator("summary").click();
  537 |   await expect(page.getByTestId(`stage-${runId}-${material}__lbs`))
  538 |     .toHaveAttribute("aria-pressed", "false");
  539 |   expect(browserErrors).toEqual([]);
  540 | });
  541 | 
  542 | test("shows capped offsite transfer guidance and hides it when onsite stock covers demand", async ({
  543 |   page,
  544 | }, testInfo) => {
  545 |   const runId = uniqueTestId("warehouse_run");
  546 |   const browserErrors: string[] = [];
  547 |   page.on("pageerror", (error) => browserErrors.push(error.message));
  548 |   page.on("response", (response) => {
  549 |     if (response.status() >= 500) {
  550 |       browserErrors.push(`${response.status()} ${response.request().method()} ${response.url()}`);
  551 |     }
  552 |   });
  553 | 
  554 |   const db = new Client({ connectionString: process.env.DATABASE_URL });
  555 |   try {
  556 |     await db.connect();
  557 |     await seedInventory(db);
  558 |     await openAuthenticated(page, managerToken);
  559 |     await seedRun(page, runId);
  560 |     await openInventory(page);
  561 | 
  562 |     const coverage = page.getByTestId("warehouse-coverage");
  563 |     const row = coverage
  564 |       .getByText(fixture.ingredientName, { exact: true })
  565 |       .locator("xpath=../..");
  566 |     await expect(row).toContainText("Short");
  567 |     await expect(row).toContainText(`Can cover 9 lbs from 9 lbs from ${fixture.locationName}.`);
  568 |     await page.screenshot({
  569 |       path: testInfo.outputPath("warehouse-coverage-offsite-guidance.png"),
  570 |       fullPage: true,
  571 |     });
  572 |     await page.screenshot({
  573 |       path: testInfo.outputPath("warehouse-coverage-offsite-viewport.png"),
  574 |     });
  575 | 
  576 |     // Add enough stock through the authenticated restock API. This exercises
  577 |     // the same update/broadcast path the real Stock UI uses, so the mounted
  578 |     // Inventory tab recomputes without relying on an out-of-band DB mutation.
  579 |     const restock = await page.evaluate(
  580 |       async ({ itemKey, itemName, locationId }) => {
  581 |         const response = await fetch("/api/inventory/restock", {
  582 |           method: "POST",
  583 |           headers: { "Content-Type": "application/json" },
  584 |           body: JSON.stringify({
  585 |             itemKey,
  586 |             category: "ingredient",
  587 |             name: itemName,
  588 |             unit: "lbs",
  589 |             qty: 2.1,
  590 |             locationId,
  591 |           }),
  592 |         });
  593 |         return response.status;
  594 |       },
  595 |       {
  596 |         itemKey: fixture.itemKey,
```