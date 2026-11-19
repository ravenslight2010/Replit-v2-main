# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: run-insights.spec.ts >> Run Insights — accept, dismiss, follow-up >> Dismiss suppresses the suggestion and it stays suppressed on same drift
- Location: e2e/run-insights.spec.ts:354:3

# Error details

```
Error: page.evaluate: Execution context was destroyed, most likely because of a navigation
```

# Test source

```ts
  1   | /**
  2   |  * E2E: Run Insights card — accept / dismiss / follow-up flow
  3   |  *
  4   |  * Verifies the full browser journey that unit + integration tests cannot:
  5   |  *   suggestion appears → manager clicks Accept → cycleSpeed changes in the saved
  6   |  *   profile → confirmation line shows → Dismiss suppresses a second suggestion
  7   |  *   → follow-up note appears → "Got it" clears it.
  8   |  *
  9   |  * Strategy: inject suggestion candidates directly via POST /api/run-suggestions/observe
  10  |  * (the same payload the client posts after run finalization). The browser flow from
  11  |  * that point is identical to the real path.
  12  |  *
  13  |  * Profile-sync ordering is critical: loadProfile() reads from localStorage, which
  14  |  * is seeded by seedProfilesFromServer() at app startup. We therefore create the
  15  |  * server profile via API BEFORE opening the browser so the startup sync picks it up.
  16  |  *
  17  |  * Relevant files:
  18  |  *   artifacts/run-calculator/src/components/RunInsightsCard.tsx  (data-testids)
  19  |  *   artifacts/run-calculator/src/runInsights.ts                  (eval thresholds)
  20  |  *   artifacts/run-calculator/src/pages/home.tsx                  (applyRunSuggestion)
  21  |  *   artifacts/run-calculator/src/storage.ts                      (profileObjHasRealData guard)
  22  |  *   artifacts/api-server/src/routes/runSuggestions.ts
  23  |  *   lib/db/src/schema/runSuggestions.ts
  24  |  *
  25  |  * Run with:
  26  |  *   PLAYWRIGHT_BASE_URL=https://<dev-domain> \
  27  |  *   STAFF_SIGNUP_CODE=<code> \
  28  |  *   PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=$(which chromium) \
  29  |  *   DATABASE_URL=<connection-string> \
  30  |  *   pnpm --filter @workspace/run-calculator exec playwright test run-insights
  31  |  */
  32  | 
  33  | import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
  34  | import { Client } from "pg";
  35  | import {
  36  |   AuthorizedBrowserFixtures,
  37  |   DEFAULT_MANAGER_CAPABILITIES,
  38  |   requireIsolatedTestDatabase,
  39  | } from "./isolation";
  40  | 
  41  | // ── helpers ──────────────────────────────────────────────────────────────────
  42  | 
  43  | function uid(): string {
  44  |   return `e2e_ri_${Math.random().toString(36).slice(2, 9)}`;
  45  | }
  46  | 
  47  | const SIGNUP_CODE = process.env.STAFF_SIGNUP_CODE ?? "";
  48  | const API_BASE = process.env.PLAYWRIGHT_BASE_URL ?? `https://${process.env.REPLIT_DEV_DOMAIN}`;
  49  | 
  50  | /**
  51  |  * Browser sign-in form → wait for the main app to be ready.
  52  |  * Assumes onboarding_seen = true (no overlay to dismiss).
  53  |  */
  54  | async function signIn(
  55  |   page: Page,
  56  |   username: string,
  57  |   password: string,
  58  |   product: { brand: string; flavor: string },
  59  | ): Promise<void> {
  60  |   // This fixture creates a synthetic server profile without mutating the shared
  61  |   // factory brand list. Skip the one-time legacy orphan-profile cleanup so it
  62  |   // does not delete that deliberately isolated record during startup.
  63  |   await page.addInitScript(({ brand, flavor, runId }) => {
  64  |     localStorage.setItem("run-calc-purge-orphaned-profiles-v1", "1");
  65  |     localStorage.setItem("run-calc-day", JSON.stringify({
  66  |       runs: [{ id: runId, brand, flavor, seeded: false }],
  67  |       currentIndex: 0,
  68  |       date: new Date().toISOString().slice(0, 10),
  69  |       resetAt: 0,
  70  |       substitutions: [],
  71  |       substitutionLog: [],
  72  |       stagedItems: {},
  73  |       prepPhase: {
  74  |         prepStartedAt: null,
  75  |         prepBatchesDough: 0,
  76  |         prepBatchesSauce: 0,
  77  |         prepCarriedOver: false,
  78  |       },
  79  |     }));
  80  |     localStorage.setItem(`run-calc-run-${runId}`, JSON.stringify({}));
  81  |   }, {
  82  |     brand: product.brand,
  83  |     flavor: product.flavor,
  84  |     runId: `run-insights-${username}`,
  85  |   });
  86  |   await page.goto("/sign-in", { waitUntil: "domcontentloaded" });
  87  |   await page.locator("#username").waitFor({ state: "visible", timeout: 20_000 });
  88  |   await page.locator("#username").fill(username);
  89  |   await page.locator("#password").fill(password);
  90  |   await page.getByRole("button", { name: /^sign in$/i }).click();
  91  |   // Wait for the main app tabs to be ready
  92  |   await page.locator('[data-testid="tab-run"]').waitFor({ state: "attached", timeout: 25_000 });
  93  |   // Wait for the startup sync (seedProfilesFromServer) to land this profile in
  94  |   // localStorage — the deterministic signal the fixed pause approximated. The
  95  |   // profile may be written as an individual dough key or inside the scoped
  96  |   // profile cache blob, so accept either shape.
  97  |   const profileSuffix = `${product.brand.toLowerCase().trim()}__${product.flavor.toLowerCase().trim()}`;
  98  |   await expect.poll(
> 99  |     () => page.evaluate(
      |                ^ Error: page.evaluate: Execution context was destroyed, most likely because of a navigation
  100 |       ({ doughKey, suffix }) =>
  101 |         Boolean(localStorage.getItem(doughKey)) ||
  102 |         Array.from({ length: localStorage.length }, (_, i) =>
  103 |           localStorage.getItem(localStorage.key(i)!) ?? "",
  104 |         ).some((v) => v.includes(`"${suffix}"`)),
  105 |       { doughKey: `run-calc-profile-${profileSuffix}`, suffix: profileSuffix },
  106 |     ),
  107 |     { timeout: 20_000 },
  108 |   ).toBe(true);
  109 | }
  110 | 
  111 | /**
  112 |  * Create a saved brand profile on the server so applyRunSuggestion has
  113 |  * something to update via loadProfile() → saveProfile().
  114 |  *
  115 |  * IMPORTANT: `dieType` is required for profileObjHasRealData() to pass in
  116 |  * storage.ts. Without a qualifying field (dieType, appNType, frontlineRecipeName,
  117 |  * or a recipe array), saveProfile() returns false and Accept throws
  118 |  * "No saved setup found for this product".
  119 |  */
  120 | async function createProfile(
  121 |   fixtures: AuthorizedBrowserFixtures,
  122 |   token: string,
  123 |   brand: string,
  124 |   flavor: string,
  125 |   cycleSpeed: number,
  126 | ): Promise<void> {
  127 |   await fixtures.seedBrandProfile({ token }, {
  128 |     brand,
  129 |     flavor,
  130 |     values: {
  131 |       dieType: "8-Cut", // qualifies the profile — see profileObjHasRealData()
  132 |       cycleSpeed,
  133 |       crustsPerCycle: 4,
  134 |       speedAdjustment: 1,
  135 |       freezerTime: 8,
  136 |       casesNeeded: 100,
  137 |       pizzasPerCase: 12,
  138 |     },
  139 |     crustValues: {},
  140 |     updatedAt: Date.now() - 2000,
  141 |   });
  142 | }
  143 | 
  144 | /** Inject a pending speed-target suggestion via the observe endpoint. */
  145 | async function observeSuggestion(
  146 |   request: APIRequestContext,
  147 |   token: string,
  148 |   brand: string,
  149 |   flavor: string,
  150 |   configuredSpeed: number,
  151 |   recommendedSpeed: number,
  152 | ): Promise<void> {
  153 |   const resp = await request.post(`${API_BASE}/api/run-suggestions/observe`, {
  154 |     headers: { "Content-Type": "application/json", Cookie: `rc_auth=${token}` },
  155 |     data: {
  156 |       type: "speed-target",
  157 |       brand,
  158 |       flavor,
  159 |       dieType: "",
  160 |       observedValue: recommendedSpeed,
  161 |       configuredValue: configuredSpeed,
  162 |       recommendedValue: recommendedSpeed,
  163 |       unit: "cycles/min",
  164 |       runCount: 3,
  165 |       statsLine: `The last 3 ${brand} ${flavor} runs averaged above the configured speed target.`,
  166 |     },
  167 |   });
  168 |   expect(resp.ok(), `POST /api/run-suggestions/observe failed: ${resp.status()}`).toBe(true);
  169 |   const body = await resp.json() as { ok?: boolean };
  170 |   expect(body.ok).toBe(true);
  171 | }
  172 | 
  173 | /**
  174 |  * Navigate to the Setup tab via the header overflow menu.
  175 |  * Setup has no bottom-nav trigger — it lives in the hamburger "More" menu.
  176 |  */
  177 | async function goToSetup(page: Page): Promise<void> {
  178 |   const menuBtn = page.locator('button[title="More"]');
  179 |   await menuBtn.waitFor({ state: "visible", timeout: 10_000 });
  180 |   await menuBtn.click();
  181 |   const setupItem = page.getByRole("menuitem", { name: /^setup$/i });
  182 |   await setupItem.waitFor({ state: "visible", timeout: 5_000 });
  183 |   await setupItem.click();
  184 |   // Wait for the Setup view to mount instead of a fixed pause. Every caller
  185 |   // works with the Run Insights card, whose refresh button is the Setup
  186 |   // screen's stable anchor.
  187 |   await page.locator('[data-testid="button-run-insights-refresh"]').waitFor({
  188 |     state: "attached",
  189 |     timeout: 10_000,
  190 |   });
  191 | }
  192 | 
  193 | // ── DB client lifecycle ───────────────────────────────────────────────────────
  194 | 
  195 | let db: Client;
  196 | let authorizedFixtures: AuthorizedBrowserFixtures;
  197 | 
  198 | test.beforeAll(async ({ playwright }) => {
  199 |   authorizedFixtures = await AuthorizedBrowserFixtures.create(
```