# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: sync-convergence.spec.ts >> stale-base recovery keeps the server conflict, reapplies independent edits and settles after reload
- Location: e2e/sync-convergence.spec.ts:1487:1

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: true
Received: undefined
```

# Test source

```ts
  1608 |       if (request.method() !== "PUT" || !request.url().includes("/api/sync/today")) return;
  1609 |       try {
  1610 |         const body = request.postDataJSON() as {
  1611 |           payload?: { runValues?: Record<string, {
  1612 |             casesNeeded?: number;
  1613 |             pizzasPerCase?: number;
  1614 |             casesPerSkid?: number;
  1615 |           }> };
  1616 |         };
  1617 |         const values = body.payload?.runValues?.[runId];
  1618 |         if (typeof values?.casesNeeded === "number") {
  1619 |           runValueWrites.push(values.casesNeeded);
  1620 |           runValueWritePayloads.push({
  1621 |             casesNeeded: values.casesNeeded,
  1622 |             pizzasPerCase: values.pizzasPerCase,
  1623 |             casesPerSkid: values.casesPerSkid,
  1624 |           });
  1625 |         }
  1626 |       } catch {
  1627 |         // Ignore unrelated requests with no JSON body.
  1628 |       }
  1629 |     });
  1630 |     page.on("response", (response) => {
  1631 |       const request = response.request();
  1632 |       if (request.method() !== "PUT" || !request.url().includes("/api/sync/today")) return;
  1633 |       let value: number | undefined;
  1634 |       try {
  1635 |         const body = request.postDataJSON() as {
  1636 |           payload?: { runValues?: Record<string, { casesNeeded?: number }> };
  1637 |         };
  1638 |         value = body.payload?.runValues?.[runId]?.casesNeeded;
  1639 |       } catch {
  1640 |         return;
  1641 |       }
  1642 |       if (typeof value !== "number") return;
  1643 |       void response.json().then((body: { canonicalRevision?: unknown }) => {
  1644 |         runValueWriteResponses.push({
  1645 |           value,
  1646 |           status: response.status(),
  1647 |           responseKind: response.headers()["x-sync-response"] ?? "missing",
  1648 |           canonicalRevision: typeof body.canonicalRevision === "number"
  1649 |             ? body.canonicalRevision
  1650 |             : null,
  1651 |         });
  1652 |       }).catch(() => {});
  1653 |     });
  1654 |     let recoveryCopyFaultInjected = false;
  1655 |     await page.route("**/api/sync/today**", async (route) => {
  1656 |       const request = route.request();
  1657 |       if (recoveryCopyFaultInjected || request.method() !== "PUT") {
  1658 |         await route.continue();
  1659 |         return;
  1660 |       }
  1661 |       let cases: number | undefined;
  1662 |       try {
  1663 |         const body = request.postDataJSON() as {
  1664 |           payload?: { runValues?: Record<string, { casesNeeded?: number }> };
  1665 |         };
  1666 |         cases = body.payload?.runValues?.[runId]?.casesNeeded;
  1667 |       } catch {
  1668 |         // Keep unrelated or malformed requests on the ordinary route.
  1669 |       }
  1670 |       if (cases !== 777) {
  1671 |         await route.continue();
  1672 |         return;
  1673 |       }
  1674 |       recoveryCopyFaultInjected = true;
  1675 |       const response = await route.fetch();
  1676 |       await page.evaluate(() => {
  1677 |         (window as unknown as { armRecoveryCopyStorageFailure: () => void })
  1678 |           .armRecoveryCopyStorageFailure();
  1679 |       });
  1680 |       await route.fulfill({ response });
  1681 |     });
  1682 |     const staleWriteResponse = page.waitForResponse((response) => {
  1683 |       if (response.request().method() !== "PUT" || !response.url().includes("/api/sync/today")) {
  1684 |         return false;
  1685 |       }
  1686 |       try {
  1687 |         const body = response.request().postDataJSON() as {
  1688 |           payload?: { runValues?: Record<string, { casesNeeded?: number }> };
  1689 |         };
  1690 |         return body.payload?.runValues?.[runId]?.casesNeeded === 777;
  1691 |       } catch {
  1692 |         return false;
  1693 |       }
  1694 |     });
  1695 |     const lineSetup = page.locator("details").filter({
  1696 |       has: page.locator("summary", { hasText: /line.?setup/i }),
  1697 |     }).first();
  1698 |     if (!(await lineSetup.evaluate((element) => (element as HTMLDetailsElement).open))) {
  1699 |       await lineSetup.locator("summary").click();
  1700 |     }
  1701 |     await page.getByTestId("input-pizzasPerCase").fill("8");
  1702 |     await page.getByTestId("input-pizzasPerCase").blur();
  1703 |     await page.getByTestId("input-casesPerSkid").fill("16");
  1704 |     await page.getByTestId("input-casesPerSkid").blur();
  1705 |     await casesNeeded.fill("777");
  1706 |     const response = await staleWriteResponse;
  1707 |     expect(response.status()).toBe(200);
> 1708 |     expect((await response.json() as { partialFallback?: boolean }).partialFallback).toBe(true);
       |                                                                                      ^ Error: expect(received).toBe(expected) // Object.is equality
  1709 |     expect(recoveryCopyFaultInjected).toBe(true);
  1710 |     await expect.poll(() => page.evaluate(() => (
  1711 |       window as unknown as { recoveryCopyStorageFailureOccurred: boolean }
  1712 |     ).recoveryCopyStorageFailureOccurred)).toBe(true);
  1713 | 
  1714 |     await expect(casesNeeded).toHaveValue("999", { timeout: 15_000 });
  1715 |     await expect(page.getByTestId("input-pizzasPerCase")).toHaveValue("8");
  1716 |     await expect(page.getByTestId("input-casesPerSkid")).toHaveValue("16");
  1717 |     await expect.poll(() => page.evaluate((id) => {
  1718 |       const raw = localStorage.getItem(`run-calc-run-${id}`);
  1719 |       const values = JSON.parse(raw ?? "{}") as {
  1720 |         casesNeeded?: number;
  1721 |         pizzasPerCase?: number;
  1722 |         casesPerSkid?: number;
  1723 |       };
  1724 |       return {
  1725 |         casesNeeded: values.casesNeeded,
  1726 |         pizzasPerCase: values.pizzasPerCase,
  1727 |         casesPerSkid: values.casesPerSkid,
  1728 |       };
  1729 |     }, runId)).toEqual({
  1730 |       casesNeeded: 999,
  1731 |       pizzasPerCase: 8,
  1732 |       casesPerSkid: 16,
  1733 |     });
  1734 |     await page.getByTestId("sync-status-button").click();
  1735 |     const conflictActivity = page.locator('[data-testid^="sync-activity-"]')
  1736 |       .filter({ hasText: "discarded the conflicting local value" });
  1737 |     await expect(conflictActivity).toBeVisible({ timeout: 10_000 });
  1738 |     await expect(conflictActivity).toContainText("kept the server value for 1 conflict");
  1739 |     await expect(conflictActivity).toContainText(/reapplied \d+ changes/);
  1740 |     await expect(conflictActivity).toContainText("browser storage did not save this rebase for reload");
  1741 |     await expect(conflictActivity).toContainText("review the current value before editing again");
  1742 | 
  1743 |     const pendingWrites = page.getByText("Pending writes", { exact: true });
  1744 |     await expect(pendingWrites).toBeVisible();
  1745 |     await expect.poll(async () => Number(await pendingWrites.evaluate(
  1746 |       (element) => element.nextElementSibling?.textContent?.trim() ?? "NaN",
  1747 |     ))).toBe(0);
  1748 | 
  1749 |     expectCanonicalConflictSequence();
  1750 |     await expect.poll(() => runValueWriteResponses.length).toBe(runValueWrites.length);
  1751 |     const settledWriteCount = runValueWrites.length;
  1752 |     expect(runValueWriteResponses[0]).toMatchObject({
  1753 |       value: 777,
  1754 |       status: 200,
  1755 |       responseKind: "partial-fallback",
  1756 |     });
  1757 |     for (let reload = 0; reload < 2; reload += 1) {
  1758 |       const revisionBeforeReload = Number((await getToday(page)).canonicalRevision);
  1759 |       expect(Number.isSafeInteger(revisionBeforeReload)).toBe(true);
  1760 |       const responsesBeforeReload = runValueWriteResponses.length;
  1761 |       await page.reload({ waitUntil: "domcontentloaded" });
  1762 |       await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 20_000 });
  1763 |       await page.getByTestId("tab-run").click();
  1764 |       await expect(casesNeeded).toHaveValue("999", { timeout: 20_000 });
  1765 |       await expect(page.getByTestId("input-pizzasPerCase")).toHaveValue("8");
  1766 |       await expect(page.getByTestId("input-casesPerSkid")).toHaveValue("16");
  1767 |       await expect.poll(() => page.evaluate((id) => {
  1768 |         const raw = localStorage.getItem(`run-calc-run-${id}`);
  1769 |         const values = JSON.parse(raw ?? "{}") as {
  1770 |           casesNeeded?: number;
  1771 |           pizzasPerCase?: number;
  1772 |           casesPerSkid?: number;
  1773 |         };
  1774 |         return {
  1775 |           casesNeeded: values.casesNeeded,
  1776 |           pizzasPerCase: values.pizzasPerCase,
  1777 |           casesPerSkid: values.casesPerSkid,
  1778 |         };
  1779 |       }, runId)).toEqual({
  1780 |         casesNeeded: 999,
  1781 |         pizzasPerCase: 8,
  1782 |         casesPerSkid: 16,
  1783 |       });
  1784 |       await expect(page.getByTestId("sync-status-button")).toHaveAttribute(
  1785 |         "title",
  1786 |         "Sync connected",
  1787 |         { timeout: 20_000 },
  1788 |       );
  1789 | 
  1790 |       await page.getByTestId("sync-status-button").click();
  1791 |       await expect(conflictActivity).toBeVisible({ timeout: 10_000 });
  1792 |       await expect(conflictActivity).toContainText("kept the server value for 1 conflict");
  1793 |        await expect(conflictActivity).toContainText(/reapplied \d+ changes/);
  1794 |       await expect(conflictActivity).toContainText("browser storage did not save this rebase for reload");
  1795 |       await expect(pendingWrites).toBeVisible();
  1796 |       await expect.poll(async () => Number(await pendingWrites.evaluate(
  1797 |         (element) => element.nextElementSibling?.textContent?.trim() ?? "NaN",
  1798 |       ))).toBe(0);
  1799 |       expectCanonicalConflictSequence();
  1800 |       expect(runValueWrites).toHaveLength(settledWriteCount);
  1801 |       const revisionAfterReload = Number((await getToday(page)).canonicalRevision);
  1802 |       expect(revisionAfterReload).toBe(revisionBeforeReload);
  1803 |       await expect.poll(() => runValueWriteResponses.length)
  1804 |         .toBe(runValueWrites.length);
  1805 |       expect(runValueWriteResponses.slice(responsesBeforeReload).every((result) =>
  1806 |         result.value === 999 && result.status === 200,
  1807 |       )).toBe(true);
  1808 |     }
```