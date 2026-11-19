// Run manually: node v2/db/development-activation.rehearsal.mjs
// Starts its own trust-authenticated Unix socket in a private temporary directory.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import pg from "pg";
import { BASELINE_SQL, buildDevelopmentActivation } from "./development-activation.mjs";
import { hashPassword } from "../server/auth-adapter.mjs";
import { startV2Server } from "../server/main.mjs";

const tmp = mkdtempSync(join(tmpdir(), "v2-activation-"));
const data = join(tmp, "data");
const database = "v2_activation_test";
const user = process.getuid === undefined ? "" : execFileSync("id", ["-un"], { encoding: "utf8" }).trim();
const port = 5432; // TCP disabled; each cluster gets a private socket directory.
const options = { host: tmp, port, database, user };
const schemaFiles = ["0001-run-control", "0002-staff-auth", "0003-production-stations",
  "0004-import-inventory", "0005-dough-capacity-sources", "0006-run-inventory-linkage",
  "0007-staff-role-equivalents"];
const root = fileURLToPath(new URL("./", import.meta.url));
const psql = (args) => execFileSync("psql", ["-Xq", "-v", "ON_ERROR_STOP=1", "-h", tmp,
  "-p", String(port), "-U", user, "-d", database, ...args], { encoding: "utf8" });
const runId = "44444444-4444-4444-8444-444444444444";
const staffId = "11111111-1111-4111-8111-111111111111";
const productId = "22222222-2222-4222-8222-222222222222";
const warehouseId = "33333333-3333-4333-8333-333333333333";
const username = "SyntheticRetained";
const password = "synthetic-activation-rehearsal-password";
const sessionToken = "a".repeat(43);
const csrfToken = "b".repeat(43);
const hash = (value) => createHash("sha256").update(value).digest("hex");

let admin;
let restricted;
let app;
let started = false;
try {
  execFileSync("initdb", ["-D", data, "-U", user, "--no-locale", "--encoding=UTF8",
    "--auth-local=trust", "--auth-host=reject"]);
  execFileSync("pg_ctl", ["-D", data, "-o", `-F -p ${port} -c listen_addresses='' -k '${tmp}'`,
    "-l", join(tmp, "postgres.log"), "-w", "start"]);
  started = true;
  execFileSync("createdb", ["-h", tmp, "-U", user, "-p", String(port), database]);
  for (const name of schemaFiles) psql(["-f", join(root, `${name}.sql`)]);

  admin = new pg.Client(options);
  await admin.connect();
  await admin.query("SET search_path = pg_catalog");
  const baseline = (await admin.query(BASELINE_SQL)).rows[0].md5;
  await admin.query("INSERT INTO v2.staff_accounts(id,username,password_hash) VALUES ($1,$2,$3)",
    [staffId, username, await hashPassword(password)]);
  await admin.query("INSERT INTO v2.user_roles(user_id,role_name) VALUES ($1,'manager')", [staffId]);
  await admin.query("SELECT v2.open_staff_session($1,$2,$3,clock_timestamp()+interval '1 day')",
    [staffId, hash(sessionToken), hash(csrfToken)]);
  await admin.query(`INSERT INTO v2.products(facility_id,id,code,name,base_unit)
    SELECT facility_id,$1,'RETAIN','Retained product','lb' FROM v2.facility_scope`, [productId]);
  await admin.query(`INSERT INTO v2.inventory_warehouses(facility_id,id,name,created_by)
    SELECT facility_id,$1,'Retained warehouse',$2 FROM v2.facility_scope`, [warehouseId, staffId]);
  await admin.query(`INSERT INTO v2.inventory_balances(facility_id,warehouse_id,product_id,quantity,revision)
    SELECT facility_id,$1,$2,12.345678,7 FROM v2.facility_scope`, [warehouseId, productId]);
  await admin.query(`INSERT INTO v2.runs(facility_id,id,status,created_at,updated_at,setup_snapshot)
    SELECT facility_id,$1,'planned',now(),now(),'{"label":"Retained run","targetCases":1,"productCode":"RETAIN"}'
    FROM v2.facility_scope`, [runId]);

  const sql = buildDevelopmentActivation({ database, baseline });
  for (const badSql of [
    buildDevelopmentActivation({ database, baseline: "0".repeat(32) }),
    sql.replace("\nCOMMIT;", "\nSELECT 1/0;\nCOMMIT;"),
  ]) {
    await assert.rejects(admin.query(badSql));
    await admin.query("ROLLBACK");
    assert.equal((await admin.query(BASELINE_SQL)).rows[0].md5, baseline);
    assert.equal((await admin.query("SELECT count(*)::int AS n FROM pg_roles WHERE rolname='v2_runtime_access'")).rows[0].n, 0);
  }
  await admin.query(sql); // Includes all-table preservation and permission assertions.
  await assert.rejects(admin.query(sql), /Unexpected V2 activation target/);
  await admin.query("ROLLBACK");
  psql(["-f", join(root, "0007-approved-setup-catalogs.test.sql")]);
  psql(["-f", join(root, "0008-production-rule-enforcement.test.sql")]);
  await admin.query("CREATE ROLE v2_activation_login LOGIN; GRANT v2_runtime_access TO v2_activation_login;");
  restricted = new pg.Client({ ...options, user: "v2_activation_login" });
  await restricted.connect();
  for (const query of [
    "SELECT 1 FROM v2.staff_accounts", "SELECT 1 FROM v2.inventory_balances",
    "CREATE TABLE v2.activation_forbidden(id int)", "CREATE ROLE v2_activation_forbidden",
    "SELECT v2.bootstrap_first_manager(NULL,NULL)", "SELECT v2.run_snapshot_without_rules(NULL,NULL)",
  ]) await assert.rejects(restricted.query(query), { code: "42501" });
  const lease = await restricted.query("SELECT v2.claim_worker_lease('activation-test', $1, 30) AS generation", [staffId]);
  assert.equal(lease.rows[0].generation, "1");
  assert.equal((await restricted.query("SELECT v2.release_worker_lease('activation-test', $1, 1) AS released",
    [staffId])).rows[0].released, true);

  const url = `postgresql://v2_activation_login@localhost:${port}/${database}?host=${encodeURIComponent(tmp)}`;
  app = await startV2Server({
    env: { NODE_ENV: "development", PORT: "0", V2_DATABASE_URL: url },
    logger: () => {},
  });
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  const cookie = `v2_session=${sessionToken}; v2_csrf=${csrfToken}`;
  const request = async (path, expected, body) => {
    const response = await fetch(`${origin}/api/v2${path}`, {
      headers: { Cookie: cookie, Origin: origin, "X-CSRF-Token": csrfToken, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }),
    });
    const value = await response.json();
    assert.equal(response.status, expected, `${path}: ${JSON.stringify(value)}`);
    return value;
  };
  await request("/auth/session", 200); // The pre-migration session still authenticates.
  const run = (await request(`/runs/${runId}`, 200)).run;
  assert.equal(run.id, runId);
  assert.deepEqual(run.productionRules, []);
  const stock = await request(`/inventory/stock?warehouseId=${warehouseId}`, 200);
  assert.match(JSON.stringify(stock), /12\.345678/);
  const staged = await request("/setup-catalog/imports", 201, {
    requestId: "55555555-5555-4555-8555-555555555555",
    family: "ingredients",
    csv: 'code,name,categories_json,allergens_json,allergens_reviewed,merged_into_code,enabled\n'
      + 'ACT-ING,Activation ingredient,"[""dough""]",[],true,,true\n',
  });
  await request(`/setup-catalog/imports/${staged.importId}/apply`, 200, {});
  await request("/setup-catalog/imports", 200);
  console.log("Activation rehearsal passed: atomic rollback, retained rows/session, restricted API and worker, catalog/run/inventory.");
} finally {
  await app?.close();
  await restricted?.end();
  await admin?.end();
  if (started) execFileSync("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"]);
  rmSync(tmp, { recursive: true, force: true });
}
