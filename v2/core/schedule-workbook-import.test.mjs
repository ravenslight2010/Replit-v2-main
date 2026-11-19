import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { parseScheduleWorkbook } from "./schedule-workbook-import.mjs";

function workbookBytes(sheets) {
  const workbook = XLSX.utils.book_new();
  for (const [name, rows] of sheets) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

test("flat V1 schedule sheets are previewed without guessing a date", () => {
  const bytes = workbookBytes([["Plan", [
    ["Brand", "Flavor", "Cases Planned", "Notes"],
    ["Oak Street", "Cheese", 24, "PO 58"],
    ["", "0.08", 9, ""],
    ["", "Needs review", 3, ""],
    ["North", "Pepperoni", "", "Ship Friday"],
  ]]]);
  const parsed = parseScheduleWorkbook(bytes, { fileName: "v1-plan.xlsx", today: "2026-11-18" });
  assert.equal(parsed.multiDay, false);
  assert.equal(parsed.rows.length, 2);
  assert.deepEqual(parsed.rows[0], {
    rowNumber: 2,
    sheet: "Plan",
    date: null,
    brand: "Oak Street",
    flavor: "Cheese",
    targetCases: 24,
    notes: "PO 58",
    sourceCells: { brand: "A2", flavor: "B2", targetCases: "C2" },
    sourceRow: 2,
  });
  assert.equal(parsed.rows[1].targetCases, null);
  assert.equal(parsed.rows[1].notes, "Ship Friday");
  assert.equal(parsed.errors[0].message, "Brand is missing.");
  assert.equal(parsed.skipped.length, 1);
});

test("dated V1 day blocks preserve per-day rows, notes, and skip reasons", () => {
  const serial = (year, month, day) => Date.UTC(year, month - 1, day) / 86_400_000 + 25_569;
  const bytes = workbookBytes([
    ["Monday", [
      ["Monday - Day", serial(2026, 11, 19), "Brand", "Flavor", "Units", "Customer", "Ship", "PO"],
      ["", "", "Oak Street", "Cheese", 20, "Cafe", "Nov 20", "PO-5"],
      ["", "", "", "Carton order", "", "", "", ""],
      ["", "", "", "", "", "", ""],
      ["Tuesday - Day", serial(2026, 11, 20), "Brand", "Flavor", "Units", "Customer", "Ship", "PO"],
      ["", "", "Oak Street", "Pepperoni", 12, "", "", "PO-7"],
      ["", "", "", "QC school", "", "", "", ""],
      ["", "", "", "Dough", 4, "", "", ""],
    ]],
    ["Previous", [
      ["Day", serial(2026, 11, 17), "Brand", "Flavor", "Cases", "Customer"],
      ["", "", "Old Brand", "Cheese", 10, ""],
    ]],
  ]);
  const parsed = parseScheduleWorkbook(bytes, { today: "2026-11-18" });
  assert.equal(parsed.multiDay, true);
  assert.deepEqual(parsed.rows.map(({ date, flavor, targetCases, notes }) => ({ date, flavor, targetCases, notes })), [
    { date: "2026-11-19", flavor: "Cheese", targetCases: 20, notes: "Cafe • PO PO-5 • Ship Nov 20" },
    { date: "2026-11-20", flavor: "Pepperoni", targetCases: 12, notes: "PO PO-7" },
  ]);
  assert.equal(parsed.skipped.length, 3);
  assert.equal(parsed.skipped.filter((item) => item.reason.includes("Past")).length, 1);
  assert.equal(parsed.errors.length, 1);
  assert.match(parsed.errors[0].message, /Brand is missing/u);
});

test("formula-backed values stay review-only and malformed flat sheets report an issue", () => {
  const formulaSheet = XLSX.utils.aoa_to_sheet([
    ["Brand", "Flavor", "Cases Planned", "Notes"],
    ["Oak Street", "Cheese", 24, ""],
  ]);
  formulaSheet.C2 = { t: "n", v: 24, f: "12+12" };
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, formulaSheet, "Plan");
  const formulaBytes = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  const formulaResult = parseScheduleWorkbook(formulaBytes, { today: "2026-11-18" });
  assert.equal(formulaResult.rows.length, 0);
  assert.match(formulaResult.errors[0].message, /Formula cells/u);

  const unsupported = parseScheduleWorkbook(workbookBytes([["Other", [["Flavor", "Units"], ["Cheese", 10]]]]));
  assert.equal(unsupported.rows.length, 0);
  assert.match(unsupported.errors[0].message, /supported V1 flat headers/u);
});

test("unsupported fractional targets and oversized names or notes remain review-only", () => {
  const parsed = parseScheduleWorkbook(workbookBytes([["Plan", [
    ["Brand", "Flavor", "Cases Planned", "Notes"],
    ["Brand", "Fraction", 2.5, ""],
    ["Brand", "Long note", 2, "x".repeat(501)],
    ["B".repeat(201), "Long name", 2, ""],
  ]]]), { fileName: "bounded-review.xlsx", today: "2026-11-18" });
  assert.equal(parsed.rows.length, 0);
  assert.equal(parsed.errors.length, 3);
  assert.ok(parsed.errors.every((issue) => /whole number|exceeds the supported length/u.test(issue.message)));
});
