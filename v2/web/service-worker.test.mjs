import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const serviceWorkerPath = fileURLToPath(new URL("./service-worker.js", import.meta.url));

test("offline shell caches manager operations and domain workflow modules", async () => {
  const source = await readFile(serviceWorkerPath, "utf8");
  for (const path of [
    "/v2/web/setup-catalog.js",
    "/v2/web/favicon.svg",
    "/v2/web/schedule.js",
    "/v2/web/mix-plan.js",
    "/v2/web/manager-operations.js",
    "/v2/web/inventory-export.mjs",
    "/v2/core/mix-plan.mjs",
    "/v2/web/qc.js",
    "/v2/web/update-manager.mjs",
    "/v2/core/setup-catalog-csv.mjs",
    "/v2/core/import-csv.mjs",
    "/v2/core/schedule-planning.mjs",
  ]) {
    assert.match(source, new RegExp(`["']${path.replaceAll(".", "\\.")}["']`, "u"), path);
  }
  assert.match(source, /fieldline-v2-shell-12/u);
  assert.match(source, /\/v2\/core\/die-defaults\.mjs/u);
});
