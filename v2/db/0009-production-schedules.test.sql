BEGIN;

DO $$
DECLARE
  v_facility uuid;
  v_actor uuid := '88000000-0000-4000-8000-000000000081';
  v_date date := DATE '2031-04-05';
  v_run_a uuid := '88000000-0000-4000-8000-000000000082';
  v_run_b uuid := '88000000-0000-4000-8000-000000000083';
  v_run_import uuid := '88000000-0000-5000-8000-000000000084';
  v_template_import uuid;
  v_result jsonb;
  v_schedule jsonb;
  v_live_count integer;
BEGIN
  SELECT facility_id INTO STRICT v_facility FROM v2.facility_scope WHERE singleton;

  INSERT INTO v2.products(facility_id, code, name, base_unit, active)
  VALUES (v_facility, 'SCHED-PRODUCT', 'Schedule Test Product', 'case', true);
  INSERT INTO v2.products(facility_id, code, name, base_unit, active)
  VALUES (v_facility, 'SCHED-CARTON', 'Schedule Test Carton', 'each', true);
  INSERT INTO v2.products(facility_id, code, name, base_unit, active)
  VALUES (v_facility, 'SCHED-FLOUR', 'Schedule Test Flour', 'lb', true);
  INSERT INTO v2.master_records(facility_id, kind, code, name, product_code, data)
  VALUES (
    v_facility, 'recipes', 'SCHED-RECIPE', 'Schedule Test Recipe', 'SCHED-PRODUCT',
    '{"station_key":"dough","ingredients":[{"product_code":"SCHED-FLOUR","quantity":1,"unit":"lb"}]}'::jsonb
  );
  INSERT INTO v2.master_records(facility_id, kind, code, name, product_code, data)
  VALUES (
    v_facility, 'production-setups', 'SCHED-SETUP', 'Schedule Test Setup', 'SCHED-PRODUCT',
    '{"recipe_codes":["SCHED-RECIPE"],"packaging_per_case":[{"product_code":"SCHED-CARTON","quantity":1,"unit":"each"}]}'::jsonb
  );

  v_result := v2.stage_setup_catalog_import(
    v_facility, v_actor, 'schedule-template-test', repeat('8',64), 'run-templates',
    '[{"code":"SCHED-TEMPLATE","name":"Schedule Test Template","data":{"brand":"Schedule","flavor":"Test","values":{"pizzasPerCase":12,"crustsPerCycle":4,"cycleSpeed":2,"freezerTime":0}}}]'::jsonb
  );
  v_template_import := (v_result->>'importId')::uuid;
  PERFORM v2.apply_setup_catalog_import(v_facility, v_actor, v_template_import);

  v_schedule := v2.get_production_schedule(v_facility, v_date);
  IF v_schedule->>'revision' <> '0'
     OR v_schedule->>'timeZone' <> 'America/Chicago'
     OR v_schedule->>'productionStartTime' <> '06:00'
     OR jsonb_array_length(v_schedule->'runs') <> 0 THEN
    RAISE EXCEPTION 'An empty schedule did not return the Central-time default.';
  END IF;

  SELECT count(*) INTO v_live_count FROM v2.runs WHERE facility_id = v_facility;
  v_result := v2.apply_production_schedule_command(
    v_facility, v_actor, v_date, 'schedule-add-run-a', repeat('a',64), 0,
    jsonb_build_object('type','add','run',jsonb_build_object(
      'id',v_run_a,'productCode','SCHED-PRODUCT','productionSetupCode','SCHED-SETUP',
      'runTemplateCode','SCHED-TEMPLATE','targetCases',20,'notes','PO 123'
    ))
  );
  IF v_result->>'outcome' <> 'accepted' OR v_result#>>'{schedule,revision}' <> '1'
     OR jsonb_array_length(v_result#>'{schedule,runs}') <> 1
     OR v_result#>>'{schedule,runs,0,notes}' <> 'PO 123' THEN
    RAISE EXCEPTION 'A planned run was not saved as a revisioned schedule entry.';
  END IF;
  IF (SELECT count(*) FROM v2.runs WHERE facility_id = v_facility) <> v_live_count THEN
    RAISE EXCEPTION 'Saving a planned schedule run created a live run.';
  END IF;

  v_result := v2.apply_production_schedule_command(
    v_facility, v_actor, v_date, 'schedule-add-run-a', repeat('a',64), 0,
    jsonb_build_object('type','add','run',jsonb_build_object(
      'id',v_run_a,'productCode','SCHED-PRODUCT','productionSetupCode','SCHED-SETUP',
      'runTemplateCode','SCHED-TEMPLATE','targetCases',20,'notes','PO 123'
    ))
  );
  IF v_result->>'replayed' <> 'true'
     OR (SELECT revision FROM v2.production_schedules WHERE facility_id = v_facility AND production_date = v_date) <> 1 THEN
    RAISE EXCEPTION 'An exact retry changed the schedule more than once.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM v2.production_schedule_receipts
    WHERE facility_id = v_facility AND actor_id = v_actor AND request_id = 'schedule-add-run-a'
      AND (response ? 'schedule' OR response::text ILIKE '%PO 123%')
  ) THEN
    RAISE EXCEPTION 'An idempotency receipt duplicated imported schedule notes.';
  END IF;

  v_result := v2.apply_production_schedule_command(
    v_facility, v_actor, v_date, 'schedule-stale-add', repeat('b',64), 0,
    jsonb_build_object('type','add','run',jsonb_build_object(
      'id',v_run_b,'productCode','SCHED-PRODUCT','productionSetupCode','SCHED-SETUP',
      'runTemplateCode','SCHED-TEMPLATE','targetCases',10,'notes',''
    ))
  );
  IF v_result->>'outcome' <> 'conflict' OR v_result#>>'{schedule,revision}' <> '1' THEN
    RAISE EXCEPTION 'A stale schedule revision was not rejected with the latest plan.';
  END IF;

  v_result := v2.apply_production_schedule_command(
    v_facility, v_actor, v_date, 'schedule-add-run-b', repeat('c',64), 1,
    jsonb_build_object('type','add','run',jsonb_build_object(
      'id',v_run_b,'productCode','SCHED-PRODUCT','productionSetupCode','SCHED-SETUP',
      'runTemplateCode','SCHED-TEMPLATE','targetCases',10,'notes',''
    ))
  );
  IF v_result#>>'{schedule,revision}' <> '2'
     OR v_result#>>'{schedule,runs,1,id}' <> v_run_b::text THEN
    RAISE EXCEPTION 'A second planned run was not appended in order.';
  END IF;

  v_result := v2.apply_production_schedule_command(
    v_facility, v_actor, v_date, 'schedule-swap-runs', repeat('d',64), 2,
    jsonb_build_object('type','swap','firstRunId',v_run_a,'secondRunId',v_run_b)
  );
  IF v_result#>>'{schedule,runs,0,id}' <> v_run_b::text
     OR v_result#>>'{schedule,runs,1,id}' <> v_run_a::text THEN
    RAISE EXCEPTION 'Planned run swap did not preserve both entries.';
  END IF;

  v_result := v2.apply_production_schedule_command(
    v_facility, v_actor, v_date, 'schedule-break-assignment', repeat('e',64), 3,
    jsonb_build_object('type','breaks','breaks',jsonb_build_array(
      jsonb_build_object('slot',1,'enabled',true,'runId',v_run_a),
      jsonb_build_object('slot',2,'enabled',false,'runId',NULL),
      jsonb_build_object('slot',3,'enabled',false,'runId',NULL)
    ))
  );
  IF v_result#>>'{schedule,breaks,0,runId}' <> v_run_a::text THEN
    RAISE EXCEPTION 'A break was not assigned after the selected planned run.';
  END IF;

  v_result := v2.apply_production_schedule_command(
    v_facility, v_actor, v_date, 'schedule-import-merge', repeat('f',64), 4,
    jsonb_build_object('type','merge-import','runs',jsonb_build_array(
      jsonb_build_object(
        'id',v_run_import,'productCode','SCHED-PRODUCT','productionSetupCode','SCHED-SETUP',
        'runTemplateCode','SCHED-TEMPLATE','targetCases',5,'notes','Imported'
      ),
      jsonb_build_object(
        'id',v_run_a,'productCode','SCHED-PRODUCT','productionSetupCode','SCHED-SETUP',
        'runTemplateCode','SCHED-TEMPLATE','targetCases',22,'notes','Updated import'
      )
    ))
  );
  IF jsonb_array_length(v_result#>'{schedule,runs}') <> 3
     OR v_result#>>'{schedule,runs,1,targetCases}' <> '22'
     OR v_result#>>'{schedule,runs,2,id}' <> v_run_import::text THEN
    RAISE EXCEPTION 'Reviewed import did not merge idempotently with manual planned runs.';
  END IF;

  v_result := v2.apply_production_schedule_command(
    v_facility, v_actor, v_date, 'schedule-remove-run-a', repeat('1',64), 5,
    jsonb_build_object('type','remove','runId',v_run_a)
  );
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_result#>'{schedule,breaks}') AS item(value)
    WHERE value->>'runId' = v_run_a::text
  ) OR jsonb_array_length(v_result#>'{schedule,runs}') <> 2 THEN
    RAISE EXCEPTION 'Removing a planned run left a dangling break or removed unrelated rows.';
  END IF;

  IF (SELECT result FROM (SELECT v2.list_schedule_run_templates(v_facility) AS result) listed)
     ->0->'values' ? 'doughRecipe' THEN
    RAISE EXCEPTION 'The schedule catalog exposed recipe details that are not needed for estimates.';
  END IF;
END
$$;

ROLLBACK;
