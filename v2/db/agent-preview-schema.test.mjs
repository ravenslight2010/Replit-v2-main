import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { MIGRATIONS } from "./agent-preview-schema.mjs";

const databaseDirectory = fileURLToPath(new URL("./", import.meta.url));

test("agent preview schema lists every numbered production migration exactly once", async () => {
  const sourceMigrations = (await readdir(databaseDirectory))
    .filter((name) => /^\d{4}-.*\.sql$/.test(name) && !name.endsWith(".test.sql"))
    .sort();
  assert.deepEqual([...MIGRATIONS].sort(), sourceMigrations);
  assert.equal(new Set(MIGRATIONS).size, MIGRATIONS.length);
});
