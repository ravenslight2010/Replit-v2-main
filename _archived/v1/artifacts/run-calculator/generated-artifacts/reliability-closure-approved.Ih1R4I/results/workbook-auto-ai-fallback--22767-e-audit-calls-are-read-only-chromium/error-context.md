# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: workbook-auto-ai-fallback.spec.ts >> manager gets Mauro's three products in review; source audit calls are read-only
- Location: e2e/workbook-auto-ai-fallback.spec.ts:251:1

# Error details

```
Error: The authorized real workbook parser must succeed before product review

expect(received).toBe(expected) // Object.is equality

Expected: 200
Received: 502
```

# Test source

```ts
  224 | function deterministicExportBytes(): Buffer {
  225 |   const workbook = buildExportWorkbook([{
  226 |     name: "Products",
  227 |     rows: [
  228 |       ["Brand", "Flavor", "Die Type"],
  229 |       ["Audit Fixture Bakery", "Classic", "12 inch"],
  230 |     ],
  231 |     headerRows: [0],
  232 |   }]);
  233 |   return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
  234 | }
  235 | 
  236 | test.beforeAll(async () => {
  237 |   await requireIsolatedTestDatabase("automatic workbook AI fallback browser audit");
  238 | });
  239 | 
  240 | test.afterAll(async () => {
  241 |   if (!process.env.DATABASE_URL || testUsernames.size === 0) return;
  242 |   const db = new Client({ connectionString: process.env.DATABASE_URL });
  243 |   try {
  244 |     await db.connect();
  245 |     await cleanupTestUsers(db, testUsernames);
  246 |   } finally {
  247 |     await db.end().catch(() => {});
  248 |   }
  249 | });
  250 | 
  251 | test("manager gets Mauro's three products in review; source audit calls are read-only", async ({
  252 |   page,
  253 |   browserName,
  254 | }) => {
  255 |   test.setTimeout(60 * 60 * 1_000);
  256 |   const engine = browserName as BrowserName;
  257 |   await page.setViewportSize({ width: 1440, height: 900 });
  258 |   await signInManager(page, true);
  259 |   const before = await masterDataCounts(page);
  260 |   const realParseResponse = engine === "chromium"
  261 |     ? page.waitForResponse(
  262 |       (response) =>
  263 |         response.url().includes("/api/ai/parse-spec-sheet") &&
  264 |         response.request().method() === "POST",
  265 |       { timeout: 8 * 60_000 },
  266 |     )
  267 |     : undefined;
  268 |   if (engine === "webkit") {
  269 |     await page.route("**/api/ai/parse-spec-sheet", async (route) => {
  270 |       await route.fulfill({
  271 |         status: 200,
  272 |         contentType: "application/json",
  273 |         body: JSON.stringify({
  274 |           profiles: EXPECTED_MAURO_PRODUCTS.map((flavor) => ({
  275 |             brand: "Mauro's Pinsa",
  276 |             flavor,
  277 |             applicators: [],
  278 |             pepperonis: [],
  279 |           })),
  280 |           recipes: [],
  281 |           generatedAt: Date.now(),
  282 |         }),
  283 |       });
  284 |     });
  285 |   }
  286 |   const commitRequests: string[] = [];
  287 |   let mauroRequestCount = 0;
  288 |   page.on("request", (request) => {
  289 |     if (
  290 |       request.url().includes("/api/ai/parse-spec-sheet") &&
  291 |       request.method() === "POST"
  292 |     ) {
  293 |       mauroRequestCount++;
  294 |     }
  295 |   });
  296 |   page.on("request", (request) => {
  297 |     const url = new URL(request.url());
  298 |     if (
  299 |       ["POST", "PUT", "PATCH", "DELETE"].includes(request.method()) &&
  300 |       /\/api\/(brand-profiles|dough-recipes|sauce-recipes|cheese-recipes|mixes)(?:\/|$)/.test(url.pathname)
  301 |     ) {
  302 |       commitRequests.push(`${request.method()} ${url.pathname}`);
  303 |     }
  304 |   });
  305 | 
  306 |   await openWorkbookImport(page);
  307 |   await expect(page.getByTestId("spec-workbook-ai-disclosure")).toContainText(
  308 |     "authorized users automatically send extracted text",
  309 |   );
  310 |   const mauroPath = path.join(
  311 |     repoRoot,
  312 |     "attached_assets/0_Mauro's_Pinsa_Pizza_Recipe_Specs_-_01_1791920475343.xlsx",
  313 |   );
  314 |   await chooseWorkbook(page, mauroPath);
  315 |   const dialog = page.getByRole("dialog", { name: "Import Spec Sheet" });
  316 |   await expect(dialog.getByText("Step 1 of 2 — products.")).toBeVisible({
  317 |     timeout: 8 * 60_000,
  318 |   });
  319 |   let mauroParseSummary: Record<string, unknown> | null = null;
  320 |   let mauroHttpStatus: number | null = null;
  321 |   if (realParseResponse) {
  322 |     const response = await realParseResponse;
  323 |     mauroHttpStatus = response.status();
> 324 |     expect(mauroHttpStatus, "The authorized real workbook parser must succeed before product review").toBe(200);
      |                                                                                                       ^ Error: The authorized real workbook parser must succeed before product review
  325 |     if (response.ok()) {
  326 |       const parsed = await response.json() as ParsedSpecImport;
  327 |       mauroParseSummary = summarizeParse(
  328 |         parsed,
  329 |         sourceTextForBuffer(await readFile(mauroPath)),
  330 |       );
  331 |     }
  332 |   }
  333 | 
  334 |   // Labels now wrap to remain readable on short/narrow screens. Locate their
  335 |   // actual text rather than depending on the removed truncation CSS class.
  336 |   const visibleProducts: string[] = [];
  337 |   for (const flavor of EXPECTED_MAURO_PRODUCTS) {
  338 |     const label = dialog.getByText(`Mauro's Pinsa — ${flavor}`, { exact: true });
  339 |     await expect(label).toBeVisible();
  340 |     visibleProducts.push((await label.innerText()).trim());
  341 |   }
  342 |   const profileCount = await dialog.locator('li[data-testid^="spec-profile-"]').count();
  343 | 
  344 |   const viewportChecks: Array<Record<string, unknown>> = [];
  345 |   for (const viewport of [
  346 |     { label: "desktop", width: 1440, height: 900 },
  347 |     { label: "phone", width: 390, height: 844 },
  348 |     { label: "tablet-portrait", width: 768, height: 1024 },
  349 |     { label: "tablet-landscape", width: 1024, height: 768 },
  350 |   ]) {
  351 |     await page.setViewportSize({ width: viewport.width, height: viewport.height });
  352 |     await expect(dialog).toBeVisible();
  353 |     await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
  354 |     const layout = await dialog.evaluate((element) => ({
  355 |       width: element.getBoundingClientRect().width,
  356 |       height: element.getBoundingClientRect().height,
  357 |       documentWidth: document.documentElement.scrollWidth,
  358 |       viewportWidth: window.innerWidth,
  359 |     }));
  360 |     expect(layout.width).toBeGreaterThan(0);
  361 |     expect(layout.height).toBeGreaterThan(0);
  362 |     expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth + 1);
  363 |     viewportChecks.push({ ...viewport, layout });
  364 |     if (viewport.label === "desktop") {
  365 |       await mkdir(evidenceDir, { recursive: true });
  366 |       await page.screenshot({
  367 |         path: path.join(evidenceDir, `mauro-review-${engine}.png`),
  368 |         fullPage: false,
  369 |       });
  370 |     }
  371 |   }
  372 | 
  373 |   await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  374 |   await expect(dialog).toBeHidden();
  375 |   const after = await masterDataCounts(page);
  376 |   expect(after).toEqual(before);
  377 |   expect(commitRequests).toEqual([]);
  378 |   await mkdir(evidenceDir, { recursive: true });
  379 |   await writeFile(
  380 |     path.join(evidenceDir, `browser-journey-${engine}.json`),
  381 |     `${JSON.stringify({
  382 |       format: "workbook-import-browser-journey",
  383 |       formatVersion: 1,
  384 |       engine,
  385 |       aiEvidence: engine === "chromium" ? "real-provider" : "mocked-provider",
  386 |       selectedSourceSha256: createHash("sha256").update(await readFile(mauroPath)).digest("hex"),
  387 |       visibleProducts,
  388 |       reviewReached: true,
  389 |       canceledWithoutApply: true,
  390 |       beforeMasterDataCounts: before.counts,
  391 |       beforeMasterDataSha256: before.snapshotSha256,
  392 |       afterMasterDataCounts: after.counts,
  393 |       afterMasterDataSha256: after.snapshotSha256,
  394 |       masterDataWriteRequests: commitRequests.length,
  395 |       viewportChecks,
  396 |       observedProductLabels: visibleProducts,
  397 |       parserRequestCount: mauroRequestCount,
  398 |       parserHttpStatus: mauroHttpStatus,
  399 |       realParseSummary: mauroParseSummary,
  400 |       viewportLimitations: "Browser emulation only; no physical Android/iOS device run.",
  401 |     }, null, 2)}\n`,
  402 |   );
  403 | 
  404 |   for (const flavor of EXPECTED_MAURO_PRODUCTS) {
  405 |     expect(visibleProducts).toContain(`Mauro's Pinsa — ${flavor}`);
  406 |   }
  407 |   expect(profileCount).toBeGreaterThanOrEqual(EXPECTED_MAURO_PRODUCTS.length);
  408 |   if (engine === "chromium") expect(mauroHttpStatus).toBe(200);
  409 | 
  410 |   if (engine !== "chromium") return;
  411 | 
  412 |   const manifest = JSON.parse(
  413 |     await readFile(path.join(evidenceDir, "manifest.json"), "utf8"),
  414 |   ) as {
  415 |     sha256?: string;
  416 |     files: Array<{
  417 |       path: string;
  418 |       sha256: string;
  419 |       importer: string;
  420 |       preparation?: Record<string, unknown>;
  421 |     }>;
  422 |   };
  423 |   const preparation = JSON.parse(
  424 |     await readFile(path.join(evidenceDir, "preparation.json"), "utf8"),
```