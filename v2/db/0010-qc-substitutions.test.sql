BEGIN;

DO $$
DECLARE
  v_facility uuid;
  v_manager uuid := '99000000-0000-4000-8000-000000000201';
  v_operator uuid := '99000000-0000-4000-8000-000000000202';
  v_status_reader uuid := '99000000-0000-4000-8000-000000000203';
  v_unprivileged uuid := '99000000-0000-4000-8000-000000000204';
  v_monterey uuid := '99000000-0000-4000-8000-000000000210';
  v_mozzarella uuid := '99000000-0000-4000-8000-000000000211';
  v_replacement uuid := '99000000-0000-4000-8000-000000000212';
  v_warehouse uuid;
  v_opening uuid;
  v_run uuid := '99000000-0000-4000-8000-000000000220';
  v_proposal jsonb;
  v_approval jsonb;
  v_correction jsonb;
  v_consumption jsonb;
  v_failed boolean := false;
  v_balance numeric;
  v_before_movements integer;
  v_after_movements integer;
  v_events_before integer;
  v_substitution jsonb;
  v_operational_status jsonb;
  v_now timestamptz := clock_timestamp();
BEGIN
  SELECT facility_id INTO STRICT v_facility
  FROM v2.facility_scope WHERE singleton;

  INSERT INTO v2.staff_accounts (id, username, password_hash)
  VALUES
    (v_manager, 'QCSubstitutionManager', 'argon2id$v=19$m=19456,t=2,p=1$c2FsdA==$aGFzaA=='),
    (v_operator, 'QCSubstitutionOperator', 'argon2id$v=19$m=19456,t=2,p=1$c2FsdA==$aGFzaA==');
  INSERT INTO v2.staff_accounts (id, username, password_hash)
  VALUES
    (v_status_reader, 'QCSubstitutionStatusReader', 'argon2id$v=19$m=19456,t=2,p=1$c2FsdA==$aGFzaA=='),
    (v_unprivileged, 'QCSubstitutionUnprivileged', 'argon2id$v=19$m=19456,t=2,p=1$c2FsdA==$aGFzaA==');
  INSERT INTO v2.user_roles (user_id, role_name)
  VALUES
    (v_manager, 'qc-manager'),
    (v_operator, 'qc-operator'),
    (v_unprivileged, 'operator');
  INSERT INTO v2.roles (name, capabilities, builtin)
  VALUES ('qc-substitution-status-reader', '["run.read"]'::jsonb, false);
  INSERT INTO v2.user_roles (user_id, role_name)
  VALUES (v_status_reader, 'qc-substitution-status-reader');
  INSERT INTO v2.products (facility_id, id, code, name, base_unit)
  VALUES
    (v_facility, v_monterey, 'QC-MONTEREY', 'Monterey cheese', 'lb'),
    (v_facility, v_mozzarella, 'QC-MOZZ', 'Mozzarella', 'lb'),
    (v_facility, v_replacement, 'QC-REPLACEMENT', 'Replacement Monterey', 'lb');

  v_warehouse := (v2.create_inventory_warehouse(
    v_facility, v_manager, 'qc-substitution-warehouse', repeat('1', 64), 'QC substitution test warehouse'
  )->'warehouse'->>'id')::uuid;
  v_opening := (v2.stage_opening_count(
    v_facility, v_manager, 'qc-substitution-opening', repeat('2', 64), v_warehouse,
    (
      SELECT jsonb_agg(jsonb_build_object(
        'productCode', product.code,
        'quantity', CASE product.code
          WHEN 'QC-MONTEREY' THEN '100'
          WHEN 'QC-MOZZ' THEN '100'
          WHEN 'QC-REPLACEMENT' THEN '50'
          ELSE '0'
        END
      ) ORDER BY product.code)
      FROM v2.products AS product
      WHERE product.facility_id = v_facility AND product.active
    )
  )->>'countId')::uuid;
  PERFORM v2.review_opening_count(v_facility, v_manager, v_opening);
  PERFORM v2.apply_opening_count(v_facility, v_manager, v_opening);
  PERFORM v2.set_production_warehouse(
    v_facility, v_manager, 'qc-substitution-production', repeat('3', 64), v_warehouse
  );

  INSERT INTO v2.runs (facility_id, id, status, created_at, updated_at, setup_snapshot)
  VALUES (
    v_facility, v_run, 'planned', v_now, v_now,
    jsonb_build_object(
      'label', 'QC substitution test',
      'targetCases', 1,
      'productCode', 'QC-RUN',
      'productionSetupCode', 'QC-SETUP',
      'productionPlan', jsonb_build_object(
        'warehouse', jsonb_build_object('id', v_warehouse, 'name', 'QC substitution test warehouse'),
        'recipes', jsonb_build_array(
          jsonb_build_object(
            'code', 'QC-CHEESE-A', 'name', 'Cheese recipe A', 'stationKey', 'cheese',
            'ingredients', jsonb_build_array(jsonb_build_object(
              'productId', v_monterey, 'productCode', 'QC-MONTEREY',
              'productName', 'Monterey cheese', 'quantity', '5', 'unit', 'lb'
            ))
          ),
          jsonb_build_object(
            'code', 'QC-CHEESE-B', 'name', 'Cheese recipe B', 'stationKey', 'cheese',
            'ingredients', jsonb_build_array(jsonb_build_object(
              'productId', v_mozzarella, 'productCode', 'QC-MOZZ',
              'productName', 'Mozzarella', 'quantity', '20', 'unit', 'lb'
            ))
          )
        ),
        'packagingPerCase', '[]'::jsonb
      )
    )
  );
  INSERT INTO v2.run_station_progress (
    facility_id, run_id, station_key, status, progress, updated_at
  ) VALUES (
    v_facility, v_run, 'cheese', 'not_started', '{"batchesMade":1}'::jsonb, clock_timestamp()
  );

  v_proposal := v2.record_qc_substitution(
    v_facility, v_operator, v_run, 'qc-sub-propose', repeat('4', 64),
    'propose', NULL, NULL,
    jsonb_build_object(
      'sourceItems', jsonb_build_array(
        jsonb_build_object(
          'productId', v_monterey, 'recipeCode', 'QC-CHEESE-A',
          'stationKey', 'cheese', 'quantity', '5', 'unit', 'lb'
        ),
        jsonb_build_object(
          'productId', v_mozzarella, 'recipeCode', 'QC-CHEESE-B',
          'stationKey', 'cheese', 'quantity', '20', 'unit', 'lb'
        )
      ),
      'replacementProductId', v_replacement,
      'replacementQuantity', '40',
      'replacementUnit', 'lb',
      'reason', 'Approved cheese blend substitution'
    )
  );
  IF v_proposal->'event'->>'eventType' <> 'run-substitution-proposed'
     OR jsonb_array_length(v_proposal->'event'->'payload'->'sourceItems') <> 2 THEN
    RAISE EXCEPTION 'The multi-source substitution proposal was not recorded';
  END IF;

  v_failed := false;
  BEGIN
    PERFORM v2.record_qc_substitution(
      v_facility, v_operator, v_run, 'qc-sub-unauthorized-approve', repeat('5', 64),
      'approve', (v_proposal->'event'->>'id')::uuid, NULL, '{}'::jsonb
    );
  EXCEPTION WHEN SQLSTATE '42501' THEN v_failed := true;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'A QC operator approved an inventory-affecting substitution';
  END IF;

  v_approval := v2.record_qc_substitution(
    v_facility, v_manager, v_run, 'qc-sub-approve', repeat('6', 64),
    'approve', (v_proposal->'event'->>'id')::uuid, NULL, '{}'::jsonb
  );
  IF v_approval->'event'->>'eventType' <> 'run-substitution-approved'
     OR v_approval->'event'->'payload'->>'actorId' IS NOT NULL THEN
    -- Actor identity is stored in the event envelope, never copied from request data.
    IF v_approval->'event'->>'actorId' <> v_manager::text THEN
      RAISE EXCEPTION 'QC approval did not preserve the authenticated manager';
    END IF;
  END IF;
  SELECT quantity INTO STRICT v_balance FROM v2.inventory_balances
  WHERE facility_id = v_facility AND warehouse_id = v_warehouse AND product_id = v_replacement;
  IF v_balance <> 10 THEN RAISE EXCEPTION 'Approval did not post exactly 40 replacement pounds'; END IF;

  v_before_movements := (
    SELECT count(*) FROM v2.inventory_movements
    WHERE facility_id = v_facility AND run_id = v_run
  );
  v_correction := v2.record_qc_substitution(
    v_facility, v_manager, v_run, 'qc-sub-correct', repeat('7', 64),
    'correct', NULL, (v_approval->'substitution'->>'id')::uuid,
    jsonb_build_object(
      'sourceItems', jsonb_build_array(
        jsonb_build_object(
          'productId', v_monterey, 'recipeCode', 'QC-CHEESE-A',
          'stationKey', 'cheese', 'quantity', '5', 'unit', 'lb'
        ),
        jsonb_build_object(
          'productId', v_mozzarella, 'recipeCode', 'QC-CHEESE-B',
          'stationKey', 'cheese', 'quantity', '20', 'unit', 'lb'
        )
      ),
      'replacementProductId', v_replacement,
      'replacementQuantity', '35',
      'replacementUnit', 'lb',
      'reason', 'Corrected replacement amount after review'
    )
  );
  SELECT quantity INTO STRICT v_balance FROM v2.inventory_balances
  WHERE facility_id = v_facility AND warehouse_id = v_warehouse AND product_id = v_replacement;
  IF v_balance <> 15 THEN
    RAISE EXCEPTION 'Correction did not append the compensating five-pound stock movement';
  END IF;
  v_after_movements := (
    SELECT count(*) FROM v2.inventory_movements
    WHERE facility_id = v_facility AND run_id = v_run
  );
  IF v_after_movements <> v_before_movements + 1 THEN
    RAISE EXCEPTION 'Correction did not create exactly one compensating movement';
  END IF;

  v_proposal := v2.record_qc_substitution(
    v_facility, v_operator, v_run, 'qc-sub-low-stock-propose', repeat('8', 64),
    'propose', NULL, NULL,
    jsonb_build_object(
      'sourceItems', jsonb_build_array(jsonb_build_object(
        'productId', v_monterey, 'recipeCode', 'QC-CHEESE-A',
        'stationKey', 'cheese', 'quantity', '1', 'unit', 'lb'
      )),
      'replacementProductId', v_replacement,
      'replacementQuantity', '20',
      'replacementUnit', 'lb',
      'reason', 'Insufficient-stock approval test'
    )
  );
  v_events_before := (
    SELECT count(*) FROM v2.qc_events
    WHERE facility_id = v_facility AND run_id = v_run
  );
  v_failed := false;
  BEGIN
    PERFORM v2.record_qc_substitution(
      v_facility, v_manager, v_run, 'qc-sub-low-stock-approve', repeat('9', 64),
      'approve', (v_proposal->'event'->>'id')::uuid, NULL, '{}'::jsonb
    );
  EXCEPTION WHEN SQLSTATE '22003' THEN v_failed := true;
  END;
  SELECT quantity INTO STRICT v_balance FROM v2.inventory_balances
  WHERE facility_id = v_facility AND warehouse_id = v_warehouse AND product_id = v_replacement;
  IF NOT v_failed OR v_balance <> 15 OR (
    SELECT count(*) FROM v2.qc_events
    WHERE facility_id = v_facility AND run_id = v_run
  ) <> v_events_before THEN
    RAISE EXCEPTION 'An unaffordable QC approval changed stock or left a decision event';
  END IF;

  v_consumption := v2.apply_run_inventory_consumption(
    v_facility, v_run, v_manager,
    (SELECT setup_snapshot->'productionPlan' FROM v2.runs
     WHERE facility_id = v_facility AND id = v_run)
  );
  IF jsonb_array_length(v_consumption->'qcSubstitutions') <> 1
     OR jsonb_array_length(v_consumption->'componentDemand') <> 2
     OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(v_consumption->'componentDemand') AS line(value)
       WHERE (line.value->>'remainingQuantity')::numeric <> 0
     ) THEN
    RAISE EXCEPTION 'Run completion did not subtract both approved source components';
  END IF;
  SELECT quantity INTO STRICT v_balance FROM v2.inventory_balances
  WHERE facility_id = v_facility AND warehouse_id = v_warehouse AND product_id = v_replacement;
  IF v_balance <> 15 THEN
    RAISE EXCEPTION 'Run completion deducted the already-posted replacement twice';
  END IF;
  SELECT value INTO STRICT v_substitution
  FROM jsonb_array_elements(v2.list_qc_run_substitutions(v_facility, v_manager, v_run))
  WHERE value->>'revision' = '2';
  IF (v_substitution->>'replacementQuantity')::numeric <> 35
     OR jsonb_array_length(v_substitution->'sourceItems') <> 2 THEN
    RAISE EXCEPTION 'The current substitution projection lost its corrected multi-source details';
  END IF;
  v_operational_status := v2.list_run_operational_substitutions(v_facility, v_status_reader, v_run);
  IF jsonb_array_length(v_operational_status) <> 1
     OR v_operational_status->0->>'replacementProductId' <> v_replacement::text
     OR (v_operational_status->0->>'replacementQuantity')::numeric <> 35
     OR jsonb_array_length(v_operational_status->0->'sourceItems') <> 2
     OR v_operational_status->0->>'movementGroupId' IS NULL THEN
    RAISE EXCEPTION 'A run reader did not receive the current exact substitution evidence';
  END IF;
  v_failed := false;
  BEGIN
    PERFORM v2.list_run_operational_substitutions(v_facility, v_unprivileged, v_run);
  EXCEPTION WHEN SQLSTATE '42501' THEN v_failed := true;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'A user without run-read or QC access received substitution evidence';
  END IF;

  RAISE NOTICE 'V2 QC substitution approval, correction, and inventory accounting checks passed';
END
$$;

ROLLBACK;

SELECT 'V2 QC substitution checks passed.';
