# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: pwa-handoff.spec.ts >> PWA update handoff >> preserves unsafe work, then auto-reloads after safe inactivity
- Location: e2e/pwa-handoff.spec.ts:1793:3

# Error details

```
Error: expect(locator).toHaveCount(expected) failed

Locator:  getByRole('button', { name: 'App updates · Update ready', exact: true })
Expected: 1
Received: 0
Timeout:  5000ms

Call log:
  - Expect "toHaveCount" getByRole('button', { name: 'App updates · Update ready', exact: true }) with timeout 5000ms
  - waiting for getByRole('button', { name: 'App updates · Update ready', exact: true })
    14 × locator resolved to 0 elements
       - unexpected value "0"

```

# Test source

```ts
  1767 |             loaded: false,
  1768 |             errorName: error instanceof Error ? error.name : "unknown",
  1769 |           };
  1770 |         }
  1771 |       }, heicChunk);
  1772 |       expect(deferredFailure.loaded).toBe(false);
  1773 |       await page.context().setOffline(false);
  1774 |       // A failed module fetch is retained by the current document's module
  1775 |       // loader. Reopening after connectivity returns models the user's recovery
  1776 |       // path and gives the browser a fresh module graph for its on-demand retry.
  1777 |       await page.goto("about:blank");
  1778 |       await page.goto(server.baseUrl, { waitUntil: "domcontentloaded" });
  1779 |       await expect(page.getByRole("button", { name: "STOP RUN" })).toBeVisible();
  1780 |       const deferredRecovery = await page.evaluate(async (assetPath) => {
  1781 |         const module = await import(new URL(assetPath, location.href).href) as {
  1782 |           default?: unknown;
  1783 |         };
  1784 |         return typeof module.default;
  1785 |       }, heicChunk);
  1786 |       expect(deferredRecovery).toBe("function");
  1787 |     } finally {
  1788 |       await page.context().setOffline(false);
  1789 |       await server.close();
  1790 |     }
  1791 |   });
  1792 | 
  1793 |   test("preserves unsafe work, then auto-reloads after safe inactivity", async ({
  1794 |     page,
  1795 |   }) => {
  1796 |     const server = await startVersionedServer({
  1797 |       old: fixture.oldDir,
  1798 |       new: fixture.newDir,
  1799 |     }, fixture.staleHomeChunk, { sessionRecovery: true, lifecycleSnapshot: true });
  1800 | 
  1801 |     try {
  1802 |       await page.addInitScript(() => {
  1803 |         if (sessionStorage.getItem("__pwaSmokeRunSeeded") === "1") return;
  1804 |         const now = new Date();
  1805 |         const date = [
  1806 |           now.getFullYear(),
  1807 |           String(now.getMonth() + 1).padStart(2, "0"),
  1808 |           String(now.getDate()).padStart(2, "0"),
  1809 |         ].join("-");
  1810 |         localStorage.setItem("run-calc-day", JSON.stringify({
  1811 |           runs: [{
  1812 |             id: "pwa-smoke-active-run",
  1813 |             brand: "",
  1814 |             flavor: "",
  1815 |             startedAt: 1_000,
  1816 |           }, {
  1817 |             id: "pwa-smoke-next-run",
  1818 |             brand: "",
  1819 |             flavor: "",
  1820 |           }],
  1821 |           currentIndex: 0,
  1822 |           date,
  1823 |           substitutions: [],
  1824 |           substitutionLog: [],
  1825 |           stagedItems: {},
  1826 |           prepPhase: {
  1827 |             prepStartedAt: null,
  1828 |             prepBatchesDough: 0,
  1829 |             prepBatchesSauce: 0,
  1830 |             prepCarriedOver: false,
  1831 |           },
  1832 |         }));
  1833 |         sessionStorage.setItem("__pwaSmokeRunSeeded", "1");
  1834 |       });
  1835 |       // The app keeps service-worker/update work alive, so networkidle is not
  1836 |       // a stable readiness signal for this fixture. The document marker and
  1837 |       // service-worker assertions below provide the real readiness checks.
  1838 |       await page.goto(server.baseUrl, { waitUntil: "domcontentloaded" });
  1839 |       await expect(page.locator("body")).toHaveAttribute("data-pwa-smoke-build", "old");
  1840 |       await page.waitForFunction(async () => {
  1841 |         const registration = await navigator.serviceWorker.ready;
  1842 |         return registration.active?.state === "activated";
  1843 |       });
  1844 |       // The very first install does not control its already-open page. Reload
  1845 |       // into the old revision before publishing the new one so the test models
  1846 |       // a staff tab that genuinely has an older deployed worker in control.
  1847 |       // Leave the scope before opening the controlled document so Chromium
  1848 |       // cannot reuse the initial uncontrolled navigation during activation.
  1849 |       await page.goto("about:blank");
  1850 |       await page.goto(server.baseUrl, { waitUntil: "domcontentloaded" });
  1851 |       await expect(page.locator("body")).toHaveAttribute("data-pwa-smoke-build", "old");
  1852 |       await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  1853 |       const stopRun = page.getByRole("button", { name: "STOP RUN" });
  1854 |       await expect(stopRun).toBeVisible();
  1855 | 
  1856 |       server.publish("new");
  1857 |       await page.evaluate(async () => {
  1858 |         const registration = await navigator.serviceWorker.ready;
  1859 |         if (!registration) throw new Error("Expected a service-worker registration");
  1860 |         await registration.update();
  1861 |       });
  1862 | 
  1863 |       const updateMessage = page.getByRole("button", {
  1864 |         name: "App updates · Update ready", exact: true,
  1865 |       });
  1866 |       const reloadAction = page.getByRole("button", { name: "Update app", exact: true });
> 1867 |       await expect(updateMessage).toHaveCount(1);
       |                                   ^ Error: expect(locator).toHaveCount(expected) failed
  1868 |       await expect(reloadAction).toHaveCount(1);
  1869 |       await expect(updateMessage).toBeVisible({
  1870 |         timeout: 20_000,
  1871 |       });
  1872 |       await expect(reloadAction).toBeVisible();
  1873 |       await reloadAction.click();
  1874 |       await expect(page.getByRole("button", {
  1875 |         name: "App updates · Waiting for work to save", exact: true,
  1876 |       })).toBeVisible();
  1877 |       await page.waitForTimeout(1500);
  1878 |       await expect(page.locator("body")).toHaveAttribute("data-pwa-smoke-build", "old");
  1879 |       await expect(stopRun).toBeVisible();
  1880 |       // Verify the current queued-manual policy without turning the later
  1881 |       // automatic-idle assertion into a queued-manual handoff.
  1882 |       await page.getByRole("button", { name: "Cancel queued update", exact: true }).click();
  1883 |       await expect(page.getByRole("button", {
  1884 |         name: "App updates · Update paused", exact: true,
  1885 |       })).toBeVisible();
  1886 |       await page.getByRole("button", { name: "Check for updates", exact: true }).click();
  1887 |       await expect(updateMessage).toBeVisible();
  1888 |       // The updated worker has activated so an older, generic Reload button
  1889 |       // can recover into the new bundle. Browser controller bookkeeping varies,
  1890 |       // but the user-visible invariant is strict: no navigation has happened
  1891 |       // and the in-progress run value is still in this open document.
  1892 |       await expect
  1893 |         .poll(() =>
  1894 |           page.evaluate(async () => {
  1895 |             const registration = await navigator.serviceWorker.ready;
  1896 |             return registration.active?.state === "activated";
  1897 |           }),
  1898 |           { timeout: 30_000 },
  1899 |         )
  1900 |         .toBe(true);
  1901 | 
  1902 |       let handoffNavigations = 0;
  1903 |       page.on("request", (request) => {
  1904 |         // Home also updates its fragment within the same document. Count real
  1905 |         // main-document requests, not those harmless same-document events.
  1906 |         if (request.isNavigationRequest() && request.resourceType() === "document"
  1907 |           && request.frame() === page.mainFrame()) handoffNavigations += 1;
  1908 |       });
  1909 | 
  1910 |       // Use Home's real run lifecycle. Stopping the run makes the calculator
  1911 |       // safe, and the click starts a fresh uninterrupted inactivity window.
  1912 |       await stopRun.click();
  1913 |       await page.waitForTimeout(500);
  1914 |       await expect(page.locator("body")).toHaveAttribute("data-pwa-smoke-build", "old");
  1915 |       await expect(reloadAction).toBeVisible();
  1916 |       // The manual request was cancelled and discovery explicitly re-armed.
  1917 |       // Only a new uninterrupted safe-idle window may hand off now.
  1918 |       await expect(page.locator("body")).toHaveAttribute("data-pwa-smoke-build", "new", {
  1919 |         timeout: 30_000,
  1920 |       });
  1921 |       await page.getByRole("button", { name: /App updates/ }).click();
  1922 |       await expect(page.getByTestId("running-build")).toHaveText("pwa-new-build");
  1923 |       await expect.poll(() => page.evaluate(() =>
  1924 |         JSON.parse(sessionStorage.getItem("run-calc:pwa-update-diagnostics:v1") ?? "[]")
  1925 |           .filter((event: { phase: string }) => event.phase === "confirmed").length,
  1926 |       )).toBe(1);
  1927 |       await page.waitForTimeout(1500);
  1928 |       expect(handoffNavigations).toBe(1);
  1929 |       await expect(updateMessage).toHaveCount(0);
  1930 |     } finally {
  1931 |       await server.close();
  1932 |     }
  1933 |   });
  1934 | 
  1935 |   test("blocks an offline intent after session revocation and retries only after sign-in", async ({
  1936 |     page,
  1937 |   }) => {
  1938 |     const pageErrors: string[] = [];
  1939 |     const expectedExternalFontErrors: string[] = [];
  1940 |     page.on("pageerror", (error) => {
  1941 |       if (error.message.includes("fonts.googleapis.com/css2")) {
  1942 |         expectedExternalFontErrors.push(error.message);
  1943 |       } else {
  1944 |         pageErrors.push(error.message);
  1945 |       }
  1946 |     });
  1947 |     const server = await startVersionedServer(
  1948 |       { old: fixture.oldDir, new: fixture.newDir },
  1949 |       undefined,
  1950 |       {
  1951 |         sessionRecovery: true,
  1952 |         sessionRecoveryIntentOutbox: true,
  1953 |       },
  1954 |     );
  1955 | 
  1956 |     try {
  1957 |       await page.route("https://fonts.googleapis.com/**", (route) =>
  1958 |         route.fulfill({ status: 200, contentType: "text/css", body: "" }),
  1959 |       );
  1960 |       await page.addInitScript(() => {
  1961 |         if (location.origin === "null") return;
  1962 |         const now = new Date();
  1963 |         const date = [
  1964 |           now.getFullYear(),
  1965 |           String(now.getMonth() + 1).padStart(2, "0"),
  1966 |           String(now.getDate()).padStart(2, "0"),
  1967 |         ].join("-");
```