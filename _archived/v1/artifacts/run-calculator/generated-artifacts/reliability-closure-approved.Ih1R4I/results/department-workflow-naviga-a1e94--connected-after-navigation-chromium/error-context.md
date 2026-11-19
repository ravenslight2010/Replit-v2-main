# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: department-workflow-navigation.spec.ts >> production, warehouse, QC, and management remain connected after navigation
- Location: e2e/department-workflow-navigation.spec.ts:150:1

# Error details

```
Test timeout of 60000ms exceeded.
```

```
Error: locator.click: Test timeout of 60000ms exceeded.
Call log:
  - waiting for getByRole('menuitem', { name: 'QC workflows & history' })

```

# Test source

```ts
  77  |   await page.evaluate(() => {
  78  |     const keys = Array.from({ length: localStorage.length }, (_, index) =>
  79  |       localStorage.key(index),
  80  |     );
  81  |     for (const key of keys) {
  82  |       if (key?.startsWith("run-calc-run-")) localStorage.removeItem(key);
  83  |     }
  84  |     localStorage.removeItem("run-calc-day");
  85  |   });
  86  |   await page.addInitScript((id: string) => {
  87  |     // Apply this only to the seed reload. Later reloads must preserve the
  88  |     // lifecycle written by Start Run and the department navigation checks.
  89  |     if (sessionStorage.getItem("department-pending-seed-applied") === "1") return;
  90  |     sessionStorage.setItem("department-pending-seed-applied", "1");
  91  |     localStorage.setItem(
  92  |       "run-calc-day",
  93  |       JSON.stringify({
  94  |         date: new Date().toISOString().slice(0, 10),
  95  |         runs: [{
  96  |           id,
  97  |           brand: "Department",
  98  |           flavor: "Navigation",
  99  |           casesNeeded: 1,
  100 |           seeded: false,
  101 |         }],
  102 |         currentIndex: 0,
  103 |         // Do not create a same-day reset boundary in the disposable fixture;
  104 |         // the app's normal reset scheduler owns that value.
  105 |         resetAt: 0,
  106 |       }),
  107 |     );
  108 |   }, runId);
  109 |   await page.reload({ waitUntil: "domcontentloaded" });
  110 |   await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
  111 |   await expect
  112 |     .poll(
  113 |       () =>
  114 |         page.evaluate((id) => {
  115 |           try {
  116 |             const day = JSON.parse(localStorage.getItem("run-calc-day") ?? "{}");
  117 |             const run = day.runs?.find((candidate: { id?: string }) => candidate.id === id);
  118 |             return {
  119 |               runId: run?.id ?? null,
  120 |               startedAt: run?.startedAt ?? null,
  121 |               endedAt: run?.endedAt ?? null,
  122 |             };
  123 |           } catch {
  124 |             return { runId: null, startedAt: null, endedAt: null };
  125 |           }
  126 |         }, runId),
  127 |       { timeout: 10_000 },
  128 |     )
  129 |     .toEqual({ runId, startedAt: null, endedAt: null });
  130 |   return runId;
  131 | }
  132 | 
  133 | async function openMore(page: Page): Promise<void> {
  134 |   const menu = page.getByRole("menu");
  135 |   if (await menu.isVisible().catch(() => false)) {
  136 |     await expect(menu).toBeHidden({ timeout: 5_000 });
  137 |   }
  138 |   await page.getByTitle("More").click();
  139 |   await expect(menu).toBeVisible();
  140 |   await page.waitForTimeout(300);
  141 | }
  142 | 
  143 | async function screenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  144 |   await page.screenshot({
  145 |     path: testInfo.outputPath(`${name}.png`),
  146 |     fullPage: true,
  147 |   });
  148 | }
  149 | 
  150 | test("production, warehouse, QC, and management remain connected after navigation", async ({
  151 |   page,
  152 | }, testInfo) => {
  153 |   const username = uid();
  154 |   testUsernames.add(username);
  155 |   await signUp(page, username);
  156 |   await promoteToManager(username);
  157 |   const runId = await seedPendingRun(page);
  158 | 
  159 |   await dismissOnboarding(page);
  160 |   await selectCanonicalFixtureRun(page, runId);
  161 |   await expect(page.getByTestId("button-start-run")).toBeVisible();
  162 |   await page.getByTestId("button-start-run").click();
  163 |   await expect(page.getByRole("button", { name: /pause run/i })).toBeVisible();
  164 |   await screenshot(page, testInfo, "01-production-running");
  165 | 
  166 |   // Warehouse is fed from the same active run and should identify this exact
  167 |   // run rather than showing an unrelated or empty day-state snapshot.
  168 |   await page.getByTestId("tab-warehouse").click();
  169 |   await expect(page.getByTestId(`warehouse-run-${runId}`)).toContainText(
  170 |     /Department[\s\S]*Navigation/,
  171 |   );
  172 |   await screenshot(page, testInfo, "02-warehouse-shared-run");
  173 | 
  174 |   // QC is manager/capability-gated. Reach it through the current QC workflows
  175 |   // menu entry and confirm the run-based surface is available.
  176 |   await openMore(page);
> 177 |   await page.getByRole("menuitem", { name: "QC workflows & history" }).click();
      |                                                                        ^ Error: locator.click: Test timeout of 60000ms exceeded.
  178 |   await expect(page.getByTestId("qc-workflow-tab")).toBeVisible();
  179 |   await expect(page.getByRole("heading", { name: "Quality checks" })).toBeVisible();
  180 |   await screenshot(page, testInfo, "03-qc-history");
  181 | 
  182 |   // Change an account-level manager setting through the actual management
  183 |   // menu, then verify it survives a full reload. This does not touch run or
  184 |   // shared factory data.
  185 |   await openMore(page);
  186 |   await page.getByRole("menuitem", { name: "Alerts & Floor Mode" }).click();
  187 |   const floorMode = page.getByTestId("switch-floor-mode");
  188 |   await expect(floorMode).toBeVisible();
  189 |   const before = await floorMode.isChecked();
  190 |   await floorMode.click();
  191 |   await expect(floorMode).toBeChecked({ checked: !before });
  192 |   await page.keyboard.press("Escape");
  193 | 
  194 |   await page.reload({ waitUntil: "domcontentloaded" });
  195 |   await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
  196 |   await expect(page.getByTestId("qc-workflow-tab")).toBeVisible();
  197 |   await openMore(page);
  198 |   await page.getByRole("menuitem", { name: "Alerts & Floor Mode" }).click();
  199 |   await expect(page.getByTestId("switch-floor-mode")).toBeChecked({ checked: !before });
  200 |   await screenshot(page, testInfo, "04-manager-setting-after-reload");
  201 | 
  202 |   // The live-run provider is still mounted and the same run remains active
  203 |   // after the department navigation and reload.
  204 |   await page.keyboard.press("Escape");
  205 |   await page.getByTestId("tab-run").click();
  206 |   await expect(page.getByRole("button", { name: /pause run/i })).toBeVisible();
  207 |   await screenshot(page, testInfo, "05-production-after-reload");
  208 | });
  209 | 
  210 | test("manager can open the Dough recipe editor without an uncaught page error", async ({
  211 |   page,
  212 | }, testInfo) => {
  213 |   const username = uid();
  214 |   const pageErrors: string[] = [];
  215 |   page.on("pageerror", (error) => pageErrors.push(error.message));
  216 |   testUsernames.add(username);
  217 | 
  218 |   await signUp(page, username);
  219 |   await promoteToManager(username);
  220 |   await page.reload({ waitUntil: "domcontentloaded" });
  221 |   await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
  222 |   await dismissOnboarding(page);
  223 | 
  224 |   await openMore(page);
  225 |   await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
  226 |   const settings = page.getByRole("dialog", { name: "Manage Lists & Settings" });
  227 |   await expect(settings).toBeVisible();
  228 |   await settings.getByRole("button", { name: "Recipes", exact: true }).click();
  229 | 
  230 |   const doughEditor = settings.getByTestId("dough-recipe-editor");
  231 |   await expect(doughEditor).toBeVisible();
  232 |   await expect(doughEditor.getByRole("button", { name: "Add Dough Recipe" })).toBeVisible();
  233 |   expect(pageErrors).toEqual([]);
  234 |   await screenshot(page, testInfo, "manager-dough-recipes");
  235 | });
```