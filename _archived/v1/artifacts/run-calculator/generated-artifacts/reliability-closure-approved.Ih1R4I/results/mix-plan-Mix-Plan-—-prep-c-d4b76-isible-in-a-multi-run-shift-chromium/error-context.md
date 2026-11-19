# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: mix-plan.spec.ts >> Mix Plan — prep card suppression and ended-run removal >> ending one run keeps the other run's mix card visible in a multi-run shift
- Location: e2e/mix-plan.spec.ts:625:3

# Error details

```
Error: locator.waitFor: Error: strict mode violation: getByRole('button', { name: /prev/i }) resolved to 2 elements:
    1) <button type="button" aria-expanded="false" data-component-name="button" aria-controls="app-update-details" data-testid="button-app-update-details" class="min-h-10 rounded px-2 text-left text-sm font-semibold hover:bg-muted/60" data-replit-metadata="artifacts/run-calculator/src/components/AppUpdateControl.tsx:50:8">App updates · Development preview</button> aka getByTestId('button-app-update-details')
    2) <button type="button" class="flex items-center gap-1 px-2 py-1 rounded-md text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors min-w-0">…</button> aka getByRole('button', { name: 'Prev BrandA_e2empc9hoi7w' })

Call log:
  - waiting for getByRole('button', { name: /prev/i }) to be visible

```

# Test source

```ts
  604 |         timeout: 5_000,
  605 |       });
  606 |       await expect(page.getByText(mixName, { exact: false })).toHaveCount(0, {
  607 |         timeout: 3_000,
  608 |       });
  609 |       // Other suites may leave unrelated factory-wide prep recipes in the
  610 |       // shared master-data pool. The invariant here is that this exact mix and
  611 |       // component are absent without a qualifying active run.
  612 |     } finally {
  613 |       await db.query("DELETE FROM mixes WHERE id = $1", [mixId]).catch(() => {});
  614 |       await db.query("DELETE FROM users WHERE username = $1", [username]).catch(() => {});
  615 |     }
  616 |   });
  617 | 
  618 |   /**
  619 |    * Test (c): Ending ONE run in a two-run shift keeps the OTHER run's mix card.
  620 |    *
  621 |    * Mechanism: liveRunsForMixes (home.tsx ~14462) filters dayState.runs by
  622 |    * `r.brand && !r.endedAt`. Once STOP RUN sets r.endedAt on run-1, run-2
  623 |    * (still active) keeps its mix card visible.
  624 |    */
  625 |   test("ending one run keeps the other run's mix card visible in a multi-run shift", async ({
  626 |     page,
  627 |   }) => {
  628 |     const suffix = uid();
  629 |     const username = `user_${suffix}`;
  630 |     const mixId1 = `run-mix-a-${suffix}`;
  631 |     const mixId2 = `run-mix-b-${suffix}`;
  632 |     const mixName1 = `RunMixA ${suffix}`;
  633 |     const mixName2 = `RunMixB ${suffix}`;
  634 |     const component1 = `CompA_${suffix}`;
  635 |     const component2 = `CompB_${suffix}`;
  636 |     const brand1 = `BrandA_${suffix}`;
  637 |     const brand2 = `BrandB_${suffix}`;
  638 |     const today = todayStr();
  639 |     const runId1 = `run-a-${suffix}`;
  640 |     const runId2 = `run-b-${suffix}`;
  641 | 
  642 |     try {
  643 |       // Create two mixes — one per brand — so each run's active status drives its
  644 |       // own mix card independently.
  645 |       await dbCreateMix(db, {
  646 |         id: mixId1,
  647 |         name: mixName1,
  648 |         brand: brand1,
  649 |         isPrep: false,
  650 |         component: component1,
  651 |         perPizza: 2.0,
  652 |         batchSize: 10,
  653 |       });
  654 |       await dbCreateMix(db, {
  655 |         id: mixId2,
  656 |         name: mixName2,
  657 |         brand: brand2,
  658 |         isPrep: false,
  659 |         component: component2,
  660 |         perPizza: 2.0,
  661 |         batchSize: 10,
  662 |       });
  663 | 
  664 |       // Seed both branded runs and their durable values before app hydration.
  665 |       // signUpAndDismissOnboarding materializes the same fixture into the
  666 |       // canonical daily row before the post-auth reload.
  667 |       await seedLiveRunsBeforeAppLoad(page, [
  668 |         {
  669 |           runId: runId1,
  670 |           brand: brand1,
  671 |           ingredient: component1,
  672 |           runOz: 2,
  673 |           casesNeeded: 1,
  674 |           pizzasPerCase: 8,
  675 |           casesPerLayer: 0,
  676 |         },
  677 |         {
  678 |           runId: runId2,
  679 |           brand: brand2,
  680 |           ingredient: component2,
  681 |           runOz: 2,
  682 |           casesNeeded: 1,
  683 |           pizzasPerCase: 8,
  684 |           casesPerLayer: 0,
  685 |         },
  686 |       ], 1);
  687 |       await signUpAndDismissOnboarding(page, username, "TestPass123!");
  688 |       // The auth form transitions to "/" without a document reload. Re-enter
  689 |       // the app route so the init-script seed is read before React hydration.
  690 |       await page.goto("/", { waitUntil: "domcontentloaded" });
  691 |       await page.locator('[data-testid="tab-run"]').waitFor({ state: "attached", timeout: 25_000 });
  692 | 
  693 |       // Both mix cards must appear on the Mixes tab
  694 |       await goToMixes(page);
  695 |       await page.waitForTimeout(500);
  696 |       const todayCard = page.locator(`[data-testid="mix-plan-${today}"]`);
  697 |       await todayCard.waitFor({ state: "visible", timeout: 20_000 });
  698 |       await expect(todayCard.getByText(mixName1, { exact: false })).toBeVisible({ timeout: 5_000 });
  699 |       await expect(todayCard.getByText(mixName2, { exact: false })).toBeVisible({ timeout: 5_000 });
  700 | 
  701 |       // Switch to run 1 via Prev and start it
  702 |       await page.locator('[data-testid="tab-run"]').click();
  703 |       const prevBtn = page.getByRole("button", { name: /prev/i });
> 704 |       await prevBtn.waitFor({ state: "visible", timeout: 8_000 });
      |                     ^ Error: locator.waitFor: Error: strict mode violation: getByRole('button', { name: /prev/i }) resolved to 2 elements:
  705 |       await prevBtn.click();
  706 |       await waitForCurrentRun(page, runId1);
  707 | 
  708 |       const startBtn = page.locator('[data-testid="button-start-run"]');
  709 |       await startBtn.waitFor({ state: "visible", timeout: 8_000 });
  710 |       await startBtn.click();
  711 | 
  712 |       // Stop run 1
  713 |       const stopBtn = page.getByRole("button", { name: /stop run/i });
  714 |       await stopBtn.waitFor({ state: "visible", timeout: 10_000 });
  715 |       // Starting a run first queues a canonical write. Wait for that write to
  716 |       // settle before stopping; otherwise endRun can correctly defer behind
  717 |       // the foreground sync barrier and the test may navigate away while the
  718 |       // stop is still only queued.
  719 |       await expect(page.getByText("Synchronized", { exact: true })).toBeVisible({
  720 |         timeout: 15_000,
  721 |       });
  722 |       await stopBtn.click();
  723 | 
  724 |       // endRun() advances to run 2, so the start control is the visible
  725 |       // transition signal. Also verify the actual persisted local lifecycle
  726 |       // field before checking the server-backed Mix Plan.
  727 |       await expect(startBtn).toBeVisible({ timeout: 15_000 });
  728 |       await expect.poll(
  729 |         () => page.evaluate((id) => {
  730 |           const day = JSON.parse(localStorage.getItem("run-calc-day") ?? "{}") as {
  731 |             runs?: Array<{ id?: string; endedAt?: number }>;
  732 |           };
  733 |           return day.runs?.find((run) => run.id === id)?.endedAt ?? null;
  734 |         }, runId1),
  735 |         { timeout: 15_000 },
  736 |       ).toBeTruthy();
  737 | 
  738 |       // Verify run-2's mix is still visible; run-1's mix is gone
  739 |       await goToMixes(page);
  740 |       await page.waitForTimeout(500);
  741 | 
  742 |       // The date-group card must still be present — run 2 is still active.
  743 |       await expect(
  744 |         page.locator(`[data-testid="mix-plan-${today}"]`),
  745 |       ).toBeVisible({ timeout: 5_000 });
  746 | 
  747 |       // Run-1 ended → its brand is excluded from liveRunsForMixes → mix gone.
  748 |       await expect(
  749 |         page.getByText(mixName1, { exact: false }),
  750 |       ).toHaveCount(0, { timeout: 5_000 });
  751 | 
  752 |       // Run-2 is still active → its mix must remain visible.
  753 |       await expect(
  754 |         page.locator(`[data-testid="mix-plan-${today}"]`).getByText(mixName2, {
  755 |           exact: false,
  756 |         }),
  757 |       ).toBeVisible({ timeout: 5_000 });
  758 |     } finally {
  759 |       await db.query("DELETE FROM mixes WHERE id = $1", [mixId1]).catch(() => {});
  760 |       await db.query("DELETE FROM mixes WHERE id = $1", [mixId2]).catch(() => {});
  761 |       await db.query("DELETE FROM daily_sync WHERE date = $1 AND scope = 'live'", [today]).catch(() => {});
  762 |       await db.query("DELETE FROM users WHERE username = $1", [username]).catch(() => {});
  763 |     }
  764 |   });
  765 | 
  766 |   /**
  767 |    * Test (b): Mix card disappears from the plan after the run is marked ended.
  768 |    *
  769 |    * Mechanism: liveRunsForMixes (home.tsx ~14462) filters dayState.runs by
  770 |    * `r.brand && !r.endedAt`. Once STOP RUN sets r.endedAt, the run is excluded
  771 |    * and buildMixPlan returns [] — the plan collapses to empty.
  772 |    */
  773 |   test("mix card disappears from the plan after the run is marked ended", async ({
  774 |     page,
  775 |   }) => {
  776 |     const suffix = uid();
  777 |     const username = `user_${suffix}`;
  778 |     const mixId = `run-mix-${suffix}`;
  779 |     const mixName = `RunMix ${suffix}`;
  780 |     const component = `Component_${suffix}`;
  781 |     const brand = `Brand_${suffix}`;
  782 |     const today = todayStr();
  783 | 
  784 |     try {
  785 |       // Create the mix with the SAME brand that we'll set on the run form.
  786 |       // buildMixPlan matches on exact productKey(brand, flavor), so brand must
  787 |       // agree — an empty-brand mix only matches empty-brand runs (which are
  788 |       // filtered out of liveRunsForMixes since they have no brand set).
  789 |       await dbCreateMix(db, {
  790 |         id: mixId,
  791 |         name: mixName,
  792 |         brand,
  793 |         isPrep: false,
  794 |         component,
  795 |         perPizza: 2.0,
  796 |         batchSize: 10,
  797 |       });
  798 | 
  799 |       // Sign up via browser and dismiss the onboarding dialog.
  800 |       await signUpAndDismissOnboarding(page, username, "TestPass123!");
  801 | 
  802 |       // Brief pause for startup async effects (useMixes fetch, etc.).
  803 |       await page.waitForTimeout(1_000);
  804 | 
```