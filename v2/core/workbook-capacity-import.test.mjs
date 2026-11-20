import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import * as XLSX from "xlsx";
import {
  analyzeWorkbookCapacityDuplicates,
  linkWorkbookCapacityRows,
  parseDoughCapacityWorkbook,
  parseShippingCapacityWorkbook,
  WorkbookCapacityImportError,
} from "./workbook-capacity-import.mjs";

function makeWorkbook(sheets) {
  const workbook = XLSX.utils.book_new();
  for (const [name, rows] of sheets) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

test("parses named dough rows and preserves displayed yield and source cells", () => {
  const buffer = makeWorkbook([["Procedure", [
    ["Dough mixing procedure"],
    [],
    ["Customer", "OZ", "LBS", "YIELD", "PER TRAY"],
    ["North Shop", 7.7, 310.5, 645.19, 84],
  ]]]);
  const parsed = parseDoughCapacityWorkbook(buffer, "procedure.xlsx");
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].name, "North Shop");
  assert.equal(parsed.rows[0].doughballYield, 645.19);
  assert.equal(parsed.rows[0].source.yieldCell, "Procedure!D4");
  assert.equal(parsed.rows[0].source.displayedYield, "645.19");
});

test("keeps missing yield cells unavailable instead of deriving a replacement", () => {
  const buffer = makeWorkbook([["Procedure", [
    ["Customer", "OZ", "LBS", "YIELD", "PER TRAY"],
    ["North Shop", 7.7, 310.5, "", 84],
  ]]]);
  const parsed = parseDoughCapacityWorkbook(buffer, "procedure.xlsx");
  assert.equal(parsed.rows[0].doughballYield, null);
  assert.equal(parsed.rows[0].source.displayedYield, null);
});

test("parses numeric and explicit multipack case sizes from shipping guides", () => {
  const buffer = makeWorkbook([["Shipping", [
    ["Pizza", "Notes", "Pizzas/CS"],
    ["North Shop", "", 12],
    ["South Shop", "", "4 - 3PACK"],
    ["Unknown Shop", "", "varies"],
  ]]]);
  const parsed = parseShippingCapacityWorkbook(buffer, "shipping.xlsx");
  assert.deepEqual(parsed.rows.map((row) => row.pizzasPerCase), [12, 12, null]);
  assert.equal(parsed.rows[1].source.pizzasPerCaseCell, "Shipping!C3");
});

test("links only unique exact normalized product names and remembers confirmed product codes", () => {
  const row = {
    sourceKey: "a".repeat(64),
    name: "Café’s   Dough",
  };
  assert.equal(linkWorkbookCapacityRows(
    [row],
    [{ code: "DOUGH-A", name: "CAFÉ'S Dough" }],
  )[0].linkType, "exact");

  assert.equal(linkWorkbookCapacityRows(
    [row],
    [{ code: "DOUGH-A", name: "Café’s Dough" }, { code: "DOUGH-B", name: "CAFÉ'S DOUGH" }],
  )[0].linkType, "ambiguous");

  const remembered = linkWorkbookCapacityRows(
    [row],
    [{ code: "DOUGH-A", name: "Renamed Product" }],
    [{ sourceKey: row.sourceKey, productCode: "DOUGH-A" }],
  )[0];
  assert.deepEqual([remembered.productCode, remembered.linkType], ["DOUGH-A", "remembered"]);

  const changedCode = linkWorkbookCapacityRows(
    [row],
    [{ code: "DOUGH-MERGED", name: "Renamed Product" }],
    [{ sourceKey: row.sourceKey, productCode: "DOUGH-A" }],
  )[0];
  assert.deepEqual([changedCode.productCode, changedCode.linkType], [null, "unmatched"]);
});

test("manager links resolve only unmatched rows and retain the active product's stable code", () => {
  const rows = [
    { sourceKey: "a".repeat(64), name: "Misspelled Product" },
    { sourceKey: "b".repeat(64), name: "Exact Product" },
    { sourceKey: "c".repeat(64), name: "Duplicate Product" },
  ];
  const products = [
    { code: "PRODUCT-A", name: "Correct Product" },
    { code: "EXACT", name: "Exact Product" },
    { code: "DUP-A", name: "Duplicate Product" },
    { code: "DUP-B", name: " duplicate product " },
  ];
  const managerLinks = [
    { sourceKey: rows[0].sourceKey, productCode: "product-a" },
    { sourceKey: rows[1].sourceKey, productCode: "PRODUCT-A" },
    { sourceKey: rows[2].sourceKey, productCode: "DUP-A" },
  ];

  const linked = linkWorkbookCapacityRows(rows, products, [], managerLinks);
  assert.deepEqual(linked.map(({ productCode, linkType }) => [productCode, linkType]), [
    ["PRODUCT-A", "manager"],
    ["EXACT", "exact"],
    ["DUP-A", "manager"],
  ]);
  assert.equal(linkWorkbookCapacityRows(
    [rows[2]],
    products,
    [],
  )[0].productCode, null);
});

test("a manager can correct a remembered link without changing exact-name defaults", () => {
  const row = { sourceKey: "d".repeat(64), name: "Renamed Product" };
  const products = [
    { code: "PRODUCT-A", name: "Renamed Product" },
    { code: "PRODUCT-B", name: "Other Product" },
  ];
  const priorLinks = [{ sourceKey: row.sourceKey, productCode: "PRODUCT-A" }];
  assert.equal(linkWorkbookCapacityRows([row], products, priorLinks)[0].linkType, "remembered");
  const corrected = linkWorkbookCapacityRows([row], products, priorLinks, [
    { sourceKey: row.sourceKey, productCode: "PRODUCT-B" },
  ])[0];
  assert.deepEqual([corrected.productCode, corrected.linkType], ["PRODUCT-B", "manager"]);
});

test("an explicitly cleared source stays unlinked instead of reappearing as an exact match", () => {
  const row = { sourceKey: "c".repeat(64), name: "Known Product" };
  const products = [{ code: "KNOWN", name: "Known Product" }];
  const cleared = linkWorkbookCapacityRows(
    [row],
    products,
    [{ sourceKey: row.sourceKey, productCode: null }],
  )[0];
  assert.deepEqual([cleared.productCode, cleared.linkType], [null, "cleared"]);
  const restored = linkWorkbookCapacityRows(
    [row],
    products,
    [{ sourceKey: row.sourceKey, productCode: null }],
    [{ sourceKey: row.sourceKey, productCode: "KNOWN" }],
  )[0];
  assert.deepEqual([restored.productCode, restored.linkType], ["KNOWN", "manager"]);
});

test("duplicate review identifies existing, workbook, and projected capacity ambiguity", () => {
  const rows = [
    { sourceKey: "e".repeat(64), productCode: "CAP-A" },
    { sourceKey: "f".repeat(64), productCode: "CAP-A" },
    { sourceKey: "g".repeat(64), productCode: "CAP-B" },
  ];
  const products = [
    { code: "CAP-A", name: "Capacity A" },
    { code: "CAP-B", name: "Capacity B" },
  ];
  const priorLinks = [
    { sourceKey: rows[0].sourceKey, productCode: "CAP-A" },
    { sourceKey: rows[1].sourceKey, productCode: "CAP-A" },
  ];
  const result = analyzeWorkbookCapacityDuplicates(rows, products, priorLinks);
  assert.deepEqual(result, [{
    productCode: "CAP-A",
    productName: "Capacity A",
    existingCount: 2,
    workbookCount: 2,
    resultingCount: 2,
    capacityConsequence: "unavailable",
  }]);

  const corrected = analyzeWorkbookCapacityDuplicates(
    rows,
    products,
    priorLinks,
    [{ sourceKey: rows[1].sourceKey, productCode: "CAP-B" }],
  );
  assert.deepEqual(corrected.map(({ productCode, existingCount, resultingCount }) =>
    [productCode, existingCount, resultingCount]), [
    ["CAP-A", 2, 1],
    ["CAP-B", 0, 2],
  ]);
});

test("parses every local dough procedure and the approved shipping guide", {
  skip: process.env.V2_SKIP_PRIVATE_SOURCE_CORPUS === "true"
    ? "Private customer workbooks are not provisioned in this CI checkout."
    : false,
}, async () => {
  const doughDirectory = new URL("../../attached_assets/source-library/dough/", import.meta.url);
  const shippingDirectory = new URL("../../attached_assets/source-library/shipping/", import.meta.url);
  const doughFiles = (await readdir(doughDirectory)).filter((name) => /\.xlsx$/iu.test(name));
  const shippingFiles = (await readdir(shippingDirectory)).filter((name) => /\.xlsx$/iu.test(name));
  assert.equal(doughFiles.length, 13);
  assert.equal(shippingFiles.length, 1);

  const doughResults = [];
  for (const fileName of doughFiles) {
    const parsed = parseDoughCapacityWorkbook(await readFile(new URL(fileName, doughDirectory)), fileName);
    assert.ok(parsed.rows.length > 0, `${fileName} should contain dough rows`);
    doughResults.push(...parsed.rows);
  }
  const approvedRow = doughResults.find((row) => row.name === "12'' Aldo");
  assert.equal(approvedRow?.doughballYield, 645.19);
  assert.equal(approvedRow?.source.yieldCell, "Sheet1!E32");

  const fileName = shippingFiles[0];
  const shipping = parseShippingCapacityWorkbook(await readFile(new URL(fileName, shippingDirectory)), fileName);
  assert.ok(shipping.rows.length > 0);
  assert.ok(shipping.rows.some((row) => row.name === "Aldo's" && row.pizzasPerCase === 12));
});

test("rejects invalid workbooks and unsupported file families explicitly", () => {
  assert.throws(
    () => parseDoughCapacityWorkbook(Buffer.from("not an xlsx"), "procedure.xlsx"),
    WorkbookCapacityImportError,
  );
  assert.throws(
    () => parseDoughCapacityWorkbook(makeWorkbook([["Sheet1", [["not a dough table"]]]]), "procedure.xlsx"),
    /No doughball yield table was found/u,
  );
});
