# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: premade-crust-profile.spec.ts >> marked profile selects Crust for a new run, not an already-started run
- Location: e2e/premade-crust-profile.spec.ts:226:1

# Error details

```
Error: expect(locator).toBeEnabled() failed

Locator: getByTestId('button-start-run')
Expected: enabled
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeEnabled" getByTestId('button-start-run') with timeout 5000ms
  - waiting for getByTestId('button-start-run')

```

```yaml
- complementary "App updates":
  - button "App updates · Development preview"
  - status: Development preview. Published updates are not checked in this development preview.
- 'status "Import QC review: 4 pending, 0 rejected"': Import QC 4 pending
- main:
  - heading "Production Run Calculator" [level=1]
  - paragraph: Pizza line planning & schedule estimation
  - 'button "Sync status: Synchronized"': Synchronized
  - text: Saved
  - button "Cast to other screens"
  - button "Enter fullscreen / kiosk mode"
  - button "Supervisor"
  - button "More — 811 manager actions need attention": "811"
  - group "production-line department":
    - tabpanel "Run":
      - text: Confirmed server baseline
      - button "Line Map"
      - text: Run 1 of 2 2/30
      - button "Reorder runs"
      - button "Glance view — large numbers for distance viewing"
      - button "1 Blank"
      - button "New Run"
      - text: Run Setup 8-Cut Brand & Flavor
      - textbox "Brand…": Premade Profile premade_profile_mbzu4qfx
      - text: —
      - textbox "Flavor…": Pepperoni premade_profile_mbzu4qfx
      - text: Target Cases
      - spinbutton "0"
      - paragraph: ⚠ Enter cases to enable calculations
      - button "PAUSE RUN"
      - button "STOP RUN"
      - button "LOG STOPPAGE"
      - text: "Elapsed Time: 2m Next case in 0:15 Press / Oven Frontline Freeze Tunnel Wrapper / Packaging Pace 7 cases behind 36.8 pizzas/min · 18.4 pairs/min at Press / Oven Line Details Cases Left to Run 0 Approx. Cases on Line 4 Dough Status +4.0 cases ahead Cases on Last Skid 0"
      - heading "Temporary Adjustments" [level=3]
      - button "Clear All"
      - text: Freeze Tunnel Time · setup 0
      - spinbutton "Freeze Tunnel Time · setup 0": "0"
      - text: Crusts/Cycle · setup 4
      - spinbutton "Crusts/Cycle · setup 4": "0"
      - text: Cycle Speed · setup 10.0
      - spinbutton "Cycle Speed · setup 10.0": "0"
      - paragraph: For this run only — leave at 0 to use the Setup value. Setup stays unchanged.
      - button "Select run 1"
      - button "Select run 2"
      - button "Next Unnamed Run"
      - paragraph: Upcoming Runs
      - button "Unnamed Run"
      - group:
        - text: Line Setup
        - group:
          - text: Line Type
          - button "Dough"
          - button "Crust"
          - text: Die Type
          - button "12 inch"
          - button "12\""
          - button "7\" Dies"
          - button "8-Cut"
          - button "Add / remove die types"
          - text: Allergen
          - button "None"
          - button "Egg Allergen"
          - button "Soy Allergen"
          - text: Crusts Per Cycle
          - spinbutton "Crusts Per Cycle": "4"
          - text: Cycle Speed (cyc/min)
          - spinbutton "Cycle Speed (cyc/min)": "10"
          - text: Speed Adjustment
          - spinbutton "Speed Adjustment": "0.92"
          - text: Freeze tunnel time (min)
          - spinbutton "Freeze tunnel time (min)": "0.25"
          - text: Press / Oven transit (min)
          - spinbutton "Press / Oven transit (min)": "0.0625"
          - text: Frontline transit (min)
          - spinbutton "Frontline transit (min)": "0.0625"
          - text: Wrapper / Packaging transit (min)
          - spinbutton "Wrapper / Packaging transit (min)": "2.5"
          - paragraph: "Provisional split: half of the saved pre-tunnel time per section. Edit to replace this allocation; these are not measured factory times."
          - paragraph: 0.06 Press / Oven + 0.06 Frontline + 0.00 Freeze Tunnel + 0.13 Wrapper / Packaging = 0.25 min total. Press / Oven carries pairs; Frontline carries single pizzas. Two pizzas remain two pizzas.
          - status: Section times exceed total line time. Calculations proportionally fit them to the total shown above; total transit time is not increased.
          - text: Pizzas Per Case
          - spinbutton "Pizzas Per Case": "12"
          - text: Cases Per Skid
          - spinbutton "Cases Per Skid": "3"
          - text: Extra Case Buffer
          - spinbutton "Extra Case Buffer": "0"
          - text: Doughballs Per Tray
          - spinbutton "Doughballs Per Tray": "12"
          - text: Dough Batch Yield (doughballs)
          - spinbutton "Dough Batch Yield (doughballs)": "0"
  - group "production-line department"
  - tablist:
    - tab "Run" [selected]
    - tab "Dough"
    - tab "Sauce"
    - tab "Front"
    - tab "Pack"
    - tab "Warehouse"
  - group "production-line department"
  - group "production-line department"
  - group "production-line department"
- region "Notifications (F8)":
  - list
```

# Test source

```ts
  153 |             doughRecipeName,
  154 |             doughballsPerTray: 12,
  155 |             casesNeeded: 100,
  156 |             casesPerSkid: 3,
  157 |             pizzasPerCase: 12,
  158 |             crustsPerCycle: 4,
  159 |             freezerTime: 0.25,
  160 |           },
  161 |           crustValues: {},
  162 |           updatedAt: Date.now(),
  163 |         }],
  164 |       }),
  165 |     });
  166 |     return { status: response.status, hasEpoch: true };
  167 |   }, { profileBrand: brand, profileFlavor: flavor, doughRecipeName: recipeName });
  168 |   expect(result.hasEpoch, "profile write uses the current master-data epoch").toBe(true);
  169 |   expect(result.status, "brand profile fixture write").toBe(200);
  170 | }
  171 | 
  172 | async function ensureLineSetupOpen(page: Page): Promise<void> {
  173 |   const lineType = page.getByText("Line Type", { exact: true });
  174 |   if (!(await lineType.isVisible().catch(() => false))) {
  175 |     await page.locator("summary", { hasText: "Line Setup" }).click();
  176 |   }
  177 |   await lineType.waitFor({ state: "visible" });
  178 | }
  179 | 
  180 | async function selectBrandAndFlavor(
  181 |   page: Page,
  182 |   brand: string,
  183 |   flavor: string,
  184 | ): Promise<void> {
  185 |   const brandInput = page.locator('input[placeholder="Brand…"]');
  186 |   await brandInput.click();
  187 |   if (await brandInput.isEditable()) {
  188 |     await brandInput.fill(brand);
  189 |     await brandInput.press("Enter");
  190 |   } else {
  191 |     await expect(brandInput).toHaveValue(brand);
  192 |   }
  193 | 
  194 |   const flavorInput = page.locator('input[placeholder="Flavor…"]');
  195 |   await flavorInput.click();
  196 |   if (await flavorInput.isEditable()) {
  197 |     await flavorInput.fill(flavor);
  198 |     await flavorInput.press("Enter");
  199 |   } else {
  200 |     await expect(flavorInput).toHaveValue(flavor);
  201 |   }
  202 |   await ensureLineSetupOpen(page);
  203 | }
  204 | 
  205 | let db: Client;
  206 | test.beforeAll(async () => {
  207 |   db = new Client({
  208 |     connectionString: requireIsolatedTestDatabase("premade-crust profile browser test"),
  209 |   });
  210 |   await db.connect();
  211 | });
  212 | 
  213 | test.afterAll(async () => {
  214 |   if (!db) return;
  215 |   try {
  216 |     await db.query("DELETE FROM daily_sync WHERE date = $1 AND scope = 'live'", [today()]);
  217 |     if (recipeIds.size > 0) {
  218 |       await db.query("DELETE FROM dough_recipes WHERE id = ANY($1::text[])", [[...recipeIds]]);
  219 |     }
  220 |     await cleanupTestUsers(db, usernames);
  221 |   } finally {
  222 |     await db.end();
  223 |   }
  224 | });
  225 | 
  226 | test("marked profile selects Crust for a new run, not an already-started run", async ({
  227 |   page,
  228 |   request,
  229 | }) => {
  230 |   test.setTimeout(150_000);
  231 |   const suffix = uid("premade_profile");
  232 |   const username = uid("premade_user");
  233 |   const brand = `Premade Profile ${suffix}`;
  234 |   const flavor = `Pepperoni ${suffix}`;
  235 |   const recipeId = `premade_recipe_${randomUUID()}`;
  236 |   const recipeName = `In-house Dough ${suffix}`;
  237 |   usernames.add(username);
  238 |   recipeIds.add(recipeId);
  239 | 
  240 |   await createManager(request, db, username);
  241 |   await signIn(page, username);
  242 |   await writeDoughRecipe(page, { id: recipeId, name: recipeName, isPremadeCrust: false });
  243 |   await writeDoughProfile(page, brand, flavor, recipeName);
  244 | 
  245 |   // Reload so both the shared recipe and profile are adopted from the server.
  246 |   await page.reload({ waitUntil: "domcontentloaded" });
  247 |   await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
  248 |   await ensureLineSetupOpen(page);
  249 |   await selectBrandAndFlavor(page, brand, flavor);
  250 |   const doughButton = page.getByRole("button", { name: "Dough", exact: true });
  251 |   const crustButton = page.getByRole("button", { name: "Crust", exact: true });
  252 |   await expect(doughButton).toHaveClass(/bg-background/);
> 253 |   await expect(page.getByTestId("button-start-run")).toBeEnabled();
      |                                                      ^ Error: expect(locator).toBeEnabled() failed
  254 | 
  255 |   const startResponsePromise = page.waitForResponse((response) =>
  256 |     new URL(response.url()).pathname === "/api/sync/operational-intents" &&
  257 |     response.request().method() === "POST",
  258 |   );
  259 |   await page.getByTestId("button-start-run").click();
  260 |   const startResponse = await startResponsePromise;
  261 |   expect(startResponse.status(), "run start acknowledgement").toBe(200);
  262 |   const startAck = await startResponse.json() as {
  263 |     ok?: boolean;
  264 |     data?: { dayState?: { runs?: Array<{ id: string; startedAt?: number }> } };
  265 |   };
  266 |   expect(startAck.ok).toBe(true);
  267 |   const startedRun = startAck.data?.dayState?.runs?.find((run) => run.startedAt);
  268 |   expect(startedRun?.id, "the first run is canonically started").toBeTruthy();
  269 |   expect(startedRun?.startedAt).toEqual(expect.any(Number));
  270 |   await expect(page.getByRole("button", { name: "PAUSE RUN", exact: true })).toBeVisible();
  271 |   await expect(doughButton).toHaveClass(/bg-background/);
  272 |   await expect(crustButton).not.toHaveClass(/bg-background/);
  273 | 
  274 |   // A later manager classification must not rewrite a production run that has
  275 |   // already started. Re-entering the app also exercises persisted run mode.
  276 |   await writeDoughRecipe(page, { id: recipeId, name: recipeName, isPremadeCrust: true });
  277 |   // Hold canonical master data across the reload. Profile selection must wait
  278 |   // for the manager-controlled recipe marker instead of silently defaulting
  279 |   // the new run to Dough while startup data is unavailable.
  280 |   let releaseBootstrap!: () => void;
  281 |   const bootstrapGate = new Promise<void>((resolve) => {
  282 |     releaseBootstrap = resolve;
  283 |   });
  284 |   let allowBootstrap = false;
  285 |   await page.route("**/api/master-data/bootstrap", async (route) => {
  286 |     if (!allowBootstrap) {
  287 |       await bootstrapGate;
  288 |       if (!allowBootstrap) {
  289 |         await route.fulfill({
  290 |           status: 503,
  291 |           contentType: "application/json",
  292 |           body: JSON.stringify({ error: "synthetic_master_data_unavailable" }),
  293 |         });
  294 |         return;
  295 |       }
  296 |     }
  297 |     await route.continue();
  298 |   });
  299 |   await page.reload({ waitUntil: "domcontentloaded" });
  300 |   await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
  301 |   await expect(page.getByRole("button", { name: "PAUSE RUN", exact: true })).toBeVisible();
  302 |   await ensureLineSetupOpen(page);
  303 |   await expect(doughButton).toHaveClass(/bg-background/);
  304 |   await expect(crustButton).not.toHaveClass(/bg-background/);
  305 | 
  306 |   await page.getByRole("button", { name: "New Run", exact: true }).click();
  307 |   await expect(page.getByText("Run 2 of 2", { exact: true })).toBeVisible();
  308 |   await selectBrandAndFlavor(page, brand, flavor);
  309 |   await expect(page.getByText("Checking shared recipe status", { exact: true })).toBeVisible();
  310 |   await expect(doughButton).toHaveClass(/bg-background/);
  311 |   await expect(crustButton).not.toHaveClass(/bg-background/);
  312 |   await expect(page.locator('input[placeholder="Flavor…"]')).toHaveValue("");
  313 | 
  314 |   // A failed canonical read must not apply a plausible but wrong profile.
  315 |   releaseBootstrap();
  316 |   await expect(page.getByText("Profile not applied", { exact: true })).toBeVisible({
  317 |     timeout: 30_000,
  318 |   });
  319 |   await expect(doughButton).toHaveClass(/bg-background/);
  320 |   await expect(crustButton).not.toHaveClass(/bg-background/);
  321 |   await expect(page.locator('input[placeholder="Flavor…"]')).toHaveValue("");
  322 | 
  323 |   // The explicit user retry fetches the canonical marker and applies the
  324 |   // linked profile; no blind replay or cached empty-recipe inference is used.
  325 |   allowBootstrap = true;
  326 |   const masterDataLoaded = page.waitForResponse((response) =>
  327 |     new URL(response.url()).pathname === "/api/master-data/bootstrap" &&
  328 |     response.request().method() === "GET" &&
  329 |     response.status() === 200,
  330 |   );
  331 |   await selectBrandAndFlavor(page, brand, flavor);
  332 |   const bootstrapResponse = await masterDataLoaded;
  333 |   const bootstrap = await bootstrapResponse.json() as {
  334 |     doughRecipes?: Array<{ id: string; isPremadeCrust?: boolean }>;
  335 |   };
  336 |   expect(bootstrap.doughRecipes).toEqual(
  337 |     expect.arrayContaining([expect.objectContaining({ id: recipeId, isPremadeCrust: true })]),
  338 |   );
  339 |   await expect(crustButton).toHaveClass(/bg-background/);
  340 |   await expect(page.getByTestId("button-start-run")).toBeEnabled();
  341 | 
  342 |   const persistedModes = await page.evaluate(() => {
  343 |     const day = JSON.parse(localStorage.getItem("run-calc-day") ?? "{}") as {
  344 |       runs?: Array<{ id: string; subTab?: string }>;
  345 |     };
  346 |     return day.runs?.map((run) => ({ id: run.id, subTab: run.subTab })) ?? [];
  347 |   });
  348 |   expect(persistedModes.find((run) => run.id === startedRun!.id)?.subTab).toBe("dough");
  349 |   expect(persistedModes.find((run) => run.id !== startedRun!.id)?.subTab).toBe("crusts");
  350 | });
  351 | 
```