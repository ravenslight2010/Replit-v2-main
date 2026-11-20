BEGIN;

DO $$
DECLARE
  v_facility uuid;
  v_actor uuid := '99600000-0000-4000-8000-000000000002';
  v_dough_source text := repeat('a', 64);
  v_ship_source text := repeat('b', 64);
  v_dough_import uuid := '99600000-0000-4000-8000-000000000010';
  v_ship_import uuid := '99600000-0000-4000-8000-000000000011';
  v_result jsonb;
  v_links jsonb;
  v_failed boolean;
BEGIN
  SELECT facility_id INTO STRICT v_facility FROM v2.facility_scope WHERE singleton;

  INSERT INTO v2.products (facility_id, code, name, base_unit, active)
  VALUES
    (v_facility, 'CAPACITY-A', 'Capacity Product A', 'case', true),
    (v_facility, 'CAPACITY-B', 'Capacity Product B', 'case', true),
    (v_facility, 'CAPACITY-OFF', 'Inactive Capacity Product', 'case', false);

  INSERT INTO v2.setup_imports (
    facility_id, id, actor_id, request_id, request_hash, kind, records, status,
    applied_by, before_snapshot, after_snapshot, result, applied_at
  ) VALUES
    (v_facility, v_dough_import, v_actor, 'dough-seed', repeat('1', 64), 'recipes',
      '[{"code":"DOUGH-SEED","name":"Dough","productCode":"CAPACITY-A","data":{}}]'::jsonb,
      'applied', v_actor, '[{"code":"DOUGH-SEED","data":null}]'::jsonb, '[]'::jsonb, '{}'::jsonb, clock_timestamp()),
    (v_facility, v_ship_import, v_actor, 'shipping-seed', repeat('2', 64), 'production-setups',
      '[{"code":"SHIP-SEED","name":"Shipping","productCode":"CAPACITY-A","data":{}}]'::jsonb,
      'applied', v_actor, '[{"code":"SHIP-SEED","data":null}]'::jsonb, '[]'::jsonb, '{}'::jsonb, clock_timestamp());

  INSERT INTO v2.master_records (
    facility_id, kind, code, name, product_code, data, source_import_id
  ) VALUES
    (v_facility, 'recipes', 'DOUGH-' || v_dough_source, 'Dough source', 'CAPACITY-A',
      jsonb_build_object('sourceFamily', 'dough-procedure', 'sourceKey', v_dough_source, 'doughballYield', 600),
      v_dough_import),
    (v_facility, 'production-setups', 'SHIP-' || v_ship_source, 'Shipping source', 'CAPACITY-A',
      jsonb_build_object('sourceFamily', 'shipping-guide', 'sourceKey', v_ship_source, 'pizzasPerCase', 12),
      v_ship_import);

  UPDATE v2.setup_imports
  SET after_snapshot = jsonb_build_array(jsonb_build_object('code', m.code, 'data', to_jsonb(m)))
  FROM v2.master_records AS m
  WHERE setup_imports.facility_id = v_facility
    AND setup_imports.id = v_dough_import
    AND m.facility_id = v_facility
    AND m.kind = 'recipes'
    AND m.data->>'sourceKey' = v_dough_source;
  UPDATE v2.setup_imports
  SET after_snapshot = jsonb_build_array(jsonb_build_object('code', m.code, 'data', to_jsonb(m)))
  FROM v2.master_records AS m
  WHERE setup_imports.facility_id = v_facility
    AND setup_imports.id = v_ship_import
    AND m.facility_id = v_facility
    AND m.kind = 'production-setups'
    AND m.data->>'sourceKey' = v_ship_source;

  v_result := v2.correct_workbook_source_link(
    v_facility, v_actor, 'correct-dough-link', repeat('a', 64),
    'dough-procedure', v_dough_source, 'CAPACITY-A', 'CAPACITY-B'
  );
  IF v_result->>'outcome' <> 'corrected'
     OR v_result->>'previousProductCode' <> 'CAPACITY-A'
     OR v_result->>'productCode' <> 'CAPACITY-B'
     OR (SELECT product_code FROM v2.master_records
         WHERE facility_id = v_facility AND data->>'sourceKey' = v_dough_source) <> 'CAPACITY-B'
     OR (SELECT source_import_id FROM v2.master_records
         WHERE facility_id = v_facility AND data->>'sourceKey' = v_dough_source) IS NOT NULL THEN
    RAISE EXCEPTION 'Dough source correction did not move the saved link or detach prior import ownership: %', v_result;
  END IF;

  v_result := v2.correct_workbook_source_link(
    v_facility, v_actor, 'correct-dough-link', repeat('a', 64),
    'dough-procedure', v_dough_source, 'CAPACITY-A', 'CAPACITY-B'
  );
  IF v_result->>'replayed' <> 'true' OR v_result->>'productCode' <> 'CAPACITY-B' THEN
    RAISE EXCEPTION 'A retried dough correction did not return its original result: %', v_result;
  END IF;

  v_failed := false;
  BEGIN
    PERFORM v2.correct_workbook_source_link(
      v_facility, v_actor, 'inactive-target', repeat('3', 64),
      'dough-procedure', v_dough_source, 'CAPACITY-B', 'CAPACITY-OFF'
    );
  EXCEPTION WHEN SQLSTATE '23503' THEN v_failed := true;
  END;
  IF NOT v_failed OR (SELECT product_code FROM v2.master_records
      WHERE facility_id = v_facility AND data->>'sourceKey' = v_dough_source) <> 'CAPACITY-B' THEN
    RAISE EXCEPTION 'A failed dough correction changed the previously saved link';
  END IF;

  v_failed := false;
  BEGIN
    PERFORM v2.correct_workbook_source_link(
      v_facility, v_actor, 'stale-dough-link', repeat('4', 64),
      'dough-procedure', v_dough_source, 'CAPACITY-A', 'CAPACITY-A'
    );
  EXCEPTION WHEN SQLSTATE '40001' THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'A stale expected product was accepted'; END IF;

  v_result := v2.correct_workbook_source_link(
    v_facility, v_actor, 'clear-dough-link', repeat('7', 64),
    'dough-procedure', v_dough_source, 'CAPACITY-B', NULL
  );
  IF v_result->>'outcome' <> 'cleared'
     OR v_result->>'previousProductCode' <> 'CAPACITY-B'
     OR (SELECT data->>'capacitySourceCleared' FROM v2.master_records
       WHERE facility_id = v_facility AND data->>'sourceKey' = v_dough_source) <> 'true' THEN
    RAISE EXCEPTION 'Dough source link was not cleared: %', v_result;
  END IF;
  v_links := v2.list_workbook_source_links(v_facility, 'dough-procedure');
  IF NOT (v_links @> jsonb_build_array(jsonb_build_object(
    'sourceKey', v_dough_source,
    'productCode', NULL
  ))) OR NOT (v2.dough_capacity_snapshot(v_facility, 'CAPACITY-B')->'reasons'
    @> '["dough_source_missing"]'::jsonb) THEN
    RAISE EXCEPTION 'A cleared dough source still linked or affected capacity: %', v_links;
  END IF;
  v_result := v2.correct_workbook_source_link(
    v_facility, v_actor, 'clear-dough-link', repeat('7', 64),
    'dough-procedure', v_dough_source, 'CAPACITY-B', NULL
  );
  IF v_result->>'replayed' <> 'true' OR v_result->>'outcome' <> 'cleared' THEN
    RAISE EXCEPTION 'A retried dough clear did not return its original result: %', v_result;
  END IF;
  v_result := v2.correct_workbook_source_link(
    v_facility, v_actor, 'restore-dough-link', repeat('a', 64),
    'dough-procedure', v_dough_source, NULL, 'CAPACITY-A'
  );
  IF v_result->>'outcome' <> 'corrected'
     OR v_result->'previousProductCode' <> 'null'::jsonb
     OR v_result->>'productCode' <> 'CAPACITY-A'
     OR (SELECT data ? 'capacitySourceCleared' FROM v2.master_records
       WHERE facility_id = v_facility AND data->>'sourceKey' = v_dough_source) THEN
    RAISE EXCEPTION 'A cleared dough source was not safely restored: %', v_result;
  END IF;

  v_failed := false;
  BEGIN
    PERFORM v2.undo_setup_import(v_facility, v_actor, v_dough_import);
  EXCEPTION WHEN SQLSTATE '40001' THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'Undo of the superseded dough mapping was not guarded'; END IF;

  v_result := v2.correct_workbook_source_link(
    v_facility, v_actor, 'correct-shipping-link', repeat('8', 64),
    'shipping-guide', v_ship_source, 'CAPACITY-A', 'CAPACITY-B'
  );
  IF v_result->>'outcome' <> 'corrected'
     OR v_result->>'previousProductCode' <> 'CAPACITY-A'
     OR (SELECT product_code FROM v2.master_records
       WHERE facility_id = v_facility AND data->>'sourceKey' = v_ship_source) <> 'CAPACITY-B' THEN
    RAISE EXCEPTION 'Shipping source correction did not move its saved link: %', v_result;
  END IF;
  v_result := v2.correct_workbook_source_link(
    v_facility, v_actor, 'correct-shipping-link', repeat('8', 64),
    'shipping-guide', v_ship_source, 'CAPACITY-A', 'CAPACITY-B'
  );
  IF v_result->>'replayed' <> 'true' OR v_result->>'productCode' <> 'CAPACITY-B' THEN
    RAISE EXCEPTION 'A retried shipping correction did not return its original result: %', v_result;
  END IF;
  v_failed := false;
  BEGIN
    PERFORM v2.correct_workbook_source_link(
      v_facility, v_actor, 'inactive-shipping-target', repeat('9', 64),
      'shipping-guide', v_ship_source, 'CAPACITY-B', 'CAPACITY-OFF'
    );
  EXCEPTION WHEN SQLSTATE '23503' THEN v_failed := true;
  END;
  IF NOT v_failed OR (SELECT product_code FROM v2.master_records
      WHERE facility_id = v_facility AND data->>'sourceKey' = v_ship_source) <> 'CAPACITY-B' THEN
    RAISE EXCEPTION 'A failed shipping correction changed the previously saved link';
  END IF;

  v_result := v2.correct_workbook_source_link(
    v_facility, v_actor, 'clear-shipping-link', repeat('5', 64),
    'shipping-guide', v_ship_source, 'CAPACITY-B', NULL
  );
  IF v_result->>'outcome' <> 'cleared'
     OR v_result->>'previousProductCode' <> 'CAPACITY-B'
     OR v_result->'productCode' <> 'null'::jsonb
     OR (SELECT data->>'sourceFamily' FROM v2.master_records
       WHERE facility_id = v_facility AND data->>'sourceKey' = v_ship_source)
       <> 'shipping-guide'
     OR (SELECT data->>'capacitySourceCleared' FROM v2.master_records
       WHERE facility_id = v_facility AND data->>'sourceKey' = v_ship_source) <> 'true'
     OR (SELECT source_import_id FROM v2.master_records
       WHERE facility_id = v_facility AND data->>'sourceKey' = v_ship_source) IS NOT NULL THEN
    RAISE EXCEPTION 'Shipping source link was not cleared: %', v_result;
  END IF;
  v_links := v2.list_workbook_source_links(v_facility, 'shipping-guide');
  IF NOT (v_links @> jsonb_build_array(jsonb_build_object(
    'sourceKey', v_ship_source,
    'productCode', NULL
  ))) THEN
    RAISE EXCEPTION 'A cleared source tombstone was not retained to suppress future exact auto-matching: %', v_links;
  END IF;
  IF NOT (v2.dough_capacity_snapshot(v_facility, 'CAPACITY-B')->'reasons'
    @> '["shipping_source_missing"]'::jsonb) THEN
    RAISE EXCEPTION 'A cleared shipping source still affected capacity';
  END IF;

  v_result := v2.correct_workbook_source_link(
    v_facility, v_actor, 'clear-shipping-link', repeat('5', 64),
    'shipping-guide', v_ship_source, 'CAPACITY-B', NULL
  );
  IF v_result->>'replayed' <> 'true' OR v_result->>'outcome' <> 'cleared' THEN
    RAISE EXCEPTION 'A retried shipping clear did not return its original result: %', v_result;
  END IF;
  v_result := v2.correct_workbook_source_link(
    v_facility, v_actor, 'restore-shipping-link', repeat('c', 64),
    'shipping-guide', v_ship_source, NULL, 'CAPACITY-B'
  );
  IF v_result->>'outcome' <> 'corrected'
     OR v_result->'previousProductCode' <> 'null'::jsonb
     OR v_result->>'productCode' <> 'CAPACITY-B'
     OR (SELECT data ? 'capacitySourceCleared' FROM v2.master_records
       WHERE facility_id = v_facility AND data->>'sourceKey' = v_ship_source) THEN
    RAISE EXCEPTION 'A cleared shipping source was not safely restored: %', v_result;
  END IF;

  v_failed := false;
  BEGIN
    PERFORM v2.undo_setup_import(v_facility, v_actor, v_ship_import);
  EXCEPTION WHEN SQLSTATE '40001' THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'Undo of the cleared shipping mapping was not guarded'; END IF;

  v_failed := false;
  BEGIN
    PERFORM v2.correct_workbook_source_link(
      '99600000-0000-4000-8000-000000000099', v_actor, 'wrong-facility',
      repeat('6', 64), 'shipping-guide', v_ship_source, 'CAPACITY-A', 'CAPACITY-B'
    );
  EXCEPTION WHEN SQLSTATE '42501' THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'A correction outside the active facility was accepted'; END IF;
END
$$;

ROLLBACK;

SELECT 'V2 workbook link correction checks passed.';
