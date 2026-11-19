# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: accessibility-smoke.spec.ts >> accessibility smoke >> touch break planning opens above Schedule and retains the saved draft
- Location: e2e/accessibility-smoke.spec.ts:1064:3

# Error details

```
Error: expect(received).toEqual(expected) // deep equality

- Expected  - 1
+ Received  + 7

  Object {
    "errors": Array [],
    "failedResponses": Array [],
-   "unexpectedRequestFailures": Array [],
+   "unexpectedRequestFailures": Array [
+     "persistence reload: GET /api/me net::ERR_ABORTED",
+     "persistence reload: GET /api/qc/import-review-badges net::ERR_ABORTED",
+     "persistence reload: GET /api/sync/operational-intents/cursor net::ERR_ABORTED",
+     "summary navigation: GET /api/background-operations/diagnostics net::ERR_ABORTED",
+     "summary navigation: GET /api/reports/operational-view net::ERR_ABORTED",
+   ],
  }
```

# Test source

```ts
  1219 |               z-index: 50 !important; transition: none !important;
  1220 |             }
  1221 |             [data-state="open"][data-break-layer-probe="break-1-overlay"] {
  1222 |               z-index: 50 !important; transition: none !important;
  1223 |             }
  1224 |           ` });
  1225 |           expect(await picker.evaluate(node => getComputedStyle(node).zIndex)).toBe("50");
  1226 |           expect(scheduleLayer).toBe("70");
  1227 |           await page.screenshot({ path: "../../.local/evidence/break-planning/original-layer-emulation.png" });
  1228 |           await layerSheet.evaluate(style => {
  1229 |             style.textContent = `
  1230 |               [role="dialog"][aria-labelledby][data-state="open"][data-break-layer-probe="break-1-picker"] {
  1231 |                 z-index: 80 !important; transition: none !important;
  1232 |               }
  1233 |               [data-state="open"][data-break-layer-probe="break-1-overlay"] {
  1234 |                 z-index: 80 !important; transition: none !important;
  1235 |               }
  1236 |             `;
  1237 |           });
  1238 |           await expect.poll(() => picker.evaluate(node => getComputedStyle(node).zIndex)).toBe("80");
  1239 |           await page.screenshot({ path: "../../.local/evidence/break-planning/repaired-layer-emulation.png" });
  1240 |         }
  1241 |         await expect.poll(() => option.evaluate((node) => {
  1242 |           const box = node.getBoundingClientRect();
  1243 |           return node.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
  1244 |         })).toBe(true);
  1245 |         await option.click();
  1246 |         await expect(picker).toBeHidden();
  1247 |         await editor.getByRole("button", { name: `Break ${slot} run`, exact: true }).click();
  1248 |         await page.getByRole("dialog", { name: `Break ${slot} run`, exact: true })
  1249 |           .getByRole("option", { name: /Run 1 —/ }).click();
  1250 |         await trigger.click();
  1251 |         await page.keyboard.press("Escape");
  1252 |         await expect(trigger).toBeFocused();
  1253 |         await expect(trigger).toHaveText(/After a run/);
  1254 |         await trigger.click();
  1255 |         await page.getByRole("dialog", { name: `Break ${slot} placement`, exact: true })
  1256 |           .getByRole("button", { name: "Cancel", exact: true }).click();
  1257 |       } else {
  1258 |         await trigger.selectOption("after-run");
  1259 |         await editor.getByLabel(`Break ${slot} run`, { exact: true }).selectOption({ index: 1 });
  1260 |       }
  1261 |       await choose(slot, "at-time", "At a clock time");
  1262 |       await editor.getByLabel(`Break ${slot} time`).fill("23:00");
  1263 |       await choose(slot, "off", "Not scheduled");
  1264 |       await expect(editor.getByLabel(`Break ${slot} time`)).toBeDisabled();
  1265 |       await choose(slot, "after-run", "After a run");
  1266 |     }
  1267 |     await choose(2, "at-time", "At a clock time");
  1268 |     await choose(3, "off", "Not scheduled");
  1269 |     const preview = await editor.getByTestId("schedule-break-preview").innerText();
  1270 |     const projectedFinish = preview.match(/day finish ([^\n]+)/)?.[1];
  1271 |     expect(projectedFinish).toBeTruthy();
  1272 |     const saved = page.waitForResponse((response) => response.url().includes("/api/sync/today") && response.request().method() === "PUT");
  1273 |     await editor.getByRole("button", { name: "Save Schedule", exact: true }).click();
  1274 |     expect((await saved).ok()).toBe(true);
  1275 |     requestPhase = "persistence reload";
  1276 |     markNavigation();
  1277 |     await page.reload({ waitUntil: "load" });
  1278 |     await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
  1279 |     requestPhase = "post-auth journey";
  1280 |     const reopened = await openEditor();
  1281 |     const touch = await reopened.getByLabel("Break 1 placement", { exact: true }).evaluate(node => node.tagName === "BUTTON");
  1282 |     if (touch) {
  1283 |       await expect(reopened.getByLabel("Break 1 placement", { exact: true })).toHaveText(/After a run/);
  1284 |       await expect(reopened.getByLabel("Break 1 run", { exact: true })).toHaveText(/Run 1/);
  1285 |       await expect(reopened.getByLabel("Break 2 placement", { exact: true })).toHaveText(/At a clock time/);
  1286 |       await expect(reopened.getByLabel("Break 3 placement", { exact: true })).toHaveText(/Not scheduled/);
  1287 |     } else {
  1288 |       await expect(reopened.getByLabel("Break 1 placement", { exact: true })).toHaveValue("after-run");
  1289 |       await expect(reopened.getByLabel("Break 2 placement", { exact: true })).toHaveValue("at-time");
  1290 |       await expect(reopened.getByLabel("Break 3 placement", { exact: true })).toHaveValue("off");
  1291 |     }
  1292 |     await expect(reopened.getByLabel("Break 2 time")).toHaveValue("23:00");
  1293 |     await expect.poll(() => reopened.getByTestId("schedule-break-preview").innerText()).toBe(preview);
  1294 |     await choose(1, "off", "Not scheduled");
  1295 |     await reopened.getByRole("button", { name: "Cancel", exact: true }).click();
  1296 |     await page.getByRole("dialog", { name: "Scheduled Days", exact: true }).getByRole("button", { name: /Close/ }).click();
  1297 |     const cancelled = await openEditor();
  1298 |     if (touch) await expect(cancelled.getByLabel("Break 1 placement", { exact: true })).toHaveText(/After a run/);
  1299 |     else await expect(cancelled.getByLabel("Break 1 placement", { exact: true })).toHaveValue("after-run");
  1300 |     await cancelled.getByRole("button", { name: "Close schedule editor", exact: true }).click();
  1301 |     requestPhase = "summary navigation";
  1302 |     markNavigation();
  1303 |     await page.getByRole("button", { name: "More" }).click();
  1304 |     await page.getByRole("menuitem", { name: "Summary", exact: true }).click();
  1305 |     await expect(page.getByRole("menu")).toHaveCount(0);
  1306 |     await expect(page.getByTestId("day-timeline")).toContainText(projectedFinish!);
  1307 |     requestPhase = "post-auth journey";
  1308 |     if (test.info().project.name === "android-touch") {
  1309 |       await page.getByTestId("day-timeline").screenshot({ path: "../../.local/evidence/break-planning/break-summary.png" });
  1310 |     }
  1311 | 
  1312 |     console.log("known out-of-scope manager diagnostics 404s:", {
  1313 |       responses: knownManagerDiagnostics404,
  1314 |       console: knownManagerDiagnosticsConsole,
  1315 |       expectedNavigationAborts,
  1316 |       expectedWebKitNavigationMessages,
  1317 |     });
  1318 |     expect(knownManagerDiagnostics404.every(value => value === "404 GET /api/background-operations/diagnostics")).toBe(true);
> 1319 |     expect({ errors, failedResponses, unexpectedRequestFailures }).toEqual({
       |                                                                    ^ Error: expect(received).toEqual(expected) // deep equality
  1320 |       errors: [],
  1321 |       failedResponses: [],
  1322 |       unexpectedRequestFailures: [],
  1323 |     });
  1324 |   });
  1325 | 
  1326 |   test("break planning enlarged-text keyboard controls", async ({ page }) => {
  1327 |     await signUp(page);
  1328 |     await seedBreakSchedule();
  1329 |     await page.evaluate(() => {
  1330 |       for (const key of Object.keys(localStorage)) {
  1331 |         if (key.startsWith("run-calc")) localStorage.removeItem(key);
  1332 |       }
  1333 |     });
  1334 |     await page.reload({ waitUntil: "domcontentloaded" });
  1335 |     await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
  1336 |     await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
  1337 |     expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe("32px");
  1338 | 
  1339 |     await page.getByRole("button", { name: "More" }).click();
  1340 |     await page.getByRole("menuitem", { name: "Schedule", exact: true }).click();
  1341 |     await expect(page.getByRole("menu")).toHaveCount(0);
  1342 |     await page.getByTestId("schedule-today-card").getByRole("button", { name: "Edit", exact: true }).click();
  1343 |     const editor = page.getByRole("dialog", { name: /Plan for/ });
  1344 |     const toggle = editor.getByTestId("schedule-break-toggle");
  1345 |     if (await toggle.isVisible()) await toggle.click();
  1346 |     const trigger = editor.getByLabel("Break 1 placement", { exact: true });
  1347 |     await expect(trigger).toBeVisible();
  1348 | 
  1349 |     if (await trigger.evaluate(node => node.tagName === "BUTTON")) {
  1350 |       await trigger.press("Enter");
  1351 |       console.log("enlarged keyboard modal state after Enter:", await page.evaluate(() => ({
  1352 |         activeTag: document.activeElement?.tagName,
  1353 |         activeLabel: document.activeElement?.getAttribute("aria-label"),
  1354 |         url: location.pathname,
  1355 |         dialogs: [...document.querySelectorAll('[role="dialog"]')].map(node => ({
  1356 |           state: node.getAttribute("data-state"),
  1357 |           hidden: node.getAttribute("aria-hidden"),
  1358 |           label: node.getAttribute("aria-label"),
  1359 |           labelledBy: node.getAttribute("aria-labelledby"),
  1360 |         })),
  1361 |       })));
  1362 |       await expect(page.getByRole("dialog", { name: "Break 1 placement", exact: true })).toBeVisible();
  1363 |       await page.keyboard.press("Escape");
  1364 |       await expect(trigger).toBeFocused();
  1365 |     } else {
  1366 |       const next = editor.getByLabel("Break 1 run", { exact: true });
  1367 |       await trigger.press("Tab");
  1368 |       console.log("enlarged keyboard focus after Tab:", await page.evaluate(() => ({
  1369 |         activeTag: document.activeElement?.tagName,
  1370 |         activeLabel: document.activeElement?.getAttribute("aria-label"),
  1371 |         url: location.pathname,
  1372 |         dialogs: [...document.querySelectorAll('[role="dialog"]')].map(node => ({
  1373 |           state: node.getAttribute("data-state"),
  1374 |           hidden: node.getAttribute("aria-hidden"),
  1375 |           label: node.getAttribute("aria-label"),
  1376 |           labelledBy: node.getAttribute("aria-labelledby"),
  1377 |         })),
  1378 |       })));
  1379 |       await expect(next).toBeFocused();
  1380 |     }
  1381 |     await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  1382 |   });
  1383 | 
  1384 |   test("Android-sized PWA schedule editor exposes the break planner and preserves placements", async ({
  1385 |     page,
  1386 |   }) => {
  1387 |     test.setTimeout(120_000);
  1388 |     await page.setViewportSize({ width: 412, height: 915 });
  1389 |     await signUp(page);
  1390 |     await seedBreakSchedule();
  1391 |     await page.evaluate(() => {
  1392 |       for (const key of Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))) {
  1393 |         if (key?.startsWith("run-calc")) localStorage.removeItem(key);
  1394 |       }
  1395 |     });
  1396 |     await page.reload({ waitUntil: "domcontentloaded" });
  1397 |     await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
  1398 | 
  1399 |     const openScheduleEditor = async (): Promise<Locator> => {
  1400 |       await page.getByRole("button", { name: "More" }).click();
  1401 |       const scheduleMenuItem = page.getByRole("menuitem", { name: "Schedule", exact: true });
  1402 |       await expect(scheduleMenuItem).toBeVisible();
  1403 |       await scheduleMenuItem.click();
  1404 |       const scheduledDaysDialog = page.getByRole("dialog", { name: "Scheduled Days" });
  1405 |       await scheduledDaysDialog
  1406 |         .getByTestId("schedule-today-card")
  1407 |         .getByRole("button", { name: "Edit", exact: true })
  1408 |         .click();
  1409 |       return page.getByRole("dialog", { name: /Plan for/ });
  1410 |     };
  1411 | 
  1412 |     const scheduleEditor = await openScheduleEditor();
  1413 |     const breakEditor = scheduleEditor.getByTestId("schedule-breaks");
  1414 |     const breakToggle = breakEditor.getByTestId("schedule-break-toggle");
  1415 |     if (await breakToggle.isVisible()) {
  1416 |       await expect(breakToggle).toHaveText("Add breaks");
  1417 |       await breakToggle.click();
  1418 |       await expect(breakToggle).toHaveText("Hide breaks");
  1419 |     } else {
```