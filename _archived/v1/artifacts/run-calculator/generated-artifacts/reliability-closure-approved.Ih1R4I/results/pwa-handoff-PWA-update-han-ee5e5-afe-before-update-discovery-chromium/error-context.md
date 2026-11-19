# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: pwa-handoff.spec.ts >> PWA update handoff >> auto-reloads when Home was already safe before update discovery
- Location: e2e/pwa-handoff.spec.ts:3016:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('button', { name: 'App updates · Update ready', exact: true })
Expected: visible
Timeout: 20000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByRole('button', { name: 'App updates · Update ready', exact: true }) with timeout 20000ms
  - waiting for getByRole('button', { name: 'App updates · Update ready', exact: true })

```

```yaml
- complementary "App updates":
  - button "App updates · Development preview"
  - status: Development preview. Published updates are not checked in this development preview.
- main:
  - heading "Production Run Calculator" [level=1]
  - paragraph: Pizza line planning & schedule estimation
  - 'button "Sync status: Connected"': Connected 1
  - text: Saved
  - button "Cast to other screens"
  - button "Enter fullscreen / kiosk mode"
  - button "Supervisor"
  - button "More"
  - group "production-line department":
    - tabpanel "Run":
      - text: Provisional — awaiting server confirmation
      - button "Line Map"
      - text: Run 1 of 1 1/30
      - button "New Run"
      - text: Run Setup Brand & Flavor
      - textbox "Brand…"
      - text: —
      - textbox "Flavor…"
      - text: Target Cases
      - spinbutton "0"
      - paragraph: ⚠ Enter cases to enable calculations
      - button "START RUN"
      - text: Line Details Cases Left to Run 0 Approx. Cases on Line 0 Dough Status Balanced Cases on Last Skid 0
      - heading "Temporary Adjustments" [level=3]
      - button "Clear All"
      - text: Freeze Tunnel Time
      - spinbutton "Freeze Tunnel Time": "0"
      - text: Crusts/Cycle
      - spinbutton "Crusts/Cycle": "0"
      - text: Cycle Speed
      - spinbutton "Cycle Speed": "0"
      - paragraph: For this run only — leave at 0 to use the Setup value. Setup stays unchanged.
      - group: Line Setup
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
  3004 |       await page.evaluate(() => window.dispatchEvent(new Event("online")));
  3005 | 
  3006 |       await expect.poll(() => server.sessionRecoveryRequests().syncReads).toBeGreaterThan(0);
  3007 |       await expect(page.getByRole("button", { name: "STOP RUN" })).toBeVisible();
  3008 |       await expect(page.getByTestId("auth-screen")).toHaveCount(0);
  3009 |       expect(server.sessionRecoveryRequests().rejected).toBe(0);
  3010 |     } finally {
  3011 |       if (!page.isClosed()) await page.context().setOffline(false);
  3012 |       await server.close();
  3013 |     }
  3014 |   });
  3015 | 
  3016 |   test("auto-reloads when Home was already safe before update discovery", async ({
  3017 |     page,
  3018 |   }) => {
  3019 |     const server = await startVersionedServer({
  3020 |       old: fixture.oldDir,
  3021 |       new: fixture.newDir,
  3022 |     }, fixture.staleHomeChunk, {
  3023 |       sessionRecovery: true,
  3024 |       safeSessionSnapshot: true,
  3025 |       fieldCheckObservations: true,
  3026 |       completeHomeFixture: true,
  3027 |       initialUserId: "pwa-session-manager",
  3028 |     });
  3029 | 
  3030 |     try {
  3031 |       await page.context().addCookies([{
  3032 |         name: "rc_auth", value: "disposable-fixture-session", url: server.baseUrl,
  3033 |         httpOnly: true, sameSite: "Lax",
  3034 |       }]);
  3035 |       const healthyHomeResponses = [
  3036 |         page.waitForResponse((response) =>
  3037 |           new URL(response.url()).pathname === "/api/sync/reset-epoch" && response.status() === 200,
  3038 |         ),
  3039 |         page.waitForResponse((response) =>
  3040 |           new URL(response.url()).pathname === "/api/factory-data" && response.status() === 200,
  3041 |         ),
  3042 |         page.waitForResponse((response) =>
  3043 |           new URL(response.url()).pathname === "/api/master-data/bootstrap" && response.status() === 200,
  3044 |         ),
  3045 |       ];
  3046 |       await page.goto(server.baseUrl, { waitUntil: "domcontentloaded" });
  3047 |       await Promise.all(healthyHomeResponses);
  3048 |       try {
  3049 |         await page.waitForFunction(async () => {
  3050 |           const registration = await navigator.serviceWorker.ready;
  3051 |           return registration.active?.state === "activated";
  3052 |         });
  3053 |       } catch (error) {
  3054 |         const serviceWorkerState = await page.evaluate(async () => {
  3055 |           if (!("serviceWorker" in navigator)) {
  3056 |             return { supported: false, secureContext: isSecureContext, registrations: [] };
  3057 |           }
  3058 |           const registrations = await navigator.serviceWorker.getRegistrations();
  3059 |           return {
  3060 |             supported: true,
  3061 |             secureContext: isSecureContext,
  3062 |             hasController: Boolean(navigator.serviceWorker.controller),
  3063 |             registrations: registrations.map((registration) => ({
  3064 |               active: registration.active?.state ?? null,
  3065 |               installing: registration.installing?.state ?? null,
  3066 |               waiting: registration.waiting?.state ?? null,
  3067 |             })),
  3068 |           };
  3069 |         }).catch(() => ({ evaluationFailed: true }));
  3070 |         throw new Error(
  3071 |           `Service worker did not activate: ${JSON.stringify({
  3072 |             serviceWorkerState,
  3073 |             fixtureErrorCount: server.fixtureErrors().length,
  3074 |             cause: error instanceof Error ? error.message : String(error),
  3075 |           })}`,
  3076 |         );
  3077 |       }
  3078 |       const controlledHomeReady = page.waitForResponse((response) =>
  3079 |         new URL(response.url()).pathname === "/api/sync/today" && response.status() === 200,
  3080 |       );
  3081 |       await page.reload({ waitUntil: "domcontentloaded" });
  3082 |       await controlledHomeReady;
  3083 |       await expect(page.locator("body")).toHaveAttribute("data-pwa-smoke-build", "old");
  3084 |       await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  3085 |       await expect(page.getByTestId("button-start-run")).toBeVisible();
  3086 |       await expect(page.getByText(/Couldn't confirm the current production state/i)).toHaveCount(0);
  3087 |       await expect(page.getByText("Offline — local projection", { exact: true })).toHaveCount(0);
  3088 |       await expect(page.getByText(/Operational lists unavailable/i)).toHaveCount(0);
  3089 |       await expect(page.getByText(/Directory unavailable/i)).toHaveCount(0);
  3090 |       await expect(page.getByText(/not loaded from the server/i)).toHaveCount(0);
  3091 |       await expect(page.getByText(/tracking is paused/i)).toHaveCount(0);
  3092 |       expect(server.homeApiFallbacks()).toEqual([]);
  3093 |       await expect(page.getByTestId("app-update-control"))
  3094 |         .toHaveAttribute("data-update-reload-safe", "true");
  3095 | 
  3096 |       server.publish("new");
  3097 |       await page.evaluate(async () => {
  3098 |         const registration = await navigator.serviceWorker.ready;
  3099 |         if (!registration) throw new Error("Expected a service-worker registration");
  3100 |         await registration.update();
  3101 |       });
  3102 |       await expect(page.getByRole("button", {
  3103 |         name: "App updates · Update ready", exact: true,
> 3104 |       })).toBeVisible({
       |           ^ Error: expect(locator).toBeVisible() failed
  3105 |         timeout: 20_000,
  3106 |       });
  3107 | 
  3108 |       try {
  3109 |         await page.waitForFunction(
  3110 |           () => document.body.dataset.pwaSmokeBuild === "new",
  3111 |           undefined,
  3112 |           { timeout: 20_000 },
  3113 |         );
  3114 |       } catch (error) {
  3115 |         const handoffState = await page.evaluate(async () => {
  3116 |           const rawEvents = sessionStorage.getItem("run-calc:pwa-update-diagnostics:v1");
  3117 |           let events: Array<Record<string, unknown>> = [];
  3118 |           try {
  3119 |             const parsed: unknown = rawEvents ? JSON.parse(rawEvents) : [];
  3120 |             if (Array.isArray(parsed)) {
  3121 |               events = parsed.map((event) => {
  3122 |                 if (!event || typeof event !== "object") return {};
  3123 |                 const value = event as Record<string, unknown>;
  3124 |                 return {
  3125 |                   phase: value.phase,
  3126 |                   stage: value.stage,
  3127 |                   running: value.running,
  3128 |                   target: value.target,
  3129 |                 };
  3130 |               });
  3131 |             }
  3132 |           } catch { /* The diagnostic is optional; the failure remains explicit. */ }
  3133 |           const registrations = "serviceWorker" in navigator
  3134 |             ? await navigator.serviceWorker.getRegistrations()
  3135 |             : [];
  3136 |           return {
  3137 |             build: document.body.dataset.pwaSmokeBuild ?? null,
  3138 |             updateButtonVisible: [...document.querySelectorAll("button")]
  3139 |               .some((button) => button.textContent?.includes("Update ready")),
  3140 |             reloadSafe: document.querySelector('[data-testid="app-update-control"]')
  3141 |               ?.getAttribute("data-update-reload-safe") ?? null,
  3142 |             reloadIdle: document.querySelector('[data-testid="app-update-control"]')
  3143 |               ?.getAttribute("data-update-reload-idle") ?? null,
  3144 |             recoveryNoticeVisible: document.body.innerText.includes(
  3145 |               "Couldn't confirm the current production state",
  3146 |             ),
  3147 |             offlineProjectionVisible: document.body.innerText.includes(
  3148 |               "Offline — local projection",
  3149 |             ),
  3150 |             trackingPausedVisible: document.body.innerText.includes("tracking is paused"),
  3151 |             openDialogCount: document.querySelectorAll('[role="dialog"]').length,
  3152 |             events,
  3153 |             workers: registrations.map((registration) => ({
  3154 |               active: registration.active?.state ?? null,
  3155 |               installing: registration.installing?.state ?? null,
  3156 |               waiting: registration.waiting?.state ?? null,
  3157 |             })),
  3158 |           };
  3159 |         }).catch(() => ({ evaluationFailed: true }));
  3160 |         const recoveryRequests = server.sessionRecoveryRequests();
  3161 |         throw new Error(
  3162 |           `App did not auto-reload into the published build: ${JSON.stringify({
  3163 |             handoffState,
  3164 |             recoveryRequests: {
  3165 |               syncReads: recoveryRequests.syncReads,
  3166 |               syncWrites: recoveryRequests.syncWrites,
  3167 |               acceptedWrites: recoveryRequests.acceptedWrites,
  3168 |               rejected: recoveryRequests.rejected,
  3169 |               me: recoveryRequests.me,
  3170 |               acceptedMeResponses: recoveryRequests.acceptedMeResponses,
  3171 |             },
  3172 |             homeApiFallbackCount: server.homeApiFallbacks().length,
  3173 |             fixtureErrorCount: server.fixtureErrors().length,
  3174 |             cause: error instanceof Error ? error.message : String(error),
  3175 |           })}`,
  3176 |         );
  3177 |       }
  3178 |     } finally {
  3179 |       await server.close();
  3180 |     }
  3181 |   });
  3182 | 
  3183 |   test("recovers an old HTML-served Home chunk onto the current build once", async ({
  3184 |     page,
  3185 |   }) => {
  3186 |     const server = await startVersionedServer({
  3187 |       old: fixture.oldDir,
  3188 |       new: fixture.newDir,
  3189 |     }, fixture.staleHomeChunk, {
  3190 |       sessionRecovery: true,
  3191 |       safeSessionSnapshot: true,
  3192 |     });
  3193 |     const pageErrors: string[] = [];
  3194 |     page.on("pageerror", (error) => pageErrors.push(error.message));
  3195 | 
  3196 |     try {
  3197 |       // Manual recovery must satisfy the same authenticated, idle-work safety
  3198 |       // contract as automatic recovery; an unidentified session must stay put.
  3199 |       await page.context().addCookies([{
  3200 |         name: "rc_auth",
  3201 |         value: "disposable-fixture-session",
  3202 |         url: server.baseUrl,
  3203 |         httpOnly: true,
  3204 |         sameSite: "Lax",
```