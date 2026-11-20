BEGIN;

DO $$
DECLARE
  v_facility uuid;
  v_manager uuid := '99000000-0000-4000-8000-000000000001';
  v_operator uuid := '99000000-0000-4000-8000-000000000002';
  v_source_import uuid := '99000000-0000-4000-8000-000000000003';
  v_product uuid := '99000000-0000-4000-8000-000000000004';
  v_empty_product uuid := '99000000-0000-4000-8000-000000000005';
  v_run_milk uuid := '99000000-0000-4000-8000-000000000010';
  v_run_changed uuid := '99000000-0000-4000-8000-000000000011';
  v_run_unlinked uuid := '99000000-0000-4000-8000-000000000012';
  v_run_unreviewed uuid := '99000000-0000-4000-8000-000000000013';
  v_run_empty uuid := '99000000-0000-4000-8000-000000000014';
  v_now timestamptz := clock_timestamp();
  v_result jsonb;
  v_replay jsonb;
  v_listing jsonb;
  v_failed boolean;
  v_first_snapshot jsonb;
  v_changed_snapshot jsonb;
  v_unlinked_snapshot jsonb;
  v_unreviewed_snapshot jsonb;
  v_empty_snapshot jsonb;
  v_check jsonb;
  v_review jsonb;
BEGIN
  SELECT facility_id INTO STRICT v_facility
  FROM v2.facility_scope WHERE singleton;

  INSERT INTO v2.staff_accounts (id, username, password_hash)
  VALUES
    (v_manager, 'QCIngredientManager', 'argon2id$v=19$m=19456,t=2,p=1$c2FsdA==$aGFzaA=='),
    (v_operator, 'QCIngredientOperator', 'argon2id$v=19$m=19456,t=2,p=1$c2FsdA==$aGFzaA==');
  INSERT INTO v2.user_roles (user_id, role_name)
  VALUES (v_manager, 'qc-manager'), (v_operator, 'qc-operator');

  INSERT INTO v2.setup_catalog_imports (
    facility_id, id, actor_id, request_id, request_hash, family, records
  ) VALUES (
    v_facility, v_source_import, v_manager, 'qc-ingredient-fixture', repeat('a', 64),
    'ingredients', '[{"code":"MILK-BASE","name":"Milk base","data":{}}]'::jsonb
  );
  INSERT INTO v2.setup_ingredient_records (
    facility_id, code, name, data, source_import_id
  ) VALUES
    (v_facility, 'MILK-BASE', 'Milk base', '{
      "categories":["general"],"allergens":["milk"],"allergensReviewed":true,
      "mergedIntoCode":"","enabled":true
    }'::jsonb, v_source_import),
    (v_facility, 'UNREVIEWED-BASE', 'Unreviewed base', '{
      "categories":["general"],"allergens":[],"allergensReviewed":false,
      "mergedIntoCode":"","enabled":true
    }'::jsonb, v_source_import),
    (v_facility, 'EMPTY-BASE', 'Reviewed empty base', '{
      "categories":["general"],"allergens":[],"allergensReviewed":true,
      "mergedIntoCode":"","enabled":true
    }'::jsonb, v_source_import);
  INSERT INTO v2.products (facility_id, id, code, name, base_unit)
  VALUES
    (v_facility, v_product, 'QC-PRODUCT-1', 'QC product', 'lb'),
    (v_facility, v_empty_product, 'QC-PRODUCT-2', 'Empty-allergen product', 'lb');

  IF NOT v2.actor_can_manage_allergens(v_manager)
     OR v2.actor_can_manage_allergens(v_operator) THEN
    RAISE EXCEPTION 'Allergen mapping capability did not follow the manager role boundary';
  END IF;

  v_result := v2.record_qc_ingredient_link(
    v_facility, v_manager, 'link-milk', repeat('b', 64), v_product, 'MILK-BASE'
  );
  IF v_result->>'replayed' <> 'false'
     OR v_result->'event'->>'actorId' <> v_manager::text
     OR v_result->'event'->>'occurredAt' IS NULL THEN
    RAISE EXCEPTION 'A reviewed ingredient link did not preserve its manager and server timestamp';
  END IF;
  v_replay := v2.record_qc_ingredient_link(
    v_facility, v_manager, 'link-milk', repeat('b', 64), v_product, 'MILK-BASE'
  );
  IF v_replay->>'replayed' <> 'true'
     OR v_replay->'event'->>'id' <> v_result->'event'->>'id' THEN
    RAISE EXCEPTION 'Ingredient-link retry did not replay the original audit record';
  END IF;

  INSERT INTO v2.runs (facility_id, id, status, created_at, updated_at, setup_snapshot)
  VALUES (
    v_facility, v_run_milk, 'planned', v_now, v_now,
    jsonb_build_object('productionPlan', jsonb_build_object('recipes', jsonb_build_array(
      jsonb_build_object('stationKey', 'sauce', 'ingredients', jsonb_build_array(
        jsonb_build_object('productId', v_product, 'productCode', 'QC-PRODUCT-1', 'productName', 'QC product',
          'unit', 'lb', 'quantity', '1')
      ))
    )))
  );
  SELECT setup_snapshot->'productionPlan'->'recipes'->0->'ingredients'->0->'ingredientSnapshot'
    INTO STRICT v_first_snapshot
  FROM v2.runs WHERE facility_id = v_facility AND id = v_run_milk;
  IF v_first_snapshot->>'status' <> 'linked'
     OR v_first_snapshot->>'ingredientCode' <> 'MILK-BASE'
     OR v_first_snapshot->'allergens' <> '["milk"]'::jsonb
     OR v_first_snapshot->>'allergensReviewed' <> 'true' THEN
    RAISE EXCEPTION 'New run did not freeze the reviewed canonical ingredient facts';
  END IF;

  UPDATE v2.setup_ingredient_records
  SET data = jsonb_set(data, '{allergens}', '["peanuts"]'::jsonb),
      updated_at = clock_timestamp()
  WHERE facility_id = v_facility AND code = 'MILK-BASE';
  INSERT INTO v2.runs (facility_id, id, status, created_at, updated_at, setup_snapshot)
  VALUES (
    v_facility, v_run_changed, 'planned', v_now + interval '1 second', v_now + interval '1 second',
    jsonb_build_object('productionPlan', jsonb_build_object('recipes', jsonb_build_array(
      jsonb_build_object('stationKey', 'sauce', 'ingredients', jsonb_build_array(
        jsonb_build_object('productId', v_product, 'productCode', 'QC-PRODUCT-1', 'productName', 'QC product',
          'unit', 'lb', 'quantity', '1')
      ))
    )))
  );
  SELECT setup_snapshot->'productionPlan'->'recipes'->0->'ingredients'->0->'ingredientSnapshot'
    INTO STRICT v_changed_snapshot
  FROM v2.runs WHERE facility_id = v_facility AND id = v_run_changed;
  SELECT setup_snapshot->'productionPlan'->'recipes'->0->'ingredients'->0->'ingredientSnapshot'
    INTO STRICT v_first_snapshot
  FROM v2.runs WHERE facility_id = v_facility AND id = v_run_milk;
  IF v_first_snapshot->'allergens' <> '["milk"]'::jsonb
     OR v_changed_snapshot->'allergens' <> '["peanuts"]'::jsonb THEN
    RAISE EXCEPTION 'A later catalog edit changed a prior run snapshot or failed to reach a new run';
  END IF;

  v_result := v2.record_qc_ingredient_link(
    v_facility, v_manager, 'unlink-product', repeat('c', 64), v_product, NULL
  );
  INSERT INTO v2.runs (facility_id, id, status, created_at, updated_at, setup_snapshot)
  VALUES (
    v_facility, v_run_unlinked, 'planned', v_now + interval '2 seconds', v_now + interval '2 seconds',
    jsonb_build_object('productionPlan', jsonb_build_object('recipes', jsonb_build_array(
      jsonb_build_object('stationKey', 'sauce', 'ingredients', jsonb_build_array(
        jsonb_build_object('productId', v_product, 'productCode', 'QC-PRODUCT-1', 'productName', 'QC product',
          'unit', 'lb', 'quantity', '1')
      ))
    )))
  );
  SELECT setup_snapshot->'productionPlan'->'recipes'->0->'ingredients'->0->'ingredientSnapshot'
    INTO STRICT v_unlinked_snapshot
  FROM v2.runs WHERE facility_id = v_facility AND id = v_run_unlinked;
  IF v_unlinked_snapshot->>'status' <> 'unknown'
     OR v_unlinked_snapshot->>'reason' <> 'missing-link' THEN
    RAISE EXCEPTION 'An unlinked product did not remain explicitly unknown';
  END IF;

  v_result := v2.record_qc_ingredient_link(
    v_facility, v_manager, 'link-unreviewed', repeat('d', 64), v_product, 'UNREVIEWED-BASE'
  );
  INSERT INTO v2.runs (facility_id, id, status, created_at, updated_at, setup_snapshot)
  VALUES (
    v_facility, v_run_unreviewed, 'planned', v_now + interval '3 seconds', v_now + interval '3 seconds',
    jsonb_build_object('productionPlan', jsonb_build_object('recipes', jsonb_build_array(
      jsonb_build_object('stationKey', 'sauce', 'ingredients', jsonb_build_array(
        jsonb_build_object('productId', v_product, 'productCode', 'QC-PRODUCT-1', 'productName', 'QC product',
          'unit', 'lb', 'quantity', '1')
      ))
    )))
  );
  SELECT setup_snapshot->'productionPlan'->'recipes'->0->'ingredients'->0->'ingredientSnapshot'
    INTO STRICT v_unreviewed_snapshot
  FROM v2.runs WHERE facility_id = v_facility AND id = v_run_unreviewed;
  IF v_unreviewed_snapshot->>'status' <> 'linked'
     OR v_unreviewed_snapshot->>'allergensReviewed' <> 'false' THEN
    RAISE EXCEPTION 'An unreviewed ingredient link did not preserve its unknown review state';
  END IF;

  v_result := v2.record_qc_ingredient_link(
    v_facility, v_manager, 'link-reviewed-empty', repeat('e', 64), v_empty_product, 'EMPTY-BASE'
  );
  INSERT INTO v2.runs (facility_id, id, status, created_at, updated_at, setup_snapshot)
  VALUES (
    v_facility, v_run_empty, 'planned', v_now + interval '4 seconds', v_now + interval '4 seconds',
    jsonb_build_object('productionPlan', jsonb_build_object('recipes', jsonb_build_array(
      jsonb_build_object('stationKey', 'sauce', 'ingredients', jsonb_build_array(
        jsonb_build_object('productId', v_empty_product, 'productCode', 'QC-PRODUCT-2',
          'productName', 'Empty-allergen product', 'unit', 'lb', 'quantity', '1')
      ))
    )))
  );
  SELECT setup_snapshot->'productionPlan'->'recipes'->0->'ingredients'->0->'ingredientSnapshot'
    INTO STRICT v_empty_snapshot
  FROM v2.runs WHERE facility_id = v_facility AND id = v_run_empty;
  IF v_empty_snapshot->>'allergensReviewed' <> 'true'
     OR v_empty_snapshot->'allergens' <> '[]'::jsonb THEN
    RAISE EXCEPTION 'Reviewed-empty ingredient facts were not distinguished from unknown';
  END IF;

  v_listing := v2.list_qc_ingredient_links(v_facility, v_manager);
  IF v_listing->'products' IS NULL OR v_listing->'ingredients' IS NULL
     OR jsonb_array_length(v_listing->'events') < 4 THEN
    RAISE EXCEPTION 'Manager ingredient-link view omitted products, catalog identities, or audit history';
  END IF;
  v_failed := false;
  BEGIN
    PERFORM v2.list_qc_ingredient_links(v_facility, v_operator);
  EXCEPTION WHEN SQLSTATE '42501' THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'A QC operator read the manager-only ingredient-link list'; END IF;
  v_failed := false;
  BEGIN
    PERFORM v2.record_qc_ingredient_link(
      v_facility, v_operator, 'unauthorized-link', repeat('f', 64), v_product, 'MILK-BASE'
    );
  EXCEPTION WHEN SQLSTATE '42501' THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'A QC operator changed ingredient identity links'; END IF;

  v_failed := false;
  BEGIN
    UPDATE v2.qc_ingredient_link_events SET action = 'unlinked'
    WHERE facility_id = v_facility AND id = (v_result->'event'->>'id')::uuid;
  EXCEPTION WHEN SQLSTATE '55000' THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'Ingredient-link audit history accepted an in-place correction'; END IF;

  v_check := v2.record_qc_event(
    v_facility, v_operator, v_run_milk, 'allergen-review', repeat('1', 64),
    'run-check-reviewed',
    '{"checkType":"allergen-footprint","result":"reviewed","allergens":["milk"],"ingredientCount":1,"unknownCount":0}'::jsonb
  );
  IF v_check->'event'->>'eventType' <> 'run-check-reviewed' THEN
    RAISE EXCEPTION 'The run allergen review did not append to QC history';
  END IF;
  PERFORM v2.record_qc_event(
    v_facility, v_manager, v_run_milk, 'signoff-before-allergen', repeat('2', 64),
    'review-signed-off', '{"review":"signed-off"}'::jsonb
  );
  PERFORM v2.record_qc_event(
    v_facility, v_operator, v_run_milk, 'new-review-after-signoff', repeat('3', 64),
    'run-check-reviewed',
    '{"checkType":"allergen-footprint","result":"not_evaluated","allergens":["milk"],"ingredientCount":1,"unknownCount":1}'::jsonb
  );
  v_review := v2.get_qc_review_state(v_facility, v_operator, v_run_milk);
  IF v_review->>'status' <> 'needs-review' THEN
    RAISE EXCEPTION 'New allergen evidence did not reopen the QC review';
  END IF;
END
$$;

ROLLBACK;

SELECT 'V2 QC ingredient-link and run-snapshot checks passed.';
