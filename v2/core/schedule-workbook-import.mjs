import * as XLSX from "xlsx";
import { centralDate, isValidProductionDate } from "./schedule-planning.mjs";

export const scheduleWorkbookLimits = Object.freeze({
  maxBytes: 5 * 1024 * 1024,
  maxSheets: 100,
  maxRows: 20_000,
  maxColumns: 300,
  maxCells: 500_000,
  maxEntries: 2_000,
});

const UNIT_HEADERS = new Set(["units", "cases", "qty", "quantity", "cases planned"]);
const FLAT_CASE_HEADERS = new Set(["cases planned", "cases", "casesplanned", "casesneeded", "cases needed"]);
const NON_PIZZA = /^(?:carton\b|closed\s*-|inventory(?:\b|$)|qc school$|breakfast is old shells and old labels$)/iu;

function text(value) {
  return value == null ? "" : String(value).trim();
}

function dateFromCell(value) {
  let result;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 20_000 || value > 90_000) return null;
    result = new Date(Math.round((value - 25_569) * 86_400_000)).toISOString().slice(0, 10);
  } else if (value instanceof Date && Number.isFinite(value.getTime())) {
    result = `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
  } else if (typeof value === "string") {
    const input = value.trim();
    let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/u.exec(input);
    if (match) {
      result = `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
    } else {
      match = /^(\d{1,2})[/. -](\d{1,2})[/. -](\d{2,4})$/u.exec(input);
      if (!match) return null;
      const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
      result = `${year}-${String(Number(match[1])).padStart(2, "0")}-${String(Number(match[2])).padStart(2, "0")}`;
    }
  } else {
    return null;
  }
  return isValidProductionDate(result) ? result : null;
}

function headerIndex(row, names) {
  const normalized = new Set(names);
  return row.findIndex((value) => normalized.has(text(value).toLocaleLowerCase("en-US")));
}

function isBlockHeader(row) {
  return headerIndex(row, ["brand"]) >= 0
    && headerIndex(row, ["flavor"]) >= 0
    && headerIndex(row, UNIT_HEADERS) >= 0;
}

function isNumericLike(value) {
  const candidate = text(value);
  return /[0-9]/u.test(candidate) && /^[0-9.,%$\s()+-]+$/u.test(candidate);
}

function cellAt(sheet, row, column) {
  return sheet[XLSX.utils.encode_cell({ r: row, c: column })];
}

function formulaPresent(sheet, row, columns) {
  return columns.some((column) => column >= 0 && typeof cellAt(sheet, row, column)?.f === "string");
}

function notesFromRow(row, columns, block) {
  if (!block) return text(columns.notes >= 0 ? row[columns.notes] : "");
  const notes = [];
  const customer = text(columns.customer >= 0 ? row[columns.customer] : "");
  const po = text(columns.po >= 0 ? row[columns.po] : "");
  const ship = text(columns.ship >= 0 ? row[columns.ship] : "");
  if (customer) notes.push(customer);
  if (po) notes.push(`PO ${po}`);
  if (ship) notes.push(`Ship ${ship}`);
  return notes.join(" • ");
}

function parseTarget(value) {
  const candidate = text(value).replace(/[,\s]/gu, "");
  if (!candidate) return null;
  const number = Number(candidate);
  if (!Number.isSafeInteger(number) || number < 1 || number > 1_000_000) return { invalid: true };
  return number;
}

function parseBlocks(workbook, today) {
  const rows = [];
  const errors = [];
  const skipped = [];
  let rowCounter = 0;
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "" });
    for (let index = 0; index < matrix.length;) {
      const header = matrix[index];
      if (!Array.isArray(header) || !isBlockHeader(header)) {
        index += 1;
        continue;
      }
      const columns = {
        brand: headerIndex(header, ["brand"]),
        flavor: headerIndex(header, ["flavor"]),
        units: headerIndex(header, UNIT_HEADERS),
        customer: headerIndex(header, ["customer"]),
        po: headerIndex(header, ["po", "po #", "po#", "po number"]),
        ship: headerIndex(header, ["ship", "ship date", "shipdate"]),
      };
      let date = null;
      let dateColumn = -1;
      for (let column = 0; column < header.length; column += 1) {
        const cell = cellAt(sheet, index, column);
        if (typeof cell?.f === "string") continue;
        const candidate = dateFromCell(header[column]);
        if (candidate) {
          date = candidate;
          dateColumn = column;
          break;
        }
      }
      let rowIndex = index + 1;
      for (; rowIndex < matrix.length; rowIndex += 1) {
        const row = matrix[rowIndex];
        if (!Array.isArray(row)) continue;
        if (isBlockHeader(row)) break;
        const brand = text(row[columns.brand]);
        const flavor = text(row[columns.flavor]);
        const units = text(row[columns.units]);
        if (!brand && !flavor) continue;
        if (isNumericLike(brand) || (!brand && isNumericLike(flavor))) {
          skipped.push({ rowNumber: rowCounter + 1, sheet: sheetName, reason: "Numeric subtotal or running total." });
          continue;
        }
        if (!brand && NON_PIZZA.test(flavor)) {
          skipped.push({ rowNumber: rowCounter + 1, sheet: sheetName, reason: "Known non-run schedule note." });
          continue;
        }
        rowCounter += 1;
        const sourceRow = rowIndex + 1;
        const formulaColumns = [columns.brand, columns.flavor, columns.units, columns.customer, columns.po, columns.ship];
        const formulaDate = dateColumn >= 0 && typeof cellAt(sheet, index, dateColumn)?.f === "string";
        if (formulaPresent(sheet, rowIndex, formulaColumns) || formulaDate) {
          errors.push({ rowNumber: rowCounter, sheet: sheetName, date, message: "Formula cells need a manager review; cached formula values are not imported." });
          continue;
        }
        if (!date) {
          errors.push({ rowNumber: rowCounter, sheet: sheetName, message: `“${brand || flavor}” has no valid day date.` });
          continue;
        }
        if (date < today) {
          skipped.push({ rowNumber: rowCounter, sheet: sheetName, date, reason: "Past production dates are not imported." });
          continue;
        }
        if (!brand) {
          errors.push({ rowNumber: rowCounter, sheet: sheetName, date, message: "Brand is missing." });
          continue;
        }
        const target = parseTarget(row[columns.units]);
        if (target?.invalid) {
          errors.push({ rowNumber: rowCounter, sheet: sheetName, date, message: "Cases must be a whole number from 1 to 1,000,000." });
          continue;
        }
        const notes = notesFromRow(row, columns, true);
        if (brand.length > 200 || flavor.length > 200 || notes.length > 500) {
          errors.push({ rowNumber: rowCounter, sheet: sheetName, date, message: "A product name or note exceeds the supported length." });
          continue;
        }
        rows.push({
          rowNumber: rowCounter,
          sheet: sheetName,
          date,
          brand,
          flavor,
          targetCases: target,
          notes,
          sourceCells: {
            brand: XLSX.utils.encode_cell({ r: rowIndex, c: columns.brand }),
            flavor: XLSX.utils.encode_cell({ r: rowIndex, c: columns.flavor }),
            targetCases: XLSX.utils.encode_cell({ r: rowIndex, c: columns.units }),
            ...(dateColumn >= 0 ? { date: XLSX.utils.encode_cell({ r: index, c: dateColumn }) } : {}),
          },
          sourceRow,
        });
      }
      index = rowIndex;
    }
  }
  return { rows, errors, skipped, multiDay: true };
}

function parseFlat(workbook) {
  const errors = [];
  const skipped = [];
  const rows = [];
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet || !sheet["!ref"]) {
    return { rows, errors: [{ rowNumber: 1, sheet: sheetName ?? "", message: "No schedule rows were found." }], skipped, multiDay: false };
  }
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "" });
  const header = matrix[0] ?? [];
  const columns = {
    brand: headerIndex(header, ["brand"]),
    flavor: headerIndex(header, ["flavor"]),
    cases: headerIndex(header, FLAT_CASE_HEADERS),
    notes: headerIndex(header, ["notes"]),
  };
  if (columns.brand < 0 || columns.flavor < 0 || columns.cases < 0) {
    return { rows, errors: [{ rowNumber: 1, sheet: sheetName, message: "Use the supported V1 flat headers: Brand, Flavor, and Cases Planned." }], skipped, multiDay: false };
  }
  for (let index = 1; index < matrix.length; index += 1) {
    const row = matrix[index];
    const brand = text(row[columns.brand]);
    const flavor = text(row[columns.flavor]);
    const caseText = text(row[columns.cases]);
    if (!brand && !flavor && !caseText) continue;
    if (isNumericLike(brand) || (!brand && isNumericLike(flavor))) {
      skipped.push({ rowNumber: index + 1, sheet: sheetName, reason: "Numeric subtotal or running total." });
      continue;
    }
    if (!brand) {
      errors.push({ rowNumber: index + 1, sheet: sheetName, message: "Brand is missing." });
      continue;
    }
    if (formulaPresent(sheet, index, [columns.brand, columns.flavor, columns.cases, columns.notes])) {
      errors.push({ rowNumber: index + 1, sheet: sheetName, message: "Formula cells need a manager review; cached formula values are not imported." });
      continue;
    }
    const target = parseTarget(row[columns.cases]);
    if (target?.invalid) {
      errors.push({ rowNumber: index + 1, sheet: sheetName, message: "Cases must be a whole number from 1 to 1,000,000." });
      continue;
    }
    const notes = notesFromRow(row, columns, false);
    if (brand.length > 200 || flavor.length > 200 || notes.length > 500) {
      errors.push({ rowNumber: index + 1, sheet: sheetName, message: "A product name or note exceeds the supported length." });
      continue;
    }
    rows.push({
      rowNumber: index + 1,
      sheet: sheetName,
      date: null,
      brand,
      flavor,
      targetCases: target,
      notes,
      sourceCells: {
        brand: XLSX.utils.encode_cell({ r: index, c: columns.brand }),
        flavor: XLSX.utils.encode_cell({ r: index, c: columns.flavor }),
        targetCases: XLSX.utils.encode_cell({ r: index, c: columns.cases }),
      },
      sourceRow: index + 1,
    });
  }
  return { rows, errors, skipped, multiDay: false };
}

export function parseScheduleWorkbook(bytes, { fileName = "", today = centralDate() } = {}) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > scheduleWorkbookLimits.maxBytes) {
    throw new Error("Choose an XLSX workbook no larger than 5 MiB.");
  }
  let workbook;
  try {
    workbook = XLSX.read(bytes, { type: "array", cellDates: true, cellFormula: true });
  } catch {
    throw new Error("The workbook could not be read. Check that it is a supported XLSX file.");
  }
  if (workbook.SheetNames.length < 1 || workbook.SheetNames.length > scheduleWorkbookLimits.maxSheets) {
    throw new Error("The workbook must contain 1–100 worksheets.");
  }
  let cells = 0;
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet?.["!ref"]) continue;
    const range = XLSX.utils.decode_range(sheet["!ref"]);
    const rows = range.e.r - range.s.r + 1;
    const columns = range.e.c - range.s.c + 1;
    cells += rows * columns;
    if (rows > scheduleWorkbookLimits.maxRows || columns > scheduleWorkbookLimits.maxColumns
      || cells > scheduleWorkbookLimits.maxCells) {
      throw new Error("The workbook exceeds the supported row, column, or cell limits. Remove unused formatted ranges or split the workbook.");
    }
  }
  const matrixHasBlocks = workbook.SheetNames.some((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return false;
    return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "" }).some((row) => {
      if (!isBlockHeader(row)) return false;
      return row.some((value) => dateFromCell(value) !== null) || headerIndex(row, ["brand"]) > 0;
    });
  });
  const parsed = matrixHasBlocks ? parseBlocks(workbook, today) : parseFlat(workbook);
  if (parsed.rows.length > scheduleWorkbookLimits.maxEntries) {
    throw new Error("The workbook contains more than 2,000 schedulable rows. Split it into separate workbooks.");
  }
  const boundedFileName = typeof fileName === "string"
    ? fileName.replace(/[\u0000-\u001f\u007f]/gu, "").slice(0, 160)
    : "";
  return {
    ...parsed,
    fileName: boundedFileName,
    errors: parsed.errors.slice(0, 500),
    skipped: parsed.skipped.slice(0, 500),
  };
}
