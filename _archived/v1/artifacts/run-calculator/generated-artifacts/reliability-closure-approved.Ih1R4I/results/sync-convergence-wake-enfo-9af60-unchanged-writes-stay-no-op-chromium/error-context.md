# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: sync-convergence.spec.ts >> wake enforces reset epoch and client-date scope while unchanged writes stay no-op
- Location: e2e/sync-convergence.spec.ts:2155:1

# Error details

```
Error: expect(received).toMatchObject(expected)

- Expected  - 2
+ Received  + 1

  Object {
-   "snapshotId": "e476deeb761d5dc3415dd8280be3952656fd1ebadcdb0d395c82c21cad92a63c",
-   "unchanged": true,
+   "snapshotId": "acc0c919bf982fce1d814a7b27aff9260ef5b8dd0230ac12f09f7b95d128c769",
  }
```

# Test source

```ts
  2090 |     const seeded = seededPayload(runId);
  2091 |     expect((await putToday(page, seeded)).responseStatus).toBe(200);
  2092 |     await page.reload({ waitUntil: "domcontentloaded" });
  2093 |     await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 20_000 });
  2094 | 
  2095 |     const peerContext = await browser.newContext({
  2096 |       storageState: await page.context().storageState(),
  2097 |     });
  2098 |     const peer = await peerContext.newPage();
  2099 |     try {
  2100 |       await peer.goto("/", { waitUntil: "domcontentloaded" });
  2101 |       await peer.getByTestId("tab-run").waitFor({ state: "attached", timeout: 20_000 });
  2102 |       // Establish the sleeping device's durable pre-edit copy explicitly.
  2103 |       // The page has already completed its normal boot reconciliation; this
  2104 |       // models the copy held by a device that went offline immediately after
  2105 |       // its last successful sync.
  2106 |       await peer.evaluate((payload) => {
  2107 |         localStorage.setItem("run-calc-day", JSON.stringify(payload.dayState));
  2108 |       }, seeded);
  2109 |       await expect.poll(async () => (await localRuns(peer)).some((run) => run.id === runId)).toBe(true);
  2110 | 
  2111 |       // Device B is now asleep/offline with a populated local copy.
  2112 |       await peerContext.setOffline(true);
  2113 |       const deletedPayload: SyncPayload = {
  2114 |         ...seeded,
  2115 |         dayState: {
  2116 |           ...seeded.dayState,
  2117 |           runs: [],
  2118 |           currentIndex: 0,
  2119 |         },
  2120 |         deletedItems: { runs: [runId] },
  2121 |         runValues: {},
  2122 |         runValuesUpdatedAt: {},
  2123 |       };
  2124 |       const activeWrite = await putToday(page, deletedPayload);
  2125 |       expect(activeWrite.responseStatus).toBe(200);
  2126 |       const canonical = activeWrite.body.data as SyncPayload;
  2127 |       expect(canonical.dayState.runs.some((run) => run.id === runId)).toBe(false);
  2128 |       expect(canonical.deletedItems?.runs).toContain(runId);
  2129 | 
  2130 |       // Wake triggers the real foreground reconciliation path.  It must pull
  2131 |       // before releasing queued writes, so the old offline run cannot return.
  2132 |       await peerContext.setOffline(false);
  2133 |       // The reset frame may synchronously reload the page.  Dispatching an
  2134 |       // event through a destroyed execution context would hide the behavior
  2135 |       // under test, so let the browser finish that navigation naturally.
  2136 |       await peer.waitForTimeout(1_000);
  2137 |       await peer.waitForLoadState("domcontentloaded").catch(() => {});
  2138 |       await expect.poll(async () => (await localRuns(peer)).some((run) => run.id === runId), {
  2139 |         timeout: 15_000,
  2140 |       }).toBe(false);
  2141 | 
  2142 |       await peer.getByTestId("tab-run").waitFor({ state: "attached", timeout: 20_000 });
  2143 |       await peer.reload({ waitUntil: "domcontentloaded" });
  2144 |       await peer.getByTestId("tab-run").waitFor({ state: "attached", timeout: 20_000 });
  2145 |       expect((await localRuns(peer)).some((run) => run.id === runId)).toBe(false);
  2146 | 
  2147 |       const server = await getToday(page);
  2148 |       expect((server.dayState as SyncPayload["dayState"]).runs.some((run) => run.id === runId)).toBe(false);
  2149 |     } finally {
  2150 |       await peerContext.close();
  2151 |     }
  2152 |   },
  2153 | );
  2154 | 
  2155 | test(
  2156 |   "wake enforces reset epoch and client-date scope while unchanged writes stay no-op",
  2157 |   async ({ page, browser }: { page: Page; browser: Browser }, testInfo: TestInfo) => {
  2158 |     const username = uid();
  2159 |     users.add(username);
  2160 |     await signUp(page, username);
  2161 |     await promoteToManager(page);
  2162 |     const runId = `reset-wake-${Date.now()}`;
  2163 |     const seeded = seededPayload(runId);
  2164 |     const first = await putToday(page, seeded);
  2165 |     expect(first.responseStatus).toBe(200);
  2166 |     const firstSnapshot = first.body.snapshotId;
  2167 |     expect(typeof firstSnapshot).toBe("string");
  2168 | 
  2169 |     // Assert the no-op before opening the second context. A newly booted peer
  2170 |     // can still finish its initial hydration and issue a legitimate background
  2171 |     // merge; allowing that startup write to race this assertion makes the
  2172 |     // snapshot comparison depend on viewport/project timing rather than the
  2173 |     // unchanged-write contract.
  2174 |     const unchanged = await page.evaluate(async ({ date, payload, snapshotId }) => {
  2175 |       const epochResponse = await fetch("/api/sync/reset-epoch", { cache: "no-store" });
  2176 |       const epoch = (await epochResponse.json() as { epoch?: number }).epoch ?? 0;
  2177 |       const completePayload = { ...payload, baseSnapshotId: snapshotId };
  2178 |       const response = await fetch(`/api/sync/today?today=${date}&epoch=${epoch}`, {
  2179 |         method: "PUT",
  2180 |         headers: { "content-type": "application/json" },
  2181 |         body: JSON.stringify({ senderId: "unchanged-wake", payload: completePayload, snapshotId }),
  2182 |       });
  2183 |       return { status: response.status, body: await response.json() as Record<string, unknown> };
  2184 |     }, {
  2185 |       date: today(),
  2186 |       payload: { ...seeded, baseSnapshotId: firstSnapshot },
  2187 |       snapshotId: firstSnapshot,
  2188 |     });
  2189 |     expect(unchanged.status).toBe(200);
> 2190 |     expect(unchanged.body).toMatchObject({ unchanged: true, snapshotId: firstSnapshot });
       |                            ^ Error: expect(received).toMatchObject(expected)
  2191 |     expect(unchanged.body.data).toBeUndefined();
  2192 | 
  2193 |     const peerContext = await browser.newContext({
  2194 |       storageState: await page.context().storageState(),
  2195 |     });
  2196 |     const peer = await peerContext.newPage();
  2197 |     const peerSyncRequests: Array<Record<string, string | number | boolean | null>> = [];
  2198 |     peer.on("requestfinished", async (request) => {
  2199 |       const url = new URL(request.url());
  2200 |       if (!url.pathname.startsWith("/api/sync/")) return;
  2201 |       const entry: Record<string, string | number | boolean | null> = {
  2202 |         method: request.method(),
  2203 |         path: url.pathname,
  2204 |         queryKeys: [...url.searchParams.keys()].sort().join(","),
  2205 |         epoch: url.searchParams.has("epoch")
  2206 |           ? Number(url.searchParams.get("epoch"))
  2207 |           : null,
  2208 |       };
  2209 |       const response = await request.response().catch(() => null);
  2210 |       entry.status = response?.status() ?? null;
  2211 |       if (url.pathname === "/api/sync/today" && request.method() === "GET" && response?.ok()) {
  2212 |         const body = await response.json().catch(() => null) as {
  2213 |           resetEpoch?: number;
  2214 |           dayState?: { runs?: Array<{ id?: string }> };
  2215 |         } | null;
  2216 |         const runs = body?.dayState?.runs ?? [];
  2217 |         entry.responseEpoch = Number.isSafeInteger(body?.resetEpoch) ? body!.resetEpoch! : null;
  2218 |         entry.responseRunCount = runs.length;
  2219 |         entry.responseContainsTestRun = runs.some((run) => run.id === runId);
  2220 |       }
  2221 |       if (url.pathname === "/api/sync/today" && request.method() === "PUT") {
  2222 |         let body: { payload?: { dayState?: { runs?: Array<{ id?: string }> } } } | null = null;
  2223 |         try {
  2224 |           body = request.postDataJSON() as typeof body;
  2225 |         } catch {
  2226 |           // Keep the diagnostic summary bounded if a request body is malformed.
  2227 |         }
  2228 |         const runs = body?.payload?.dayState?.runs ?? [];
  2229 |         entry.requestRunCount = runs.length;
  2230 |         entry.requestContainsTestRun = runs.some((run) => run.id === runId);
  2231 |       }
  2232 |       peerSyncRequests.push(entry);
  2233 |     });
  2234 |     peer.on("requestfailed", (request) => {
  2235 |       const url = new URL(request.url());
  2236 |       if (!url.pathname.startsWith("/api/sync/")) return;
  2237 |       peerSyncRequests.push({
  2238 |         method: request.method(),
  2239 |         path: url.pathname,
  2240 |         queryKeys: [...url.searchParams.keys()].sort().join(","),
  2241 |         epoch: url.searchParams.has("epoch")
  2242 |           ? Number(url.searchParams.get("epoch"))
  2243 |           : null,
  2244 |         status: null,
  2245 |       });
  2246 |     });
  2247 |     try {
  2248 |       await peer.addInitScript(() => {
  2249 |         // Start without a local day row so the peer must adopt the seeded
  2250 |         // canonical run before it becomes the intentionally stale device.
  2251 |         localStorage.removeItem("run-calc-day");
  2252 |       });
  2253 |       await peer.goto("/", { waitUntil: "domcontentloaded" });
  2254 |       await peer.getByTestId("tab-run").waitFor({ state: "attached", timeout: 20_000 });
  2255 |       await expect(peer.getByTestId("sync-status-button")).toHaveAttribute(
  2256 |         "title",
  2257 |         "Sync connected",
  2258 |         { timeout: 20_000 },
  2259 |       );
  2260 |       await expect.poll(
  2261 |         async () => (await localRuns(peer)).some((run) => run.id === runId),
  2262 |         { timeout: 20_000 },
  2263 |       ).toBe(true);
  2264 |       await peerContext.setOffline(true);
  2265 |       await expect.poll(
  2266 |         () => peer.evaluate(() => navigator.onLine),
  2267 |         { timeout: 5_000 },
  2268 |       ).toBe(false);
  2269 | 
  2270 |       // Use the context request client so the reset broadcast can navigate the
  2271 |       // page without destroying an in-flight page.evaluate execution context.
  2272 |       const resetRequestedAt = Date.now();
  2273 |       const resetResponse = await page.request.post("/api/sync/reset", {
  2274 |         data: { reason: "sync convergence test" },
  2275 |       });
  2276 |       const reset = {
  2277 |         status: resetResponse.status(),
  2278 |         body: await resetResponse.json() as { epoch?: number },
  2279 |       };
  2280 |       expect(reset.status).toBe(200);
  2281 |       expect(reset.body.epoch).toBeGreaterThan(0);
  2282 | 
  2283 |       // The stale device must reconcile the new epoch on wake, not republish
  2284 |       // its pre-reset run.  Failed/reset-stale responses are safe no-ops.
  2285 |       const resetNavigation = peer.waitForEvent("framenavigated", {
  2286 |         predicate: (frame) => frame === peer.mainFrame(),
  2287 |         timeout: 20_000,
  2288 |       });
  2289 |       await peerContext.setOffline(false);
  2290 |       await resetNavigation;
```