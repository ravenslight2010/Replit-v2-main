BEGIN;

DO $$
DECLARE
  v_facility uuid;
  v_run uuid := '98000000-0000-4000-8000-000000000001';
  v_other_facility uuid := '98000000-0000-4000-8000-000000000099';
  v_manager uuid := '98000000-0000-4000-8000-000000000002';
  v_recorder uuid := '98000000-0000-4000-8000-000000000003';
  v_verifier uuid := '98000000-0000-4000-8000-000000000004';
  v_unauthorized uuid := '98000000-0000-4000-8000-000000000005';
  v_record jsonb;
  v_replay jsonb;
  v_events jsonb;
  v_settings jsonb;
  v_failed boolean;
  v_cleaning_id uuid;
  v_lot_id uuid;
  v_signoff jsonb;
  v_review jsonb;
  v_setting_id uuid;
  v_now timestamptz := clock_timestamp();
BEGIN
  SELECT facility_id INTO STRICT v_facility
  FROM v2.facility_scope WHERE singleton;

  INSERT INTO v2.staff_accounts (id, username, password_hash)
  VALUES
    (v_manager, 'QCManagerTest', 'argon2id$v=19$m=19456,t=2,p=1$c2FsdA==$aGFzaA=='),
    (v_recorder, 'QCRecorderTest', 'argon2id$v=19$m=19456,t=2,p=1$c2FsdA==$aGFzaA=='),
    (v_verifier, 'QCVerifierTest', 'argon2id$v=19$m=19456,t=2,p=1$c2FsdA==$aGFzaA=='),
    (v_unauthorized, 'QCNoAccessTest', 'argon2id$v=19$m=19456,t=2,p=1$c2FsdA==$aGFzaA==');
  INSERT INTO v2.user_roles (user_id, role_name)
  VALUES
    (v_manager, 'qc-manager'),
    (v_recorder, 'qc-operator'),
    (v_verifier, 'qc-operator'),
    (v_unauthorized, 'warehouse');
  INSERT INTO v2.runs (
    facility_id, id, status, revision, created_at, updated_at, setup_snapshot
  ) VALUES (
    v_facility, v_run, 'planned', 0, v_now, v_now, '{}'::jsonb
  );
  UPDATE v2.runs SET updated_at = created_at WHERE facility_id = v_facility AND id = v_run;

  v_record := v2.record_qc_event(
    v_facility, v_recorder, v_run, 'qc-lot-1', repeat('a', 64),
    'lot-recorded', '{"productCode":"FLOUR","stationKey":"dough","lotCode":"LOT-44"}'::jsonb
  );
  v_lot_id := (v_record->'event'->>'id')::uuid;
  IF v_record->>'replayed' <> 'false'
     OR v_record->'event'->>'actorId' <> v_recorder::text
     OR v_record->'event'->>'occurredAt' IS NULL THEN
    RAISE EXCEPTION 'QC lot record did not preserve actor and server timestamp';
  END IF;
  v_replay := v2.record_qc_event(
    v_facility, v_recorder, v_run, 'qc-lot-1', repeat('a', 64),
    'lot-recorded', '{"productCode":"FLOUR","stationKey":"dough","lotCode":"LOT-44"}'::jsonb
  );
  IF v_replay->>'replayed' <> 'true' OR v_replay->'event'->>'id' <> v_lot_id::text THEN
    RAISE EXCEPTION 'QC event retry did not replay the original event';
  END IF;

  v_record := v2.record_qc_event(
    v_facility, v_recorder, v_run, 'qc-cleaning-1', repeat('b', 64),
    'cleaning-recorded', '{"method":"wash","cleanedAt":"2026-11-18T10:00:00.000Z"}'::jsonb
  );
  v_cleaning_id := (v_record->'event'->>'id')::uuid;
  v_failed := false;
  BEGIN
    PERFORM v2.record_qc_event(
      v_facility, v_recorder, v_run, 'qc-cleaning-self-verify', repeat('c', 64),
      'cleaning-verified', jsonb_build_object('targetEventId', v_cleaning_id)
    );
  EXCEPTION WHEN SQLSTATE '42501' THEN v_failed := true;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'Cleaning record accepted verification by its recorder';
  END IF;
  v_record := v2.record_qc_event(
    v_facility, v_verifier, v_run, 'qc-cleaning-verify', repeat('d', 64),
    'cleaning-verified', jsonb_build_object('targetEventId', v_cleaning_id)
  );
  IF v_record->'event'->>'actorId' <> v_verifier::text THEN
    RAISE EXCEPTION 'Second authenticated cleaning verifier was not recorded';
  END IF;

  v_signoff := v2.record_qc_event(
    v_facility, v_manager, v_run, 'qc-signoff-1', repeat('e', 64),
    'review-signed-off', '{"review":"signed-off"}'::jsonb
  );
  v_review := v2.get_qc_review_state(v_facility, v_recorder, v_run);
  IF v_review->>'status' <> 'signed-off' THEN
    RAISE EXCEPTION 'Manager signoff did not close the QC review';
  END IF;
  v_record := v2.record_qc_event(
    v_facility, v_recorder, v_run, 'qc-weight-after-signoff', repeat('f', 64),
    'weight-check', '{"result":"not_evaluated","actual":"3"}'::jsonb
  );
  IF (v_record->'event'->>'occurredAt')::timestamptz
      < (v_signoff->'event'->>'occurredAt')::timestamptz THEN
    RAISE EXCEPTION 'A later QC evidence event did not follow run review signoff';
  END IF;
  v_review := v2.get_qc_review_state(v_facility, v_recorder, v_run);
  IF v_review->>'status' <> 'needs-review' THEN
    RAISE EXCEPTION 'New QC evidence did not reopen the run review';
  END IF;

  PERFORM v2.record_qc_event(
    v_facility, v_manager, NULL, 'qc-brix-setting', repeat('1', 64),
    'qc-setting-reviewed',
    '{"settingKey":"brix:pizza","settingType":"brix","subjectCode":"PIZZA","stationKey":null,"target":"4.5","tolerance":"0.2","unit":"°Bx","sourceReference":"Owner-approved Brix review"}'::jsonb
  );
  v_settings := v2.list_qc_settings(v_facility, v_recorder);
  IF jsonb_array_length(v_settings) <> 1
     OR v_settings->0->>'target' <> '4.5'
     OR v_settings->0->>'tolerance' <> '0.2' THEN
    RAISE EXCEPTION 'Manager-reviewed Brix target and explicit tolerance were not retained';
  END IF;
  v_setting_id := (v_settings->0->>'id')::uuid;
  PERFORM v2.record_qc_event(
    v_facility, v_manager, NULL, 'qc-redact-setting', repeat('4', 64),
    'redaction', jsonb_build_object(
      'targetEventId', v_setting_id,
      'reason', 'Setting source was withdrawn'
    )
  );
  v_settings := v2.list_qc_settings(v_facility, v_recorder);
  IF jsonb_array_length(v_settings) <> 0 THEN
    RAISE EXCEPTION 'Redacted QC setting remained active';
  END IF;

  PERFORM v2.record_qc_event(
    v_facility, v_manager, v_run, 'qc-redact-lot', repeat('2', 64),
    'redaction', jsonb_build_object(
      'targetEventId', v_lot_id,
      'reason', 'Privacy redaction requested'
    )
  );
  v_events := v2.list_qc_events(v_facility, v_recorder, v_run, 100);
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_events) AS entry(value)
    WHERE entry.value->>'id' = v_lot_id::text
      AND entry.value->'payload' = '{"redacted":true}'::jsonb
  ) OR NOT EXISTS (
    SELECT 1 FROM v2.qc_events
    WHERE facility_id = v_facility AND id = v_lot_id
      AND payload->>'lotCode' = 'LOT-44'
  ) THEN
    RAISE EXCEPTION 'Audited redaction did not hide the original event in history while preserving its audit trail';
  END IF;

  v_failed := false;
  BEGIN
    PERFORM v2.list_qc_events(v_other_facility, v_recorder, NULL, 10);
  EXCEPTION WHEN SQLSTATE '42501' OR SQLSTATE '22023' THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'QC history accepted a cross-facility request'; END IF;

  v_failed := false;
  BEGIN
    PERFORM v2.record_qc_event(
      v_facility, v_unauthorized, v_run, 'qc-unauthorized', repeat('3', 64),
      'lot-recorded', '{"lotCode":"NOPE"}'::jsonb
    );
  EXCEPTION WHEN SQLSTATE '42501' THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'A staff member without QC capability recorded QC evidence'; END IF;

  v_failed := false;
  BEGIN
    UPDATE v2.qc_events SET payload = '{}'::jsonb
    WHERE facility_id = v_facility AND id = v_cleaning_id;
  EXCEPTION WHEN SQLSTATE '55000' THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'QC evidence accepted an in-place update'; END IF;

  v_failed := false;
  BEGIN
    DELETE FROM v2.qc_events WHERE facility_id = v_facility AND id = v_cleaning_id;
  EXCEPTION WHEN SQLSTATE '55000' THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'QC evidence accepted deletion'; END IF;

  v_failed := false;
  BEGIN
    DELETE FROM v2.runs WHERE facility_id = v_facility AND id = v_run;
  EXCEPTION WHEN foreign_key_violation THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'A run with retained QC evidence was deleted'; END IF;

  RAISE NOTICE 'V2 QC append-only, roles, scope, review, verification, settings, and redaction checks passed';
END
$$;

ROLLBACK;

SELECT 'V2 QC workflow checks passed.';
