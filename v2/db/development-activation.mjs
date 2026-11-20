// Builds the reviewed SQL; has no database connection or execution path.
// Execute only against the explicitly approved development target.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const SOURCES = [
  ["0007-approved-setup-catalogs.sql", "163829a4906746dc18879aa41156cc04adacaccc17a33ca698554979860dab9d"],
  ["0008-production-rule-enforcement.sql", "d248bb1d6c9b4a781d001f0720376bce827b78c3f8f3f8a03a59eb86334cc5a2"],
  ["0009-staff-password-resets.sql", "750028e6833d5136aa15d47eae4c698bc9393b4c72aba763878c32bb3b10be7a"],
];
const RUNTIME_ACCESS_SHA256 = "3329fa41b3ba3567428154650132b2d61883478e60967a1f717a0f4270534fae";
const MANAGED_BASELINE = "8563f4c4b177a2c0a864491f9d5ed5db";
const TABLES = [
  "command_receipts", "facility_scope", "inventory_balances", "inventory_movements",
  "inventory_warehouses", "master_records", "opening_counts", "outbox_events",
  "products", "roles", "run_events", "run_inventory_consumptions", "run_pause_intervals",
  "run_station_progress", "runs", "setup_imports", "staff_accounts", "staff_bootstrap_marker",
  "staff_sessions", "user_roles", "worker_leases",
];

// The reviewed baseline's definitions, not just the number of objects.
export const BASELINE_SQL = `SELECT md5(jsonb_build_object(
  'functions', (SELECT jsonb_agg(pg_get_functiondef(p.oid) ORDER BY p.proname,
      pg_get_function_identity_arguments(p.oid)) FROM pg_proc p WHERE p.pronamespace = 'v2'::regnamespace),
  'constraints', (SELECT jsonb_agg(to_jsonb(ROW(c.relname, con.conname, pg_get_constraintdef(con.oid)))
      ORDER BY c.relname, con.conname) FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid
      WHERE c.relnamespace = 'v2'::regnamespace),
  'indexes', (SELECT jsonb_agg(indexdef ORDER BY tablename, indexname)
      FROM pg_indexes WHERE schemaname = 'v2'),
  'triggers', (SELECT jsonb_agg(pg_get_triggerdef(t.oid) ORDER BY c.relname, t.tgname)
      FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
      WHERE c.relnamespace = 'v2'::regnamespace AND NOT t.tgisinternal),
  'columns', (SELECT jsonb_agg(to_jsonb(ROW(c.relname, a.attname, format_type(a.atttypid, a.atttypmod),
      a.attnotnull, a.attidentity, a.attgenerated, pg_get_expr(d.adbin, d.adrelid)))
      ORDER BY c.relname, a.attnum) FROM pg_class c JOIN pg_attribute a ON a.attrelid = c.oid
      LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
      WHERE c.relnamespace = 'v2'::regnamespace AND c.relkind = 'r'
      AND a.attnum > 0 AND NOT a.attisdropped)
)::text)`;

function read(name) {
  return readFileSync(new URL(name, import.meta.url), "utf8");
}

function reviewedSource(name, sha256) {
  const sql = read(name);
  if (createHash("sha256").update(sql).digest("hex") !== sha256) {
    throw new Error(`Reviewed activation source changed: ${name}`);
  }
  return sql;
}

function migrationBody(name, sha256) {
  const sql = reviewedSource(name, sha256);
  if (!/^BEGIN;\n/m.test(sql) || !/\nCOMMIT;\s*$/.test(sql)) {
    throw new Error(`Reviewed activation source lacks the expected transaction: ${name}`);
  }
  return sql.replace(/^BEGIN;\n/m, "").replace(/\nCOMMIT;\s*$/, "\n");
}

function snapshotSql() {
  // Hash row contents inside the transaction; expose neither rows nor hashes.
  return `SELECT jsonb_build_object(${TABLES.map((name) =>
    `'${name}', (SELECT md5(COALESCE(string_agg(row_hash, '' ORDER BY row_hash), ''))
      FROM (SELECT md5(to_jsonb(t)::text) AS row_hash FROM v2.${name} t) hashed)`,
  ).join(",\n")})::text`;
}

export function buildDevelopmentActivation({ database, baseline }) {
  if (!["heliumdb", "v2_activation_test"].includes(database) || !/^[a-f0-9]{32}$/.test(baseline) ||
      (database === "heliumdb" && baseline !== MANAGED_BASELINE)) {
    throw new Error("Activation requires the reviewed development or disposable target and schema fingerprint.");
  }
  return `BEGIN;
SET LOCAL search_path = pg_catalog;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
SET LOCAL TIME ZONE 'UTC';
DO $guard$
BEGIN
  IF current_database() <> '${database}' OR
     EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'v2_runtime_access') OR
     (SELECT count(*) FROM pg_tables WHERE schemaname = 'v2') <> ${TABLES.length} THEN
    RAISE EXCEPTION 'Unexpected V2 activation target or pre-existing runtime role';
  END IF;
END
$guard$;
LOCK TABLE ${TABLES.map((name) => `v2.${name}`).join(", ")} IN SHARE ROW EXCLUSIVE MODE;
DO $baseline$
BEGIN
  IF (${BASELINE_SQL}) IS DISTINCT FROM '${baseline}' THEN
    RAISE EXCEPTION 'V2 activation baseline differs from the reviewed schema';
  END IF;
  PERFORM set_config('v2.activation_snapshot', (${snapshotSql()}), true);
END
$baseline$;
${SOURCES.map(([name, hash]) => migrationBody(name, hash)).join("\n")}
${reviewedSource("development-runtime-access.sql", RUNTIME_ACCESS_SHA256)}
DO $verify$
BEGIN
  IF (${snapshotSql()}) IS DISTINCT FROM current_setting('v2.activation_snapshot') THEN
    RAISE EXCEPTION 'V2 activation changed existing records';
  END IF;
  IF (SELECT count(*) FROM pg_tables WHERE schemaname = 'v2') <> 34 OR
     (SELECT count(*) FROM pg_proc WHERE pronamespace = 'v2'::regnamespace) <> 68 OR
     (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
      WHERE c.relnamespace = 'v2'::regnamespace AND NOT t.tgisinternal) <> 11 THEN
    RAISE EXCEPTION 'V2 activation did not produce the reviewed schema';
  END IF;
  IF has_schema_privilege('v2_runtime_access', 'v2', 'CREATE') OR
     EXISTS (SELECT 1 FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
         AND n.nspname NOT LIKE 'pg_toast%'
         AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
         AND has_table_privilege('v2_runtime_access', c.oid,
           'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) OR
     (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'v2'::regnamespace
       AND has_function_privilege('v2_runtime_access', p.oid, 'EXECUTE')) <> 49 OR
     NOT has_function_privilege('v2_runtime_access',
       'v2.request_staff_password_reset(text)', 'EXECUTE') OR
     NOT has_function_privilege('v2_runtime_access',
       'v2.list_staff_password_reset_requests(uuid)', 'EXECUTE') OR
     NOT has_function_privilege('v2_runtime_access',
       'v2.decide_staff_password_reset(uuid,uuid,text,text,timestamptz)', 'EXECUTE') OR
     NOT has_function_privilege('v2_runtime_access',
       'v2.reissue_staff_password_reset_code(uuid,uuid,text,timestamptz)', 'EXECUTE') OR
     NOT has_function_privilege('v2_runtime_access',
       'v2.complete_staff_password_reset(text,text,text)', 'EXECUTE') OR
     has_function_privilege('v2_runtime_access', 'v2.bootstrap_first_manager(text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'V2 activation did not produce the reviewed runtime permissions';
  END IF;
END
$verify$;
COMMIT;
`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === "--baseline-query" && process.argv.length === 3) {
    process.stdout.write(`${BASELINE_SQL};\n`);
  } else if (process.argv.length === 4) {
    process.stdout.write(buildDevelopmentActivation({ database: process.argv[2], baseline: process.argv[3] }));
  } else {
    throw new Error("Usage: node development-activation.mjs --baseline-query | <database> <baseline>");
  }
}
