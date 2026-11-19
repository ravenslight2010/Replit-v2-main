# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: prior-run-drain.spec.ts >> keeps the prior-run drain selected through next-run and tab changes
- Location: e2e/prior-run-drain.spec.ts:144:1

# Error details

```
Error: HTTP error responses: 403 http://127.0.0.1:44355/api/import-gold/retention?limit=100&offset=0: {"error":"Manager or QC Manager role required"}
403 http://127.0.0.1:44355/api/import-gold/retention?limit=100&offset=0: {"error":"Manager or QC Manager role required"}
Manual-section requests: {"id":"online:81b2b3c5-37b9-4f5c-a676-16c0b0dbaf80","date":"2026-11-01","runId":"drain-a-prior_drain_mvxk2aa8_n5bx9umy","section":"packaging","values":{"skidsCompleted":1,"casesOnCurrentSkid":1},"baseValues":{"skidsCompleted":0,"casesOnCurrentSkid":0},"observedGeneration":"drain-a-prior_drain_mvxk2aa8_n5bx9umy:1793520945296","baseRevision":0,"resetEpoch":1,"deviceId":"device:9f3d9373-ba3b-4841-b7d7-ef2af22f394f"}

expect(received).toEqual(expected) // deep equality

- Expected  - 1
+ Received  + 4

- Array []
+ Array [
+   "Failed to load resource: the server responded with a status of 403 (Forbidden)",
+   "Failed to load resource: the server responded with a status of 403 (Forbidden)",
+ ]
```

# Test source

```ts
  275 |   await expect.poll(() => readCurrentRunId(page)).toBe(runB);
  276 | 
  277 |   await page.getByTestId("tab-packaging").click();
  278 |   const drainHeading = page.getByText(
  279 |     "Freeze Tunnel Draining · Prior Run",
  280 |     { exact: true },
  281 |   );
  282 |   await expect(drainHeading).toBeVisible();
  283 |   await expect(drainHeading.locator("xpath=../../..").getByText(
  284 |     `Prior Run ${suffix} – Ended`,
  285 |     { exact: true },
  286 |   )).toBeVisible();
  287 |   await page.screenshot({
  288 |     path: testInfo.outputPath("prior-run-drain-before-tab-change.png"),
  289 |     fullPage: true,
  290 |   });
  291 | 
  292 |   // The drain effect is automatic and writes the ended run's local values.
  293 |   // With A's 60 PPM fixture, cases exit during this bounded real-time wait.
  294 |   try {
  295 |     await expect
  296 |       .poll(() => readStoredCaseTotal(page, runA, runAValues.casesPerSkid), {
  297 |         timeout: 15_000,
  298 |         intervals: [250, 500, 1_000],
  299 |       })
  300 |       .toBeGreaterThan(0);
  301 |   } catch (error) {
  302 |     const diagnostic = await page.evaluate((id) => {
  303 |       const day = JSON.parse(localStorage.getItem("run-calc-day") ?? "{}") as {
  304 |         currentIndex?: number;
  305 |         runs?: Array<{ id?: string; startedAt?: number; endedAt?: number }>;
  306 |       };
  307 |       const values = JSON.parse(
  308 |         localStorage.getItem(`run-calc-run-${id}`) ?? "null",
  309 |       );
  310 |       const progress = JSON.parse(
  311 |         localStorage.getItem("run-calc-packaging-progress") ?? "{}",
  312 |       )[id] ?? null;
  313 |       return {
  314 |         now: Date.now(),
  315 |         hidden: document.hidden,
  316 |         currentRun: day.runs?.[day.currentIndex ?? 0]?.id,
  317 |         priorRun: day.runs?.find((run) => run.id === id) ?? null,
  318 |         values,
  319 |         progress,
  320 |       };
  321 |     }, runA);
  322 |     const drainPanel = await drainHeading.locator("xpath=../../..").innerText();
  323 |     throw new Error([
  324 |       `Prior-run automatic drain stayed at zero: ${String(error)}`,
  325 |       `Diagnostic: ${JSON.stringify(diagnostic)}`,
  326 |       `Drain panel: ${drainPanel}`,
  327 |       `Page errors: ${pageErrors.join("\n")}`,
  328 |     ].join("\n"));
  329 |   }
  330 |   const automaticCounters = await readStoredCounters(page, runA);
  331 |   const automaticTotal =
  332 |     automaticCounters.skidsCompleted * runAValues.casesPerSkid
  333 |       + automaticCounters.casesOnCurrentSkid;
  334 | 
  335 |   // A manual prior-run update must use A's ID, not the currently active B.
  336 |   await page.getByTestId("btn-draining-skid-done").click();
  337 |   await expect
  338 |     .poll(() => readStoredCaseTotal(page, runA, runAValues.casesPerSkid))
  339 |     .toBeGreaterThanOrEqual(automaticTotal + runAValues.casesPerSkid);
  340 |   const manualCounters = await readStoredCounters(page, runA);
  341 |   expect(await readStoredCounters(page, runB)).toEqual({
  342 |     casesOnCurrentSkid: 0,
  343 |     skidsCompleted: 0,
  344 |   });
  345 | 
  346 |   // TabsContent unmounts Packaging. Returning must recompute the same eligible
  347 |   // ended run rather than losing the drain baseline or binding to B.
  348 |   await page.getByTestId("tab-sauce").click();
  349 |   await expect(drainHeading).toHaveCount(0);
  350 |   await expect(page.getByTestId("compact-run-strip")).toContainText(
  351 |     `Next Run ${suffix}`,
  352 |   );
  353 |   await page.getByTestId("tab-packaging").click();
  354 |   await expect(drainHeading).toBeVisible();
  355 |   await expect(drainHeading.locator("xpath=../../..").getByText(
  356 |     `Prior Run ${suffix} – Ended`,
  357 |     { exact: true },
  358 |   )).toBeVisible();
  359 |   await expect.poll(() => readStoredCounters(page, runA)).toEqual(manualCounters);
  360 |   await expect
  361 |     .poll(() => readStoredCounters(page, runB))
  362 |     .toEqual({ casesOnCurrentSkid: 0, skidsCompleted: 0 });
  363 |   await page.screenshot({
  364 |     path: testInfo.outputPath("prior-run-drain-after-tab-change.png"),
  365 |     fullPage: true,
  366 |   });
  367 | 
  368 |   expect(pageErrors).toEqual([]);
  369 |   expect(
  370 |     consoleErrors,
  371 |     [
  372 |       `HTTP error responses: ${failedResponses.join("\n")}`,
  373 |       `Manual-section requests: ${manualSectionRequestBodies.join("\n")}`,
  374 |     ].join("\n"),
> 375 |   ).toEqual([]);
      |     ^ Error: HTTP error responses: 403 http://127.0.0.1:44355/api/import-gold/retention?limit=100&offset=0: {"error":"Manager or QC Manager role required"}
  376 | });
```