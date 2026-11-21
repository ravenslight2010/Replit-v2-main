import { hashPassword } from "./auth-adapter.mjs";
import { AGENT_PREVIEW_PASSWORD, AGENT_PREVIEW_USERNAME } from "./agent-preview-config.mjs";

export { AGENT_PREVIEW_PASSWORD, AGENT_PREVIEW_USERNAME };

const STAFF_ID = "4a000000-0000-4000-8000-000000000001";
const RUN_ID = "4a000000-0000-4000-8000-000000000002";

export async function seedAgentPreviewFixture(pool) {
  if (!pool || typeof pool.connect !== "function") {
    throw new TypeError("A PostgreSQL pool is required to seed the V2 agent preview.");
  }
  const passwordHash = await hashPassword(AGENT_PREVIEW_PASSWORD);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: [scope] } = await client.query(
      "SELECT facility_id FROM v2.facility_scope WHERE singleton = true",
    );
    if (!scope?.facility_id) throw new Error("The V2 agent preview facility scope is missing.");

    await client.query(
      `INSERT INTO v2.staff_accounts (id, username, password_hash)
       VALUES ($1::uuid, $2::text, $3::text)`,
      [STAFF_ID, AGENT_PREVIEW_USERNAME, passwordHash],
    );
    await client.query(
      "INSERT INTO v2.user_roles (user_id, role_name) VALUES ($1::uuid, 'manager')",
      [STAFF_ID],
    );
    await client.query(
      "INSERT INTO v2.staff_bootstrap_marker (singleton) VALUES (true) ON CONFLICT DO NOTHING",
    );

    await client.query(
      `INSERT INTO v2.products (facility_id, id, code, name, base_unit)
       VALUES
         ($1::uuid, '4a000000-0000-4000-8000-000000000003', 'AGENT-PREVIEW-PIZZA', 'Synthetic Preview Pizza', 'case'),
         ($1::uuid, '4a000000-0000-4000-8000-000000000004', 'AGENT-PREVIEW-CHEESE', 'Synthetic Preview Cheese', 'lb'),
         ($1::uuid, '4a000000-0000-4000-8000-000000000005', 'AGENT-PREVIEW-CARTON', 'Synthetic Preview Carton', 'each')`,
      [scope.facility_id],
    );
    await client.query(
      `INSERT INTO v2.master_records (facility_id, kind, code, name, product_code, data)
       VALUES
         ($1::uuid, 'recipes', 'AGENT-PREVIEW-CHEESE-RECIPE', 'Synthetic Cheese Recipe',
          'AGENT-PREVIEW-PIZZA',
          '{"station_key":"cheese","ingredients":[{"product_code":"AGENT-PREVIEW-CHEESE","quantity":1,"unit":"lb"}]}'::jsonb),
         ($1::uuid, 'production-setups', 'AGENT-PREVIEW-LINE', 'Synthetic Preview Line',
          'AGENT-PREVIEW-PIZZA',
          '{"recipe_codes":["AGENT-PREVIEW-CHEESE-RECIPE"],"packaging_per_case":[{"product_code":"AGENT-PREVIEW-CARTON","quantity":1,"unit":"each"}]}'::jsonb)`,
      [scope.facility_id],
    );
    await client.query(
      `INSERT INTO v2.runs (facility_id, id, status, created_at, updated_at, setup_snapshot)
       VALUES (
         $1::uuid, $2::uuid, 'planned', now(), now(),
         '{"label":"Synthetic Preview Run","targetCases":24,"productCode":"AGENT-PREVIEW-PIZZA","productionSetupCode":"AGENT-PREVIEW-LINE"}'::jsonb
       )`,
      [scope.facility_id, RUN_ID],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
