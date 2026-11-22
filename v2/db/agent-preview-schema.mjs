import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const MIGRATIONS = Object.freeze([
  "0001-run-control.sql",
  "0002-staff-auth.sql",
  "0003-production-stations.sql",
  "0004-import-inventory.sql",
  "0005-dough-capacity-sources.sql",
  "0006-run-inventory-linkage.sql",
  "0007-approved-setup-catalogs.sql",
  "0007-staff-role-equivalents.sql",
  "0008-inventory-parity.sql",
  "0008-production-rule-enforcement.sql",
  "0008-qc-workflows.sql",
  "0008-reviewed-die-defaults.sql",
  "0009-production-schedules.sql",
  "0009-qc-ingredient-links.sql",
  "0009-staff-password-resets.sql",
  "0010-operational-mix-plan.sql",
  "0010-qc-substitutions.sql",
  "0010-workbook-link-corrections.sql",
  "0011-manager-operations.sql",
  "0011-qc-checkpoint-review.sql",
  "0011-run-operational-substitution-status.sql",
  "0012-staff-account-history.sql",
]);

const DB_DIR = fileURLToPath(new URL("./", import.meta.url));

export async function applyAgentPreviewSchema(pool) {
  for (const migration of MIGRATIONS) {
    const sql = await readFile(`${DB_DIR}${migration}`, "utf8");
    await pool.query(sql);
  }
}
