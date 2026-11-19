# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: recipe-refresh-start-freeze.spec.ts >> cheese recipe edits refresh pending runs across browsers but freeze after Start
- Location: e2e/recipe-refresh-start-freeze.spec.ts:1467:3

# Error details

```
Error: expect(received).not.toBe(expected) // Object.is equality

Expected: not "Ingredient Detail — Weight Sync brand_mvxkhoat_7vaadog3 – Manager JourneyApplicatorsApp 1 — Cheese12.00 batchesShared cheese recipe_mvxkhoat_uw80shw2Cheese120.0 lbsClose"

Call Log:
- Timeout 20000ms exceeded while waiting on the predicate
```

# Test source

```ts
  373 |     await expect(input).toBeEnabled({ timeout: 45_000 });
  374 |   }
  375 |   await dialog
  376 |     .getByRole("button", { name: "Close settings" })
  377 |     .click({ force: true });
  378 | }
  379 | 
  380 | async function setMixPerPizza(
  381 |   page: Page,
  382 |   recipeName: string,
  383 |   perPizza: string,
  384 |   waitForSave = true,
  385 | ): Promise<void> {
  386 |   const dialog = await openRecipeSettings(page, "mixes");
  387 |   const search = dialog.getByPlaceholder(
  388 |     "Search mixes by name, brand, or flavor…",
  389 |   );
  390 |   await search.fill(recipeName);
  391 |   await dialog.getByRole("button", { name: new RegExp(recipeName) }).click();
  392 |   // The filtered manager contains only this fixture mix. Target the component
  393 |   // field by its distinctive step rather than relying on the editor's other
  394 |   // numeric fields (batch size, days early, and lbs/batch).
  395 |   const input = dialog.locator('input[type="number"][step="0.001"]').first();
  396 |   const saved = waitForSave
  397 |     ? page.waitForResponse((response) =>
  398 |         responseContainsRecipeValue(
  399 |           response,
  400 |           "/api/mixes",
  401 |           recipeName,
  402 |           perPizza,
  403 |         ),
  404 |       )
  405 |     : undefined;
  406 |   await input.fill(perPizza);
  407 |   await input.blur();
  408 |   if (waitForSave) await saved;
  409 |   if (waitForSave) {
  410 |     await expect(input).toBeEnabled({ timeout: 45_000 });
  411 |   }
  412 |   await dialog
  413 |     .getByRole("button", { name: "Close settings" })
  414 |     .click({ force: true });
  415 | }
  416 | 
  417 | async function primeRecipeSettings(
  418 |   page: Page,
  419 |   kind: SharedRecipeFreezeScenario["kind"],
  420 |   recipeName: string,
  421 | ): Promise<void> {
  422 |   const dialog = await openRecipeSettings(page, kind);
  423 |   const placeholder =
  424 |     kind === "cheese"
  425 |       ? "Search cheese recipes by name, customer, or flavor…"
  426 |       : kind === "mixes"
  427 |         ? "Search mixes by name, brand, or flavor…"
  428 |         : `Search ${kind} recipes by name or ingredient…`;
  429 |   await dialog.getByPlaceholder(placeholder).fill(recipeName);
  430 |   await expect(
  431 |     dialog.getByRole("button", { name: new RegExp(recipeName) }),
  432 |   ).toBeVisible({
  433 |     timeout: 15_000,
  434 |   });
  435 |   await dialog.getByRole("button", { name: "Close settings" }).click();
  436 | }
  437 | async function readIngredientDetail(
  438 |   page: Page,
  439 |   runId: string,
  440 | ): Promise<string> {
  441 |   const detail = await openRunIngredientDetailDialog(page, runId);
  442 |   const text = (await detail.textContent()) ?? "";
  443 |   await page.keyboard.press("Escape");
  444 |   await expect(detail).toBeHidden();
  445 |   return text;
  446 | }
  447 | 
  448 | async function openRunIngredientDetailDialog(page: Page, runId: string) {
  449 |   await openSummary(page);
  450 |   const button = page
  451 |     .getByTestId(`run-summary-${runId}`)
  452 |     .getByRole("button", { name: "Ingredient Detail" });
  453 |   await expect(button).toBeVisible();
  454 |   // Center the control before clicking so the fixed phone navigation bar
  455 |   // cannot cover it. Keep a normal pointer click to preserve the real journey.
  456 |   await button.evaluate((element) =>
  457 |     element.scrollIntoView({ block: "center", inline: "nearest" }),
  458 |   );
  459 |   await button.click();
  460 |   const detail = page.getByRole("dialog", { name: /Ingredient Detail/ });
  461 |   await expect(detail).toBeVisible();
  462 |   return detail;
  463 | }
  464 | 
  465 | async function expectIngredientDetailChanged(
  466 |   page: Page,
  467 |   runId: string,
  468 |   previous: string,
  469 | ): Promise<string> {
  470 |   const detail = await openRunIngredientDetailDialog(page, runId);
  471 |   await expect
  472 |     .poll(async () => (await detail.textContent()) ?? "", { timeout: 20_000 })
> 473 |     .not.toBe(previous);
      |          ^ Error: expect(received).not.toBe(expected) // Object.is equality
  474 |   const text = (await detail.textContent()) ?? "";
  475 |   await page.keyboard.press("Escape");
  476 |   await expect(detail).toBeHidden();
  477 |   return text;
  478 | }
  479 | 
  480 | async function expectIngredientDetailStable(
  481 |   page: Page,
  482 |   runId: string,
  483 |   expected: string,
  484 | ): Promise<void> {
  485 |   const detail = await openRunIngredientDetailDialog(page, runId);
  486 |   await expect
  487 |     .poll(async () => (await detail.textContent()) ?? "", { timeout: 20_000 })
  488 |     .toBe(expected);
  489 |   await page.keyboard.press("Escape");
  490 |   await expect(detail).toBeHidden();
  491 | }
  492 | 
  493 | async function expectReloadedRecipeSnapshotsStable(
  494 |   page: Page,
  495 |   pendingRunId: string,
  496 |   pendingSnapshot: string,
  497 |   startedRunId: string,
  498 |   startedSnapshot: string,
  499 | ): Promise<void> {
  500 |   await expectIngredientDetailStable(page, pendingRunId, pendingSnapshot);
  501 |   await expectIngredientDetailStable(page, startedRunId, startedSnapshot);
  502 | }
  503 | 
  504 | async function readServerRunValue(page: Page, runId: string): Promise<string> {
  505 |   const response = await page.request.get(`/api/sync/today?today=${TODAY}`, {
  506 |     headers: { "Cache-Control": "no-cache" },
  507 |   });
  508 |   if (!response.ok()) {
  509 |     throw new Error(`Read canonical run value failed (${response.status()})`);
  510 |   }
  511 |   const payload = (await response.json()) as {
  512 |     runValues?: Record<string, unknown>;
  513 |   };
  514 |   return JSON.stringify(payload.runValues?.[runId] ?? null);
  515 | }
  516 | 
  517 | async function expectServerNamedRecipeRowsAtLbs(
  518 |   page: Page,
  519 |   runId: string,
  520 |   kind: "dough" | "sauce",
  521 |   expectedLbs: number,
  522 | ): Promise<void> {
  523 |   const field = kind === "dough" ? "doughRecipe" : "frontlineRecipe";
  524 |   await expect.poll(async () => {
  525 |     const values = JSON.parse(await readServerRunValue(page, runId)) as
  526 |       | Record<string, unknown>
  527 |       | null;
  528 |     const rows = values?.[field];
  529 |     return Array.isArray(rows)
  530 |       ? rows.map((row) => Number((row as { lbs?: unknown }).lbs))
  531 |       : null;
  532 |   }, {
  533 |     timeout: 45_000,
  534 |     message: `Canonical ${kind} recipe rows should acknowledge ${expectedLbs} lbs`,
  535 |   }).toEqual([expectedLbs]);
  536 | }
  537 | 
  538 | async function readBrowserNamedRecipeRowsAtLbs(
  539 |   page: Page,
  540 |   runId: string,
  541 |   kind: "dough" | "sauce",
  542 | ): Promise<number[] | null> {
  543 |   const field = kind === "dough" ? "doughRecipe" : "frontlineRecipe";
  544 |   return page.evaluate(({ storageKey, fieldName }) => {
  545 |     const raw = window.localStorage.getItem(storageKey);
  546 |     if (!raw) return null;
  547 |     const values = JSON.parse(raw) as Record<string, unknown>;
  548 |     const rows = values[fieldName];
  549 |     return Array.isArray(rows)
  550 |       ? rows.map((row) => Number((row as { lbs?: unknown }).lbs))
  551 |       : null;
  552 |   }, {
  553 |     storageKey: `run-calc-run-${runId}`,
  554 |     fieldName: field,
  555 |   });
  556 | }
  557 | 
  558 | function stableJson(value: unknown): string {
  559 |   if (Array.isArray(value)) {
  560 |     return `[${value.map(stableJson).join(",")}]`;
  561 |   }
  562 |   if (typeof value === "object" && value !== null) {
  563 |     const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
  564 |     return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
  565 |   }
  566 |   return JSON.stringify(value) ?? "undefined";
  567 | }
  568 | 
  569 | function canonicalRunValue(serialized: string): string {
  570 |   const value = JSON.parse(serialized) as unknown;
  571 |   if (typeof value !== "object" || value === null || Array.isArray(value)) {
  572 |     return stableJson(value);
  573 |   }
```