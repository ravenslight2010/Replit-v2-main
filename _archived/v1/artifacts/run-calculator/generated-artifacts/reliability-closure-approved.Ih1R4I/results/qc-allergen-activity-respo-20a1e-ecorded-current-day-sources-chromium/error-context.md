# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: qc-allergen-activity-responsive.spec.ts >> renders the daily allergen report from recorded current-day sources
- Location: e2e/qc-allergen-activity-responsive.spec.ts:121:1

# Error details

```
Error: Unexpected failed browser responses

expect(received).toEqual(expected) // deep equality

- Expected  -  1
+ Received  + 10

- Array []
+ Array [
+   Object {
+     "path": "/api/import-gold/retention",
+     "status": 403,
+   },
+   Object {
+     "path": "/api/import-gold/retention",
+     "status": 403,
+   },
+ ]
```

# Test source

```ts
  294 |       animations: "disabled",
  295 |       mask: [page.getByText(runId, { exact: true })],
  296 |     });
  297 |     await testInfo.attach("operator-daily-allergen-report-phone-320-large-text", {
  298 |       body: operatorPhoneEvidence,
  299 |       contentType: "image/png",
  300 |     });
  301 |     await operatorLargeTextStyle.evaluate((element) => element.remove());
  302 |     await page.setViewportSize({ width: 1440, height: 900 });
  303 |     await backToQc.click();
  304 |     await expect(report).toBeHidden();
  305 |     await expect(page.getByTestId("qc-workflow-tab")).toBeVisible();
  306 | 
  307 |     managerContext = await browser.newContext({
  308 |       viewport: test.info().project.use.viewport as { width: number; height: number } | undefined,
  309 |     });
  310 |     await managerContext.addCookies([{
  311 |       name: "rc_auth",
  312 |       value: manager.token,
  313 |       url: new URL(webOrigin).origin,
  314 |       httpOnly: true,
  315 |       sameSite: "Lax",
  316 |     }]);
  317 |     const managerPage = await managerContext.newPage();
  318 |     collectBrowserErrors(managerPage, browserDiagnostics);
  319 |     await managerPage.goto(webOrigin, { waitUntil: "domcontentloaded" });
  320 |     await managerPage.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
  321 |     await managerPage.getByTitle("More").click();
  322 |     await managerPage.getByRole("menuitem", { name: "QC workflows & history", exact: true }).click();
  323 |     await managerPage.getByTestId("button-toggle-allergen-activity").click();
  324 | 
  325 |     const managerReviewCard = managerPage.getByTestId(`card-allergen-review-${reviewId}`);
  326 |     await expect(managerReviewCard).toContainText("Corrected the reviewed footprint");
  327 |     await expect(managerReviewCard).toContainText("Removed private note");
  328 |     await expect(managerReviewCard).toContainText(manager.userId);
  329 |     await expect(managerReviewCard).toContainText("[redacted]");
  330 |     await expect(managerReviewCard).not.toContainText("Responsive fixture review");
  331 |     await expect(managerReviewCard).not.toContainText("Corrected private fixture note");
  332 |     const managerViewportMetrics: Record<string, { cardWidth: number; headingFontSize: number }> = {};
  333 |     for (const viewport of RESPONSIVE_VIEWPORTS) {
  334 |       managerViewportMetrics[viewport.name] = await assertActivityReportLayout(managerPage, viewport);
  335 |       await managerReviewCard.scrollIntoViewIfNeeded();
  336 |       await expect(managerReviewCard, `${viewport.name} manager audit content`).toBeVisible();
  337 |     }
  338 |     expect(managerViewportMetrics["tablet-landscape"]!.cardWidth)
  339 |       .toBeGreaterThan(managerViewportMetrics["phone-320"]!.cardWidth);
  340 |     expect(managerViewportMetrics["tablet-landscape"]!.headingFontSize)
  341 |       .toBeGreaterThanOrEqual(managerViewportMetrics["phone-320"]!.headingFontSize);
  342 |     await managerPage.setViewportSize({ width: 1440, height: 900 });
  343 |     const screenshot = await managerPage.screenshot({
  344 |       fullPage: true,
  345 |       animations: "disabled",
  346 |       mask: [
  347 |         managerReviewCard,
  348 |         managerPage.getByTestId("text-qc-run-id"),
  349 |       ],
  350 |     });
  351 |     await testInfo.attach("manager-daily-allergen-audit-details", {
  352 |       body: screenshot,
  353 |       contentType: "image/png",
  354 |     });
  355 |     await testInfo.attach("qc-responsive-evidence-manifest", {
  356 |       body: JSON.stringify({
  357 |         capturedAt: new Date().toISOString(),
  358 |         environment: "isolated browser run with disposable database and synthetic fixtures",
  359 |         revision: "unknown in the local isolated browser harness",
  360 |         browserProject: testInfo.project.name,
  361 |         viewports: RESPONSIVE_VIEWPORTS.map(({ name, width, height }) => ({
  362 |           name,
  363 |           width,
  364 |           height,
  365 |         })),
  366 |         largeText: "simulated with a 200% root font size at 320px CSS viewport width",
  367 |         screenshots: "account/run identifiers and manager audit records masked or omitted",
  368 |         evidenceScope: "rendered layout only; not physical-device or production verification",
  369 |       }, null, 2),
  370 |       contentType: "application/json",
  371 |     });
  372 |     const expectedForbiddenPaths = new Set([
  373 |       "/api/inventory/consume-day-start",
  374 |       "/api/factory-data",
  375 |     ]);
  376 |     const unexpectedResponses = browserDiagnostics.failedResponses.filter((response) =>
  377 |       response.status !== 403 || !expectedForbiddenPaths.has(response.path),
  378 |     );
  379 |     const forbiddenConsoleErrors = browserDiagnostics.consoleErrors.filter((message) =>
  380 |       message.includes("status of 403 (Forbidden)"),
  381 |     );
  382 |     const otherConsoleErrors = browserDiagnostics.consoleErrors.filter((message) =>
  383 |       !message.includes("status of 403 (Forbidden)"),
  384 |     );
  385 |     await testInfo.attach("qc-audit-browser-console", {
  386 |       body: JSON.stringify({
  387 |         ...browserDiagnostics,
  388 |         expectedForbiddenPaths: [...expectedForbiddenPaths],
  389 |       }, null, 2),
  390 |       contentType: "text/plain",
  391 |     });
  392 |     expect(browserDiagnostics.pageErrors, "Operator and manager page errors").toEqual([]);
  393 |     expect(otherConsoleErrors, "Unexpected browser console errors").toEqual([]);
> 394 |     expect(unexpectedResponses, "Unexpected failed browser responses").toEqual([]);
      |                                                                        ^ Error: Unexpected failed browser responses
  395 |     expect(forbiddenConsoleErrors, "Each expected 403 should match a protected API response")
  396 |       .toHaveLength(browserDiagnostics.failedResponses.length);
  397 |   } finally {
  398 |     await operatorContext?.close().catch(() => {});
  399 |     await managerContext?.close().catch(() => {});
  400 |     await db.query(
  401 |       "DELETE FROM qc_workflow_events WHERE scope = 'live' AND run_id = $1",
  402 |       [runId],
  403 |     ).catch(() => {});
  404 |     await db.end().catch(() => {});
  405 |     await fixtures.cleanup({ syncDates: [date] });
  406 |   }
  407 | });
  408 | 
```