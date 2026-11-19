# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: pwa-handoff.spec.ts >> PWA update handoff >> recovers an old HTML-served Home chunk onto the current build once
- Location: e2e/pwa-handoff.spec.ts:3183:3

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: 1
Received: 0

Call Log:
- Timeout 5000ms exceeded while waiting on the predicate
```

# Test source

```ts
  126 |   ];
  127 |   await Promise.all(files.map(async (file) => {
  128 |     const source = await readFile(file, "utf8");
  129 |     if (source.includes(currentHomeChunk)) {
  130 |       await writeFile(file, source.replaceAll(currentHomeChunk, newName));
  131 |     }
  132 |   }));
  133 |   return staleHomeChunk;
  134 | }
  135 | 
  136 | async function buildTwoVersionFixture() {
  137 |   const root = await mkdtemp(path.join(os.tmpdir(), "run-calculator-pwa-handoff-"));
  138 |   try {
  139 |     const oldDir = path.join(root, "old");
  140 |     const newDir = path.join(root, "new");
  141 |     // Build distinct real bundles into this fixture's own directories. A full
  142 |     // release browser run serves dist/public at the same time; rebuilding there
  143 |     // can temporarily erase its JS chunks and break unrelated pages.
  144 |     for (const [version, outputDir] of [["old", oldDir], ["new", newDir]] as const) {
  145 |       await execFileAsync("pnpm", [
  146 |         "exec", "vite", "build", "--config", "vite.config.ts", "--outDir", outputDir,
  147 |       ], {
  148 |         cwd: packageRoot,
  149 |         // Production uses one minute. Keep the exact policy path while making
  150 |         // this two-version browser fixture finish promptly.
  151 |         env: {
  152 |           ...process.env,
  153 |           PWA_HANDOFF_BUILD_ID: `pwa-${version}-build`,
  154 |           VITE_UPDATE_RELOAD_IDLE_MS: "1000",
  155 |         },
  156 |         maxBuffer: 10 * 1024 * 1024,
  157 |       });
  158 |       await Promise.all([
  159 |         stat(path.join(outputDir, "index.html")),
  160 |         stat(path.join(outputDir, "service-worker.js")),
  161 |         stat(path.join(outputDir, "favicon.ico")),
  162 |       ]);
  163 |     }
  164 |     await Promise.all([stampBuild(oldDir, "old"), stampBuild(newDir, "new")]);
  165 |     const staleHomeChunk = await divergeHomeChunk(newDir, await findHomeChunk(oldDir));
  166 |     return { root, oldDir, newDir, staleHomeChunk };
  167 |   } catch (error) {
  168 |     await rm(root, { recursive: true, force: true });
  169 |     throw error;
  170 |   }
  171 | }
  172 | 
  173 | async function startOldBuildThenTriggerStaleAssetFailure(
  174 |   page: import("@playwright/test").Page,
  175 |   server: Awaited<ReturnType<typeof startVersionedServer>>,
  176 |   staleHomeChunk: string,
  177 |   beforeStaleAssetFailure?: () => Promise<void>,
  178 |   trackWorkerLifecycle = true,
  179 | ) {
  180 |   server.holdNextSessionResponse();
  181 |   await page.goto(server.baseUrl, { waitUntil: "domcontentloaded" });
  182 |   await expect(page.locator("body")).toHaveAttribute("data-pwa-smoke-build", "old");
  183 |   await page.waitForFunction(async () => {
  184 |     const registration = await navigator.serviceWorker.ready;
  185 |     return registration.active?.state === "activated";
  186 |   });
  187 |   await page.evaluate(async ({ missingHomeChunk, trackWorkerLifecycle }) => {
  188 |     const registration = await navigator.serviceWorker.ready;
  189 |     if (trackWorkerLifecycle) {
  190 |       const traceKey = "__pwa_recovery_worker_lifecycle";
  191 |       const record = (entry: { kind: string; state?: string }) => {
  192 |         const entries = JSON.parse(localStorage.getItem(traceKey) ?? "[]") as typeof entry[];
  193 |         entries.push(entry);
  194 |         localStorage.setItem(traceKey, JSON.stringify(entries));
  195 |       };
  196 |       registration.addEventListener("updatefound", () => {
  197 |         const worker = registration.installing;
  198 |         if (!worker) return;
  199 |         record({ kind: "installing", state: worker.state });
  200 |         worker.addEventListener("statechange", () => {
  201 |           record({ kind: "worker-state", state: worker.state });
  202 |         });
  203 |       });
  204 |       navigator.serviceWorker.addEventListener("controllerchange", () => {
  205 |         record({ kind: "controllerchange" });
  206 |       });
  207 |     }
  208 |     // The stale Home chunk is deliberately absent from the network's new
  209 |     // version. Remove only this cached old response so the request reaches the
  210 |     // versioned server instead of being masked by the installed worker cache.
  211 |     for (const cacheName of await caches.keys()) {
  212 |       if (!cacheName.startsWith("workbox-precache")) continue;
  213 |       const cache = await caches.open(cacheName);
  214 |       for (const request of await cache.keys()) {
  215 |         if (new URL(request.url).pathname.endsWith(`/assets/${missingHomeChunk}`)) {
  216 |           await cache.delete(request);
  217 |         }
  218 |       }
  219 |     }
  220 |   }, { missingHomeChunk: staleHomeChunk, trackWorkerLifecycle });
  221 | 
  222 |   await beforeStaleAssetFailure?.();
  223 |   server.publish("new");
  224 |   server.armStaleAssetFailure();
  225 |   server.releaseHeldSessionResponse();
> 226 |   await expect.poll(() => server.staleAssetRequestCount()).toBe(1);
      |                                                            ^ Error: expect(received).toBe(expected) // Object.is equality
  227 |   await expect(page.getByRole("button", { name: "Update and reload" })).toBeVisible({
  228 |     timeout: 20_000,
  229 |   });
  230 | }
  231 | 
  232 | async function readPrecacheInventory(buildDir: string) {
  233 |   const worker = await readFile(path.join(buildDir, "service-worker.js"), "utf8");
  234 |   const firstRevision = worker.indexOf('"revision"');
  235 |   const manifestStart = worker.lastIndexOf("[", firstRevision);
  236 |   const manifestEnd = worker.indexOf("]", firstRevision) + 1;
  237 |   if (firstRevision < 0 || manifestStart < 0 || manifestEnd <= manifestStart) {
  238 |     throw new Error("The production worker does not contain an injected precache manifest");
  239 |   }
  240 | 
  241 |   const manifest = JSON.parse(worker.slice(manifestStart, manifestEnd)) as Array<{
  242 |     url: string;
  243 |     revision?: string | null;
  244 |   }>;
  245 |   const uniqueEntries = new Map(manifest.map((entry) => [entry.url, entry]));
  246 |   const entries = await Promise.all([...uniqueEntries.values()].map(async (entry) => {
  247 |     const assetPath = path.join(buildDir, entry.url);
  248 |     const assetStat = await stat(assetPath);
  249 |     return { ...entry, bytes: assetStat.size };
  250 |   }));
  251 |   const assetsDir = path.join(buildDir, "assets");
  252 |   const emittedJavaScript = (await readdir(assetsDir))
  253 |     .filter((name) => name.endsWith(".js"))
  254 |     .map((name) => `assets/${name}`);
  255 |   const precachedJavaScript = new Set(
  256 |     entries.filter((entry) => entry.url.endsWith(".js")).map((entry) => entry.url),
  257 |   );
  258 | 
  259 |   return {
  260 |     entries,
  261 |     totalBytes: entries.reduce((total, entry) => total + entry.bytes, 0),
  262 |     precachedJavaScript,
  263 |     unprecachedJavaScript: emittedJavaScript.filter((url) => !precachedJavaScript.has(url)),
  264 |     emittedJavaScript,
  265 |   };
  266 | }
  267 | 
  268 | async function startVersionedServer(
  269 |   versionDirs: Record<Version, string>,
  270 |   staleHomeChunk?: string,
  271 |   options: {
  272 |     sessionRecovery?: boolean;
  273 |     sessionRecoveryIntentOutbox?: boolean;
  274 |     sessionRecoveryRunId?: string;
  275 |     safeSessionSnapshot?: boolean;
  276 |     lifecycleSnapshot?: boolean;
  277 |     preHomeSafetyTimeout?: boolean;
  278 |     fieldCheckObservations?: boolean;
  279 |     completeHomeFixture?: boolean;
  280 |     initialUserId?: string;
  281 |   } = {},
  282 | ) {
  283 |   let currentVersion: Version = "old";
  284 |   let failWorkerChecks = false;
  285 |   let failIdentityChecks = false;
  286 |   let staleAssetFailureArmed = false;
  287 |   let staleAssetFailureTriggered = false;
  288 |   let staleAssetRequestCount = 0;
  289 |   let sessionValid = true;
  290 |   let snapshotHasActiveRun = !options.safeSessionSnapshot;
  291 |   let lifecycleSnapshot: Record<string, unknown> | undefined;
  292 |   let lifecycleCanonicalRevision = 0;
  293 |   let operationalIntentCursor = 0;
  294 |   let intentPermissionGranted = true;
  295 |   let temporarySessionProbeFailuresRemaining = 0;
  296 |   const sessionProbeFailuresByTestTab = new Map<string, number>();
  297 |   let sessionProbesToHold = 0;
  298 |   let sessionResponsesToPause = 0;
  299 |   let releaseSessionResponses: (() => void) | undefined;
  300 |   let sessionResponsePause: Promise<void> | undefined;
  301 |   const sessionRecoveryRequests = {
  302 |     me: 0,
  303 |     acceptedMeResponses: 0,
  304 |     temporaryMeFailures: 0,
  305 |     heldMeProbes: 0,
  306 |     closedHeldMeProbes: 0,
  307 |     syncReads: 0,
  308 |     preHomeSafetyTimeouts: 0,
  309 |     syncWrites: 0,
  310 |     rejected: 0,
  311 |     acceptedWrites: 0,
  312 |     intentPosts: 0,
  313 |     intentApplications: 0,
  314 |     signIns: 0,
  315 |     permissionDenied: 0,
  316 |   };
  317 |   const sessionSnapshotReads: Array<{ date: string; activeRun: boolean }> = [];
  318 |   const fieldCheckObservations: Array<{
  319 |     observations: unknown[];
  320 |     acceptedMeResponsesAtReceipt: number;
  321 |   }> = [];
  322 |   const fieldCheckRequests: Array<{ userId: string; sandbox: boolean; status: number }> = [];
  323 |   let fieldCheckFailuresRemaining = 0;
  324 |   const intentRequestIds: string[] = [];
  325 |   const intentRequestUsers: string[] = [];
  326 |   const appliedIntentIds: string[] = [];
```