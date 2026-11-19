# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: screen-off-wake.spec.ts >> screen-off / wake — case counter lifecycle >> speed adjustment during a dough run stays aligned across screen wake
- Location: e2e/screen-off-wake.spec.ts:2148:3

# Error details

```
Error: post-wake dough cadence did not use the edited speed

post-wake dough cadence did not use the edited speed

expect(received).toEqual(expected) // deep equality

- Expected  - 1
+ Received  + 1

  Object {
    "batches": 1.5,
-   "trays": 8,
+   "trays": 9,
  }

Call Log:
- Timeout 10000ms exceeded while waiting on the predicate
```

# Test source

```ts
  2446 |     expect(postWakeDough.trays).toBeLessThanOrEqual(10);
  2447 |     expect(postWakeDough.batches).toBeGreaterThan(0);
  2448 |     expect(postWakeDough.batches).toBeLessThanOrEqual(2);
  2449 | 
  2450 |     // Advance to the server's next edited-speed batch-consumption boundary.
  2451 |     // The fixture has shared recipe data, so a hard-coded tray/batch interval
  2452 |     // would not necessarily be due after 4.1 seconds.
  2453 |     const nextVisibleIntervalAt = Math.max(
  2454 |       wakeAt + 1,
  2455 |       nextBatchConsumption.dueAt + 1,
  2456 |     );
  2457 |     const cadenceBeat = await mockDateNow(page, nextVisibleIntervalAt);
  2458 |     const cadenceEntries = (
  2459 |       cadenceBeat.autoTrackSchedule as {
  2460 |         entries?: Array<{
  2461 |           channel?: string;
  2462 |           dueNow?: boolean;
  2463 |           dueAt?: number;
  2464 |           nextDueAt?: number;
  2465 |         }>;
  2466 |       } | undefined
  2467 |     )?.entries?.map(({ channel, dueNow, dueAt, nextDueAt }) => ({
  2468 |       channel,
  2469 |       dueNow,
  2470 |       dueAt,
  2471 |       nextDueAt,
  2472 |     }));
  2473 |     expect(
  2474 |       cadenceBeat.accepted ?? 0,
  2475 |       `edited-speed cadence beat accepted no canonical claim; `
  2476 |       + `builtClaims=${cadenceBeat.builtClaims}; outcomes=${JSON.stringify(cadenceBeat.outcomes)}; `
  2477 |       + `schedule=${JSON.stringify(cadenceEntries)}`,
  2478 |     ).toBeGreaterThan(0);
  2479 |     const authoritativeTrays =
  2480 |       cadenceBeat.operationalProjection?.counters?.traysOnLine;
  2481 |     const authoritativeBatches =
  2482 |       cadenceBeat.operationalProjection?.counters?.batchesReady;
  2483 |     expect(authoritativeTrays).toEqual(expect.any(Number));
  2484 |     expect(authoritativeBatches).toEqual(expect.any(Number));
  2485 |     const syncAckBeforeWake = await recoveryStatus.getAttribute(
  2486 |       "data-foreground-sync-ack",
  2487 |     );
  2488 |     const wakeClaimChannels: string[] = [];
  2489 |     const recordWakeClaim = (request: Request) => {
  2490 |       if (
  2491 |         request.method() !== "POST" ||
  2492 |         !new URL(request.url()).pathname.endsWith("/api/sync/auto-track/claim")
  2493 |       )
  2494 |         return;
  2495 |       const claim = request.postDataJSON()?.claim as
  2496 |         { channel?: string } | undefined;
  2497 |       if (
  2498 |         claim?.channel === "tray-produce" ||
  2499 |         claim?.channel === "batch-consume"
  2500 |       ) {
  2501 |         wakeClaimChannels.push(claim.channel);
  2502 |       }
  2503 |     };
  2504 |     page.on("request", recordWakeClaim);
  2505 |     // The fixture tick above accepts a simulated visible interval, but the
  2506 |     // canonical projection deliberately keeps its server timestamp on wall
  2507 |     // time. Do not wait for wall time to catch up with the synthetic client
  2508 |     // clock or rewind the page clock before waking; keep the browser timeline
  2509 |     // monotonic and let the wake reconcile against the real server snapshot.
  2510 |     const latestServerSnapshot = await readLiveRunSnapshot(page);
  2511 |     const latestServerTimeMs = Number(
  2512 |       latestServerSnapshot.operationalProjection?.serverTimeMs ?? 0,
  2513 |     );
  2514 |     expect(latestServerTimeMs).toBeGreaterThan(0);
  2515 |     const finalWakeAt = Math.max(
  2516 |       nextVisibleIntervalAt + 1,
  2517 |       latestServerTimeMs,
  2518 |     );
  2519 |     expect(finalWakeAt).toBeGreaterThan(nextVisibleIntervalAt);
  2520 |     await mockDateNow(page, finalWakeAt, { tick: false });
  2521 |     const finalWakeResponsePromise = page.waitForResponse(
  2522 |       (response) =>
  2523 |         response.request().method() === "GET" &&
  2524 |         new URL(response.url()).pathname === "/api/sync/today",
  2525 |     );
  2526 |     await simulateScreenOff(page);
  2527 |     await simulateWake(page);
  2528 |     await expect
  2529 |       .poll(() => recoveryStatus.getAttribute("data-foreground-sync-ack"), {
  2530 |         timeout: 10_000,
  2531 |         message:
  2532 |           "wake did not acknowledge shared sync after releasing its fence",
  2533 |       })
  2534 |       .not.toBe(syncAckBeforeWake);
  2535 |     // With server authority enabled, the browser must never duplicate the
  2536 |     // server beat by issuing its retired client-side dough claims.
  2537 |     expect(
  2538 |       wakeClaimChannels,
  2539 |       "authoritative wake emitted browser claims",
  2540 |     ).toEqual([]);
  2541 |     await expect
  2542 |       .poll(() => readDoughCounters(page), {
  2543 |         timeout: 10_000,
  2544 |         message: "post-wake dough cadence did not use the edited speed",
  2545 |       })
> 2546 |       .toEqual({
       |        ^ Error: post-wake dough cadence did not use the edited speed
  2547 |         trays: authoritativeTrays,
  2548 |         batches: authoritativeBatches,
  2549 |       });
  2550 |     // The foreground-sync acknowledgment is the wake boundary. Verify the
  2551 |     // authoritative server snapshot below instead of waiting on a secondary
  2552 |     // local snapshot push after the wake.
  2553 |     page.off("request", recordWakeClaim);
  2554 |     const finalWakeResponse = await finalWakeResponsePromise;
  2555 |     expect(finalWakeResponse.ok()).toBe(true);
  2556 |     const finalWakePayload = (await finalWakeResponse.json()) as {
  2557 |       operationalProjection?: {
  2558 |         runId?: string;
  2559 |         counters?: {
  2560 |           traysOnLine?: number;
  2561 |           batchesReady?: number;
  2562 |           casesCompleted?: number;
  2563 |         };
  2564 |         calc?: {
  2565 |           casesOnLine?: number;
  2566 |           batchesNeeded?: number;
  2567 |           traysNeeded?: number;
  2568 |         };
  2569 |       } | null;
  2570 |       data?: {
  2571 |         operationalProjection?: {
  2572 |           runId?: string;
  2573 |           counters?: {
  2574 |             traysOnLine?: number;
  2575 |             batchesReady?: number;
  2576 |             casesCompleted?: number;
  2577 |           };
  2578 |           calc?: {
  2579 |             casesOnLine?: number;
  2580 |             batchesNeeded?: number;
  2581 |             traysNeeded?: number;
  2582 |           };
  2583 |         } | null;
  2584 |       };
  2585 |     };
  2586 | 
  2587 |     const snapshot = await readLiveRunSnapshot(page);
  2588 |     const values = snapshot.values;
  2589 |     await page.locator('[data-testid="tab-run"]').click();
  2590 |     const casesCompleted =
  2591 |       Number(values.skidsCompleted ?? 0) * Number(values.casesPerSkid ?? 0) +
  2592 |       Number(values.casesOnCurrentSkid ?? 0);
  2593 |     expect(
  2594 |       casesCompleted,
  2595 |       "visible case count must match the live run payload",
  2596 |     ).toBe(await readCaseTotal(page));
  2597 |     expect(
  2598 |       casesCompleted,
  2599 |       "the new speed has not reached the freezer exit yet",
  2600 |     ).toBe(0);
  2601 |     expect(values.speedAdjustment).toBe(0.5);
  2602 |     expect(values.traysOnLine).toBe(authoritativeTrays);
  2603 |     expect(values.batchesReady).toBe(authoritativeBatches);
  2604 |     // The final wake adopts a fresh server-time projection without rewinding
  2605 |     // the fixture clock from its simulated cadence time.
  2606 |     const postWakeSnapshot = await readLiveRunSnapshot(page);
  2607 |     const postWakeValues = postWakeSnapshot.values;
  2608 |     const wakeProjection =
  2609 |       finalWakePayload.operationalProjection ??
  2610 |       finalWakePayload.data?.operationalProjection;
  2611 |     expect(wakeProjection?.runId).toBe(postWakeSnapshot.runId);
  2612 |     expect(wakeProjection?.counters?.traysOnLine).toBe(authoritativeTrays);
  2613 |     expect(wakeProjection?.counters?.batchesReady).toBe(authoritativeBatches);
  2614 |     expect(wakeProjection?.counters?.casesCompleted).toBe(
  2615 |       Number(postWakeValues.skidsCompleted ?? 0) * Number(postWakeValues.casesPerSkid ?? 0) +
  2616 |         Number(postWakeValues.casesOnCurrentSkid ?? 0),
  2617 |     );
  2618 |     expect(postWakeValues.speedAdjustment).toBe(0.5);
  2619 |     const currentProjection = postWakeSnapshot.operationalProjection;
  2620 |     expect(currentProjection?.runId).toBe(postWakeSnapshot.runId);
  2621 |     expect(currentProjection?.counters?.traysOnLine).toBe(postWakeValues.traysOnLine);
  2622 |     expect(currentProjection?.counters?.batchesReady).toBe(postWakeValues.batchesReady);
  2623 |     expect(currentProjection?.counters?.casesCompleted).toBe(
  2624 |       Number(postWakeValues.skidsCompleted ?? 0) * Number(postWakeValues.casesPerSkid ?? 0) +
  2625 |         Number(postWakeValues.casesOnCurrentSkid ?? 0),
  2626 |     );
  2627 |     const confirmedCalc = currentProjection?.calc;
  2628 |     expect(confirmedCalc?.casesOnLine).toEqual(expect.any(Number));
  2629 |     expect(confirmedCalc?.batchesNeeded).toEqual(expect.any(Number));
  2630 |     expect(confirmedCalc?.traysNeeded).toEqual(expect.any(Number));
  2631 |     await page.locator('[data-testid="tab-dough"]').click();
  2632 |     await page
  2633 |       .getByText("Machine Times", { exact: true })
  2634 |       .waitFor({ state: "visible" });
  2635 |     await expect(page.getByTestId("output-batches-needed")).toHaveText(
  2636 |       confirmedCalc!.batchesNeeded!.toFixed(2),
  2637 |       { timeout: 5_000 },
  2638 |     );
  2639 |     await expect(page.getByTestId("output-trays-needed")).toHaveText(
  2640 |       confirmedCalc!.traysNeeded!.toFixed(0),
  2641 |       { timeout: 20_000 },
  2642 |     );
  2643 |     await expect(page.locator('input[name="traysOnLine"]')).toHaveValue(
  2644 |       String(authoritativeTrays),
  2645 |     );
  2646 |     await expect(page.locator('input[name="batchesReady"]')).toHaveValue(
```