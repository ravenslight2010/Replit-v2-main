DO $$
DECLARE
  v_facility uuid;
  v_actor uuid := '99000000-0000-4000-8000-000000000099';
  v_import uuid;
  v_values jsonb := '{
    "crustsPerCycle":10,"cycleSpeed":1.5,"speedAdjustment":1,"freezerTime":20,
    "casesPerLayer":5,"preTunnelMin":null,"postTunnelMin":null,
    "pressOvenMin":0,"frontlineMin":null
  }'::jsonb;
  v_unknown_lines jsonb := '{
    "crustsPerCycle":null,"cycleSpeed":null,"speedAdjustment":null,"freezerTime":null,
    "casesPerLayer":null,"preTunnelMin":null,"postTunnelMin":null,
    "pressOvenMin":null,"frontlineMin":null
  }'::jsonb;
  v_changed jsonb := '{
    "crustsPerCycle":12,"cycleSpeed":1.6,"speedAdjustment":1,"freezerTime":21,
    "casesPerLayer":5,"preTunnelMin":null,"postTunnelMin":null,
    "pressOvenMin":0,"frontlineMin":null
  }'::jsonb;
  v_lines jsonb;
  v_result jsonb;
  v_run uuid;
  v_stale boolean := false;
  v_rejected boolean := false;
  v_before jsonb;
  v_after jsonb;
BEGIN
  SELECT facility_id INTO STRICT v_facility FROM v2.facility_scope WHERE singleton;
  v_lines := v_values;

  v_import := (v2.stage_setup_catalog_import(
    v_facility, v_actor, 'die-default-test-types', repeat('a', 64), 'die-types',
    '[{"code":"DIE-REVIEW-TEST","name":"Reviewed die test","data":{}},
      {"code":"DIE-UNREVIEWED-TEST","name":"Unreviewed die test","data":{}}]'::jsonb,
    NULL
  )->>'importId')::uuid;
  PERFORM v2.apply_setup_catalog_import(v_facility, v_actor, v_import);

  v_import := (v2.stage_setup_catalog_import(
    v_facility, v_actor, 'die-default-test-suggestions', repeat('b', 64), 'die-line-defaults',
    '[{"code":"DIE-REVIEW-TEST","name":"Reviewed die test","data":{
      "crusts_per_cycle":10,"cycle_speed":1.5,"speed_adjustment":1,"freezer_time":20,
      "cases_per_layer":5,"pre_tunnel_min":null,"post_tunnel_min":null,
      "press_oven_min":0,"frontline_min":null
    }}]'::jsonb,
    NULL
  )->>'importId')::uuid;
  PERFORM v2.apply_setup_catalog_import(v_facility, v_actor, v_import);

  v_result := v2.list_die_defaults(v_facility);
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_result) AS item(value)
    WHERE item.value->>'code' = 'DIE-REVIEW-TEST'
      AND item.value->>'status' = 'unreviewed'
      AND item.value->'defaults' = 'null'::jsonb
      AND item.value->'suggestedDefaults'->>'cycleSpeed' = '1.5'
  ) THEN RAISE EXCEPTION 'An imported suggestion was treated as reviewed or not shown explicitly'; END IF;

  v_result := v2.save_die_default(
    v_facility, v_actor, 'die-default-create', repeat('c', 64),
    'DIE-REVIEW-TEST', 0, v_values, true
  );
  IF v_result->>'outcome' <> 'created' OR v_result->>'status' <> 'active'
     OR v_result->>'revision' <> '1' OR v_result->>'replayed' <> 'false' THEN
    RAISE EXCEPTION 'Manager-reviewed defaults were not created at revision one: %', v_result;
  END IF;
  v_result := v2.save_die_default(
    v_facility, v_actor, 'die-default-create', repeat('c', 64),
    'DIE-REVIEW-TEST', 0, v_values, true
  );
  IF v_result->>'replayed' <> 'true'
     OR (SELECT count(*) FROM v2.die_default_events WHERE facility_id = v_facility) <> 1 THEN
    RAISE EXCEPTION 'Die-default write retry duplicated history or was not confirmed';
  END IF;
  IF (SELECT count(*) FROM v2.die_default_events
      WHERE facility_id = v_facility AND actor_id = v_actor AND action = 'created') <> 1 THEN
    RAISE EXCEPTION 'The create event did not retain its manager attribution';
  END IF;

  v_result := v2.create_planned_run(
    v_facility, v_actor, 'die-default-run-unreviewed', repeat('5', 64),
    jsonb_build_object(
      'label', 'Unreviewed die stays explicit', 'targetCases', 1,
      'productCode', 'R6-PIZZA', 'productionSetupCode', 'R6-LINE',
      'dieSetup', jsonb_build_object(
        'dieTypeCode', 'DIE-UNREVIEWED-TEST', 'expectedRevision', 0, 'lineSettings', v_unknown_lines
      )
    )
  );
  IF v_result->'run'->'setupSnapshot'->'dieSetup'->>'defaultStatus' <> 'unreviewed'
     OR v_result->'run'->'setupSnapshot'->'dieSetup'->'lineSettings' <> v_unknown_lines THEN
    RAISE EXCEPTION 'An unreviewed die received invented defaults or lost its explicit unknown values';
  END IF;

  v_result := v2.create_planned_run(
    v_facility, v_actor, 'die-default-run-create', repeat('d', 64),
    jsonb_build_object(
      'label', 'Reviewed die snapshot', 'targetCases', 12,
      'productCode', 'R6-PIZZA', 'productionSetupCode', 'R6-LINE',
      'dieSetup', jsonb_build_object(
        'dieTypeCode', 'DIE-REVIEW-TEST', 'expectedRevision', 1, 'lineSettings', v_lines
      )
    )
  );
  v_run := (v_result->'run'->>'id')::uuid;
  IF v_result->'run'->'setupSnapshot'->'dieSetup'->>'defaultStatus' <> 'active'
     OR v_result->'run'->'setupSnapshot'->'dieSetup'->>'defaultRevision' <> '1'
     OR v_result->'run'->'setupSnapshot'->'dieSetup'->'lineSettings' <> v_values THEN
    RAISE EXCEPTION 'The run did not persist the reviewed die settings as a creation snapshot';
  END IF;
  PERFORM v2.apply_run_lifecycle_command(
    v_facility, v_run, v_actor, 'die-default-run-start', repeat('e', 64), 'start', 0
  );
  v_before := v2.run_snapshot(v_facility, v_run)->'setupSnapshot'->'dieSetup';

  v_result := v2.save_die_default(
    v_facility, v_actor, 'die-default-update', repeat('f', 64),
    'DIE-REVIEW-TEST', 1, v_changed, true
  );
  IF v_result->>'revision' <> '2' OR v_result->>'outcome' <> 'updated' THEN
    RAISE EXCEPTION 'Reviewed default update did not advance its revision';
  END IF;
  v_after := v2.run_snapshot(v_facility, v_run)->'setupSnapshot'->'dieSetup';
  IF v_after <> v_before OR v_after->'lineSettings' <> v_values THEN
    RAISE EXCEPTION 'A manager default change altered an active run snapshot';
  END IF;

  BEGIN
    PERFORM v2.create_planned_run(
      v_facility, v_actor, 'die-default-run-stale', repeat('1', 64),
      jsonb_build_object(
        'label', 'Stale die selection', 'targetCases', 1,
        'productCode', 'R6-PIZZA', 'productionSetupCode', 'R6-LINE',
        'dieSetup', jsonb_build_object(
          'dieTypeCode', 'DIE-REVIEW-TEST', 'expectedRevision', 1, 'lineSettings', v_lines
        )
      )
    );
  EXCEPTION WHEN SQLSTATE '40001' THEN v_stale := true;
  END;
  IF NOT v_stale THEN RAISE EXCEPTION 'A stale run default revision was accepted'; END IF;

  v_result := v2.save_die_default(
    v_facility, v_actor, 'die-default-retire', repeat('2', 64),
    'DIE-REVIEW-TEST', 2, v_changed, false
  );
  IF v_result->>'status' <> 'disabled' OR v_result->>'outcome' <> 'retired'
     OR (SELECT count(*) FROM v2.die_default_events WHERE facility_id = v_facility) <> 3 THEN
    RAISE EXCEPTION 'Retirement did not disable defaults and append attributed history';
  END IF;
  v_result := v2.create_planned_run(
    v_facility, v_actor, 'die-default-run-disabled', repeat('3', 64),
    jsonb_build_object(
      'label', 'Disabled die snapshot', 'targetCases', 1,
      'productCode', 'R6-PIZZA', 'productionSetupCode', 'R6-LINE',
      'dieSetup', jsonb_build_object(
        'dieTypeCode', 'DIE-REVIEW-TEST', 'expectedRevision', 3, 'lineSettings', v_lines
      )
    )
  );
  IF v_result->'run'->'setupSnapshot'->'dieSetup'->>'defaultStatus' <> 'disabled' THEN
    RAISE EXCEPTION 'A disabled default state was not explicit in the run snapshot';
  END IF;

  INSERT INTO v2.products (facility_id, code, name, base_unit)
  VALUES (v_facility, 'R8-BOUGHT-CRUST', 'Bought crust test', 'case');
  INSERT INTO v2.master_records (facility_id, kind, code, name, product_code, data)
  VALUES
    (v_facility, 'recipes', 'R8-BOUGHT-RECIPE', 'Bought crust line', 'R8-BOUGHT-CRUST',
     '{"station_key":"cheese","ingredients":[{"product_code":"R6-FLOUR","quantity":1,"unit":"lb"}]}'::jsonb),
    (v_facility, 'production-setups', 'R8-BOUGHT-SETUP', 'Bought crust setup', 'R8-BOUGHT-CRUST',
     '{"recipe_codes":["R8-BOUGHT-RECIPE"],"packaging_per_case":[{"product_code":"R6-BOX","quantity":1,"unit":"each"}]}'::jsonb);
  v_result := v2.list_run_products(v_facility);
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_result->'products') AS product(value)
    CROSS JOIN LATERAL jsonb_array_elements(product.value->'productionSetups') AS setup(value)
    WHERE product.value->>'code' = 'R8-BOUGHT-CRUST'
      AND setup.value->>'code' = 'R8-BOUGHT-SETUP'
      AND setup.value->>'hasDoughRecipe' = 'false'
  ) THEN RAISE EXCEPTION 'A bought-crust setup was incorrectly marked as a dough/die setup'; END IF;
  BEGIN
    PERFORM v2.create_planned_run(
      v_facility, v_actor, 'die-default-bought-crust', repeat('4', 64),
      jsonb_build_object(
        'label', 'Bought crust must not receive die', 'targetCases', 1,
        'productCode', 'R8-BOUGHT-CRUST', 'productionSetupCode', 'R8-BOUGHT-SETUP',
        'dieSetup', jsonb_build_object(
          'dieTypeCode', 'DIE-REVIEW-TEST', 'expectedRevision', 3, 'lineSettings', v_lines
        )
      )
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'A bought-crust run accepted an inapplicable die'; END IF;

  IF jsonb_array_length(v2.list_die_default_events(v_facility, 50)) <> 3 THEN
    RAISE EXCEPTION 'Die-default history is incomplete';
  END IF;
  RAISE NOTICE 'Reviewed V2 die defaults and immutable run snapshots passed';
END
$$;
