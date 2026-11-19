# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: home-deferred-panels.spec.ts >> facility reconnect delivery >> pending facility edit is acknowledged once after connectivity returns
- Location: e2e/home-deferred-panels.spec.ts:898:1

# Error details

```
Error: exactly one successful facility-data acknowledgment is expected

exactly one successful facility-data acknowledgment is expected

expect(received).toBe(expected) // Object.is equality

Expected: 1
Received: 0

Call Log:
- Timeout 5000ms exceeded while waiting on the predicate
```

# Test source

```ts
  988  |       if (offline) {
  989  |         await route.abort("internetdisconnected");
  990  |         return;
  991  |       }
  992  |       if (body?.key === key && rejectFirst) {
  993  |         await route.fulfill({ status: 200, contentType: "application/json",
  994  |           body: JSON.stringify(acknowledgment === "malformed" ? {} : {
  995  |             value: baseline, updatedAt: new Date(editedAt - 60_000).toISOString(),
  996  |           }) });
  997  |         return;
  998  |       }
  999  |       if (body?.key === independentKey) independentAttempts++;
  1000 |       await route.continue();
  1001 |     };
  1002 |     await page.route("**/api/factory-data", abortWhileOffline);
  1003 |     page.on("response", (response) => {
  1004 |       const body = response.request().postDataJSON() as { key?: unknown } | null;
  1005 |       if (body?.key === key && response.request().method() === "PUT"
  1006 |         && new URL(response.url()).pathname === "/api/factory-data" && response.ok()) {
  1007 |         successfulAcknowledgments++;
  1008 |       }
  1009 |     });
  1010 | 
  1011 |     try {
  1012 |       await page.reload({ waitUntil: "domcontentloaded" });
  1013 |       await expect(page.getByTestId("tab-run")).toHaveAttribute(
  1014 |         "data-state",
  1015 |         "active",
  1016 |       );
  1017 |       await expect.poll(() => targetPutAttempts, {
  1018 |         message: "the pending facility edit should attempt delivery while offline",
  1019 |       }).toBeGreaterThan(0);
  1020 |       const queueWhileOffline = await page.evaluate((storageKey) => {
  1021 |         const raw = localStorage.getItem(storageKey);
  1022 |         return raw ? JSON.parse(raw) as Array<{ key: string; value: unknown }> : [];
  1023 |       }, queueKey);
  1024 |       expect(queueWhileOffline).toEqual(expect.arrayContaining([
  1025 |         expect.objectContaining({ key, value: intended }),
  1026 |       ]));
  1027 |       expect(successfulAcknowledgments).toBe(0);
  1028 |       const pendingStatus = page.getByTestId("factory-directory-pending");
  1029 |       const expectPendingCount = async () => {
  1030 |         // Home can enqueue other legitimate settings during bootstrap. The
  1031 |         // status must count the whole owned queue, not just our seeded edit.
  1032 |         await expect.poll(async () => {
  1033 |           const queued = await page.evaluate((storageKey) =>
  1034 |             JSON.parse(localStorage.getItem(storageKey) ?? "[]") as Array<{ key: string; value: unknown }>, queueKey);
  1035 |           const expected = `${queued.length} facility ${queued.length === 1 ? "edit is" : "edits are"} awaiting server confirmation`;
  1036 |           return queued.some((op) => op.key === key && JSON.stringify(op.value) === JSON.stringify(intended))
  1037 |             && (await pendingStatus.textContent())?.includes(expected);
  1038 |         }, { message: "pending status must match every owned queued edit and retain the intended change" }).toBe(true);
  1039 |       };
  1040 |       await expectPendingCount();
  1041 |       await expect(pendingStatus.getByRole("button")).toHaveCount(0);
  1042 |       await expect(pendingStatus).toBeInViewport();
  1043 |       await pendingStatus.screenshot({ path: testInfo.outputPath("pending-facility-status.png") });
  1044 |       // A second boot must show retained work, not assume the first attempt saved it.
  1045 |       await page.reload({ waitUntil: "domcontentloaded" });
  1046 |       await expectPendingCount();
  1047 |       expect(successfulAcknowledgments).toBe(0);
  1048 |       const stillBaseline = await db.query<{ value: unknown }>(
  1049 |         "SELECT value FROM factory_kv WHERE scope = 'live' AND key = $1",
  1050 |         [key],
  1051 |       );
  1052 |       expect(stillBaseline.rows).toHaveLength(1);
  1053 |       expect(stillBaseline.rows[0].value).toEqual(baseline);
  1054 | 
  1055 |       const preservedBeforeReconnect = await page.evaluate((storageKeys) =>
  1056 |         Object.fromEntries(storageKeys.map((storageKey) => [
  1057 |           storageKey,
  1058 |           localStorage.getItem(storageKey),
  1059 |         ])), [unrelatedQueueKey, unrelatedOutboxKey, anotherOutboxKey]);
  1060 |       expect(preservedBeforeReconnect).toEqual({
  1061 |         [unrelatedQueueKey]: unrelatedQueue,
  1062 |         [unrelatedOutboxKey]: unrelatedOutbox,
  1063 |         [anotherOutboxKey]: anotherOutbox,
  1064 |       });
  1065 | 
  1066 |       // Keep the browser on the same page and let its real online event retry
  1067 |       // the retained command; no reload or new edit is used to trigger delivery.
  1068 |       offline = false;
  1069 |       await page.context().setOffline(true);
  1070 |       await page.context().setOffline(false);
  1071 | 
  1072 |       if (acknowledgment !== "valid") {
  1073 |         await expect.poll(() => independentAttempts).toBe(1);
  1074 |         await expect.poll(async () => page.evaluate((storageKey) =>
  1075 |           localStorage.getItem(storageKey), queueKey)).toBe(JSON.stringify([commands[0]]));
  1076 |         const retainedCanonical = await readCanonicalFactoryValues(page);
  1077 |         expect(retainedCanonical[key]).toEqual(baseline);
  1078 |         expect(retainedCanonical[independentKey]).toBe(independentValue);
  1079 |         // HTTP 200 did not acknowledge or discard the rejected command.
  1080 |         // Retry on a later reconnect with exactly its original stamp/payload.
  1081 |         rejectFirst = false;
  1082 |         successfulAcknowledgments = 0;
  1083 |         await page.context().setOffline(true);
  1084 |         await page.context().setOffline(false);
  1085 |       }
  1086 |       await expect.poll(() => successfulAcknowledgments, {
  1087 |         message: "exactly one successful facility-data acknowledgment is expected",
> 1088 |       }).toBe(1);
       |          ^ Error: exactly one successful facility-data acknowledgment is expected
  1089 |       await expect.poll(async () => page.evaluate((storageKey) =>
  1090 |         localStorage.getItem(storageKey), queueKey)).toBe("[]");
  1091 |       await expect(pendingStatus).toHaveCount(0);
  1092 | 
  1093 |       const canonical = await readCanonicalFactoryValues(page);
  1094 |       expect(canonical[key]).toEqual(intended);
  1095 |       const persisted = await db.query<{ value: unknown; rowCount: string }>(
  1096 |         `SELECT value, COUNT(*) OVER ()::text AS "rowCount"
  1097 |          FROM factory_kv WHERE scope = 'live' AND key = $1`,
  1098 |         [key],
  1099 |       );
  1100 |       expect(persisted.rows).toHaveLength(1);
  1101 |       expect(persisted.rows[0]).toMatchObject({
  1102 |         value: intended,
  1103 |         rowCount: "1",
  1104 |       });
  1105 |       if (acknowledgment !== "valid") {
  1106 |         expect(independentAttempts).toBe(1);
  1107 |         const row = await db.query<{ value: unknown }>(
  1108 |           "SELECT value FROM factory_kv WHERE scope = 'live' AND key = $1", [independentKey],
  1109 |         );
  1110 |         expect(row.rows[0].value).toBe(independentValue);
  1111 |       }
  1112 |       const preservedAfterReconnect = await page.evaluate((storageKeys) =>
  1113 |         Object.fromEntries(storageKeys.map((storageKey) => [
  1114 |           storageKey,
  1115 |           localStorage.getItem(storageKey),
  1116 |         ])), [unrelatedQueueKey, unrelatedOutboxKey, anotherOutboxKey]);
  1117 |       expect(preservedAfterReconnect).toEqual(preservedBeforeReconnect);
  1118 |       expect(successfulAcknowledgments).toBe(1);
  1119 |       await page.reload({ waitUntil: "domcontentloaded" });
  1120 |       await expect(page.getByTestId("tab-run")).toHaveAttribute("data-state", "active");
  1121 |       await expect(pendingStatus).toHaveCount(0);
  1122 |     } finally {
  1123 |       offline = false;
  1124 |       await page.context().setOffline(false);
  1125 |       await page.unroute("**/api/factory-data", abortWhileOffline);
  1126 |     }
  1127 |   } finally {
  1128 |     await db.end().catch(() => {});
  1129 |   }
  1130 | });
  1131 | }
  1132 | });
  1133 | 
```