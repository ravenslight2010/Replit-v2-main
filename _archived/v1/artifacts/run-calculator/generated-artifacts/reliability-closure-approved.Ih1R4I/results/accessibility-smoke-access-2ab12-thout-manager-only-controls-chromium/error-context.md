# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: accessibility-smoke.spec.ts >> accessibility smoke >> authorized supervisors can save all break slots without manager-only controls
- Location: e2e/accessibility-smoke.spec.ts:1472:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('menuitem', { name: 'Schedule', exact: true })
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByRole('menuitem', { name: 'Schedule', exact: true }) with timeout 5000ms
  - waiting for getByRole('menuitem', { name: 'Schedule', exact: true })

```

```yaml
- complementary "App updates":
  - status: Development preview. Published updates are not checked in this development preview.
- menu "More — 57 manager actions need attention":
  - menuitem "Manager attention — 57 manager actions need attention": Manager attention
  - menuitem "Stoppages"
  - menuitem "Summary"
  - menuitem "Setup"
  - menuitem "Inventory"
  - menuitem "Operations Insights"
  - menuitem "Mix Plan"
  - menuitem "Report an issue"
  - menuitem "Reported issues"
  - menuitem "Alerts & Floor Mode"
  - menuitem "Settings"
  - menuitem "Password"
  - menuitem "Get Started"
  - menuitem "Guided Tour"
  - menuitem "Sign out"
```

# Test source

```ts
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
  1420 |       await expect(
  1421 |         breakEditor.getByRole("combobox", { name: "Break 1 placement" }),
  1422 |       ).toBeVisible();
  1423 |     }
  1424 |     for (const [slot, time] of [[1, "07:00"], [2, "09:00"], [3, "11:00"]] as const) {
  1425 |       await breakEditor
  1426 |         .getByRole("combobox", { name: `Break ${slot} placement` })
  1427 |         .selectOption("at-time");
  1428 |       await breakEditor.getByLabel(`Break ${slot} time`).fill(time);
  1429 |     }
  1430 |     await scan(page, "Android schedule break planner", [], '[data-testid="schedule-breaks"]');
  1431 | 
  1432 |     const saveResponse = page.waitForResponse(
  1433 |       (response) =>
  1434 |         response.url().includes("/api/sync/today") &&
  1435 |         response.request().method() === "PUT",
  1436 |     );
  1437 |     await scheduleEditor.getByRole("button", { name: "Save Schedule", exact: true }).click();
  1438 |     expect((await saveResponse).ok()).toBe(true);
  1439 | 
  1440 |     // Closing the document and opening a new page models an installed PWA
  1441 |     // relaunch while retaining the authenticated cookie and persisted plan.
  1442 |     const context = page.context();
  1443 |     await page.close();
  1444 |     const reopened = await context.newPage();
  1445 |     await reopened.setViewportSize({ width: 412, height: 915 });
  1446 |     await reopened.goto("/", { waitUntil: "domcontentloaded" });
  1447 |     await reopened.getByTestId("tab-run").waitFor({ state: "attached", timeout: 30_000 });
  1448 |     await reopened.getByRole("button", { name: "More" }).click();
  1449 |     await reopened.getByRole("menuitem", { name: "Schedule", exact: true }).click();
  1450 |     const reopenedScheduledDays = reopened.getByRole("dialog", { name: "Scheduled Days" });
  1451 |     await reopenedScheduledDays
  1452 |       .getByTestId("schedule-today-card")
  1453 |       .getByRole("button", { name: "Edit", exact: true })
  1454 |       .click();
  1455 | 
  1456 |     const reopenedEditor = reopened.getByRole("dialog", { name: /Plan for/ });
  1457 |     const reopenedBreakEditor = reopenedEditor.getByTestId("schedule-breaks");
  1458 |     await expect(reopenedBreakEditor.getByTestId("schedule-break-toggle")).toHaveText("Add breaks");
  1459 |     await expect(reopenedBreakEditor.getByTestId("schedule-break-summary")).toContainText(
  1460 |       "Break 1 · 07:00 · Break 2 · 09:00 · Break 3 · 11:00",
  1461 |     );
  1462 |     await reopenedBreakEditor.getByTestId("schedule-break-toggle").click();
  1463 |     for (const [slot, time] of [[1, "07:00"], [2, "09:00"], [3, "11:00"]] as const) {
  1464 |       await expect(
  1465 |         reopenedBreakEditor.getByRole("combobox", { name: `Break ${slot} placement` }),
  1466 |       ).toHaveValue("at-time");
  1467 |       await expect(reopenedBreakEditor.getByLabel(`Break ${slot} time`)).toHaveValue(time);
  1468 |     }
  1469 |     await reopened.close();
  1470 |   });
  1471 | 
  1472 |   test("authorized supervisors can save all break slots without manager-only controls", async ({
  1473 |     page,
  1474 |   }) => {
  1475 |     test.setTimeout(120_000);
  1476 |     await signUp(page, "supervisor");
  1477 |     await seedBreakSchedule();
  1478 |     await page.evaluate(() => {
  1479 |       for (const key of Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))) {
  1480 |         if (key?.startsWith("run-calc")) localStorage.removeItem(key);
  1481 |       }
  1482 |     });
  1483 |     await page.goto("/", { waitUntil: "domcontentloaded" });
  1484 |     await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
  1485 | 
  1486 |     await page.getByRole("button", { name: "More" }).click();
> 1487 |     await expect(page.getByRole("menuitem", { name: "Schedule", exact: true })).toBeVisible();
       |                                                                                 ^ Error: expect(locator).toBeVisible() failed
  1488 |     await expect(page.getByRole("menuitem", { name: "Staff roster", exact: true })).toHaveCount(0);
  1489 |     await expect(page.getByRole("menuitem", { name: "Manager action queue", exact: true })).toHaveCount(0);
  1490 |     await page.getByRole("menuitem", { name: "Schedule", exact: true }).click();
  1491 | 
  1492 |     const scheduledDaysDialog = page.getByRole("dialog", { name: "Scheduled Days" });
  1493 |     await scheduledDaysDialog
  1494 |       .getByTestId("schedule-today-card")
  1495 |       .getByRole("button", { name: "Edit", exact: true })
  1496 |       .click();
  1497 |     const scheduleEditor = page.getByRole("dialog", { name: /Plan for/ });
  1498 |     const breakEditor = scheduleEditor.getByTestId("schedule-breaks");
  1499 |     await expect(breakEditor).toContainText("Each planned break is fixed at 30 minutes.");
  1500 |     const breakToggle = breakEditor.getByTestId("schedule-break-toggle");
  1501 |     if (await breakToggle.isVisible()) {
  1502 |       await expect(breakToggle).toHaveText("Add breaks");
  1503 |       await breakToggle.click();
  1504 |       await expect(breakToggle).toHaveText("Hide breaks");
  1505 |     } else {
  1506 |       await expect(
  1507 |         breakEditor.getByRole("combobox", { name: "Break 1 placement" }),
  1508 |       ).toBeVisible();
  1509 |     }
  1510 |     for (const [slot, time] of [[1, "07:00"], [2, "09:00"], [3, "11:00"]] as const) {
  1511 |       await breakEditor
  1512 |         .getByRole("combobox", { name: `Break ${slot} placement` })
  1513 |         .selectOption("at-time");
  1514 |       await breakEditor.getByLabel(`Break ${slot} time`).fill(time);
  1515 |     }
  1516 | 
  1517 |     const saveResponse = page.waitForResponse(
  1518 |       (response) =>
  1519 |         response.url().includes("/api/sync/today") &&
  1520 |         response.request().method() === "PUT",
  1521 |     );
  1522 |     await scheduleEditor.getByRole("button", { name: "Save Schedule", exact: true }).click();
  1523 |     expect((await saveResponse).ok()).toBe(true);
  1524 |     await expect(scheduledDaysDialog.getByTestId("schedule-today-card")).toBeVisible();
  1525 | 
  1526 |     await page.goto("/", { waitUntil: "domcontentloaded" });
  1527 |     await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
  1528 |     await page.getByRole("button", { name: "More" }).click();
  1529 |     await expect(page.getByRole("menuitem", { name: "Staff roster", exact: true })).toHaveCount(0);
  1530 |     await expect(page.getByRole("menuitem", { name: "Manager action queue", exact: true })).toHaveCount(0);
  1531 |     await page.getByRole("menuitem", { name: "Summary", exact: true }).click();
  1532 |     const timeline = page.getByTestId("day-timeline");
  1533 |     await expect(timeline).toBeVisible();
  1534 |     await expect(timeline).toContainText("Break 1 · 30 min");
  1535 |     await expect(timeline).toContainText("Break 2 · 30 min");
  1536 |     await expect(timeline).toContainText("Break 3 · 30 min");
  1537 |   });
  1538 | 
  1539 |   test("supervisors can review field checks without physical-device attestation controls", async ({ page }) => {
  1540 |     await signUp(page, "supervisor");
  1541 | 
  1542 |     await page.getByRole("button", { name: "More" }).click();
  1543 |     await page.getByRole("menuitem", { name: "Reported issues", exact: true }).click();
  1544 |     const fieldChecks = page.getByTestId("field-checks-panel");
  1545 |     await expect(fieldChecks).toBeVisible();
  1546 |     await expect(fieldChecks.getByRole("heading", { name: "Field checks" })).toBeVisible();
  1547 |     await expect(fieldChecks.getByText("Guided hardware confirmations", { exact: true })).toBeVisible();
  1548 |     await expect(fieldChecks.getByText(/Touch accuracy: Health Unsupported/)).toBeVisible();
  1549 |     await expect(fieldChecks.getByRole("combobox", { name: "Device category", exact: true })).toHaveCount(0);
  1550 |     await expect(fieldChecks.getByRole("button", { name: "Pass", exact: true })).toHaveCount(0);
  1551 |     await expect(fieldChecks.getByRole("button", { name: "Fail", exact: true })).toHaveCount(0);
  1552 |     await expect(fieldChecks.getByRole("button", { name: "Incomplete", exact: true })).toHaveCount(0);
  1553 |   });
  1554 | 
  1555 | });
  1556 | 
```