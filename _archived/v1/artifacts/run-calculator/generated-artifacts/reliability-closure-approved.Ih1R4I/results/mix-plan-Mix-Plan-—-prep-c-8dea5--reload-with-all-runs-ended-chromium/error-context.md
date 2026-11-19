# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: mix-plan.spec.ts >> Mix Plan — prep card suppression and ended-run removal >> shows the empty state on first Mixes visit after a cold reload with all runs ended
- Location: e2e/mix-plan.spec.ts:4264:3

# Error details

```
Error: locator.waitFor: Error: strict mode violation: getByRole('button', { name: /prev/i }) resolved to 2 elements:
    1) <button type="button" aria-expanded="false" data-component-name="button" aria-controls="app-update-details" data-testid="button-app-update-details" class="min-h-10 rounded px-2 text-left text-sm font-semibold hover:bg-muted/60" data-replit-metadata="artifacts/run-calculator/src/components/AppUpdateControl.tsx:50:8">App updates · Development preview</button> aka getByTestId('button-app-update-details')
    2) <button type="button" class="flex items-center gap-1 px-2 py-1 rounded-md text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors min-w-0">…</button> aka getByRole('button', { name: 'Prev ColdReloadEndedBrandA_e2emp3sqi7lj' })

Call log:
  - waiting for getByRole('button', { name: /prev/i }) to be visible

```

# Test source

```ts
  4226 |       // This exercises the localStorage → loadDayState() → React hydration path.
  4227 |       // endedAt must survive serialisation so liveRunsForMixes returns [] and
  4228 |       // buildMixPlan returns [] after mount.
  4229 |       await page.reload({ waitUntil: "domcontentloaded" });
  4230 |       await page.locator('[data-testid="tab-run"]').waitFor({ state: "attached", timeout: 25_000 });
  4231 |       // Dismiss onboarding if it reappears after reload (it should not, but be safe).
  4232 |       await page.getByRole("button", { name: /^get.?started$/i })
  4233 |         .waitFor({ state: "visible", timeout: 5_000 }).then((b) => b.click()).catch(() => {});
  4234 |       await page.waitForTimeout(1_000);
  4235 | 
  4236 |       // Navigate to Mixes and assert empty state is still shown
  4237 |       await goToMixes(page);
  4238 |       await page.waitForTimeout(500);
  4239 | 
  4240 |       await expect(
  4241 |         page.locator(`[data-testid="mix-plan-${today}"]`),
  4242 |       ).toHaveCount(0, { timeout: 5_000 });
  4243 |       await expect(
  4244 |         page.locator('[data-testid="mix-plan-empty"]'),
  4245 |       ).toBeVisible({ timeout: 5_000 });
  4246 |       await expect(page.getByText(mixName1, { exact: false })).toHaveCount(0, { timeout: 3_000 });
  4247 |       await expect(page.getByText(mixName2, { exact: false })).toHaveCount(0, { timeout: 3_000 });
  4248 |     } finally {
  4249 |       await db.query("DELETE FROM mixes WHERE id = $1", [mixId1]).catch(() => {});
  4250 |       await db.query("DELETE FROM mixes WHERE id = $1", [mixId2]).catch(() => {});
  4251 |       await db.query("DELETE FROM daily_sync WHERE date = $1 AND scope = 'live'", [today]).catch(() => {});
  4252 |       await db.query("DELETE FROM users WHERE username = $1", [username]).catch(() => {});
  4253 |     }
  4254 |   });
  4255 | 
  4256 |   /**
  4257 |    * Test (l): Empty state is preserved after a cold page reload when all runs
  4258 |    * are ended and Mixes was never opened in the previous page session.
  4259 |    *
  4260 |    * Unlike the preceding reload test, this deliberately stops both runs while
  4261 |    * staying on the Run tab. The first Mixes navigation happens only after the
  4262 |    * reload, exercising hydration without any previously-populated Mixes state.
  4263 |    */
  4264 |   test("shows the empty state on first Mixes visit after a cold reload with all runs ended", async ({
  4265 |     page,
  4266 |   }) => {
  4267 |     const suffix = uid();
  4268 |     const username = `user_${suffix}`;
  4269 |     const mixId1 = `cold-reload-ended-mix-a-${suffix}`;
  4270 |     const mixId2 = `cold-reload-ended-mix-b-${suffix}`;
  4271 |     const mixName1 = `ColdReloadEndedMixA ${suffix}`;
  4272 |     const mixName2 = `ColdReloadEndedMixB ${suffix}`;
  4273 |     const component1 = `ColdReloadEndedCompA_${suffix}`;
  4274 |     const component2 = `ColdReloadEndedCompB_${suffix}`;
  4275 |     const brand1 = `ColdReloadEndedBrandA_${suffix}`;
  4276 |     const brand2 = `ColdReloadEndedBrandB_${suffix}`;
  4277 |     const today = todayStr();
  4278 |     const runId1 = `cold-reload-ended-run-a-${suffix}`;
  4279 |     const runId2 = `cold-reload-ended-run-b-${suffix}`;
  4280 | 
  4281 |     try {
  4282 |       await dbCreateMix(db, {
  4283 |         id: mixId1,
  4284 |         name: mixName1,
  4285 |         brand: brand1,
  4286 |         isPrep: false,
  4287 |         component: component1,
  4288 |         perPizza: 2.0,
  4289 |         batchSize: 10,
  4290 |       });
  4291 |       await dbCreateMix(db, {
  4292 |         id: mixId2,
  4293 |         name: mixName2,
  4294 |         brand: brand2,
  4295 |         isPrep: false,
  4296 |         component: component2,
  4297 |         perPizza: 2.0,
  4298 |         batchSize: 10,
  4299 |       });
  4300 | 
  4301 |       await signUpAndDismissOnboarding(page, username, "TestPass123!");
  4302 |       await seedLiveRunsAfterAppLoad(page, [
  4303 |         {
  4304 |           runId: runId1,
  4305 |           brand: brand1,
  4306 |           ingredient: component1,
  4307 |           runOz: 2,
  4308 |           casesNeeded: 1,
  4309 |           pizzasPerCase: 8,
  4310 |           casesPerLayer: 0,
  4311 |         },
  4312 |         {
  4313 |           runId: runId2,
  4314 |           brand: brand2,
  4315 |           ingredient: component2,
  4316 |           runOz: 2,
  4317 |           casesNeeded: 1,
  4318 |           pizzasPerCase: 8,
  4319 |           casesPerLayer: 0,
  4320 |         },
  4321 |       ], 1);
  4322 | 
  4323 |       // Complete both runs without visiting Mixes. The cold reload below must
  4324 |       // be followed by this browser's first Mixes visit.
  4325 |       const prevBtn = page.getByRole("button", { name: /prev/i });
> 4326 |       await prevBtn.waitFor({ state: "visible", timeout: 8_000 });
       |                     ^ Error: locator.waitFor: Error: strict mode violation: getByRole('button', { name: /prev/i }) resolved to 2 elements:
  4327 |       await prevBtn.click();
  4328 |       await waitForCurrentRun(page, runId1);
  4329 | 
  4330 |       const startBtn1 = page.locator('[data-testid="button-start-run"]');
  4331 |       await startBtn1.waitFor({ state: "visible", timeout: 8_000 });
  4332 |       await startBtn1.click();
  4333 |       await waitForLocalRunStarted(page, runId1);
  4334 |       await waitForCanonicalRunField(runId1, "startedAt");
  4335 |       await expect(page.getByText("Synchronized", { exact: true })).toBeVisible({
  4336 |         timeout: 15_000,
  4337 |       });
  4338 | 
  4339 |       const nextBtn = page.getByRole("button", { name: /next/i });
  4340 |       await nextBtn.waitFor({ state: "visible", timeout: 8_000 });
  4341 |       await nextBtn.click();
  4342 |       await waitForCurrentRun(page, runId2);
  4343 | 
  4344 |       const startBtn2 = page.locator('[data-testid="button-start-run"]');
  4345 |       await startBtn2.waitFor({ state: "visible", timeout: 8_000 });
  4346 |       await startBtn2.click();
  4347 |       await waitForLocalRunStarted(page, runId2);
  4348 |       await waitForCanonicalRunField(runId2, "startedAt");
  4349 |       await waitForLocalRunEnded(page, runId1);
  4350 | 
  4351 |       const stopBtn2 = page.getByRole("button", { name: /stop run/i });
  4352 |       await stopBtn2.waitFor({ state: "visible", timeout: 10_000 });
  4353 |       await stopBtn2.click();
  4354 |       await waitForLocalRunEnded(page, runId2);
  4355 |       await waitForCanonicalRunField(runId2, "endedAt");
  4356 | 
  4357 |       // Reload before the first Mixes visit in this browser session.
  4358 |       await page.reload({ waitUntil: "domcontentloaded" });
  4359 |       await page.locator('[data-testid="tab-run"]').waitFor({ state: "attached", timeout: 25_000 });
  4360 |       await page.getByRole("button", { name: /^get.?started$/i })
  4361 |         .waitFor({ state: "visible", timeout: 5_000 }).then((b) => b.click()).catch(() => {});
  4362 |       await page.waitForTimeout(1_000);
  4363 | 
  4364 |       await goToMixes(page);
  4365 |       await page.waitForTimeout(500);
  4366 | 
  4367 |       await expect(page.locator(`[data-testid="mix-plan-${today}"]`)).toHaveCount(0, {
  4368 |         timeout: 5_000,
  4369 |       });
  4370 |       await expect(page.locator('[data-testid="mix-plan-empty"]')).toBeVisible({
  4371 |         timeout: 5_000,
  4372 |       });
  4373 |       await expect(page.getByText(mixName1, { exact: false })).toHaveCount(0, {
  4374 |         timeout: 3_000,
  4375 |       });
  4376 |       await expect(page.getByText(mixName2, { exact: false })).toHaveCount(0, {
  4377 |         timeout: 3_000,
  4378 |       });
  4379 |     } finally {
  4380 |       await db.query("DELETE FROM mixes WHERE id = $1", [mixId1]).catch(() => {});
  4381 |       await db.query("DELETE FROM mixes WHERE id = $1", [mixId2]).catch(() => {});
  4382 |       await db.query("DELETE FROM daily_sync WHERE date = $1 AND scope = 'live'", [today]).catch(() => {});
  4383 |       await db.query("DELETE FROM users WHERE username = $1", [username]).catch(() => {});
  4384 |     }
  4385 |   });
  4386 | 
  4387 |   /**
  4388 |    * Test (m): Batch count on a regular mix card updates live when 'already made'
  4389 |    * is edited — Task #798.
  4390 |    *
  4391 |    * Mechanism: onBlur → saveMixes → onSaved → cycleCountQc.setQueryData(["mixes"],
  4392 |    * saved) → buildMixPlan re-runs → m.batches = remainingLbs / batchSize
  4393 |    * re-derives → the batch count span re-renders immediately without reload.
  4394 |    *
  4395 |    * Formula (lib/mixes/src/index.ts, computeEntry):
  4396 |    *   componentLbs  = (2.0/16) × 800           = 100.00
  4397 |    *   wasteLbs      = 100.00 × 0.15             =  15.00
  4398 |    *   startupLbs    = 20
  4399 |    *   totalLbs      = 100.00 + 15.00 + 20       = 135.00
  4400 |    *
  4401 |    *   initial  (amountAlreadyMade = 0  ): batches = 135.00 / 10 = 13.50
  4402 |    *   partial  (amountAlreadyMade = 50 ): batches =  85.00 / 10 =  8.50
  4403 |    *   full     (amountAlreadyMade = 135): batches =   0.00 / 10 =  0.00
  4404 |    */
  4405 |   test("batch count on a regular mix card updates live when 'already made' is edited", async ({
  4406 |     page,
  4407 |   }) => {
  4408 |     const suffix = uid();
  4409 |     const username = `user_${suffix}`;
  4410 |     const mixId = `batch-live-${suffix}`;
  4411 |     const mixName = `BatchLiveMix ${suffix}`;
  4412 |     const component = `BatchComp_${suffix}`;
  4413 |     const brand = `Brand_${suffix}`;
  4414 |     const today = todayStr();
  4415 | 
  4416 |     const BATCH_SIZE = 10;
  4417 |     const PER_PIZZA_OZ = 2.0;
  4418 |     const CASES_NEEDED = 100;
  4419 |     const PIZZAS_PER_CASE = 8;
  4420 |     const totalPizzas = CASES_NEEDED * PIZZAS_PER_CASE; // 800
  4421 | 
  4422 |     const MIX_WASTE_FACTOR = 0.15;
  4423 |     const STARTUP_LBS = 20;
  4424 |     const componentLbs = (PER_PIZZA_OZ / 16) * totalPizzas;               // 100.00
  4425 |     const totalLbs = componentLbs * (1 + MIX_WASTE_FACTOR) + STARTUP_LBS; // 135.00
  4426 | 
```