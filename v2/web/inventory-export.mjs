const STOCK_COLUMNS = [
  ["warehouse_id", "warehouseId", true],
  ["warehouse_name", "warehouseName", true],
  ["product_code", "code", true],
  ["product_name", "name", true],
  ["unit", "unit", true],
  ["on_hand", "quantity", false],
  ["staged", "stagedQuantity", false],
  ["available", "availableQuantity", false],
  ["lot_quantity", "lotQuantity", false],
];

const MOVEMENT_COLUMNS = [
  ["warehouse_id", "warehouseId", true],
  ["warehouse_name", "warehouseName", true],
  ["occurred_at", "occurredAt", true],
  ["movement_id", "id", true],
  ["movement_group_id", "movementGroupId", true],
  ["product_code", "productCode", true],
  ["product_name", "productName", true],
  ["unit", "unit", true],
  ["type", "type", true],
  ["quantity_delta", "quantityDelta", false],
  ["reason", "reason", true],
  ["lot_number", "lotNumber", true],
  ["source_reference", "sourceReference", true],
  ["actor_id", "actorId", true],
  ["planned_product_id", "plannedProductId", true],
  ["lot_allocations", "lotAllocations", true],
];

function csvCell(value, isText = true) {
  let field = value == null ? "" : String(value);
  if (isText && /^[\s\u0000-\u001f]*[=+\-@]/u.test(field)) field = `'${field}`;
  return `"${field.replaceAll('"', '""')}"`;
}

function csvDocument(columns, records) {
  const header = columns.map(([label]) => csvCell(label)).join(",");
  const rows = records.map((record) => columns.map(([, key, isText]) => {
    const value = key === "lotAllocations" ? JSON.stringify(record[key] ?? []) : record[key];
    return csvCell(value, isText);
  }).join(","));
  return `\uFEFF${[header, ...rows].join("\r\n")}\r\n`;
}

function withWarehouse(records, warehouse) {
  return records.map((record) => ({
    ...record,
    warehouseId: warehouse.id,
    warehouseName: warehouse.name,
  }));
}

export function buildStockCsv(stock, warehouse) {
  return csvDocument(STOCK_COLUMNS, withWarehouse(stock, warehouse));
}

export function buildMovementCsv(movements, warehouse) {
  return csvDocument(MOVEMENT_COLUMNS, withWarehouse(movements, warehouse));
}

export async function collectAllMovementPages({
  warehouseId,
  fetchPage,
  validateMovement,
  validateCursor,
  pageSize = 100,
}) {
  if (typeof warehouseId !== "string" || !warehouseId
    || typeof fetchPage !== "function"
    || typeof validateMovement !== "function"
    || typeof validateCursor !== "function"
    || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new TypeError("A warehouse, page loader, validators, and page size from 1 to 100 are required.");
  }

  const allMovements = [];
  const seenCursors = new Set();
  let cursor = null;

  while (true) {
    const page = await fetchPage({ warehouseId, limit: pageSize, cursor });
    if (!page || !Array.isArray(page.movements) || page.movements.length > pageSize
      || !page.movements.every(validateMovement) || !validateCursor(page.nextCursor)) {
      throw new Error("The server returned an invalid movement page.");
    }

    const nextCursor = page.nextCursor;
    if (nextCursor !== null) {
      const last = page.movements.at(-1);
      if (!last || last.id !== nextCursor.id || last.occurredAt !== nextCursor.occurredAt) {
        throw new Error("The server returned an invalid movement cursor. No complete export was created.");
      }
      const cursorKey = `${nextCursor.occurredAt}\u0000${nextCursor.id}`;
      if (seenCursors.has(cursorKey)) {
        throw new Error("Movement history paging did not advance. No complete export was created.");
      }
      seenCursors.add(cursorKey);
    }

    allMovements.push(...page.movements);
    if (nextCursor === null) return allMovements;
    cursor = nextCursor;
  }
}
