-- V2 production custom-object repair, generated from the checked-in SQL migrations.
-- Run ONLY after Replit Publish has created all V2 tables, columns, indexes, and constraints.
-- Target: Replit managed production SQL console as neondb_owner; never run in development.
-- Repeat-safe: CREATE OR REPLACE functions, DROP/CREATE triggers, repeat-safe permission statements,
-- and ON CONFLICT role seeds. Does not create tables, alter columns, migrate accounts, or perform
-- an opening-inventory backfill. It installs normal inventory functions for future app operations.
-- This script is one transaction: any error rolls back the entire script.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='120s';
SET LOCAL search_path=pg_catalog;
DO $v2_preflight$
DECLARE missing text[];
BEGIN
 IF current_database()<>'neondb' OR current_user<>'neondb_owner' THEN
   RAISE EXCEPTION 'Run this script only in the Replit production SQL console as neondb_owner';
 END IF;
 SELECT array_agg(expected.name ORDER BY expected.name) INTO missing
 FROM unnest(ARRAY['command_receipts','die_default_events','die_default_settings','facility_scope','inventory_balances','inventory_cycle_counts','inventory_lots','inventory_movement_lot_allocations','inventory_movements','inventory_preparations','inventory_warehouses','manager_action_events','master_records','opening_counts','outbox_events','production_schedule_receipts','production_schedules','products','qc_events','qc_ingredient_link_events','qc_run_substitutions','roles','run_events','run_inventory_consumptions','run_inventory_stage_receipts','run_inventory_staged_supplies','run_pause_intervals','run_station_progress','runs','setup_alias_records','setup_catalog_imports','setup_die_default_records','setup_die_type_records','setup_freezer_pull_records','setup_imports','setup_ingredient_inventory_links','setup_ingredient_records','setup_manager_list_records','setup_mix_component_links','setup_mix_inventory_links','setup_mix_records','setup_production_rule_records','setup_run_template_records','staff_account_change_events','staff_accounts','staff_bootstrap_marker','staff_password_reset_events','staff_password_reset_requests','staff_sessions','user_roles','worker_leases']::text[]) AS expected(name)
 WHERE to_regclass(format('%I.%I','v2',expected.name)) IS NULL;
 IF missing IS NOT NULL THEN
   RAISE EXCEPTION 'Publish the V2 table schema first; missing V2 tables: %',missing;
 END IF;
END
$v2_preflight$;

-- 0007-approved-setup-catalogs.sql: function
CREATE OR REPLACE FUNCTION v2.setup_catalog_table_name(p_family text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT CASE p_family
    WHEN 'ingredients' THEN 'setup_ingredient_records'
    WHEN 'mixes' THEN 'setup_mix_records'
    WHEN 'die-types' THEN 'setup_die_type_records'
    WHEN 'die-line-defaults' THEN 'setup_die_default_records'
    WHEN 'production-rules' THEN 'setup_production_rule_records'
    WHEN 'freezer-pull-items' THEN 'setup_freezer_pull_records'
    WHEN 'run-templates' THEN 'setup_run_template_records'
    WHEN 'manager-lists' THEN 'setup_manager_list_records'
    WHEN 'aliases' THEN 'setup_alias_records'
    ELSE NULL
  END
$$;

-- 0007-approved-setup-catalogs.sql: function
CREATE OR REPLACE FUNCTION v2.setup_catalog_object_size(p_value jsonb)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN jsonb_typeof(p_value) = 'object'
    THEN (SELECT count(*)::integer FROM jsonb_object_keys(p_value))
    ELSE -1
  END
$$;

-- 0007-approved-setup-catalogs.sql: function
CREATE OR REPLACE FUNCTION v2.stage_setup_catalog_import(
  p_facility_id uuid, p_actor_id uuid, p_request_id text, p_request_hash text,
  p_family text, p_records jsonb, p_source_summary jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_existing v2.setup_catalog_imports%ROWTYPE;
  v_id uuid;
  v_row jsonb;
  v_stage_result jsonb;
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM v2.facility_scope WHERE singleton AND facility_id = p_facility_id)
     OR p_request_id IS NULL OR length(btrim(p_request_id)) NOT BETWEEN 1 AND 200
     OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$'
     OR v2.setup_catalog_table_name(p_family) IS NULL
     OR jsonb_typeof(p_records) <> 'array'
     OR jsonb_array_length(p_records) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'Invalid setup catalog import' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_facility_id::text || ':' || p_actor_id::text || ':' || p_request_id, 0
  ));
  SELECT * INTO v_existing FROM v2.setup_catalog_imports
  WHERE facility_id = p_facility_id AND actor_id = p_actor_id AND request_id = p_request_id
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.request_hash <> p_request_hash OR v_existing.family <> p_family THEN
      RAISE EXCEPTION 'Import request ID was reused with different details' USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object(
      'outcome', v_existing.status, 'importId', v_existing.id, 'family', v_existing.family,
      'rowCount', jsonb_array_length(v_existing.records), 'replayed', true, 'result', v_existing.result,
      'sourceSummary', v_existing.result->'sourceSummary'
    );
  END IF;
  IF p_source_summary IS NOT NULL AND (
    v2.setup_catalog_object_size(p_source_summary) <> 7
    OR NOT (p_source_summary ?& ARRAY[
      'sourceFamily','sourceSha256','parserVersion','sourceRows',
      'importedRows','skippedRows','unresolvedRows'
    ])
    OR p_source_summary->>'sourceFamily' NOT IN (
      'spec-sheets','premix-sheets','cheese-mix-specs',
      'shipping-guides','sauce-guides','dough-guides'
    )
    OR p_source_summary->>'sourceSha256' !~ '^[0-9a-f]{64}$'
    OR p_source_summary->>'parserVersion' <> 'v1-source-import/1'
    OR jsonb_typeof(p_source_summary->'sourceRows') <> 'number'
    OR jsonb_typeof(p_source_summary->'importedRows') <> 'number'
    OR jsonb_typeof(p_source_summary->'skippedRows') <> 'number'
    OR jsonb_typeof(p_source_summary->'unresolvedRows') <> 'number'
    OR (p_source_summary->>'sourceRows')::numeric NOT BETWEEN 0 AND 2000
    OR (p_source_summary->>'importedRows')::numeric <> jsonb_array_length(p_records)
    OR (p_source_summary->>'skippedRows')::numeric NOT BETWEEN 0 AND 2000
    OR (p_source_summary->>'unresolvedRows')::numeric NOT BETWEEN 0 AND 2000
    OR ((p_source_summary->>'sourceRows')::numeric % 1) <> 0
    OR ((p_source_summary->>'importedRows')::numeric % 1) <> 0
    OR ((p_source_summary->>'skippedRows')::numeric % 1) <> 0
    OR ((p_source_summary->>'unresolvedRows')::numeric % 1) <> 0
    OR ((p_source_summary->>'sourceFamily' = 'premix-sheets') <> (p_family = 'mixes'))
    OR (p_source_summary->>'sourceFamily' <> 'premix-sheets' AND p_family <> 'run-templates')
  ) THEN
    RAISE EXCEPTION 'Invalid source import summary' USING ERRCODE = '22023';
  END IF;
  FOR v_row IN SELECT value FROM jsonb_array_elements(p_records) LOOP
    IF jsonb_typeof(v_row) <> 'object' OR v2.setup_catalog_object_size(v_row) <> 3
       OR NOT (v_row ?& ARRAY['code', 'name', 'data'])
       OR jsonb_typeof(v_row->'code') <> 'string'
       OR jsonb_typeof(v_row->'name') <> 'string'
       OR jsonb_typeof(v_row->'data') <> 'object'
       OR length(btrim(v_row->>'code')) NOT BETWEEN 1 AND 80
       OR length(btrim(v_row->>'name')) NOT BETWEEN 1 AND 200 THEN
      RAISE EXCEPTION 'Setup catalog row has an invalid shape' USING ERRCODE = '22023';
    END IF;
    IF
      (p_family = 'ingredients' AND (
        v2.setup_catalog_object_size(v_row->'data') <> 5
        OR NOT ((v_row->'data') ?& ARRAY['categories','allergens','allergensReviewed','mergedIntoCode','enabled'])
        OR jsonb_typeof(v_row->'data'->'categories') <> 'array'
        OR jsonb_typeof(v_row->'data'->'allergens') <> 'array'
        OR jsonb_typeof(v_row->'data'->'allergensReviewed') <> 'boolean'
        OR jsonb_typeof(v_row->'data'->'enabled') <> 'boolean'
      ))
      OR (p_family = 'mixes' AND (
        v2.setup_catalog_object_size(v_row->'data') <> 8
        OR NOT ((v_row->'data') ?& ARRAY['brand','flavor','batchSizeLbs','daysEarly','notes','isPrep','enabled','components'])
        OR jsonb_typeof(v_row->'data'->'components') <> 'array'
        OR jsonb_typeof(v_row->'data'->'isPrep') <> 'boolean'
        OR jsonb_typeof(v_row->'data'->'enabled') <> 'boolean'
      ))
      OR (p_family = 'die-types' AND v2.setup_catalog_object_size(v_row->'data') <> 0)
      OR (p_family = 'die-line-defaults' AND (
        v2.setup_catalog_object_size(v_row->'data') <> 9
        OR NOT ((v_row->'data') ?& ARRAY[
          'crusts_per_cycle','cycle_speed','speed_adjustment','freezer_time','cases_per_layer',
          'pre_tunnel_min','post_tunnel_min','press_oven_min','frontline_min'
        ])
      ))
      OR (p_family = 'production-rules' AND (
        v2.setup_catalog_object_size(v_row->'data') <> 11
        OR NOT ((v_row->'data') ?& ARRAY[
          'type','enforcement','enabled','field','min','max','attribute','before','after','bypass','checklist'
        ])
        OR v_row->'data'->>'type' NOT IN ('required-field','numeric-range','sequence')
        OR v_row->'data'->>'enforcement' NOT IN ('flexible','strict')
        OR jsonb_typeof(v_row->'data'->'enabled') <> 'boolean'
        OR jsonb_typeof(v_row->'data'->'bypass') <> 'array'
        OR jsonb_typeof(v_row->'data'->'checklist') <> 'array'
      ))
      OR (p_family = 'freezer-pull-items' AND (
        v2.setup_catalog_object_size(v_row->'data') <> 4
        OR NOT ((v_row->'data') ?& ARRAY['ingredientName','ingredientCode','daysEarly','enabled'])
        OR jsonb_typeof(v_row->'data'->'ingredientName') <> 'string'
        OR jsonb_typeof(v_row->'data'->'daysEarly') <> 'number'
        OR jsonb_typeof(v_row->'data'->'enabled') <> 'boolean'
      ))
      OR (p_family = 'run-templates' AND (
        v2.setup_catalog_object_size(v_row->'data') <> 3
        OR NOT ((v_row->'data') ?& ARRAY['brand','flavor','values'])
        OR jsonb_typeof(v_row->'data'->'values') <> 'object'
        OR EXISTS (
          SELECT 1 FROM jsonb_object_keys(v_row->'data'->'values') AS field(key)
          WHERE field.key <> ALL (ARRAY[
            'crustsPerCycle','cycleSpeed','speedAdjustment','approxLineSpeed','freezerTime','pizzasPerCase',
            'casesPerSkid','casesPerLayer','doughballsPerTray','crustsPerStack','doughBatchYield','crustsPerCase',
            'mixerLowSec','mixerHighSec','hopperSec','sauceOzPerPizza','sauceBarrelLbs',
            'app1OzPerPizza','app1BatchLbs','app2OzPerPizza','app2BatchLbs','app3OzPerPizza','app3BatchLbs',
            'app4OzPerPizza','app4BatchLbs','pep1Sticks','pep1OzPerPizza','pep1BatchLbs','pep2Sticks',
            'pep2OzPerPizza','pep2BatchLbs','pep1SticksB','pep1OzPerPizzaB','pep1BatchLbsB',
            'pep2SticksB','pep2OzPerPizzaB','pep2BatchLbsB','pep1Combined','app1Type','app2Type','app3Type',
            'app4Type','pep1Type','pep2Type','pep1TypeB','pep2TypeB','dieType','allergen','doughRecipeName',
            'targetDoughballWeight','doughRecipe','app1CheeseRecipeName','app1CheeseRecipe',
            'app2CheeseRecipeName','app2CheeseRecipe','app3CheeseRecipeName','app3CheeseRecipe',
            'app4CheeseRecipeName','app4CheeseRecipe','frontlineRecipeName','frontlineRecipe','cartoned',
            'labelPosition','cartonsPerCase','cartonSize','labelsPerRoll','topLabelsPerRoll',
            'bottomLabelsPerRoll','circles','shipper','skidStacking','gripSheets','slipSheets',
            'preTunnelMin','pressOvenMin','frontlineMin','postTunnelMin'
          ])
        )
      ))
      OR (p_family = 'manager-lists' AND (
        v2.setup_catalog_object_size(v_row->'data') <> 2
        OR NOT ((v_row->'data') ?& ARRAY['key','value'])
        OR v_row->'data'->>'key' <> v_row->>'code'
        OR v_row->>'code' <> ALL (ARRAY[
          'run-calc-brands','run-calc-brand-flavors','run-calc-flavors','run-calc-ingredient-types','run-calc-pep-types',
          'run-calc-die-types','run-calc-cheese-ingredients','run-calc-dough-ingredients',
          'run-calc-frontline-ingredients','run-calc-mix-ingredients','run-calc-dough-recipe-names',
          'run-calc-dough-recipe-presets','run-calc-frontline-recipe-names','run-calc-frontline-recipe-presets',
          'run-calc-cheese-recipe-names','run-calc-cheese-recipe-presets','run-calc-mix-recipe-names',
          'run-calc-stop-reasons','run-calc-circles','run-calc-shippers','run-calc-skid-stacking',
          'run-calc-grip-sheets','run-calc-shift-start-time','run-calc-production-start-time'
        ])
      ))
      OR (p_family = 'aliases' AND (
        v2.setup_catalog_object_size(v_row->'data') <> 6
        OR NOT ((v_row->'data') ?& ARRAY['aliasType','kind','externalName','canonicalName','context','brand'])
        OR v_row->'data'->>'aliasType' NOT IN ('spec','merge')
        OR jsonb_typeof(v_row->'data'->'externalName') <> 'string'
        OR jsonb_typeof(v_row->'data'->'canonicalName') <> 'string'
      ))
    THEN
      RAISE EXCEPTION 'Setup catalog data is outside the approved family field map' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  IF (SELECT count(DISTINCT lower(value->>'code')) FROM jsonb_array_elements(p_records))
     <> jsonb_array_length(p_records) THEN
    RAISE EXCEPTION 'Import contains duplicate codes' USING ERRCODE = '22023';
  END IF;
  v_stage_result := CASE WHEN p_source_summary IS NULL THEN NULL
    ELSE jsonb_build_object('sourceSummary', p_source_summary) END;
  INSERT INTO v2.setup_catalog_imports(
    facility_id, actor_id, request_id, request_hash, family, records, result
  )
  VALUES (p_facility_id, p_actor_id, p_request_id, p_request_hash, p_family, p_records, v_stage_result)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object(
    'outcome', 'staged', 'importId', v_id, 'family', p_family,
    'rowCount', jsonb_array_length(p_records), 'replayed', false,
    'sourceSummary', p_source_summary
  );
END
$$;

-- 0007-approved-setup-catalogs.sql: function
CREATE OR REPLACE FUNCTION v2.apply_setup_catalog_import(p_facility_id uuid, p_actor_id uuid, p_import_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_import v2.setup_catalog_imports%ROWTYPE;
  v_table text;
  v_row jsonb;
  v_old jsonb;
  v_new jsonb;
  v_before jsonb := '[]'::jsonb;
  v_after jsonb := '[]'::jsonb;
  v_now timestamptz;
  v_result jsonb;
  v_component jsonb;
  v_component_index integer;
  v_ingredient_code text;
  v_created_count integer := 0;
  v_updated_count integer := 0;
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL OR p_import_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM v2.facility_scope WHERE singleton AND facility_id = p_facility_id) THEN
    RAISE EXCEPTION 'Invalid setup catalog scope' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_import FROM v2.setup_catalog_imports
  WHERE facility_id = p_facility_id AND id = p_import_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Import not found' USING ERRCODE = 'P0002'; END IF;
  IF v_import.status = 'applied' THEN
    RETURN COALESCE(v_import.result, '{}'::jsonb) || jsonb_build_object('replayed', true);
  END IF;
  IF v_import.status <> 'staged' THEN
    RAISE EXCEPTION 'Import cannot be applied in its current state' USING ERRCODE = '55000';
  END IF;
  v_table := v2.setup_catalog_table_name(v_import.family);
  v_now := clock_timestamp();
  FOR v_row IN SELECT value FROM jsonb_array_elements(v_import.records) LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(
      p_facility_id::text || ':' || v_import.family || ':' || lower(v_row->>'code'), 0
    ));
    EXECUTE format(
      'SELECT to_jsonb(t) FROM v2.%I AS t WHERE t.facility_id = $1 AND lower(t.code) = lower($2) FOR UPDATE',
      v_table
    ) INTO v_old USING p_facility_id, v_row->>'code';
    IF v_import.family = 'die-line-defaults' AND NOT EXISTS (
      SELECT 1 FROM v2.setup_die_type_records
      WHERE facility_id = p_facility_id AND lower(code) = lower(v_row->>'code')
    ) THEN
      RAISE EXCEPTION 'Import references an unknown die type; import die types first' USING ERRCODE = '23503';
    END IF;
    IF v_import.family = 'mixes' THEN
      DELETE FROM v2.setup_mix_component_links
      WHERE facility_id = p_facility_id AND lower(mix_code) = lower(v_row->>'code');
    END IF;
    IF v_old IS NULL THEN
      v_created_count := v_created_count + 1;
      EXECUTE format(
        'INSERT INTO v2.%I (facility_id, code, name, data, source_import_id, updated_at) ' ||
        'VALUES ($1, $2, $3, $4, $5, $6)',
        v_table
      ) USING p_facility_id, v_row->>'code', v_row->>'name', v_row->'data', p_import_id, v_now;
    ELSE
      v_updated_count := v_updated_count + 1;
      EXECUTE format(
        'UPDATE v2.%I SET name = $1, data = $2, source_import_id = $3, updated_at = $4 ' ||
        'WHERE facility_id = $5 AND lower(code) = lower($6)',
        v_table
      ) USING v_row->>'name', v_row->'data', p_import_id, v_now,
        p_facility_id, v_row->>'code';
    END IF;
    IF v_import.family = 'mixes' THEN
      v_component_index := 0;
      FOR v_component IN SELECT value FROM jsonb_array_elements(v_row->'data'->'components') LOOP
        IF jsonb_typeof(v_component) <> 'object' THEN
          RAISE EXCEPTION 'Mix component has an invalid field map' USING ERRCODE = '22023';
        END IF;
        IF EXISTS (
          SELECT 1 FROM jsonb_object_keys(v_component) AS item(key)
          WHERE item.key <> ALL (ARRAY['ingredientName','ingredientCode','perPizzaOz','perBatchLbs'])
        ) OR jsonb_typeof(v_component->'ingredientName') <> 'string'
          OR length(btrim(v_component->>'ingredientName')) = 0
          OR (v_component->>'perPizzaOz' IS NULL AND v_component->>'perBatchLbs' IS NULL)
          OR (v_component->>'perPizzaOz' IS NOT NULL AND (
            jsonb_typeof(v_component->'perPizzaOz') <> 'number'
            OR (v_component->>'perPizzaOz')::numeric < 0
          ))
          OR (v_component->>'perBatchLbs' IS NOT NULL AND (
            jsonb_typeof(v_component->'perBatchLbs') <> 'number'
            OR (v_component->>'perBatchLbs')::numeric < 0
          )) THEN
          RAISE EXCEPTION 'Mix component has an invalid field map' USING ERRCODE = '22023';
        END IF;
        IF v_component->>'ingredientCode' IS NOT NULL
           AND v_component->'ingredientCode' <> 'null'::jsonb THEN
          SELECT code INTO v_ingredient_code
          FROM v2.setup_ingredient_records
          WHERE facility_id = p_facility_id
            AND lower(code) = lower(v_component->>'ingredientCode');
          IF NOT FOUND THEN
            RAISE EXCEPTION 'Mix references an unknown ingredient identity' USING ERRCODE = '23503';
          END IF;
          INSERT INTO v2.setup_mix_component_links (
            facility_id, mix_code, component_index, ingredient_code, source_import_id
          ) VALUES (
            p_facility_id, v_row->>'code', v_component_index, v_ingredient_code, p_import_id
          );
        END IF;
        v_component_index := v_component_index + 1;
      END LOOP;
    END IF;
    EXECUTE format(
      'SELECT to_jsonb(t) FROM v2.%I AS t WHERE t.facility_id = $1 AND lower(t.code) = lower($2)',
      v_table
    ) INTO v_new USING p_facility_id, v_row->>'code';
    v_before := v_before || jsonb_build_array(jsonb_build_object('code', v_row->>'code', 'data', v_old));
    v_after := v_after || jsonb_build_array(jsonb_build_object('code', v_row->>'code', 'data', v_new));
  END LOOP;
  v_result := jsonb_build_object(
    'outcome', 'applied', 'importId', p_import_id, 'family', v_import.family,
    'rowCount', jsonb_array_length(v_import.records), 'createdCount', v_created_count,
    'updatedCount', v_updated_count, 'appliedAt', v_now, 'replayed', false
  ) || COALESCE(
    CASE WHEN v_import.result ? 'sourceSummary'
      THEN jsonb_build_object('sourceSummary', v_import.result->'sourceSummary')
      ELSE NULL END,
    '{}'::jsonb
  );
  UPDATE v2.setup_catalog_imports
  SET status = 'applied', before_snapshot = v_before, after_snapshot = v_after,
      applied_at = v_now, result = v_result
  WHERE facility_id = p_facility_id AND id = p_import_id;
  RETURN v_result;
END
$$;

-- 0007-approved-setup-catalogs.sql: function
CREATE OR REPLACE FUNCTION v2.undo_setup_catalog_import(p_facility_id uuid, p_actor_id uuid, p_import_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_import v2.setup_catalog_imports%ROWTYPE;
  v_table text;
  v_after jsonb;
  v_before jsonb;
  v_current jsonb;
  v_component jsonb;
  v_component_index integer;
  v_ingredient_code text;
  v_expected_links integer;
  v_actual_links integer;
  v_now timestamptz;
  v_result jsonb;
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL OR p_import_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM v2.facility_scope WHERE singleton AND facility_id = p_facility_id) THEN
    RAISE EXCEPTION 'Invalid setup catalog scope' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_import FROM v2.setup_catalog_imports
  WHERE facility_id = p_facility_id AND id = p_import_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Import not found' USING ERRCODE = 'P0002'; END IF;
  IF v_import.status = 'undone' THEN
    RETURN COALESCE(v_import.result, '{}'::jsonb) || jsonb_build_object('outcome', 'undone', 'replayed', true);
  END IF;
  IF v_import.status <> 'applied' THEN
    RAISE EXCEPTION 'Only an applied import can be undone' USING ERRCODE = '55000';
  END IF;
  v_table := v2.setup_catalog_table_name(v_import.family);
  FOR v_after IN SELECT value FROM jsonb_array_elements(v_import.after_snapshot) LOOP
    SELECT NULLIF(value->'data', 'null'::jsonb) INTO v_before
    FROM jsonb_array_elements(v_import.before_snapshot)
    WHERE lower(value->>'code') = lower(v_after->>'code');
    EXECUTE format(
      'SELECT to_jsonb(t) FROM v2.%I AS t WHERE t.facility_id = $1 AND lower(t.code) = lower($2) FOR UPDATE',
      v_table
    ) INTO v_current USING p_facility_id, v_after->>'code';
    IF v_current IS NULL OR v_current->>'source_import_id' <> p_import_id::text
       OR v_current IS DISTINCT FROM v_after->'data' THEN
      RAISE EXCEPTION 'A setup record changed after this import; undo is blocked' USING ERRCODE = '40001';
    END IF;
    IF v_import.family = 'mixes' THEN
      SELECT count(*) INTO v_expected_links
      FROM jsonb_array_elements(v_after->'data'->'data'->'components') AS component(value)
      WHERE component.value->>'ingredientCode' IS NOT NULL;
      SELECT count(*) INTO v_actual_links FROM v2.setup_mix_component_links
      WHERE facility_id = p_facility_id AND lower(mix_code) = lower(v_after->>'code')
        AND source_import_id = p_import_id;
      IF v_expected_links <> v_actual_links OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements(v_after->'data'->'data'->'components') WITH ORDINALITY AS expected(value, position)
        WHERE expected.value->>'ingredientCode' IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM v2.setup_mix_component_links AS link
            WHERE link.facility_id = p_facility_id
              AND lower(link.mix_code) = lower(v_after->>'code')
              AND link.component_index = expected.position - 1
              AND lower(link.ingredient_code) = lower(expected.value->>'ingredientCode')
              AND link.source_import_id = p_import_id
          )
      ) THEN
        RAISE EXCEPTION 'A mix ingredient link changed after this import; undo is blocked' USING ERRCODE = '40001';
      END IF;
    END IF;
    IF v_before IS NULL THEN
      IF v_import.family = 'ingredients' AND (
        EXISTS (
          SELECT 1 FROM v2.setup_mix_records AS mix
          CROSS JOIN LATERAL jsonb_array_elements(mix.data->'components') AS component(value)
          WHERE mix.facility_id = p_facility_id
            AND lower(component.value->>'ingredientCode') = lower(v_after->>'code')
        )
        OR EXISTS (
          SELECT 1 FROM v2.setup_freezer_pull_records AS pull
          WHERE pull.facility_id = p_facility_id
            AND lower(pull.data->>'ingredientCode') = lower(v_after->>'code')
        )
        OR EXISTS (
          SELECT 1 FROM v2.setup_ingredient_records AS ingredient
          WHERE ingredient.facility_id = p_facility_id
            AND lower(ingredient.data->>'mergedIntoCode') = lower(v_after->>'code')
        )
      ) THEN
        RAISE EXCEPTION 'An ingredient is referenced by another setup record; undo is blocked' USING ERRCODE = '40001';
      END IF;
      IF v_import.family = 'die-types' AND EXISTS (
        SELECT 1 FROM v2.setup_die_default_records AS defaults
        WHERE defaults.facility_id = p_facility_id
          AND lower(defaults.code) = lower(v_after->>'code')
      ) THEN
        RAISE EXCEPTION 'A die type is referenced by setup defaults; undo is blocked' USING ERRCODE = '40001';
      END IF;
      EXECUTE format(
        'DELETE FROM v2.%I WHERE facility_id = $1 AND lower(code) = lower($2) AND source_import_id = $3',
        v_table
      ) USING p_facility_id, v_after->>'code', p_import_id;
    ELSE
      IF v_import.family = 'mixes' THEN
        DELETE FROM v2.setup_mix_component_links
        WHERE facility_id = p_facility_id AND lower(mix_code) = lower(v_after->>'code');
      END IF;
      EXECUTE format(
        'UPDATE v2.%I SET code = $1, name = $2, data = $3, source_import_id = $4, updated_at = $5 ' ||
        'WHERE facility_id = $6 AND lower(code) = lower($7)',
        v_table
      ) USING v_before->>'code', v_before->>'name', v_before->'data',
        (v_before->>'source_import_id')::uuid, (v_before->>'updated_at')::timestamptz,
        p_facility_id, v_after->>'code';
      IF v_import.family = 'mixes' THEN
        DELETE FROM v2.setup_mix_component_links
        WHERE facility_id = p_facility_id AND lower(mix_code) = lower(v_after->>'code');
        v_component_index := 0;
        FOR v_component IN SELECT value FROM jsonb_array_elements(v_before->'data'->'components') LOOP
          IF v_component->>'ingredientCode' IS NOT NULL
             AND v_component->'ingredientCode' <> 'null'::jsonb THEN
            SELECT code INTO v_ingredient_code
            FROM v2.setup_ingredient_records
            WHERE facility_id = p_facility_id
              AND lower(code) = lower(v_component->>'ingredientCode');
            IF NOT FOUND THEN
              RAISE EXCEPTION 'The prior mix identity link is no longer available' USING ERRCODE = '40001';
            END IF;
            INSERT INTO v2.setup_mix_component_links (
              facility_id, mix_code, component_index, ingredient_code, source_import_id
            ) VALUES (
              p_facility_id, v_before->>'code', v_component_index, v_ingredient_code,
              (v_before->>'source_import_id')::uuid
            );
          END IF;
          v_component_index := v_component_index + 1;
        END LOOP;
      END IF;
    END IF;
  END LOOP;
  v_now := clock_timestamp();
  v_result := jsonb_build_object(
    'outcome', 'undone', 'importId', p_import_id, 'family', v_import.family,
    'rowCount', jsonb_array_length(v_import.records),
    'createdCount', COALESCE((v_import.result->>'createdCount')::integer, 0),
    'updatedCount', COALESCE((v_import.result->>'updatedCount')::integer, 0),
    'undoneAt', v_now, 'replayed', false
  ) || COALESCE(
    CASE WHEN v_import.result ? 'sourceSummary'
      THEN jsonb_build_object('sourceSummary', v_import.result->'sourceSummary')
      ELSE NULL END,
    '{}'::jsonb
  );
  UPDATE v2.setup_catalog_imports
  SET status = 'undone', undone_at = v_now, result = v_result
  WHERE facility_id = p_facility_id AND id = p_import_id;
  RETURN v_result;
END
$$;

-- 0007-approved-setup-catalogs.sql: function
CREATE OR REPLACE FUNCTION v2.list_setup_catalog_imports(p_facility_id uuid, p_limit integer)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
BEGIN
  IF p_facility_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM v2.facility_scope WHERE singleton AND facility_id = p_facility_id) THEN
    RAISE EXCEPTION 'Invalid setup catalog scope' USING ERRCODE = '42501';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Invalid setup catalog list request' USING ERRCODE = '22023';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', id, 'family', family, 'status', status, 'rowCount', jsonb_array_length(records),
      'createdBy', actor_id, 'createdAt', created_at, 'appliedAt', applied_at, 'undoneAt', undone_at,
      'sourceSummary', result->'sourceSummary',
      'createdCount', (result->>'createdCount')::integer,
      'updatedCount', (result->>'updatedCount')::integer
    ) ORDER BY created_at DESC, id DESC)
    FROM (
      SELECT id, family, status, records, result, actor_id, created_at, applied_at, undone_at
      FROM v2.setup_catalog_imports WHERE facility_id = p_facility_id
      ORDER BY created_at DESC, id DESC LIMIT p_limit
    ) recent
  ), '[]'::jsonb);
END
$$;

-- 0007-approved-setup-catalogs.sql: function
CREATE OR REPLACE FUNCTION v2.get_setup_catalog_import(p_facility_id uuid, p_import_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_import v2.setup_catalog_imports%ROWTYPE;
BEGIN
  IF p_facility_id IS NULL OR p_import_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM v2.facility_scope WHERE singleton AND facility_id = p_facility_id) THEN
    RAISE EXCEPTION 'Invalid setup catalog scope' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_import FROM v2.setup_catalog_imports
  WHERE facility_id = p_facility_id AND id = p_import_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'id', v_import.id, 'family', v_import.family, 'status', v_import.status, 'records', v_import.records,
    'rowCount', jsonb_array_length(v_import.records),
    'createdBy', v_import.actor_id, 'createdAt', v_import.created_at,
    'appliedAt', v_import.applied_at, 'undoneAt', v_import.undone_at,
    'sourceSummary', v_import.result->'sourceSummary',
    'createdCount', (v_import.result->>'createdCount')::integer,
    'updatedCount', (v_import.result->>'updatedCount')::integer
  );
END
$$;

-- 0007-approved-setup-catalogs.sql: permissions
REVOKE ALL ON ALL TABLES IN SCHEMA v2 FROM PUBLIC;

-- 0007-approved-setup-catalogs.sql: permissions
REVOKE ALL ON FUNCTION v2.setup_catalog_table_name(text) FROM PUBLIC;

-- 0007-approved-setup-catalogs.sql: permissions
REVOKE ALL ON FUNCTION v2.setup_catalog_object_size(jsonb) FROM PUBLIC;

-- 0007-approved-setup-catalogs.sql: permissions
REVOKE ALL ON FUNCTION v2.stage_setup_catalog_import(uuid, uuid, text, text, text, jsonb, jsonb) FROM PUBLIC;

-- 0007-approved-setup-catalogs.sql: permissions
REVOKE ALL ON FUNCTION v2.apply_setup_catalog_import(uuid, uuid, uuid) FROM PUBLIC;

-- 0007-approved-setup-catalogs.sql: permissions
REVOKE ALL ON FUNCTION v2.undo_setup_catalog_import(uuid, uuid, uuid) FROM PUBLIC;

-- 0007-approved-setup-catalogs.sql: permissions
REVOKE ALL ON FUNCTION v2.list_setup_catalog_imports(uuid, integer) FROM PUBLIC;

-- 0007-approved-setup-catalogs.sql: permissions
REVOKE ALL ON FUNCTION v2.get_setup_catalog_import(uuid, uuid) FROM PUBLIC;

-- 0007-staff-role-equivalents.sql: reviewed static role seeds
INSERT INTO v2.roles (name, capabilities, builtin)
VALUES
  (
    'qc-manager',
    '["use-ai-tools","review-incidents","manage-allergens","record-qc","manage-qc"]'::jsonb,
    false
  ),
  (
    'warehouse',
    '["manage-inventory"]'::jsonb,
    false
  )
ON CONFLICT (name) DO NOTHING;

-- 0007-staff-role-equivalents.sql: role validation or conditional grants
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM (
      VALUES
        (
          'qc-manager'::text,
          '["use-ai-tools","review-incidents","manage-allergens","record-qc","manage-qc"]'::jsonb
        ),
        (
          'warehouse'::text,
          '["manage-inventory"]'::jsonb
        )
    ) AS expected(name, capabilities)
    LEFT JOIN v2.roles AS actual ON actual.name = expected.name
    WHERE actual.name IS NULL
       OR actual.builtin IS DISTINCT FROM false
       OR actual.capabilities IS DISTINCT FROM expected.capabilities
  ) THEN
    RAISE EXCEPTION 'V2 staff role equivalents conflict with the reviewed capability mapping';
  END IF;
END
$$;

-- 0008-inventory-parity.sql: repeat-safe trigger
DROP TRIGGER IF EXISTS inventory_lot_allocations_append_only ON v2.inventory_movement_lot_allocations;
CREATE TRIGGER inventory_lot_allocations_append_only
  BEFORE UPDATE OR DELETE ON v2.inventory_movement_lot_allocations
  FOR EACH ROW EXECUTE FUNCTION v2.reject_immutable_row_mutation();

-- 0008-inventory-parity.sql: function
CREATE OR REPLACE FUNCTION v2.track_inventory_movement_lots()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_remaining numeric(20,6) := abs(NEW.quantity_delta);
  v_take numeric(20,6);
  v_source record;
  v_lot_id uuid;
  v_now timestamptz := COALESCE(NEW.occurred_at, clock_timestamp());
BEGIN
  IF NEW.quantity_delta > 0 THEN
    IF NEW.movement_type = 'transfer_in' THEN
      FOR v_source IN
        SELECT a.lot_id, abs(a.quantity_delta) AS quantity,
          l.lot_number, l.source_reference, l.received_at
        FROM v2.inventory_movements outgoing
        JOIN v2.inventory_movement_lot_allocations a
          ON a.facility_id = outgoing.facility_id AND a.movement_id = outgoing.id
        JOIN v2.inventory_lots l
          ON l.facility_id = a.facility_id AND l.id = a.lot_id
        WHERE outgoing.facility_id = NEW.facility_id
          AND outgoing.movement_group_id = NEW.movement_group_id
          AND outgoing.movement_type = 'transfer_out'
          AND outgoing.quantity_delta < 0
        ORDER BY l.received_at, l.id
      LOOP
        v_take := LEAST(v_remaining, v_source.quantity);
        EXIT WHEN v_take <= 0;
        INSERT INTO v2.inventory_lots (
          facility_id, warehouse_id, product_id, lot_number, source_reference,
          received_at, quantity_received, quantity_remaining, source_lot_id, created_at
        ) VALUES (
          NEW.facility_id, NEW.warehouse_id, NEW.product_id,
          v_source.lot_number, v_source.source_reference, v_source.received_at,
          v_take, v_take, v_source.lot_id, v_now
        ) RETURNING id INTO v_lot_id;
        INSERT INTO v2.inventory_movement_lot_allocations (
          facility_id, movement_id, lot_id, warehouse_id, product_id, quantity_delta, created_at
        ) VALUES (
          NEW.facility_id, NEW.id, v_lot_id, NEW.warehouse_id, NEW.product_id, v_take, v_now
        );
        v_remaining := v_remaining - v_take;
      END LOOP;
      IF v_remaining <> 0 THEN
        RAISE EXCEPTION 'Transfer source lot details are incomplete' USING ERRCODE = '23514';
      END IF;
    ELSE
      INSERT INTO v2.inventory_lots (
        facility_id, warehouse_id, product_id, lot_number, source_reference,
        received_at, quantity_received, quantity_remaining, created_at
      ) VALUES (
        NEW.facility_id, NEW.warehouse_id, NEW.product_id, NEW.lot_number,
        NEW.source_reference, v_now, NEW.quantity_delta, NEW.quantity_delta, v_now
      ) RETURNING id INTO v_lot_id;
      INSERT INTO v2.inventory_movement_lot_allocations (
        facility_id, movement_id, lot_id, warehouse_id, product_id, quantity_delta, created_at
      ) VALUES (
        NEW.facility_id, NEW.id, v_lot_id, NEW.warehouse_id, NEW.product_id,
        NEW.quantity_delta, v_now
      );
    END IF;
    RETURN NEW;
  END IF;

  FOR v_source IN
    SELECT l.id, l.quantity_remaining
    FROM v2.inventory_lots l
    WHERE l.facility_id = NEW.facility_id
      AND l.warehouse_id = NEW.warehouse_id
      AND l.product_id = NEW.product_id
      AND l.quantity_remaining > 0
    ORDER BY l.received_at, l.id
    FOR UPDATE
  LOOP
    v_take := LEAST(v_remaining, v_source.quantity_remaining);
    EXIT WHEN v_take <= 0;
    UPDATE v2.inventory_lots
      SET quantity_remaining = quantity_remaining - v_take
      WHERE facility_id = NEW.facility_id AND id = v_source.id;
    INSERT INTO v2.inventory_movement_lot_allocations (
      facility_id, movement_id, lot_id, warehouse_id, product_id, quantity_delta, created_at
    ) VALUES (
      NEW.facility_id, NEW.id, v_source.id, NEW.warehouse_id, NEW.product_id,
      -v_take, v_now
    );
    v_remaining := v_remaining - v_take;
    EXIT WHEN v_remaining = 0;
  END LOOP;
  IF v_remaining > 0 THEN
    RAISE EXCEPTION 'Insufficient lot quantity for inventory movement' USING ERRCODE = '22003';
  END IF;
  RETURN NEW;
END
$$;

-- 0008-inventory-parity.sql: repeat-safe trigger
DROP TRIGGER IF EXISTS inventory_movement_lot_tracking ON v2.inventory_movements;
CREATE TRIGGER inventory_movement_lot_tracking
  AFTER INSERT ON v2.inventory_movements
  FOR EACH ROW EXECUTE FUNCTION v2.track_inventory_movement_lots();

-- 0008-inventory-parity.sql: repeat-safe trigger
DROP TRIGGER IF EXISTS inventory_cycle_counts_append_only ON v2.inventory_cycle_counts;
CREATE TRIGGER inventory_cycle_counts_append_only
  BEFORE DELETE ON v2.inventory_cycle_counts
  FOR EACH ROW EXECUTE FUNCTION v2.reject_immutable_row_mutation();

-- 0008-inventory-parity.sql: repeat-safe trigger
DROP TRIGGER IF EXISTS inventory_preparations_append_only ON v2.inventory_preparations;
CREATE TRIGGER inventory_preparations_append_only
  BEFORE UPDATE OR DELETE ON v2.inventory_preparations
  FOR EACH ROW EXECUTE FUNCTION v2.reject_immutable_row_mutation();

-- 0008-inventory-parity.sql: repeat-safe trigger
DROP TRIGGER IF EXISTS run_inventory_staged_supplies_append_only ON v2.run_inventory_staged_supplies;
CREATE TRIGGER run_inventory_staged_supplies_append_only
  BEFORE UPDATE OR DELETE ON v2.run_inventory_staged_supplies
  FOR EACH ROW EXECUTE FUNCTION v2.reject_immutable_row_mutation();

-- 0008-inventory-parity.sql: repeat-safe trigger
DROP TRIGGER IF EXISTS run_inventory_stage_receipts_append_only ON v2.run_inventory_stage_receipts;
CREATE TRIGGER run_inventory_stage_receipts_append_only
  BEFORE UPDATE OR DELETE ON v2.run_inventory_stage_receipts
  FOR EACH ROW EXECUTE FUNCTION v2.reject_immutable_row_mutation();

-- 0008-inventory-parity.sql: function
CREATE OR REPLACE FUNCTION v2.list_inventory_stock(p_facility_id uuid, p_warehouse_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
BEGIN
  IF p_facility_id IS NULL OR p_warehouse_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM v2.facility_scope WHERE singleton AND facility_id = p_facility_id
  ) THEN RAISE EXCEPTION 'Invalid inventory scope' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM v2.inventory_warehouses
    WHERE facility_id = p_facility_id AND id = p_warehouse_id AND active
  ) THEN RAISE EXCEPTION 'Warehouse not found' USING ERRCODE = 'P0002'; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'productId', p.id, 'code', p.code, 'name', p.name, 'unit', p.base_unit,
      'quantity', COALESCE(b.quantity, 0)::text,
      'revision', COALESCE(b.revision, 0),
      'lotQuantity', COALESCE((
        SELECT sum(l.quantity_remaining) FROM v2.inventory_lots l
        WHERE l.facility_id = p.facility_id AND l.warehouse_id = p_warehouse_id
          AND l.product_id = p.id
      ), 0)::text,
      'stagedQuantity', COALESCE((
        SELECT sum(s.quantity)
        FROM v2.run_inventory_staged_supplies s
        JOIN v2.runs r ON r.facility_id = s.facility_id AND r.id = s.run_id
        WHERE s.facility_id = p.facility_id AND s.warehouse_id = p_warehouse_id
          AND s.actual_product_id = p.id AND r.status <> 'completed'
      ), 0)::text,
      'availableQuantity', (
        COALESCE(b.quantity, 0) - COALESCE((
          SELECT sum(s.quantity)
          FROM v2.run_inventory_staged_supplies s
          JOIN v2.runs r ON r.facility_id = s.facility_id AND r.id = s.run_id
          WHERE s.facility_id = p.facility_id AND s.warehouse_id = p_warehouse_id
            AND s.actual_product_id = p.id AND r.status <> 'completed'
        ), 0)
      )::text
    ) ORDER BY lower(p.name), p.id)
    FROM v2.products p
    LEFT JOIN v2.inventory_balances b
      ON b.facility_id = p.facility_id AND b.product_id = p.id AND b.warehouse_id = p_warehouse_id
    WHERE p.facility_id = p_facility_id AND p.active
  ), '[]'::jsonb);
END
$$;

-- 0008-inventory-parity.sql: function
CREATE OR REPLACE FUNCTION v2.list_inventory_movements(
  p_facility_id uuid, p_warehouse_id uuid, p_limit integer,
  p_before_at timestamptz, p_before_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
BEGIN
  IF p_facility_id IS NULL OR p_warehouse_id IS NULL OR p_limit IS NULL
     OR p_limit NOT BETWEEN 1 AND 100
     OR ((p_before_at IS NULL) <> (p_before_id IS NULL))
     OR NOT EXISTS (SELECT 1 FROM v2.facility_scope WHERE singleton AND facility_id = p_facility_id) THEN
    RAISE EXCEPTION 'Invalid inventory history request' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM v2.inventory_warehouses
    WHERE facility_id = p_facility_id AND id = p_warehouse_id AND active
  ) THEN RAISE EXCEPTION 'Warehouse not found' USING ERRCODE = 'P0002'; END IF;
  RETURN (
    WITH page AS (
      SELECT m.*, p.code AS product_code, p.name AS product_name, p.base_unit,
        row_number() OVER (ORDER BY m.occurred_at DESC, m.id DESC) AS row_num
      FROM v2.inventory_movements m
      JOIN v2.products p ON p.facility_id = m.facility_id AND p.id = m.product_id
      WHERE m.facility_id = p_facility_id AND m.warehouse_id = p_warehouse_id
        AND (p_before_at IS NULL OR (m.occurred_at, m.id) < (p_before_at, p_before_id))
      ORDER BY m.occurred_at DESC, m.id DESC
      LIMIT p_limit + 1
    )
    SELECT jsonb_build_object(
      'items', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', page.id, 'movementGroupId', page.movement_group_id,
          'productCode', page.product_code, 'productName', page.product_name,
          'unit', page.base_unit, 'type', page.movement_type,
          'quantityDelta', page.quantity_delta::text, 'reason', page.reason,
          'actorId', page.actor_id, 'occurredAt', page.occurred_at,
          'lotNumber', page.lot_number, 'sourceReference', page.source_reference,
          'plannedProductId', page.planned_product_id,
          'lotAllocations', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'lotId', a.lot_id, 'lotNumber', l.lot_number,
              'quantityDelta', a.quantity_delta::text
            ) ORDER BY l.received_at, l.id)
            FROM v2.inventory_movement_lot_allocations a
            JOIN v2.inventory_lots l ON l.facility_id = a.facility_id AND l.id = a.lot_id
            WHERE a.facility_id = page.facility_id AND a.movement_id = page.id
          ), '[]'::jsonb)
        ) ORDER BY page.row_num)
        FROM page WHERE page.row_num <= p_limit
      ), '[]'::jsonb),
      'nextCursor', CASE WHEN EXISTS (SELECT 1 FROM page WHERE row_num > p_limit) THEN (
        SELECT jsonb_build_object('occurredAt', occurred_at, 'id', id)
        FROM page WHERE row_num = p_limit
      ) ELSE NULL END
    )
  );
END
$$;

-- 0008-inventory-parity.sql: function
CREATE OR REPLACE FUNCTION v2.list_inventory_lots(p_facility_id uuid, p_warehouse_id uuid, p_product_id uuid, p_limit integer)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
BEGIN
  IF p_facility_id IS NULL OR p_warehouse_id IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100
     OR NOT EXISTS (SELECT 1 FROM v2.facility_scope WHERE singleton AND facility_id = p_facility_id) THEN
    RAISE EXCEPTION 'Invalid inventory scope' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM v2.inventory_warehouses
    WHERE facility_id = p_facility_id AND id = p_warehouse_id AND active) THEN
    RAISE EXCEPTION 'Warehouse not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN COALESCE((
     SELECT jsonb_agg(jsonb_build_object(
      'id', l.id, 'productId', l.product_id, 'productCode', p.code,
      'productName', p.name, 'unit', p.base_unit, 'lotNumber', l.lot_number,
      'sourceReference', l.source_reference, 'receivedAt', l.received_at,
      'quantityReceived', l.quantity_received::text,
      'quantityRemaining', l.quantity_remaining::text,
      'sourceLotId', l.source_lot_id
     ) ORDER BY l.received_at DESC, l.id DESC)
     FROM (SELECT * FROM v2.inventory_lots
       WHERE facility_id = p_facility_id AND warehouse_id = p_warehouse_id
         AND (p_product_id IS NULL OR product_id = p_product_id)
       ORDER BY received_at DESC, id DESC LIMIT p_limit) l
    JOIN v2.products p ON p.facility_id = l.facility_id AND p.id = l.product_id
  ), '[]'::jsonb);
END
$$;

-- 0008-inventory-parity.sql: function
CREATE OR REPLACE FUNCTION v2.record_inventory_movement_internal(
  p_facility_id uuid, p_actor_id uuid, p_command_id text, p_request_hash text,
  p_warehouse_id uuid, p_product_code text, p_movement_type text,
  p_quantity numeric, p_reason text, p_lot_number text, p_source_reference text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_hash text;
  v_response jsonb;
  v_product v2.products%ROWTYPE;
  v_balance v2.inventory_balances%ROWTYPE;
  v_available numeric(20,6);
  v_reserved numeric(20,6);
  v_now timestamptz;
  v_group_id uuid;
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL OR p_warehouse_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM v2.facility_scope WHERE singleton AND facility_id = p_facility_id)
     OR p_command_id IS NULL OR length(btrim(p_command_id)) NOT BETWEEN 1 AND 200
     OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$'
      OR p_movement_type NOT IN ('receipt', 'adjustment', 'prep_consume', 'prep_receive')
     OR p_quantity IS NULL OR p_quantity = 0 OR abs(p_quantity) >= 100000000000000
     OR (p_movement_type = 'receipt' AND p_quantity <= 0)
      OR (p_movement_type = 'prep_consume' AND p_quantity >= 0)
      OR (p_movement_type = 'prep_receive' AND p_quantity <= 0)
     OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 3 AND 500
     OR p_lot_number IS NULL OR length(p_lot_number) > 120 OR p_lot_number ~ '[[:cntrl:]]'
     OR p_source_reference IS NULL OR length(p_source_reference) > 200
     OR p_source_reference ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'Invalid inventory movement request' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_facility_id::text || ':' || p_actor_id::text || ':' || p_command_id, 0));
  SELECT request_hash, response INTO v_hash, v_response
  FROM v2.command_receipts
  WHERE facility_id = p_facility_id AND actor_id = p_actor_id AND command_id = p_command_id;
  IF FOUND THEN
    IF v_hash <> p_request_hash THEN RAISE EXCEPTION 'Command ID was reused with different details' USING ERRCODE = '22023'; END IF;
    RETURN v_response || jsonb_build_object('replayed', true);
  END IF;
  PERFORM 1 FROM v2.inventory_warehouses
  WHERE facility_id = p_facility_id AND id = p_warehouse_id AND active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Warehouse not found' USING ERRCODE = 'P0002'; END IF;
  IF NOT EXISTS (SELECT 1 FROM v2.opening_counts
    WHERE facility_id = p_facility_id AND warehouse_id = p_warehouse_id AND status = 'applied') THEN
    RAISE EXCEPTION 'Review and apply an opening count before recording stock' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO v_product FROM v2.products
  WHERE facility_id = p_facility_id AND lower(code) = lower(p_product_code) AND active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Product not found' USING ERRCODE = 'P0002'; END IF;
  INSERT INTO v2.inventory_balances (facility_id, warehouse_id, product_id)
  VALUES (p_facility_id, p_warehouse_id, v_product.id) ON CONFLICT DO NOTHING;
  SELECT * INTO v_balance FROM v2.inventory_balances
  WHERE facility_id = p_facility_id AND warehouse_id = p_warehouse_id AND product_id = v_product.id FOR UPDATE;
  SELECT COALESCE(sum(s.quantity), 0) INTO v_reserved
  FROM v2.run_inventory_staged_supplies s JOIN v2.runs r
    ON r.facility_id = s.facility_id AND r.id = s.run_id
  WHERE s.facility_id = p_facility_id AND s.warehouse_id = p_warehouse_id
    AND s.actual_product_id = v_product.id AND r.status <> 'completed';
  v_available := v_balance.quantity + p_quantity;
  IF v_available < v_reserved THEN
    RAISE EXCEPTION 'This change would remove stock reserved for a staged run supply' USING ERRCODE = '23514';
  END IF;
  IF v_available < 0 THEN RAISE EXCEPTION 'Insufficient stock for this adjustment' USING ERRCODE = '22003'; END IF;
  IF v_balance.revision = 9007199254740991 THEN RAISE EXCEPTION 'Inventory revision exhausted' USING ERRCODE = '22003'; END IF;
  v_now := clock_timestamp();
  UPDATE v2.inventory_balances SET quantity = v_available, revision = revision + 1, updated_at = v_now
  WHERE facility_id = p_facility_id AND warehouse_id = p_warehouse_id AND product_id = v_product.id;
  v_group_id := gen_random_uuid();
  INSERT INTO v2.inventory_movements (
    facility_id, warehouse_id, product_id, movement_group_id, movement_type,
    quantity_delta, reason, actor_id, command_id, occurred_at, lot_number, source_reference
  ) VALUES (
    p_facility_id, p_warehouse_id, v_product.id, v_group_id, p_movement_type,
    p_quantity, btrim(p_reason), p_actor_id, p_command_id, v_now,
    p_lot_number, p_source_reference
  );
  v_response := jsonb_build_object(
    'outcome', 'accepted', 'replayed', false, 'movementId', v_group_id,
    'warehouseId', p_warehouse_id, 'productCode', v_product.code,
    'quantity', v_available::text, 'revision', v_balance.revision + 1
  );
  INSERT INTO v2.command_receipts (facility_id, actor_id, command_id, request_hash, response, created_at)
  VALUES (p_facility_id, p_actor_id, p_command_id, p_request_hash, v_response, v_now);
  RETURN v_response;
END
$$;

-- 0008-inventory-parity.sql: function
CREATE OR REPLACE FUNCTION v2.record_inventory_movement_with_lot(
  p_facility_id uuid, p_actor_id uuid, p_command_id text, p_request_hash text,
  p_warehouse_id uuid, p_product_code text, p_movement_type text,
  p_quantity numeric, p_reason text, p_lot_number text, p_source_reference text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
BEGIN
  IF p_movement_type NOT IN ('receipt','adjustment') THEN
    RAISE EXCEPTION 'Choose a receipt or stock adjustment' USING ERRCODE='22023';
  END IF;
  RETURN v2.record_inventory_movement_internal(
    p_facility_id,p_actor_id,p_command_id,p_request_hash,p_warehouse_id,p_product_code,
    p_movement_type,p_quantity,p_reason,p_lot_number,p_source_reference
  );
END
$$;

-- 0008-inventory-parity.sql: function
CREATE OR REPLACE FUNCTION v2.transfer_inventory(
  p_facility_id uuid, p_actor_id uuid, p_command_id text, p_request_hash text,
  p_source_warehouse_id uuid, p_target_warehouse_id uuid, p_product_code text,
  p_quantity numeric, p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_hash text; v_response jsonb; v_product v2.products%ROWTYPE;
  v_source numeric(20,6); v_target numeric(20,6);
  v_source_rev bigint; v_target_rev bigint; v_reserved numeric(20,6);
  v_now timestamptz; v_group uuid;
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM v2.facility_scope WHERE singleton AND facility_id = p_facility_id)
     OR p_command_id IS NULL OR length(btrim(p_command_id)) NOT BETWEEN 1 AND 200
     OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$'
     OR p_source_warehouse_id IS NULL OR p_target_warehouse_id IS NULL
     OR p_source_warehouse_id = p_target_warehouse_id OR p_quantity IS NULL
     OR p_quantity <= 0 OR p_quantity >= 100000000000000
     OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'Invalid inventory transfer request' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_facility_id::text || ':' || p_actor_id::text || ':' || p_command_id, 0));
  SELECT request_hash, response INTO v_hash, v_response FROM v2.command_receipts
  WHERE facility_id = p_facility_id AND actor_id = p_actor_id AND command_id = p_command_id;
  IF FOUND THEN
    IF v_hash <> p_request_hash THEN RAISE EXCEPTION 'Command ID was reused with different details' USING ERRCODE = '22023'; END IF;
    RETURN v_response || jsonb_build_object('replayed', true);
  END IF;
  PERFORM 1 FROM v2.inventory_warehouses
  WHERE facility_id = p_facility_id AND active
    AND id IN (p_source_warehouse_id, p_target_warehouse_id) ORDER BY id FOR UPDATE;
  IF (SELECT count(*) FROM v2.inventory_warehouses WHERE facility_id = p_facility_id
      AND active AND id IN (p_source_warehouse_id, p_target_warehouse_id)) <> 2 THEN
    RAISE EXCEPTION 'Warehouse not found' USING ERRCODE = 'P0002';
  END IF;
  IF (SELECT count(*) FROM v2.opening_counts WHERE facility_id = p_facility_id
      AND status = 'applied' AND warehouse_id IN (p_source_warehouse_id, p_target_warehouse_id)) <> 2 THEN
    RAISE EXCEPTION 'Review and apply opening counts in both warehouses before transferring stock' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO v_product FROM v2.products
  WHERE facility_id = p_facility_id AND lower(code) = lower(p_product_code) AND active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Product not found' USING ERRCODE = 'P0002'; END IF;
  INSERT INTO v2.inventory_balances (facility_id, warehouse_id, product_id)
  VALUES (p_facility_id, p_source_warehouse_id, v_product.id),
    (p_facility_id, p_target_warehouse_id, v_product.id) ON CONFLICT DO NOTHING;
  SELECT quantity, revision INTO v_source, v_source_rev FROM v2.inventory_balances
  WHERE facility_id = p_facility_id AND warehouse_id = p_source_warehouse_id
    AND product_id = v_product.id FOR UPDATE;
  SELECT quantity, revision INTO v_target, v_target_rev FROM v2.inventory_balances
  WHERE facility_id = p_facility_id AND warehouse_id = p_target_warehouse_id
    AND product_id = v_product.id FOR UPDATE;
  SELECT COALESCE(sum(s.quantity), 0) INTO v_reserved
  FROM v2.run_inventory_staged_supplies s JOIN v2.runs r
    ON r.facility_id = s.facility_id AND r.id = s.run_id
  WHERE s.facility_id = p_facility_id AND s.warehouse_id = p_source_warehouse_id
    AND s.actual_product_id = v_product.id AND r.status <> 'completed';
  IF v_source - v_reserved < p_quantity THEN RAISE EXCEPTION 'Insufficient unreserved stock for this transfer' USING ERRCODE = '22003'; END IF;
  IF v_source_rev >= 9007199254740991 OR v_target_rev >= 9007199254740991 THEN
    RAISE EXCEPTION 'Inventory revision exhausted' USING ERRCODE = '22003';
  END IF;
  v_now := clock_timestamp(); v_group := gen_random_uuid();
  UPDATE v2.inventory_balances SET quantity = quantity - p_quantity,
    revision = revision + 1, updated_at = v_now
  WHERE facility_id = p_facility_id AND warehouse_id = p_source_warehouse_id AND product_id = v_product.id;
  UPDATE v2.inventory_balances SET quantity = quantity + p_quantity,
    revision = revision + 1, updated_at = v_now
  WHERE facility_id = p_facility_id AND warehouse_id = p_target_warehouse_id AND product_id = v_product.id;
  INSERT INTO v2.inventory_movements (
    facility_id, warehouse_id, product_id, movement_group_id, movement_type,
    quantity_delta, reason, actor_id, command_id, occurred_at
  ) VALUES (
    p_facility_id, p_source_warehouse_id, v_product.id, v_group, 'transfer_out',
    -p_quantity, btrim(p_reason), p_actor_id, p_command_id, v_now
  );
  INSERT INTO v2.inventory_movements (
    facility_id, warehouse_id, product_id, movement_group_id, movement_type,
    quantity_delta, reason, actor_id, command_id, occurred_at, source_reference
  ) VALUES (
    p_facility_id, p_target_warehouse_id, v_product.id, v_group, 'transfer_in',
    p_quantity, btrim(p_reason), p_actor_id, p_command_id, v_now, 'Transferred from another warehouse'
  );
  v_response := jsonb_build_object(
    'outcome', 'accepted', 'replayed', false, 'transferId', v_group,
    'productCode', v_product.code, 'quantity', p_quantity::text,
    'sourceWarehouseId', p_source_warehouse_id, 'sourceQuantity', (v_source-p_quantity)::text,
    'sourceRevision', v_source_rev+1, 'targetWarehouseId', p_target_warehouse_id,
    'targetQuantity', (v_target+p_quantity)::text, 'targetRevision', v_target_rev+1
  );
  INSERT INTO v2.command_receipts (facility_id, actor_id, command_id, request_hash, response, created_at)
  VALUES (p_facility_id, p_actor_id, p_command_id, p_request_hash, v_response, v_now);
  RETURN v_response;
END
$$;

-- 0008-inventory-parity.sql: function
CREATE OR REPLACE FUNCTION v2.list_inventory_preparation_setup(p_facility_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
BEGIN
  IF p_facility_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM v2.facility_scope WHERE singleton AND facility_id = p_facility_id
  ) THEN RAISE EXCEPTION 'Invalid facility scope' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object(
    'ingredients', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'code', i.code, 'name', i.name, 'enabled', (i.data->>'enabled')::boolean,
        'productCode', p.code, 'productName', p.name, 'productUnit', p.base_unit,
        'stockUnitsPerLb', l.stock_units_per_lb::text
      ) ORDER BY lower(i.name), i.code)
      FROM v2.setup_ingredient_records i
      LEFT JOIN v2.setup_ingredient_inventory_links l
        ON l.facility_id = i.facility_id AND l.ingredient_code = i.code
      LEFT JOIN v2.products p ON p.facility_id = l.facility_id AND p.id = l.product_id AND p.active
      WHERE i.facility_id = p_facility_id AND COALESCE((i.data->>'enabled')::boolean, false)
    ), '[]'::jsonb),
    'mixes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'code', m.code, 'name', m.name, 'enabled', (m.data->>'enabled')::boolean,
        'isPrep', (m.data->>'isPrep')::boolean, 'batchSizeLbs', m.data->'batchSizeLbs',
        'productCode', outp.code, 'productName', outp.name, 'productUnit', outp.base_unit,
        'stockUnitsPerLb', ml.stock_units_per_lb::text,
        'components', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'ingredientCode', COALESCE(link.ingredient_code, component.value->>'ingredientCode'),
            'ingredientName', component.value->>'ingredientName',
            'perBatchLbs', component.value->>'perBatchLbs',
            'productCode', rawp.code, 'productName', rawp.name, 'productUnit', rawp.base_unit,
            'stockUnitsPerLb', il.stock_units_per_lb::text
          ) ORDER BY component.ordinality)
          FROM jsonb_array_elements(m.data->'components') WITH ORDINALITY AS component(value, ordinality)
          LEFT JOIN v2.setup_mix_component_links link
            ON link.facility_id = m.facility_id AND lower(link.mix_code) = lower(m.code)
              AND link.component_index = component.ordinality - 1
          LEFT JOIN v2.setup_ingredient_inventory_links il
            ON il.facility_id = m.facility_id AND lower(il.ingredient_code) = lower(link.ingredient_code)
          LEFT JOIN v2.products rawp ON rawp.facility_id = il.facility_id AND rawp.id = il.product_id AND rawp.active
        ), '[]'::jsonb)
      ) ORDER BY lower(m.name), m.code)
      FROM v2.setup_mix_records m
      LEFT JOIN v2.setup_mix_inventory_links ml
        ON ml.facility_id = m.facility_id AND ml.mix_code = m.code
      LEFT JOIN v2.products outp ON outp.facility_id = ml.facility_id AND outp.id = ml.product_id AND outp.active
      WHERE m.facility_id = p_facility_id AND COALESCE((m.data->>'enabled')::boolean, false)
    ), '[]'::jsonb)
  );
END
$$;

-- 0008-inventory-parity.sql: function
CREATE OR REPLACE FUNCTION v2.list_run_inventory_products(p_facility_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
BEGIN
  IF p_facility_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM v2.facility_scope WHERE singleton AND facility_id = p_facility_id
  ) THEN RAISE EXCEPTION 'Invalid facility scope' USING ERRCODE = '42501'; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', id, 'code', code, 'name', name, 'unit', base_unit
    ) ORDER BY lower(name), id)
    FROM v2.products
    WHERE facility_id = p_facility_id AND active
  ), '[]'::jsonb);
END
$$;

-- 0008-inventory-parity.sql: function
CREATE OR REPLACE FUNCTION v2.set_setup_inventory_link(
  p_facility_id uuid, p_actor_id uuid, p_command_id text, p_request_hash text,
  p_kind text, p_source_code text, p_product_code text, p_stock_units_per_lb numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_hash text; v_response jsonb; v_product v2.products%ROWTYPE; v_now timestamptz;
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM v2.facility_scope WHERE singleton AND facility_id = p_facility_id)
     OR p_command_id IS NULL OR length(btrim(p_command_id)) NOT BETWEEN 1 AND 200
     OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$'
     OR p_kind NOT IN ('ingredient', 'mix')
     OR p_source_code IS NULL OR p_source_code !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$'
     OR p_product_code IS NULL OR p_product_code !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$'
     OR p_stock_units_per_lb IS NULL OR p_stock_units_per_lb <= 0 OR p_stock_units_per_lb >= 1000000 THEN
    RAISE EXCEPTION 'Invalid setup inventory link' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_facility_id::text || ':' || p_actor_id::text || ':' || p_command_id, 0));
  SELECT request_hash, response INTO v_hash, v_response FROM v2.command_receipts
  WHERE facility_id = p_facility_id AND actor_id = p_actor_id AND command_id = p_command_id;
  IF FOUND THEN
    IF v_hash <> p_request_hash THEN RAISE EXCEPTION 'Command ID was reused with different details' USING ERRCODE = '22023'; END IF;
    RETURN v_response || jsonb_build_object('replayed', true);
  END IF;
  SELECT * INTO v_product FROM v2.products
  WHERE facility_id = p_facility_id AND lower(code) = lower(p_product_code) AND active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Product not found' USING ERRCODE = 'P0002'; END IF;
  IF p_kind = 'ingredient' THEN
    IF NOT EXISTS (SELECT 1 FROM v2.setup_ingredient_records
      WHERE facility_id = p_facility_id AND lower(code) = lower(p_source_code)
        AND COALESCE((data->>'enabled')::boolean, false)) THEN
      RAISE EXCEPTION 'Enabled ingredient identity not found' USING ERRCODE = 'P0002';
    END IF;
    INSERT INTO v2.setup_ingredient_inventory_links (
      facility_id, ingredient_code, product_id, stock_units_per_lb, actor_id, updated_at
    ) SELECT p_facility_id, code, v_product.id, p_stock_units_per_lb, p_actor_id, clock_timestamp()
      FROM v2.setup_ingredient_records
      WHERE facility_id = p_facility_id AND lower(code) = lower(p_source_code)
    ON CONFLICT (facility_id, ingredient_code) DO UPDATE SET
      product_id = EXCLUDED.product_id,
      stock_units_per_lb = EXCLUDED.stock_units_per_lb,
      actor_id = EXCLUDED.actor_id,
      updated_at = EXCLUDED.updated_at;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM v2.setup_mix_records
      WHERE facility_id = p_facility_id AND lower(code) = lower(p_source_code)
        AND COALESCE((data->>'enabled')::boolean, false)
        AND COALESCE((data->>'isPrep')::boolean, false)
        AND (data->>'batchSizeLbs') ~ '^[0-9]+([.][0-9]+)?$'
        AND (data->>'batchSizeLbs')::numeric > 0) THEN
      RAISE EXCEPTION 'Enabled prep mix with a positive batch size not found' USING ERRCODE = 'P0002';
    END IF;
    INSERT INTO v2.setup_mix_inventory_links (
      facility_id, mix_code, product_id, stock_units_per_lb, actor_id, updated_at
    ) SELECT p_facility_id, code, v_product.id, p_stock_units_per_lb, p_actor_id, clock_timestamp()
      FROM v2.setup_mix_records
      WHERE facility_id = p_facility_id AND lower(code) = lower(p_source_code)
    ON CONFLICT (facility_id, mix_code) DO UPDATE SET
      product_id = EXCLUDED.product_id,
      stock_units_per_lb = EXCLUDED.stock_units_per_lb,
      actor_id = EXCLUDED.actor_id,
      updated_at = EXCLUDED.updated_at;
  END IF;
  v_now := clock_timestamp();
  v_response := jsonb_build_object(
    'outcome', 'linked', 'replayed', false, 'kind', p_kind,
    'sourceCode', p_source_code, 'productCode', v_product.code,
    'stockUnitsPerLb', p_stock_units_per_lb::text, 'updatedAt', v_now
  );
  INSERT INTO v2.command_receipts (facility_id, actor_id, command_id, request_hash, response, created_at)
  VALUES (p_facility_id, p_actor_id, p_command_id, p_request_hash, v_response, v_now);
  RETURN v_response;
END
$$;

-- 0008-inventory-parity.sql: function
CREATE OR REPLACE FUNCTION v2.prepare_inventory_mix(
  p_facility_id uuid, p_actor_id uuid, p_command_id text, p_request_hash text,
  p_mix_code text, p_source_warehouse_id uuid, p_output_warehouse_id uuid,
  p_batch_count numeric, p_lot_number text, p_source_reference text, p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_hash text; v_response jsonb; v_mix v2.setup_mix_records%ROWTYPE;
  v_component record; v_output v2.products%ROWTYPE; v_now timestamptz;
  v_prep_id uuid; v_batch_lbs numeric; v_output_qty numeric;
  v_detail jsonb := '[]'::jsonb; v_part jsonb; v_child_id text; v_child_hash text;
  v_index integer := 0;
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM v2.facility_scope WHERE singleton AND facility_id = p_facility_id)
     OR p_command_id IS NULL OR length(btrim(p_command_id)) NOT BETWEEN 1 AND 200
     OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$'
     OR p_mix_code IS NULL OR p_mix_code !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$'
     OR p_source_warehouse_id IS NULL OR p_output_warehouse_id IS NULL
     OR p_batch_count IS NULL OR p_batch_count <= 0 OR p_batch_count > 1000000
     OR p_lot_number IS NULL OR length(p_lot_number) > 120 OR p_lot_number ~ '[[:cntrl:]]'
     OR p_source_reference IS NULL OR length(p_source_reference) > 200 OR p_source_reference ~ '[[:cntrl:]]'
     OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'Invalid preparation request' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_facility_id::text || ':' || p_actor_id::text || ':' || p_command_id, 0));
  SELECT request_hash, response INTO v_hash, v_response FROM v2.command_receipts
  WHERE facility_id = p_facility_id AND actor_id = p_actor_id AND command_id = p_command_id;
  IF FOUND THEN
    IF v_hash <> p_request_hash THEN RAISE EXCEPTION 'Command ID was reused with different details' USING ERRCODE = '22023'; END IF;
    RETURN v_response || jsonb_build_object('replayed', true);
  END IF;
  PERFORM 1 FROM v2.inventory_warehouses
    WHERE facility_id = p_facility_id AND active
      AND id IN (p_source_warehouse_id, p_output_warehouse_id) ORDER BY id FOR UPDATE;
  IF (SELECT count(*) FROM v2.inventory_warehouses WHERE facility_id = p_facility_id AND active
      AND id IN (p_source_warehouse_id, p_output_warehouse_id)) <> 2
     AND p_source_warehouse_id <> p_output_warehouse_id THEN
    RAISE EXCEPTION 'Preparation warehouse not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM v2.opening_counts WHERE facility_id = p_facility_id
      AND warehouse_id = p_source_warehouse_id AND status = 'applied')
     OR NOT EXISTS (SELECT 1 FROM v2.opening_counts WHERE facility_id = p_facility_id
      AND warehouse_id = p_output_warehouse_id AND status = 'applied') THEN
    RAISE EXCEPTION 'Apply physical opening counts before preparation' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO v_mix FROM v2.setup_mix_records
  WHERE facility_id = p_facility_id AND lower(code) = lower(p_mix_code)
    AND COALESCE((data->>'enabled')::boolean, false)
    AND COALESCE((data->>'isPrep')::boolean, false)
  FOR SHARE;
  IF NOT FOUND OR (v_mix.data->>'batchSizeLbs') !~ '^[0-9]+([.][0-9]+)?$'
     OR (v_mix.data->>'batchSizeLbs')::numeric <= 0 THEN
    RAISE EXCEPTION 'The selected linked prep mix is not available' USING ERRCODE = '55000';
  END IF;
  SELECT p.* INTO v_output
  FROM v2.setup_mix_inventory_links l
  JOIN v2.products p ON p.facility_id = l.facility_id AND p.id = l.product_id AND p.active
  WHERE l.facility_id = p_facility_id AND lower(l.mix_code) = lower(v_mix.code)
  FOR SHARE OF p;
  IF NOT FOUND THEN RAISE EXCEPTION 'The prep mix has no active prepared-stock product link' USING ERRCODE = '55000'; END IF;
  IF p_source_warehouse_id <> p_output_warehouse_id THEN
    PERFORM 1 FROM v2.inventory_warehouses
      WHERE facility_id = p_facility_id AND id IN (p_source_warehouse_id, p_output_warehouse_id)
      ORDER BY id FOR UPDATE;
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_mix.data->'components') WITH ORDINALITY AS c(value, ordinality)
    WHERE c.value->>'perBatchLbs' IS NULL
       OR c.value->>'perBatchLbs' !~ '^[0-9]+([.][0-9]+)?$'
       OR (c.value->>'perBatchLbs')::numeric <= 0
       OR c.value->>'ingredientCode' IS NULL
       OR NOT EXISTS (
         SELECT 1 FROM v2.setup_mix_component_links ml
         JOIN v2.setup_ingredient_inventory_links il
           ON il.facility_id = ml.facility_id AND lower(il.ingredient_code) = lower(ml.ingredient_code)
         JOIN v2.products p ON p.facility_id = il.facility_id AND p.id = il.product_id AND p.active
         WHERE ml.facility_id = p_facility_id AND lower(ml.mix_code) = lower(v_mix.code)
           AND ml.component_index = (c.ordinality - 1)
       )
  ) THEN
    RAISE EXCEPTION 'The prep mix has unresolved ingredients or missing per-batch pound mappings' USING ERRCODE = '55000';
  END IF;
  v_prep_id := gen_random_uuid();
  FOR v_component IN
    SELECT ml.ingredient_code, p.id AS product_id, p.code AS product_code,
      p.name AS product_name, p.base_unit, il.stock_units_per_lb,
      (c.value->>'perBatchLbs')::numeric * p_batch_count * il.stock_units_per_lb AS quantity
    FROM jsonb_array_elements(v_mix.data->'components') WITH ORDINALITY AS c(value, ordinality)
    JOIN v2.setup_mix_component_links ml
      ON ml.facility_id = p_facility_id AND lower(ml.mix_code) = lower(v_mix.code)
        AND ml.component_index = c.ordinality - 1
    JOIN v2.setup_ingredient_inventory_links il
      ON il.facility_id = ml.facility_id AND lower(il.ingredient_code) = lower(ml.ingredient_code)
    JOIN v2.products p ON p.facility_id = il.facility_id AND p.id = il.product_id AND p.active
    ORDER BY p.id
  LOOP
    IF v_component.quantity <> round(v_component.quantity, 6) THEN
      RAISE EXCEPTION 'The linked ingredient formula exceeds inventory unit precision' USING ERRCODE = '22023';
    END IF;
    v_index := v_index + 1;
    v_child_id := 'prep:' || v_prep_id::text || ':component:' || v_index::text;
    v_child_hash := repeat(md5(p_request_hash || ':' || v_index::text), 2);
    PERFORM v2.record_inventory_movement_internal(
      p_facility_id, p_actor_id, v_child_id, v_child_hash,
      p_source_warehouse_id, v_component.product_code, 'prep_consume',
       -round(v_component.quantity, 6), btrim(p_reason), '', 'Prep mix ' || v_mix.code
    );
    v_part := jsonb_build_object(
      'ingredientCode', v_component.ingredient_code,
      'productId', v_component.product_id,
      'productCode', v_component.product_code,
      'productName', v_component.product_name,
      'unit', v_component.base_unit,
      'quantity', round(v_component.quantity, 6)::text
    );
    v_detail := v_detail || jsonb_build_array(v_part);
  END LOOP;
  SELECT l.stock_units_per_lb * (v_mix.data->>'batchSizeLbs')::numeric * p_batch_count
  INTO v_output_qty FROM v2.setup_mix_inventory_links l
  WHERE l.facility_id = p_facility_id AND lower(l.mix_code) = lower(v_mix.code);
  IF v_output_qty IS NULL OR v_output_qty <= 0 THEN
    RAISE EXCEPTION 'The prepared-stock output mapping is unavailable' USING ERRCODE = '55000';
  END IF;
  IF v_output_qty <> round(v_output_qty, 6) THEN
    RAISE EXCEPTION 'The prepared-stock formula exceeds inventory unit precision' USING ERRCODE = '22023';
  END IF;
  v_output_qty := round(v_output_qty, 6);
  v_child_id := 'prep:' || v_prep_id::text || ':prepared-output';
  v_child_hash := repeat(md5(p_request_hash || ':prepared-output'), 2);
  PERFORM v2.record_inventory_movement_internal(
    p_facility_id, p_actor_id, v_child_id, v_child_hash,
    p_output_warehouse_id, v_output.code, 'prep_receive', v_output_qty,
    btrim(p_reason), p_lot_number, COALESCE(NULLIF(p_source_reference, ''), 'Prep mix ' || v_mix.code)
  );
  v_now := clock_timestamp();
  v_response := jsonb_build_object(
    'outcome', 'prepared', 'replayed', false, 'preparationId', v_prep_id,
    'mixCode', v_mix.code, 'mixName', v_mix.name,
    'batchCount', p_batch_count::text, 'sourceWarehouseId', p_source_warehouse_id,
    'outputWarehouseId', p_output_warehouse_id, 'preparedProductCode', v_output.code,
    'preparedQuantity', v_output_qty::text, 'preparedUnit', v_output.base_unit,
    'components', v_detail, 'occurredAt', v_now
  );
  INSERT INTO v2.inventory_preparations (
    facility_id, id, mix_code, source_warehouse_id, output_warehouse_id, actor_id,
    command_id, request_hash, batch_count, prepared_product_id, prepared_quantity,
    lot_number, source_reference, reason, occurred_at, detail
  ) VALUES (
    p_facility_id, v_prep_id, v_mix.code, p_source_warehouse_id, p_output_warehouse_id,
    p_actor_id, p_command_id, p_request_hash, p_batch_count, v_output.id, v_output_qty,
    p_lot_number, p_source_reference, btrim(p_reason), v_now, v_response
  );
  INSERT INTO v2.command_receipts (facility_id, actor_id, command_id, request_hash, response, created_at)
  VALUES (p_facility_id, p_actor_id, p_command_id, p_request_hash, v_response, v_now);
  RETURN v_response;
END
$$;

-- 0008-inventory-parity.sql: function
CREATE OR REPLACE FUNCTION v2.list_inventory_preparations(p_facility_id uuid, p_limit integer)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
BEGIN
  IF p_facility_id IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100
     OR NOT EXISTS (SELECT 1 FROM v2.facility_scope WHERE singleton AND facility_id=p_facility_id) THEN
    RAISE EXCEPTION 'Invalid preparation history request' USING ERRCODE='22023';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id',p.id,'mixCode',p.mix_code,'mixName',m.name,
      'sourceWarehouseId',p.source_warehouse_id,'sourceWarehouseName',sw.name,
      'outputWarehouseId',p.output_warehouse_id,'outputWarehouseName',ow.name,
      'batchCount',p.batch_count::text,'preparedProductCode',product.code,
      'preparedProductName',product.name,'preparedUnit',product.base_unit,
      'preparedQuantity',p.prepared_quantity::text,'lotNumber',p.lot_number,
      'sourceReference',p.source_reference,'reason',p.reason,'actorId',p.actor_id,
      'occurredAt',p.occurred_at,'components',p.detail->'components'
    ) ORDER BY p.occurred_at DESC,p.id DESC)
    FROM (SELECT * FROM v2.inventory_preparations WHERE facility_id=p_facility_id
      ORDER BY occurred_at DESC,id DESC LIMIT p_limit) p
    JOIN v2.setup_mix_records m ON m.facility_id=p.facility_id AND m.code=p.mix_code
    JOIN v2.inventory_warehouses sw ON sw.facility_id=p.facility_id AND sw.id=p.source_warehouse_id
    JOIN v2.inventory_warehouses ow ON ow.facility_id=p.facility_id AND ow.id=p.output_warehouse_id
    JOIN v2.products product ON product.facility_id=p.facility_id AND product.id=p.prepared_product_id
  ),'[]'::jsonb);
END
$$;

-- 0008-inventory-parity.sql: function
CREATE OR REPLACE FUNCTION v2.stage_inventory_cycle_count(
  p_facility_id uuid, p_actor_id uuid, p_request_id text, p_request_hash text,
  p_warehouse_id uuid, p_rows jsonb, p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_existing v2.inventory_cycle_counts%ROWTYPE;
  v_row jsonb; v_enriched jsonb := '[]'::jsonb; v_product v2.products%ROWTYPE;
  v_balance v2.inventory_balances%ROWTYPE; v_id uuid;
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL OR p_warehouse_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM v2.facility_scope WHERE singleton AND facility_id = p_facility_id)
     OR p_request_id IS NULL OR length(btrim(p_request_id)) NOT BETWEEN 1 AND 200
     OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$'
     OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 2000
     OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'Invalid cycle count request' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_facility_id::text || ':' || p_actor_id::text || ':' || p_request_id, 0));
  SELECT * INTO v_existing FROM v2.inventory_cycle_counts
  WHERE facility_id = p_facility_id AND actor_id = p_actor_id AND request_id = p_request_id FOR UPDATE;
  IF FOUND THEN
     IF v_existing.request_hash <> p_request_hash OR v_existing.warehouse_id <> p_warehouse_id THEN
      RAISE EXCEPTION 'Cycle-count request ID was reused with different details' USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object('outcome', v_existing.status, 'countId', v_existing.id,
      'warehouseId', v_existing.warehouse_id, 'rowCount', jsonb_array_length(v_existing.rows), 'replayed', true);
  END IF;
  PERFORM 1 FROM v2.inventory_warehouses
  WHERE facility_id = p_facility_id AND id = p_warehouse_id AND active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Warehouse not found' USING ERRCODE = 'P0002'; END IF;
  IF NOT EXISTS (SELECT 1 FROM v2.opening_counts WHERE facility_id = p_facility_id
      AND warehouse_id = p_warehouse_id AND status = 'applied') THEN
    RAISE EXCEPTION 'Apply the opening count before cycle counting' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM v2.inventory_cycle_counts WHERE facility_id = p_facility_id
      AND warehouse_id = p_warehouse_id AND status IN ('staged', 'reviewed')) THEN
    RAISE EXCEPTION 'A cycle count is already waiting for review or application' USING ERRCODE = '55000';
  END IF;
  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    IF jsonb_typeof(v_row) IS DISTINCT FROM 'object'
       OR (v_row - ARRAY['productCode','quantity']) <> '{}'::jsonb
       OR jsonb_typeof(v_row->'productCode') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_row->'quantity') IS DISTINCT FROM 'string'
       OR (v_row->>'quantity') !~ '^(0|[1-9][0-9]{0,11})([.][0-9]{1,6})?$' THEN
      RAISE EXCEPTION 'Cycle count has an invalid row' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_product FROM v2.products
    WHERE facility_id = p_facility_id AND active AND lower(code) = lower(v_row->>'productCode') FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Cycle count references an unknown product' USING ERRCODE = '22023'; END IF;
    INSERT INTO v2.inventory_balances (facility_id, warehouse_id, product_id)
      VALUES (p_facility_id, p_warehouse_id, v_product.id) ON CONFLICT DO NOTHING;
    SELECT * INTO v_balance FROM v2.inventory_balances
    WHERE facility_id = p_facility_id AND warehouse_id = p_warehouse_id AND product_id = v_product.id FOR UPDATE;
    v_enriched := v_enriched || jsonb_build_array(jsonb_build_object(
      'productCode', v_product.code, 'quantity', v_row->>'quantity',
      'baselineQuantity', v_balance.quantity::text, 'baselineRevision', v_balance.revision
    ));
  END LOOP;
  IF (SELECT count(DISTINCT lower(value->>'productCode')) FROM jsonb_array_elements(p_rows)) <>
     jsonb_array_length(p_rows) THEN
    RAISE EXCEPTION 'Cycle count contains duplicate product codes' USING ERRCODE = '22023';
  END IF;
  INSERT INTO v2.inventory_cycle_counts (
    facility_id, warehouse_id, actor_id, request_id, request_hash, rows, reason
  ) VALUES (p_facility_id, p_warehouse_id, p_actor_id, p_request_id, p_request_hash, v_enriched, btrim(p_reason))
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('outcome','staged','countId',v_id,'warehouseId',p_warehouse_id,
    'rowCount',jsonb_array_length(v_enriched),'replayed',false,'rows',v_enriched);
END
$$;

-- 0008-inventory-parity.sql: function
CREATE OR REPLACE FUNCTION v2.get_inventory_cycle_count(p_facility_id uuid, p_count_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE v_count v2.inventory_cycle_counts%ROWTYPE;
BEGIN
  IF p_facility_id IS NULL OR p_count_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM v2.facility_scope WHERE singleton AND facility_id = p_facility_id
  ) THEN RAISE EXCEPTION 'Invalid cycle count scope' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_count FROM v2.inventory_cycle_counts
  WHERE facility_id = p_facility_id AND id = p_count_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('id',v_count.id,'warehouseId',v_count.warehouse_id,
    'status',v_count.status,'rows',v_count.rows,'reason',v_count.reason,
    'createdBy',v_count.actor_id,'createdAt',v_count.created_at,
    'reviewedBy',v_count.reviewed_by,'reviewedAt',v_count.reviewed_at,
    'appliedBy',v_count.applied_by,'appliedAt',v_count.applied_at,'result',v_count.result);
END
$$;

-- 0008-inventory-parity.sql: function
CREATE OR REPLACE FUNCTION v2.review_inventory_cycle_count(p_facility_id uuid, p_actor_id uuid, p_count_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE v_count v2.inventory_cycle_counts%ROWTYPE; v_row jsonb; v_product v2.products%ROWTYPE;
  v_balance v2.inventory_balances%ROWTYPE; v_review_rows jsonb := '[]'::jsonb; v_delta numeric;
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL OR p_count_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM v2.facility_scope WHERE singleton AND facility_id = p_facility_id
  ) THEN RAISE EXCEPTION 'Invalid cycle count scope' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_count FROM v2.inventory_cycle_counts WHERE facility_id = p_facility_id AND id = p_count_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cycle count not found' USING ERRCODE = 'P0002'; END IF;
  IF v_count.status = 'applied' THEN RETURN COALESCE(v_count.result,'{}'::jsonb) || jsonb_build_object('replayed',true); END IF;
  FOR v_row IN SELECT value FROM jsonb_array_elements(v_count.rows) LOOP
    SELECT * INTO v_product FROM v2.products WHERE facility_id = p_facility_id
      AND lower(code) = lower(v_row->>'productCode') AND active FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'A counted product is no longer active; stage a fresh count' USING ERRCODE = '40001'; END IF;
    SELECT * INTO v_balance FROM v2.inventory_balances WHERE facility_id = p_facility_id
      AND warehouse_id = v_count.warehouse_id AND product_id = v_product.id FOR UPDATE;
    IF v_balance.revision <> (v_row->>'baselineRevision')::bigint
       OR v_balance.quantity <> (v_row->>'baselineQuantity')::numeric THEN
      UPDATE v2.inventory_cycle_counts SET status='stale',
        result=jsonb_build_object('outcome','stale','countId',p_count_id,
          'warehouseId',v_count.warehouse_id,'reason','Stock changed after the count was staged',
          'detectedAt',clock_timestamp())
      WHERE facility_id=p_facility_id AND id=p_count_id;
      RETURN jsonb_build_object('outcome','stale','countId',p_count_id,
        'warehouseId',v_count.warehouse_id,'rows',v_count.rows,'replayed',false);
    END IF;
    v_delta := (v_row->>'quantity')::numeric - v_balance.quantity;
    v_review_rows := v_review_rows || jsonb_build_array(v_row || jsonb_build_object(
      'currentQuantity',v_balance.quantity::text,'variance',v_delta::text,'unit',v_product.base_unit));
  END LOOP;
  IF v_count.status = 'staged' THEN
    UPDATE v2.inventory_cycle_counts SET status='reviewed', reviewed_by=p_actor_id, reviewed_at=clock_timestamp(),
      rows=v_review_rows WHERE facility_id=p_facility_id AND id=p_count_id RETURNING * INTO v_count;
  END IF;
  RETURN jsonb_build_object('outcome',v_count.status,'countId',v_count.id,
    'warehouseId',v_count.warehouse_id,'rows',v_review_rows,'reviewedAt',v_count.reviewed_at,
    'replayed',v_count.status <> 'reviewed' OR v_count.reviewed_by <> p_actor_id);
END
$$;

-- 0008-inventory-parity.sql: function
CREATE OR REPLACE FUNCTION v2.apply_inventory_cycle_count(p_facility_id uuid, p_actor_id uuid, p_count_id uuid, p_acknowledged boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE v_count v2.inventory_cycle_counts%ROWTYPE; v_row jsonb; v_product v2.products%ROWTYPE;
  v_balance v2.inventory_balances%ROWTYPE; v_now timestamptz; v_delta numeric;
  v_group uuid; v_result jsonb; v_rows jsonb := '[]'::jsonb; v_reserved numeric;
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL OR p_count_id IS NULL OR p_acknowledged IS DISTINCT FROM true
     OR NOT EXISTS (SELECT 1 FROM v2.facility_scope WHERE singleton AND facility_id = p_facility_id) THEN
    RAISE EXCEPTION 'Explicit cycle count acknowledgement is required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_count FROM v2.inventory_cycle_counts WHERE facility_id=p_facility_id AND id=p_count_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cycle count not found' USING ERRCODE = 'P0002'; END IF;
  IF v_count.status='applied' THEN RETURN COALESCE(v_count.result,'{}'::jsonb) || jsonb_build_object('replayed',true); END IF;
  IF v_count.status='stale' THEN RETURN COALESCE(v_count.result,'{}'::jsonb) || jsonb_build_object('replayed',true); END IF;
  IF v_count.status <> 'reviewed' THEN RAISE EXCEPTION 'Review the cycle count before applying it' USING ERRCODE = '55000'; END IF;
  PERFORM 1 FROM v2.inventory_warehouses WHERE facility_id=p_facility_id AND id=v_count.warehouse_id AND active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Warehouse not found' USING ERRCODE = 'P0002'; END IF;
  FOR v_row IN SELECT value FROM jsonb_array_elements(v_count.rows) LOOP
    SELECT * INTO v_product FROM v2.products WHERE facility_id=p_facility_id AND active
      AND lower(code)=lower(v_row->>'productCode') FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'A counted product is no longer active; stage a fresh count' USING ERRCODE = '40001'; END IF;
    SELECT * INTO v_balance FROM v2.inventory_balances WHERE facility_id=p_facility_id
      AND warehouse_id=v_count.warehouse_id AND product_id=v_product.id FOR UPDATE;
    IF v_balance.revision <> (v_row->>'baselineRevision')::bigint
       OR v_balance.quantity <> (v_row->>'baselineQuantity')::numeric THEN
      UPDATE v2.inventory_cycle_counts SET status='stale',
        result=jsonb_build_object('outcome','stale','countId',p_count_id,
          'warehouseId',v_count.warehouse_id,'reason','Stock changed after the count was reviewed',
          'detectedAt',clock_timestamp())
      WHERE facility_id=p_facility_id AND id=p_count_id;
      RETURN jsonb_build_object('outcome','stale','countId',p_count_id,
        'warehouseId',v_count.warehouse_id,'rows',v_count.rows,'replayed',false);
    END IF;
    SELECT COALESCE(sum(s.quantity),0) INTO v_reserved FROM v2.run_inventory_staged_supplies s
      JOIN v2.runs r ON r.facility_id=s.facility_id AND r.id=s.run_id
      WHERE s.facility_id=p_facility_id AND s.warehouse_id=v_count.warehouse_id
        AND s.actual_product_id=v_product.id AND r.status <> 'completed';
    IF (v_row->>'quantity')::numeric < v_reserved THEN
      RAISE EXCEPTION 'The count is below stock reserved for an active staged run' USING ERRCODE = '23514';
    END IF;
    v_delta := (v_row->>'quantity')::numeric - v_balance.quantity;
    IF v_delta <> 0 THEN
      IF v_balance.revision >= 9007199254740991 THEN RAISE EXCEPTION 'Inventory revision exhausted' USING ERRCODE = '22003'; END IF;
      UPDATE v2.inventory_balances SET quantity=(v_row->>'quantity')::numeric,
        revision=revision+1, updated_at=clock_timestamp()
      WHERE facility_id=p_facility_id AND warehouse_id=v_count.warehouse_id AND product_id=v_product.id;
      v_group := gen_random_uuid(); v_now := clock_timestamp();
      INSERT INTO v2.inventory_movements (
        facility_id,warehouse_id,product_id,movement_group_id,movement_type,quantity_delta,
        reason,actor_id,command_id,occurred_at,source_reference
      ) VALUES (p_facility_id,v_count.warehouse_id,v_product.id,v_group,'cycle_count',v_delta,
        v_count.reason,p_actor_id,'cycle:'||p_count_id::text||':'||v_product.id::text,v_now,
        'Reviewed cycle count '||p_count_id::text);
    END IF;
    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'productCode',v_product.code,'counted',v_row->>'quantity',
      'baseline',v_balance.quantity::text,'variance',v_delta::text,'unit',v_product.base_unit));
  END LOOP;
  v_now := clock_timestamp();
  v_result := jsonb_build_object('outcome','applied','countId',p_count_id,
    'warehouseId',v_count.warehouse_id,'rowCount',jsonb_array_length(v_count.rows),
    'rows',v_rows,'appliedAt',v_now,'replayed',false);
  UPDATE v2.inventory_cycle_counts SET status='applied',applied_by=p_actor_id,
    applied_at=v_now,result=v_result WHERE facility_id=p_facility_id AND id=p_count_id;
  RETURN v_result;
END
$$;

-- 0008-inventory-parity.sql: function
CREATE OR REPLACE FUNCTION v2.list_inventory_cycle_counts(p_facility_id uuid, p_limit integer)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
BEGIN
  IF p_facility_id IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100
     OR NOT EXISTS (SELECT 1 FROM v2.facility_scope WHERE singleton AND facility_id=p_facility_id) THEN
    RAISE EXCEPTION 'Invalid cycle count list request' USING ERRCODE = '22023';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object('id',c.id,'warehouseId',c.warehouse_id,
      'warehouseName',w.name,'status',c.status,'rowCount',jsonb_array_length(c.rows),
      'createdBy',c.actor_id,'createdAt',c.created_at,'reviewedBy',c.reviewed_by,
      'reviewedAt',c.reviewed_at,'appliedBy',c.applied_by,'appliedAt',c.applied_at)
      ORDER BY c.created_at DESC,c.id DESC)
    FROM (SELECT * FROM v2.inventory_cycle_counts WHERE facility_id=p_facility_id
      ORDER BY created_at DESC,id DESC LIMIT p_limit) c
    JOIN v2.inventory_warehouses w ON w.facility_id=c.facility_id AND w.id=c.warehouse_id
  ),'[]'::jsonb);
END
$$;

-- 0008-inventory-parity.sql: function
CREATE OR REPLACE FUNCTION v2.stage_run_inventory_supply(
  p_facility_id uuid,p_actor_id uuid,p_command_id text,p_request_hash text,
  p_run_id uuid,p_planned_product_code text,p_actual_product_code text,
  p_quantity numeric,p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE v_hash text; v_response jsonb; v_run v2.runs%ROWTYPE;
  v_expected v2.products%ROWTYPE; v_actual v2.products%ROWTYPE; v_warehouse uuid;
  v_balance numeric; v_reserved numeric; v_id uuid; v_now timestamptz;
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL OR p_run_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM v2.facility_scope WHERE singleton AND facility_id=p_facility_id)
     OR p_command_id IS NULL OR length(btrim(p_command_id)) NOT BETWEEN 1 AND 200
     OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$'
     OR p_planned_product_code IS NULL OR p_planned_product_code !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$'
     OR p_actual_product_code IS NULL OR p_actual_product_code !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$'
     OR p_quantity IS NULL OR p_quantity <= 0 OR p_quantity >= 100000000000000
     OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'Invalid staged supply request' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_facility_id::text||':'||p_actor_id::text||':'||p_command_id,0));
  SELECT request_hash,response INTO v_hash,v_response FROM v2.command_receipts
    WHERE facility_id=p_facility_id AND actor_id=p_actor_id AND command_id=p_command_id;
  IF FOUND THEN
    IF v_hash<>p_request_hash THEN RAISE EXCEPTION 'Command ID was reused with different details' USING ERRCODE='22023'; END IF;
    RETURN v_response||jsonb_build_object('replayed',true);
  END IF;
  SELECT * INTO v_run FROM v2.runs WHERE facility_id=p_facility_id AND id=p_run_id FOR UPDATE;
  IF NOT FOUND OR v_run.status='completed' THEN RAISE EXCEPTION 'Run is unavailable for staging' USING ERRCODE='55000'; END IF;
  BEGIN v_warehouse := (v_run.setup_snapshot->'productionPlan'->'warehouse'->>'id')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'Run inventory plan is invalid' USING ERRCODE='22023'; END;
  SELECT * INTO v_expected FROM v2.products
    WHERE facility_id=p_facility_id AND active AND lower(code)=lower(p_planned_product_code) FOR SHARE;
  SELECT * INTO v_actual FROM v2.products
    WHERE facility_id=p_facility_id AND active AND lower(code)=lower(p_actual_product_code) FOR SHARE;
  IF v_expected.id IS NULL THEN RAISE EXCEPTION 'Planned product is not active' USING ERRCODE='P0002'; END IF;
  IF v_actual.id IS NULL THEN RAISE EXCEPTION 'Replacement product is not active' USING ERRCODE='P0002'; END IF;
  IF lower(v_expected.base_unit) <> lower(v_actual.base_unit) THEN
    RAISE EXCEPTION 'Planned and replacement products must use the same stock unit' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_run.setup_snapshot->'productionPlan'->'recipes') r(value)
      CROSS JOIN LATERAL jsonb_array_elements(r.value->'ingredients') l(value)
    WHERE (l.value->>'productId')::uuid=v_expected.id
    UNION ALL
    SELECT 1 FROM jsonb_array_elements(v_run.setup_snapshot->'productionPlan'->'packagingPerCase') l(value)
    WHERE (l.value->>'productId')::uuid=v_expected.id
  ) THEN RAISE EXCEPTION 'The selected planned product is not part of this run' USING ERRCODE='22023'; END IF;
  INSERT INTO v2.inventory_balances(facility_id,warehouse_id,product_id)
    VALUES(p_facility_id,v_warehouse,v_actual.id) ON CONFLICT DO NOTHING;
  SELECT quantity INTO v_balance FROM v2.inventory_balances
    WHERE facility_id=p_facility_id AND warehouse_id=v_warehouse AND product_id=v_actual.id FOR UPDATE;
  SELECT COALESCE(sum(s.quantity),0) INTO v_reserved FROM v2.run_inventory_staged_supplies s
    JOIN v2.runs r ON r.facility_id=s.facility_id AND r.id=s.run_id
    WHERE s.facility_id=p_facility_id AND s.warehouse_id=v_warehouse
      AND s.actual_product_id=v_actual.id AND r.status<>'completed';
  IF v_balance-v_reserved < p_quantity THEN
    RAISE EXCEPTION 'The selected supply exceeds available unreserved stock' USING ERRCODE='22003';
  END IF;
  v_now:=clock_timestamp();v_id:=gen_random_uuid();
  INSERT INTO v2.run_inventory_staged_supplies(
    facility_id,id,run_id,warehouse_id,planned_product_id,actual_product_id,
    quantity,reason,actor_id,command_id,request_hash,occurred_at
  ) VALUES (p_facility_id,v_id,p_run_id,v_warehouse,v_expected.id,v_actual.id,
    p_quantity,btrim(p_reason),p_actor_id,p_command_id,p_request_hash,v_now);
  v_response:=jsonb_build_object('outcome','staged','replayed',false,'stageId',v_id,
    'runId',p_run_id,'warehouseId',v_warehouse,'plannedProductCode',v_expected.code,
    'actualProductCode',v_actual.code,'quantity',p_quantity::text,'reason',btrim(p_reason),'occurredAt',v_now);
  INSERT INTO v2.command_receipts(facility_id,actor_id,command_id,request_hash,response,created_at)
    VALUES(p_facility_id,p_actor_id,p_command_id,p_request_hash,v_response,v_now);
  RETURN v_response;
END
$$;

-- 0008-inventory-parity.sql: function
CREATE OR REPLACE FUNCTION v2.list_run_inventory_staged_supplies(p_facility_id uuid,p_run_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
BEGIN
  IF p_facility_id IS NULL OR p_run_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM v2.facility_scope WHERE singleton AND facility_id=p_facility_id
  ) THEN RAISE EXCEPTION 'Invalid staged supply scope' USING ERRCODE='42501'; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id',s.id,'runId',s.run_id,'warehouseId',s.warehouse_id,
      'plannedProductId',s.planned_product_id,'plannedProductCode',wanted.code,
      'plannedProductName',wanted.name,'actualProductId',s.actual_product_id,
      'actualProductCode',actual.code,'actualProductName',actual.name,'unit',actual.base_unit,
      'quantity',s.quantity::text,'reason',s.reason,'actorId',s.actor_id,'occurredAt',s.occurred_at,
      'used',COALESCE(r.quantity_used,0)::text,'released',COALESCE(r.quantity_released,0)::text
    ) ORDER BY s.occurred_at,s.id)
    FROM v2.run_inventory_staged_supplies s
    JOIN v2.products wanted ON wanted.facility_id=s.facility_id AND wanted.id=s.planned_product_id
    JOIN v2.products actual ON actual.facility_id=s.facility_id AND actual.id=s.actual_product_id
    LEFT JOIN v2.run_inventory_stage_receipts r ON r.facility_id=s.facility_id AND r.staged_supply_id=s.id
    WHERE s.facility_id=p_facility_id AND s.run_id=p_run_id
  ),'[]'::jsonb);
END
$$;

-- 0008-inventory-parity.sql: function
CREATE OR REPLACE FUNCTION v2.apply_run_inventory_consumption(
  p_facility_id uuid, p_run_id uuid, p_actor_id uuid, p_plan jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_warehouse_id uuid; v_warehouse_name text; v_demand record; v_balance v2.inventory_balances%ROWTYPE;
  v_stage record; v_required numeric; v_staged_used numeric; v_remaining numeric; v_deducted numeric;
  v_available numeric; v_reserved numeric; v_lines jsonb:='[]'::jsonb; v_detail jsonb;
  v_now timestamptz:=clock_timestamp(); v_actual v2.products%ROWTYPE; v_movement uuid;
  v_line jsonb; v_uses jsonb:='[]'::jsonb; v_stage_quantity numeric;
BEGIN
  IF p_facility_id IS NULL OR p_run_id IS NULL OR p_actor_id IS NULL
     OR jsonb_typeof(p_plan) IS DISTINCT FROM 'object'
     OR NOT EXISTS(SELECT 1 FROM v2.facility_scope WHERE singleton AND facility_id=p_facility_id) THEN
    RAISE EXCEPTION 'Invalid run inventory scope' USING ERRCODE='42501';
  END IF;
  BEGIN v_warehouse_id:=(p_plan->'warehouse'->>'id')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'Invalid run inventory warehouse' USING ERRCODE='22023'; END;
  SELECT w.name INTO v_warehouse_name FROM v2.inventory_warehouses w
    WHERE w.facility_id=p_facility_id AND w.id=v_warehouse_id AND w.active
      AND EXISTS(SELECT 1 FROM v2.opening_counts c WHERE c.facility_id=w.facility_id
        AND c.warehouse_id=w.id AND c.status='applied') FOR UPDATE;
  IF v_warehouse_name IS NULL THEN RAISE EXCEPTION 'The run production warehouse is unavailable' USING ERRCODE='55000'; END IF;
  -- Current recorded station progress, never browser state, defines demand.
  FOR v_demand IN
    WITH station_counts AS (
      SELECT station_key, CASE WHEN station_key='sauce' AND progress->>'barrelsMade' ~ '^[0-9]+$'
        THEN (progress->>'barrelsMade')::numeric
        WHEN progress->>'batchesMade' ~ '^[0-9]+$' THEN (progress->>'batchesMade')::numeric
        ELSE 0::numeric END AS quantity
      FROM v2.run_station_progress WHERE facility_id=p_facility_id AND run_id=p_run_id
    ), recipe_demand AS (
      SELECT (i.value->>'productId')::uuid product_id,i.value->>'productCode' product_code,
        i.value->>'productName' product_name,i.value->>'unit' unit,
        sum((i.value->>'quantity')::numeric*s.quantity) required
      FROM jsonb_array_elements(p_plan->'recipes') r(value)
      JOIN station_counts s ON s.station_key=r.value->>'stationKey'
      CROSS JOIN LATERAL jsonb_array_elements(r.value->'ingredients') i(value)
      GROUP BY i.value->>'productId',i.value->>'productCode',i.value->>'productName',i.value->>'unit'
    ), packed AS (
      SELECT COALESCE(max(CASE WHEN progress->>'casesPacked' ~ '^[0-9]+$'
        THEN (progress->>'casesPacked')::numeric ELSE 0::numeric END),0::numeric) quantity
      FROM v2.run_station_progress WHERE facility_id=p_facility_id AND run_id=p_run_id AND station_key='packaging'
    ), packaging AS (
      SELECT (l.value->>'productId')::uuid product_id,l.value->>'productCode' product_code,
        l.value->>'productName' product_name,l.value->>'unit' unit,
        sum((l.value->>'quantity')::numeric*packed.quantity) required
      FROM jsonb_array_elements(p_plan->'packagingPerCase') l(value) CROSS JOIN packed
      GROUP BY l.value->>'productId',l.value->>'productCode',l.value->>'productName',l.value->>'unit'
    ), combined AS (SELECT * FROM recipe_demand UNION ALL SELECT * FROM packaging)
    SELECT product_id,product_code,product_name,unit,sum(required) required
    FROM combined WHERE required>0 GROUP BY product_id,product_code,product_name,unit ORDER BY product_id
  LOOP
    v_required:=v_demand.required; v_uses:='[]'::jsonb;
    FOR v_stage IN
      SELECT s.* FROM v2.run_inventory_staged_supplies s
      WHERE s.facility_id=p_facility_id AND s.run_id=p_run_id
        AND s.planned_product_id=v_demand.product_id
      ORDER BY s.occurred_at,s.id
    LOOP
      v_staged_used:=LEAST(v_required,v_stage.quantity);
      IF v_staged_used>0 THEN
        v_uses:=v_uses||jsonb_build_array(jsonb_build_object(
          'stageId',v_stage.id,'plannedProductId',v_demand.product_id,
          'actualProductId',v_stage.actual_product_id,'quantity',v_staged_used::text));
        v_required:=v_required-v_staged_used;
      END IF;
    END LOOP;
    IF v_required>0 THEN
      v_uses:=v_uses||jsonb_build_array(jsonb_build_object(
        'stageId',NULL,'plannedProductId',v_demand.product_id,
        'actualProductId',v_demand.product_id,'quantity',v_required::text));
    END IF;
    FOR v_line IN SELECT value FROM jsonb_array_elements(v_uses) LOOP
      SELECT * INTO v_actual FROM v2.products WHERE facility_id=p_facility_id
        AND id=(v_line->>'actualProductId')::uuid AND active FOR SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION 'A staged product is no longer active' USING ERRCODE='40001'; END IF;
      v_required:=(v_line->>'quantity')::numeric;
      INSERT INTO v2.inventory_balances(facility_id,warehouse_id,product_id)
        VALUES(p_facility_id,v_warehouse_id,v_actual.id) ON CONFLICT DO NOTHING;
      SELECT * INTO v_balance FROM v2.inventory_balances WHERE facility_id=p_facility_id
        AND warehouse_id=v_warehouse_id AND product_id=v_actual.id FOR UPDATE;
      SELECT COALESCE(sum(s.quantity),0) INTO v_reserved
      FROM v2.run_inventory_staged_supplies s JOIN v2.runs r
        ON r.facility_id=s.facility_id AND r.id=s.run_id
      WHERE s.facility_id=p_facility_id AND s.warehouse_id=v_warehouse_id
        AND s.actual_product_id=v_actual.id AND r.status<>'completed'
        AND s.run_id<>p_run_id;
      IF (v_line->>'stageId') IS NOT NULL THEN
        SELECT COALESCE(sum(s.quantity-rs.quantity_released),0) INTO v_available
        FROM v2.run_inventory_stage_receipts rs
        JOIN v2.run_inventory_staged_supplies s ON s.facility_id=rs.facility_id AND s.id=rs.staged_supply_id
        WHERE rs.facility_id=p_facility_id AND s.run_id=p_run_id AND s.actual_product_id=v_actual.id;
        -- Staged reservations are owned by this run; allow its accepted amount.
        v_available:=GREATEST(0,v_balance.quantity-v_reserved);
      ELSE
        v_available:=GREATEST(0,v_balance.quantity-v_reserved);
      END IF;
      v_deducted:=LEAST(v_required,v_available);
      IF (v_line->>'stageId') IS NOT NULL THEN
        SELECT quantity INTO STRICT v_stage_quantity FROM v2.run_inventory_staged_supplies
          WHERE facility_id=p_facility_id AND id=(v_line->>'stageId')::uuid;
        INSERT INTO v2.run_inventory_stage_receipts(
          facility_id,staged_supply_id,actual_product_id,quantity_used,quantity_released,completed_at
        ) VALUES(p_facility_id,(v_line->>'stageId')::uuid,v_actual.id,v_deducted,
          v_stage_quantity-v_deducted,v_now);
      END IF;
      IF v_deducted>0 THEN
        IF v_balance.revision>=9007199254740991 THEN RAISE EXCEPTION 'Inventory revision is exhausted' USING ERRCODE='22003'; END IF;
        UPDATE v2.inventory_balances SET quantity=quantity-v_deducted,revision=revision+1,updated_at=v_now
        WHERE facility_id=p_facility_id AND warehouse_id=v_warehouse_id AND product_id=v_actual.id;
        v_movement:=gen_random_uuid();
        INSERT INTO v2.inventory_movements(
          facility_id,warehouse_id,product_id,movement_group_id,movement_type,quantity_delta,
          reason,actor_id,command_id,occurred_at,run_id,planned_product_id
        ) VALUES(p_facility_id,v_warehouse_id,v_actual.id,v_movement,'run_consumption',-v_deducted,
          'Run completion inventory use',p_actor_id,
          'run:'||p_run_id::text||':'||v_demand.product_id::text||':'||v_actual.id::text,
          v_now,p_run_id,v_demand.product_id);
      END IF;
      -- The per-product line below is summarized after all stage substitutions.
      v_lines:=v_lines||jsonb_build_array(jsonb_build_object(
        'productId',v_actual.id,'productCode',v_actual.code,'productName',v_actual.name,
        'unit',v_actual.base_unit,'plannedProductId',v_demand.product_id,
        'plannedProductCode',v_demand.product_code,'required',(v_line->>'quantity'),
        'deducted',v_deducted::text,'shortfall',(v_required-v_deducted)::text,
        'staged',((v_line->>'stageId') IS NOT NULL),'stageId',v_line->'stageId'
      ));
    END LOOP;
  END LOOP;
  FOR v_stage IN
    SELECT s.* FROM v2.run_inventory_staged_supplies s
    WHERE s.facility_id=p_facility_id AND s.run_id=p_run_id
      AND NOT EXISTS (SELECT 1 FROM v2.run_inventory_stage_receipts r
        WHERE r.facility_id=s.facility_id AND r.staged_supply_id=s.id)
    ORDER BY s.occurred_at,s.id
  LOOP
    INSERT INTO v2.run_inventory_stage_receipts(
      facility_id,staged_supply_id,actual_product_id,quantity_used,quantity_released,completed_at
    ) VALUES(p_facility_id,v_stage.id,v_stage.actual_product_id,0,v_stage.quantity,v_now);
  END LOOP;
  v_detail:=jsonb_build_object('status','completed','runId',p_run_id,
    'warehouseId',v_warehouse_id,'warehouseName',v_warehouse_name,'lines',v_lines,
    'occurredAt',to_char(v_now AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  INSERT INTO v2.run_inventory_consumptions(facility_id,run_id,warehouse_id,actor_id,details,occurred_at)
    VALUES(p_facility_id,p_run_id,v_warehouse_id,p_actor_id,v_detail,v_now);
  RETURN v_detail;
END
$$;

-- 0008-inventory-parity.sql: permissions
REVOKE ALL ON ALL TABLES IN SCHEMA v2 FROM PUBLIC;

-- 0008-inventory-parity.sql: permissions
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA v2 FROM PUBLIC;

-- 0008-production-rule-enforcement.sql: function
CREATE OR REPLACE FUNCTION v2.production_rule_value(p_setup jsonb, p_field text)
RETURNS jsonb LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT CASE
    WHEN p_field = 'casesNeeded' THEN p_setup->'targetCases'
    WHEN p_field IN ('label', 'targetCases', 'productCode', 'productionSetupCode',
      'brand', 'flavor', 'lineSpeed', 'targetDoughballWeight',
      'sauceOzPerPizza', 'dieType') THEN p_setup->p_field
    ELSE NULL
  END
$$;

-- 0008-production-rule-enforcement.sql: function
CREATE OR REPLACE FUNCTION v2.assess_production_rules(
  p_facility_id uuid, p_setup jsonb, p_run_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  r record;
  v_value jsonb;
  v_previous jsonb;
  v_before jsonb;
  v_status text;
  v_result jsonb := '[]'::jsonb;
BEGIN
  SELECT setup_snapshot INTO v_previous FROM v2.runs
  WHERE facility_id = p_facility_id AND id IS DISTINCT FROM p_run_id
    AND started_at IS NOT NULL
    AND (p_run_id IS NULL OR started_at < COALESCE(
      (SELECT started_at FROM v2.runs WHERE facility_id = p_facility_id AND id = p_run_id),
      'infinity'::timestamptz))
  ORDER BY started_at DESC, id DESC LIMIT 1;

  FOR r IN SELECT code, name, data, source_import_id
    FROM v2.setup_production_rule_records
    WHERE facility_id = p_facility_id AND source_import_id IS NOT NULL
      AND data->'enabled' = 'true'::jsonb
    ORDER BY code
  LOOP
    v_value := v2.production_rule_value(p_setup, r.data->>'field');
    v_status := 'unknown';
    IF r.data->>'type' = 'required-field' THEN
      v_status := CASE
        WHEN v_value IS NULL OR v_value = 'null'::jsonb THEN 'unknown'
        WHEN btrim(v_value #>> '{}') = '' THEN 'violated'
        ELSE 'passed' END;
    ELSIF r.data->>'type' = 'numeric-range' AND jsonb_typeof(v_value) = 'number' THEN
      v_status := CASE WHEN
        (jsonb_typeof(r.data->'min') <> 'number' OR (v_value::text)::numeric >= (r.data->>'min')::numeric)
        AND (jsonb_typeof(r.data->'max') <> 'number' OR (v_value::text)::numeric <= (r.data->>'max')::numeric)
        THEN 'passed' ELSE 'violated' END;
    ELSIF r.data->>'type' = 'sequence' THEN
      v_value := v2.production_rule_value(p_setup, r.data->>'attribute');
      v_before := v2.production_rule_value(v_previous, r.data->>'attribute');
      IF v_previous IS NULL THEN
        v_status := 'passed';
      ELSIF v_value IS NOT NULL AND v_value <> 'null'::jsonb
        AND v_before IS NOT NULL AND v_before <> 'null'::jsonb THEN
        v_status := CASE
          WHEN lower(v_before #>> '{}') <> lower(r.data->>'before')
            OR lower(v_value #>> '{}') = lower(r.data->>'after')
          THEN 'passed' ELSE 'violated' END;
      END IF;
    END IF;
    -- Only the bypass conditions in a manager-reviewed import can waive a rule.
    -- Missing values never match a bypass; clients cannot supply an override.
    IF v_status <> 'passed' AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(r.data->'bypass', '[]'::jsonb)) b
      WHERE v2.production_rule_value(p_setup, b->>'field') IS NOT NULL
        AND lower(v2.production_rule_value(p_setup, b->>'field') #>> '{}') = lower(b->>'value')
    ) THEN v_status := 'bypassed'; END IF;
    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'code', r.code, 'name', r.name, 'enforcement', r.data->>'enforcement',
      'status', v_status, 'sourceImportId', r.source_import_id));
  END LOOP;
  RETURN v_result;
END
$$;

-- 0008-production-rule-enforcement.sql: function
CREATE OR REPLACE FUNCTION v2.guard_production_rules()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE v_assessment jsonb;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status <> 'planned' OR NEW.status <> 'running' THEN RETURN NEW; END IF;
  END IF;
  -- Serialize starts within this facility for sequence rules. A table share
  -- lock also prevents a newly inserted rule from appearing between validation
  -- and the immutable command snapshot (row locks alone miss that phantom).
  -- Locks span only the lifecycle transaction, never an auto-track tick.
  PERFORM pg_advisory_xact_lock(hashtextextended('v2-production-rules:' || NEW.facility_id::text, 0));
  LOCK TABLE v2.setup_production_rule_records IN SHARE MODE;
  v_assessment := v2.assess_production_rules(NEW.facility_id, NEW.setup_snapshot, NEW.id);
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_assessment) finding
    WHERE finding->>'enforcement' = 'strict'
      AND finding->>'status' IN ('unknown', 'violated')
  ) THEN
    RAISE EXCEPTION 'Production rules block this action. Review the imported rules and required setup.'
      USING ERRCODE = 'P2001';
  END IF;
  RETURN NEW;
END
$$;

-- 0008-production-rule-enforcement.sql: repeat-safe trigger
DROP TRIGGER IF EXISTS production_rules_before_prepare ON v2.runs;
CREATE TRIGGER production_rules_before_prepare
  BEFORE INSERT ON v2.runs
  FOR EACH ROW EXECUTE FUNCTION v2.guard_production_rules();

-- 0008-production-rule-enforcement.sql: repeat-safe trigger
DROP TRIGGER IF EXISTS production_rules_before_start ON v2.runs;
CREATE TRIGGER production_rules_before_start
  BEFORE UPDATE OF status ON v2.runs
  FOR EACH ROW EXECUTE FUNCTION v2.guard_production_rules();

-- 0008-production-rule-enforcement.sql: permissions
REVOKE ALL ON FUNCTION v2.production_rule_value(jsonb, text) FROM PUBLIC;

-- 0008-production-rule-enforcement.sql: permissions
REVOKE ALL ON FUNCTION v2.assess_production_rules(uuid, jsonb, uuid) FROM PUBLIC;

-- 0008-production-rule-enforcement.sql: permissions
REVOKE ALL ON FUNCTION v2.guard_production_rules() FROM PUBLIC;

-- 0008-production-rule-enforcement.sql: permissions
REVOKE ALL ON FUNCTION v2.run_snapshot(uuid, uuid) FROM PUBLIC;

-- 0008-qc-workflows.sql: reviewed static role seeds
INSERT INTO v2.roles (name, capabilities, builtin)
VALUES ('qc-operator', '["record-qc"]'::jsonb, true)
ON CONFLICT (name) DO NOTHING;

-- 0008-qc-workflows.sql: role validation or conditional grants
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM v2.roles
    WHERE name = 'qc-operator'
      AND capabilities = '["record-qc"]'::jsonb
      AND builtin = true
  ) THEN
    RAISE EXCEPTION 'V2 QC operator role conflicts with the approved capability boundary';
  END IF;
END
$$;

-- 0008-qc-workflows.sql: function
CREATE OR REPLACE FUNCTION v2.prevent_qc_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, v2
AS $$
BEGIN
  RAISE EXCEPTION 'QC evidence is append-only'
    USING ERRCODE = '55000';
END
$$;

-- 0008-qc-workflows.sql: repeat-safe trigger
DROP TRIGGER IF EXISTS qc_events_append_only ON v2.qc_events;
CREATE TRIGGER qc_events_append_only
  BEFORE UPDATE OR DELETE ON v2.qc_events
  FOR EACH ROW EXECUTE FUNCTION v2.prevent_qc_event_mutation();

-- 0008-qc-workflows.sql: function
CREATE OR REPLACE FUNCTION v2.actor_can_record_qc(p_actor_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM v2.staff_accounts AS u
    JOIN v2.user_roles AS ur ON ur.user_id = u.id
    JOIN v2.roles AS r ON r.name = ur.role_name
    WHERE u.id = p_actor_id
      AND u.disabled = false
      AND (r.capabilities ? 'record-qc' OR r.capabilities ? 'manage-qc')
  )
$$;

-- 0008-qc-workflows.sql: function
CREATE OR REPLACE FUNCTION v2.actor_can_manage_qc(p_actor_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM v2.staff_accounts AS u
    JOIN v2.user_roles AS ur ON ur.user_id = u.id
    JOIN v2.roles AS r ON r.name = ur.role_name
    WHERE u.id = p_actor_id
      AND u.disabled = false
      AND r.capabilities ? 'manage-qc'
  )
$$;

-- 0008-qc-workflows.sql: function
CREATE OR REPLACE FUNCTION v2.record_qc_event(
  p_facility_id uuid,
  p_actor_id uuid,
  p_run_id uuid,
  p_request_id text,
  p_request_hash text,
  p_event_type text,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_existing v2.qc_events%ROWTYPE;
  v_event v2.qc_events%ROWTYPE;
  v_target v2.qc_events%ROWTYPE;
  v_key_count integer;
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM v2.facility_scope
       WHERE singleton AND facility_id = p_facility_id
     )
     OR p_request_id IS NULL OR length(btrim(p_request_id)) NOT BETWEEN 1 AND 200
     OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$'
     OR p_event_type IS NULL
     OR p_event_type NOT IN (
       'lot-recorded', 'weight-check', 'cleaning-recorded', 'cleaning-verified',
       'date-code-observed', 'brix-check', 'qc-setting-reviewed',
       'review-signed-off', 'correction', 'redaction'
     )
     OR p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object'
     OR octet_length(p_payload::text) > 65536
      OR (p_event_type = 'qc-setting-reviewed' AND p_run_id IS NOT NULL)
      OR (p_event_type NOT IN ('qc-setting-reviewed', 'redaction') AND p_run_id IS NULL) THEN
    RAISE EXCEPTION 'Invalid QC event request' USING ERRCODE = '22023';
  END IF;

  IF NOT v2.actor_can_record_qc(p_actor_id) THEN
    RAISE EXCEPTION 'QC recording is not authorized' USING ERRCODE = '42501';
  END IF;
  IF p_event_type IN ('qc-setting-reviewed', 'review-signed-off', 'redaction')
     AND NOT v2.actor_can_manage_qc(p_actor_id) THEN
    RAISE EXCEPTION 'QC management is not authorized' USING ERRCODE = '42501';
  END IF;
  IF p_run_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM v2.runs WHERE facility_id = p_facility_id AND id = p_run_id
  ) THEN
    RAISE EXCEPTION 'QC run is unavailable' USING ERRCODE = 'P0002';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_facility_id::text || ':' || p_actor_id::text || ':qc:' || p_request_id, 0
  ));
  SELECT * INTO v_existing
  FROM v2.qc_events
  WHERE facility_id = p_facility_id
    AND actor_id = p_actor_id
    AND request_id = p_request_id;
  IF FOUND THEN
    IF v_existing.request_hash <> p_request_hash
       OR v_existing.run_id IS DISTINCT FROM p_run_id
       OR v_existing.event_type <> p_event_type THEN
      RAISE EXCEPTION 'QC request ID was reused with different details'
        USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object(
      'event', jsonb_build_object(
        'id', v_existing.id,
        'runId', v_existing.run_id,
        'actorId', v_existing.actor_id,
        'eventType', v_existing.event_type,
        'payload', v_existing.payload,
        'occurredAt', v_existing.occurred_at
      ),
      'replayed', true
    );
  END IF;

  IF p_event_type = 'cleaning-verified' THEN
    SELECT count(*) INTO v_key_count FROM jsonb_object_keys(p_payload);
    IF p_payload ? 'verifierId' OR v_key_count <> 1
       OR coalesce(p_payload->>'targetEventId', '') !~*
         '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'Cleaning verification must reference one existing record'
        USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_target
    FROM v2.qc_events
    WHERE facility_id = p_facility_id
      AND id = (p_payload->>'targetEventId')::uuid
      AND run_id = p_run_id
      AND event_type = 'cleaning-recorded';
    IF NOT FOUND OR v_target.actor_id = p_actor_id THEN
      RAISE EXCEPTION 'A different authenticated QC staff member must verify cleaning'
        USING ERRCODE = '42501';
    END IF;
    IF EXISTS (
      SELECT 1 FROM v2.qc_events AS redaction
      WHERE redaction.facility_id = p_facility_id
        AND redaction.event_type = 'redaction'
        AND redaction.payload->>'targetEventId' = v_target.id::text
    ) THEN
      RAISE EXCEPTION 'The cleaning record is no longer available for verification'
        USING ERRCODE = '55000';
    END IF;
  ELSIF p_event_type IN ('correction', 'redaction') THEN
    IF coalesce(p_payload->>'targetEventId', '') !~*
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR length(btrim(coalesce(p_payload->>'reason', ''))) NOT BETWEEN 3 AND 500 THEN
      RAISE EXCEPTION 'QC correction or redaction requires a target and reason'
        USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_target
    FROM v2.qc_events
    WHERE facility_id = p_facility_id
      AND id = (p_payload->>'targetEventId')::uuid
      AND run_id IS NOT DISTINCT FROM p_run_id
      AND event_type NOT IN ('correction', 'redaction', 'review-signed-off');
    IF NOT FOUND THEN
      RAISE EXCEPTION 'QC evidence is unavailable for correction'
        USING ERRCODE = 'P0002';
    END IF;
    IF p_event_type = 'redaction' AND EXISTS (
      SELECT 1 FROM v2.qc_events AS prior
      WHERE prior.facility_id = p_facility_id
        AND prior.event_type = 'redaction'
        AND prior.payload->>'targetEventId' = v_target.id::text
    ) THEN
      RAISE EXCEPTION 'QC evidence has already been redacted'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  INSERT INTO v2.qc_events (
    facility_id, run_id, actor_id, request_id, request_hash, event_type, payload
  ) VALUES (
    p_facility_id, p_run_id, p_actor_id, p_request_id, p_request_hash,
    p_event_type, p_payload
  )
  RETURNING * INTO v_event;

  RETURN jsonb_build_object(
    'event', jsonb_build_object(
      'id', v_event.id,
      'runId', v_event.run_id,
      'actorId', v_event.actor_id,
      'eventType', v_event.event_type,
      'payload', v_event.payload,
      'occurredAt', v_event.occurred_at
    ),
    'replayed', false
  );
END
$$;

-- 0008-qc-workflows.sql: function
CREATE OR REPLACE FUNCTION v2.list_qc_events(
  p_facility_id uuid,
  p_actor_id uuid,
  p_run_id uuid,
  p_limit integer
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM v2.facility_scope
       WHERE singleton AND facility_id = p_facility_id
     )
     OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 10001 THEN
    RAISE EXCEPTION 'Invalid QC history request' USING ERRCODE = '22023';
  END IF;
  IF NOT v2.actor_can_record_qc(p_actor_id) THEN
    RAISE EXCEPTION 'QC history is not authorized' USING ERRCODE = '42501';
  END IF;
  IF p_run_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM v2.runs WHERE facility_id = p_facility_id AND id = p_run_id
  ) THEN
    RAISE EXCEPTION 'QC run is unavailable' USING ERRCODE = 'P0002';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', event.id,
      'runId', event.run_id,
      'actorId', event.actor_id,
      'eventType', event.event_type,
      'payload', CASE
        WHEN EXISTS (
          SELECT 1 FROM v2.qc_events AS redaction
          WHERE redaction.facility_id = event.facility_id
            AND redaction.event_type = 'redaction'
            AND redaction.payload->>'targetEventId' = event.id::text
        ) THEN jsonb_build_object('redacted', true)
        ELSE event.payload
      END,
      'occurredAt', event.occurred_at
    ) ORDER BY event.occurred_at DESC, event.id DESC)
    FROM (
      SELECT * FROM v2.qc_events AS event
      WHERE event.facility_id = p_facility_id
        AND (p_run_id IS NULL OR event.run_id = p_run_id)
      ORDER BY event.occurred_at DESC, event.id DESC
      LIMIT p_limit
    ) AS event
  ), '[]'::jsonb);
END
$$;

-- 0008-qc-workflows.sql: function
CREATE OR REPLACE FUNCTION v2.list_qc_settings(
  p_facility_id uuid,
  p_actor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM v2.facility_scope
       WHERE singleton AND facility_id = p_facility_id
     ) THEN
    RAISE EXCEPTION 'Invalid QC settings request' USING ERRCODE = '22023';
  END IF;
  IF NOT v2.actor_can_record_qc(p_actor_id) THEN
    RAISE EXCEPTION 'QC settings are not authorized' USING ERRCODE = '42501';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', latest.id,
      'actorId', latest.actor_id,
      'settingKey', latest.payload->>'settingKey',
      'settingType', latest.payload->>'settingType',
      'subjectCode', latest.payload->>'subjectCode',
      'stationKey', latest.payload->>'stationKey',
      'target', latest.payload->'target',
      'tolerance', latest.payload->'tolerance',
      'unit', latest.payload->>'unit',
      'sourceReference', latest.payload->>'sourceReference',
      'occurredAt', latest.occurred_at
    ) ORDER BY latest.payload->>'settingKey')
    FROM (
      SELECT DISTINCT ON (event.payload->>'settingKey') event.*
      FROM v2.qc_events AS event
      WHERE event.facility_id = p_facility_id
        AND event.event_type = 'qc-setting-reviewed'
      ORDER BY event.payload->>'settingKey', event.occurred_at DESC, event.id DESC
      LIMIT 1000
    ) AS latest
    WHERE NOT EXISTS (
      SELECT 1 FROM v2.qc_events AS redaction
      WHERE redaction.facility_id = latest.facility_id
        AND redaction.event_type = 'redaction'
        AND redaction.payload->>'targetEventId' = latest.id::text
    )
  ), '[]'::jsonb);
END
$$;

-- 0008-qc-workflows.sql: function
CREATE OR REPLACE FUNCTION v2.get_qc_review_state(
  p_facility_id uuid,
  p_actor_id uuid,
  p_run_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_signoff v2.qc_events%ROWTYPE;
  v_latest_evidence v2.qc_events%ROWTYPE;
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL OR p_run_id IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM v2.facility_scope
       WHERE singleton AND facility_id = p_facility_id
     )
     OR NOT EXISTS (
       SELECT 1 FROM v2.runs WHERE facility_id = p_facility_id AND id = p_run_id
     ) THEN
    RAISE EXCEPTION 'Invalid QC review request' USING ERRCODE = '22023';
  END IF;
  IF NOT v2.actor_can_record_qc(p_actor_id) THEN
    RAISE EXCEPTION 'QC review is not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_signoff
  FROM v2.qc_events
  WHERE facility_id = p_facility_id
    AND run_id = p_run_id
    AND event_type = 'review-signed-off'
  ORDER BY occurred_at DESC, id DESC
  LIMIT 1;
  SELECT * INTO v_latest_evidence
  FROM v2.qc_events
  WHERE facility_id = p_facility_id
    AND run_id = p_run_id
    AND event_type NOT IN ('review-signed-off', 'redaction')
  ORDER BY occurred_at DESC, id DESC
  LIMIT 1;

  RETURN jsonb_build_object(
    'status', CASE WHEN v_signoff.id IS NOT NULL
        AND (v_latest_evidence.id IS NULL
          OR (v_signoff.occurred_at, v_signoff.id) >= (v_latest_evidence.occurred_at, v_latest_evidence.id))
      THEN 'signed-off'
      ELSE 'needs-review'
    END,
    'signedOffAt', v_signoff.occurred_at,
    'signedOffBy', v_signoff.actor_id
  );
END
$$;

-- 0008-qc-workflows.sql: permissions
REVOKE ALL ON TABLE v2.qc_events FROM PUBLIC;

-- 0008-qc-workflows.sql: permissions
REVOKE ALL ON FUNCTION v2.prevent_qc_event_mutation() FROM PUBLIC;

-- 0008-qc-workflows.sql: permissions
REVOKE ALL ON FUNCTION v2.actor_can_record_qc(uuid) FROM PUBLIC;

-- 0008-qc-workflows.sql: permissions
REVOKE ALL ON FUNCTION v2.actor_can_manage_qc(uuid) FROM PUBLIC;

-- 0008-qc-workflows.sql: permissions
REVOKE ALL ON FUNCTION v2.record_qc_event(uuid, uuid, uuid, text, text, text, jsonb) FROM PUBLIC;

-- 0008-qc-workflows.sql: permissions
REVOKE ALL ON FUNCTION v2.list_qc_events(uuid, uuid, uuid, integer) FROM PUBLIC;

-- 0008-qc-workflows.sql: permissions
REVOKE ALL ON FUNCTION v2.list_qc_settings(uuid, uuid) FROM PUBLIC;

-- 0008-qc-workflows.sql: permissions
REVOKE ALL ON FUNCTION v2.get_qc_review_state(uuid, uuid, uuid) FROM PUBLIC;

-- 0008-qc-workflows.sql: function comment
COMMENT ON FUNCTION v2.record_qc_event(uuid, uuid, uuid, text, text, text, jsonb) IS
  'Appends authenticated QC evidence; validates separate-person cleaning verification and audited correction/redaction references.';

-- 0008-reviewed-die-defaults.sql: repeat-safe trigger
DROP TRIGGER IF EXISTS die_default_events_append_only ON v2.die_default_events;
CREATE TRIGGER die_default_events_append_only
  BEFORE UPDATE OR DELETE ON v2.die_default_events
  FOR EACH ROW EXECUTE FUNCTION v2.reject_immutable_row_mutation();

-- 0008-reviewed-die-defaults.sql: function
CREATE OR REPLACE FUNCTION v2.list_die_defaults(p_facility_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
BEGIN
  IF p_facility_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM v2.facility_scope WHERE singleton AND facility_id = p_facility_id
  ) THEN
    RAISE EXCEPTION 'Invalid facility scope' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'code', die.code,
      'name', die.name,
      'status', CASE
        WHEN reviewed.die_code IS NULL THEN 'unreviewed'
        WHEN reviewed.enabled THEN 'active'
        ELSE 'disabled'
      END,
      'revision', COALESCE(reviewed.revision, 0),
      'defaults', CASE WHEN reviewed.die_code IS NULL THEN NULL ELSE reviewed.data END,
      'suggestedDefaults', CASE WHEN imported.code IS NULL THEN NULL ELSE jsonb_build_object(
        'crustsPerCycle', imported.data->'crusts_per_cycle',
        'cycleSpeed', imported.data->'cycle_speed',
        'speedAdjustment', imported.data->'speed_adjustment',
        'freezerTime', imported.data->'freezer_time',
        'casesPerLayer', imported.data->'cases_per_layer',
        'preTunnelMin', imported.data->'pre_tunnel_min',
        'postTunnelMin', imported.data->'post_tunnel_min',
        'pressOvenMin', imported.data->'press_oven_min',
        'frontlineMin', imported.data->'frontline_min'
      ) END
    ) ORDER BY lower(die.name), die.code)
    FROM v2.setup_die_type_records AS die
    LEFT JOIN v2.setup_die_default_records AS imported
      ON imported.facility_id = die.facility_id AND lower(imported.code) = lower(die.code)
    LEFT JOIN v2.die_default_settings AS reviewed
      ON reviewed.facility_id = die.facility_id AND lower(reviewed.die_code) = lower(die.code)
    WHERE die.facility_id = p_facility_id
  ), '[]'::jsonb);
END
$$;

-- 0008-reviewed-die-defaults.sql: function
CREATE OR REPLACE FUNCTION v2.list_die_default_events(p_facility_id uuid, p_limit integer)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
BEGIN
  IF p_facility_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM v2.facility_scope WHERE singleton AND facility_id = p_facility_id
  ) THEN
    RAISE EXCEPTION 'Invalid facility scope' USING ERRCODE = '42501';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Invalid die default history request' USING ERRCODE = '22023';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', recent.id, 'dieCode', recent.die_code, 'actorId', recent.actor_id,
      'action', recent.action, 'revision', recent.revision,
      'before', recent.before_state, 'after', recent.after_state,
      'occurredAt', recent.occurred_at
    ) ORDER BY recent.occurred_at DESC, recent.id DESC)
    FROM (
      SELECT id, die_code, actor_id, action, revision, before_state, after_state, occurred_at
      FROM v2.die_default_events
      WHERE facility_id = p_facility_id
      ORDER BY occurred_at DESC, id DESC
      LIMIT p_limit
    ) AS recent
  ), '[]'::jsonb);
END
$$;

-- 0008-reviewed-die-defaults.sql: function
CREATE OR REPLACE FUNCTION v2.save_die_default(
  p_facility_id uuid,
  p_actor_id uuid,
  p_request_id text,
  p_request_hash text,
  p_die_code text,
  p_expected_revision bigint,
  p_data jsonb,
  p_enabled boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_existing_event v2.die_default_events%ROWTYPE;
  v_existing v2.die_default_settings%ROWTYPE;
  v_die_code text;
  v_revision bigint;
  v_action text;
  v_before jsonb;
  v_after jsonb;
  v_result jsonb;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL OR p_die_code IS NULL
     OR p_expected_revision IS NULL OR p_expected_revision < 0
     OR p_request_id IS NULL OR length(btrim(p_request_id)) NOT BETWEEN 1 AND 200
     OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$'
     OR p_enabled IS NULL
     OR NOT EXISTS (SELECT 1 FROM v2.facility_scope WHERE singleton AND facility_id = p_facility_id)
     OR jsonb_typeof(p_data) <> 'object'
     OR v2.setup_catalog_object_size(p_data) <> 9
     OR NOT (p_data ?& ARRAY[
       'crustsPerCycle','cycleSpeed','speedAdjustment','freezerTime','casesPerLayer',
       'preTunnelMin','postTunnelMin','pressOvenMin','frontlineMin'
     ])
     OR EXISTS (
       SELECT 1 FROM jsonb_object_keys(p_data) AS item(key)
       WHERE item.key <> ALL (ARRAY[
         'crustsPerCycle','cycleSpeed','speedAdjustment','freezerTime','casesPerLayer',
         'preTunnelMin','postTunnelMin','pressOvenMin','frontlineMin'
       ])
     )
     OR jsonb_typeof(p_data->'crustsPerCycle') <> 'number'
     OR jsonb_typeof(p_data->'cycleSpeed') <> 'number'
     OR jsonb_typeof(p_data->'speedAdjustment') <> 'number'
     OR jsonb_typeof(p_data->'freezerTime') <> 'number'
     OR jsonb_typeof(p_data->'casesPerLayer') <> 'number'
     OR jsonb_typeof(p_data->'preTunnelMin') NOT IN ('number','null')
     OR jsonb_typeof(p_data->'postTunnelMin') NOT IN ('number','null')
     OR jsonb_typeof(p_data->'pressOvenMin') NOT IN ('number','null')
     OR jsonb_typeof(p_data->'frontlineMin') NOT IN ('number','null')
     OR (p_data->>'crustsPerCycle')::numeric NOT BETWEEN 0 AND 100000
     OR (p_data->>'cycleSpeed')::numeric NOT BETWEEN 0 AND 100000
     OR (p_data->>'speedAdjustment')::numeric NOT BETWEEN 0 AND 100000
     OR (p_data->>'freezerTime')::numeric NOT BETWEEN 0 AND 100000
     OR (p_data->>'casesPerLayer')::numeric NOT BETWEEN 0 AND 100000
     OR (p_data->>'preTunnelMin' IS NOT NULL AND (p_data->>'preTunnelMin')::numeric NOT BETWEEN 0 AND 100000)
     OR (p_data->>'postTunnelMin' IS NOT NULL AND (p_data->>'postTunnelMin')::numeric NOT BETWEEN 0 AND 100000)
     OR (p_data->>'pressOvenMin' IS NOT NULL AND (p_data->>'pressOvenMin')::numeric NOT BETWEEN 0 AND 100000)
     OR (p_data->>'frontlineMin' IS NOT NULL AND (p_data->>'frontlineMin')::numeric NOT BETWEEN 0 AND 100000) THEN
    RAISE EXCEPTION 'Invalid die default request' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_facility_id::text || ':die-default:' || lower(p_die_code), 0
  ));
  SELECT * INTO v_existing_event FROM v2.die_default_events
  WHERE facility_id = p_facility_id AND actor_id = p_actor_id AND request_id = p_request_id
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing_event.request_hash <> p_request_hash OR v_existing_event.die_code <> p_die_code THEN
      RAISE EXCEPTION 'Die default request ID was reused with different details' USING ERRCODE = '22023';
    END IF;
    RETURN v_existing_event.result || jsonb_build_object('replayed', true);
  END IF;
  SELECT code INTO v_die_code FROM v2.setup_die_type_records
  WHERE facility_id = p_facility_id AND lower(code) = lower(p_die_code)
  FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Die type is not available' USING ERRCODE = '23503'; END IF;

  SELECT * INTO v_existing FROM v2.die_default_settings
  WHERE facility_id = p_facility_id AND lower(die_code) = lower(v_die_code)
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.revision <> p_expected_revision THEN
      RAISE EXCEPTION 'Die defaults changed while being edited' USING ERRCODE = '40001';
    END IF;
    v_revision := v_existing.revision + 1;
    v_before := jsonb_build_object(
      'defaults', v_existing.data, 'enabled', v_existing.enabled, 'revision', v_existing.revision
    );
    v_action := CASE
      WHEN v_existing.enabled AND NOT p_enabled THEN 'retired'
      WHEN NOT v_existing.enabled AND p_enabled THEN 're-enabled'
      ELSE 'updated'
    END;
    UPDATE v2.die_default_settings
    SET data = p_data, enabled = p_enabled, revision = v_revision,
        updated_by = p_actor_id, updated_at = v_now
    WHERE facility_id = p_facility_id AND die_code = v_existing.die_code;
  ELSE
    IF p_expected_revision <> 0 THEN
      RAISE EXCEPTION 'Die defaults changed while being edited' USING ERRCODE = '40001';
    END IF;
    v_revision := 1;
    v_action := 'created';
    INSERT INTO v2.die_default_settings (
      facility_id, die_code, data, enabled, revision, created_by, updated_by, created_at, updated_at
    ) VALUES (
      p_facility_id, v_die_code, p_data, p_enabled, v_revision, p_actor_id, p_actor_id, v_now, v_now
    );
  END IF;
  v_after := jsonb_build_object('defaults', p_data, 'enabled', p_enabled, 'revision', v_revision);
  v_result := jsonb_build_object(
    'outcome', v_action, 'dieCode', v_die_code, 'revision', v_revision,
    'status', CASE WHEN p_enabled THEN 'active' ELSE 'disabled' END,
    'defaults', p_data, 'replayed', false
  );
  INSERT INTO v2.die_default_events (
    facility_id, die_code, actor_id, request_id, request_hash, action,
    revision, before_state, after_state, result, occurred_at
  ) VALUES (
    p_facility_id, v_die_code, p_actor_id, p_request_id, p_request_hash,
    v_action, v_revision, v_before, v_after, v_result, v_now
  );
  RETURN v_result;
END
$$;

-- 0008-reviewed-die-defaults.sql: function
CREATE OR REPLACE FUNCTION v2.list_run_products(p_facility_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_warehouse jsonb;
  v_products jsonb;
BEGIN
  IF p_facility_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM v2.facility_scope
    WHERE singleton AND facility_id = p_facility_id
  ) THEN
    RAISE EXCEPTION 'Invalid facility scope' USING ERRCODE = '42501';
  END IF;
  SELECT jsonb_build_object('id', w.id, 'name', w.name)
    INTO v_warehouse
    FROM v2.inventory_warehouses AS w
    WHERE w.facility_id = p_facility_id
      AND w.active
      AND w.is_production
      AND EXISTS (
        SELECT 1 FROM v2.opening_counts AS c
        WHERE c.facility_id = w.facility_id
          AND c.warehouse_id = w.id
          AND c.status = 'applied'
      );
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'code', p.code,
    'name', p.name,
    'doughCapacity', v2.dough_capacity_snapshot(p_facility_id, p.code),
    'productionSetups', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'code', s.code,
        'name', s.name,
        'hasDoughRecipe', EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(s.data->'recipe_codes') AS requested(code)
          JOIN v2.master_records AS r
            ON r.facility_id = p_facility_id AND r.kind = 'recipes'
            AND lower(r.code) = lower(requested.code)
            AND lower(r.product_code) = lower(p.code)
          WHERE r.data->>'station_key' = 'dough'
        )
      ) ORDER BY lower(s.name), s.code)
      FROM v2.master_records AS s
      WHERE s.facility_id = p_facility_id
        AND s.kind = 'production-setups'
        AND lower(s.product_code) = lower(p.code)
        AND s.data->>'sourceFamily' IS NULL
        AND jsonb_typeof(s.data->'recipe_codes') = 'array'
        AND jsonb_typeof(s.data->'packaging_per_case') = 'array'
    ), '[]'::jsonb)
  ) ORDER BY lower(p.name), p.code), '[]'::jsonb)
    INTO v_products
    FROM v2.products AS p
    WHERE p.facility_id = p_facility_id AND p.active;
  RETURN jsonb_build_object(
    'productionWarehouse', v_warehouse,
    'products', v_products,
    'dieTypes', v2.list_die_defaults(p_facility_id)
  );
END
$$;

-- 0008-reviewed-die-defaults.sql: function
CREATE OR REPLACE FUNCTION v2.create_planned_run(
  p_facility_id uuid,
  p_actor_id uuid,
  p_request_id text,
  p_request_hash text,
  p_setup_snapshot jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_existing_hash text;
  v_existing_response jsonb;
  v_run_id uuid;
  v_now timestamptz;
  v_setup jsonb;
  v_response jsonb;
  v_product v2.products%ROWTYPE;
  v_setup_record v2.master_records%ROWTYPE;
  v_warehouse v2.inventory_warehouses%ROWTYPE;
  v_plan jsonb;
  v_recipes jsonb;
  v_die_code text;
  v_die_name text;
  v_die_status text;
  v_die_revision bigint;
  v_die_defaults v2.die_default_settings%ROWTYPE;
  v_line_settings jsonb;
  v_has_dough boolean;
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL
     OR p_request_id IS NULL OR length(btrim(p_request_id)) = 0
     OR length(p_request_id) > 200
     OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$'
     OR p_setup_snapshot IS NULL OR jsonb_typeof(p_setup_snapshot) <> 'object'
     OR (p_setup_snapshot - ARRAY[
       'label', 'targetCases', 'productCode', 'productionSetupCode', 'dieSetup'
     ]) <> '{}'::jsonb
     OR jsonb_typeof(p_setup_snapshot->'label') IS DISTINCT FROM 'string'
     OR jsonb_typeof(p_setup_snapshot->'targetCases') IS DISTINCT FROM 'number'
     OR jsonb_typeof(p_setup_snapshot->'productCode') IS DISTINCT FROM 'string'
     OR p_setup_snapshot->>'productCode' !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$'
     OR jsonb_typeof(p_setup_snapshot->'productionSetupCode') IS DISTINCT FROM 'string'
     OR p_setup_snapshot->>'productionSetupCode' !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$'
     OR (p_setup_snapshot ? 'dieSetup' AND (
       jsonb_typeof(p_setup_snapshot->'dieSetup') IS DISTINCT FROM 'object'
       OR ((p_setup_snapshot->'dieSetup') - ARRAY[
         'dieTypeCode', 'expectedRevision', 'lineSettings'
       ]) <> '{}'::jsonb
       OR jsonb_typeof(p_setup_snapshot->'dieSetup'->'dieTypeCode') IS DISTINCT FROM 'string'
       OR p_setup_snapshot->'dieSetup'->>'dieTypeCode' !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$'
       OR jsonb_typeof(p_setup_snapshot->'dieSetup'->'expectedRevision') IS DISTINCT FROM 'number'
       OR (p_setup_snapshot->'dieSetup'->>'expectedRevision') !~ '^(0|[1-9][0-9]{0,17})$'
       OR jsonb_typeof(p_setup_snapshot->'dieSetup'->'lineSettings') IS DISTINCT FROM 'object'
       OR v2.setup_catalog_object_size(p_setup_snapshot->'dieSetup'->'lineSettings') <> 9
       OR NOT ((p_setup_snapshot->'dieSetup'->'lineSettings') ?& ARRAY[
         'crustsPerCycle','cycleSpeed','speedAdjustment','freezerTime','casesPerLayer',
         'preTunnelMin','postTunnelMin','pressOvenMin','frontlineMin'
       ])
       OR EXISTS (
         SELECT 1 FROM jsonb_object_keys(p_setup_snapshot->'dieSetup'->'lineSettings') AS item(key)
         WHERE item.key <> ALL (ARRAY[
           'crustsPerCycle','cycleSpeed','speedAdjustment','freezerTime','casesPerLayer',
           'preTunnelMin','postTunnelMin','pressOvenMin','frontlineMin'
         ])
       )
       OR EXISTS (
         SELECT 1
         FROM jsonb_each(p_setup_snapshot->'dieSetup'->'lineSettings') AS item(key, value)
         WHERE jsonb_typeof(item.value) NOT IN ('number','null')
           OR (jsonb_typeof(item.value) = 'number' AND (item.value #>> '{}')::numeric NOT BETWEEN 0 AND 100000)
       )
     )) THEN
    RAISE EXCEPTION 'Invalid run creation request' USING ERRCODE = '22023';
  END IF;
  IF length(btrim(p_setup_snapshot->>'label')) NOT BETWEEN 1 AND 120
     OR (p_setup_snapshot->>'targetCases') !~ '^[1-9][0-9]*$'
     OR (p_setup_snapshot->>'targetCases')::numeric > 9007199254740991 THEN
    RAISE EXCEPTION 'Invalid run setup snapshot' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_facility_id::text || ':' || p_actor_id::text || ':' || p_request_id, 0)
  );
  SELECT request_hash, response INTO v_existing_hash, v_existing_response
    FROM v2.command_receipts
    WHERE facility_id = p_facility_id AND actor_id = p_actor_id AND command_id = p_request_id;
  IF FOUND THEN
    IF v_existing_hash <> p_request_hash THEN
      RAISE EXCEPTION 'Run creation request ID was reused with different details'
        USING ERRCODE = '22023';
    END IF;
    RETURN v_existing_response || jsonb_build_object('replayed', true);
  END IF;

  SELECT * INTO v_product
    FROM v2.products
    WHERE facility_id = p_facility_id
      AND lower(code) = lower(p_setup_snapshot->>'productCode')
      AND active
    FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'The selected product is not active' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_setup_record
    FROM v2.master_records
    WHERE facility_id = p_facility_id
      AND kind = 'production-setups'
      AND lower(product_code) = lower(v_product.code)
      AND lower(code) = lower(p_setup_snapshot->>'productionSetupCode')
      AND data->>'sourceFamily' IS NULL
      AND jsonb_typeof(data->'recipe_codes') = 'array'
      AND jsonb_typeof(data->'packaging_per_case') = 'array'
    FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The selected production setup is not available for this product'
      USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_warehouse
    FROM v2.inventory_warehouses AS w
    WHERE w.facility_id = p_facility_id AND w.active AND w.is_production
      AND EXISTS (
        SELECT 1 FROM v2.opening_counts AS c
        WHERE c.facility_id = w.facility_id AND c.warehouse_id = w.id AND c.status = 'applied'
      )
    FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'An active production warehouse with an applied opening count is required'
      USING ERRCODE = '55000';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(v_setup_record.data->'recipe_codes') AS requested(code)
    JOIN v2.master_records AS r
      ON r.facility_id = p_facility_id AND r.kind = 'recipes'
      AND lower(r.code) = lower(requested.code)
      AND lower(r.product_code) = lower(v_product.code)
    WHERE r.data->>'station_key' = 'dough'
  ) INTO v_has_dough;

  SELECT jsonb_agg(jsonb_build_object(
    'code', r.code,
    'name', r.name,
    'stationKey', r.data->>'station_key',
    'ingredients', (
      SELECT jsonb_agg(jsonb_build_object(
        'productId', ingredient_product.id,
        'productCode', ingredient_product.code,
        'productName', ingredient_product.name,
        'quantity', ingredient.value->>'quantity',
        'unit', ingredient.value->>'unit'
      ) ORDER BY ingredient.ordinality)
      FROM jsonb_array_elements(r.data->'ingredients') WITH ORDINALITY AS ingredient(value, ordinality)
      JOIN v2.products AS ingredient_product
        ON ingredient_product.facility_id = p_facility_id
        AND lower(ingredient_product.code) = lower(ingredient.value->>'product_code')
        AND ingredient_product.active
    )
  ) ORDER BY requested.ordinality)
    INTO v_recipes
    FROM jsonb_array_elements_text(v_setup_record.data->'recipe_codes')
      WITH ORDINALITY AS requested(code, ordinality)
    JOIN v2.master_records AS r
      ON r.facility_id = p_facility_id AND r.kind = 'recipes'
      AND lower(r.code) = lower(requested.code)
      AND lower(r.product_code) = lower(v_product.code);
  IF jsonb_array_length(COALESCE(v_recipes, '[]'::jsonb))
       <> jsonb_array_length(v_setup_record.data->'recipe_codes') THEN
    RAISE EXCEPTION 'The production setup references unavailable recipe inventory lines'
      USING ERRCODE = '22023';
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'productId', packaging_product.id,
    'productCode', packaging_product.code,
    'productName', packaging_product.name,
    'quantity', packaging.value->>'quantity',
    'unit', packaging.value->>'unit'
  ) ORDER BY packaging.ordinality)
    INTO v_plan
    FROM jsonb_array_elements(v_setup_record.data->'packaging_per_case')
      WITH ORDINALITY AS packaging(value, ordinality)
    JOIN v2.products AS packaging_product
      ON packaging_product.facility_id = p_facility_id
      AND lower(packaging_product.code) = lower(packaging.value->>'product_code')
      AND packaging_product.active;
  IF jsonb_array_length(COALESCE(v_plan, '[]'::jsonb))
       <> jsonb_array_length(v_setup_record.data->'packaging_per_case') THEN
    RAISE EXCEPTION 'The production setup references unavailable packaging inventory lines'
      USING ERRCODE = '22023';
  END IF;

  v_plan := jsonb_build_object(
    'code', v_setup_record.code,
    'name', v_setup_record.name,
    'warehouse', jsonb_build_object('id', v_warehouse.id, 'name', v_warehouse.name),
    'recipes', v_recipes,
    'packagingPerCase', v_plan
  );
  v_setup := jsonb_build_object(
    'label', btrim(p_setup_snapshot->>'label'),
    'targetCases', (p_setup_snapshot->>'targetCases')::bigint,
    'productCode', v_product.code,
    'productionSetupCode', v_setup_record.code,
    'productionPlan', v_plan
  );
  IF p_setup_snapshot ? 'dieSetup' THEN
    IF NOT v_has_dough THEN
      RAISE EXCEPTION 'This production setup has no applicable dough die'
        USING ERRCODE = '22023';
    END IF;
    v_die_code := p_setup_snapshot->'dieSetup'->>'dieTypeCode';
    v_die_revision := (p_setup_snapshot->'dieSetup'->>'expectedRevision')::bigint;
    SELECT code, name INTO v_die_code, v_die_name
      FROM v2.setup_die_type_records
      WHERE facility_id = p_facility_id AND lower(code) = lower(v_die_code)
      FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'The selected die type is not available' USING ERRCODE = '23503'; END IF;
    SELECT * INTO v_die_defaults
      FROM v2.die_default_settings
      WHERE facility_id = p_facility_id AND lower(die_code) = lower(v_die_code)
      FOR SHARE;
    IF FOUND THEN
      IF v_die_defaults.revision <> v_die_revision THEN
        RAISE EXCEPTION 'Die defaults changed while this run was being prepared' USING ERRCODE = '40001';
      END IF;
      v_die_status := CASE WHEN v_die_defaults.enabled THEN 'active' ELSE 'disabled' END;
    ELSE
      IF v_die_revision <> 0 THEN
        RAISE EXCEPTION 'Die defaults changed while this run was being prepared' USING ERRCODE = '40001';
      END IF;
      v_die_status := 'unreviewed';
    END IF;
    v_line_settings := p_setup_snapshot->'dieSetup'->'lineSettings';
    v_setup := v_setup || jsonb_build_object('dieSetup', jsonb_build_object(
      'dieTypeCode', v_die_code,
      'dieTypeName', v_die_name,
      'defaultStatus', v_die_status,
      'defaultRevision', v_die_revision,
      'lineSettings', v_line_settings
    ));
  END IF;

  v_now := clock_timestamp();
  v_run_id := gen_random_uuid();
  INSERT INTO v2.runs (
    facility_id, id, status, revision, created_at, updated_at, setup_snapshot
  ) VALUES (
    p_facility_id, v_run_id, 'planned', 0, v_now, v_now, v_setup
  );
  v_response := jsonb_build_object(
    'outcome', 'created', 'replayed', false, 'run', v2.run_snapshot(p_facility_id, v_run_id)
  );
  INSERT INTO v2.run_events (
    facility_id, run_id, revision, actor_id, event_type, occurred_at, payload
  ) VALUES (
    p_facility_id, v_run_id, 0, p_actor_id, 'run.created', v_now, v_response
  );
  INSERT INTO v2.outbox_events (
    event_id, facility_id, run_id, revision, event_type, payload, created_at
  ) VALUES (
    gen_random_uuid(), p_facility_id, v_run_id, 0, 'run.created', v_response, v_now
  );
  INSERT INTO v2.command_receipts (
    facility_id, actor_id, command_id, request_hash, response, created_at
  ) VALUES (
    p_facility_id, p_actor_id, p_request_id, p_request_hash, v_response, v_now
  );
  RETURN v_response;
END
$$;

-- 0008-reviewed-die-defaults.sql: permissions
REVOKE ALL ON TABLE v2.die_default_settings, v2.die_default_events FROM PUBLIC;

-- 0008-reviewed-die-defaults.sql: permissions
REVOKE ALL ON FUNCTION v2.list_die_defaults(uuid) FROM PUBLIC;

-- 0008-reviewed-die-defaults.sql: permissions
REVOKE ALL ON FUNCTION v2.list_die_default_events(uuid, integer) FROM PUBLIC;

-- 0008-reviewed-die-defaults.sql: permissions
REVOKE ALL ON FUNCTION v2.save_die_default(uuid, uuid, text, text, text, bigint, jsonb, boolean) FROM PUBLIC;

-- 0009-production-schedules.sql: function
CREATE OR REPLACE FUNCTION v2.schedule_default_start_time(p_facility_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
  SELECT CASE
    WHEN COALESCE(r.data->>'value', '') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      THEN r.data->>'value'
    ELSE '06:00'
  END
  FROM (SELECT 1) AS fallback
  LEFT JOIN v2.setup_manager_list_records AS r
    ON r.facility_id = p_facility_id
   AND r.code = 'run-calc-production-start-time'
$$;

-- 0009-production-schedules.sql: function
CREATE OR REPLACE FUNCTION v2.validate_production_schedule_runs(p_facility_id uuid, p_runs jsonb)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_run jsonb;
  v_count integer := 0;
BEGIN
  IF jsonb_typeof(p_runs) IS DISTINCT FROM 'array' THEN
    RETURN false;
  END IF;
  IF jsonb_array_length(p_runs) > 100 THEN
    RETURN false;
  END IF;
  FOR v_run IN SELECT value FROM jsonb_array_elements(p_runs) LOOP
    v_count := v_count + 1;
    IF jsonb_typeof(v_run) IS DISTINCT FROM 'object'
       OR v_run - ARRAY['id','productCode','productionSetupCode','runTemplateCode','targetCases','notes'] <> '{}'::jsonb
       OR NOT (v_run ?& ARRAY['id','productCode','productionSetupCode','runTemplateCode','targetCases','notes'])
       OR jsonb_typeof(v_run->'id') IS DISTINCT FROM 'string'
       OR (v_run->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR jsonb_typeof(v_run->'productCode') IS DISTINCT FROM 'string'
       OR (v_run->>'productCode') !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$'
       OR jsonb_typeof(v_run->'productionSetupCode') IS DISTINCT FROM 'string'
       OR (v_run->>'productionSetupCode') !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$'
       OR jsonb_typeof(v_run->'runTemplateCode') IS DISTINCT FROM 'string'
       OR (v_run->>'runTemplateCode') !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$'
       OR jsonb_typeof(v_run->'targetCases') IS DISTINCT FROM 'number'
       OR (v_run->>'targetCases') !~ '^[1-9][0-9]{0,6}$'
       OR jsonb_typeof(v_run->'notes') IS DISTINCT FROM 'string'
       OR length(v_run->>'notes') > 500 THEN
      RETURN false;
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_runs) AS earlier(value)
      WHERE earlier.value->>'id' = v_run->>'id'
        AND earlier.value <> v_run
    ) OR (
      SELECT count(*) FROM jsonb_array_elements(p_runs) AS duplicate(value)
      WHERE duplicate.value->>'id' = v_run->>'id'
    ) <> 1 THEN
      RETURN false;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM v2.products AS p
      WHERE p.facility_id = p_facility_id
        AND lower(p.code) = lower(v_run->>'productCode')
        AND p.active
    ) OR NOT EXISTS (
      SELECT 1 FROM v2.master_records AS s
      WHERE s.facility_id = p_facility_id
        AND s.kind = 'production-setups'
        AND lower(s.code) = lower(v_run->>'productionSetupCode')
        AND lower(s.product_code) = lower(v_run->>'productCode')
        AND s.data->>'sourceFamily' IS NULL
        AND jsonb_typeof(s.data->'recipe_codes') = 'array'
        AND jsonb_typeof(s.data->'packaging_per_case') = 'array'
    ) OR NOT EXISTS (
      SELECT 1 FROM v2.setup_run_template_records AS t
      WHERE t.facility_id = p_facility_id
        AND lower(t.code) = lower(v_run->>'runTemplateCode')
    ) THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN v_count <= 100;
END
$$;

-- 0009-production-schedules.sql: function
CREATE OR REPLACE FUNCTION v2.validate_production_schedule_breaks(p_runs jsonb, p_breaks jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog
AS $$
DECLARE
  v_break jsonb;
  v_slot integer := 0;
BEGIN
  IF jsonb_typeof(p_breaks) IS DISTINCT FROM 'array' THEN
    RETURN false;
  END IF;
  IF jsonb_array_length(p_breaks) <> 3 THEN
    RETURN false;
  END IF;
  FOR v_break IN SELECT value FROM jsonb_array_elements(p_breaks) LOOP
    v_slot := v_slot + 1;
    IF jsonb_typeof(v_break) IS DISTINCT FROM 'object'
       OR v_break - ARRAY['slot','enabled','runId'] <> '{}'::jsonb
       OR NOT (v_break ?& ARRAY['slot','enabled','runId'])
       OR jsonb_typeof(v_break->'slot') IS DISTINCT FROM 'number'
       OR (v_break->>'slot')::integer <> v_slot
       OR jsonb_typeof(v_break->'enabled') IS DISTINCT FROM 'boolean'
       OR NOT (
         v_break->'runId' = 'null'::jsonb
         OR (jsonb_typeof(v_break->'runId') = 'string'
           AND (v_break->>'runId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
           AND EXISTS (
             SELECT 1 FROM jsonb_array_elements(p_runs) AS run(value)
             WHERE run.value->>'id' = v_break->>'runId'
           ))
       ) THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
END
$$;

-- 0009-production-schedules.sql: function
CREATE OR REPLACE FUNCTION v2.get_production_schedule(p_facility_id uuid, p_date date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_schedule v2.production_schedules%ROWTYPE;
BEGIN
  IF p_facility_id IS NULL OR p_date IS NULL
     OR NOT EXISTS (SELECT 1 FROM v2.facility_scope WHERE singleton AND facility_id = p_facility_id) THEN
    RAISE EXCEPTION 'Invalid production schedule scope' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_schedule FROM v2.production_schedules
    WHERE facility_id = p_facility_id AND production_date = p_date;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'date', p_date, 'revision', 0, 'timeZone', 'America/Chicago',
      'productionStartTime', v2.schedule_default_start_time(p_facility_id),
      'runs', '[]'::jsonb,
      'breaks', jsonb_build_array(
        jsonb_build_object('slot',1,'enabled',false,'runId',NULL),
        jsonb_build_object('slot',2,'enabled',false,'runId',NULL),
        jsonb_build_object('slot',3,'enabled',false,'runId',NULL)
      ),
      'updatedAt', NULL
    );
  END IF;
  RETURN jsonb_build_object(
    'date', v_schedule.production_date, 'revision', v_schedule.revision,
    'timeZone', v_schedule.time_zone,
    'productionStartTime', v_schedule.plan->'productionStartTime',
    'runs', v_schedule.plan->'runs', 'breaks', v_schedule.plan->'breaks',
    'updatedAt', v_schedule.updated_at
  );
END
$$;

-- 0009-production-schedules.sql: function
CREATE OR REPLACE FUNCTION v2.list_schedule_run_templates(p_facility_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
BEGIN
  IF p_facility_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM v2.facility_scope WHERE singleton AND facility_id = p_facility_id) THEN
    RAISE EXCEPTION 'Invalid production schedule scope' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'code', code, 'name', name, 'brand', data->'brand', 'flavor', data->'flavor',
      'values', jsonb_strip_nulls(jsonb_build_object(
        'pizzasPerCase', data->'values'->'pizzasPerCase',
        'crustsPerCycle', data->'values'->'crustsPerCycle',
        'cycleSpeed', data->'values'->'cycleSpeed',
        'speedAdjustment', data->'values'->'speedAdjustment',
        'freezerTime', data->'values'->'freezerTime'
      ))
    ) ORDER BY lower(name), code)
    FROM v2.setup_run_template_records
    WHERE facility_id = p_facility_id
  ), '[]'::jsonb);
END
$$;

-- 0009-production-schedules.sql: function
CREATE OR REPLACE FUNCTION v2.apply_production_schedule_command(
  p_facility_id uuid,
  p_actor_id uuid,
  p_date date,
  p_request_id text,
  p_request_hash text,
  p_expected_revision bigint,
  p_command jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_receipt v2.production_schedule_receipts%ROWTYPE;
  v_current v2.production_schedules%ROWTYPE;
  v_runs jsonb;
  v_breaks jsonb;
  v_start text;
  v_next_runs jsonb;
  v_run jsonb;
  v_target_index integer;
  v_first_index integer;
  v_second_index integer;
  v_original jsonb;
  v_now timestamptz := clock_timestamp();
  v_revision bigint;
  v_response jsonb;
  v_type text;
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL OR p_date IS NULL
     OR p_expected_revision IS NULL OR p_expected_revision < 0 OR p_expected_revision > 9007199254740991
     OR p_request_id IS NULL OR length(btrim(p_request_id)) NOT BETWEEN 1 AND 200
     OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$'
     OR jsonb_typeof(p_command) IS DISTINCT FROM 'object'
     OR NOT EXISTS (SELECT 1 FROM v2.facility_scope WHERE singleton AND facility_id = p_facility_id) THEN
    RAISE EXCEPTION 'Invalid production schedule command' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_facility_id::text || ':' || p_date::text, 0));
  SELECT * INTO v_receipt FROM v2.production_schedule_receipts
    WHERE facility_id = p_facility_id AND actor_id = p_actor_id AND request_id = p_request_id;
  IF FOUND THEN
    IF v_receipt.request_hash <> p_request_hash THEN
      RAISE EXCEPTION 'Schedule request ID was reused with different details' USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object(
      'outcome', 'accepted', 'replayed', true,
      'schedule', v2.get_production_schedule(p_facility_id, p_date)
    );
  END IF;
  SELECT * INTO v_current FROM v2.production_schedules
    WHERE facility_id = p_facility_id AND production_date = p_date FOR UPDATE;
  IF FOUND THEN
    v_revision := v_current.revision;
    v_runs := v_current.plan->'runs';
    v_breaks := v_current.plan->'breaks';
    v_start := v_current.plan->>'productionStartTime';
  ELSE
    v_revision := 0;
    v_runs := '[]'::jsonb;
    v_breaks := jsonb_build_array(
      jsonb_build_object('slot',1,'enabled',false,'runId',NULL),
      jsonb_build_object('slot',2,'enabled',false,'runId',NULL),
      jsonb_build_object('slot',3,'enabled',false,'runId',NULL)
    );
    v_start := v2.schedule_default_start_time(p_facility_id);
  END IF;
  IF v_revision <> p_expected_revision THEN
    RETURN jsonb_build_object(
      'outcome', 'conflict', 'replayed', false,
      'schedule', v2.get_production_schedule(p_facility_id, p_date)
    );
  END IF;
  v_type := p_command->>'type';
  IF v_type = 'add' THEN
    IF (p_command - ARRAY['type','run']) <> '{}'::jsonb
       OR NOT (p_command ?& ARRAY['type','run'])
       OR jsonb_array_length(v_runs) >= 100 THEN
      RAISE EXCEPTION 'Invalid schedule addition' USING ERRCODE = '22023';
    END IF;
    v_runs := v_runs || jsonb_build_array(p_command->'run');
  ELSIF v_type = 'update' THEN
    IF (p_command - ARRAY['type','runId','changes']) <> '{}'::jsonb
       OR NOT (p_command ?& ARRAY['type','runId','changes'])
       OR jsonb_typeof(p_command->'changes') IS DISTINCT FROM 'object'
       OR (p_command->'changes' - ARRAY['productCode','productionSetupCode','runTemplateCode','targetCases','notes']) <> '{}'::jsonb THEN
      RAISE EXCEPTION 'Invalid planned-run update' USING ERRCODE = '22023';
    END IF;
    SELECT ordinality::integer - 1 INTO v_target_index
      FROM jsonb_array_elements(v_runs) WITH ORDINALITY AS item(value, ordinality)
      WHERE value->>'id' = p_command->>'runId';
    IF v_target_index IS NULL THEN RAISE EXCEPTION 'Planned run no longer exists' USING ERRCODE = 'P0002'; END IF;
    v_original := v_runs->v_target_index;
    v_runs := jsonb_set(v_runs, ARRAY[v_target_index::text], v_original || p_command->'changes', false);
  ELSIF v_type = 'remove' THEN
    IF (p_command - ARRAY['type','runId']) <> '{}'::jsonb
       OR NOT (p_command ?& ARRAY['type','runId']) THEN
      RAISE EXCEPTION 'Invalid planned-run removal' USING ERRCODE = '22023';
    END IF;
    SELECT ordinality::integer - 1 INTO v_target_index
      FROM jsonb_array_elements(v_runs) WITH ORDINALITY AS item(value, ordinality)
      WHERE value->>'id' = p_command->>'runId';
    IF v_target_index IS NULL THEN RAISE EXCEPTION 'Planned run no longer exists' USING ERRCODE = 'P0002'; END IF;
    v_runs := v_runs - v_target_index;
    SELECT COALESCE(jsonb_agg(
      CASE WHEN value->>'runId' = p_command->>'runId'
        THEN jsonb_set(value, '{runId}', 'null'::jsonb, false) ELSE value END
      ORDER BY ordinality
    ), '[]'::jsonb) INTO v_breaks
      FROM jsonb_array_elements(v_breaks) WITH ORDINALITY AS item(value, ordinality);
  ELSIF v_type = 'move' THEN
    IF (p_command - ARRAY['type','runId','toIndex']) <> '{}'::jsonb
       OR NOT (p_command ?& ARRAY['type','runId','toIndex'])
       OR jsonb_typeof(p_command->'toIndex') IS DISTINCT FROM 'number'
       OR (p_command->>'toIndex') !~ '^[0-9]{1,2}$' THEN
      RAISE EXCEPTION 'Invalid planned-run move' USING ERRCODE = '22023';
    END IF;
    SELECT ordinality::integer - 1, value INTO v_target_index, v_run
      FROM jsonb_array_elements(v_runs) WITH ORDINALITY AS item(value, ordinality)
      WHERE value->>'id' = p_command->>'runId';
    IF v_target_index IS NULL THEN RAISE EXCEPTION 'Planned run no longer exists' USING ERRCODE = 'P0002'; END IF;
    IF (p_command->>'toIndex')::integer >= jsonb_array_length(v_runs) THEN
      RAISE EXCEPTION 'Planned-run position is invalid' USING ERRCODE = '22023';
    END IF;
    v_runs := v_runs - v_target_index;
    v_runs := jsonb_insert(v_runs, ARRAY[(p_command->>'toIndex')], v_run, false);
  ELSIF v_type = 'swap' THEN
    IF (p_command - ARRAY['type','firstRunId','secondRunId']) <> '{}'::jsonb
       OR NOT (p_command ?& ARRAY['type','firstRunId','secondRunId'])
       OR p_command->>'firstRunId' = p_command->>'secondRunId' THEN
      RAISE EXCEPTION 'Invalid planned-run swap' USING ERRCODE = '22023';
    END IF;
    SELECT ordinality::integer - 1 INTO v_first_index FROM jsonb_array_elements(v_runs)
      WITH ORDINALITY AS item(value, ordinality) WHERE value->>'id' = p_command->>'firstRunId';
    SELECT ordinality::integer - 1 INTO v_second_index FROM jsonb_array_elements(v_runs)
      WITH ORDINALITY AS item(value, ordinality) WHERE value->>'id' = p_command->>'secondRunId';
    IF v_first_index IS NULL OR v_second_index IS NULL THEN
      RAISE EXCEPTION 'A planned run no longer exists' USING ERRCODE = 'P0002';
    END IF;
    v_original := v_runs->v_first_index;
    v_runs := jsonb_set(v_runs, ARRAY[v_first_index::text], v_runs->v_second_index, false);
    v_runs := jsonb_set(v_runs, ARRAY[v_second_index::text], v_original, false);
  ELSIF v_type = 'breaks' THEN
    IF (p_command - ARRAY['type','breaks']) <> '{}'::jsonb
       OR NOT (p_command ?& ARRAY['type','breaks']) THEN
      RAISE EXCEPTION 'Invalid schedule breaks' USING ERRCODE = '22023';
    END IF;
    v_breaks := p_command->'breaks';
  ELSIF v_type = 'merge-import' THEN
    IF (p_command - ARRAY['type','runs']) <> '{}'::jsonb
       OR NOT (p_command ?& ARRAY['type','runs'])
       OR jsonb_typeof(p_command->'runs') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Invalid reviewed schedule import' USING ERRCODE = '22023';
    END IF;
    IF jsonb_array_length(p_command->'runs') > 100 THEN
      RAISE EXCEPTION 'Invalid reviewed schedule import' USING ERRCODE = '22023';
    END IF;
    FOR v_run IN SELECT value FROM jsonb_array_elements(p_command->'runs') LOOP
      SELECT ordinality::integer - 1 INTO v_target_index
        FROM jsonb_array_elements(v_runs) WITH ORDINALITY AS item(value, ordinality)
        WHERE value->>'id' = v_run->>'id';
      IF v_target_index IS NULL THEN
        IF jsonb_array_length(v_runs) >= 100 THEN
          RAISE EXCEPTION 'The schedule cannot contain more than 100 planned runs' USING ERRCODE = '22023';
        END IF;
        v_runs := v_runs || jsonb_build_array(v_run);
      ELSE
        v_runs := jsonb_set(v_runs, ARRAY[v_target_index::text], v_run, false);
      END IF;
    END LOOP;
  ELSE
    RAISE EXCEPTION 'Unsupported production schedule command' USING ERRCODE = '22023';
  END IF;
  IF NOT v2.validate_production_schedule_runs(p_facility_id, v_runs)
     OR NOT v2.validate_production_schedule_breaks(v_runs, v_breaks) THEN
    RAISE EXCEPTION 'Schedule references or values are invalid' USING ERRCODE = '22023';
  END IF;
  IF v_start !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
    RAISE EXCEPTION 'Production start time is invalid' USING ERRCODE = '22023';
  END IF;
  INSERT INTO v2.production_schedules(
    facility_id, production_date, revision, plan, time_zone, updated_by, updated_at
  ) VALUES (
    p_facility_id, p_date, v_revision + 1,
    jsonb_build_object('productionStartTime',v_start,'runs',v_runs,'breaks',v_breaks),
    'America/Chicago', p_actor_id, v_now
  )
  ON CONFLICT (facility_id, production_date) DO UPDATE
    SET revision = EXCLUDED.revision,
        plan = EXCLUDED.plan,
        time_zone = EXCLUDED.time_zone,
        updated_by = EXCLUDED.updated_by,
        updated_at = EXCLUDED.updated_at;
  v_response := jsonb_build_object(
    'outcome', 'accepted', 'replayed', false,
    'schedule', v2.get_production_schedule(p_facility_id, p_date)
  );
  INSERT INTO v2.production_schedule_receipts(
    facility_id, actor_id, request_id, request_hash, response, created_at
  ) VALUES (
    p_facility_id, p_actor_id, p_request_id, p_request_hash,
    jsonb_build_object('outcome', 'accepted'), v_now
  );
  RETURN v_response;
END
$$;

-- 0009-production-schedules.sql: permissions
REVOKE ALL ON FUNCTION v2.schedule_default_start_time(uuid) FROM PUBLIC;

-- 0009-production-schedules.sql: permissions
REVOKE ALL ON FUNCTION v2.validate_production_schedule_runs(uuid, jsonb) FROM PUBLIC;

-- 0009-production-schedules.sql: permissions
REVOKE ALL ON FUNCTION v2.validate_production_schedule_breaks(jsonb, jsonb) FROM PUBLIC;

-- 0009-production-schedules.sql: permissions
REVOKE ALL ON FUNCTION v2.get_production_schedule(uuid, date) FROM PUBLIC;

-- 0009-production-schedules.sql: permissions
REVOKE ALL ON FUNCTION v2.list_schedule_run_templates(uuid) FROM PUBLIC;

-- 0009-production-schedules.sql: permissions
REVOKE ALL ON FUNCTION v2.apply_production_schedule_command(uuid, uuid, date, text, text, bigint, jsonb) FROM PUBLIC;

-- 0009-qc-ingredient-links.sql: function
CREATE OR REPLACE FUNCTION v2.prevent_qc_ingredient_link_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, v2
AS $$
BEGIN
  RAISE EXCEPTION 'Ingredient-link audit records are append-only'
    USING ERRCODE = '55000';
END
$$;

-- 0009-qc-ingredient-links.sql: repeat-safe trigger
DROP TRIGGER IF EXISTS qc_ingredient_link_events_append_only ON v2.qc_ingredient_link_events;
CREATE TRIGGER qc_ingredient_link_events_append_only
  BEFORE UPDATE OR DELETE ON v2.qc_ingredient_link_events
  FOR EACH ROW EXECUTE FUNCTION v2.prevent_qc_ingredient_link_event_mutation();

-- 0009-qc-ingredient-links.sql: function
CREATE OR REPLACE FUNCTION v2.actor_can_manage_allergens(p_actor_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM v2.staff_accounts AS staff
    JOIN v2.user_roles AS user_role ON user_role.user_id = staff.id
    JOIN v2.roles AS role ON role.name = user_role.role_name
    WHERE staff.id = p_actor_id
      AND staff.disabled = false
      AND role.capabilities ? 'manage-allergens'
  )
$$;

-- 0009-qc-ingredient-links.sql: function
CREATE OR REPLACE FUNCTION v2.list_qc_ingredient_links(
  p_facility_id uuid,
  p_actor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM v2.facility_scope
       WHERE singleton AND facility_id = p_facility_id
     ) THEN
    RAISE EXCEPTION 'Invalid ingredient-link request' USING ERRCODE = '22023';
  END IF;
  IF NOT v2.actor_can_manage_allergens(p_actor_id) THEN
    RAISE EXCEPTION 'Allergen management is not authorized' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'products', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'productId', product.id,
        'productCode', product.code,
        'productName', product.name,
        'ingredientCode', CASE WHEN product.action = 'linked' THEN product.ingredient_code END,
        'ingredientName', CASE WHEN product.action = 'linked' THEN product.ingredient_name END,
        'linkedAt', CASE WHEN product.action = 'linked' THEN product.occurred_at END,
        'linkedBy', CASE WHEN product.action = 'linked' THEN product.actor_id END,
        'linkEventId', CASE WHEN product.action = 'linked' THEN product.event_id END
      ) ORDER BY lower(product.name), product.code)
      FROM (
        SELECT
          product.id, product.code, product.name, latest.action,
          latest.ingredient_code, latest.ingredient_name, latest.occurred_at,
          latest.actor_id, latest.id AS event_id
        FROM v2.products AS product
        LEFT JOIN LATERAL (
          SELECT event.*
          FROM v2.qc_ingredient_link_events AS event
          WHERE event.facility_id = p_facility_id
            AND event.product_id = product.id
          ORDER BY event.occurred_at DESC, event.id DESC
          LIMIT 1
        ) AS latest ON true
        WHERE product.facility_id = p_facility_id
          AND product.active
        ORDER BY lower(product.name), product.code
        LIMIT 2000
      ) AS product
    ), '[]'::jsonb),
    'productsTruncated', (
      SELECT count(*) > 2000
      FROM v2.products AS product
      WHERE product.facility_id = p_facility_id AND product.active
    ),
    'ingredients', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'ingredientCode', ingredient.code,
        'ingredientName', ingredient.name,
        'allergens', ingredient.data->'allergens',
        'allergensReviewed', ingredient.data->'allergensReviewed',
        'updatedAt', ingredient.updated_at
      ) ORDER BY lower(ingredient.name), ingredient.code)
      FROM (
        SELECT ingredient.*
        FROM v2.setup_ingredient_records AS ingredient
        WHERE ingredient.facility_id = p_facility_id
          AND ingredient.data->>'enabled' = 'true'
          AND ingredient.merged_into_code IS NULL
        ORDER BY lower(ingredient.name), ingredient.code
        LIMIT 2000
      ) AS ingredient
    ), '[]'::jsonb),
    'ingredientsTruncated', (
      SELECT count(*) > 2000
      FROM v2.setup_ingredient_records AS ingredient
      WHERE ingredient.facility_id = p_facility_id
        AND ingredient.data->>'enabled' = 'true'
        AND ingredient.merged_into_code IS NULL
    ),
    'events', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', event.id,
        'actorId', event.actor_id,
        'productId', event.product_id,
        'productCode', event.product_code_snapshot,
        'productName', event.product_name_snapshot,
        'action', event.action,
        'previousIngredientCode', event.previous_ingredient_code,
        'previousIngredientName', event.previous_ingredient_name,
        'ingredientCode', event.ingredient_code,
        'ingredientName', event.ingredient_name,
        'occurredAt', event.occurred_at
      ) ORDER BY event.occurred_at DESC, event.id DESC)
      FROM (
        SELECT * FROM v2.qc_ingredient_link_events
        WHERE facility_id = p_facility_id
        ORDER BY occurred_at DESC, id DESC
        LIMIT 100
      ) AS event
    ), '[]'::jsonb)
  );
END
$$;

-- 0009-qc-ingredient-links.sql: function
CREATE OR REPLACE FUNCTION v2.record_qc_ingredient_link(
  p_facility_id uuid,
  p_actor_id uuid,
  p_request_id text,
  p_request_hash text,
  p_product_id uuid,
  p_ingredient_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_existing v2.qc_ingredient_link_events%ROWTYPE;
  v_event v2.qc_ingredient_link_events%ROWTYPE;
  v_product v2.products%ROWTYPE;
  v_ingredient v2.setup_ingredient_records%ROWTYPE;
  v_previous v2.qc_ingredient_link_events%ROWTYPE;
  v_previous_code text;
  v_previous_name text;
  v_ingredient_code text;
  v_action text;
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL OR p_product_id IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM v2.facility_scope
       WHERE singleton AND facility_id = p_facility_id
     )
     OR p_request_id IS NULL OR length(btrim(p_request_id)) NOT BETWEEN 1 AND 200
     OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$'
     OR (p_ingredient_code IS NOT NULL AND (
       length(btrim(p_ingredient_code)) NOT BETWEEN 1 AND 80
       OR p_ingredient_code !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$'
     )) THEN
    RAISE EXCEPTION 'Invalid ingredient-link request' USING ERRCODE = '22023';
  END IF;
  IF NOT v2.actor_can_manage_allergens(p_actor_id) THEN
    RAISE EXCEPTION 'Allergen management is not authorized' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_facility_id::text || ':' || p_actor_id::text || ':qc-link:' || p_request_id, 0
  ));
  SELECT * INTO v_existing
  FROM v2.qc_ingredient_link_events
  WHERE facility_id = p_facility_id
    AND actor_id = p_actor_id
    AND request_id = p_request_id;
  IF FOUND THEN
    IF v_existing.request_hash <> p_request_hash OR v_existing.product_id <> p_product_id
       OR lower(v_existing.ingredient_code) IS DISTINCT FROM lower(p_ingredient_code) THEN
      RAISE EXCEPTION 'Ingredient-link request ID was reused with different details'
        USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object(
      'event', jsonb_build_object(
        'id', v_existing.id,
        'actorId', v_existing.actor_id,
        'productId', v_existing.product_id,
        'productCode', v_existing.product_code_snapshot,
        'productName', v_existing.product_name_snapshot,
        'action', v_existing.action,
        'previousIngredientCode', v_existing.previous_ingredient_code,
        'previousIngredientName', v_existing.previous_ingredient_name,
        'ingredientCode', v_existing.ingredient_code,
        'ingredientName', v_existing.ingredient_name,
        'occurredAt', v_existing.occurred_at
      ),
      'replayed', true
    );
  END IF;

  SELECT * INTO v_product
  FROM v2.products
  WHERE facility_id = p_facility_id
    AND id = p_product_id
    AND active
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inventory product is unavailable' USING ERRCODE = 'P0002';
  END IF;

  v_action := CASE WHEN p_ingredient_code IS NULL THEN 'unlinked' ELSE 'linked' END;
  IF p_ingredient_code IS NOT NULL THEN
    SELECT * INTO v_ingredient
    FROM v2.setup_ingredient_records
    WHERE facility_id = p_facility_id
      AND lower(code) = lower(p_ingredient_code)
      AND data->>'enabled' = 'true'
      AND merged_into_code IS NULL
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Choose an enabled canonical ingredient identity' USING ERRCODE = '22023';
    END IF;
    v_ingredient_code := v_ingredient.code;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_facility_id::text || ':' || p_product_id::text || ':qc-ingredient-link', 0
  ));
  SELECT * INTO v_previous
  FROM v2.qc_ingredient_link_events
  WHERE facility_id = p_facility_id
    AND product_id = p_product_id
  ORDER BY occurred_at DESC, id DESC
  LIMIT 1;
  IF FOUND AND v_previous.action = 'linked' THEN
    v_previous_code := v_previous.ingredient_code;
    v_previous_name := v_previous.ingredient_name;
  END IF;

  INSERT INTO v2.qc_ingredient_link_events (
    facility_id, actor_id, request_id, request_hash,
    product_id, product_code_snapshot, product_name_snapshot,
    action, previous_ingredient_code, previous_ingredient_name,
    ingredient_code, ingredient_name
  ) VALUES (
    p_facility_id, p_actor_id, p_request_id, p_request_hash,
    p_product_id, v_product.code, v_product.name,
    v_action, v_previous_code, v_previous_name,
    v_ingredient_code, CASE WHEN v_ingredient_code IS NULL THEN NULL ELSE v_ingredient.name END
  )
  RETURNING * INTO v_event;

  RETURN jsonb_build_object(
    'event', jsonb_build_object(
      'id', v_event.id,
      'actorId', v_event.actor_id,
      'productId', v_event.product_id,
      'productCode', v_event.product_code_snapshot,
      'productName', v_event.product_name_snapshot,
      'action', v_event.action,
      'previousIngredientCode', v_event.previous_ingredient_code,
      'previousIngredientName', v_event.previous_ingredient_name,
      'ingredientCode', v_event.ingredient_code,
      'ingredientName', v_event.ingredient_name,
      'occurredAt', v_event.occurred_at
    ),
    'replayed', false
  );
END
$$;

-- 0009-qc-ingredient-links.sql: function
CREATE OR REPLACE FUNCTION v2.snapshot_run_ingredient_allergens()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_plan jsonb;
  v_recipes jsonb;
  v_recipe jsonb;
  v_ingredients jsonb;
  v_ingredient jsonb;
  v_snapshot jsonb;
  v_product_id uuid;
  v_recipe_index integer;
  v_ingredient_index integer;
  v_link v2.qc_ingredient_link_events%ROWTYPE;
  v_catalog v2.setup_ingredient_records%ROWTYPE;
BEGIN
  v_plan := NEW.setup_snapshot->'productionPlan';
  v_recipes := v_plan->'recipes';
  IF jsonb_typeof(v_recipes) IS DISTINCT FROM 'array' THEN
    RETURN NEW;
  END IF;

  IF jsonb_array_length(v_recipes) > 0 THEN
    FOR v_recipe_index IN 0..jsonb_array_length(v_recipes) - 1 LOOP
      v_recipe := v_recipes->v_recipe_index;
      v_ingredients := v_recipe->'ingredients';
      IF jsonb_typeof(v_ingredients) IS DISTINCT FROM 'array' THEN
        CONTINUE;
      END IF;
      IF jsonb_array_length(v_ingredients) > 0 THEN
        FOR v_ingredient_index IN 0..jsonb_array_length(v_ingredients) - 1 LOOP
          v_ingredient := v_ingredients->v_ingredient_index;
          v_snapshot := jsonb_build_object(
            'status', 'unknown',
            'reason', 'missing-link'
          );
          IF coalesce(v_ingredient->>'productId', '') ~*
             '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
            v_product_id := (v_ingredient->>'productId')::uuid;
            SELECT * INTO v_link
            FROM v2.qc_ingredient_link_events AS event
            WHERE event.facility_id = NEW.facility_id
              AND event.product_id = v_product_id
            ORDER BY event.occurred_at DESC, event.id DESC
            LIMIT 1;
            IF FOUND AND v_link.action = 'linked' THEN
              SELECT * INTO v_catalog
              FROM v2.setup_ingredient_records AS ingredient
              WHERE ingredient.facility_id = NEW.facility_id
                AND ingredient.code = v_link.ingredient_code
                AND ingredient.data->>'enabled' = 'true'
                AND ingredient.merged_into_code IS NULL;
              IF FOUND THEN
                v_snapshot := jsonb_build_object(
                  'status', 'linked',
                  'ingredientCode', v_catalog.code,
                  'ingredientName', v_catalog.name,
                  'allergens', v_catalog.data->'allergens',
                  'allergensReviewed', v_catalog.data->'allergensReviewed',
                  'linkEventId', v_link.id,
                  'ingredientUpdatedAt',
                    to_char(v_catalog.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
                );
              ELSE
                v_snapshot := jsonb_build_object(
                  'status', 'unknown',
                  'reason', 'canonical-ingredient-unavailable',
                  'linkEventId', v_link.id
                );
              END IF;
            END IF;
          END IF;
          v_ingredient := v_ingredient || jsonb_build_object('ingredientSnapshot', v_snapshot);
          v_ingredients := jsonb_set(v_ingredients, ARRAY[v_ingredient_index::text], v_ingredient);
        END LOOP;
      END IF;
      v_recipe := jsonb_set(v_recipe, '{ingredients}', v_ingredients);
      v_recipes := jsonb_set(v_recipes, ARRAY[v_recipe_index::text], v_recipe);
    END LOOP;
  END IF;

  v_plan := jsonb_set(v_plan, '{recipes}', v_recipes);
  NEW.setup_snapshot := jsonb_set(NEW.setup_snapshot, '{productionPlan}', v_plan);
  RETURN NEW;
END
$$;

-- 0009-qc-ingredient-links.sql: repeat-safe trigger
DROP TRIGGER IF EXISTS runs_snapshot_ingredient_allergens ON v2.runs;
CREATE TRIGGER runs_snapshot_ingredient_allergens
  BEFORE INSERT ON v2.runs
  FOR EACH ROW EXECUTE FUNCTION v2.snapshot_run_ingredient_allergens();

-- 0009-qc-ingredient-links.sql: function
CREATE OR REPLACE FUNCTION v2.record_qc_event(
  p_facility_id uuid,
  p_actor_id uuid,
  p_run_id uuid,
  p_request_id text,
  p_request_hash text,
  p_event_type text,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_existing v2.qc_events%ROWTYPE;
  v_event v2.qc_events%ROWTYPE;
  v_target v2.qc_events%ROWTYPE;
  v_key_count integer;
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM v2.facility_scope
       WHERE singleton AND facility_id = p_facility_id
     )
     OR p_request_id IS NULL OR length(btrim(p_request_id)) NOT BETWEEN 1 AND 200
     OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$'
     OR p_event_type IS NULL
     OR p_event_type NOT IN (
       'lot-recorded', 'weight-check', 'cleaning-recorded', 'cleaning-verified',
       'date-code-observed', 'brix-check', 'qc-setting-reviewed',
       'review-signed-off', 'run-check-reviewed', 'correction', 'redaction'
     )
     OR p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object'
     OR octet_length(p_payload::text) > 65536
     OR (p_event_type = 'qc-setting-reviewed' AND p_run_id IS NOT NULL)
     OR (p_event_type NOT IN ('qc-setting-reviewed', 'redaction') AND p_run_id IS NULL) THEN
    RAISE EXCEPTION 'Invalid QC event request' USING ERRCODE = '22023';
  END IF;

  IF NOT v2.actor_can_record_qc(p_actor_id) THEN
    RAISE EXCEPTION 'QC recording is not authorized' USING ERRCODE = '42501';
  END IF;
  IF p_event_type IN ('qc-setting-reviewed', 'review-signed-off', 'redaction')
     AND NOT v2.actor_can_manage_qc(p_actor_id) THEN
    RAISE EXCEPTION 'QC management is not authorized' USING ERRCODE = '42501';
  END IF;
  IF p_run_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM v2.runs WHERE facility_id = p_facility_id AND id = p_run_id
  ) THEN
    RAISE EXCEPTION 'QC run is unavailable' USING ERRCODE = 'P0002';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_facility_id::text || ':' || p_actor_id::text || ':qc:' || p_request_id, 0
  ));
  SELECT * INTO v_existing
  FROM v2.qc_events
  WHERE facility_id = p_facility_id
    AND actor_id = p_actor_id
    AND request_id = p_request_id;
  IF FOUND THEN
    IF v_existing.request_hash <> p_request_hash
       OR v_existing.run_id IS DISTINCT FROM p_run_id
       OR v_existing.event_type <> p_event_type THEN
      RAISE EXCEPTION 'QC request ID was reused with different details'
        USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object(
      'event', jsonb_build_object(
        'id', v_existing.id,
        'runId', v_existing.run_id,
        'actorId', v_existing.actor_id,
        'eventType', v_existing.event_type,
        'payload', v_existing.payload,
        'occurredAt', v_existing.occurred_at
      ),
      'replayed', true
    );
  END IF;

  IF p_event_type = 'cleaning-verified' THEN
    SELECT count(*) INTO v_key_count FROM jsonb_object_keys(p_payload);
    IF p_payload ? 'verifierId' OR v_key_count <> 1
       OR coalesce(p_payload->>'targetEventId', '') !~*
         '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'Cleaning verification must reference one existing record'
        USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_target
    FROM v2.qc_events
    WHERE facility_id = p_facility_id
      AND id = (p_payload->>'targetEventId')::uuid
      AND run_id = p_run_id
      AND event_type = 'cleaning-recorded';
    IF NOT FOUND OR v_target.actor_id = p_actor_id THEN
      RAISE EXCEPTION 'A different authenticated QC staff member must verify cleaning'
        USING ERRCODE = '42501';
    END IF;
    IF EXISTS (
      SELECT 1 FROM v2.qc_events AS redaction
      WHERE redaction.facility_id = p_facility_id
        AND redaction.event_type = 'redaction'
        AND redaction.payload->>'targetEventId' = v_target.id::text
    ) THEN
      RAISE EXCEPTION 'The cleaning record is no longer available for verification'
        USING ERRCODE = '55000';
    END IF;
  ELSIF p_event_type IN ('correction', 'redaction') THEN
    IF coalesce(p_payload->>'targetEventId', '') !~*
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR length(btrim(coalesce(p_payload->>'reason', ''))) NOT BETWEEN 3 AND 500 THEN
      RAISE EXCEPTION 'QC correction or redaction requires a target and reason'
        USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_target
    FROM v2.qc_events
    WHERE facility_id = p_facility_id
      AND id = (p_payload->>'targetEventId')::uuid
      AND run_id IS NOT DISTINCT FROM p_run_id
      AND event_type NOT IN ('correction', 'redaction', 'review-signed-off');
    IF NOT FOUND THEN
      RAISE EXCEPTION 'QC evidence is unavailable for correction'
        USING ERRCODE = 'P0002';
    END IF;
    IF p_event_type = 'redaction' AND EXISTS (
      SELECT 1 FROM v2.qc_events AS prior
      WHERE prior.facility_id = p_facility_id
        AND prior.event_type = 'redaction'
        AND prior.payload->>'targetEventId' = v_target.id::text
    ) THEN
      RAISE EXCEPTION 'QC evidence has already been redacted'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  INSERT INTO v2.qc_events (
    facility_id, run_id, actor_id, request_id, request_hash, event_type, payload
  ) VALUES (
    p_facility_id, p_run_id, p_actor_id, p_request_id, p_request_hash,
    p_event_type, p_payload
  )
  RETURNING * INTO v_event;

  RETURN jsonb_build_object(
    'event', jsonb_build_object(
      'id', v_event.id,
      'runId', v_event.run_id,
      'actorId', v_event.actor_id,
      'eventType', v_event.event_type,
      'payload', v_event.payload,
      'occurredAt', v_event.occurred_at
    ),
    'replayed', false
  );
END
$$;

-- 0009-qc-ingredient-links.sql: permissions
REVOKE ALL ON TABLE v2.qc_ingredient_link_events FROM PUBLIC;

-- 0009-qc-ingredient-links.sql: permissions
REVOKE ALL ON FUNCTION v2.prevent_qc_ingredient_link_event_mutation() FROM PUBLIC;

-- 0009-qc-ingredient-links.sql: permissions
REVOKE ALL ON FUNCTION v2.actor_can_manage_allergens(uuid) FROM PUBLIC;

-- 0009-qc-ingredient-links.sql: permissions
REVOKE ALL ON FUNCTION v2.list_qc_ingredient_links(uuid, uuid) FROM PUBLIC;

-- 0009-qc-ingredient-links.sql: permissions
REVOKE ALL ON FUNCTION v2.record_qc_ingredient_link(uuid, uuid, text, text, uuid, text) FROM PUBLIC;

-- 0009-qc-ingredient-links.sql: permissions
REVOKE ALL ON FUNCTION v2.snapshot_run_ingredient_allergens() FROM PUBLIC;

-- 0009-qc-ingredient-links.sql: permissions
REVOKE ALL ON FUNCTION v2.record_qc_event(uuid, uuid, uuid, text, text, text, jsonb) FROM PUBLIC;

-- 0009-qc-ingredient-links.sql: function comment
COMMENT ON FUNCTION v2.snapshot_run_ingredient_allergens() IS
  'Freezes the current reviewed ingredient identity and allergen facts into new run snapshots; never backfills historical runs.';

-- 0009-staff-password-resets.sql: function
CREATE OR REPLACE FUNCTION v2.expire_staff_password_reset_requests()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_expired record;
BEGIN
  PERFORM pg_advisory_xact_lock(20855409, 1);
  FOR v_expired IN
    UPDATE v2.staff_password_reset_requests
      SET state = 'expired', recovery_code_hash = NULL, code_expires_at = NULL
      WHERE (state = 'pending' AND requested_at <= v_now - interval '7 days')
         OR (state = 'approved' AND code_expires_at <= v_now)
      RETURNING id, staff_id
  LOOP
    INSERT INTO v2.staff_password_reset_events (request_id, staff_id, event_type, occurred_at)
      VALUES (v_expired.id, v_expired.staff_id, 'expired', v_now);
  END LOOP;
END
$$;

-- 0009-staff-password-resets.sql: function
CREATE OR REPLACE FUNCTION v2.can_approve_staff_password_reset(p_actor_id uuid, p_staff_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM v2.staff_accounts AS actor
    JOIN v2.user_roles AS actor_role ON actor_role.user_id = actor.id
    JOIN v2.roles AS actor_definition ON actor_definition.name = actor_role.role_name
    JOIN v2.staff_accounts AS target ON target.id = p_staff_id
    JOIN v2.user_roles AS target_role ON target_role.user_id = target.id
    JOIN v2.roles AS target_definition ON target_definition.name = target_role.role_name
    WHERE actor.id = p_actor_id
      AND actor.disabled = false
      AND actor_definition.capabilities ? 'approve-password-resets'
      AND target.disabled = false
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(target_definition.capabilities) AS capability(name)
        WHERE NOT (actor_definition.capabilities ? capability.name)
      )
  )
$$;

-- 0009-staff-password-resets.sql: function
CREATE OR REPLACE FUNCTION v2.request_staff_password_reset(p_username text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_staff_id uuid;
  v_request_id uuid;
  v_created boolean := false;
BEGIN
  IF p_username IS NULL OR length(btrim(p_username)) NOT BETWEEN 3 AND 40
     OR p_username <> btrim(p_username) OR p_username ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'Invalid password recovery request' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(20855409, 1);
  SELECT id INTO v_staff_id
    FROM v2.staff_accounts
    WHERE lower(username) = lower(btrim(p_username)) AND disabled = false
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  PERFORM v2.expire_staff_password_reset_requests();

  UPDATE v2.staff_sessions
    SET revoked_at = v_now
    WHERE user_id = v_staff_id AND revoked_at IS NULL;

  SELECT id INTO v_request_id
    FROM v2.staff_password_reset_requests
    WHERE staff_id = v_staff_id AND state IN ('pending', 'approved')
    FOR UPDATE;
  IF FOUND THEN
    RETURN true;
  END IF;

  INSERT INTO v2.staff_password_reset_requests (staff_id, state, requested_at)
    VALUES (v_staff_id, 'pending', v_now)
    RETURNING id INTO v_request_id;
  INSERT INTO v2.staff_password_reset_events (request_id, staff_id, event_type, occurred_at)
    VALUES (v_request_id, v_staff_id, 'requested', v_now);
  v_created := true;
  RETURN v_created;
END
$$;

-- 0009-staff-password-resets.sql: function
CREATE OR REPLACE FUNCTION v2.list_staff_password_reset_requests(p_actor_id uuid)
RETURNS TABLE (
  request_id uuid,
  staff_id uuid,
  username text,
  state text,
  requested_at timestamptz,
  decided_at timestamptz,
  code_expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(20855409, 1);
  IF NOT EXISTS (
    SELECT 1
    FROM v2.staff_accounts AS actor
    JOIN v2.user_roles AS ur ON ur.user_id = actor.id
    JOIN v2.roles AS role ON role.name = ur.role_name
    WHERE actor.id = p_actor_id AND actor.disabled = false
      AND role.capabilities ? 'approve-password-resets'
  ) THEN
    RAISE EXCEPTION 'Password recovery review is not authorized' USING ERRCODE = '42501';
  END IF;
  PERFORM v2.expire_staff_password_reset_requests();

  RETURN QUERY
    SELECT request.id, staff.id, staff.username, request.state,
           request.requested_at, request.decided_at, request.code_expires_at
    FROM v2.staff_password_reset_requests AS request
    JOIN v2.staff_accounts AS staff ON staff.id = request.staff_id
    WHERE request.state IN ('pending', 'approved')
      AND v2.can_approve_staff_password_reset(p_actor_id, staff.id)
    ORDER BY request.requested_at, request.id
    LIMIT 100;
END
$$;

-- 0009-staff-password-resets.sql: function
CREATE OR REPLACE FUNCTION v2.decide_staff_password_reset(
  p_actor_id uuid,
  p_request_id uuid,
  p_decision text,
  p_recovery_code_hash text,
  p_code_expires_at timestamptz
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_staff_id uuid;
  v_state text;
BEGIN
  IF p_actor_id IS NULL OR p_request_id IS NULL
     OR p_decision IS NULL OR p_decision NOT IN ('approve', 'deny')
     OR (p_decision = 'approve'
       AND (p_recovery_code_hash IS NULL OR p_recovery_code_hash !~ '^[0-9a-f]{64}$'
         OR p_code_expires_at IS NULL OR p_code_expires_at <= v_now
         OR p_code_expires_at > v_now + interval '10 minutes'))
     OR (p_decision = 'deny' AND (p_recovery_code_hash IS NOT NULL OR p_code_expires_at IS NOT NULL)) THEN
    RAISE EXCEPTION 'Invalid password recovery decision' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(20855409, 1);
  PERFORM v2.expire_staff_password_reset_requests();
  IF NOT EXISTS (
    SELECT 1
    FROM v2.staff_accounts AS actor
    JOIN v2.user_roles AS ur ON ur.user_id = actor.id
    JOIN v2.roles AS role ON role.name = ur.role_name
    WHERE actor.id = p_actor_id AND actor.disabled = false
      AND role.capabilities ? 'approve-password-resets'
  ) THEN
    RAISE EXCEPTION 'Password recovery review is not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT request.staff_id, request.state
    INTO v_staff_id, v_state
    FROM v2.staff_password_reset_requests AS request
    WHERE request.id = p_request_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;
  IF v_state NOT IN ('pending', 'approved') THEN
    RETURN 'not_active';
  END IF;

  PERFORM 1 FROM v2.staff_accounts WHERE id = v_staff_id FOR UPDATE;
  IF p_decision = 'approve' THEN
    IF NOT v2.can_approve_staff_password_reset(p_actor_id, v_staff_id) THEN
      RETURN 'target_unavailable';
    END IF;
    IF v_state <> 'pending' THEN
      RETURN 'already_approved';
    END IF;
    UPDATE v2.staff_password_reset_requests
      SET state = 'approved', recovery_code_hash = p_recovery_code_hash,
          code_expires_at = p_code_expires_at, decided_at = v_now, decided_by = p_actor_id
      WHERE id = p_request_id;
    UPDATE v2.staff_sessions
      SET revoked_at = v_now
      WHERE user_id = v_staff_id AND revoked_at IS NULL;
    INSERT INTO v2.staff_password_reset_events (request_id, staff_id, actor_id, event_type, occurred_at)
      VALUES (p_request_id, v_staff_id, p_actor_id, 'approved', v_now);
    RETURN 'approved';
  END IF;

  UPDATE v2.staff_password_reset_requests
    SET state = 'denied', recovery_code_hash = NULL, code_expires_at = NULL,
        decided_at = v_now, decided_by = p_actor_id
    WHERE id = p_request_id;
  UPDATE v2.staff_sessions
    SET revoked_at = v_now
    WHERE user_id = v_staff_id AND revoked_at IS NULL;
  INSERT INTO v2.staff_password_reset_events (request_id, staff_id, actor_id, event_type, occurred_at)
    VALUES (p_request_id, v_staff_id, p_actor_id, 'denied', v_now);
  RETURN 'denied';
END
$$;

-- 0009-staff-password-resets.sql: function
CREATE OR REPLACE FUNCTION v2.reissue_staff_password_reset_code(
  p_actor_id uuid,
  p_request_id uuid,
  p_recovery_code_hash text,
  p_code_expires_at timestamptz
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_staff_id uuid;
  v_state text;
BEGIN
  IF p_actor_id IS NULL OR p_request_id IS NULL
     OR p_recovery_code_hash IS NULL OR p_recovery_code_hash !~ '^[0-9a-f]{64}$'
     OR p_code_expires_at IS NULL OR p_code_expires_at <= v_now
      OR p_code_expires_at > v_now + interval '10 minutes' THEN
    RAISE EXCEPTION 'Invalid password recovery code request' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(20855409, 1);
  PERFORM v2.expire_staff_password_reset_requests();
  IF NOT EXISTS (
    SELECT 1
    FROM v2.staff_accounts AS actor
    JOIN v2.user_roles AS ur ON ur.user_id = actor.id
    JOIN v2.roles AS role ON role.name = ur.role_name
    WHERE actor.id = p_actor_id AND actor.disabled = false
      AND role.capabilities ? 'approve-password-resets'
  ) THEN
    RAISE EXCEPTION 'Password recovery review is not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT request.staff_id, request.state
    INTO v_staff_id, v_state
    FROM v2.staff_password_reset_requests AS request
    WHERE request.id = p_request_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;
  IF v_state <> 'approved' THEN
    RETURN 'not_active';
  END IF;

  PERFORM 1 FROM v2.staff_accounts WHERE id = v_staff_id FOR UPDATE;
  IF NOT v2.can_approve_staff_password_reset(p_actor_id, v_staff_id) THEN
    RETURN 'target_unavailable';
  END IF;

  UPDATE v2.staff_password_reset_requests
    SET recovery_code_hash = p_recovery_code_hash, code_expires_at = p_code_expires_at,
        decided_at = v_now, decided_by = p_actor_id
    WHERE id = p_request_id;
  UPDATE v2.staff_sessions
    SET revoked_at = v_now
    WHERE user_id = v_staff_id AND revoked_at IS NULL;
  INSERT INTO v2.staff_password_reset_events (request_id, staff_id, actor_id, event_type, occurred_at)
    VALUES (p_request_id, v_staff_id, p_actor_id, 'reissued', v_now);
  RETURN 'reissued';
END
$$;

-- 0009-staff-password-resets.sql: function
CREATE OR REPLACE FUNCTION v2.complete_staff_password_reset(
  p_username text,
  p_recovery_code_hash text,
  p_password_hash text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_staff_id uuid;
  v_request_id uuid;
BEGIN
  IF p_username IS NULL OR length(btrim(p_username)) NOT BETWEEN 3 AND 40
     OR p_username <> btrim(p_username) OR p_username ~ '[[:cntrl:]]'
     OR p_recovery_code_hash IS NULL OR p_recovery_code_hash !~ '^[0-9a-f]{64}$'
     OR p_password_hash IS NULL OR length(p_password_hash) NOT BETWEEN 20 AND 256
     OR p_password_hash NOT LIKE 'argon2id$v=19$m=19456,t=2,p=1$%$%' THEN
    RAISE EXCEPTION 'Invalid password recovery completion' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(20855409, 1);
  PERFORM v2.expire_staff_password_reset_requests();
  SELECT request.id, staff.id
    INTO v_request_id, v_staff_id
    FROM v2.staff_password_reset_requests AS request
    JOIN v2.staff_accounts AS staff ON staff.id = request.staff_id
    WHERE lower(staff.username) = lower(btrim(p_username))
      AND staff.disabled = false
      AND request.state = 'approved'
      AND request.recovery_code_hash = p_recovery_code_hash
      AND request.code_expires_at > v_now
    FOR UPDATE OF request, staff;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  UPDATE v2.staff_accounts SET password_hash = p_password_hash WHERE id = v_staff_id;
  UPDATE v2.staff_password_reset_requests
    SET state = 'completed', recovery_code_hash = NULL, code_expires_at = NULL,
        completed_at = v_now
    WHERE id = v_request_id;
  UPDATE v2.staff_sessions
    SET revoked_at = v_now
    WHERE user_id = v_staff_id AND revoked_at IS NULL;
  INSERT INTO v2.staff_password_reset_events (request_id, staff_id, event_type, occurred_at)
    VALUES (v_request_id, v_staff_id, 'completed', v_now);
  RETURN true;
END
$$;

-- 0009-staff-password-resets.sql: function
CREATE OR REPLACE FUNCTION v2.cancel_staff_password_resets_after_account_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_staff_id uuid;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF TG_TABLE_NAME = 'staff_accounts' THEN
    IF OLD.disabled IS NOT DISTINCT FROM NEW.disabled THEN
      RETURN NEW;
    END IF;
    v_staff_id := NEW.id;
  ELSIF OLD.role_name IS NOT DISTINCT FROM NEW.role_name THEN
    RETURN NEW;
  ELSE
    v_staff_id := NEW.user_id;
  END IF;

  WITH cancelled AS (
    UPDATE v2.staff_password_reset_requests
      SET state = 'cancelled', recovery_code_hash = NULL, code_expires_at = NULL
      WHERE staff_id = v_staff_id AND state IN ('pending', 'approved')
      RETURNING id, staff_id
  )
  INSERT INTO v2.staff_password_reset_events (request_id, staff_id, event_type, occurred_at)
    SELECT id, staff_id, 'cancelled', v_now FROM cancelled;
  RETURN NEW;
END
$$;

-- 0009-staff-password-resets.sql: repeat-safe trigger
DROP TRIGGER IF EXISTS staff_password_reset_account_status_changed ON v2.staff_accounts;
CREATE TRIGGER staff_password_reset_account_status_changed
  AFTER UPDATE OF disabled ON v2.staff_accounts
  FOR EACH ROW EXECUTE FUNCTION v2.cancel_staff_password_resets_after_account_change();

-- 0009-staff-password-resets.sql: repeat-safe trigger
DROP TRIGGER IF EXISTS staff_password_reset_role_changed ON v2.user_roles;
CREATE TRIGGER staff_password_reset_role_changed
  AFTER UPDATE OF role_name ON v2.user_roles
  FOR EACH ROW EXECUTE FUNCTION v2.cancel_staff_password_resets_after_account_change();

-- 0009-staff-password-resets.sql: permissions
REVOKE ALL ON TABLE v2.staff_password_reset_requests FROM PUBLIC;

-- 0009-staff-password-resets.sql: permissions
REVOKE ALL ON TABLE v2.staff_password_reset_events FROM PUBLIC;

-- 0009-staff-password-resets.sql: permissions
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA v2 FROM PUBLIC;

-- 0010-operational-mix-plan.sql: function
CREATE OR REPLACE FUNCTION v2.get_operational_mix_plan_sources(p_facility_id uuid, p_make_date date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
BEGIN
  IF p_facility_id IS NULL OR p_make_date IS NULL OR NOT EXISTS (
    SELECT 1 FROM v2.facility_scope
    WHERE singleton AND facility_id = p_facility_id
  ) THEN
    RAISE EXCEPTION 'Invalid operational mix plan scope' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'makeDate', p_make_date,
    'timeZone', 'America/Chicago',
    'mixes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'code', m.code,
        'name', m.name,
        'enabled', COALESCE((m.data->>'enabled')::boolean, false),
        'isPrep', COALESCE((m.data->>'isPrep')::boolean, false),
        'brand', m.data->>'brand',
        'flavor', m.data->>'flavor',
        'daysEarly', m.data->'daysEarly',
        'batchSizeLbs', m.data->'batchSizeLbs',
        'outputProductCode', output_product.code,
        'outputProductName', output_product.name,
        'outputProductUnit', output_product.base_unit,
        'outputStockUnitsPerLb', output_link.stock_units_per_lb::text,
        'components', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'ingredientName', component.value->>'ingredientName',
            'declaredIngredientCode', component.value->>'ingredientCode',
            'linkedIngredientCode', component_link.ingredient_code,
            'ingredientCode', COALESCE(component_link.ingredient_code, component.value->>'ingredientCode'),
            'perPizzaOz', component.value->'perPizzaOz',
            'perBatchLbs', component.value->'perBatchLbs',
            'productCode', raw_product.code,
            'productName', raw_product.name,
            'productUnit', raw_product.base_unit,
            'stockUnitsPerLb', ingredient_link.stock_units_per_lb::text
          ) ORDER BY component.ordinality)
          FROM jsonb_array_elements(COALESCE(m.data->'components', '[]'::jsonb))
            WITH ORDINALITY AS component(value, ordinality)
          LEFT JOIN v2.setup_mix_component_links component_link
            ON component_link.facility_id = m.facility_id
            AND lower(component_link.mix_code) = lower(m.code)
            AND component_link.component_index = component.ordinality - 1
          LEFT JOIN v2.setup_ingredient_inventory_links ingredient_link
            ON ingredient_link.facility_id = m.facility_id
            AND lower(ingredient_link.ingredient_code)
              = lower(COALESCE(component_link.ingredient_code, component.value->>'ingredientCode'))
          LEFT JOIN v2.products raw_product
            ON raw_product.facility_id = ingredient_link.facility_id
            AND raw_product.id = ingredient_link.product_id
            AND raw_product.active
        ), '[]'::jsonb)
      ) ORDER BY lower(m.name), m.code)
      FROM v2.setup_mix_records m
      LEFT JOIN v2.setup_mix_inventory_links output_link
        ON output_link.facility_id = m.facility_id
        AND lower(output_link.mix_code) = lower(m.code)
      LEFT JOIN v2.products output_product
        ON output_product.facility_id = output_link.facility_id
        AND output_product.id = output_link.product_id
        AND output_product.active
      WHERE m.facility_id = p_facility_id
    ), '[]'::jsonb),
    'schedules', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'date', s.production_date,
        'revision', s.revision,
        'runs', s.plan->'runs'
      ) ORDER BY s.production_date)
      FROM v2.production_schedules s
      WHERE s.facility_id = p_facility_id
        AND s.production_date >= p_make_date
        AND s.production_date < p_make_date + 366
    ), '[]'::jsonb),
    'scheduleHorizonTruncated', EXISTS (
      SELECT 1 FROM v2.production_schedules s
      WHERE s.facility_id = p_facility_id
        AND s.production_date >= p_make_date + 366
    ),
    'templates', v2.list_schedule_run_templates(p_facility_id),
    'setups', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'productCode', setup.product_code,
        'productionSetupCode', setup.code,
        'productionSetupName', setup.name,
        'recipes', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'code', recipe.code,
            'name', recipe.name,
            'stationKey', recipe.data->>'station_key',
            'ingredients', COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                'productCode', ingredient.value->>'product_code',
                'productName', COALESCE(product.name, ingredient.value->>'product_code'),
                'quantity', ingredient.value->'quantity',
                'unit', ingredient.value->'unit'
              ) ORDER BY ingredient.ordinality)
              FROM jsonb_array_elements(COALESCE(recipe.data->'ingredients', '[]'::jsonb))
                WITH ORDINALITY AS ingredient(value, ordinality)
              LEFT JOIN v2.products product
                ON product.facility_id = setup.facility_id
                AND lower(product.code) = lower(ingredient.value->>'product_code')
                AND product.active
            ), '[]'::jsonb)
          ) ORDER BY requested.ordinality)
          FROM jsonb_array_elements_text(setup.data->'recipe_codes')
            WITH ORDINALITY AS requested(code, ordinality)
          JOIN v2.master_records recipe
            ON recipe.facility_id = setup.facility_id
            AND recipe.kind = 'recipes'
            AND lower(recipe.product_code) = lower(setup.product_code)
            AND lower(recipe.code) = lower(requested.code)
        ), '[]'::jsonb)
      ) ORDER BY lower(setup.product_code), lower(setup.name), setup.code)
      FROM v2.master_records setup
      WHERE setup.facility_id = p_facility_id
        AND setup.kind = 'production-setups'
        AND setup.data->>'sourceFamily' IS NULL
        AND jsonb_typeof(setup.data->'recipe_codes') = 'array'
        AND jsonb_typeof(setup.data->'packaging_per_case') = 'array'
    ), '[]'::jsonb),
    'activeRuns', COALESCE((
      SELECT jsonb_agg(v2.run_snapshot(p_facility_id, r.id) ORDER BY r.started_at, r.id)
      FROM v2.runs r
      WHERE r.facility_id = p_facility_id
        AND r.status IN ('running', 'paused')
    ), '[]'::jsonb),
    'substitutions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'runId', supply.run_id,
        'plannedProductCode', planned.code,
        'actualProductCode', actual.code,
        'actualProductName', actual.name,
        'unit', actual.base_unit,
        'quantity', supply.quantity::text
      ) ORDER BY supply.run_id, supply.occurred_at, supply.id)
      FROM v2.run_inventory_staged_supplies supply
      JOIN v2.runs run
        ON run.facility_id = supply.facility_id
        AND run.id = supply.run_id
        AND run.status IN ('running', 'paused')
      JOIN v2.products planned
        ON planned.facility_id = supply.facility_id
        AND planned.id = supply.planned_product_id
      JOIN v2.products actual
        ON actual.facility_id = supply.facility_id
        AND actual.id = supply.actual_product_id
      WHERE supply.facility_id = p_facility_id
    ), '[]'::jsonb)
  );
END
$$;

-- 0010-operational-mix-plan.sql: permissions
REVOKE ALL ON FUNCTION v2.get_operational_mix_plan_sources(uuid, date) FROM PUBLIC;

-- 0010-operational-mix-plan.sql: role validation or conditional grants
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'v2_runtime_access') THEN
    GRANT EXECUTE ON FUNCTION v2.get_operational_mix_plan_sources(uuid, date) TO v2_runtime_access;
  END IF;
END
$$;

-- 0010-operational-mix-plan.sql: function comment
COMMENT ON FUNCTION v2.get_operational_mix_plan_sources(uuid, date) IS
  'Read-only canonical sources for the operator mix plan; active runs remain frozen snapshots.';

-- 0010-qc-substitutions.sql: function
CREATE OR REPLACE FUNCTION v2.prevent_qc_run_substitution_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, v2
AS $$
BEGIN
  RAISE EXCEPTION 'QC substitution history is append-only'
    USING ERRCODE = '55000';
END
$$;

-- 0010-qc-substitutions.sql: repeat-safe trigger
DROP TRIGGER IF EXISTS qc_run_substitutions_append_only ON v2.qc_run_substitutions;
CREATE TRIGGER qc_run_substitutions_append_only
  BEFORE UPDATE OR DELETE ON v2.qc_run_substitutions
  FOR EACH ROW EXECUTE FUNCTION v2.prevent_qc_run_substitution_mutation();

-- 0010-qc-substitutions.sql: function
CREATE OR REPLACE FUNCTION v2.resolve_qc_substitution_sources(
  p_facility_id uuid,
  p_run_snapshot jsonb,
  p_source_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_input jsonb;
  v_recipe jsonb;
  v_ingredient jsonb;
  v_source v2.products%ROWTYPE;
  v_result jsonb := '[]'::jsonb;
  v_seen text[] := ARRAY[]::text[];
  v_key text;
  v_source_id uuid;
  v_station text;
  v_recipe_code text;
  v_unit text;
  v_quantity numeric(20,6);
  v_found boolean;
  v_keys text[];
  v_expected text[] := ARRAY['productId', 'quantity', 'recipeCode', 'stationKey', 'unit'];
  v_actual text[];
BEGIN
  IF jsonb_typeof(p_source_items) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_source_items) NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION 'Choose one to twenty planned source components'
      USING ERRCODE = '22023';
  END IF;

  FOR v_input IN SELECT value FROM jsonb_array_elements(p_source_items)
  LOOP
    IF jsonb_typeof(v_input) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'Invalid source component' USING ERRCODE = '22023';
    END IF;
    SELECT array_agg(key ORDER BY key) INTO v_actual
    FROM jsonb_object_keys(v_input) AS item(key);
    SELECT array_agg(key ORDER BY key) INTO v_keys
    FROM unnest(v_expected) AS item(key);
    IF v_actual IS DISTINCT FROM v_keys
       OR coalesce(v_input->>'productId', '') !~*
         '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR coalesce(v_input->>'recipeCode', '') !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$'
       OR v_input->>'stationKey' NOT IN ('dough', 'cheese', 'pepperoni', 'sauce', 'frontline')
       OR coalesce(v_input->>'quantity', '') !~ '^(0|[1-9][0-9]{0,13})(\.[0-9]{1,6})?$'
       OR (v_input->>'quantity')::numeric <= 0
       OR coalesce(v_input->>'unit', '') !~ '^[A-Za-z][A-Za-z0-9._/-]{0,15}$' THEN
      RAISE EXCEPTION 'Invalid source component fields' USING ERRCODE = '22023';
    END IF;
    v_source_id := (v_input->>'productId')::uuid;
    v_station := v_input->>'stationKey';
    v_recipe_code := v_input->>'recipeCode';
    v_unit := v_input->>'unit';
    v_quantity := (v_input->>'quantity')::numeric;
    v_key := v_recipe_code || ':' || v_station || ':' || v_source_id::text;
    IF v_key = ANY(v_seen) THEN
      RAISE EXCEPTION 'A source component can appear only once in a substitution'
        USING ERRCODE = '22023';
    END IF;
    v_seen := array_append(v_seen, v_key);

    v_found := false;
    FOR v_recipe IN
      SELECT value FROM jsonb_array_elements(
        coalesce(p_run_snapshot->'productionPlan'->'recipes', '[]'::jsonb)
      )
    LOOP
      IF v_recipe->>'code' <> v_recipe_code
         OR v_recipe->>'stationKey' <> v_station THEN
        CONTINUE;
      END IF;
      FOR v_ingredient IN
        SELECT value FROM jsonb_array_elements(
          coalesce(v_recipe->'ingredients', '[]'::jsonb)
        )
      LOOP
        IF v_ingredient->>'productId' = v_source_id::text
           AND v_ingredient->>'unit' = v_unit THEN
          v_found := true;
          EXIT;
        END IF;
      END LOOP;
      EXIT WHEN v_found;
    END LOOP;
    IF NOT v_found THEN
      RAISE EXCEPTION 'Choose every source component from this run snapshot'
        USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_source FROM v2.products
    WHERE facility_id = p_facility_id AND id = v_source_id
    FOR SHARE;
    IF NOT FOUND OR v_source.base_unit <> v_unit THEN
      RAISE EXCEPTION 'A source component unit does not match its inventory identity'
        USING ERRCODE = '22023';
    END IF;

    SELECT recipe.value INTO v_recipe
    FROM jsonb_array_elements(
      coalesce(p_run_snapshot->'productionPlan'->'recipes', '[]'::jsonb)
    ) AS recipe(value)
    WHERE recipe.value->>'code' = v_recipe_code
      AND recipe.value->>'stationKey' = v_station
    LIMIT 1;
    SELECT ingredient.value INTO v_ingredient
    FROM jsonb_array_elements(coalesce(v_recipe->'ingredients', '[]'::jsonb)) AS ingredient(value)
    WHERE ingredient.value->>'productId' = v_source_id::text
      AND ingredient.value->>'unit' = v_unit
    LIMIT 1;
    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'productId', v_source_id,
      'productCode', v_ingredient->>'productCode',
      'productName', v_ingredient->>'productName',
      'recipeCode', v_recipe_code,
      'recipeName', v_recipe->>'name',
      'stationKey', v_station,
      'quantity', v_quantity::text,
      'unit', v_unit,
      'ingredientSnapshot', coalesce(v_ingredient->'ingredientSnapshot',
        '{"status":"unknown","reason":"missing-link"}'::jsonb)
    ));
  END LOOP;
  RETURN v_result;
END
$$;

-- 0010-qc-substitutions.sql: function
CREATE OR REPLACE FUNCTION v2.qc_current_product_ingredient_snapshot(
  p_facility_id uuid,
  p_product_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_link v2.qc_ingredient_link_events%ROWTYPE;
  v_catalog v2.setup_ingredient_records%ROWTYPE;
BEGIN
  SELECT * INTO v_link
  FROM v2.qc_ingredient_link_events
  WHERE facility_id = p_facility_id AND product_id = p_product_id
  ORDER BY occurred_at DESC, id DESC
  LIMIT 1;
  IF NOT FOUND OR v_link.action <> 'linked' THEN
    RETURN '{"status":"unknown","reason":"missing-link"}'::jsonb;
  END IF;
  SELECT * INTO v_catalog
  FROM v2.setup_ingredient_records
  WHERE facility_id = p_facility_id
    AND code = v_link.ingredient_code
    AND data->>'enabled' = 'true'
    AND merged_into_code IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'status', 'unknown',
      'reason', 'canonical-ingredient-unavailable',
      'linkEventId', v_link.id
    );
  END IF;
  RETURN jsonb_build_object(
    'status', 'linked',
    'ingredientCode', v_catalog.code,
    'ingredientName', v_catalog.name,
    'allergens', v_catalog.data->'allergens',
    'allergensReviewed', v_catalog.data->'allergensReviewed',
    'linkEventId', v_link.id,
    'ingredientUpdatedAt', v_catalog.updated_at
  );
END
$$;

-- 0010-qc-substitutions.sql: function
CREATE OR REPLACE FUNCTION v2.adjust_qc_substitution_inventory(
  p_facility_id uuid,
  p_warehouse_id uuid,
  p_run_id uuid,
  p_actor_id uuid,
  p_movement_group_id uuid,
  p_old_product_id uuid,
  p_old_quantity numeric,
  p_new_product_id uuid,
  p_new_quantity numeric,
  p_reason text,
  p_occurred_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_move record;
  v_balance v2.inventory_balances%ROWTYPE;
BEGIN
  FOR v_move IN
    SELECT product_id, sum(delta)::numeric(20,6) AS delta
    FROM (
      SELECT p_old_product_id AS product_id, coalesce(p_old_quantity, 0)::numeric AS delta
      WHERE p_old_product_id IS NOT NULL
      UNION ALL
      SELECT p_new_product_id, -coalesce(p_new_quantity, 0)::numeric
      WHERE p_new_product_id IS NOT NULL
    ) AS changes
    GROUP BY product_id
    HAVING sum(delta) <> 0
    ORDER BY product_id
  LOOP
    INSERT INTO v2.inventory_balances (facility_id, warehouse_id, product_id)
    VALUES (p_facility_id, p_warehouse_id, v_move.product_id)
    ON CONFLICT DO NOTHING;
    SELECT * INTO v_balance
    FROM v2.inventory_balances
    WHERE facility_id = p_facility_id
      AND warehouse_id = p_warehouse_id
      AND product_id = v_move.product_id
    FOR UPDATE;
    IF v_move.delta < 0 AND v_balance.quantity < abs(v_move.delta) THEN
      RAISE EXCEPTION 'Insufficient stock for the approved substitution'
        USING ERRCODE = '22003';
    END IF;
    IF v_balance.revision >= 9007199254740991 THEN
      RAISE EXCEPTION 'Inventory revision is exhausted' USING ERRCODE = '22003';
    END IF;
    UPDATE v2.inventory_balances
    SET quantity = quantity + v_move.delta,
        revision = revision + 1,
        updated_at = p_occurred_at
    WHERE facility_id = p_facility_id
      AND warehouse_id = p_warehouse_id
      AND product_id = v_move.product_id;
    INSERT INTO v2.inventory_movements (
      facility_id, id, warehouse_id, product_id, movement_group_id, movement_type,
      quantity_delta, reason, actor_id, command_id, occurred_at, run_id
    ) VALUES (
      p_facility_id, gen_random_uuid(), p_warehouse_id, v_move.product_id,
      p_movement_group_id, 'adjustment', v_move.delta, p_reason, p_actor_id,
      'qc-substitution:' || p_movement_group_id::text || ':' || v_move.product_id::text,
      p_occurred_at, p_run_id
    );
  END LOOP;
END
$$;

-- 0010-qc-substitutions.sql: function
CREATE OR REPLACE FUNCTION v2.list_qc_component_products(
  p_facility_id uuid,
  p_actor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM v2.facility_scope
       WHERE singleton AND facility_id = p_facility_id
     ) THEN
    RAISE EXCEPTION 'Invalid QC component request' USING ERRCODE = '22023';
  END IF;
  IF NOT v2.actor_can_record_qc(p_actor_id) THEN
    RAISE EXCEPTION 'QC component access is not authorized' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'products', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'productId', selected.id,
        'productCode', selected.code,
        'productName', selected.name,
        'unit', selected.base_unit
      ) ORDER BY lower(selected.name), selected.code)
      FROM (
        SELECT product.id, product.code, product.name, product.base_unit
        FROM v2.products AS product
        WHERE product.facility_id = p_facility_id AND product.active
        ORDER BY lower(product.name), product.code
        LIMIT 2000
      ) AS selected
    ), '[]'::jsonb),
    'productsTruncated', (
      SELECT count(*) > 2000
      FROM v2.products AS product
      WHERE product.facility_id = p_facility_id AND product.active
    )
  );
END
$$;

-- 0010-qc-substitutions.sql: function
CREATE OR REPLACE FUNCTION v2.list_qc_run_substitutions(
  p_facility_id uuid,
  p_actor_id uuid,
  p_run_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL OR p_run_id IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM v2.facility_scope
       WHERE singleton AND facility_id = p_facility_id
     ) THEN
    RAISE EXCEPTION 'Invalid QC substitution request' USING ERRCODE = '22023';
  END IF;
  IF NOT v2.actor_can_record_qc(p_actor_id) THEN
    RAISE EXCEPTION 'QC substitution access is not authorized' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM v2.runs WHERE facility_id = p_facility_id AND id = p_run_id
  ) THEN
    RAISE EXCEPTION 'QC run is unavailable' USING ERRCODE = 'P0002';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', latest.id,
      'proposalEventId', latest.proposal_event_id,
      'revision', latest.revision,
      'sourceItems', latest.source_items,
      'sourceProductId', latest.source_product_id,
      'sourceProductCode', latest.source_product_code,
      'sourceProductName', latest.source_product_name,
      'sourceQuantity', latest.source_quantity::text,
      'sourceUnit', latest.source_unit,
      'stationKey', latest.station_key,
      'replacementProductId', latest.replacement_product_id,
      'replacementProductCode', latest.replacement_product_code,
      'replacementProductName', latest.replacement_product_name,
      'replacementQuantity', latest.replacement_quantity::text,
      'replacementUnit', latest.replacement_unit,
      'replacementIngredientSnapshot', latest.replacement_ingredient_snapshot,
      'actorId', latest.actor_id,
      'movementGroupId', latest.movement_group_id,
      'occurredAt', latest.occurred_at
    ) ORDER BY latest.occurred_at, latest.id)
    FROM (
      SELECT DISTINCT ON (substitution.proposal_event_id) substitution.*
      FROM v2.qc_run_substitutions AS substitution
      WHERE substitution.facility_id = p_facility_id
        AND substitution.run_id = p_run_id
      ORDER BY substitution.proposal_event_id, substitution.revision DESC
      LIMIT 200
    ) AS latest
  ), '[]'::jsonb);
END
$$;

-- 0010-qc-substitutions.sql: function
CREATE OR REPLACE FUNCTION v2.record_qc_substitution(
  p_facility_id uuid,
  p_actor_id uuid,
  p_run_id uuid,
  p_request_id text,
  p_request_hash text,
  p_action text,
  p_proposal_event_id uuid,
  p_target_substitution_id uuid,
  p_details jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_run v2.runs%ROWTYPE;
  v_proposal v2.qc_events%ROWTYPE;
  v_existing v2.qc_events%ROWTYPE;
  v_previous v2.qc_run_substitutions%ROWTYPE;
  v_current v2.qc_run_substitutions%ROWTYPE;
  v_source v2.products%ROWTYPE;
  v_replacement v2.products%ROWTYPE;
  v_warehouse v2.inventory_warehouses%ROWTYPE;
  v_balance v2.inventory_balances%ROWTYPE;
  v_event v2.qc_events%ROWTYPE;
  v_substitution v2.qc_run_substitutions%ROWTYPE;
  v_event_type text;
  v_payload jsonb;
  v_proposal_payload jsonb;
  v_source_id uuid;
  v_replacement_id uuid;
  v_source_code text;
  v_source_name text;
  v_source_unit text;
  v_replacement_code text;
  v_replacement_name text;
  v_replacement_unit text;
  v_source_quantity numeric(20,6);
  v_replacement_quantity numeric(20,6);
  v_movement_group uuid;
  v_now timestamptz;
  v_recipe jsonb;
  v_ingredient jsonb;
  v_found_source boolean := false;
  v_expected_keys text[];
  v_actual_keys text[];
  v_source_items jsonb;
  v_source_item jsonb;
  v_replacement_snapshot jsonb;
  v_old_replacement_id uuid;
  v_old_replacement_quantity numeric(20,6);
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL OR p_run_id IS NULL
     OR p_request_id IS NULL OR length(btrim(p_request_id)) NOT BETWEEN 1 AND 200
     OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$'
     OR p_action IS NULL OR p_action NOT IN ('propose', 'approve', 'reject', 'correct')
     OR p_details IS NULL OR jsonb_typeof(p_details) <> 'object'
     OR NOT EXISTS (
       SELECT 1 FROM v2.facility_scope
       WHERE singleton AND facility_id = p_facility_id
     ) THEN
    RAISE EXCEPTION 'Invalid QC substitution request' USING ERRCODE = '22023';
  END IF;

  IF NOT v2.actor_can_record_qc(p_actor_id)
     OR (p_action <> 'propose' AND NOT v2.actor_can_manage_qc(p_actor_id)) THEN
    RAISE EXCEPTION 'QC substitution action is not authorized' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_facility_id::text || ':' || p_actor_id::text || ':qc-substitution:' || p_request_id, 0
  ));
  SELECT * INTO v_existing
  FROM v2.qc_events
  WHERE facility_id = p_facility_id
    AND actor_id = p_actor_id
    AND request_id = p_request_id;
  IF FOUND THEN
    IF v_existing.request_hash <> p_request_hash
       OR v_existing.run_id IS DISTINCT FROM p_run_id
       OR v_existing.event_type NOT IN (
         'run-substitution-proposed', 'run-substitution-approved',
         'run-substitution-rejected', 'run-substitution-corrected'
       ) THEN
      RAISE EXCEPTION 'QC substitution request ID was reused with different details'
        USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object(
      'event', jsonb_build_object(
        'id', v_existing.id,
        'runId', v_existing.run_id,
        'actorId', v_existing.actor_id,
        'eventType', v_existing.event_type,
        'payload', v_existing.payload,
        'occurredAt', v_existing.occurred_at
      ),
      'replayed', true
    );
  END IF;

  SELECT * INTO v_run
  FROM v2.runs
  WHERE facility_id = p_facility_id AND id = p_run_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'QC run is unavailable' USING ERRCODE = 'P0002';
  END IF;
  IF v_run.status = 'completed' THEN
    RAISE EXCEPTION 'Completed runs cannot receive substitution changes'
      USING ERRCODE = '55000';
  END IF;

  IF p_action = 'propose' THEN
    v_expected_keys := ARRAY[
      'reason', 'replacementProductId', 'replacementQuantity', 'replacementUnit', 'sourceItems'
    ];
    SELECT array_agg(key ORDER BY key) INTO v_actual_keys
    FROM jsonb_object_keys(p_details) AS item(key);
    SELECT array_agg(key ORDER BY key) INTO v_expected_keys
    FROM unnest(v_expected_keys) AS item(key);
    IF v_actual_keys IS DISTINCT FROM v_expected_keys
       OR coalesce(p_details->>'replacementProductId', '') !~*
         '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR coalesce(p_details->>'replacementQuantity', '') !~ '^(0|[1-9][0-9]{0,13})(\.[0-9]{1,6})?$'
       OR (p_details->>'replacementQuantity')::numeric <= 0
       OR coalesce(p_details->>'replacementUnit', '') !~ '^[A-Za-z][A-Za-z0-9._/-]{0,15}$'
       OR length(btrim(coalesce(p_details->>'reason', ''))) NOT BETWEEN 3 AND 500 THEN
      RAISE EXCEPTION 'Invalid substitution proposal fields' USING ERRCODE = '22023';
    END IF;
    v_replacement_id := (p_details->>'replacementProductId')::uuid;
    v_replacement_unit := p_details->>'replacementUnit';
    v_replacement_quantity := (p_details->>'replacementQuantity')::numeric;
    v_source_items := v2.resolve_qc_substitution_sources(
      p_facility_id, v_run.setup_snapshot, p_details->'sourceItems'
    );
    v_source_item := v_source_items->0;
    v_source_id := (v_source_item->>'productId')::uuid;
    v_source_code := v_source_item->>'productCode';
    v_source_name := v_source_item->>'productName';
    v_source_unit := v_source_item->>'unit';
    v_source_quantity := (v_source_item->>'quantity')::numeric;
    SELECT * INTO v_replacement FROM v2.products
    WHERE facility_id = p_facility_id AND id = v_replacement_id AND active
    FOR SHARE;
    IF NOT FOUND OR v_replacement.base_unit <> v_replacement_unit THEN
      RAISE EXCEPTION 'The replacement must be an active product in its exact inventory unit'
        USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_source_items) AS source(value)
      WHERE source.value->>'productId' = v_replacement_id::text
    ) THEN
      RAISE EXCEPTION 'The replacement cannot be one of the source components'
        USING ERRCODE = '22023';
    END IF;
    v_event_type := 'run-substitution-proposed';
    v_payload := jsonb_build_object(
      'sourceItems', v_source_items,
      'sourceProductId', v_source_id,
      'sourceProductCode', v_source_code,
      'sourceProductName', v_source_name,
      'sourceQuantity', v_source_quantity::text,
      'sourceUnit', v_source_unit,
      'stationKey', v_source_item->>'stationKey',
      'replacementProductId', v_replacement.id,
      'replacementProductCode', v_replacement.code,
      'replacementProductName', v_replacement.name,
      'replacementQuantity', v_replacement_quantity::text,
      'replacementUnit', v_replacement_unit,
      'reason', btrim(p_details->>'reason')
    );
  ELSIF p_action = 'approve' OR p_action = 'reject' THEN
    IF p_proposal_event_id IS NULL THEN
      RAISE EXCEPTION 'Choose a substitution proposal' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_proposal
    FROM v2.qc_events
    WHERE facility_id = p_facility_id
      AND id = p_proposal_event_id
      AND run_id = p_run_id
      AND event_type = 'run-substitution-proposed'
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The substitution proposal is not available' USING ERRCODE = 'P0002';
    END IF;
    IF EXISTS (
      SELECT 1 FROM v2.qc_events
      WHERE facility_id = p_facility_id
        AND event_type IN ('run-substitution-approved', 'run-substitution-rejected')
        AND payload->>'proposalEventId' = p_proposal_event_id::text
    ) THEN
      RAISE EXCEPTION 'The substitution proposal already has a decision'
        USING ERRCODE = '55000';
    END IF;
    IF p_action = 'reject' THEN
      IF (p_details - ARRAY['reason']) <> '{}'::jsonb
         OR length(btrim(coalesce(p_details->>'reason', ''))) NOT BETWEEN 3 AND 500 THEN
        RAISE EXCEPTION 'A rejection reason is required' USING ERRCODE = '22023';
      END IF;
      v_event_type := 'run-substitution-rejected';
      v_payload := jsonb_build_object(
        'proposalEventId', p_proposal_event_id,
        'reason', btrim(p_details->>'reason')
      );
    ELSE
      IF p_details <> '{}'::jsonb THEN
        RAISE EXCEPTION 'Approval does not accept replacement values' USING ERRCODE = '22023';
      END IF;
      v_proposal_payload := v_proposal.payload;
      SELECT * INTO v_warehouse
      FROM v2.inventory_warehouses
      WHERE facility_id = p_facility_id
        AND id = (v_run.setup_snapshot->'productionPlan'->'warehouse'->>'id')::uuid
        AND active AND is_production
      FOR UPDATE;
      IF NOT FOUND OR NOT EXISTS (
        SELECT 1 FROM v2.opening_counts
        WHERE facility_id = p_facility_id
          AND warehouse_id = v_warehouse.id
          AND status = 'applied'
      ) THEN
        RAISE EXCEPTION 'The run production warehouse is unavailable'
          USING ERRCODE = '55000';
      END IF;
      v_replacement_id := (v_proposal_payload->>'replacementProductId')::uuid;
      v_replacement_quantity := (v_proposal_payload->>'replacementQuantity')::numeric;
      SELECT * INTO v_replacement FROM v2.products
      WHERE facility_id = p_facility_id
        AND id = v_replacement_id AND active
      FOR SHARE;
      IF NOT FOUND OR v_replacement.base_unit <> v_proposal_payload->>'replacementUnit' THEN
        RAISE EXCEPTION 'The replacement product or its unit changed; submit the proposal again'
          USING ERRCODE = '40001';
      END IF;
      v_replacement_snapshot := v2.qc_current_product_ingredient_snapshot(
        p_facility_id, v_replacement_id
      );
      v_now := clock_timestamp();
      v_movement_group := gen_random_uuid();
      v_event_type := 'run-substitution-approved';
      v_payload := v_proposal_payload || jsonb_build_object(
        'proposalEventId', p_proposal_event_id,
        'movementGroupId', v_movement_group,
        'approvedAt', v_now,
        'replacementIngredientSnapshot', v_replacement_snapshot
      );
      PERFORM v2.adjust_qc_substitution_inventory(
        p_facility_id, v_warehouse.id, p_run_id, p_actor_id,
        v_movement_group, NULL, 0, v_replacement_id, v_replacement_quantity,
        'QC-approved substitution for run ' || p_run_id::text, v_now
      );
      INSERT INTO v2.qc_events (
        facility_id, id, run_id, actor_id, request_id, request_hash, event_type, payload, occurred_at
      ) VALUES (
        p_facility_id, v_movement_group, p_run_id, p_actor_id, p_request_id,
        p_request_hash, v_event_type, v_payload, v_now
      ) RETURNING * INTO v_event;
      INSERT INTO v2.qc_run_substitutions (
        facility_id, id, run_id, proposal_event_id, revision,
        source_product_id, source_product_code, source_product_name, source_quantity, source_unit, station_key,
        source_items,
        replacement_product_id, replacement_product_code, replacement_product_name,
        replacement_quantity, replacement_unit, replacement_ingredient_snapshot,
        actor_id, request_id, request_hash,
        movement_group_id, occurred_at
      ) VALUES (
        p_facility_id, gen_random_uuid(), p_run_id, p_proposal_event_id, 1,
        (v_proposal_payload->>'sourceProductId')::uuid,
        v_proposal_payload->>'sourceProductCode',
        v_proposal_payload->>'sourceProductName',
        (v_proposal_payload->>'sourceQuantity')::numeric,
        v_proposal_payload->>'sourceUnit',
        v_proposal_payload->>'stationKey',
        v_proposal_payload->'sourceItems',
        v_replacement.id, v_replacement.code, v_replacement.name,
        v_replacement_quantity, v_replacement.base_unit, v_replacement_snapshot, p_actor_id,
        p_request_id, p_request_hash, v_movement_group, v_now
      ) RETURNING * INTO v_substitution;
      RETURN jsonb_build_object(
        'event', jsonb_build_object(
          'id', v_event.id, 'runId', v_event.run_id, 'actorId', v_event.actor_id,
          'eventType', v_event.event_type, 'payload', v_event.payload,
          'occurredAt', v_event.occurred_at
        ),
        'substitution', jsonb_build_object(
          'id', v_substitution.id, 'movementGroupId', v_substitution.movement_group_id,
          'replacementProductId', v_substitution.replacement_product_id,
          'replacementQuantity', v_substitution.replacement_quantity::text,
          'replacementUnit', v_substitution.replacement_unit
        ),
        'replayed', false
      );
    END IF;
  ELSE
    IF p_target_substitution_id IS NULL
       OR (p_details - ARRAY[
         'sourceItems', 'replacementProductId', 'replacementQuantity', 'replacementUnit', 'reason'
       ]) <> '{}'::jsonb THEN
      RAISE EXCEPTION 'Invalid substitution correction fields' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_previous
    FROM v2.qc_run_substitutions
    WHERE facility_id = p_facility_id AND id = p_target_substitution_id
      AND run_id = p_run_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The approved substitution is not available' USING ERRCODE = 'P0002';
    END IF;
    SELECT * INTO v_current
    FROM v2.qc_run_substitutions
    WHERE facility_id = p_facility_id
      AND proposal_event_id = v_previous.proposal_event_id
    ORDER BY revision DESC
    LIMIT 1
    FOR UPDATE;
    IF coalesce(p_details->>'replacementProductId', '') !~*
         '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR coalesce(p_details->>'replacementQuantity', '') !~ '^(0|[1-9][0-9]{0,13})(\.[0-9]{1,6})?$'
       OR (p_details->>'replacementQuantity')::numeric <= 0
       OR coalesce(p_details->>'replacementUnit', '') !~ '^[A-Za-z][A-Za-z0-9._/-]{0,15}$'
       OR length(btrim(coalesce(p_details->>'reason', ''))) NOT BETWEEN 3 AND 500 THEN
      RAISE EXCEPTION 'Invalid substitution correction values' USING ERRCODE = '22023';
    END IF;
    v_source_items := v2.resolve_qc_substitution_sources(
      p_facility_id, v_run.setup_snapshot, p_details->'sourceItems'
    );
    v_source_item := v_source_items->0;
    v_source_id := (v_source_item->>'productId')::uuid;
    v_source_code := v_source_item->>'productCode';
    v_source_name := v_source_item->>'productName';
    v_source_unit := v_source_item->>'unit';
    v_source_quantity := (v_source_item->>'quantity')::numeric;
    v_replacement_id := (p_details->>'replacementProductId')::uuid;
    v_replacement_unit := p_details->>'replacementUnit';
    v_replacement_quantity := (p_details->>'replacementQuantity')::numeric;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_source_items) AS source(value)
      WHERE source.value->>'productId' = v_replacement_id::text
    ) THEN
      RAISE EXCEPTION 'The replacement cannot be one of the source components'
        USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_replacement FROM v2.products
    WHERE facility_id = p_facility_id AND id = v_replacement_id AND active FOR SHARE;
    IF NOT FOUND OR v_replacement.base_unit <> v_replacement_unit THEN
      RAISE EXCEPTION 'The corrected replacement must use its exact active inventory unit'
        USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_warehouse
    FROM v2.inventory_warehouses
    WHERE facility_id = p_facility_id
      AND id = (v_run.setup_snapshot->'productionPlan'->'warehouse'->>'id')::uuid
      AND active AND is_production
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The run production warehouse is unavailable'
        USING ERRCODE = '55000';
    END IF;
    v_replacement_snapshot := v2.qc_current_product_ingredient_snapshot(
      p_facility_id, v_replacement_id
    );
    v_movement_group := gen_random_uuid();
    v_event_type := 'run-substitution-corrected';
    v_now := clock_timestamp();
    v_payload := jsonb_build_object(
      'targetSubstitutionId', v_previous.id,
      'proposalEventId', v_previous.proposal_event_id,
      'sourceItems', v_source_items,
      'sourceProductId', v_source_id,
      'sourceProductCode', v_source_code,
      'sourceProductName', v_source_name,
      'sourceQuantity', v_source_quantity::text,
      'sourceUnit', v_source_unit,
      'stationKey', v_source_item->>'stationKey',
      'replacementProductId', v_replacement.id,
      'replacementProductCode', v_replacement.code,
      'replacementProductName', v_replacement.name,
      'replacementQuantity', v_replacement_quantity::text,
      'replacementUnit', v_replacement.base_unit,
      'replacementIngredientSnapshot', v_replacement_snapshot,
      'reason', btrim(p_details->>'reason'),
      'movementGroupId', v_movement_group
    );
    INSERT INTO v2.qc_events (
      facility_id, id, run_id, actor_id, request_id, request_hash, event_type, payload, occurred_at
    ) VALUES (
      p_facility_id, v_movement_group, p_run_id, p_actor_id, p_request_id,
      p_request_hash, v_event_type, v_payload, v_now
    ) RETURNING * INTO v_event;
    INSERT INTO v2.qc_run_substitutions (
      facility_id, id, run_id, proposal_event_id, revision, prior_substitution_id,
      source_product_id, source_product_code, source_product_name, source_quantity, source_unit, station_key,
      source_items,
      replacement_product_id, replacement_product_code, replacement_product_name,
      replacement_quantity, replacement_unit, replacement_ingredient_snapshot,
      actor_id, request_id, request_hash,
      movement_group_id, occurred_at
    ) VALUES (
      p_facility_id, gen_random_uuid(), p_run_id, v_previous.proposal_event_id,
      v_current.revision + 1, v_current.id,
      v_source_id, v_source_code, v_source_name, v_source_quantity, v_source_unit,
      v_source_item->>'stationKey',
      v_source_items,
      v_replacement.id, v_replacement.code, v_replacement.name,
      v_replacement_quantity, v_replacement.base_unit, v_replacement_snapshot, p_actor_id,
      p_request_id, p_request_hash, v_movement_group, v_now
    ) RETURNING * INTO v_substitution;

    PERFORM v2.adjust_qc_substitution_inventory(
      p_facility_id, v_warehouse.id, p_run_id, p_actor_id,
      v_movement_group, v_current.replacement_product_id,
      v_current.replacement_quantity, v_replacement.id,
      v_replacement_quantity, 'QC substitution correction for run ' || p_run_id::text,
      v_now
    );
    RETURN jsonb_build_object(
      'event', jsonb_build_object(
        'id', v_event.id, 'runId', v_event.run_id, 'actorId', v_event.actor_id,
        'eventType', v_event.event_type, 'payload', v_event.payload,
        'occurredAt', v_event.occurred_at
      ),
      'substitution', jsonb_build_object(
        'id', v_substitution.id, 'movementGroupId', v_substitution.movement_group_id
      ),
      'replayed', false
    );
  END IF;

  v_now := clock_timestamp();
  INSERT INTO v2.qc_events (
    facility_id, run_id, actor_id, request_id, request_hash, event_type, payload, occurred_at
  ) VALUES (
    p_facility_id, p_run_id, p_actor_id, p_request_id, p_request_hash,
    v_event_type, v_payload, v_now
  ) RETURNING * INTO v_event;
  RETURN jsonb_build_object(
    'event', jsonb_build_object(
      'id', v_event.id, 'runId', v_event.run_id, 'actorId', v_event.actor_id,
      'eventType', v_event.event_type, 'payload', v_event.payload,
      'occurredAt', v_event.occurred_at
    ),
    'replayed', false
  );
END
$$;

-- 0010-qc-substitutions.sql: function
CREATE OR REPLACE FUNCTION v2.apply_run_inventory_consumption(
  p_facility_id uuid,
  p_run_id uuid,
  p_actor_id uuid,
  p_plan jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_warehouse_id uuid;
  v_warehouse_name text;
  v_balance v2.inventory_balances%ROWTYPE;
  v_demand record;
  v_deducted numeric;
  v_shortfall numeric;
  v_lines jsonb := '[]'::jsonb;
  v_substitutions jsonb := '[]'::jsonb;
  v_component_demand jsonb := '[]'::jsonb;
  v_detail jsonb;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_facility_id IS NULL OR p_run_id IS NULL OR p_actor_id IS NULL
     OR jsonb_typeof(p_plan) IS DISTINCT FROM 'object'
     OR NOT EXISTS (
       SELECT 1 FROM v2.facility_scope WHERE singleton AND facility_id = p_facility_id
     ) THEN
    RAISE EXCEPTION 'Invalid run inventory scope' USING ERRCODE = '42501';
  END IF;
  BEGIN
    v_warehouse_id := (p_plan->'warehouse'->>'id')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Invalid run inventory warehouse' USING ERRCODE = '22023';
  END;
  SELECT w.name INTO v_warehouse_name
  FROM v2.inventory_warehouses AS w
  WHERE w.facility_id = p_facility_id AND w.id = v_warehouse_id
    AND w.active AND EXISTS (
      SELECT 1 FROM v2.opening_counts AS c
      WHERE c.facility_id = w.facility_id AND c.warehouse_id = w.id AND c.status = 'applied'
    )
  FOR UPDATE;
  IF v_warehouse_name IS NULL THEN
    RAISE EXCEPTION 'The run production warehouse is unavailable' USING ERRCODE = '55000';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', substitution.id,
    'proposalEventId', substitution.proposal_event_id,
    'revision', substitution.revision,
    'sourceItems', substitution.source_items,
    'sourceProductId', substitution.source_product_id,
    'sourceProductCode', substitution.source_product_code,
    'sourceProductName', substitution.source_product_name,
    'sourceQuantity', substitution.source_quantity::text,
    'sourceUnit', substitution.source_unit,
    'stationKey', substitution.station_key,
    'replacementProductId', substitution.replacement_product_id,
    'replacementProductCode', substitution.replacement_product_code,
    'replacementProductName', substitution.replacement_product_name,
    'replacementQuantity', substitution.replacement_quantity::text,
    'replacementUnit', substitution.replacement_unit,
    'replacementIngredientSnapshot', substitution.replacement_ingredient_snapshot,
    'movementGroupId', substitution.movement_group_id,
    'approvedBy', substitution.actor_id,
    'approvedAt', substitution.occurred_at
  ) ORDER BY substitution.occurred_at, substitution.id), '[]'::jsonb)
  INTO v_substitutions
  FROM (
    SELECT DISTINCT ON (record.proposal_event_id) record.*
    FROM v2.qc_run_substitutions AS record
    WHERE record.facility_id = p_facility_id AND record.run_id = p_run_id
    ORDER BY record.proposal_event_id, record.revision DESC
  ) AS substitution;

  WITH station_counts AS (
    SELECT s.station_key,
      CASE
        WHEN s.station_key = 'sauce' AND s.progress->>'barrelsMade' ~ '^[0-9]+$'
          THEN (s.progress->>'barrelsMade')::numeric
        WHEN s.progress->>'batchesMade' ~ '^[0-9]+$'
          THEN (s.progress->>'batchesMade')::numeric
        ELSE 0::numeric
      END AS quantity
    FROM v2.run_station_progress AS s
    WHERE s.facility_id = p_facility_id AND s.run_id = p_run_id
  ),
  source_demand AS (
    SELECT
      (ingredient.value->>'productId')::uuid AS product_id,
      ingredient.value->>'productCode' AS product_code,
      ingredient.value->>'productName' AS product_name,
      ingredient.value->>'unit' AS unit,
      recipe.value->>'code' AS recipe_code,
      recipe.value->>'name' AS recipe_name,
      recipe.value->>'stationKey' AS station_key,
      sum((ingredient.value->>'quantity')::numeric * station.quantity) AS required
    FROM jsonb_array_elements(p_plan->'recipes') AS recipe(value)
    JOIN station_counts AS station ON station.station_key = recipe.value->>'stationKey'
    CROSS JOIN LATERAL jsonb_array_elements(recipe.value->'ingredients') AS ingredient(value)
    GROUP BY ingredient.value->>'productId', ingredient.value->>'productCode',
      ingredient.value->>'productName', ingredient.value->>'unit',
      recipe.value->>'code', recipe.value->>'name', recipe.value->>'stationKey'
  ),
  source_replacements AS (
    SELECT source.value->>'productId' AS product_id,
      source.value->>'recipeCode' AS recipe_code,
      source.value->>'stationKey' AS station_key,
      source.value->>'unit' AS unit,
      sum((source.value->>'quantity')::numeric) AS replaced
    FROM (
      SELECT DISTINCT ON (record.proposal_event_id) record.*
      FROM v2.qc_run_substitutions AS record
      WHERE record.facility_id = p_facility_id AND record.run_id = p_run_id
      ORDER BY record.proposal_event_id, record.revision DESC
    ) AS substitution
    CROSS JOIN LATERAL jsonb_array_elements(substitution.source_items) AS source(value)
    GROUP BY source.value->>'productId', source.value->>'recipeCode',
      source.value->>'stationKey', source.value->>'unit'
  ),
  effective_components AS (
    SELECT source.*,
      greatest(0::numeric, source.required - coalesce(replacement.replaced, 0::numeric)) AS remaining
    FROM source_demand AS source
    LEFT JOIN source_replacements AS replacement
      ON replacement.product_id = source.product_id::text
     AND replacement.recipe_code = source.recipe_code
     AND replacement.station_key = source.station_key
     AND replacement.unit = source.unit
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'productId', component.product_id,
    'productCode', component.product_code,
    'productName', component.product_name,
    'recipeCode', component.recipe_code,
    'recipeName', component.recipe_name,
    'stationKey', component.station_key,
    'unit', component.unit,
    'plannedQuantity', component.required::text,
    'replacedQuantity', greatest(0::numeric, component.required - component.remaining)::text,
    'remainingQuantity', component.remaining::text
  ) ORDER BY component.station_key, component.recipe_code, component.product_id), '[]'::jsonb)
  INTO v_component_demand
  FROM effective_components AS component;

  FOR v_demand IN
    WITH station_counts AS (
      SELECT s.station_key,
        CASE
          WHEN s.station_key = 'sauce' AND s.progress->>'barrelsMade' ~ '^[0-9]+$'
            THEN (s.progress->>'barrelsMade')::numeric
          WHEN s.progress->>'batchesMade' ~ '^[0-9]+$'
            THEN (s.progress->>'batchesMade')::numeric
          ELSE 0::numeric
        END AS quantity
      FROM v2.run_station_progress AS s
      WHERE s.facility_id = p_facility_id AND s.run_id = p_run_id
    ),
    source_demand AS (
      SELECT
        (ingredient.value->>'productId')::uuid AS product_id,
        ingredient.value->>'productCode' AS product_code,
        ingredient.value->>'productName' AS product_name,
        ingredient.value->>'unit' AS unit,
        recipe.value->>'code' AS recipe_code,
        recipe.value->>'stationKey' AS station_key,
        sum((ingredient.value->>'quantity')::numeric * station.quantity) AS required
      FROM jsonb_array_elements(p_plan->'recipes') AS recipe(value)
      JOIN station_counts AS station ON station.station_key = recipe.value->>'stationKey'
      CROSS JOIN LATERAL jsonb_array_elements(recipe.value->'ingredients') AS ingredient(value)
      GROUP BY ingredient.value->>'productId', ingredient.value->>'productCode',
        ingredient.value->>'productName', ingredient.value->>'unit',
        recipe.value->>'code', recipe.value->>'stationKey'
    ),
    substituted_source_amounts AS (
      SELECT
        source.value->>'productId' AS product_id,
        source.value->>'recipeCode' AS recipe_code,
        source.value->>'stationKey' AS station_key,
        source.value->>'unit' AS unit,
        sum((source.value->>'quantity')::numeric) AS replaced
      FROM (
        SELECT DISTINCT ON (record.proposal_event_id) record.*
        FROM v2.qc_run_substitutions AS record
        WHERE record.facility_id = p_facility_id AND record.run_id = p_run_id
        ORDER BY record.proposal_event_id, record.revision DESC
      ) AS substitution
      CROSS JOIN LATERAL jsonb_array_elements(substitution.source_items) AS source(value)
      GROUP BY source.value->>'productId', source.value->>'recipeCode',
        source.value->>'stationKey', source.value->>'unit'
    ),
    adjusted_recipe_demand AS (
      SELECT
        source.product_id, source.product_code, source.product_name, source.unit,
        greatest(0::numeric, source.required - coalesce(substitution.replaced, 0::numeric)) AS required
      FROM source_demand AS source
      LEFT JOIN substituted_source_amounts AS substitution
        ON substitution.product_id = source.product_id::text
       AND substitution.recipe_code = source.recipe_code
       AND substitution.station_key = source.station_key
       AND substitution.unit = source.unit
    ),
    packed_cases AS (
      SELECT coalesce(max(
        CASE WHEN s.progress->>'casesPacked' ~ '^[0-9]+$'
          THEN (s.progress->>'casesPacked')::numeric ELSE 0::numeric END
      ), 0::numeric) AS quantity
      FROM v2.run_station_progress AS s
      WHERE s.facility_id = p_facility_id AND s.run_id = p_run_id AND s.station_key = 'packaging'
    ),
    packaging_demand AS (
      SELECT (line.value->>'productId')::uuid AS product_id,
        line.value->>'productCode' AS product_code,
        line.value->>'productName' AS product_name,
        line.value->>'unit' AS unit,
        sum((line.value->>'quantity')::numeric * packed_cases.quantity) AS required
      FROM jsonb_array_elements(p_plan->'packagingPerCase') AS line(value)
      CROSS JOIN packed_cases
      GROUP BY line.value->>'productId', line.value->>'productCode',
        line.value->>'productName', line.value->>'unit'
    ),
    combined AS (
      SELECT product_id, product_code, product_name, unit, required FROM adjusted_recipe_demand
      UNION ALL
      SELECT product_id, product_code, product_name, unit, required FROM packaging_demand
    )
    SELECT product_id, product_code, product_name, unit, sum(required) AS required
    FROM combined
    WHERE required > 0
    GROUP BY product_id, product_code, product_name, unit
    ORDER BY product_id
  LOOP
    INSERT INTO v2.inventory_balances (facility_id, warehouse_id, product_id)
    VALUES (p_facility_id, v_warehouse_id, v_demand.product_id)
    ON CONFLICT DO NOTHING;
    SELECT * INTO v_balance FROM v2.inventory_balances AS b
    WHERE b.facility_id = p_facility_id
      AND b.warehouse_id = v_warehouse_id AND b.product_id = v_demand.product_id
    FOR UPDATE;
    v_deducted := least(v_demand.required, v_balance.quantity);
    v_shortfall := v_demand.required - v_deducted;
    IF v_deducted > 0 THEN
      IF v_balance.revision >= 9007199254740991 THEN
        RAISE EXCEPTION 'Inventory revision is exhausted' USING ERRCODE = '22003';
      END IF;
      UPDATE v2.inventory_balances
      SET quantity = quantity - v_deducted, revision = revision + 1, updated_at = v_now
      WHERE facility_id = p_facility_id
        AND warehouse_id = v_warehouse_id AND product_id = v_demand.product_id;
      INSERT INTO v2.inventory_movements (
        facility_id, warehouse_id, product_id, movement_group_id, movement_type,
        quantity_delta, reason, actor_id, command_id, occurred_at, run_id
      ) VALUES (
        p_facility_id, v_warehouse_id, v_demand.product_id, p_run_id, 'run_consumption',
        -v_deducted, 'Run completion inventory use', p_actor_id,
        'run:' || p_run_id::text || ':' || v_demand.product_id::text, v_now, p_run_id
      );
    END IF;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'productId', v_demand.product_id, 'productCode', v_demand.product_code,
      'productName', v_demand.product_name, 'unit', v_demand.unit,
      'required', v_demand.required::text, 'deducted', v_deducted::text,
      'shortfall', v_shortfall::text
    ));
  END LOOP;

  v_detail := jsonb_build_object(
    'status', 'completed',
    'runId', p_run_id,
    'warehouseId', v_warehouse_id,
    'warehouseName', v_warehouse_name,
    'lines', v_lines,
    'componentDemand', v_component_demand,
    'qcSubstitutions', v_substitutions,
    'occurredAt', to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
  INSERT INTO v2.run_inventory_consumptions (
    facility_id, run_id, warehouse_id, actor_id, details, occurred_at
  ) VALUES (p_facility_id, p_run_id, v_warehouse_id, p_actor_id, v_detail, v_now);
  RETURN v_detail;
END
$$;

-- 0010-qc-substitutions.sql: permissions
REVOKE ALL ON TABLE v2.qc_run_substitutions FROM PUBLIC;

-- 0010-qc-substitutions.sql: permissions
REVOKE ALL ON FUNCTION v2.prevent_qc_run_substitution_mutation() FROM PUBLIC;

-- 0010-qc-substitutions.sql: permissions
REVOKE ALL ON FUNCTION v2.resolve_qc_substitution_sources(uuid, jsonb, jsonb) FROM PUBLIC;

-- 0010-qc-substitutions.sql: permissions
REVOKE ALL ON FUNCTION v2.qc_current_product_ingredient_snapshot(uuid, uuid) FROM PUBLIC;

-- 0010-qc-substitutions.sql: permissions
REVOKE ALL ON FUNCTION v2.adjust_qc_substitution_inventory(uuid, uuid, uuid, uuid, uuid, uuid, numeric, uuid, numeric, text, timestamptz) FROM PUBLIC;

-- 0010-qc-substitutions.sql: permissions
REVOKE ALL ON FUNCTION v2.list_qc_component_products(uuid, uuid) FROM PUBLIC;

-- 0010-qc-substitutions.sql: permissions
REVOKE ALL ON FUNCTION v2.list_qc_run_substitutions(uuid, uuid, uuid) FROM PUBLIC;

-- 0010-qc-substitutions.sql: permissions
REVOKE ALL ON FUNCTION v2.record_qc_substitution(uuid, uuid, uuid, text, text, text, uuid, uuid, jsonb) FROM PUBLIC;

-- 0010-qc-substitutions.sql: permissions
REVOKE ALL ON FUNCTION v2.apply_run_inventory_consumption(uuid, uuid, uuid, jsonb) FROM PUBLIC;

-- 0010-qc-substitutions.sql: function comment
COMMENT ON FUNCTION v2.record_qc_substitution(uuid, uuid, uuid, text, text, text, uuid, uuid, jsonb) IS
  'Records QC substitution proposals and decisions; approvals atomically post the replacement inventory movement.';

-- 0010-workbook-link-corrections.sql: function
CREATE OR REPLACE FUNCTION v2.dough_capacity_snapshot(p_facility_id uuid, p_product_code text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
  WITH selected_product AS (
    SELECT p.code
    FROM v2.products AS p
    WHERE p.facility_id = p_facility_id
      AND p.code = p_product_code
      AND p.active
  ),
  dough AS (
    SELECT
      count(*) AS row_count,
      CASE WHEN count(*) = 1 THEN min(
        CASE
          WHEN jsonb_typeof(m.data->'doughballYield') = 'number'
            AND m.data->>'doughballYield' ~ '^[0-9]+(\.[0-9]{1,6})?$'
          THEN (m.data->>'doughballYield')::numeric
          ELSE NULL
        END
      ) END AS doughball_yield
    FROM v2.master_records AS m
    JOIN selected_product AS p ON p.code = m.product_code
    WHERE m.facility_id = p_facility_id
      AND m.kind = 'recipes'
      AND m.data->>'sourceFamily' = 'dough-procedure'
      AND m.data->'capacitySourceCleared' IS DISTINCT FROM 'true'::jsonb
  ),
  shipping AS (
    SELECT
      count(*) AS row_count,
      CASE WHEN count(*) = 1 THEN min(
        CASE
          WHEN jsonb_typeof(m.data->'pizzasPerCase') = 'number'
            AND m.data->>'pizzasPerCase' ~ '^[1-9][0-9]*$'
          THEN (m.data->>'pizzasPerCase')::integer
          ELSE NULL
        END
      ) END AS pizzas_per_case
    FROM v2.master_records AS m
    JOIN selected_product AS p ON p.code = m.product_code
    WHERE m.facility_id = p_facility_id
      AND m.kind = 'production-setups'
      AND m.data->>'sourceFamily' = 'shipping-guide'
      AND m.data->'capacitySourceCleared' IS DISTINCT FROM 'true'::jsonb
  ),
  status AS (
    SELECT
      EXISTS (SELECT 1 FROM selected_product) AS product_found,
      dough.row_count AS dough_count,
      dough.doughball_yield,
      shipping.row_count AS shipping_count,
      shipping.pizzas_per_case
    FROM dough CROSS JOIN shipping
  )
  SELECT jsonb_build_object(
    'status', CASE
      WHEN product_found
        AND dough_count = 1
        AND shipping_count = 1
        AND doughball_yield BETWEEN 0.000001 AND 1000000
        AND pizzas_per_case BETWEEN 1 AND 100
        AND round(doughball_yield / pizzas_per_case, 4) > 0
      THEN 'available'
      ELSE 'unavailable'
    END,
    'reasons', to_jsonb(array_remove(ARRAY[
      CASE WHEN NOT product_found THEN 'product_not_selected' END,
      CASE WHEN product_found AND dough_count = 0 THEN 'dough_source_missing' END,
      CASE WHEN product_found AND dough_count > 1 THEN 'dough_source_ambiguous' END,
      CASE WHEN product_found AND dough_count = 1
        AND (doughball_yield IS NULL OR doughball_yield NOT BETWEEN 0.000001 AND 1000000
          OR (pizzas_per_case BETWEEN 1 AND 100 AND round(doughball_yield / pizzas_per_case, 4) <= 0))
        THEN 'dough_yield_invalid' END,
      CASE WHEN product_found AND shipping_count = 0 THEN 'shipping_source_missing' END,
      CASE WHEN product_found AND shipping_count > 1 THEN 'shipping_source_ambiguous' END,
      CASE WHEN product_found AND shipping_count = 1
        AND (pizzas_per_case IS NULL OR pizzas_per_case NOT BETWEEN 1 AND 100)
        THEN 'pizzas_per_case_invalid' END
    ], NULL)),
    'doughballYield', CASE
      WHEN dough_count = 1 AND doughball_yield BETWEEN 0.000001 AND 1000000
        AND pizzas_per_case BETWEEN 1 AND 100
        AND round(doughball_yield / pizzas_per_case, 4) > 0
      THEN doughball_yield ELSE NULL END,
    'pizzasPerCase', CASE
      WHEN shipping_count = 1 AND pizzas_per_case BETWEEN 1 AND 100
      THEN pizzas_per_case ELSE NULL END
  )
  FROM status
$$;

-- 0010-workbook-link-corrections.sql: function
CREATE OR REPLACE FUNCTION v2.correct_workbook_source_link(
  p_facility_id uuid,
  p_actor_id uuid,
  p_request_id text,
  p_request_hash text,
  p_source_family text,
  p_source_key text,
  p_expected_product_code text,
  p_product_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_existing_hash text;
  v_existing_response jsonb;
  v_source_id uuid;
  v_kind text;
  v_current_product_code text;
  v_previous_product_code text;
  v_target_product_code text;
  v_source_count integer;
  v_response jsonb;
  v_now timestamptz;
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM v2.facility_scope
       WHERE singleton AND facility_id = p_facility_id
     ) THEN
    RAISE EXCEPTION 'Invalid workbook link facility scope' USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL OR length(btrim(p_request_id)) NOT BETWEEN 1 AND 200
     OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$'
     OR p_source_family NOT IN ('dough-procedure', 'shipping-guide')
     OR p_source_key IS NULL OR p_source_key !~ '^[0-9a-f]{64}$'
     OR (p_expected_product_code IS NOT NULL
       AND p_expected_product_code !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$')
     OR (p_product_code IS NOT NULL
       AND p_product_code !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$') THEN
    RAISE EXCEPTION 'Invalid workbook link correction' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_facility_id::text || ':' || p_actor_id::text || ':workbook-link:' || p_request_id, 0)
  );
  SELECT request_hash, response
    INTO v_existing_hash, v_existing_response
    FROM v2.command_receipts
    WHERE facility_id = p_facility_id
      AND actor_id = p_actor_id
      AND command_id = p_request_id;
  IF FOUND THEN
    IF v_existing_hash <> p_request_hash THEN
      RAISE EXCEPTION 'Workbook link request ID was reused with different details'
        USING ERRCODE = '22023';
    END IF;
    RETURN v_existing_response || jsonb_build_object('replayed', true);
  END IF;

  v_kind := CASE p_source_family
    WHEN 'dough-procedure' THEN 'recipes'
    ELSE 'production-setups'
  END;

  SELECT count(*) INTO v_source_count
  FROM v2.master_records
  WHERE facility_id = p_facility_id
    AND kind = v_kind
    AND data->>'sourceFamily' = p_source_family
    AND data->>'sourceKey' = p_source_key;
  IF v_source_count <> 1 THEN
    RAISE EXCEPTION 'The saved workbook source is missing or ambiguous'
      USING ERRCODE = CASE WHEN v_source_count = 0 THEN 'P0002' ELSE '23514' END;
  END IF;

  SELECT id, product_code,
         CASE WHEN data->>'capacitySourceCleared' = 'true' THEN NULL ELSE product_code END
    INTO v_source_id, v_current_product_code, v_previous_product_code
    FROM v2.master_records
    WHERE facility_id = p_facility_id
      AND kind = v_kind
      AND data->>'sourceFamily' = p_source_family
      AND data->>'sourceKey' = p_source_key
    FOR UPDATE;
  IF v_previous_product_code IS DISTINCT FROM p_expected_product_code THEN
    RAISE EXCEPTION 'The saved workbook link changed while it was being reviewed'
      USING ERRCODE = '40001';
  END IF;
  IF (SELECT data->>'capacitySourceCleared'
      FROM v2.master_records
      WHERE facility_id = p_facility_id AND kind = v_kind AND id = v_source_id)
      = 'true'
     AND p_product_code IS NULL THEN
    v_response := jsonb_build_object(
      'outcome', 'unchanged',
      'sourceFamily', p_source_family,
      'sourceKey', p_source_key,
      'previousProductCode', NULL,
      'productCode', NULL,
      'replayed', false
    );
    v_now := clock_timestamp();
    INSERT INTO v2.command_receipts (facility_id, actor_id, command_id, request_hash, response, created_at)
    VALUES (p_facility_id, p_actor_id, p_request_id, p_request_hash, v_response, v_now);
    RETURN v_response;
  END IF;

  IF p_product_code IS NOT NULL THEN
    SELECT code INTO v_target_product_code
    FROM v2.products
    WHERE facility_id = p_facility_id
      AND lower(code) = lower(p_product_code)
      AND active
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Workbook link target must be an active product in this facility'
        USING ERRCODE = '23503';
    END IF;
  END IF;

  v_now := clock_timestamp();
  IF p_product_code IS NULL THEN
    UPDATE v2.master_records
    SET data = jsonb_set(data, '{capacitySourceCleared}', 'true'::jsonb, true),
        source_import_id = NULL,
        updated_at = v_now
    WHERE facility_id = p_facility_id AND kind = v_kind AND id = v_source_id;
    v_response := jsonb_build_object(
      'outcome', 'cleared',
      'sourceFamily', p_source_family,
      'sourceKey', p_source_key,
       'previousProductCode', v_previous_product_code,
      'productCode', NULL,
      'replayed', false
    );
  ELSIF p_expected_product_code IS NOT NULL
     AND lower(v_current_product_code) = lower(v_target_product_code) THEN
    v_response := jsonb_build_object(
      'outcome', 'unchanged',
      'sourceFamily', p_source_family,
      'sourceKey', p_source_key,
      'previousProductCode', v_previous_product_code,
      'productCode', v_previous_product_code,
      'replayed', false
    );
  ELSE
    UPDATE v2.master_records
    SET product_code = v_target_product_code,
        data = data - 'capacitySourceCleared',
        source_import_id = NULL,
        updated_at = v_now
    WHERE facility_id = p_facility_id AND kind = v_kind AND id = v_source_id;
    v_response := jsonb_build_object(
      'outcome', 'corrected',
      'sourceFamily', p_source_family,
      'sourceKey', p_source_key,
      'previousProductCode', v_previous_product_code,
      'productCode', v_target_product_code,
      'replayed', false
    );
  END IF;

  INSERT INTO v2.command_receipts (facility_id, actor_id, command_id, request_hash, response, created_at)
  VALUES (p_facility_id, p_actor_id, p_request_id, p_request_hash, v_response, v_now);
  RETURN v_response;
END
$$;

-- 0010-workbook-link-corrections.sql: function
CREATE OR REPLACE FUNCTION v2.list_workbook_source_links(p_facility_id uuid, p_source_family text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
BEGIN
  IF p_facility_id IS NULL OR p_source_family NOT IN ('dough-procedure', 'shipping-guide')
     OR NOT EXISTS (
       SELECT 1 FROM v2.facility_scope
       WHERE singleton AND facility_id = p_facility_id
     ) THEN
    RAISE EXCEPTION 'Invalid workbook source scope' USING ERRCODE = '42501';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'sourceKey', links.source_key,
      'productCode', links.product_code
    ) ORDER BY links.source_key)
    FROM (
      SELECT m.data->>'sourceKey' AS source_key, p.code AS product_code
      FROM v2.master_records AS m
      JOIN v2.products AS p
        ON p.facility_id = m.facility_id
        AND p.code = m.product_code
        AND p.active
      WHERE m.facility_id = p_facility_id
        AND m.data->>'sourceFamily' = p_source_family
        AND m.data->'capacitySourceCleared' IS DISTINCT FROM 'true'::jsonb
        AND m.data->>'sourceKey' ~ '^[0-9a-f]{64}$'
      UNION ALL
      SELECT m.data->>'sourceKey' AS source_key, NULL::text AS product_code
      FROM v2.master_records AS m
      WHERE m.facility_id = p_facility_id
        AND m.data->>'sourceFamily' = p_source_family
        AND m.data->'capacitySourceCleared' = 'true'::jsonb
        AND m.data->>'sourceKey' ~ '^[0-9a-f]{64}$'
    ) AS links
  ), '[]'::jsonb);
END
$$;

-- 0010-workbook-link-corrections.sql: permissions
REVOKE ALL ON FUNCTION v2.correct_workbook_source_link(uuid, uuid, text, text, text, text, text, text) FROM PUBLIC;

-- 0010-workbook-link-corrections.sql: permissions
REVOKE ALL ON FUNCTION v2.list_workbook_source_links(uuid, text) FROM PUBLIC;

-- 0010-workbook-link-corrections.sql: function comment
COMMENT ON FUNCTION v2.correct_workbook_source_link(uuid, uuid, text, text, text, text, text, text) IS
  'Manager-reviewed, facility-scoped workbook source link correction with expected-value protection and idempotent retries; corrections detach prior import ownership so guarded Undo cannot overwrite them.';

-- 0011-manager-operations.sql: function
CREATE OR REPLACE FUNCTION v2.prevent_manager_action_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, v2
AS $$
BEGIN
  RAISE EXCEPTION 'Manager action history is append-only'
    USING ERRCODE = '55000';
END
$$;

-- 0011-manager-operations.sql: repeat-safe trigger
DROP TRIGGER IF EXISTS manager_action_events_append_only ON v2.manager_action_events;
CREATE TRIGGER manager_action_events_append_only
  BEFORE UPDATE OR DELETE ON v2.manager_action_events
  FOR EACH ROW EXECUTE FUNCTION v2.prevent_manager_action_event_mutation();

-- 0011-manager-operations.sql: function
CREATE OR REPLACE FUNCTION v2.actor_can_review_operations(p_actor_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM v2.staff_accounts AS staff
    JOIN v2.user_roles AS user_role ON user_role.user_id = staff.id
    JOIN v2.roles AS role ON role.name = user_role.role_name
    WHERE staff.id = p_actor_id
      AND staff.disabled = false
      AND role.capabilities ? 'review-incidents'
  )
$$;

-- 0011-manager-operations.sql: function
CREATE OR REPLACE FUNCTION v2.get_manager_operations_snapshot(
  p_facility_id uuid,
  p_actor_id uuid,
  p_from_date date,
  p_to_date date,
  p_limit integer,
  p_before_created_at timestamptz DEFAULT NULL,
  p_before_run_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_from timestamptz;
  v_until timestamptz;
  v_runs jsonb;
  v_has_more boolean;
  v_next_cursor jsonb := NULL;
  v_summary jsonb;
  v_active_runs jsonb;
  v_pause_trend jsonb;
  v_event_patterns jsonb;
  v_actions jsonb;
  v_unknown_links integer;
  v_unknown_link_runs integer;
  v_run_event_count bigint;
  v_qc_event_count bigint;
  v_inventory_event_count bigint;
  v_import_count bigint;
  v_schedule_count bigint;
  v_action_count bigint;
  v_active_run_count bigint;
  v_runs_with_case_output bigint;
  v_runs_without_case_output bigint;
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL
     OR p_from_date IS NULL OR p_to_date IS NULL
     OR p_to_date < p_from_date OR p_to_date - p_from_date > 89
     OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100
     OR ((p_before_created_at IS NULL) <> (p_before_run_id IS NULL)) THEN
    RAISE EXCEPTION 'Invalid manager operations request' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM v2.facility_scope
    WHERE singleton AND facility_id = p_facility_id
  ) THEN
    RAISE EXCEPTION 'Manager operations scope is unavailable' USING ERRCODE = 'P0002';
  END IF;
  IF NOT v2.actor_can_review_operations(p_actor_id) THEN
    RAISE EXCEPTION 'Manager operations are not authorized' USING ERRCODE = '42501';
  END IF;

  v_from := p_from_date::timestamp AT TIME ZONE 'America/Chicago';
  v_until := (p_to_date + 1)::timestamp AT TIME ZONE 'America/Chicago';

  WITH page AS (
    SELECT r.id, r.created_at, r.status, r.revision, r.started_at, r.paused_at,
           r.completed_at, r.setup_snapshot
    FROM v2.runs AS r
    WHERE r.facility_id = p_facility_id
      AND r.created_at >= v_from AND r.created_at < v_until
      AND (p_before_created_at IS NULL OR (r.created_at, r.id) < (p_before_created_at, p_before_run_id))
    ORDER BY r.created_at DESC, r.id DESC
    LIMIT p_limit + 1
  ),
  visible AS (
    SELECT * FROM page
    ORDER BY created_at DESC, id DESC
    LIMIT p_limit
  )
  SELECT
    (SELECT count(*) > p_limit FROM page),
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'runId', visible.id,
        'label', visible.setup_snapshot->>'label',
        'status', visible.status,
        'revision', visible.revision,
        'targetCases', NULLIF(visible.setup_snapshot->>'targetCases', '')::bigint,
        'productCode', visible.setup_snapshot->>'productCode',
        'productionSetupCode', visible.setup_snapshot->>'productionSetupCode',
        'createdAt', visible.created_at,
        'startedAt', visible.started_at,
        'pausedAt', visible.paused_at,
        'completedAt', visible.completed_at
      ) ORDER BY visible.created_at DESC, visible.id DESC)
      FROM visible
    ), '[]'::jsonb),
    CASE WHEN (SELECT count(*) > p_limit FROM page) THEN (
      SELECT jsonb_build_object('createdAt', last_row.created_at, 'runId', last_row.id)
      FROM visible AS last_row
      ORDER BY last_row.created_at ASC, last_row.id ASC
      LIMIT 1
    ) ELSE NULL END
  INTO v_has_more, v_runs, v_next_cursor;

  SELECT jsonb_build_object(
    'runsCreated', count(*),
    'planned', count(*) FILTER (WHERE r.status = 'planned'),
    'running', count(*) FILTER (WHERE r.status = 'running'),
    'paused', count(*) FILTER (WHERE r.status = 'paused'),
    'completed', count(*) FILTER (WHERE r.status = 'completed'),
    'targetCases', COALESCE(sum(NULLIF(r.setup_snapshot->>'targetCases', '')::numeric), 0),
    'casesProduced', sum(CASE WHEN line.progress ? 'casesProduced'
      THEN NULLIF(line.progress->>'casesProduced', '')::numeric END),
    'runsWithRecordedCaseOutput', count(*) FILTER (WHERE line.progress ? 'casesProduced'),
    'runsWithoutRecordedCaseOutput', count(*) FILTER (WHERE NOT COALESCE(line.progress ? 'casesProduced', false)),
    'averageRunMinutes', round(avg(EXTRACT(EPOCH FROM (r.completed_at - r.started_at)) / 60.0)
      FILTER (WHERE r.completed_at IS NOT NULL AND r.started_at IS NOT NULL), 1)
  )
  INTO v_summary
  FROM v2.runs AS r
  LEFT JOIN v2.run_station_progress AS line
    ON line.facility_id = r.facility_id AND line.run_id = r.id AND line.station_key = 'line'
  WHERE r.facility_id = p_facility_id
    AND r.created_at >= v_from AND r.created_at < v_until;
  v_runs_with_case_output := COALESCE((v_summary->>'runsWithRecordedCaseOutput')::bigint, 0);
  v_runs_without_case_output := COALESCE((v_summary->>'runsWithoutRecordedCaseOutput')::bigint, 0);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'runId', active.id,
    'label', active.setup_snapshot->>'label',
    'status', active.status,
    'updatedAt', active.updated_at,
    'targetCases', NULLIF(active.setup_snapshot->>'targetCases', '')::bigint
  ) ORDER BY active.updated_at DESC, active.id DESC), '[]'::jsonb)
  INTO v_active_runs
  FROM (
    SELECT r.id, r.setup_snapshot, r.status, r.updated_at
    FROM v2.runs AS r
    WHERE r.facility_id = p_facility_id AND r.status IN ('running', 'paused')
    ORDER BY r.updated_at DESC, r.id DESC
    LIMIT 100
  ) AS active;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'date', day.day::date,
    'pauseMinutes', round(COALESCE(pauses.minutes, 0)::numeric, 1)
  ) ORDER BY day.day), '[]'::jsonb)
  INTO v_pause_trend
  FROM generate_series(p_from_date, p_to_date, interval '1 day') AS day(day)
  LEFT JOIN LATERAL (
    SELECT sum(GREATEST(
      0,
      EXTRACT(EPOCH FROM (
        LEAST(COALESCE(p.resumed_at, statement_timestamp()), ((day.day::date + 1)::timestamp AT TIME ZONE 'America/Chicago'))
        - GREATEST(p.paused_at, (day.day::date::timestamp AT TIME ZONE 'America/Chicago'))
      )) / 60.0
    )) AS minutes
    FROM v2.run_pause_intervals AS p
    WHERE p.facility_id = p_facility_id
      AND p.paused_at < ((day.day::date + 1)::timestamp AT TIME ZONE 'America/Chicago')
      AND COALESCE(p.resumed_at, statement_timestamp()) > (day.day::date::timestamp AT TIME ZONE 'America/Chicago')
  ) AS pauses ON true;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'eventType', patterns.event_type,
    'count', patterns.event_count
  ) ORDER BY patterns.event_count DESC, patterns.event_type), '[]'::jsonb)
  INTO v_event_patterns
  FROM (
    SELECT event.event_type, count(*) AS event_count
    FROM v2.run_events AS event
    WHERE event.facility_id = p_facility_id
      AND event.occurred_at >= v_from AND event.occurred_at < v_until
    GROUP BY event.event_type
    ORDER BY count(*) DESC, event.event_type
    LIMIT 12
  ) AS patterns;

  SELECT count(*) INTO v_run_event_count
  FROM v2.run_events AS event
  WHERE event.facility_id = p_facility_id
    AND event.occurred_at >= v_from AND event.occurred_at < v_until;

  SELECT count(*), count(DISTINCT r.id)
  INTO v_unknown_links, v_unknown_link_runs
  FROM v2.runs AS r
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(r.setup_snapshot->'productionPlan'->'recipes') = 'array'
      THEN r.setup_snapshot->'productionPlan'->'recipes' ELSE '[]'::jsonb END
  ) AS recipe(value)
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(recipe.value->'ingredients') = 'array'
      THEN recipe.value->'ingredients' ELSE '[]'::jsonb END
  ) AS ingredient(value)
  WHERE r.facility_id = p_facility_id
    AND r.created_at >= v_from AND r.created_at < v_until
    AND ingredient.value->'ingredientSnapshot'->>'status' = 'unknown';

  WITH candidate_actions AS (
    SELECT
      'run-pause:' || event.run_id::text || ':' || event.revision::text AS action_key,
      event.run_id,
      event.revision AS source_revision,
      event.occurred_at,
      run.setup_snapshot->>'label' AS run_label,
      latest.revision AS action_revision,
      latest.status,
      latest.actor_id,
      latest.note,
      latest.occurred_at AS action_at
    FROM v2.run_events AS event
    JOIN v2.runs AS run
      ON run.facility_id = event.facility_id AND run.id = event.run_id
    LEFT JOIN LATERAL (
      SELECT action.revision, action.status, action.actor_id, action.note, action.occurred_at
      FROM v2.manager_action_events AS action
      WHERE action.facility_id = p_facility_id
        AND action.action_key = 'run-pause:' || event.run_id::text || ':' || event.revision::text
      ORDER BY action.revision DESC
      LIMIT 1
    ) AS latest ON true
    WHERE event.facility_id = p_facility_id
      AND event.event_type = 'run.paused'
      AND event.occurred_at >= v_from AND event.occurred_at < v_until
    ORDER BY CASE COALESCE(latest.status, 'pending')
      WHEN 'pending' THEN 0 WHEN 'acknowledged' THEN 1 WHEN 'unavailable-evidence' THEN 2 ELSE 3 END,
      event.occurred_at DESC
    LIMIT 100
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'actionKey', action_key,
    'runId', run_id,
    'runLabel', run_label,
    'title', 'Review paused run',
    'status', COALESCE(status, 'pending'),
    'revision', COALESCE(action_revision, 0),
    'sourceRevision', source_revision,
    'occurredAt', occurred_at,
    'lastAction', CASE WHEN action_revision IS NULL THEN NULL ELSE jsonb_build_object(
      'status', status, 'actorId', actor_id, 'note', note, 'occurredAt', action_at
    ) END
  ) ORDER BY CASE COALESCE(status, 'pending')
      WHEN 'pending' THEN 0 WHEN 'acknowledged' THEN 1 WHEN 'unavailable-evidence' THEN 2 ELSE 3 END,
      occurred_at DESC), '[]'::jsonb)
  INTO v_actions
  FROM candidate_actions;

  SELECT count(*) INTO v_action_count
  FROM v2.run_events AS event
  WHERE event.facility_id = p_facility_id
    AND event.event_type = 'run.paused'
    AND event.occurred_at >= v_from AND event.occurred_at < v_until;

  SELECT count(*) INTO v_active_run_count
  FROM v2.runs AS run
  WHERE run.facility_id = p_facility_id AND run.status IN ('running', 'paused');

  SELECT count(*) INTO v_qc_event_count
  FROM v2.qc_events AS event
  WHERE event.facility_id = p_facility_id
    AND event.occurred_at >= v_from AND event.occurred_at < v_until;

  SELECT count(*) INTO v_inventory_event_count
  FROM v2.inventory_movements AS movement
  WHERE movement.facility_id = p_facility_id
    AND movement.occurred_at >= v_from AND movement.occurred_at < v_until;

  SELECT
    (SELECT count(*) FROM v2.setup_imports AS item
      WHERE item.facility_id = p_facility_id AND item.created_at >= v_from AND item.created_at < v_until)
    + (SELECT count(*) FROM v2.setup_catalog_imports AS item
      WHERE item.facility_id = p_facility_id AND item.created_at >= v_from AND item.created_at < v_until)
  INTO v_import_count;

  SELECT count(*) INTO v_schedule_count
  FROM v2.production_schedules AS schedule
  WHERE schedule.facility_id = p_facility_id
    AND schedule.updated_at >= v_from AND schedule.updated_at < v_until;

  RETURN jsonb_build_object(
    'timeZone', 'America/Chicago',
    'fromDate', p_from_date,
    'toDate', p_to_date,
    'generatedAt', statement_timestamp(),
    'runs', jsonb_build_object('items', v_runs, 'hasMore', v_has_more, 'nextCursor', v_next_cursor),
    'summary', v_summary,
    'activeRuns', v_active_runs,
    'pauseTrend', v_pause_trend,
    'eventPatterns', v_event_patterns,
    'actions', v_actions,
    'dataHealth', jsonb_build_object(
      'unknownIngredientReferences', v_unknown_links,
      'runsWithUnknownIngredientReferences', v_unknown_link_runs,
      'interpretation', 'Unknown means the run snapshot did not establish a reference; it is not proof of incorrect or corrupted data.'
    ),
    'coverage', jsonb_build_object(
      'runs', jsonb_build_object('status', 'available', 'records', (v_summary->>'runsCreated')::bigint),
      'runEvents', jsonb_build_object('status', 'available', 'records', v_run_event_count),
      'pauseIntervals', jsonb_build_object('status', 'available'),
      'operationalReports', jsonb_build_object(
        'status', 'available',
        'records', (v_summary->>'runsCreated')::bigint,
        'note', 'Generated on demand from canonical run and station records; V2 report exports are not retained as separate records.'
      ),
      'shiftHandoff', jsonb_build_object(
        'status', 'available',
        'records', v_active_run_count,
        'note', 'Current active and paused runs only; V2 does not retain archived handoff digests.'
      ),
      'managerActions', jsonb_build_object(
        'status', CASE WHEN v_action_count > 100 THEN 'partial' ELSE 'available' END,
        'records', v_action_count,
        'note', CASE WHEN v_action_count > 100
          THEN 'The action queue is prioritized and bounded to 100 entries; narrow the date range to review a smaller slice.'
          ELSE 'Run-pause follow-ups and attributed manager status history are available for this range.'
        END
      ),
      'actualCaseOutput', jsonb_build_object(
        'status', CASE
          WHEN (v_summary->>'runsCreated')::bigint = 0 OR v_runs_without_case_output = 0 THEN 'available'
          WHEN v_runs_with_case_output = 0 THEN 'unavailable'
          ELSE 'partial'
        END,
        'records', v_runs_with_case_output,
        'note', 'Counts come from recorded line-station casesProduced; runs without that value are not treated as zero.'
      ),
      'runInsights', jsonb_build_object(
        'status', 'available',
        'records', v_run_event_count,
        'note', 'Descriptive run totals, pause intervals, and event-type counts only; no setup changes are recommended or applied.'
      ),
      'incidentPatterns', jsonb_build_object(
        'status', 'unavailable',
        'note', 'V2 does not persist a canonical incident record, so incident patterns cannot be reported.'
      ),
      'dataHealth', jsonb_build_object(
        'status', 'partial',
        'records', v_unknown_links,
        'note', 'Only unknown ingredient references in frozen run snapshots are checked here; this is not a full profile or master-data health audit.'
      ),
      'referenceLinks', jsonb_build_object(
        'status', 'partial',
        'records', v_unknown_links,
        'note', 'Reference findings are limited to ingredient links captured in run snapshots.'
      ),
      'qcHistory', jsonb_build_object('status', 'available', 'records', v_qc_event_count),
      'inventoryHistory', jsonb_build_object('status', 'available', 'records', v_inventory_event_count),
      'importHistory', jsonb_build_object('status', 'available', 'records', v_import_count),
      'scheduleHistory', jsonb_build_object(
        'status', 'partial', 'records', v_schedule_count,
        'note', 'Only the current schedule revision is retained here; this is not a complete schedule change history.'
      ),
      'syncConflicts', jsonb_build_object(
        'status', 'unavailable',
        'note', 'V2 does not persist sync-conflict records, so no conflict count or incident pattern can be reported.'
      )
    )
  );
END
$$;

-- 0011-manager-operations.sql: function
CREATE OR REPLACE FUNCTION v2.list_manager_operation_events(
  p_facility_id uuid,
  p_actor_id uuid,
  p_from_date date,
  p_to_date date,
  p_limit integer,
  p_run_id uuid DEFAULT NULL,
  p_before_at timestamptz DEFAULT NULL,
  p_before_run_id uuid DEFAULT NULL,
  p_before_revision bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_from timestamptz;
  v_until timestamptz;
  v_has_more boolean;
  v_events jsonb;
  v_next_cursor jsonb := NULL;
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL
     OR p_from_date IS NULL OR p_to_date IS NULL
     OR p_to_date < p_from_date OR p_to_date - p_from_date > 89
     OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100
      OR ((p_before_at IS NULL) <> (p_before_run_id IS NULL))
      OR ((p_before_at IS NULL) <> (p_before_revision IS NULL))
      OR (p_before_revision IS NOT NULL AND p_before_revision < 0) THEN
    RAISE EXCEPTION 'Invalid manager event request' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM v2.facility_scope
    WHERE singleton AND facility_id = p_facility_id
  ) THEN
    RAISE EXCEPTION 'Manager event scope is unavailable' USING ERRCODE = 'P0002';
  END IF;
  IF NOT v2.actor_can_review_operations(p_actor_id) THEN
    RAISE EXCEPTION 'Manager operations are not authorized' USING ERRCODE = '42501';
  END IF;
  IF p_run_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM v2.runs WHERE facility_id = p_facility_id AND id = p_run_id
  ) THEN
    RAISE EXCEPTION 'The selected run is unavailable' USING ERRCODE = 'P0002';
  END IF;

  v_from := p_from_date::timestamp AT TIME ZONE 'America/Chicago';
  v_until := (p_to_date + 1)::timestamp AT TIME ZONE 'America/Chicago';
  WITH page AS (
    SELECT event.revision, event.run_id, event.actor_id, event.event_type, event.occurred_at,
           run.setup_snapshot->>'label' AS run_label
    FROM v2.run_events AS event
    JOIN v2.runs AS run
      ON run.facility_id = event.facility_id AND run.id = event.run_id
    WHERE event.facility_id = p_facility_id
      AND event.occurred_at >= v_from AND event.occurred_at < v_until
      AND (p_run_id IS NULL OR event.run_id = p_run_id)
      AND (p_before_at IS NULL OR (event.occurred_at, event.run_id, event.revision)
        < (p_before_at, p_before_run_id, p_before_revision))
    ORDER BY event.occurred_at DESC, event.run_id DESC, event.revision DESC
    LIMIT p_limit + 1
  ),
  visible AS (
    SELECT * FROM page
    ORDER BY occurred_at DESC, run_id DESC, revision DESC
    LIMIT p_limit
  )
  SELECT
    (SELECT count(*) > p_limit FROM page),
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'eventId', visible.run_id::text || ':' || visible.revision::text,
      'runId', visible.run_id,
      'runLabel', visible.run_label,
      'actorId', visible.actor_id,
      'eventType', visible.event_type,
      'occurredAt', visible.occurred_at
    ) ORDER BY visible.occurred_at DESC, visible.run_id DESC, visible.revision DESC) FROM visible), '[]'::jsonb),
    CASE WHEN (SELECT count(*) > p_limit FROM page) THEN (
      SELECT jsonb_build_object(
        'occurredAt', last_row.occurred_at,
        'runId', last_row.run_id,
        'revision', last_row.revision
      )
      FROM visible AS last_row
      ORDER BY last_row.occurred_at ASC, last_row.run_id ASC, last_row.revision ASC
      LIMIT 1
    ) ELSE NULL END
  INTO v_has_more, v_events, v_next_cursor;

  RETURN jsonb_build_object(
    'events', v_events,
    'hasMore', v_has_more,
    'nextCursor', v_next_cursor,
    'fromDate', p_from_date,
    'toDate', p_to_date,
    'timeZone', 'America/Chicago'
  );
END
$$;

-- 0011-manager-operations.sql: function
CREATE OR REPLACE FUNCTION v2.record_manager_action_status(
  p_facility_id uuid,
  p_actor_id uuid,
  p_action_key text,
  p_expected_revision bigint,
  p_request_id text,
  p_request_hash text,
  p_status text,
  p_note text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_existing v2.manager_action_events%ROWTYPE;
  v_latest v2.manager_action_events%ROWTYPE;
  v_run_id uuid;
  v_source_revision bigint;
  v_next_revision bigint;
  v_event v2.manager_action_events%ROWTYPE;
  v_allowed boolean;
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL
     OR p_action_key IS NULL OR length(p_action_key) > 180
     OR p_action_key !~ '^run-pause:[0-9a-f-]{36}:[1-9][0-9]{0,15}$'
     OR p_expected_revision IS NULL OR p_expected_revision < 0
     OR p_request_id IS NULL OR length(btrim(p_request_id)) NOT BETWEEN 1 AND 200
     OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$'
     OR p_status IS NULL OR p_status NOT IN ('acknowledged', 'resolved', 'unavailable-evidence')
     OR p_note IS NULL OR length(btrim(p_note)) NOT BETWEEN 3 AND 500
     OR p_note ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'Invalid manager action status request' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM v2.facility_scope
    WHERE singleton AND facility_id = p_facility_id
  ) THEN
    RAISE EXCEPTION 'Manager action scope is unavailable' USING ERRCODE = 'P0002';
  END IF;
  IF NOT v2.actor_can_review_operations(p_actor_id) THEN
    RAISE EXCEPTION 'Manager operations are not authorized' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_facility_id::text || ':' || p_action_key, 0));
  SELECT * INTO v_existing
  FROM v2.manager_action_events
  WHERE facility_id = p_facility_id AND actor_id = p_actor_id AND request_id = p_request_id;
  IF FOUND THEN
    IF v_existing.request_hash <> p_request_hash THEN
      RAISE EXCEPTION 'Request ID was reused with different manager action details'
        USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object('replayed', true, 'event', jsonb_build_object(
      'id', v_existing.id, 'actionKey', v_existing.action_key, 'revision', v_existing.revision,
      'status', v_existing.status, 'actorId', v_existing.actor_id, 'note', v_existing.note,
      'occurredAt', v_existing.occurred_at
    ));
  END IF;

  v_run_id := substring(p_action_key FROM '^run-pause:([0-9a-f-]{36}):')::uuid;
  v_source_revision := substring(p_action_key FROM ':([1-9][0-9]{0,15})$')::bigint;
  IF NOT EXISTS (
    SELECT 1 FROM v2.run_events AS source
    WHERE source.facility_id = p_facility_id
      AND source.run_id = v_run_id
      AND source.revision = v_source_revision
      AND source.event_type = 'run.paused'
  ) THEN
    RAISE EXCEPTION 'The action evidence is unavailable' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_latest
  FROM v2.manager_action_events
  WHERE facility_id = p_facility_id AND action_key = p_action_key
  ORDER BY revision DESC
  LIMIT 1;
  IF FOUND THEN
    IF v_latest.revision <> p_expected_revision THEN
      RAISE EXCEPTION 'The manager action changed after it was opened' USING ERRCODE = '40001';
    END IF;
    v_allowed := CASE v_latest.status
      WHEN 'acknowledged' THEN p_status IN ('resolved', 'unavailable-evidence')
      WHEN 'resolved' THEN p_status = 'acknowledged'
      WHEN 'unavailable-evidence' THEN p_status IN ('acknowledged', 'resolved')
      ELSE false
    END;
  ELSE
    IF p_expected_revision <> 0 THEN
      RAISE EXCEPTION 'The manager action changed after it was opened' USING ERRCODE = '40001';
    END IF;
    v_allowed := p_status IN ('acknowledged', 'resolved', 'unavailable-evidence');
  END IF;
  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Choose a valid next manager action status' USING ERRCODE = '22023';
  END IF;

  v_next_revision := COALESCE(v_latest.revision, 0) + 1;
  INSERT INTO v2.manager_action_events (
    facility_id, action_key, revision, actor_id, request_id, request_hash, status, note
  ) VALUES (
    p_facility_id, p_action_key, v_next_revision, p_actor_id, p_request_id,
    p_request_hash, p_status, btrim(p_note)
  ) RETURNING * INTO v_event;

  RETURN jsonb_build_object('replayed', false, 'event', jsonb_build_object(
    'id', v_event.id, 'actionKey', v_event.action_key, 'revision', v_event.revision,
    'status', v_event.status, 'actorId', v_event.actor_id, 'note', v_event.note,
    'occurredAt', v_event.occurred_at
  ));
END
$$;

-- 0011-manager-operations.sql: permissions
REVOKE ALL ON FUNCTION v2.actor_can_review_operations(uuid) FROM PUBLIC;

-- 0011-manager-operations.sql: permissions
REVOKE ALL ON FUNCTION v2.get_manager_operations_snapshot(uuid, uuid, date, date, integer, timestamptz, uuid) FROM PUBLIC;

-- 0011-manager-operations.sql: permissions
REVOKE ALL ON FUNCTION v2.list_manager_operation_events(uuid, uuid, date, date, integer, uuid, timestamptz, uuid, bigint) FROM PUBLIC;

-- 0011-manager-operations.sql: permissions
REVOKE ALL ON FUNCTION v2.record_manager_action_status(uuid, uuid, text, bigint, text, text, text, text) FROM PUBLIC;

-- 0011-qc-checkpoint-review.sql: function
CREATE OR REPLACE FUNCTION v2.record_qc_event(
  p_facility_id uuid,
  p_actor_id uuid,
  p_run_id uuid,
  p_request_id text,
  p_request_hash text,
  p_event_type text,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_existing v2.qc_events%ROWTYPE;
  v_event v2.qc_events%ROWTYPE;
  v_target v2.qc_events%ROWTYPE;
  v_key_count integer;
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM v2.facility_scope
       WHERE singleton AND facility_id = p_facility_id
     )
     OR p_request_id IS NULL OR length(btrim(p_request_id)) NOT BETWEEN 1 AND 200
     OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$'
     OR p_event_type IS NULL
     OR p_event_type NOT IN (
       'lot-recorded', 'weight-check', 'cleaning-recorded', 'cleaning-verified',
       'date-code-observed', 'brix-check', 'qc-setting-reviewed',
       'review-signed-off', 'run-check-reviewed', 'run-substitution-proposed',
       'run-substitution-approved', 'run-substitution-rejected',
       'run-substitution-corrected', 'checkpoint-observed',
       'corrective-action-observed', 'review-flag-raised',
       'review-flag-reviewed', 'correction', 'redaction'
     )
     OR p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object'
     OR octet_length(p_payload::text) > 65536
     OR (p_event_type = 'qc-setting-reviewed' AND p_run_id IS NOT NULL)
     OR (p_event_type NOT IN ('qc-setting-reviewed', 'redaction') AND p_run_id IS NULL) THEN
    RAISE EXCEPTION 'Invalid QC event request' USING ERRCODE = '22023';
  END IF;

  IF NOT v2.actor_can_record_qc(p_actor_id) THEN
    RAISE EXCEPTION 'QC recording is not authorized' USING ERRCODE = '42501';
  END IF;
  IF p_event_type IN (
    'qc-setting-reviewed', 'review-signed-off', 'review-flag-reviewed', 'redaction'
  ) AND NOT v2.actor_can_manage_qc(p_actor_id) THEN
    RAISE EXCEPTION 'QC management is not authorized' USING ERRCODE = '42501';
  END IF;
  IF p_run_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM v2.runs WHERE facility_id = p_facility_id AND id = p_run_id
  ) THEN
    RAISE EXCEPTION 'QC run is unavailable' USING ERRCODE = 'P0002';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_facility_id::text || ':' || p_actor_id::text || ':qc:' || p_request_id, 0
  ));
  SELECT * INTO v_existing
  FROM v2.qc_events
  WHERE facility_id = p_facility_id
    AND actor_id = p_actor_id
    AND request_id = p_request_id;
  IF FOUND THEN
    IF v_existing.request_hash <> p_request_hash
       OR v_existing.run_id IS DISTINCT FROM p_run_id
       OR v_existing.event_type <> p_event_type THEN
      RAISE EXCEPTION 'QC request ID was reused with different details'
        USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object(
      'event', jsonb_build_object(
        'id', v_existing.id,
        'runId', v_existing.run_id,
        'actorId', v_existing.actor_id,
        'eventType', v_existing.event_type,
        'payload', v_existing.payload,
        'occurredAt', v_existing.occurred_at
      ),
      'replayed', true
    );
  END IF;

  IF p_event_type = 'cleaning-verified' THEN
    SELECT count(*) INTO v_key_count FROM jsonb_object_keys(p_payload);
    IF p_payload ? 'verifierId' OR v_key_count <> 1
       OR coalesce(p_payload->>'targetEventId', '') !~*
         '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'Cleaning verification must reference one existing record'
        USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_target
    FROM v2.qc_events
    WHERE facility_id = p_facility_id
      AND id = (p_payload->>'targetEventId')::uuid
      AND run_id = p_run_id
      AND event_type = 'cleaning-recorded';
    IF NOT FOUND OR v_target.actor_id = p_actor_id THEN
      RAISE EXCEPTION 'A different authenticated QC staff member must verify cleaning'
        USING ERRCODE = '42501';
    END IF;
    IF EXISTS (
      SELECT 1 FROM v2.qc_events AS redaction
      WHERE redaction.facility_id = p_facility_id
        AND redaction.event_type = 'redaction'
        AND redaction.payload->>'targetEventId' = v_target.id::text
    ) THEN
      RAISE EXCEPTION 'The cleaning record is no longer available for verification'
        USING ERRCODE = '55000';
    END IF;
  ELSIF p_event_type = 'checkpoint-observed' THEN
    SELECT count(*) INTO v_key_count FROM jsonb_object_keys(p_payload);
    IF v_key_count NOT BETWEEN 6 AND 7
       OR (p_payload - ARRAY[
         'checkpointType', 'stationKey', 'checkpointLabel', 'observedValue',
         'unit', 'evaluationStatus', 'note'
       ]::text[]) <> '{}'::jsonb
       OR NOT (p_payload ?& ARRAY[
         'checkpointType', 'stationKey', 'checkpointLabel', 'observedValue', 'unit', 'evaluationStatus'
       ])
       OR coalesce(p_payload->>'checkpointType', '') NOT IN ('temperature', 'time')
       OR coalesce(p_payload->>'stationKey', '') NOT IN ('dough', 'cheese', 'pepperoni', 'sauce', 'frontline')
       OR length(btrim(coalesce(p_payload->>'checkpointLabel', ''))) NOT BETWEEN 1 AND 100
       OR coalesce(p_payload->>'observedValue', '') !~ '^-?(0|[1-9][0-9]{0,8})(\.[0-9]{1,6})?$'
       OR coalesce(p_payload->>'evaluationStatus', '') <> 'not_evaluated'
       OR (p_payload->>'checkpointType' = 'temperature' AND coalesce(p_payload->>'unit', '') NOT IN ('°C', '°F'))
       OR (p_payload->>'checkpointType' = 'time' AND coalesce(p_payload->>'unit', '') NOT IN ('s', 'min', 'h'))
       OR (p_payload->>'checkpointType' = 'time' AND (p_payload->>'observedValue')::numeric < 0)
       OR (p_payload ? 'note' AND length(btrim(coalesce(p_payload->>'note', ''))) NOT BETWEEN 1 AND 500) THEN
      RAISE EXCEPTION 'Invalid observation-only QC checkpoint'
        USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM v2.runs AS run
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(run.setup_snapshot->'productionPlan'->'recipes') = 'array'
            THEN run.setup_snapshot->'productionPlan'->'recipes'
          ELSE '[]'::jsonb
        END
      ) AS recipe(value)
      WHERE run.facility_id = p_facility_id
        AND run.id = p_run_id
        AND recipe.value->>'stationKey' = p_payload->>'stationKey'
    ) THEN
      RAISE EXCEPTION 'QC station is unavailable for this run'
        USING ERRCODE = 'P0002';
    END IF;
  ELSIF p_event_type = 'corrective-action-observed' THEN
    SELECT count(*) INTO v_key_count FROM jsonb_object_keys(p_payload);
    IF v_key_count NOT BETWEEN 2 AND 3
       OR (p_payload - ARRAY['targetEventId', 'actionObserved', 'followUpNote']::text[]) <> '{}'::jsonb
       OR NOT (p_payload ?& ARRAY['targetEventId', 'actionObserved'])
       OR coalesce(p_payload->>'targetEventId', '') !~*
         '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR length(btrim(coalesce(p_payload->>'actionObserved', ''))) NOT BETWEEN 3 AND 500
       OR (p_payload ? 'followUpNote' AND length(btrim(coalesce(p_payload->>'followUpNote', ''))) NOT BETWEEN 1 AND 500) THEN
      RAISE EXCEPTION 'Invalid corrective-action observation'
        USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_target
    FROM v2.qc_events
    WHERE facility_id = p_facility_id
      AND id = (p_payload->>'targetEventId')::uuid
      AND run_id = p_run_id
      AND event_type IN ('checkpoint-observed', 'review-flag-raised');
    IF NOT FOUND OR EXISTS (
      SELECT 1 FROM v2.qc_events AS redaction
      WHERE redaction.facility_id = p_facility_id
        AND redaction.event_type = 'redaction'
        AND redaction.payload->>'targetEventId' = v_target.id::text
    ) THEN
      RAISE EXCEPTION 'QC evidence is unavailable for corrective-action reference'
        USING ERRCODE = 'P0002';
    END IF;
  ELSIF p_event_type = 'review-flag-raised' THEN
    SELECT count(*) INTO v_key_count FROM jsonb_object_keys(p_payload);
    IF p_payload->>'targetType' = 'run' THEN
      IF v_key_count <> 2
         OR (p_payload - ARRAY['targetType', 'reason']::text[]) <> '{}'::jsonb
         OR length(btrim(coalesce(p_payload->>'reason', ''))) NOT BETWEEN 3 AND 500 THEN
        RAISE EXCEPTION 'Invalid run review flag' USING ERRCODE = '22023';
      END IF;
    ELSIF p_payload->>'targetType' = 'lot' THEN
      IF v_key_count <> 3
         OR (p_payload - ARRAY['targetType', 'targetEventId', 'reason']::text[]) <> '{}'::jsonb
         OR coalesce(p_payload->>'targetEventId', '') !~*
           '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
         OR length(btrim(coalesce(p_payload->>'reason', ''))) NOT BETWEEN 3 AND 500 THEN
        RAISE EXCEPTION 'Invalid lot review flag' USING ERRCODE = '22023';
      END IF;
      SELECT * INTO v_target
      FROM v2.qc_events
      WHERE facility_id = p_facility_id
        AND id = (p_payload->>'targetEventId')::uuid
        AND run_id = p_run_id
        AND event_type = 'lot-recorded';
      IF NOT FOUND OR EXISTS (
        SELECT 1 FROM v2.qc_events AS redaction
        WHERE redaction.facility_id = p_facility_id
          AND redaction.event_type = 'redaction'
          AND redaction.payload->>'targetEventId' = v_target.id::text
      ) THEN
        RAISE EXCEPTION 'QC lot record is unavailable for review'
          USING ERRCODE = 'P0002';
      END IF;
    ELSE
      RAISE EXCEPTION 'Choose a run or lot review flag' USING ERRCODE = '22023';
    END IF;
  ELSIF p_event_type = 'review-flag-reviewed' THEN
    SELECT count(*) INTO v_key_count FROM jsonb_object_keys(p_payload);
    IF v_key_count <> 2
       OR (p_payload - ARRAY['targetEventId', 'reviewNote']::text[]) <> '{}'::jsonb
       OR coalesce(p_payload->>'targetEventId', '') !~*
         '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR length(btrim(coalesce(p_payload->>'reviewNote', ''))) NOT BETWEEN 3 AND 500 THEN
      RAISE EXCEPTION 'Invalid QC review-flag decision' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_target
    FROM v2.qc_events
    WHERE facility_id = p_facility_id
      AND id = (p_payload->>'targetEventId')::uuid
      AND run_id = p_run_id
      AND event_type = 'review-flag-raised';
    IF NOT FOUND OR EXISTS (
      SELECT 1 FROM v2.qc_events AS redaction
      WHERE redaction.facility_id = p_facility_id
        AND redaction.event_type = 'redaction'
        AND redaction.payload->>'targetEventId' = v_target.id::text
    ) THEN
      RAISE EXCEPTION 'QC review flag is unavailable'
        USING ERRCODE = 'P0002';
    END IF;
    IF EXISTS (
      SELECT 1 FROM v2.qc_events AS reviewed
      WHERE reviewed.facility_id = p_facility_id
        AND reviewed.event_type = 'review-flag-reviewed'
        AND reviewed.payload->>'targetEventId' = v_target.id::text
    ) THEN
      RAISE EXCEPTION 'QC review flag was already reviewed'
        USING ERRCODE = '55000';
    END IF;
  ELSIF p_event_type IN ('correction', 'redaction') THEN
    IF coalesce(p_payload->>'targetEventId', '') !~*
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR length(btrim(coalesce(p_payload->>'reason', ''))) NOT BETWEEN 3 AND 500 THEN
      RAISE EXCEPTION 'QC correction or redaction requires a target and reason'
        USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_target
    FROM v2.qc_events
    WHERE facility_id = p_facility_id
      AND id = (p_payload->>'targetEventId')::uuid
      AND run_id IS NOT DISTINCT FROM p_run_id
      AND event_type NOT IN ('correction', 'redaction', 'review-signed-off');
    IF NOT FOUND THEN
      RAISE EXCEPTION 'QC evidence is unavailable for correction'
        USING ERRCODE = 'P0002';
    END IF;
    IF p_event_type = 'redaction' AND EXISTS (
      SELECT 1 FROM v2.qc_events AS prior
      WHERE prior.facility_id = p_facility_id
        AND prior.event_type = 'redaction'
        AND prior.payload->>'targetEventId' = v_target.id::text
    ) THEN
      RAISE EXCEPTION 'QC evidence has already been redacted'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  INSERT INTO v2.qc_events (
    facility_id, run_id, actor_id, request_id, request_hash, event_type, payload
  ) VALUES (
    p_facility_id, p_run_id, p_actor_id, p_request_id, p_request_hash,
    p_event_type, p_payload
  )
  RETURNING * INTO v_event;

  RETURN jsonb_build_object(
    'event', jsonb_build_object(
      'id', v_event.id,
      'runId', v_event.run_id,
      'actorId', v_event.actor_id,
      'eventType', v_event.event_type,
      'payload', v_event.payload,
      'occurredAt', v_event.occurred_at
    ),
    'replayed', false
  );
END
$$;

-- 0011-qc-checkpoint-review.sql: permissions
REVOKE ALL ON FUNCTION v2.record_qc_event(uuid, uuid, uuid, text, text, text, jsonb) FROM PUBLIC;

-- 0011-qc-checkpoint-review.sql: function comment
COMMENT ON FUNCTION v2.record_qc_event(uuid, uuid, uuid, text, text, text, jsonb) IS
  'Appends authenticated QC evidence, including observation-only checkpoints, corrective-action evidence, and advisory review flags.';

-- 0011-run-operational-substitution-status.sql: function
CREATE OR REPLACE FUNCTION v2.list_run_operational_substitutions(
  p_facility_id uuid,
  p_actor_id uuid,
  p_run_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL OR p_run_id IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM v2.facility_scope
       WHERE singleton AND facility_id = p_facility_id
     ) THEN
    RAISE EXCEPTION 'Invalid run substitution status request' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM v2.staff_accounts AS staff
    JOIN v2.user_roles AS user_role ON user_role.user_id = staff.id
    JOIN v2.roles AS role ON role.name = user_role.role_name
    WHERE staff.id = p_actor_id
      AND staff.disabled = false
      AND (
        role.capabilities ? 'run.read'
        OR role.capabilities ? 'record-qc'
        OR role.capabilities ? 'manage-qc'
      )
  ) THEN
    RAISE EXCEPTION 'Run substitution status access is not authorized'
      USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM v2.runs WHERE facility_id = p_facility_id AND id = p_run_id
  ) THEN
    RAISE EXCEPTION 'Run is unavailable' USING ERRCODE = 'P0002';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', latest.id,
      'proposalEventId', latest.proposal_event_id,
      'revision', latest.revision,
      'sourceItems', latest.source_items,
      'actorId', latest.actor_id,
      'replacementProductId', latest.replacement_product_id,
      'replacementProductCode', latest.replacement_product_code,
      'replacementProductName', latest.replacement_product_name,
      'replacementQuantity', latest.replacement_quantity::text,
      'replacementUnit', latest.replacement_unit,
      'replacementIngredientSnapshot', latest.replacement_ingredient_snapshot,
      'movementGroupId', latest.movement_group_id,
      'occurredAt', latest.occurred_at
    ) ORDER BY latest.occurred_at, latest.id)
    FROM (
      SELECT DISTINCT ON (substitution.proposal_event_id) substitution.*
      FROM v2.qc_run_substitutions AS substitution
      WHERE substitution.facility_id = p_facility_id
        AND substitution.run_id = p_run_id
      ORDER BY substitution.proposal_event_id, substitution.revision DESC
      LIMIT 200
    ) AS latest
  ), '[]'::jsonb);
END
$$;

-- 0011-run-operational-substitution-status.sql: permissions
REVOKE ALL ON FUNCTION v2.list_run_operational_substitutions(uuid, uuid, uuid) FROM PUBLIC;

-- 0011-run-operational-substitution-status.sql: role validation or conditional grants
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'v2_runtime_access') THEN
    GRANT EXECUTE ON FUNCTION v2.list_run_operational_substitutions(uuid, uuid, uuid) TO v2_runtime_access;
  END IF;
END
$$;

-- 0011-run-operational-substitution-status.sql: function comment
COMMENT ON FUNCTION v2.list_run_operational_substitutions(uuid, uuid, uuid) IS
  'Read-only, run-scoped approved substitution evidence for run readers and QC staff; does not expose QC history.';

-- 0012-staff-account-history.sql: function
CREATE OR REPLACE FUNCTION v2.prevent_staff_account_change_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, v2
AS $$
BEGIN
  RAISE EXCEPTION 'Staff account history is append-only'
    USING ERRCODE = '55000';
END
$$;

-- 0012-staff-account-history.sql: repeat-safe trigger
DROP TRIGGER IF EXISTS staff_account_change_events_append_only ON v2.staff_account_change_events;
CREATE TRIGGER staff_account_change_events_append_only
  BEFORE UPDATE OR DELETE ON v2.staff_account_change_events
  FOR EACH ROW EXECUTE FUNCTION v2.prevent_staff_account_change_mutation();

-- 0012-staff-account-history.sql: function
CREATE OR REPLACE FUNCTION v2.bootstrap_first_manager(
  p_username text,
  p_password_hash text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  IF p_username IS NULL
     OR length(btrim(p_username)) NOT BETWEEN 3 AND 40
     OR p_username <> btrim(p_username)
     OR p_username ~ '[[:cntrl:]]'
     OR p_password_hash IS NULL
     OR length(p_password_hash) NOT BETWEEN 20 AND 256
     OR p_password_hash NOT LIKE 'argon2id$v=19$m=19456,t=2,p=1$%$%' THEN
    RAISE EXCEPTION 'Invalid first-manager request'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(20855409, 1);
  IF EXISTS (SELECT 1 FROM v2.staff_bootstrap_marker)
     OR EXISTS (SELECT 1 FROM v2.staff_accounts) THEN
    RETURN false;
  END IF;

  INSERT INTO v2.staff_accounts (username, password_hash)
    VALUES (p_username, p_password_hash)
    RETURNING id INTO v_user_id;
  INSERT INTO v2.user_roles (user_id, role_name)
    VALUES (v_user_id, 'manager');
  INSERT INTO v2.staff_bootstrap_marker (singleton) VALUES (true);
  INSERT INTO v2.staff_account_change_events (
    actor_id, actor_type, actor_username, target_id, target_username,
    change_type, before_state, after_state
  ) VALUES (
    NULL, 'bootstrap', 'First-manager setup', v_user_id, p_username, 'created', NULL,
    jsonb_build_object('roleName', 'manager', 'disabled', false)
  );
  RETURN true;
END
$$;

-- 0012-staff-account-history.sql: function
CREATE OR REPLACE FUNCTION v2.create_staff_account(
  p_actor_id uuid,
  p_username text,
  p_password_hash text,
  p_role_name text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_user_id uuid;
  v_actor_username text;
BEGIN
  IF p_username IS NULL
     OR length(btrim(p_username)) NOT BETWEEN 3 AND 40
     OR p_username <> btrim(p_username)
     OR p_username ~ '[[:cntrl:]]'
     OR p_password_hash IS NULL
     OR length(p_password_hash) NOT BETWEEN 20 AND 256
     OR p_password_hash NOT LIKE 'argon2id$v=19$m=19456,t=2,p=1$%$%' THEN
    RAISE EXCEPTION 'Invalid staff account request'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(20855409, 1);
  IF NOT v2.actor_can_manage_staff(p_actor_id) THEN
    RAISE EXCEPTION 'Staff management is not authorized'
      USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM v2.roles WHERE name = p_role_name) THEN
    RETURN 'invalid_role';
  END IF;
  SELECT username INTO v_actor_username FROM v2.staff_accounts WHERE id = p_actor_id;

  INSERT INTO v2.staff_accounts (username, password_hash)
    VALUES (p_username, p_password_hash)
    RETURNING id INTO v_user_id;
  INSERT INTO v2.user_roles (user_id, role_name)
    VALUES (v_user_id, p_role_name);
  INSERT INTO v2.staff_account_change_events (
    actor_id, actor_type, actor_username, target_id, target_username,
    change_type, before_state, after_state
  ) VALUES (
    p_actor_id, 'staff', v_actor_username, v_user_id, p_username, 'created', NULL,
    jsonb_build_object('roleName', p_role_name, 'disabled', false)
  );
  RETURN 'created';
EXCEPTION
  WHEN unique_violation THEN
    RETURN 'duplicate';
END
$$;

-- 0012-staff-account-history.sql: function
CREATE OR REPLACE FUNCTION v2.update_staff_account(
  p_actor_id uuid,
  p_staff_id uuid,
  p_disabled boolean,
  p_role_name text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_current_disabled boolean;
  v_current_role text;
  v_next_disabled boolean;
  v_next_role text;
  v_target_username text;
  v_actor_username text;
BEGIN
  IF p_staff_id IS NULL OR (p_disabled IS NULL AND p_role_name IS NULL) THEN
    RAISE EXCEPTION 'Invalid staff account update'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(20855409, 1);
  IF NOT v2.actor_can_manage_staff(p_actor_id) THEN
    RAISE EXCEPTION 'Staff management is not authorized'
      USING ERRCODE = '42501';
  END IF;
  IF p_role_name IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM v2.roles WHERE name = p_role_name) THEN
    RETURN 'invalid_role';
  END IF;

  SELECT u.disabled, r.name, u.username
    INTO v_current_disabled, v_current_role, v_target_username
    FROM v2.staff_accounts AS u
    JOIN v2.user_roles AS ur ON ur.user_id = u.id
    JOIN v2.roles AS r ON r.name = ur.role_name
    WHERE u.id = p_staff_id
    FOR UPDATE OF u, ur;
  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;

  v_next_disabled := coalesce(p_disabled, v_current_disabled);
  v_next_role := coalesce(p_role_name, v_current_role);

  IF v_current_disabled = false
     AND v_current_role = 'manager'
     AND (v_next_disabled OR v_next_role <> 'manager')
     AND (
       SELECT count(*)
       FROM v2.staff_accounts AS u
       JOIN v2.user_roles AS ur ON ur.user_id = u.id
       WHERE u.disabled = false AND ur.role_name = 'manager'
     ) <= 1 THEN
    RETURN 'last_manager';
  END IF;
  IF p_actor_id = p_staff_id THEN
    RETURN 'self_change';
  END IF;

  IF v_current_disabled = v_next_disabled AND v_current_role = v_next_role THEN
    RETURN 'unchanged';
  END IF;

  SELECT username INTO v_actor_username FROM v2.staff_accounts WHERE id = p_actor_id;
  UPDATE v2.staff_accounts
    SET disabled = v_next_disabled
    WHERE id = p_staff_id;
  UPDATE v2.user_roles
    SET role_name = v_next_role,
        updated_at = clock_timestamp()
    WHERE user_id = p_staff_id;
  UPDATE v2.staff_sessions
    SET revoked_at = clock_timestamp()
    WHERE user_id = p_staff_id AND revoked_at IS NULL;
  INSERT INTO v2.staff_account_change_events (
    actor_id, actor_type, actor_username, target_id, target_username,
    change_type, before_state, after_state
  ) VALUES (
    p_actor_id, 'staff', v_actor_username, p_staff_id, v_target_username, 'updated',
    jsonb_build_object('roleName', v_current_role, 'disabled', v_current_disabled),
    jsonb_build_object('roleName', v_next_role, 'disabled', v_next_disabled)
  );
  RETURN 'updated';
END
$$;

-- 0012-staff-account-history.sql: function
CREATE OR REPLACE FUNCTION v2.list_staff_account_change_history(
  p_actor_id uuid,
  p_limit integer,
  p_before_occurred_at timestamptz DEFAULT NULL,
  p_before_id uuid DEFAULT NULL
)
RETURNS TABLE (
  event_id uuid,
  actor_id uuid,
  actor_type text,
  actor_username text,
  target_id uuid,
  target_username text,
  change_type text,
  before_state jsonb,
  after_state jsonb,
  occurred_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
BEGIN
  IF p_actor_id IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50
     OR ((p_before_occurred_at IS NULL) <> (p_before_id IS NULL)) THEN
    RAISE EXCEPTION 'Invalid staff account history request'
      USING ERRCODE = '22023';
  END IF;
  IF NOT v2.actor_can_manage_staff(p_actor_id) THEN
    RAISE EXCEPTION 'Staff management is not authorized'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT e.id, e.actor_id, e.actor_type, e.actor_username, e.target_id, e.target_username,
           e.change_type, e.before_state, e.after_state, e.occurred_at
    FROM v2.staff_account_change_events AS e
    WHERE p_before_occurred_at IS NULL
       OR (e.occurred_at, e.id) < (p_before_occurred_at, p_before_id)
    ORDER BY e.occurred_at DESC, e.id DESC
    LIMIT p_limit + 1;
END
$$;

-- 0012-staff-account-history.sql: permissions
REVOKE ALL ON TABLE v2.staff_account_change_events FROM PUBLIC;

-- 0012-staff-account-history.sql: permissions
REVOKE ALL ON FUNCTION v2.prevent_staff_account_change_mutation() FROM PUBLIC;

-- 0012-staff-account-history.sql: permissions
REVOKE ALL ON FUNCTION v2.list_staff_account_change_history(uuid, integer, timestamptz, uuid) FROM PUBLIC;

-- 0012-staff-account-history.sql: role validation or conditional grants
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'v2_runtime_access') THEN
    GRANT EXECUTE ON FUNCTION v2.list_staff_account_change_history(uuid, integer, timestamptz, uuid)
      TO v2_runtime_access;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'v2_api_test') THEN
    GRANT EXECUTE ON FUNCTION v2.list_staff_account_change_history(uuid, integer, timestamptz, uuid)
      TO v2_api_test;
  END IF;
END
$$;

-- Current reviewed final run snapshot function
CREATE OR REPLACE FUNCTION v2.run_snapshot(p_facility_id uuid, p_run_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'v2'
AS $function$
  SELECT v2.run_snapshot_without_rules(p_facility_id, p_run_id) ||
    jsonb_build_object('productionRules', COALESCE((
      SELECT e.payload#>'{run,productionRules}' FROM v2.run_events e
      WHERE e.facility_id=p_facility_id AND e.run_id=p_run_id
        AND e.event_type='run.started'
      ORDER BY e.revision LIMIT 1
    ), v2.assess_production_rules(p_facility_id, r.setup_snapshot, p_run_id)))
  FROM v2.runs r WHERE r.facility_id = p_facility_id AND r.id = p_run_id
$function$
;

-- Current reviewed final run snapshot function
CREATE OR REPLACE FUNCTION v2.run_snapshot_without_rules(p_facility_id uuid, p_run_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'v2'
AS $function$
  SELECT jsonb_build_object(
    'id', r.id,
    'status', r.status,
    'revision', r.revision,
    'createdAt', to_char(r.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'updatedAt', to_char(r.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'serverNow', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'startedAt', CASE WHEN r.started_at IS NULL THEN NULL
      ELSE to_char(r.started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
    'pausedAt', CASE WHEN r.paused_at IS NULL THEN NULL
      ELSE to_char(r.paused_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
    'resumedAt', CASE WHEN r.resumed_at IS NULL THEN NULL
      ELSE to_char(r.resumed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
    'completedAt', CASE WHEN r.completed_at IS NULL THEN NULL
      ELSE to_char(r.completed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
    'setupSnapshot', r.setup_snapshot,
    'doughCapacity', v2.dough_capacity_snapshot(p_facility_id, r.setup_snapshot->>'productCode'),
    'inventoryConsumption', (
      SELECT c.details FROM v2.run_inventory_consumptions AS c
      WHERE c.facility_id = p_facility_id AND c.run_id = p_run_id
    ),
    'pauseIntervals', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'startedAt', to_char(p.paused_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'endedAt', CASE WHEN p.resumed_at IS NULL THEN NULL
          ELSE to_char(p.resumed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END
      ) ORDER BY p.pause_number)
      FROM v2.run_pause_intervals AS p
      WHERE p.facility_id = p_facility_id AND p.run_id = p_run_id
    ), '[]'::jsonb),
    'stationProgress', COALESCE((
      SELECT jsonb_object_agg(
        s.station_key,
        jsonb_build_object(
          'status', s.status,
          'revision', s.revision,
          'inputs', s.inputs,
          'progress', s.progress,
          'startedAt', CASE WHEN s.started_at IS NULL THEN NULL
            ELSE to_char(s.started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
          'pausedAt', CASE WHEN s.paused_at IS NULL THEN NULL
            ELSE to_char(s.paused_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
          'completedAt', CASE WHEN s.completed_at IS NULL THEN NULL
            ELSE to_char(s.completed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
          'nextDueAt', CASE WHEN s.next_due_at IS NULL THEN NULL
            ELSE to_char(s.next_due_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
          'updatedAt', to_char(s.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        ) ORDER BY s.station_key
      )
      FROM v2.run_station_progress AS s
      WHERE s.facility_id = p_facility_id AND s.run_id = p_run_id
    ), '{}'::jsonb)
  )
  FROM v2.runs AS r
  WHERE r.facility_id = p_facility_id AND r.id = p_run_id
$function$
;

DO $v2_verify$
DECLARE missing text[]; expected_name text;
BEGIN
 SELECT array_agg(expected.name ORDER BY expected.name) INTO missing
 FROM unnest(ARRAY['actor_can_manage_allergens','actor_can_manage_qc','actor_can_manage_staff','actor_can_record_qc','actor_can_review_operations','adjust_qc_substitution_inventory','apply_inventory_cycle_count','apply_opening_count','apply_production_schedule_command','apply_run_inventory_consumption','apply_run_lifecycle_command','apply_setup_catalog_import','apply_setup_import','apply_station_command','assess_production_rules','bootstrap_first_manager','can_approve_staff_password_reset','cancel_staff_password_resets_after_account_change','claim_worker_lease','complete_run_with_inventory','complete_staff_password_reset','consume_run_inventory_before_completion','correct_workbook_source_link','create_inventory_warehouse','create_planned_run','create_staff_account','decide_staff_password_reset','dough_capacity_snapshot','expire_staff_password_reset_requests','find_staff_for_sign_in','get_inventory_cycle_count','get_manager_operations_snapshot','get_opening_count','get_operational_mix_plan_sources','get_production_schedule','get_qc_review_state','get_run','get_setup_catalog_import','get_setup_import','guard_outbox_event_mutation','guard_production_rules','heartbeat_worker_lease','list_die_default_events','list_die_defaults','list_due_station_auto_track','list_inventory_cycle_counts','list_inventory_lots','list_inventory_movements','list_inventory_preparation_setup','list_inventory_preparations','list_inventory_products','list_inventory_stock','list_inventory_warehouses','list_manager_operation_events','list_opening_counts','list_qc_component_products','list_qc_events','list_qc_ingredient_links','list_qc_run_substitutions','list_qc_settings','list_run_inventory_products','list_run_inventory_staged_supplies','list_run_operational_substitutions','list_run_products','list_runs','list_schedule_run_templates','list_setup_catalog_imports','list_setup_imports','list_staff_account_change_history','list_staff_accounts','list_staff_password_reset_requests','list_staff_roles','list_workbook_source_links','open_staff_session','prepare_inventory_mix','prevent_manager_action_event_mutation','prevent_qc_event_mutation','prevent_qc_ingredient_link_event_mutation','prevent_qc_run_substitution_mutation','prevent_staff_account_change_mutation','production_rule_value','qc_current_product_ingredient_snapshot','record_inventory_movement','record_inventory_movement_internal','record_inventory_movement_with_lot','record_manager_action_status','record_qc_event','record_qc_ingredient_link','record_qc_substitution','reissue_staff_password_reset_code','reject_immutable_row_mutation','release_worker_lease','request_staff_password_reset','resolve_qc_substitution_sources','resolve_staff_session','review_inventory_cycle_count','review_opening_count','revoke_staff_session','run_snapshot','run_snapshot_without_rules','save_die_default','schedule_default_start_time','set_production_warehouse','set_setup_inventory_link','setup_catalog_object_size','setup_catalog_table_name','snapshot_run_ingredient_allergens','staff_bootstrap_open','stage_inventory_cycle_count','stage_opening_count','stage_run_inventory_supply','stage_setup_catalog_import','stage_setup_import','track_inventory_movement_lots','transfer_inventory','undo_setup_catalog_import','undo_setup_import','update_staff_account','validate_inventory_lines','validate_production_schedule_breaks','validate_production_schedule_runs','validate_run_inventory_master_record']::text[]) AS expected(name)
 WHERE NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.pronamespace='v2'::regnamespace AND p.proname=expected.name);
 IF missing IS NOT NULL THEN RAISE EXCEPTION 'V2 functions still missing: %',missing; END IF;
 FOREACH expected_name IN ARRAY ARRAY['command_receipts_append_only','die_default_events_append_only','inventory_cycle_counts_append_only','inventory_lot_allocations_append_only','inventory_movement_lot_tracking','inventory_movements_append_only','inventory_preparations_append_only','manager_action_events_append_only','outbox_events_immutable_content','production_rules_before_prepare','production_rules_before_start','qc_events_append_only','qc_ingredient_link_events_append_only','qc_run_substitutions_append_only','run_events_append_only','run_inventory_consume_before_completion','run_inventory_consumptions_append_only','run_inventory_master_record_validation','run_inventory_stage_receipts_append_only','run_inventory_staged_supplies_append_only','runs_snapshot_ingredient_allergens','staff_account_change_events_append_only','staff_password_reset_account_status_changed','staff_password_reset_role_changed']::text[] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='v2' AND NOT t.tgisinternal AND t.tgname=expected_name) THEN
   RAISE EXCEPTION 'V2 trigger still missing: %',expected_name;
  END IF;
 END LOOP;
 IF to_regprocedure('v2.get_production_schedule(uuid,date)') IS NULL
    OR to_regprocedure('v2.list_schedule_run_templates(uuid)') IS NULL
    OR to_regprocedure('v2.get_manager_operations_snapshot(uuid,uuid,date,date,integer,timestamptz,uuid)') IS NULL
    OR to_regprocedure('v2.list_staff_account_change_history(uuid,integer,timestamptz,uuid)') IS NULL
    OR to_regprocedure('v2.list_run_operational_substitutions(uuid,uuid,uuid)') IS NULL
    OR to_regprocedure('v2.list_staff_password_reset_requests(uuid)') IS NULL
    OR position('dieTypes' in pg_get_functiondef('v2.list_run_products(uuid)'::regprocedure))=0
    OR position('productionRules' in pg_get_functiondef('v2.run_snapshot(uuid,uuid)'::regprocedure))=0 THEN
   RAISE EXCEPTION 'V2 route-function verification failed';
 END IF;
 IF EXISTS(SELECT 1 FROM v2.roles WHERE name='qc-manager' AND (capabilities<>'["use-ai-tools","review-incidents","manage-allergens","record-qc","manage-qc"]'::jsonb OR builtin IS DISTINCT FROM false))
    OR EXISTS(SELECT 1 FROM v2.roles WHERE name='warehouse' AND (capabilities<>'["manage-inventory"]'::jsonb OR builtin IS DISTINCT FROM false))
    OR EXISTS(SELECT 1 FROM v2.roles WHERE name='qc-operator' AND (capabilities<>'["record-qc"]'::jsonb OR builtin IS DISTINCT FROM true))
    OR NOT EXISTS(SELECT 1 FROM v2.roles WHERE name='qc-manager' AND capabilities='["use-ai-tools","review-incidents","manage-allergens","record-qc","manage-qc"]'::jsonb AND builtin=false)
    OR NOT EXISTS(SELECT 1 FROM v2.roles WHERE name='warehouse' AND capabilities='["manage-inventory"]'::jsonb AND builtin=false)
    OR NOT EXISTS(SELECT 1 FROM v2.roles WHERE name='qc-operator' AND capabilities='["record-qc"]'::jsonb AND builtin=true) THEN
   RAISE EXCEPTION 'V2 reviewed role seeds are missing or conflict with approved capabilities';
 END IF;
END
$v2_verify$;
COMMIT;
