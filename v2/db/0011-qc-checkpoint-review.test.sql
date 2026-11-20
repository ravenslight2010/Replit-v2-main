BEGIN;

DO $$
DECLARE
  v_facility uuid;
  v_run uuid := '99100000-0000-4000-8000-000000000001';
  v_other_run uuid := '99100000-0000-4000-8000-000000000099';
  v_manager uuid := '99100000-0000-4000-8000-000000000002';
  v_operator uuid := '99100000-0000-4000-8000-000000000003';
  v_unauthorized uuid := '99100000-0000-4000-8000-000000000004';
  v_checkpoint jsonb;
  v_checkpoint_id uuid;
  v_lot_id uuid;
  v_flag jsonb;
  v_flag_id uuid;
  v_review jsonb;
  v_events jsonb;
  v_failed boolean;
BEGIN
  SELECT facility_id INTO STRICT v_facility
  FROM v2.facility_scope WHERE singleton;

  INSERT INTO v2.staff_accounts (id, username, password_hash)
  VALUES
    (v_manager, 'QCCheckpointManager', 'argon2id$v=19$m=19456,t=2,p=1$c2FsdA==$aGFzaA=='),
    (v_operator, 'QCCheckpointOperator', 'argon2id$v=19$m=19456,t=2,p=1$c2FsdA==$aGFzaA=='),
    (v_unauthorized, 'QCCheckpointNoAccess', 'argon2id$v=19$m=19456,t=2,p=1$c2FsdA==$aGFzaA==');
  INSERT INTO v2.user_roles (user_id, role_name)
  VALUES
    (v_manager, 'qc-manager'),
    (v_operator, 'qc-operator'),
    (v_unauthorized, 'warehouse');

  INSERT INTO v2.runs (
    facility_id, id, status, revision, created_at, updated_at, setup_snapshot
  ) VALUES (
    v_facility, v_run, 'planned', 0, transaction_timestamp(), transaction_timestamp(),
    '{
      "productionPlan": {
        "recipes": [{
          "code": "DOUGH-BASE",
          "stationKey": "dough",
          "ingredients": []
        }]
      }
    }'::jsonb
  );
  INSERT INTO v2.runs (
    facility_id, id, status, revision, created_at, updated_at, setup_snapshot
  ) VALUES (
    v_facility, v_other_run, 'planned', 0, transaction_timestamp(), transaction_timestamp(),
    '{"productionPlan":{"recipes":[]}}'::jsonb
  );
  UPDATE v2.runs
    SET updated_at = created_at
    WHERE facility_id = v_facility AND id IN (v_run, v_other_run);

  v_checkpoint := v2.record_qc_event(
    v_facility, v_operator, v_run, 'qc-checkpoint-temperature', repeat('a', 64),
    'checkpoint-observed',
    '{
      "checkpointType": "temperature",
      "stationKey": "dough",
      "checkpointLabel": "Mixer display",
      "observedValue": "-2.5",
      "unit": "°C",
      "evaluationStatus": "not_evaluated"
    }'::jsonb
  );
  v_checkpoint_id := (v_checkpoint->'event'->>'id')::uuid;
  IF v_checkpoint->>'replayed' <> 'false'
     OR v_checkpoint->'event'->>'actorId' <> v_operator::text
     OR v_checkpoint->'event'->>'occurredAt' IS NULL
     OR v_checkpoint->'event'->'payload'->>'evaluationStatus' <> 'not_evaluated' THEN
    RAISE EXCEPTION 'QC checkpoint did not preserve observation-only status and server attribution';
  END IF;

  IF v2.record_qc_event(
    v_facility, v_operator, v_run, 'qc-checkpoint-temperature', repeat('a', 64),
    'checkpoint-observed',
    '{
      "checkpointType": "temperature",
      "stationKey": "dough",
      "checkpointLabel": "Mixer display",
      "observedValue": "-2.5",
      "unit": "°C",
      "evaluationStatus": "not_evaluated"
    }'::jsonb
  )->>'replayed' <> 'true' THEN
    RAISE EXCEPTION 'QC checkpoint retry did not return the original event';
  END IF;

  v_failed := false;
  BEGIN
    PERFORM v2.record_qc_event(
      v_facility, v_operator, v_run, 'qc-checkpoint-invented-pass', repeat('b', 64),
      'checkpoint-observed',
      '{
        "checkpointType": "temperature",
        "stationKey": "dough",
        "checkpointLabel": "Mixer display",
        "observedValue": "4",
        "unit": "°C",
        "evaluationStatus": "pass",
        "target": "4"
      }'::jsonb
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN v_failed := true;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'QC checkpoint accepted an invented safety criterion or pass result';
  END IF;

  v_failed := false;
  BEGIN
    PERFORM v2.record_qc_event(
      v_facility, v_operator, v_run, 'qc-checkpoint-invalid-station', repeat('c', 64),
      'checkpoint-observed',
      '{
        "checkpointType": "time",
        "stationKey": "warehouse",
        "checkpointLabel": "Elapsed duration",
        "observedValue": "3",
        "unit": "min",
        "evaluationStatus": "not_evaluated"
      }'::jsonb
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'QC checkpoint accepted an unsupported station'; END IF;

  v_failed := false;
  BEGIN
    PERFORM v2.record_qc_event(
      v_facility, v_operator, v_run, 'qc-checkpoint-station-not-in-run', repeat('9', 64),
      'checkpoint-observed',
      '{
        "checkpointType": "time",
        "stationKey": "pepperoni",
        "checkpointLabel": "Elapsed duration",
        "observedValue": "3",
        "unit": "min",
        "evaluationStatus": "not_evaluated"
      }'::jsonb
    );
  EXCEPTION WHEN SQLSTATE 'P0002' THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'QC checkpoint accepted a station absent from the run snapshot'; END IF;

  PERFORM v2.record_qc_event(
    v_facility, v_operator, v_run, 'qc-corrective-action-1', repeat('d', 64),
    'corrective-action-observed',
    jsonb_build_object(
      'targetEventId', v_checkpoint_id,
      'actionObserved', 'Adjusted the observed equipment setting',
      'followUpNote', 'Recheck requested'
    )
  );

  v_lot_id := (v2.record_qc_event(
    v_facility, v_operator, v_run, 'qc-lot-for-review-1', repeat('e', 64),
    'lot-recorded', '{"productCode":"FLOUR","stationKey":"dough","lotCode":"LOT-91"}'::jsonb
  )->'event'->>'id')::uuid;
  v_flag := v2.record_qc_event(
    v_facility, v_operator, v_run, 'qc-lot-review-flag-1', repeat('f', 64),
    'review-flag-raised',
    jsonb_build_object(
      'targetType', 'lot',
      'targetEventId', v_lot_id,
      'reason', 'Lot details need manager review'
    )
  );
  v_flag_id := (v_flag->'event'->>'id')::uuid;

  v_failed := false;
  BEGIN
    PERFORM v2.record_qc_event(
      v_facility, v_operator, v_run, 'qc-operator-review-flag', repeat('1', 64),
      'review-flag-reviewed',
      jsonb_build_object('targetEventId', v_flag_id, 'reviewNote', 'Reviewed')
    );
  EXCEPTION WHEN SQLSTATE '42501' THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'QC operator resolved a manager-only review flag'; END IF;

  v_review := v2.record_qc_event(
    v_facility, v_manager, v_run, 'qc-manager-review-flag-1', repeat('2', 64),
    'review-flag-reviewed',
    jsonb_build_object(
      'targetEventId', v_flag_id,
      'reviewNote', 'Reviewed the lot record; follow-up remains advisory'
    )
  );
  IF v_review->'event'->>'actorId' <> v_manager::text THEN
    RAISE EXCEPTION 'Manager review flag decision omitted the authenticated actor';
  END IF;

  v_failed := false;
  BEGIN
    PERFORM v2.record_qc_event(
      v_facility, v_manager, v_run, 'qc-manager-review-flag-stale', repeat('3', 64),
      'review-flag-reviewed',
      jsonb_build_object('targetEventId', v_flag_id, 'reviewNote', 'Second decision')
    );
  EXCEPTION WHEN SQLSTATE '55000' THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'A reviewed QC flag accepted a stale second review'; END IF;

  v_failed := false;
  BEGIN
    PERFORM v2.record_qc_event(
      v_facility, v_operator, v_run, 'qc-flag-unavailable-lot', repeat('4', 64),
      'review-flag-raised',
      jsonb_build_object(
        'targetType', 'lot',
        'targetEventId', v_other_run,
        'reason', 'Attempt to reference an unavailable lot'
      )
    );
  EXCEPTION WHEN SQLSTATE 'P0002' THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'A QC lot review flag accepted an unavailable reference'; END IF;

  PERFORM v2.record_qc_event(
    v_facility, v_operator, v_run, 'qc-run-review-flag-1', repeat('5', 64),
    'review-flag-raised',
    '{"targetType":"run","reason":"Run details need manager review"}'::jsonb
  );

  v_events := v2.list_qc_events(v_facility, v_manager, v_run, 100);
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_events) AS event(value)
    WHERE event.value->>'id' = v_checkpoint_id::text
      AND event.value->>'eventType' = 'checkpoint-observed'
      AND event.value->'payload'->>'evaluationStatus' = 'not_evaluated'
  ) OR NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_events) AS event(value)
    WHERE event.value->>'id' = v_flag_id::text
      AND event.value->>'eventType' = 'review-flag-raised'
  ) THEN
    RAISE EXCEPTION 'QC manager history did not retain the new checkpoint and review flag';
  END IF;

  v_failed := false;
  BEGIN
    UPDATE v2.qc_events SET payload = '{}'::jsonb
    WHERE facility_id = v_facility AND id = v_checkpoint_id;
  EXCEPTION WHEN SQLSTATE '55000' THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'QC checkpoint evidence accepted an in-place correction'; END IF;

  RAISE NOTICE 'V2 QC checkpoints, corrective observations, advisory review flags, manager review, idempotency, and references passed';
END
$$;

ROLLBACK;

SELECT 'V2 QC checkpoint and review checks passed.';
