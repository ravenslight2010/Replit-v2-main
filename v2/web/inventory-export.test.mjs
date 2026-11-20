import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMovementCsv,
  buildStockCsv,
  collectAllMovementPages,
} from "./inventory-export.mjs";

const movement = (id, occurredAt, overrides = {}) => ({
  id,
  occurredAt,
  movementGroupId: null,
  productCode: "FLOUR",
  productName: "Bread Flour",
  unit: "lb",
  type: "adjustment",
  quantityDelta: "-1.25",
  reason: "Cycle count",
  lotNumber: "",
  sourceReference: "",
  actorId: "manager-1",
  plannedProductId: null,
  lotAllocations: [],
  ...overrides,
});

const cursorFor = (item) => ({ id: item.id, occurredAt: item.occurredAt });

test("stock CSV preserves canonical names, units, and decimal quantities", () => {
  const csv = buildStockCsv([{
    code: "FLOUR",
    name: "Bread Flour",
    unit: "lb",
    quantity: "12.500000",
    stagedQuantity: "2.250000",
    availableQuantity: "10.250000",
    lotQuantity: "12.500000",
  }], { id: "warehouse-1", name: "North Warehouse" });

  assert.match(csv, /^\uFEFF"warehouse_id","warehouse_name","product_code","product_name","unit","on_hand","staged","available","lot_quantity"/u);
  assert.match(csv, /"warehouse-1","North Warehouse","FLOUR","Bread Flour","lb","12\.500000","2\.250000","10\.250000","12\.500000"/u);
  assert.ok(csv.endsWith("\r\n"));
});

test("CSV quotes text, escapes quotes, and neutralizes formula-leading text", () => {
  const csv = buildMovementCsv([movement("move-1", "2026-11-20T10:00:00.000Z", {
    productName: 'Flour, "premium"',
    reason: " =HYPERLINK(\"https://bad.example\")",
    lotNumber: "+cmd|' /C calc'!A0",
    sourceReference: "@SUM(1,1)",
    lotAllocations: [{ lotNumber: "-bad", quantityDelta: "-2" }],
  })], { id: "warehouse-1", name: "North Warehouse" });

  assert.ok(csv.includes('"warehouse-1","North Warehouse"'));
  assert.ok(csv.includes('"Flour, ""premium"""'));
  assert.ok(csv.includes('"\u0027 =HYPERLINK(""https://bad.example"")"'));
  assert.ok(csv.includes("\"'+cmd|' /C calc'!A0\""));
  assert.ok(csv.includes('"\u0027@SUM(1,1)"'));
  assert.ok(csv.includes('"[{""lotNumber"":""-bad"",""quantityDelta"":""-2""}]"'));
  assert.ok(csv.includes('"-1.25"'), "a numeric negative movement quantity stays numeric");
});

test("movement export follows every cursor page in server order", async () => {
  const first = movement("move-3", "2026-11-20T12:00:00.000Z");
  const second = movement("move-2", "2026-11-20T11:00:00.000Z");
  const third = movement("move-1", "2026-11-20T10:00:00.000Z");
  const calls = [];
  const pages = [
    { movements: [first, second], nextCursor: cursorFor(second) },
    { movements: [third], nextCursor: null },
  ];

  const result = await collectAllMovementPages({
    warehouseId: "warehouse-1",
    pageSize: 2,
    validateMovement: (item) => Boolean(item?.id && item?.occurredAt),
    validateCursor: (cursor) => cursor === null || Boolean(cursor?.id && cursor?.occurredAt),
    fetchPage: async (request) => {
      calls.push(request);
      return pages[calls.length - 1];
    },
  });

  assert.deepEqual(result, [first, second, third]);
  assert.deepEqual(calls, [
    { warehouseId: "warehouse-1", limit: 2, cursor: null },
    { warehouseId: "warehouse-1", limit: 2, cursor: cursorFor(second) },
  ]);
});

test("an empty movement history is a valid complete result", async () => {
  const result = await collectAllMovementPages({
    warehouseId: "warehouse-1",
    fetchPage: async () => ({ movements: [], nextCursor: null }),
    validateMovement: () => true,
    validateCursor: (cursor) => cursor === null,
  });

  assert.deepEqual(result, []);
  assert.equal(buildMovementCsv(result, { id: "warehouse-1", name: "North Warehouse" }).split("\r\n").length, 2);
});

test("a failed later page rejects the whole collection", async () => {
  let calls = 0;
  await assert.rejects(collectAllMovementPages({
    warehouseId: "warehouse-1",
    pageSize: 1,
    fetchPage: async () => {
      calls += 1;
      if (calls === 1) {
        const item = movement("move-1", "2026-11-20T10:00:00.000Z");
        return { movements: [item], nextCursor: cursorFor(item) };
      }
      throw new Error("Connection lost");
    },
    validateMovement: (item) => Boolean(item?.id && item?.occurredAt),
    validateCursor: (cursor) => cursor === null || Boolean(cursor?.id && cursor?.occurredAt),
  }), /Connection lost/u);
  assert.equal(calls, 2);
});

test("movement export rejects a repeated cursor instead of looping", async () => {
  const item = movement("move-1", "2026-11-20T10:00:00.000Z");
  await assert.rejects(collectAllMovementPages({
    warehouseId: "warehouse-1",
    fetchPage: async () => ({ movements: [item], nextCursor: cursorFor(item) }),
    validateMovement: () => true,
    validateCursor: (cursor) => cursor === null || Boolean(cursor?.id && cursor?.occurredAt),
  }), /did not advance/u);
});
