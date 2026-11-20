BEGIN;

DO $$
DECLARE
  v_facility uuid;
  v_actor uuid := '98000000-0000-4000-8000-000000000008';
  v_product_import uuid;
  v_ingredient_import uuid;
  v_mix_import uuid;
  v_main uuid;
  v_freezer uuid;
  v_run uuid;
  v_count uuid;
  v_result jsonb;
  v_replay jsonb;
  v_raw_id uuid;
  v_alt_id uuid;
  v_prep_id uuid;
  v_lot_id uuid;
  v_raw numeric;
  v_prepared numeric;
  v_movement_count integer;
  v_line jsonb;
  v_failed boolean;
BEGIN
  SELECT facility_id INTO STRICT v_facility FROM v2.facility_scope WHERE singleton;
  SELECT id INTO STRICT v_main FROM v2.inventory_warehouses
    WHERE facility_id=v_facility AND is_production;

  v_product_import := (v2.stage_setup_import(
    v_facility,v_actor,'inventory-parity-products',repeat('8',64),'products',
    '[
      {"code":"R8-RAW","name":"Parity raw flour","unit":"lb"},
      {"code":"R8-PREP","name":"Parity prepared mix","unit":"lb"},
      {"code":"R8-ALT","name":"Parity alternate flour","unit":"lb"}
    ]'::jsonb
  )->>'importId')::uuid;
  PERFORM v2.apply_setup_import(v_facility,v_actor,v_product_import);
  SELECT id INTO STRICT v_raw_id FROM v2.products WHERE facility_id=v_facility AND code='R8-RAW';
  SELECT id INTO STRICT v_prep_id FROM v2.products WHERE facility_id=v_facility AND code='R8-PREP';
  SELECT id INTO STRICT v_alt_id FROM v2.products WHERE facility_id=v_facility AND code='R8-ALT';

  v_ingredient_import := (v2.stage_setup_catalog_import(
    v_facility,v_actor,'inventory-parity-ingredient',repeat('9',64),'ingredients',
    '[{"code":"R8-ING","name":"Parity raw flour","data":{"categories":["dough"],"allergens":[],"allergensReviewed":true,"mergedIntoCode":null,"enabled":true}}]'::jsonb
  )->>'importId')::uuid;
  PERFORM v2.apply_setup_catalog_import(v_facility,v_actor,v_ingredient_import);
  v_mix_import := (v2.stage_setup_catalog_import(
    v_facility,v_actor,'inventory-parity-mix',repeat('a',64),'mixes',
    '[{"code":"R8-MIX","name":"Parity prepared mix","data":{"brand":"Test","flavor":"Plain","batchSizeLbs":20,"daysEarly":0,"notes":"","isPrep":true,"enabled":true,"components":[{"ingredientName":"Parity raw flour","ingredientCode":"R8-ING","perPizzaOz":0.1,"perBatchLbs":2}]}}]'::jsonb
  )->>'importId')::uuid;
  PERFORM v2.apply_setup_catalog_import(v_facility,v_actor,v_mix_import);

  PERFORM v2.set_setup_inventory_link(
    v_facility,v_actor,'inventory-parity-link-ingredient',repeat('b',64),
    'ingredient','R8-ING','R8-RAW',1
  );
  PERFORM v2.set_setup_inventory_link(
    v_facility,v_actor,'inventory-parity-link-mix',repeat('c',64),
    'mix','R8-MIX','R8-PREP',1
  );
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v2.list_inventory_preparation_setup(v_facility)->'mixes') m(value)
    WHERE m.value->>'code'='R8-MIX' AND m.value->>'productCode'='R8-PREP'
      AND m.value->'components'->0->>'productCode'='R8-RAW'
  ) THEN RAISE EXCEPTION 'Preparation setup did not expose explicit ingredient and output mappings'; END IF;

  v_result := v2.record_inventory_movement_with_lot(
    v_facility,v_actor,'inventory-parity-raw-receipt',repeat('d',64),
    v_main,'R8-RAW','receipt',20,'Received raw ingredient','RAW-LOT-1','Delivery note 42'
  );
  IF v_result->>'quantity' <> '20.000000' THEN RAISE EXCEPTION 'Raw receipt did not update balance: %',v_result; END IF;
  v_result := v2.record_inventory_movement_with_lot(
    v_facility,v_actor,'inventory-parity-alt-receipt',repeat('e',64),
    v_main,'R8-ALT','receipt',100,'Received alternate flour','ALT-LOT-1','Delivery note 43'
  );
  v_result := v2.prepare_inventory_mix(
    v_facility,v_actor,'inventory-parity-prep',repeat('f',64),'R8-MIX',
    v_main,v_main,2,'PREP-LOT-2','Mix sheet 12','Prepare two batches'
  );
  IF v_result->>'outcome'<>'prepared' OR (v_result->>'preparedQuantity')::numeric<>40
     OR jsonb_array_length(v_result->'components')<>1
     OR (v_result->'components'->0->>'quantity')::numeric<>4 THEN
    RAISE EXCEPTION 'Linked mix formula did not consume raw pounds and produce prepared pounds: %',v_result;
  END IF;
  v_replay := v2.prepare_inventory_mix(
    v_facility,v_actor,'inventory-parity-prep',repeat('f',64),'R8-MIX',
    v_main,v_main,2,'PREP-LOT-2','Mix sheet 12','Prepare two batches'
  );
  IF v_replay->>'replayed'<>'true' THEN RAISE EXCEPTION 'Preparation retry was not idempotent'; END IF;
  SELECT quantity INTO STRICT v_raw FROM v2.inventory_balances
    WHERE facility_id=v_facility AND warehouse_id=v_main AND product_id=v_raw_id;
  SELECT quantity INTO STRICT v_prepared FROM v2.inventory_balances
    WHERE facility_id=v_facility AND warehouse_id=v_main AND product_id=v_prep_id;
  IF v_raw<>16 OR v_prepared<>40 THEN
    RAISE EXCEPTION 'Raw and prepared stock were not kept separate: raw %, prepared %',v_raw,v_prepared;
  END IF;

  v_result := v2.create_inventory_warehouse(
    v_facility,v_actor,'inventory-parity-freezer',repeat('1',64),'Parity freezer'
  );
  v_freezer := (v_result->'warehouse'->>'id')::uuid;
  v_count := (v2.stage_opening_count(
    v_facility,v_actor,'inventory-parity-freezer-opening',repeat('2',64),v_freezer,
    (SELECT jsonb_agg(jsonb_build_object('productCode',p.code,'quantity','0') ORDER BY p.code)
       FROM v2.products p WHERE p.facility_id=v_facility AND p.active)
  )->>'countId')::uuid;
  PERFORM v2.review_opening_count(v_facility,v_actor,v_count);
  PERFORM v2.apply_opening_count(v_facility,v_actor,v_count);
  v_result := v2.transfer_inventory(
    v_facility,v_actor,'inventory-parity-freezer-transfer',repeat('3',64),
    v_main,v_freezer,'R8-RAW',1,'Freezer pull to reserve'
  );
  IF v_result->>'sourceQuantity'<>'15.000000' OR v_result->>'targetQuantity'<>'1.000000' THEN
    RAISE EXCEPTION 'Warehouse transfer did not preserve separate balances: %',v_result;
  END IF;
  SELECT id INTO STRICT v_lot_id FROM v2.inventory_lots
    WHERE facility_id=v_facility AND warehouse_id=v_main AND product_id=v_raw_id
      AND lot_number='RAW-LOT-1';
  IF NOT EXISTS (
    SELECT 1 FROM v2.inventory_lots
    WHERE facility_id=v_facility AND warehouse_id=v_freezer AND product_id=v_raw_id
      AND source_lot_id=v_lot_id AND quantity_remaining=1
  ) THEN RAISE EXCEPTION 'Transfer did not retain source-lot lineage'; END IF;

  v_result := v2.stage_run_inventory_supply(
    v_facility,v_actor,'inventory-parity-stage',repeat('a',64),
    (v2.create_planned_run(
      v_facility,v_actor,'inventory-parity-run',repeat('b',64),
      '{"label":"Inventory parity run","targetCases":1,"productCode":"R6-PIZZA","productionSetupCode":"R6-LINE"}'::jsonb
    )->'run'->>'id')::uuid,
    'R6-FLOUR','R8-ALT',99,'Use alternate flour'
  );
  v_run := (v_result->>'runId')::uuid;
  IF v_result->>'outcome'<>'staged' THEN RAISE EXCEPTION 'Run supply did not stage: %',v_result; END IF;
  v_replay := v2.stage_run_inventory_supply(
    v_facility,v_actor,'inventory-parity-stage',repeat('a',64),
    v_run,'R6-FLOUR','R8-ALT',99,'Use alternate flour'
  );
  IF v_replay->>'replayed'<>'true' THEN RAISE EXCEPTION 'Staged supply retry was not idempotent'; END IF;
  v_failed := false;
  BEGIN
    PERFORM v2.record_inventory_movement_with_lot(
      v_facility,v_actor,'inventory-parity-reserved-stock',repeat('c',64),
      v_main,'R8-ALT','adjustment',-2,'Do not consume staged stock','',''
    );
  EXCEPTION WHEN check_violation THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'Manual adjustment consumed stock reserved for a run'; END IF;
  IF (SELECT (v2.list_inventory_stock(v_facility,v_main)->(
      SELECT ordinality::integer-1 FROM jsonb_array_elements(v2.list_inventory_stock(v_facility,v_main))
        WITH ORDINALITY AS x(value,ordinality) WHERE value->>'code'='R8-ALT'
    )->>'stagedQuantity')::numeric) <> 99 THEN
    RAISE EXCEPTION 'Staged stock was not reflected in available inventory totals';
  END IF;
  INSERT INTO v2.run_station_progress(facility_id,run_id,station_key,status,progress,updated_at)
  VALUES(v_facility,v_run,'dough','not_started','{"batchesMade":1}'::jsonb,clock_timestamp());
  PERFORM v2.apply_run_lifecycle_command(
    v_facility,v_run,v_actor,'inventory-parity-run-start',repeat('d',64),'start',0
  );
  v_result := v2.complete_run_with_inventory(
    v_facility,v_run,v_actor,'inventory-parity-run-complete',repeat('e',64),'complete',1
  );
  SELECT value INTO STRICT v_line FROM jsonb_array_elements(v_result->'run'->'inventoryConsumption'->'lines')
    WHERE value->>'productCode'='R8-ALT';
  IF v_result->'run'->>'status'<>'completed'
     OR v_line->>'plannedProductCode'<>'R6-FLOUR'
     OR (v_line->>'deducted')::numeric<>99
     OR (SELECT quantity FROM v2.inventory_balances
       WHERE facility_id=v_facility AND warehouse_id=v_main AND product_id=v_alt_id)<>1
     OR (SELECT quantity_used FROM v2.run_inventory_stage_receipts r
       JOIN v2.run_inventory_staged_supplies s ON s.facility_id=r.facility_id AND s.id=r.staged_supply_id
       WHERE r.facility_id=v_facility AND s.run_id=v_run)<>99 THEN
    RAISE EXCEPTION 'Run completion did not deduct the exact staged substitute: %',v_result;
  END IF;
  SELECT count(*) INTO v_movement_count FROM v2.inventory_movements
    WHERE facility_id=v_facility AND run_id=v_run;
  v_replay := v2.complete_run_with_inventory(
    v_facility,v_run,v_actor,'inventory-parity-run-complete',repeat('e',64),'complete',1
  );
  IF v_replay->>'replayed'<>'true'
     OR (SELECT count(*) FROM v2.inventory_movements WHERE facility_id=v_facility AND run_id=v_run)<>v_movement_count THEN
    RAISE EXCEPTION 'Retrying completed run duplicated inventory movements';
  END IF;

  v_count := (v2.stage_inventory_cycle_count(
    v_facility,v_actor,'inventory-parity-stale-count',repeat('4',64),v_main,
    '[{"productCode":"R8-RAW","quantity":"14"}]'::jsonb,'Test stale count'
  )->>'countId')::uuid;
  PERFORM v2.record_inventory_movement_with_lot(
    v_facility,v_actor,'inventory-parity-stale-delta',repeat('5',64),
    v_main,'R8-RAW','adjustment',1,'Count-day delta','',''
  );
  v_result := v2.review_inventory_cycle_count(v_facility,v_actor,v_count);
  IF v_result->>'outcome'<>'stale' THEN RAISE EXCEPTION 'Stale count was not fenced before review: %',v_result; END IF;

  v_count := (v2.stage_inventory_cycle_count(
    v_facility,v_actor,'inventory-parity-reviewed-count',repeat('6',64),v_main,
    '[{"productCode":"R8-RAW","quantity":"15"}]'::jsonb,'Verified shelf count'
  )->>'countId')::uuid;
  v_result := v2.review_inventory_cycle_count(v_facility,v_actor,v_count);
  IF v_result->>'outcome'<>'reviewed' OR v_result->'rows'->0->>'variance'<>'-1.000000' THEN
    RAISE EXCEPTION 'Fresh count review did not show its absolute variance: %',v_result;
  END IF;
  PERFORM v2.record_inventory_movement_with_lot(
    v_facility,v_actor,'inventory-parity-after-review-delta',repeat('7',64),
    v_main,'R8-RAW','adjustment',1,'Concurrent count-day delta','',''
  );
  v_result := v2.apply_inventory_cycle_count(v_facility,v_actor,v_count,true);
  IF v_result->>'outcome'<>'stale' THEN RAISE EXCEPTION 'Count changed after review was not fenced: %',v_result; END IF;

  v_count := (v2.stage_inventory_cycle_count(
    v_facility,v_actor,'inventory-parity-fresh-count',repeat('8',64),v_main,
    '[{"productCode":"R8-RAW","quantity":"16"}]'::jsonb,'Fresh acknowledged count'
  )->>'countId')::uuid;
  PERFORM v2.review_inventory_cycle_count(v_facility,v_actor,v_count);
  v_result := v2.apply_inventory_cycle_count(v_facility,v_actor,v_count,true);
  IF v_result->>'outcome'<>'applied' OR v_result->>'replayed'<>'false' THEN
    RAISE EXCEPTION 'Fresh acknowledged cycle count did not apply: %',v_result;
  END IF;
  v_replay := v2.apply_inventory_cycle_count(v_facility,v_actor,v_count,true);
  IF v_replay->>'replayed'<>'true' THEN RAISE EXCEPTION 'Cycle-count retry was not idempotent'; END IF;

  IF EXISTS (
    SELECT 1 FROM v2.inventory_balances b
    WHERE b.facility_id=v_facility AND b.quantity<>COALESCE((
      SELECT sum(m.quantity_delta) FROM v2.inventory_movements m
      WHERE m.facility_id=b.facility_id AND m.warehouse_id=b.warehouse_id AND m.product_id=b.product_id
    ),0)
  ) THEN RAISE EXCEPTION 'Inventory balance does not reconcile to its append-only ledger'; END IF;
  IF EXISTS (
    SELECT 1 FROM v2.inventory_balances b
    WHERE b.facility_id=v_facility AND b.quantity<>COALESCE((
      SELECT sum(l.quantity_remaining) FROM v2.inventory_lots l
      WHERE l.facility_id=b.facility_id AND l.warehouse_id=b.warehouse_id AND l.product_id=b.product_id
    ),0)
  ) THEN RAISE EXCEPTION 'Lot quantities do not reconcile to on-hand stock'; END IF;
  IF EXISTS (SELECT 1 FROM v2.inventory_balances WHERE facility_id=v_facility AND quantity<0) THEN
    RAISE EXCEPTION 'An inventory workflow created negative stock';
  END IF;
  IF has_function_privilege('v2_api_test',
       'v2.record_inventory_movement_internal(uuid,uuid,text,text,uuid,text,text,numeric,text,text,text)','EXECUTE') THEN
    RAISE EXCEPTION 'The restricted API role can execute the internal movement helper';
  END IF;
END
$$;

ROLLBACK;

SELECT 'V2 inventory lot, preparation, cycle-count and transfer checks passed.';
