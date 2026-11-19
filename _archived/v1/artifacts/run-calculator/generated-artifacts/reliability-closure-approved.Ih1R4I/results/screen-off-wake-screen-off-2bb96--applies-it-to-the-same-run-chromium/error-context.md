# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: screen-off-wake.spec.ts >> screen-off / wake — case counter lifecycle >> wake recovery queues one Stop tap and applies it to the same run
- Location: e2e/screen-off-wake.spec.ts:1631:3

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: getByTestId('foreground-recovery-status')
Expected substring: "Stop applied after recovery"
Received string:    "Latest production snapshot received. Unsaved edits are not confirmed by this refresh; resolve any section warning before saving again.Dismiss"
Timeout: 5000ms

Call log:
  - Expect "toContainText" getByTestId('foreground-recovery-status') with timeout 5000ms
  - waiting for getByTestId('foreground-recovery-status')
    - locator resolved to <div role="status" aria-live="polite" aria-atomic="true" data-component-name="div" data-foreground-sync-ack="4" data-testid="foreground-recovery-status" data-foreground-recovery-state="recovering" data-replit-metadata="artifacts/run-calculator/src/components/ForegroundRecoveryStatus.tsx:20:4" class="print:hidden mb-3 flex items-start gap-2 rounded-md border px-3 py-2 text-sm border-amber-500/40 bg-amber-500/10 text-amber-100">…</div>
    - unexpected value "Still recovering: checking the current production state…"
    12 × locator resolved to <div role="status" aria-live="polite" aria-atomic="true" data-component-name="div" data-foreground-sync-ack="5" data-testid="foreground-recovery-status" data-foreground-recovery-state="outcome" data-replit-metadata="artifacts/run-calculator/src/components/ForegroundRecoveryStatus.tsx:20:4" class="print:hidden mb-3 flex items-start gap-2 rounded-md border px-3 py-2 text-sm border-emerald-500/40 bg-emerald-500/10 text-emerald-200">…</div>
       - unexpected value "Latest production snapshot received. Unsaved edits are not confirmed by this refresh; resolve any section warning before saving again.Dismiss"

```

```yaml
- status:
  - text: Latest production snapshot received. Unsaved edits are not confirmed by this refresh; resolve any section warning before saving again.
  - button "Dismiss"
```

# Test source

```ts
  1564 |     await simulateOnlineWake(page);
  1565 |     await waitForCaseCounterChange(page, casesBaseline, 8_000);
  1566 | 
  1567 |     const casesAfterWake = await readCaseTotal(page);
  1568 |     const delta = casesAfterWake - casesBaseline;
  1569 | 
  1570 |     expect(
  1571 |       casesAfterWake,
  1572 |       `total after +20 min must preserve the baseline and add 50; got ${casesAfterWake}`,
  1573 |     ).toBe(casesBaseline + 50);
  1574 |     expect(
  1575 |       delta,
  1576 |       `delta must be exactly 50 (old 2-case cap would give 2); ` +
  1577 |         `got Δ=${delta} (${casesBaseline}→${casesAfterWake})`,
  1578 |     ).toBe(50);
  1579 |   });
  1580 | 
  1581 |   // ──────────────────────────────────────────────────────────────────────────
  1582 |   // B. Paused run: the case counter stays frozen on wake.
  1583 |   //
  1584 |   //  useAutoTrack.ts: the case-tick effect guards on
  1585 |   //  `(runStatus === "running" || drainActive)` — paused satisfies neither,
  1586 |   //  so the effect exits before writing to skidsCompleted/casesOnCurrentSkid.
  1587 |   //
  1588 |   //  Same midnight-safety approach as Test A (no mid-test restoreDate).
  1589 |   // ──────────────────────────────────────────────────────────────────────────
  1590 |   test("B. paused run: counter stays frozen after screen-off + wake", async ({
  1591 |     page,
  1592 |   }) => {
  1593 |     const safeBaseMs = await setupAndStartRun(page);
  1594 | 
  1595 |     // ── Baseline: running, +15 min → authoritative cadence boundary ─────
  1596 |     await simulateScreenOff(page);
  1597 |     await mockDateNow(page, safeBaseMs + 15 * 60_000);
  1598 |     await simulateOnlineWake(page);
  1599 |     await waitForCaseCounterChange(page, 0, 8_000);
  1600 | 
  1601 |     const casesBeforePause = await readCaseTotal(page);
  1602 |     // elapsed = 15 min exactly → afterTunnel = 10 min → floor(10×60/6) = 100
  1603 |     expect(
  1604 |       [99, 100],
  1605 |       `baseline before pause must be the authoritative boundary value; got ${casesBeforePause}`,
  1606 |     ).toContain(casesBeforePause);
  1607 | 
  1608 |     // ── Pause the run ───────────────────────────────────────────────────
  1609 |     const pauseBtn = page.getByRole("button", { name: /pause.?run/i }).first();
  1610 |     await pauseBtn.waitFor({ state: "visible", timeout: 5_000 });
  1611 |     await pauseBtn.click();
  1612 |     await page.waitForTimeout(600);
  1613 | 
  1614 |     // ── Screen-off + clock advance + wake while paused ──────────────────
  1615 |     // useAutoTrack.ts guard: `(runStatus === "running" || drainActive)`
  1616 |     // Paused → neither true → early return → no write to case counter.
  1617 |     // Do NOT call restoreDate here (see Test A comment on midnight safety).
  1618 |     await simulateScreenOff(page);
  1619 |     await mockDateNow(page, safeBaseMs + 20 * 60_000);
  1620 |     await simulateOnlineWake(page);
  1621 |     // Give React 2 s to settle — counter must NOT change.
  1622 |     await page.waitForTimeout(2_000);
  1623 | 
  1624 |     const casesAfterPausedWake = await readCaseTotal(page);
  1625 |     expect(
  1626 |       casesAfterPausedWake,
  1627 |       `paused wake: expected ${casesBeforePause}, got ${casesAfterPausedWake}`,
  1628 |     ).toBe(casesBeforePause);
  1629 |   });
  1630 | 
  1631 |   test("wake recovery queues one Stop tap and applies it to the same run", async ({
  1632 |     page,
  1633 |   }) => {
  1634 |     const safeBaseMs = await setupAndStartRun(page);
  1635 |     let heldWakePulls = 0;
  1636 |     let releaseWakePull!: () => void;
  1637 |     const wakePullReleased = new Promise<void>((resolve) => {
  1638 |       releaseWakePull = resolve;
  1639 |     });
  1640 | 
  1641 |     await page.route("**/api/sync/today**", async (route) => {
  1642 |       if (route.request().method() === "GET" && heldWakePulls === 0) {
  1643 |         heldWakePulls += 1;
  1644 |         await wakePullReleased;
  1645 |       }
  1646 |       await route.continue();
  1647 |     });
  1648 | 
  1649 |     await simulateScreenOff(page);
  1650 |     await mockDateNow(page, safeBaseMs + 30_000);
  1651 |     await simulateWake(page);
  1652 |     await expect.poll(() => heldWakePulls, { timeout: 8_000 }).toBe(1);
  1653 | 
  1654 |     const stopButton = page.getByRole("button", { name: /^stop.?run$/i }).first();
  1655 |     await stopButton.click();
  1656 |     await expect(page.getByTestId("foreground-recovery-status"))
  1657 |       .toContainText("Stop requested");
  1658 |     await expect(page.getByRole("button", { name: /stop.?requested/i }))
  1659 |       .toBeDisabled();
  1660 |     releaseWakePull();
  1661 |     await expect(page.getByText("Ended", { exact: true }).first())
  1662 |       .toBeVisible({ timeout: 15_000 });
  1663 |     await expect(page.getByTestId("foreground-recovery-status"))
> 1664 |       .toContainText("Stop applied after recovery");
       |        ^ Error: expect(locator).toContainText(expected) failed
  1665 |   });
  1666 | 
  1667 |   test(
  1668 |     "responsive display matches shared line occupancy while running, paused, and draining",
  1669 |     async ({ page }) => {
  1670 |       await page.setViewportSize({ width: 390, height: 844 });
  1671 |       const safeBaseMs = await setupAndStartRun(page);
  1672 |       const lineHistoryStartOffsetMs = 10 * 60_000;
  1673 |       const fixtureDate = new Date(safeBaseMs).toISOString().slice(0, 10);
  1674 |       const offsetStartResponse = await page.request.post(
  1675 |         `/api/sync/e2e/auto-track-tick?today=${fixtureDate}`,
  1676 |         {
  1677 |           data: {
  1678 |             nowMs: Date.now(),
  1679 |             rearm: true,
  1680 |             startOffsetMs: lineHistoryStartOffsetMs,
  1681 |           },
  1682 |         },
  1683 |       );
  1684 |       expect(
  1685 |         offsetStartResponse.ok(),
  1686 |         `could not seed bounded historical line occupancy: HTTP ${offsetStartResponse.status()}`,
  1687 |       ).toBe(true);
  1688 |       const adjustedStartedAt = safeBaseMs - lineHistoryStartOffsetMs;
  1689 |       await expect.poll(async () => (await readLiveRunMeta(page)).startedAt)
  1690 |         .toBe(adjustedStartedAt);
  1691 |       await expect(page.getByTestId("foreground-recovery-status"))
  1692 |         .toHaveAttribute("data-foreground-recovery-state", "outcome", { timeout: 20_000 });
  1693 |       expect(
  1694 |         await currentForegroundSyncAck(page),
  1695 |         "setup foreground recovery must be acknowledged before testing another wake",
  1696 |       ).toBeGreaterThan(0);
  1697 |       const occupancy = { ppm: 60, pizzasPerCase: 6, freezerTimeMin: 5 };
  1698 |       const expectedRunning = computeCasesOnLine({
  1699 |         startedAt: adjustedStartedAt,
  1700 |         now: safeBaseMs + 2 * 60_000,
  1701 |         ...occupancy,
  1702 |       });
  1703 | 
  1704 |       const runningProjection = await mockDateNow(page, safeBaseMs + 2 * 60_000);
  1705 |       expect(
  1706 |         runningProjection.operationalProjection?.counters?.casesOnLine,
  1707 |         `running projection missing; projected=${runningProjection.projected}; `
  1708 |         + `fixtureDate=${runningProjection.fixtureDate}; schedule=${JSON.stringify(runningProjection.autoTrackSchedule)}`,
  1709 |       ).toBe(expectedRunning);
  1710 |       await simulateScreenOff(page);
  1711 |       await mockDateNow(page, safeBaseMs + 2 * 60_000 + 501, { tick: false });
  1712 |       await simulateOnlineWake(page);
  1713 |       await expect.poll(() => liveProjectionMatchesCasesOnLine(page), {
  1714 |         timeout: 10_000,
  1715 |         message: "running display did not match the fresh server-time line projection",
  1716 |       }).toBe(true);
  1717 | 
  1718 |       const pauseButton = page.getByRole("button", { name: /pause.?run/i }).first();
  1719 |       await page.locator('[data-testid="tab-run"]').click();
  1720 |       await page.evaluate((ms) => {
  1721 |         (window as unknown as Record<string, unknown>).__testFakeMs = ms;
  1722 |       }, Date.now());
  1723 |       await pauseButton.click();
  1724 |       await chooseRunningTunnelIfPrompted(page);
  1725 |       let canonicalPausedAt = 0;
  1726 |       let canonicalPausedDate = "";
  1727 |       await expect.poll(async () => {
  1728 |         const canonicalPausedMeta = await readLiveRunMeta(page);
  1729 |         canonicalPausedAt = Number(canonicalPausedMeta.pausedAt ?? 0);
  1730 |         canonicalPausedDate = canonicalPausedMeta.date ?? "";
  1731 |         return canonicalPausedAt > 0;
  1732 |       }, { timeout: 15_000 }).toBe(true);
  1733 | 
  1734 |       const pausedProjection = await mockDateNow(page, safeBaseMs + 12 * 60_000);
  1735 |       const expectedPaused = pausedProjection.operationalProjection?.counters?.casesOnLine;
  1736 |       expect(
  1737 |         expectedPaused,
  1738 |         `paused projection missing; projected=${pausedProjection.projected}; `
  1739 |         + `fixtureDate=${pausedProjection.fixtureDate}; canonicalDate=${canonicalPausedDate}; `
  1740 |         + `revision=${pausedProjection.canonicalRevision}; snapshot=${pausedProjection.snapshotId}; `
  1741 |         + `schedule=${JSON.stringify(pausedProjection.autoTrackSchedule)}`,
  1742 |       ).toEqual(expect.any(Number));
  1743 |       await simulateScreenOff(page);
  1744 |       await simulateOnlineWake(page);
  1745 |       await expect.poll(() => liveProjectionMatchesCasesOnLine(page), {
  1746 |         timeout: 10_000,
  1747 |         message: "paused display did not match the fresh server line projection",
  1748 |       }).toBe(true);
  1749 | 
  1750 |     await page.evaluate((ms) => {
  1751 |       (window as unknown as Record<string, unknown>).__testFakeMs = ms;
  1752 |     }, canonicalPausedAt + 1_000);
  1753 |     await page
  1754 |       .locator(
  1755 |         '[data-testid="resume-run"]:visible, [data-testid="floor-resume-run"]:visible',
  1756 |       ).first().click();
  1757 |       await expect(page.getByRole("button", { name: /pause.?run/i }).first()).toBeVisible();
  1758 |       await expect.poll(async () => {
  1759 |         const run = await readLiveRunMeta(page);
  1760 |         return run.pausedAt == null;
  1761 |       }, { timeout: 20_000 }).toBe(true);
  1762 | 
  1763 |       // The canonical lifecycle retains the physical start and records the
  1764 |       // closed pause separately.
```