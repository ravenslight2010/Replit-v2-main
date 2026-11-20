BEGIN;

DO $$
DECLARE
  v_facility uuid;
  v_actor uuid := '89000000-0000-4000-8000-000000000091';
  v_import jsonb;
  v_sources jsonb;
  v_revision bigint;
BEGIN
  SELECT facility_id INTO STRICT v_facility FROM v2.facility_scope WHERE singleton;
  IF NOT has_function_privilege(
    'v2_api_test', 'v2.get_operational_mix_plan_sources(uuid,date)', 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'The restricted API role cannot read the operational mix plan.';
  END IF;
  IF has_table_privilege('v2_api_test', 'v2.setup_mix_records', 'SELECT')
     OR has_table_privilege('v2_api_test', 'v2.production_schedules', 'SELECT')
     OR has_table_privilege('v2_api_test', 'v2.runs', 'SELECT') THEN
    RAISE EXCEPTION 'The restricted API role received direct source-table access.';
  END IF;

  INSERT INTO v2.products(facility_id, code, name, base_unit)
  VALUES
    (v_facility, 'MIXPLAN-PRODUCT', 'Mix Plan Product', 'case'),
    (v_facility, 'MIXPLAN-CARTON', 'Mix Plan Carton', 'each'),
    (v_facility, 'MIXPLAN-RAW', 'Mix Plan Raw Flour', 'lb'),
    (v_facility, 'MIXPLAN-PREP', 'Mix Plan Prepared Mix', 'each');

  INSERT INTO v2.master_records(facility_id, kind, code, name, product_code, data)
  VALUES
    (v_facility, 'recipes', 'MIXPLAN-RECIPE', 'Mix Plan Recipe', 'MIXPLAN-PRODUCT',
     '{"station_key":"dough","ingredients":[{"product_code":"MIXPLAN-PREP","quantity":3,"unit":"each"}]}'::jsonb),
    (v_facility, 'production-setups', 'MIXPLAN-SETUP', 'Mix Plan Setup', 'MIXPLAN-PRODUCT',
     '{"recipe_codes":["MIXPLAN-RECIPE"],"packaging_per_case":[{"product_code":"MIXPLAN-CARTON","quantity":1,"unit":"each"}]}'::jsonb);

  v_import := v2.stage_setup_catalog_import(
    v_facility, v_actor, 'mix-plan-source-ingredient', repeat('a',64), 'ingredients',
    '[{"code":"MIXPLAN-FLOUR","name":"Mix Plan Flour","data":{"categories":["dough"],"allergens":[],"allergensReviewed":true,"mergedIntoCode":null,"enabled":true}}]'::jsonb
  );
  PERFORM v2.apply_setup_catalog_import(v_facility, v_actor, (v_import->>'importId')::uuid);

  v_import := v2.stage_setup_catalog_import(
    v_facility, v_actor, 'mix-plan-source-mixes', repeat('b',64), 'mixes',
    '[
      {"code":"MIXPLAN-REGULAR","name":"Regular mix","data":{"brand":"Mix Plan","flavor":"Plain","batchSizeLbs":10,"daysEarly":1,"notes":"","isPrep":false,"enabled":true,"components":[{"ingredientName":"Mix Plan Flour","ingredientCode":"MIXPLAN-FLOUR","perPizzaOz":0.5}]}},
      {"code":"MIXPLAN-PREP","name":"Prepared mix","data":{"brand":"Mix Plan","flavor":"Plain","batchSizeLbs":10,"daysEarly":1,"notes":"","isPrep":true,"enabled":true,"components":[{"ingredientName":"Mix Plan Flour","ingredientCode":"MIXPLAN-FLOUR","perBatchLbs":2}]}}
    ]'::jsonb
  );
  PERFORM v2.apply_setup_catalog_import(v_facility, v_actor, (v_import->>'importId')::uuid);

  PERFORM v2.set_setup_inventory_link(
    v_facility, v_actor, 'mix-plan-source-raw-link', repeat('c',64),
    'ingredient', 'MIXPLAN-FLOUR', 'MIXPLAN-RAW', 2
  );
  PERFORM v2.set_setup_inventory_link(
    v_facility, v_actor, 'mix-plan-source-prep-link', repeat('d',64),
    'mix', 'MIXPLAN-PREP', 'MIXPLAN-PREP', 2
  );

  v_import := v2.stage_setup_catalog_import(
    v_facility, v_actor, 'mix-plan-source-template', repeat('e',64), 'run-templates',
    '[{"code":"MIXPLAN-TEMPLATE","name":"Mix Plan Template","data":{"brand":"Mix Plan","flavor":"Plain","values":{"pizzasPerCase":12,"crustsPerCycle":4,"cycleSpeed":2,"freezerTime":0}}}]'::jsonb
  );
  PERFORM v2.apply_setup_catalog_import(v_facility, v_actor, (v_import->>'importId')::uuid);

  PERFORM v2.apply_production_schedule_command(
    v_facility, v_actor, DATE '2031-04-05', 'mix-plan-schedule', repeat('f',64), 0,
    jsonb_build_object('type','add','run',jsonb_build_object(
      'id','89000000-0000-4000-8000-000000000092',
      'productCode','MIXPLAN-PRODUCT',
      'productionSetupCode','MIXPLAN-SETUP',
      'runTemplateCode','MIXPLAN-TEMPLATE',
      'targetCases',2,
      'notes',''
    ))
  );
  SELECT revision INTO STRICT v_revision FROM v2.production_schedules
  WHERE facility_id=v_facility AND production_date=DATE '2031-04-05';

  INSERT INTO v2.runs(facility_id,id,status,revision,created_at,updated_at,started_at,setup_snapshot)
  VALUES (
    v_facility, '89000000-0000-4000-8000-000000000093', 'running', 1,
    TIMESTAMPTZ '2031-04-05 10:00:00+00', TIMESTAMPTZ '2031-04-05 10:00:00+00',
    TIMESTAMPTZ '2031-04-05 10:00:00+00',
    '{"label":"Frozen active run","targetCases":1,"productCode":"MIXPLAN-PRODUCT","productionSetupCode":"MIXPLAN-SETUP","productionPlan":{"recipes":[{"ingredients":[{"productCode":"MIXPLAN-PREP","quantity":"2","unit":"each"}]}]}}'::jsonb
  );

  v_sources := v2.get_operational_mix_plan_sources(v_facility, DATE '2031-04-05');
  IF v_sources->>'makeDate' <> '2031-04-05'
     OR v_sources->>'timeZone' <> 'America/Chicago'
     OR jsonb_array_length(v_sources->'mixes') <> 2
     OR jsonb_array_length(v_sources->'schedules') <> 1
     OR jsonb_array_length(v_sources->'activeRuns') <> 1
     OR v_sources#>>'{schedules,0,runs,0,targetCases}' <> '2'
     OR v_sources#>>'{setups,0,recipes,0,ingredients,0,productCode}' <> 'MIXPLAN-PREP'
     OR v_sources#>>'{activeRuns,0,setupSnapshot,productionPlan,recipes,0,ingredients,0,productCode}' <> 'MIXPLAN-PREP' THEN
    RAISE EXCEPTION 'Operational mix plan did not return complete canonical sources: %', v_sources;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_sources->'mixes') AS mix(value)
    WHERE mix.value->>'code'='MIXPLAN-REGULAR'
      AND mix.value#>>'{components,0,perPizzaOz}'='0.5'
  ) OR NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_sources->'mixes') AS mix(value)
    WHERE mix.value->>'code'='MIXPLAN-PREP'
      AND mix.value#>>'{components,0,perBatchLbs}'='2'
      AND mix.value->>'outputProductCode'='MIXPLAN-PREP'
  ) THEN
    RAISE EXCEPTION 'Operational mix plan omitted recipe values or explicit product links: %', v_sources->'mixes';
  END IF;
  IF (SELECT revision FROM v2.production_schedules
      WHERE facility_id=v_facility AND production_date=DATE '2031-04-05') <> v_revision THEN
    RAISE EXCEPTION 'Reading the operational mix plan changed a schedule revision.';
  END IF;
END
$$;

ROLLBACK;
