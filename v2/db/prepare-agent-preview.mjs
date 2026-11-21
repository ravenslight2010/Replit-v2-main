import pg from "pg";
import { assertAgentPreviewTarget } from "../server/agent-preview-config.mjs";
import { seedAgentPreviewFixture } from "../server/agent-preview-fixture.mjs";
import { applyAgentPreviewSchema } from "./agent-preview-schema.mjs";

const { Pool } = pg;
const connectionString = process.env.V2_DATABASE_URL;
if (!assertAgentPreviewTarget(process.env, connectionString)) {
  throw new Error("V2 agent preview initialization requires an isolated preview target.");
}

const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 3000 });
try {
  const { rows: [identity] } = await pool.query(
    "SELECT current_database() AS database_name, host(inet_server_addr()) AS server_address",
  );
  if (identity?.database_name !== "v2_agent_preview"
    || !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(identity?.server_address)) {
    throw new Error("V2 agent preview database identity did not match its loopback target.");
  }
  await applyAgentPreviewSchema(pool);
  await seedAgentPreviewFixture(pool);
  console.log("V2 agent preview schema and synthetic fixture are ready.");
} finally {
  await pool.end();
}
