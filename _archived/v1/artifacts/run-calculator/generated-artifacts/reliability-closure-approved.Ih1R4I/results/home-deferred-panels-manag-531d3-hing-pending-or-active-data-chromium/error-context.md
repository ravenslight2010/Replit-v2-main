# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: home-deferred-panels.spec.ts >> manager removes saved copies repeatedly without touching pending or active data
- Location: e2e/home-deferred-panels.spec.ts:543:1

# Error details

```
Error: manager API requests should not fail unexpectedly

expect(received).toEqual(expected) // deep equality

- Expected  - 1
+ Received  + 5

- Array []
+ Array [
+   "GET http://127.0.0.1:44355/api/me (net::ERR_ABORTED)",
+   "GET http://127.0.0.1:44355/api/qc/import-review-badges (net::ERR_ABORTED)",
+   "GET http://127.0.0.1:44355/api/sync/operational-intents/cursor (net::ERR_ABORTED)",
+ ]
```

# Test source

```ts
  781 |   }
  782 |   await expect(page.getByText("4 saved local items to review")).toHaveCount(0);
  783 |   await page.screenshot({
  784 |     path: testInfo.outputPath("saved-copy-removal-after.png"),
  785 |     fullPage: false,
  786 |   });
  787 | 
  788 |   const activeRunBeforeReload = await page.evaluate(() => {
  789 |     const raw = localStorage.getItem("run-calc-day");
  790 |     if (!raw) throw new Error("Active-run recovery disappeared during local cleanup");
  791 |     const state = JSON.parse(raw);
  792 |     const run = state.runs?.[state.currentIndex];
  793 |     if (!run?.id) throw new Error("Active-run identity disappeared during local cleanup");
  794 |     return { date: state.date as string, runId: run.id as string };
  795 |   });
  796 |   expect(activeRunBeforeReload).toEqual(activeRunBeforeRemoval);
  797 |   console.log(
  798 |     `[${testInfo.project.name}] manager page origin=${new URL(page.url()).origin}; cross-origin API requests=${JSON.stringify(crossOriginApiRequests)}`,
  799 |   );
  800 |   expect(
  801 |     crossOriginApiRequests,
  802 |     "manager API requests should stay on the page origin",
  803 |   ).toEqual([]);
  804 |   expect(
  805 |     pageErrors,
  806 |     "the signed-in manager page should not report access-control failures",
  807 |   ).toEqual([]);
  808 |   expect(apiConsoleErrors, "manager API calls should not log access-control errors").toEqual([]);
  809 |   markExpectedNavigation(true);
  810 |   await page.reload({ waitUntil: "domcontentloaded" });
  811 |   await expect(page.getByTestId("tab-run")).toHaveAttribute(
  812 |     "data-state",
  813 |     "active",
  814 |   );
  815 |   await expect(page.getByRole("button", { name: /PAUSE RUN/ })).toBeVisible();
  816 |   await expect(page.getByTestId("factory-directory-review")).toBeVisible();
  817 |   const reloadedFactoryReview = page.getByTestId("factory-directory-review");
  818 |   await reloadedFactoryReview.locator("summary").click();
  819 |   await expect(reloadedFactoryReview).toContainText("PENDING_");
  820 |   await expect(reloadedFactoryReview.getByRole("button", {
  821 |     name: "Removal unavailable",
  822 |   })).toBeDisabled();
  823 |   await expect(page.getByTestId("shared-records-status")).toHaveCount(0);
  824 |   markExpectedNavigation(false);
  825 | 
  826 |   const preservedAfter = await page.evaluate(({ queueKey, unrelatedKey, outboxKey }) => ({
  827 |     activeRecovery: localStorage.getItem("run-calc-day"),
  828 |     pendingQueue: localStorage.getItem(queueKey),
  829 |     unrelated: localStorage.getItem(unrelatedKey),
  830 |     outbox: localStorage.getItem(outboxKey),
  831 |     removedLegacy: Object.keys(localStorage).filter((key) =>
  832 |       key.startsWith("run-calc-fkv-legacy-review:unowned:run-calc-")
  833 |       && !key.endsWith("run-calc-brands"),
  834 |     ),
  835 |     history: localStorage.getItem("run-calc-history"),
  836 |   }), { queueKey: pendingQueueKey, unrelatedKey, outboxKey: unrelatedOutboxKey });
  837 |   expect(preservedAfter).toMatchObject({
  838 |     pendingQueue: preservedBefore.pendingQueue,
  839 |     unrelated: preservedBefore.unrelated,
  840 |     outbox: preservedBefore.outbox,
  841 |     removedLegacy: [],
  842 |     history: null,
  843 |   });
  844 |   const activeRunAfterReload = JSON.parse(preservedAfter.activeRecovery ?? "null");
  845 |   expect({
  846 |     date: activeRunAfterReload?.date,
  847 |     runId: activeRunAfterReload?.runs?.[activeRunAfterReload.currentIndex]?.id,
  848 |   }).toEqual(activeRunBeforeRemoval);
  849 |   const canonicalAfter = await readCanonicalFactoryValues(page);
  850 |   expect(canonicalAfter).toEqual(canonicalBefore);
  851 |   if (pageErrors.length > 0) {
  852 |     console.log(`[${testInfo.project.name}] Page errors:\n${pageErrors.join("\n---\n")}`);
  853 |   }
  854 |   expect(pageErrors, "manager API calls should not produce access-control errors").toEqual([]);
  855 |   expect(apiConsoleErrors, "manager API calls should not log access-control errors").toEqual([]);
  856 |   expect(crossOriginApiRequests, "manager API requests should stay on the page origin").toEqual([]);
  857 |   expect(
  858 |     apiResponseStatuses.filter(({ url, status }) =>
  859 |       (
  860 |         url.endsWith("/api/factory-data")
  861 |         || url.endsWith("/api/factory-data/operational")
  862 |         || url.endsWith("/api/incidents")
  863 |         || url.endsWith("/api/incidents/actionable-count")
  864 |       ) && (status < 200 || status >= 300)
  865 |     ),
  866 |     "manager API requests should return successful responses",
  867 |   ).toEqual([]);
  868 |   expect(
  869 |     apiResponseStatuses.some(({ url, status }) =>
  870 |       url.endsWith("/api/factory-data") && status === 200
  871 |     ),
  872 |     "the authenticated manager factory-data read should succeed",
  873 |   ).toBe(true);
  874 |   expect(
  875 |     apiResponseStatuses.some(({ url, status }) =>
  876 |       url.endsWith("/api/incidents/actionable-count") && status === 200
  877 |     ),
  878 |     "the authenticated manager incident-count read should succeed",
  879 |   ).toBe(true);
  880 |   expect(apiPreflightRequests, "same-origin manager requests should not preflight").toEqual([]);
> 881 |   expect(failedApiRequests, "manager API requests should not fail unexpectedly").toEqual([]);
      |                                                                                  ^ Error: manager API requests should not fail unexpectedly
  882 |   if (expectedWebKitNavigationMessages.length > 0) {
  883 |     console.log(
  884 |       `[${testInfo.project.name}] same-origin WebKit requests cancelled by deliberate reloads: ${expectedWebKitNavigationMessages.length}`,
  885 |     );
  886 |   }
  887 |   if (expectedNavigationCancellations.length > 0) {
  888 |     console.log(
  889 |       `[${testInfo.project.name}] same-origin API requests cancelled by deliberate reloads: ${expectedNavigationCancellations.length}`,
  890 |     );
  891 |   }
  892 | });
  893 | 
  894 | test.describe("facility reconnect delivery", () => {
  895 | test.use({ serviceWorkers: "block" });
  896 | 
  897 | for (const acknowledgment of ["valid", "malformed", "stale"] as const) {
  898 | test(acknowledgment === "valid"
  899 |   ? "pending facility edit is acknowledged once after connectivity returns"
  900 |   : `independent facility edit progresses after a ${acknowledgment} acknowledgment on reconnect`, async ({ page }, testInfo) => {
  901 |   const username = uniqueTestId("e2e_facility_reconnect");
  902 |   const fixtureId = uniqueTestId("facility_reconnect");
  903 |   testUsernames.add(username);
  904 | 
  905 |   await signUpAndHandleOnboarding(page, username, PASSWORD, {
  906 |     signupCode: SIGNUP_CODE,
  907 |   });
  908 |   await dismissOnboardingIfPresent(page);
  909 |   await promoteToManager(username);
  910 |   const key = "run-calc-stop-reasons";
  911 |   const baseline = [`BASELINE_${fixtureId}`];
  912 |   const intended = [`ACKNOWLEDGED_${fixtureId}`];
  913 |   const independentKey = "run-calc-production-start-time";
  914 |   const independentValue = "08:35";
  915 |   const editedAt = Date.now();
  916 |   const db = new Client({
  917 |     connectionString: requireIsolatedTestDatabase("seed facility reconnect fixture"),
  918 |   });
  919 |   await db.connect();
  920 |   try {
  921 |     const user = await db.query<{ id: string }>(
  922 |       "SELECT id FROM users WHERE username = $1",
  923 |       [username],
  924 |     );
  925 |     expect(user.rows).toHaveLength(1);
  926 |     const userId = user.rows[0].id;
  927 |     await db.query(
  928 |       `INSERT INTO factory_kv (scope, key, value, updated_at)
  929 |        VALUES ('live', $1, $2::jsonb, $3)
  930 |        ON CONFLICT (scope, key) DO UPDATE
  931 |        SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
  932 |       [key, JSON.stringify(baseline), new Date(editedAt - 60_000)],
  933 |     );
  934 | 
  935 |     const identity = `live:${userId}`;
  936 |     const queueKey = `run-calc-fkv-queue-v2:${encodeURIComponent(identity)}`;
  937 |     const commands = [{
  938 |       key,
  939 |       value: intended,
  940 |       updatedAt: editedAt,
  941 |       g: 1,
  942 |     }, ...(acknowledgment === "valid" ? [] : [{
  943 |       key: independentKey, value: independentValue, updatedAt: editedAt, g: 2,
  944 |     }])];
  945 |     const pendingQueue = JSON.stringify(commands);
  946 |     const unrelatedQueueKey =
  947 |       `run-calc-fkv-queue-v2:${encodeURIComponent(`live:unrelated_${fixtureId}`)}`;
  948 |     const unrelatedQueue = JSON.stringify([{
  949 |       key: "run-calc-brands",
  950 |       value: [`KEEP_QUEUE_${fixtureId}`],
  951 |       updatedAt: editedAt,
  952 |       g: 1,
  953 |     }]);
  954 |     const unrelatedOutboxKey =
  955 |       `run-calc-completed-history-outbox.live:unrelated_${fixtureId}`;
  956 |     const unrelatedOutbox = JSON.stringify([{ fixtureId, pending: true }]);
  957 |     const anotherOutboxKey = `run-calc-facility-unrelated-outbox:${fixtureId}`;
  958 |     const anotherOutbox = `KEEP_OUTBOX_${fixtureId}`;
  959 | 
  960 |     await page.evaluate((data) => {
  961 |       localStorage.setItem(data.queueKey, data.pendingQueue);
  962 |       localStorage.setItem(data.unrelatedQueueKey, data.unrelatedQueue);
  963 |       localStorage.setItem(data.unrelatedOutboxKey, data.unrelatedOutbox);
  964 |       localStorage.setItem(data.anotherOutboxKey, data.anotherOutbox);
  965 |     }, {
  966 |       queueKey,
  967 |       pendingQueue,
  968 |       unrelatedQueueKey,
  969 |       unrelatedQueue,
  970 |       unrelatedOutboxKey,
  971 |       unrelatedOutbox,
  972 |       anotherOutboxKey,
  973 |       anotherOutbox,
  974 |     });
  975 | 
  976 |     let offline = true;
  977 |     let targetPutAttempts = 0;
  978 |     let successfulAcknowledgments = 0;
  979 |     let rejectFirst = acknowledgment !== "valid";
  980 |     let independentAttempts = 0;
  981 |     const abortWhileOffline = async (route: Route) => {
```