# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: mix-plan.spec.ts >> Mix Plan — prep card suppression and ended-run removal >> Pull For Prep includes a second run added while Mixes is open
- Location: e2e/mix-plan.spec.ts:1038:3

# Error details

```
Error: locator.click: Error: strict mode violation: getByRole('button', { name: /prev/i }) resolved to 2 elements:
    1) <button type="button" aria-expanded="false" data-component-name="button" aria-controls="app-update-details" data-testid="button-app-update-details" class="min-h-10 rounded px-2 text-left text-sm font-semibold hover:bg-muted/60" data-replit-metadata="artifacts/run-calculator/src/components/AppUpdateControl.tsx:50:8">App updates · Development preview</button> aka getByTestId('button-app-update-details')
    2) <button type="button" class="flex items-center gap-1 px-2 py-1 rounded-md text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors min-w-0">…</button> aka getByRole('button', { name: 'Prev LiveAddBrandA_e2emph16xzbs' })

Call log:
  - waiting for getByRole('button', { name: /prev/i })

```

# Test source

```ts
  1005 | 
  1006 |       const todayCard = page.locator(`[data-testid="mix-plan-${today}"]`);
  1007 |       await todayCard.waitFor({ state: "visible", timeout: 20_000 });
  1008 | 
  1009 |       await expect(todayCard.getByText("Ingredient Prep", { exact: false })).toBeVisible({ timeout: 5_000 });
  1010 |       await expect(todayCard.getByText(mixName, { exact: false })).toBeVisible({ timeout: 5_000 });
  1011 |       await expect(todayCard.getByText("Pull For Prep", { exact: false })).toBeVisible({ timeout: 5_000 });
  1012 |       await expect(todayCard.getByText(ingredient, { exact: false })).toBeVisible({ timeout: 5_000 });
  1013 | 
  1014 |       const ingredientRow = todayCard
  1015 |         .locator("div", { has: page.getByText(ingredient, { exact: true }) })
  1016 |         .last();
  1017 |       const rowText = await ingredientRow.innerText();
  1018 | 
  1019 |       const expectedStr = expectedPullLbs.toFixed(2); // "100.00"
  1020 |       const wrongFallbackStr = ((MIX_CARD_OZ / 16) * totalPizzasForSauce).toFixed(2); // "25.00"
  1021 | 
  1022 |       expect(rowText).toContain(expectedStr);
  1023 |       expect(rowText).not.toContain(wrongFallbackStr);
  1024 |     } finally {
  1025 |       await db.query("DELETE FROM mixes WHERE id = $1", [mixId]).catch(() => {});
  1026 |       await db.query("DELETE FROM users WHERE username = $1", [username]).catch(() => {});
  1027 |     }
  1028 |   });
  1029 | 
  1030 |   /**
  1031 |    * Test (d2): Pull For Prep updates when a second run is added while Mixes is
  1032 |    * already open.
  1033 |    *
  1034 |    * The first run contributes 100 lbs. The second run is created through the
  1035 |    * Run tab after the Mixes plan is visible and contributes another 25 lbs.
  1036 |    * Returning to Mixes must use the new live day-state run without a reload.
  1037 |    */
  1038 |   test("Pull For Prep includes a second run added while Mixes is open", async ({
  1039 |     page,
  1040 |   }) => {
  1041 |     const suffix = uid();
  1042 |     const username = `user_${suffix}`;
  1043 |     const mixId = `prep-live-add-${suffix}`;
  1044 |     const mixName = `LiveAddPrepMix ${suffix}`;
  1045 |     const ingredient = `LiveAddHerb_${suffix}`;
  1046 |     const brand1 = `LiveAddBrandA_${suffix}`;
  1047 |     const brand2 = `LiveAddBrandB_${suffix}`;
  1048 |     const today = todayStr();
  1049 | 
  1050 |     const firstPullLbs = (2 / 16) * 100 * 8; // 100.00
  1051 |     const secondPullLbs = (1 / 16) * 25 * 8; // 12.50
  1052 |     const combinedPullLbs = firstPullLbs + secondPullLbs; // 112.50
  1053 | 
  1054 |     try {
  1055 |       await dbCreateMix(db, {
  1056 |         id: mixId,
  1057 |         name: mixName,
  1058 |         isPrep: true,
  1059 |         component: ingredient,
  1060 |         perPizza: 0.5,
  1061 |       });
  1062 | 
  1063 |       await seedLiveRunBeforeAppLoad(page, {
  1064 |         runId: `prep-live-add-run-${suffix}`,
  1065 |         brand: brand1,
  1066 |         ingredient,
  1067 |         runOz: 2,
  1068 |         casesNeeded: 100,
  1069 |         pizzasPerCase: 8,
  1070 |         casesPerLayer: 0,
  1071 |       });
  1072 |       await signUpAndDismissOnboarding(page, username, "TestPass123!");
  1073 |       await makeTestUserManager(username);
  1074 |       await page.goto("/", { waitUntil: "domcontentloaded" });
  1075 |       await page.locator('[data-testid="tab-run"]').waitFor({ state: "attached", timeout: 25_000 });
  1076 |       await page.waitForTimeout(1_000);
  1077 | 
  1078 |       await goToMixes(page);
  1079 |       const todayCard = page.locator(`[data-testid="mix-plan-${today}"]`);
  1080 |       await todayCard.waitFor({ state: "visible", timeout: 20_000 });
  1081 |       await expect(todayCard.getByText(mixName, { exact: false })).toBeVisible();
  1082 |       await expect(todayCard.getByText("Pull For Prep", { exact: false })).toBeVisible();
  1083 |       const ingredientRow = todayCard
  1084 |         .locator("div", { has: page.getByText(ingredient, { exact: true }) })
  1085 |         .last();
  1086 |       await expect(ingredientRow).toContainText(firstPullLbs.toFixed(2));
  1087 | 
  1088 |       // Add and configure run 2 from the Run tab while preserving the mounted
  1089 |       // page (no reload between the two Mixes assertions).
  1090 |       await page.locator('[data-testid="tab-run"]').click();
  1091 |       const newRunBtn = page.getByRole("button", { name: /new run/i });
  1092 |       await newRunBtn.waitFor({ state: "visible", timeout: 8_000 });
  1093 |       await newRunBtn.click();
  1094 |       await page.waitForTimeout(600);
  1095 | 
  1096 |       const brandInput = page.locator('input[placeholder="Brand…"]').first();
  1097 |       await brandInput.waitFor({ state: "visible", timeout: 10_000 });
  1098 |       await brandInput.click();
  1099 |       await brandInput.fill(brand2);
  1100 |       await brandInput.press("Enter");
  1101 | 
  1102 |       // Leave the new run first: switching away saves the live form, so doing
  1103 |       // this in the opposite order would overwrite the direct fixture values
  1104 |       // with the compact form's defaults.
> 1105 |       await page.getByRole("button", { name: /prev/i }).click();
       |                                                         ^ Error: locator.click: Error: strict mode violation: getByRole('button', { name: /prev/i }) resolved to 2 elements:
  1106 |       await page.waitForTimeout(300);
  1107 | 
  1108 |       // The Run tab's compact view does not render the applicator editor.
  1109 |       // Persist the new run's ingredient fields, then switch back so the
  1110 |       // normal run-switch path hydrates them into the open form.
  1111 |       await page.evaluate(({ ingredient }) => {
  1112 |         const dayKey = "run-calc-day";
  1113 |         const rawDay = localStorage.getItem(dayKey);
  1114 |         if (!rawDay) return;
  1115 |         const day = JSON.parse(rawDay) as { runs?: Array<{ id: string }> };
  1116 |         const run = day.runs?.[day.runs.length - 1];
  1117 |         if (!run) return;
  1118 |         localStorage.setItem(`run-calc-run-${run.id}`, JSON.stringify({
  1119 |           pep1Type: ingredient,
  1120 |           pep1OzPerPizza: 1,
  1121 |           casesNeeded: 25,
  1122 |           pizzasPerCase: 8,
  1123 |           casesPerLayer: 0,
  1124 |         }));
  1125 |       }, { ingredient });
  1126 |       await stampLocalFixtureForReload(page);
  1127 |       await page.getByRole("button", { name: /next/i }).click();
  1128 |       await page.waitForTimeout(1_000);
  1129 | 
  1130 |       await goToMixes(page);
  1131 |       await todayCard.waitFor({ state: "visible", timeout: 8_000 });
  1132 |       await expect(ingredientRow).toContainText(combinedPullLbs.toFixed(2), {
  1133 |         timeout: 5_000,
  1134 |       });
  1135 |       await expect(ingredientRow).not.toContainText(firstPullLbs.toFixed(2));
  1136 |     } finally {
  1137 |       await db.query("DELETE FROM mixes WHERE id = $1", [mixId]).catch(() => {});
  1138 |       await db.query("DELETE FROM users WHERE username = $1", [username]).catch(() => {});
  1139 |     }
  1140 |   });
  1141 | 
  1142 |   /**
  1143 |    * Test (e): Per-run breakdown is correct when two brands share an ingredient.
  1144 |    *
  1145 |    * amountAlreadyMade = 0 → pull = contrib1 + contrib2 = 137.50
  1146 |    * Run1: (2.0/16)×800 = 100.00, Run2: (1.5/16)×400 = 37.50
  1147 |    */
  1148 |   test("prep mix card shows correct per-run breakdown when two brands share an ingredient", async ({
  1149 |     page,
  1150 |   }) => {
  1151 |     const suffix = uid();
  1152 |     const username = `user_${suffix}`;
  1153 |     const mixId = `prep-breakdown-${suffix}`;
  1154 |     const mixName = `BreakdownPrepMix ${suffix}`;
  1155 |     const ingredient = `SharedHerb_${suffix}`;
  1156 | 
  1157 |     const brand1 = `Alpha_${suffix}`;
  1158 |     const OZ1 = 2.0;
  1159 |     const CASES1 = 100;
  1160 |     const PPC = 8;
  1161 |     const brand2 = `Beta_${suffix}`;
  1162 |     const OZ2 = 1.5;
  1163 |     const CASES2 = 50;
  1164 | 
  1165 |     const pizzas1 = CASES1 * PPC; // 800
  1166 |     const pizzas2 = CASES2 * PPC; // 400
  1167 |     const contrib1Lbs = (OZ1 / 16) * pizzas1; // 100.00
  1168 |     const contrib2Lbs = (OZ2 / 16) * pizzas2; //  37.50
  1169 |     const pullLbs = contrib1Lbs + contrib2Lbs;  // 137.50
  1170 | 
  1171 |     const today = todayStr();
  1172 | 
  1173 |     try {
  1174 |       await dbCreateMix(db, {
  1175 |         id: mixId,
  1176 |         name: mixName,
  1177 |         isPrep: true,
  1178 |         component: ingredient,
  1179 |         perPizza: 0.1,
  1180 |       });
  1181 | 
  1182 |       await signUpAndDismissOnboarding(page, username, "TestPass123!");
  1183 |       await makeTestUserManager(username);
  1184 | 
  1185 |       await page.evaluate(
  1186 |         ({ brand1, brand2, ingredient, oz1, oz2, cases1, cases2, ppc }) => {
  1187 |           const DAY_KEY = "run-calc-day";
  1188 |           const RUN_KEY = (id: string) => `run-calc-run-${id}`;
  1189 |           const rawDay = localStorage.getItem(DAY_KEY);
  1190 |           if (!rawDay) return;
  1191 |           const day = JSON.parse(rawDay) as { runs?: Array<{ id: string; brand?: string }> };
  1192 |           if (!day.runs || day.runs.length === 0) return;
  1193 | 
  1194 |           day.runs[0].brand = brand1;
  1195 |           const runId1 = day.runs[0].id;
  1196 |           const existing1 = (() => {
  1197 |             try { return JSON.parse(localStorage.getItem(RUN_KEY(runId1)) ?? "{}"); } catch { return {}; }
  1198 |           })();
  1199 |           localStorage.setItem(RUN_KEY(runId1), JSON.stringify({
  1200 |             ...existing1, pep1Type: ingredient, pep1OzPerPizza: oz1,
  1201 |             casesNeeded: cases1, pizzasPerCase: ppc, casesPerLayer: 0,
  1202 |           }));
  1203 | 
  1204 |           const runId2 = `e2e-run2-${Math.random().toString(36).slice(2, 9)}`;
  1205 |           day.runs.push({ id: runId2, brand: brand2 });
```