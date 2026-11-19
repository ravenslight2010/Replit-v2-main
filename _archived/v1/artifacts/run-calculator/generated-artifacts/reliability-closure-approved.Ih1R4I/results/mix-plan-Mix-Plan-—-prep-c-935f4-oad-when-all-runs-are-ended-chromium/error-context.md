# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: mix-plan.spec.ts >> Mix Plan — prep card suppression and ended-run removal >> empty state is preserved after a page reload when all runs are ended
- Location: e2e/mix-plan.spec.ts:4120:3

# Error details

```
Error: locator.waitFor: Error: strict mode violation: getByRole('button', { name: /prev/i }) resolved to 2 elements:
    1) <button type="button" aria-expanded="false" data-component-name="button" aria-controls="app-update-details" data-testid="button-app-update-details" class="min-h-10 rounded px-2 text-left text-sm font-semibold hover:bg-muted/60" data-replit-metadata="artifacts/run-calculator/src/components/AppUpdateControl.tsx:50:8">App updates · Development preview</button> aka getByTestId('button-app-update-details')
    2) <button type="button" class="flex items-center gap-1 px-2 py-1 rounded-md text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors min-w-0">…</button> aka getByRole('button', { name: 'Prev ReloadEndedBrandA_e2emp8v2m4v0' })

Call log:
  - waiting for getByRole('button', { name: /prev/i }) to be visible

```

# Test source

```ts
  4093 |     } finally {
  4094 |       await db.query("DELETE FROM mixes WHERE id = $1", [mixId]).catch(() => {});
  4095 |       await db.query("DELETE FROM users WHERE username = $1", [username]).catch(() => {});
  4096 |     }
  4097 |   });
  4098 | 
  4099 |   /**
  4100 |    * Test (k): Empty state is preserved after a full page reload when all runs
  4101 |    * are ended — exercises the localStorage + React hydration path separately
  4102 |    * from the in-memory state path.
  4103 |    *
  4104 |    * Mechanism: liveRunsForMixes (home.tsx ~14462) re-derives its list from
  4105 |    * dayState.runs on every render. loadDayState() on mount reads the persisted
  4106 |    * day state from localStorage, which carries endedAt on every run. If the
  4107 |    * filter regresses on the hydration path (e.g. endedAt is lost during
  4108 |    * serialisation), the plan would wrongly re-appear after reload even though
  4109 |    * it was empty in the same browser session.
  4110 |    *
  4111 |    * This test shares the same two-run stop sequence as test (j) and then adds
  4112 |    * a full page reload before the final empty-state assertion.
  4113 |    */
  4114 | 
  4115 |   /**
  4116 |    * Test (l): Empty state is preserved after a full page reload when all runs
  4117 |    * are ended — exercises the localStorage + React hydration path separately
  4118 |    * from the in-memory state path.
  4119 |    */
  4120 |   test("empty state is preserved after a page reload when all runs are ended", async ({
  4121 |     page,
  4122 |   }) => {
  4123 |     // This two-run start/stop/reload journey can exceed the suite's 60-second
  4124 |     // default under full-run load; keep a bounded, case-local budget.
  4125 |     test.setTimeout(90_000);
  4126 |     const suffix = uid();
  4127 |     const username = `user_${suffix}`;
  4128 |     const mixId1 = `reload-ended-mix-a-${suffix}`;
  4129 |     const mixId2 = `reload-ended-mix-b-${suffix}`;
  4130 |     const mixName1 = `ReloadEndedMixA ${suffix}`;
  4131 |     const mixName2 = `ReloadEndedMixB ${suffix}`;
  4132 |     const component1 = `ReloadEndedCompA_${suffix}`;
  4133 |     const component2 = `ReloadEndedCompB_${suffix}`;
  4134 |     const brand1 = `ReloadEndedBrandA_${suffix}`;
  4135 |     const brand2 = `ReloadEndedBrandB_${suffix}`;
  4136 |     const today = todayStr();
  4137 |     const runId1 = `reload-ended-run-a-${suffix}`;
  4138 |     const runId2 = `reload-ended-run-b-${suffix}`;
  4139 | 
  4140 |     try {
  4141 |       await dbCreateMix(db, {
  4142 |         id: mixId1,
  4143 |         name: mixName1,
  4144 |         brand: brand1,
  4145 |         isPrep: false,
  4146 |         component: component1,
  4147 |         perPizza: 2.0,
  4148 |         batchSize: 10,
  4149 |       });
  4150 |       await dbCreateMix(db, {
  4151 |         id: mixId2,
  4152 |         name: mixName2,
  4153 |         brand: brand2,
  4154 |         isPrep: false,
  4155 |         component: component2,
  4156 |         perPizza: 2.0,
  4157 |         batchSize: 10,
  4158 |       });
  4159 | 
  4160 |       await signUpAndDismissOnboarding(page, username, "TestPass123!");
  4161 |       await seedLiveRunsAfterAppLoad(page, [
  4162 |         {
  4163 |           runId: runId1,
  4164 |           brand: brand1,
  4165 |           ingredient: component1,
  4166 |           runOz: 2,
  4167 |           casesNeeded: 1,
  4168 |           pizzasPerCase: 8,
  4169 |           casesPerLayer: 0,
  4170 |         },
  4171 |         {
  4172 |           runId: runId2,
  4173 |           brand: brand2,
  4174 |           ingredient: component2,
  4175 |           runOz: 2,
  4176 |           casesNeeded: 1,
  4177 |           pizzasPerCase: 8,
  4178 |           casesPerLayer: 0,
  4179 |         },
  4180 |       ], 1);
  4181 | 
  4182 |       // Both cards visible before any run is stopped
  4183 |       await goToMixes(page);
  4184 |       await page.waitForTimeout(500);
  4185 |       const todayCard = page.locator(`[data-testid="mix-plan-${today}"]`);
  4186 |       await todayCard.waitFor({ state: "visible", timeout: 8_000 });
  4187 |       await expect(todayCard.getByText(mixName1, { exact: false })).toBeVisible({ timeout: 5_000 });
  4188 |       await expect(todayCard.getByText(mixName2, { exact: false })).toBeVisible({ timeout: 5_000 });
  4189 | 
  4190 |       // Switch to run 1 via Prev, start + stop it
  4191 |       await page.locator('[data-testid="tab-run"]').click();
  4192 |       const prevBtn = page.getByRole("button", { name: /prev/i });
> 4193 |       await prevBtn.waitFor({ state: "visible", timeout: 8_000 });
       |                     ^ Error: locator.waitFor: Error: strict mode violation: getByRole('button', { name: /prev/i }) resolved to 2 elements:
  4194 |       await prevBtn.click();
  4195 |       await page.waitForTimeout(600);
  4196 | 
  4197 |       const startBtn1 = page.locator('[data-testid="button-start-run"]');
  4198 |       await startBtn1.waitFor({ state: "visible", timeout: 8_000 });
  4199 |       await startBtn1.click();
  4200 |       await waitForLocalRunStarted(page, runId1);
  4201 |       await waitForCanonicalRunField(runId1, "startedAt");
  4202 | 
  4203 |       // Starting the next run is the supported transition between runs: it
  4204 |       // auto-ends the active run, avoiding a second START during the first
  4205 |       // stop's foreground-adoption fence.
  4206 |       const nextBtn = page.getByRole("button", { name: /next/i });
  4207 |       await nextBtn.waitFor({ state: "visible", timeout: 8_000 });
  4208 |       await nextBtn.click();
  4209 |       await waitForCurrentRun(page, runId2);
  4210 | 
  4211 |       const startBtn2 = page.locator('[data-testid="button-start-run"]');
  4212 |       await startBtn2.waitFor({ state: "visible", timeout: 8_000 });
  4213 |       await startBtn2.click();
  4214 |       await waitForLocalRunStarted(page, runId2);
  4215 |       await waitForCanonicalRunField(runId2, "startedAt");
  4216 |       await waitForLocalRunEnded(page, runId1);
  4217 |       await waitForCanonicalRunField(runId1, "endedAt");
  4218 | 
  4219 |       const stopBtn2 = page.getByRole("button", { name: /stop run/i });
  4220 |       await stopBtn2.waitFor({ state: "visible", timeout: 10_000 });
  4221 |       await stopBtn2.click();
  4222 |       await waitForLocalRunEnded(page, runId2);
  4223 |       await waitForCanonicalRunField(runId2, "endedAt");
  4224 | 
  4225 |       // ── Full page reload ──────────────────────────────────────────────────────
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
```