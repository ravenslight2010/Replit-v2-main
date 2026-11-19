# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: mix-plan.spec.ts >> Mix Plan — prep card suppression and ended-run removal >> mix plan collapses to empty when all runs in a shift are ended
- Location: e2e/mix-plan.spec.ts:3217:3

# Error details

```
Error: locator.waitFor: Error: strict mode violation: getByRole('button', { name: /prev/i }) resolved to 2 elements:
    1) <button type="button" aria-expanded="false" data-component-name="button" aria-controls="app-update-details" data-testid="button-app-update-details" class="min-h-10 rounded px-2 text-left text-sm font-semibold hover:bg-muted/60" data-replit-metadata="artifacts/run-calculator/src/components/AppUpdateControl.tsx:50:8">App updates · Development preview</button> aka getByTestId('button-app-update-details')
    2) <button type="button" class="flex items-center gap-1 px-2 py-1 rounded-md text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors min-w-0">…</button> aka getByRole('button', { name: 'Prev AllEndedBrandA_e2emp3wnfh1g' })

Call log:
  - waiting for getByRole('button', { name: /prev/i }) to be visible

```

# Test source

```ts
  3202 |       } else {
  3203 |         await db
  3204 |           .query("DELETE FROM daily_sync WHERE date = $1 AND scope = 'live'", [runDateStr])
  3205 |           .catch(() => {});
  3206 |       }
  3207 |       await db.query("DELETE FROM users WHERE username = $1", [username]).catch(() => {});
  3208 |     }
  3209 |   });
  3210 | 
  3211 |   /**
  3212 |    * Test (j): Mix plan collapses to empty when ALL runs in a shift are ended.
  3213 |    *
  3214 |    * After both runs are stopped, liveRunsForMixes returns [] so buildMixPlan
  3215 |    * returns [] — the plan collapses and the empty-state message appears.
  3216 |    */
  3217 |   test("mix plan collapses to empty when all runs in a shift are ended", async ({
  3218 |     page,
  3219 |   }) => {
  3220 |     // This journey intentionally starts and finishes two live runs. On the
  3221 |     // proxied release preview, the sync/authentication round-trips can put
  3222 |     // the final navigation just over the suite's 60-second default; keep the
  3223 |     // assertion bounded without weakening any individual wait.
  3224 |     test.setTimeout(90_000);
  3225 | 
  3226 |     const suffix = uid();
  3227 |     const username = `user_${suffix}`;
  3228 |     const mixId1 = `all-ended-mix-a-${suffix}`;
  3229 |     const mixId2 = `all-ended-mix-b-${suffix}`;
  3230 |     const mixName1 = `AllEndedMixA ${suffix}`;
  3231 |     const mixName2 = `AllEndedMixB ${suffix}`;
  3232 |     const component1 = `AllEndedCompA_${suffix}`;
  3233 |     const component2 = `AllEndedCompB_${suffix}`;
  3234 |     const brand1 = `AllEndedBrandA_${suffix}`;
  3235 |     const brand2 = `AllEndedBrandB_${suffix}`;
  3236 |     const today = todayStr();
  3237 | 
  3238 |     try {
  3239 |       await dbCreateMix(db, {
  3240 |         id: mixId1,
  3241 |         name: mixName1,
  3242 |         brand: brand1,
  3243 |         isPrep: false,
  3244 |         component: component1,
  3245 |         perPizza: 2.0,
  3246 |         batchSize: 10,
  3247 |       });
  3248 |       await dbCreateMix(db, {
  3249 |         id: mixId2,
  3250 |         name: mixName2,
  3251 |         brand: brand2,
  3252 |         isPrep: false,
  3253 |         component: component2,
  3254 |         perPizza: 2.0,
  3255 |         batchSize: 10,
  3256 |       });
  3257 | 
  3258 |       await signUpAndDismissOnboarding(page, username, "TestPass123!");
  3259 |       await page.waitForTimeout(1_000);
  3260 | 
  3261 |       // Set brand on run 1
  3262 |       await page.locator('[data-testid="tab-run"]').click();
  3263 |       const brandInput = page.locator('input[placeholder="Brand…"]').first();
  3264 |       await brandInput.waitFor({ state: "visible", timeout: 10_000 });
  3265 |       await brandInput.click();
  3266 |       await brandInput.fill(brand1);
  3267 |       await brandInput.press("Enter");
  3268 |       await page.waitForTimeout(800);
  3269 |       const runId1 = await page.evaluate(() => {
  3270 |         const day = JSON.parse(localStorage.getItem("run-calc-day") ?? "{}") as {
  3271 |           runs?: Array<{ id?: string }>;
  3272 |           currentIndex?: number;
  3273 |         };
  3274 |         return day.runs?.[day.currentIndex ?? 0]?.id ?? "";
  3275 |       });
  3276 |       expect(runId1).toBeTruthy();
  3277 | 
  3278 |       // Add run 2 and set brand2
  3279 |       const newRunBtn = page.getByRole("button", { name: /new run/i });
  3280 |       await newRunBtn.waitFor({ state: "visible", timeout: 8_000 });
  3281 |       await newRunBtn.click();
  3282 |       await page.waitForTimeout(800);
  3283 | 
  3284 |       const brandInput2 = page.locator('input[placeholder="Brand…"]').first();
  3285 |       await brandInput2.waitFor({ state: "visible", timeout: 10_000 });
  3286 |       await brandInput2.click();
  3287 |       await brandInput2.fill(brand2);
  3288 |       await brandInput2.press("Enter");
  3289 |       await page.waitForTimeout(800);
  3290 | 
  3291 |       // Both cards visible
  3292 |       await goToMixes(page);
  3293 |       await page.waitForTimeout(500);
  3294 |       const todayCard = page.locator(`[data-testid="mix-plan-${today}"]`);
  3295 |       await todayCard.waitFor({ state: "visible", timeout: 8_000 });
  3296 |       await expect(todayCard.getByText(mixName1, { exact: false })).toBeVisible({ timeout: 5_000 });
  3297 |       await expect(todayCard.getByText(mixName2, { exact: false })).toBeVisible({ timeout: 5_000 });
  3298 | 
  3299 |       // Switch to run 1 via Prev, start + stop it
  3300 |       await page.locator('[data-testid="tab-run"]').click();
  3301 |       const prevBtn = page.getByRole("button", { name: /prev/i });
> 3302 |       await prevBtn.waitFor({ state: "visible", timeout: 8_000 });
       |                     ^ Error: locator.waitFor: Error: strict mode violation: getByRole('button', { name: /prev/i }) resolved to 2 elements:
  3303 |       await prevBtn.click();
  3304 |       await waitForCurrentRun(page, runId1);
  3305 | 
  3306 |       const startBtn1 = page.locator('[data-testid="button-start-run"]');
  3307 |       await startBtn1.waitFor({ state: "visible", timeout: 8_000 });
  3308 |       await startBtn1.click();
  3309 | 
  3310 |       const stopBtn1 = page.getByRole("button", { name: /stop run/i });
  3311 |       await stopBtn1.waitFor({ state: "visible", timeout: 10_000 });
  3312 |       await expect(page.getByText("Synchronized", { exact: true })).toBeVisible({
  3313 |         timeout: 15_000,
  3314 |       });
  3315 |       await stopBtn1.click();
  3316 |       await page.waitForTimeout(800);
  3317 | 
  3318 |       // After stopping run 1: date-group card still present (run 2 active)
  3319 |       await goToMixes(page);
  3320 |       await page.waitForTimeout(500);
  3321 |       await expect(page.locator(`[data-testid="mix-plan-${today}"]`)).toBeVisible({ timeout: 5_000 });
  3322 | 
  3323 |       // Stopping run 1 advances selection to the remaining run. Older builds
  3324 |       // kept run 1 selected, so only use Next when that legacy state remains.
  3325 |       await page.locator('[data-testid="tab-run"]').click();
  3326 |       const nextBtn = page.getByRole("button", { name: /next/i });
  3327 |       if (await nextBtn.isVisible().catch(() => false)) {
  3328 |         await nextBtn.click();
  3329 |         await page.waitForTimeout(600);
  3330 |       }
  3331 | 
  3332 |       const startBtn2 = page.locator('[data-testid="button-start-run"]');
  3333 |       await startBtn2.waitFor({ state: "visible", timeout: 8_000 });
  3334 |       await startBtn2.click();
  3335 |       const run2Id = await page.evaluate(() => {
  3336 |         const day = JSON.parse(localStorage.getItem("run-calc-day") ?? "{}") as {
  3337 |           runs?: Array<{ id?: string }>;
  3338 |           currentIndex?: number;
  3339 |         };
  3340 |         return day.runs?.[day.currentIndex ?? 0]?.id ?? "";
  3341 |       });
  3342 | 
  3343 |       const stopBtn2 = page.getByRole("button", { name: /stop run/i });
  3344 |       await stopBtn2.waitFor({ state: "visible", timeout: 10_000 });
  3345 |       await expect(page.getByText("Synchronized", { exact: true })).toBeVisible({
  3346 |         timeout: 15_000,
  3347 |       });
  3348 |       await stopBtn2.click();
  3349 |       await waitForLocalRunEnded(page, run2Id);
  3350 |       await waitForCanonicalRunField(run2Id, "endedAt");
  3351 |       await expect(page.getByText("Synchronized", { exact: true })).toBeVisible({
  3352 |         timeout: 15_000,
  3353 |       });
  3354 | 
  3355 |       // Both runs ended → plan must be empty
  3356 |       await goToMixes(page);
  3357 |       await page.waitForTimeout(500);
  3358 | 
  3359 |       await expect(
  3360 |         page.locator(`[data-testid="mix-plan-${today}"]`),
  3361 |       ).toHaveCount(0, { timeout: 5_000 });
  3362 |       await expect(
  3363 |         page.locator('[data-testid="mix-plan-empty"]'),
  3364 |       ).toBeVisible({ timeout: 5_000 });
  3365 |       await expect(page.getByText(mixName1, { exact: false })).toHaveCount(0, { timeout: 3_000 });
  3366 |       await expect(page.getByText(mixName2, { exact: false })).toHaveCount(0, { timeout: 3_000 });
  3367 |     } finally {
  3368 |       await db.query("DELETE FROM mixes WHERE id = $1", [mixId1]).catch(() => {});
  3369 |       await db.query("DELETE FROM mixes WHERE id = $1", [mixId2]).catch(() => {});
  3370 |       await db.query("DELETE FROM users WHERE username = $1", [username]).catch(() => {});
  3371 |     }
  3372 |   });
  3373 | 
  3374 |   /**
  3375 |    * Test (k): "Already made" value persists after a page reload.
  3376 |    *
  3377 |    * Verifies that the onBlur → POST /api/mixes path actually writes to the
  3378 |    * server (not just the React Query cache), so a hard reload re-fetches the
  3379 |    * updated value and the Pull For Prep lbs remain reduced accordingly.
  3380 |    *
  3381 |    * Formula (same as test f):
  3382 |    *   componentLbs  = (2.0/16) × 800  = 100.00
  3383 |    *   totalLbs      = 100.00 × 1.15 + 20 = 135.00
  3384 |    *   remainingLbs  = 135.00 − 50        =  85.00
  3385 |    *   pullLbs       = 100.00 × 85.00 / 135.00 ≈ 62.96
  3386 |    */
  3387 |   test("'already made' value persists after a page reload (saved to server)", async ({
  3388 |     page,
  3389 |   }) => {
  3390 |     const suffix = uid();
  3391 |     const username = `user_${suffix}`;
  3392 |     const mixId = `persist-reload-${suffix}`;
  3393 |     const mixName = `PersistReloadPrepMix ${suffix}`;
  3394 |     const ingredient = `PersistHerb_${suffix}`;
  3395 |     const brand = `Brand_${suffix}`;
  3396 |     const today = todayStr();
  3397 | 
  3398 |     const RUN_OZ = 2.0;
  3399 |     const CASES_NEEDED = 100;
  3400 |     const PIZZAS_PER_CASE = 8;
  3401 |     const totalPizzas = CASES_NEEDED * PIZZAS_PER_CASE; // 800
  3402 |     const MIX_WASTE_FACTOR = 0.15;
```