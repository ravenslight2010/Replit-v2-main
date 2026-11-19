# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: phone-layout.spec.ts >> phone layout smoke >> operational dialog actions remain reachable at 375x812
- Location: e2e/phone-layout.spec.ts:1460:5

# Error details

```
Error: expect(locator).toBeDisabled() failed

Locator: locator('[data-slot="calendar"]').locator('button[data-day][disabled]').first()
Expected: disabled
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeDisabled" locator('[data-slot="calendar"]').locator('button[data-day][disabled]').first() with timeout 5000ms
  - waiting for locator('[data-slot="calendar"]').locator('button[data-day][disabled]').first()

```

```yaml
- complementary "App updates":
  - button "App updates · Development preview"
  - status: Development preview. Published updates are not checked in this development preview.
- main:
  - heading "Run Calculator" [level=1]
  - 'button "Sync status: Synchronized"'
  - button "Cast to other screens"
  - button "Enter fullscreen / kiosk mode"
  - button "Manager — full access"
  - button "More — 758 manager actions need attention": "758"
  - group "production-line department":
    - tabpanel "Run":
      - text: Confirmed server baseline
      - button
      - text: Run 1 of 2 2/30
      - button "Reorder runs"
      - button "Glance view — large numbers for distance viewing"
      - button "Remove 1 blank run"
      - button
      - text: Run Setup Brand & Flavor
      - textbox "Brand…"
      - text: —
      - textbox "Flavor…"
      - text: Target Cases
      - spinbutton "0"
      - paragraph: ⚠ Enter cases to enable calculations
      - button "PAUSE RUN"
      - button "STOP RUN"
      - button "LOG STOPPAGE"
      - text: "Elapsed Time: 0m"
      - paragraph: Counts can't track yet — Crusts Per Cycle, Cycle Speed, Total line time not set
      - paragraph: Scroll down on this tab and fill in those numbers under the line settings. The completed count, timing, and line phase status all start working once they're in.
      - text: Line Details Cases Left to Run 0 Approx. Cases on Line 0 Dough Status Balanced Cases on Last Skid 0
      - heading "Temporary Adjustments" [level=3]
      - button "Clear All"
      - text: Freeze Tunnel Time
      - spinbutton "Freeze Tunnel Time": "0"
      - text: Crusts/Cycle
      - spinbutton "Crusts/Cycle": "0"
      - text: Cycle Speed
      - spinbutton "Cycle Speed": "0"
      - paragraph: For this run only — leave at 0 to use the Setup value. Setup stays unchanged.
      - button "Select run 1"
      - button "Select run 2"
      - button "Next Unnamed Run"
      - paragraph: Upcoming Runs
      - button "Unnamed Run"
      - group:
        - text: Line Setup
        - group:
          - text: Line Type
          - button "Dough"
          - button "Crust"
          - text: Die Type
          - button "12\""
          - button "7\" Dies"
          - button "Add / remove die types"
          - text: Allergen
          - button "None"
          - button "Egg Allergen"
          - button "Soy Allergen"
          - text: Crusts Per Cycle
          - spinbutton "Crusts Per Cycle": "0"
          - text: Cycle Speed (cyc/min)
          - spinbutton "Cycle Speed (cyc/min)": "0"
          - text: Speed Adjustment
          - spinbutton "Speed Adjustment": "0.92"
          - text: Freeze tunnel time (min)
          - spinbutton "Freeze tunnel time (min)": "0"
          - text: Press / Oven transit (min)
          - spinbutton "Press / Oven transit (min)": "1.25"
          - text: Frontline transit (min)
          - spinbutton "Frontline transit (min)": "1.25"
          - text: Wrapper / Packaging transit (min)
          - spinbutton "Wrapper / Packaging transit (min)": "2.5"
          - paragraph: "Provisional split: half of the saved pre-tunnel time per section. Edit to replace this allocation; these are not measured factory times."
          - paragraph: 1.25 Press / Oven + 1.25 Frontline + 0.00 Freeze Tunnel + 2.50 Wrapper / Packaging = 0.00 min total. Press / Oven carries pairs; Frontline carries single pizzas. Two pizzas remain two pizzas.
          - status: Section times exceed total line time. Calculations proportionally fit them to the total shown above; total transit time is not increased.
          - text: Pizzas Per Case
          - spinbutton "Pizzas Per Case": "1"
          - text: Cases Per Skid
          - spinbutton "Cases Per Skid": "0"
          - text: Extra Case Buffer
          - spinbutton "Extra Case Buffer": "0"
          - text: Doughballs Per Tray
          - spinbutton "Doughballs Per Tray": "0"
          - text: Dough Batch Yield (doughballs)
          - spinbutton "Dough Batch Yield (doughballs)": "0"
  - group "production-line department"
  - tablist:
    - tab "Run" [selected]
    - tab "Dough"
    - tab "Sauce"
    - tab "Front"
    - tab "Pack"
    - tab "Warehouse"
  - group "production-line department"
  - group "production-line department"
  - group "production-line department"
  - dialog "Plan for Nov 1":
    - button "Back to scheduled days"
    - heading "Plan for Nov 1" [level=2]
    - button "Close schedule editor"
    - text: Date
    - button "Choose production date" [expanded]: Nov 1, 2026
    - text: Standard breaks
    - paragraph: Each planned break is fixed at 30 minutes. A clock-time break never pauses production automatically.
    - paragraph: No breaks configured yet.
    - button "Add breaks"
    - text: Runs
    - button "Import Excel"
    - button "Add Run"
    - text: Run 1 Brand
    - combobox "Schedule brand":
      - option "— Brand —" [selected]
      - option "guarded_undo_mvxiia4z_syked8yf_chromium_page_0_mvxij5u2_1usz9bkn"
      - option "guarded_undo_mvxiia4z_syked8yf_chromium_page_1_mvxij5u2_pmo0e0sx"
      - option "guarded_undo_mvxiia4z_syked8yf_chromium_page_10_mvxij5u2_qqyjuso6"
      - option "guarded_undo_mvxiia4z_syked8yf_chromium_page_11_mvxij5u2_wy2bhy9w"
      - option "guarded_undo_mvxiia4z_syked8yf_chromium_page_12_mvxij5u2_vi5ak0gy"
      - option "guarded_undo_mvxiia4z_syked8yf_chromium_page_13_mvxij5u2_ljnspyem"
      - option "guarded_undo_mvxiia4z_syked8yf_chromium_page_14_mvxij5u2_kbby6vep"
      - option "guarded_undo_mvxiia4z_syked8yf_chromium_page_15_mvxij5u2_ubgqgi4w"
      - option "guarded_undo_mvxiia4z_syked8yf_chromium_page_16_mvxij5u2_d39ck5fe"
      - option "guarded_undo_mvxiia4z_syked8yf_chromium_page_17_mvxij5u2_t1l9f7ps"
      - option "guarded_undo_mvxiia4z_syked8yf_chromium_page_18_mvxij5u2_fdhbmz65"
      - option "guarded_undo_mvxiia4z_syked8yf_chromium_page_19_mvxij5u2_g0axd2ux"
      - option "guarded_undo_mvxiia4z_syked8yf_chromium_page_2_mvxij5u2_v6wegdv5"
      - option "guarded_undo_mvxiia4z_syked8yf_chromium_page_20_mvxij5u2_jhpntws8"
      - option "guarded_undo_mvxiia4z_syked8yf_chromium_page_21_mvxij5u2_uuri9dmp"
      - option "guarded_undo_mvxiia4z_syked8yf_chromium_page_22_mvxij5u2_km5b65b7"
      - option "guarded_undo_mvxiia4z_syked8yf_chromium_page_23_mvxij5u2_b95l8wgd"
      - option "guarded_undo_mvxiia4z_syked8yf_chromium_page_24_mvxij5u2_955pudc9"
      - option "guarded_undo_mvxiia4z_syked8yf_chromium_page_3_mvxij5u2_6ncjbdce"
      - option "guarded_undo_mvxiia4z_syked8yf_chromium_page_4_mvxij5u2_46ijlkfp"
      - option "guarded_undo_mvxiia4z_syked8yf_chromium_page_5_mvxij5u2_hp9rs2b3"
      - option "guarded_undo_mvxiia4z_syked8yf_chromium_page_6_mvxij5u2_08yyzn59"
      - option "guarded_undo_mvxiia4z_syked8yf_chromium_page_7_mvxij5u2_l9j5zfdu"
      - option "guarded_undo_mvxiia4z_syked8yf_chromium_page_8_mvxij5u2_afn424k6"
      - option "guarded_undo_mvxiia4z_syked8yf_chromium_page_9_mvxij5u2_odttfmut"
      - option "guarded_undo_mvxiia4z_syked8yf_chromium_renamed_mvxiia7g_hv7aiggb"
      - option "LiveAddBrandB_e2emph16xzbs"
      - option "Phone Layout 375"
      - option "Phone Layout 568"
      - option "RecipeRoundTripBrand_mvxiy92x_rtfo15kl"
    - text: Flavor
    - combobox "Schedule flavor" [disabled]:
      - option "— Flavor —" [selected]
    - text: Cases Needed
    - spinbutton "0"
    - button "Full Recipe & Settings"
    - button "Cancel"
    - button "Save Schedule" [disabled]
- region "Notifications (F8)":
  - list
- dialog:
  - navigation "Navigation bar":
    - button "Go to the Previous Month"
    - button "Go to the Next Month"
  - status: November 2026
  - grid "November 2026":
    - rowgroup:
      - row "Today, Sunday, November 1st, 2026, selected Monday, November 2nd, 2026 Tuesday, November 3rd, 2026 Wednesday, November 4th, 2026 Thursday, November 5th, 2026 Friday, November 6th, 2026 Saturday, November 7th, 2026":
        - gridcell "Today, Sunday, November 1st, 2026, selected" [selected]:
          - button "Today, Sunday, November 1st, 2026, selected": "1"
        - gridcell "Monday, November 2nd, 2026":
          - button "Monday, November 2nd, 2026": "2"
        - gridcell "Tuesday, November 3rd, 2026":
          - button "Tuesday, November 3rd, 2026": "3"
        - gridcell "Wednesday, November 4th, 2026":
          - button "Wednesday, November 4th, 2026": "4"
        - gridcell "Thursday, November 5th, 2026":
          - button "Thursday, November 5th, 2026": "5"
        - gridcell "Friday, November 6th, 2026":
          - button "Friday, November 6th, 2026": "6"
        - gridcell "Saturday, November 7th, 2026":
          - button "Saturday, November 7th, 2026": "7"
      - row "Sunday, November 8th, 2026 Monday, November 9th, 2026 Tuesday, November 10th, 2026 Wednesday, November 11th, 2026 Thursday, November 12th, 2026 Friday, November 13th, 2026 Saturday, November 14th, 2026":
        - gridcell "Sunday, November 8th, 2026":
          - button "Sunday, November 8th, 2026": "8"
        - gridcell "Monday, November 9th, 2026":
          - button "Monday, November 9th, 2026": "9"
        - gridcell "Tuesday, November 10th, 2026":
          - button "Tuesday, November 10th, 2026": "10"
        - gridcell "Wednesday, November 11th, 2026":
          - button "Wednesday, November 11th, 2026": "11"
        - gridcell "Thursday, November 12th, 2026":
          - button "Thursday, November 12th, 2026": "12"
        - gridcell "Friday, November 13th, 2026":
          - button "Friday, November 13th, 2026": "13"
        - gridcell "Saturday, November 14th, 2026":
          - button "Saturday, November 14th, 2026": "14"
      - row "Sunday, November 15th, 2026 Monday, November 16th, 2026 Tuesday, November 17th, 2026 Wednesday, November 18th, 2026 Thursday, November 19th, 2026 Friday, November 20th, 2026 Saturday, November 21st, 2026":
        - gridcell "Sunday, November 15th, 2026":
          - button "Sunday, November 15th, 2026": "15"
        - gridcell "Monday, November 16th, 2026":
          - button "Monday, November 16th, 2026": "16"
        - gridcell "Tuesday, November 17th, 2026":
          - button "Tuesday, November 17th, 2026": "17"
        - gridcell "Wednesday, November 18th, 2026":
          - button "Wednesday, November 18th, 2026": "18"
        - gridcell "Thursday, November 19th, 2026":
          - button "Thursday, November 19th, 2026": "19"
        - gridcell "Friday, November 20th, 2026":
          - button "Friday, November 20th, 2026": "20"
        - gridcell "Saturday, November 21st, 2026":
          - button "Saturday, November 21st, 2026": "21"
      - row "Sunday, November 22nd, 2026 Monday, November 23rd, 2026 Tuesday, November 24th, 2026 Wednesday, November 25th, 2026 Thursday, November 26th, 2026 Friday, November 27th, 2026 Saturday, November 28th, 2026":
        - gridcell "Sunday, November 22nd, 2026":
          - button "Sunday, November 22nd, 2026": "22"
        - gridcell "Monday, November 23rd, 2026":
          - button "Monday, November 23rd, 2026": "23"
        - gridcell "Tuesday, November 24th, 2026":
          - button "Tuesday, November 24th, 2026": "24"
        - gridcell "Wednesday, November 25th, 2026":
          - button "Wednesday, November 25th, 2026": "25"
        - gridcell "Thursday, November 26th, 2026":
          - button "Thursday, November 26th, 2026": "26"
        - gridcell "Friday, November 27th, 2026":
          - button "Friday, November 27th, 2026": "27"
        - gridcell "Saturday, November 28th, 2026":
          - button "Saturday, November 28th, 2026": "28"
      - row "Sunday, November 29th, 2026 Monday, November 30th, 2026 Tuesday, December 1st, 2026 Wednesday, December 2nd, 2026 Thursday, December 3rd, 2026 Friday, December 4th, 2026 Saturday, December 5th, 2026":
        - gridcell "Sunday, November 29th, 2026":
          - button "Sunday, November 29th, 2026": "29"
        - gridcell "Monday, November 30th, 2026":
          - button "Monday, November 30th, 2026": "30"
        - gridcell "Tuesday, December 1st, 2026":
          - button "Tuesday, December 1st, 2026": "1"
        - gridcell "Wednesday, December 2nd, 2026":
          - button "Wednesday, December 2nd, 2026": "2"
        - gridcell "Thursday, December 3rd, 2026":
          - button "Thursday, December 3rd, 2026": "3"
        - gridcell "Friday, December 4th, 2026":
          - button "Friday, December 4th, 2026": "4"
        - gridcell "Saturday, December 5th, 2026":
          - button "Saturday, December 5th, 2026": "5"
```

# Test source

```ts
  1512 |         const casesNeeded = page.getByTestId("input-casesNeeded");
  1513 | 
  1514 |       const pizzasPerCase = page.getByTestId("input-pizzasPerCase");
  1515 |       if (await pizzasPerCase.count()) {
  1516 |         const lineSetup = page.locator("details").filter({
  1517 |           has: page.locator("summary", { hasText: /line.?setup/i }),
  1518 |         }).first();
  1519 |         if (!(await lineSetup.evaluate((element) => (element as HTMLDetailsElement).open))) {
  1520 |           await lineSetup.locator("summary").click();
  1521 |         }
  1522 |         await pizzasPerCase.fill("1");
  1523 |         await pizzasPerCase.blur();
  1524 |       }
  1525 |       await page.getByTestId("button-start-run").click();
  1526 |       await expect(page.getByRole("button", { name: /pause run/i })).toBeVisible();
  1527 | 
  1528 |       const logStoppage = page.getByTestId("button-log-stoppage");
  1529 |       await expect(logStoppage).toBeVisible();
  1530 |       await logStoppage.click();
  1531 |       const stopDialog = page.getByRole("dialog", { name: "Log Line Stop" });
  1532 |       await expect(stopDialog).toBeVisible();
  1533 |       await assertOverlayActionHitTargets(
  1534 |         stopDialog,
  1535 |         `Log Line Stop at ${viewport.width}x${viewport.height}`,
  1536 |       );
  1537 |       await assertReachableDialogAction(
  1538 |         stopDialog.getByRole("button", { name: "Log Without Reason" }),
  1539 |         `Log Without Reason at ${viewport.width}x${viewport.height}`,
  1540 |       );
  1541 | 
  1542 |       // The manager-only stop-reason editor is opened from the stop dialog,
  1543 |       // not by directly mounting a fixture state.
  1544 |       await stopDialog.getByRole("button", { name: "Edit list" }).click();
  1545 |       const reasonDialog = page.getByRole("dialog", { name: "Quick Reason List" });
  1546 |       await expect(reasonDialog).toBeVisible();
  1547 |       await assertOverlayActionHitTargets(
  1548 |         reasonDialog,
  1549 |         `Quick Reason List at ${viewport.width}x${viewport.height}`,
  1550 |       );
  1551 |       await assertReachableDialogAction(
  1552 |         reasonDialog.getByPlaceholder("Add new reason…"),
  1553 |         `Quick Reason List input at ${viewport.width}x${viewport.height}`,
  1554 |       );
  1555 |       await assertReachableDialogAction(
  1556 |         reasonDialog.getByRole("button", { name: "Add", exact: true }),
  1557 |         `Quick Reason List Add at ${viewport.width}x${viewport.height}`,
  1558 |       );
  1559 |       await assertReachableDialogAction(
  1560 |         reasonDialog.getByRole("button", { name: "Reset to defaults" }),
  1561 |         `Quick Reason List reset at ${viewport.width}x${viewport.height}`,
  1562 |       );
  1563 |       await reasonDialog.getByRole("button", { name: "Close quick reason list" }).click();
  1564 |       await expect(reasonDialog).toBeHidden();
  1565 |       await stopDialog.getByRole("button", { name: "Cancel" }).click();
  1566 |       await expect(stopDialog).toBeHidden();
  1567 | 
  1568 |       // Password uses the manager's More menu and remains unsubmitted: filling
  1569 |       // valid-shaped values enables the real lower action without changing the
  1570 |       // disposable account's credentials.
  1571 |       await page.getByTitle("More").click();
  1572 |       await page.getByRole("menuitem", { name: "Password", exact: true }).click();
  1573 |       const passwordDialog = page.getByRole("dialog", { name: "Password" });
  1574 |       await expect(passwordDialog).toBeVisible();
  1575 |       await passwordDialog.getByLabel("Current password").fill("not-the-password");
  1576 |       await passwordDialog.getByRole("textbox", { name: "New password", exact: true }).fill("PhoneLayoutNew123!");
  1577 |       await passwordDialog.getByRole("textbox", { name: "Confirm new password", exact: true }).fill("PhoneLayoutNew123!");
  1578 |       await assertReachableDialogAction(
  1579 |         passwordDialog.getByRole("button", { name: "Update password", exact: true }),
  1580 |         `Update password at ${viewport.width}x${viewport.height}`,
  1581 |       );
  1582 |       await passwordDialog.getByRole("button", { name: "Close password dialog" }).click();
  1583 |       await expect(passwordDialog).toBeHidden();
  1584 | 
  1585 |       // Schedule is also opened from More. Exercise both the list's lower
  1586 |       // action and the editor's lower actions without saving a schedule.
  1587 |       await page.getByTitle("More").click();
  1588 |       await page.getByRole("menuitem", { name: "Schedule", exact: true }).click();
  1589 |         const scheduleDialog = page
  1590 |           .getByRole("dialog")
  1591 |           .filter({ has: page.locator("#scheduled-days-dialog-title") })
  1592 |           .first();
  1593 |       await expect(scheduleDialog).toBeVisible();
  1594 |       await expect(scheduleDialog.getByRole("heading", { name: "Scheduled Days" })).toBeVisible();
  1595 |       await assertOverlayActionHitTargets(
  1596 |         scheduleDialog,
  1597 |         `Scheduled Days list at ${viewport.width}x${viewport.height}`,
  1598 |       );
  1599 |       await assertReachableDialogAction(
  1600 |         scheduleDialog.getByRole("button", { name: "Schedule New Day" }),
  1601 |         `Schedule New Day at ${viewport.width}x${viewport.height}`,
  1602 |       );
  1603 |       await scheduleDialog.getByRole("button", { name: "Schedule New Day" }).click();
  1604 |       await expect(scheduleDialog.getByRole("heading", { name: /Plan for/ })).toBeVisible();
  1605 |       await expect(scheduleDialog.getByRole("button", { name: "Save Schedule" })).toBeVisible();
  1606 |       const scheduleDateTrigger = scheduleDialog.getByTestId("schedule-date-trigger");
  1607 |       const initialScheduleDate = await scheduleDateTrigger.getAttribute("data-date-value");
  1608 |       expect(initialScheduleDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  1609 |       await scheduleDateTrigger.click();
  1610 |       const scheduleCalendar = page.locator('[data-slot="calendar"]');
  1611 |       await expect(scheduleCalendar.getByRole("grid")).toBeVisible();
> 1612 |       await expect(scheduleCalendar.locator("button[data-day][disabled]").first()).toBeDisabled();
       |                                                                                    ^ Error: expect(locator).toBeDisabled() failed
  1613 |       const selectedScheduleDay = scheduleCalendar.locator(
  1614 |         'button[data-selected-single="true"]',
  1615 |       );
  1616 |       await expect(selectedScheduleDay).toBeVisible();
  1617 |       const nextScheduleDate = await selectedScheduleDay.evaluate((selected) => {
  1618 |         const days = Array.from(
  1619 |           selected.closest("[data-slot='calendar']")?.querySelectorAll<HTMLButtonElement>(
  1620 |             "button[data-day]:not([disabled])",
  1621 |           ) ?? [],
  1622 |         );
  1623 |         return (
  1624 |           days.find((day) => day !== selected)?.getAttribute("data-day") ?? null
  1625 |         );
  1626 |       });
  1627 |       expect(nextScheduleDate).not.toBeNull();
  1628 |       await scheduleCalendar
  1629 |         .locator(`button[data-day="${nextScheduleDate}"]`)
  1630 |         .click();
  1631 |       // Wait for the calendar's selection handler to update the date and close
  1632 |       // its popover. Sending Escape during the closing animation can reach the
  1633 |       // parent dialog instead and hide the whole schedule editor.
  1634 |       await expect(scheduleDateTrigger).not.toHaveAttribute(
  1635 |         "data-date-value",
  1636 |         initialScheduleDate ?? "",
  1637 |       );
  1638 |       await expect(scheduleDialog).toBeVisible();
  1639 |       await expect(scheduleCalendar).toBeHidden();
  1640 |       await expect(scheduleDateTrigger).not.toHaveAttribute(
  1641 |         "data-date-value",
  1642 |         initialScheduleDate ?? "",
  1643 |       );
  1644 |       await expect(scheduleDateTrigger).toHaveAttribute(
  1645 |         "data-date-value",
  1646 |         /^\d{4}-\d{2}-\d{2}$/,
  1647 |       );
  1648 |       await assertReachableDialogAction(
  1649 |         scheduleDialog.getByRole("button", { name: "Cancel", exact: true }),
  1650 |         `Schedule editor Cancel at ${viewport.width}x${viewport.height}`,
  1651 |       );
  1652 |       await scheduleDialog.getByRole("button", { name: "Cancel", exact: true }).click();
  1653 |       await expect(scheduleDialog.getByRole("button", { name: "Schedule New Day" })).toBeVisible();
  1654 |       await scheduleDialog.getByRole("button", { name: "Close scheduled days" }).click();
  1655 |       await expect(scheduleDialog).toBeHidden();
  1656 |     });
  1657 |   }
  1658 | 
  1659 |   test(`sign-in is usable without overflow in narrow landscape at ${LANDSCAPE_VIEWPORT.width}x${LANDSCAPE_VIEWPORT.height}`, async ({
  1660 |     page,
  1661 |   }) => {
  1662 |     await page.setViewportSize(LANDSCAPE_VIEWPORT);
  1663 |     await page.goto("/sign-in", { waitUntil: "domcontentloaded" });
  1664 |     await page
  1665 |       .locator("#username")
  1666 |       .waitFor({ state: "visible", timeout: 20_000 });
  1667 | 
  1668 |     await assertPhoneLayout(page, "narrow landscape sign-in");
  1669 |     await expect(
  1670 |       page.getByRole("heading", { name: /sign in to run calculator/i }),
  1671 |     ).toBeVisible();
  1672 |     await expect(page.getByRole("textbox", { name: "Username" })).toBeEditable();
  1673 |     await expect(page.getByRole("textbox", { name: "Password" })).toBeEditable();
  1674 |     await expect(
  1675 |       page.getByRole("button", { name: /^sign in$/i }),
  1676 |     ).toBeVisible();
  1677 |   });
  1678 | 
  1679 |   test("focused sign-in fields stay reachable when the virtual keyboard reduces the viewport", async ({
  1680 |     page,
  1681 |   }) => {
  1682 |     await page.setViewportSize(LANDSCAPE_VIEWPORT);
  1683 |     await page.goto("/sign-in", { waitUntil: "domcontentloaded" });
  1684 |     await page
  1685 |       .locator("#username")
  1686 |       .waitFor({ state: "visible", timeout: 20_000 });
  1687 | 
  1688 |     await assertFocusedFieldIsKeyboardSafe(
  1689 |       page,
  1690 |       page.getByRole("textbox", { name: "Username" }),
  1691 |       "Username",
  1692 |     );
  1693 | 
  1694 |     // Desktop Chromium has no on-screen keyboard. Reducing the viewport after
  1695 |     // the first focus models the visualViewport resize that mobile browsers
  1696 |     // perform when the keyboard opens.
  1697 |     await page.setViewportSize({
  1698 |       width: LANDSCAPE_VIEWPORT.width,
  1699 |       height: 220,
  1700 |     });
  1701 |     await assertPhoneLayout(page, "keyboard-safe username field");
  1702 | 
  1703 |     await assertFocusedFieldIsKeyboardSafe(
  1704 |       page,
  1705 |       page.getByRole("textbox", { name: "Password" }),
  1706 |       "Password",
  1707 |     );
  1708 |     await assertPhoneLayout(page, "keyboard-safe password field");
  1709 |   });
  1710 | 
  1711 |   test("@real-mobile-browser physical Android Chrome dismisses first-login onboarding before Run interactions", async ({
  1712 |     page,
```