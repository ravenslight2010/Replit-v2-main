DO $$
DECLARE
  v_facility uuid;
  v_manager uuid := '97000000-0000-4000-8000-000000000011';
  v_operator uuid := '97000000-0000-4000-8000-000000000012';
  v_run_a uuid;
  v_run_b uuid;
  v_now timestamptz := clock_timestamp();
  v_date date := (clock_timestamp() AT TIME ZONE 'America/Chicago')::date;
  v_snapshot jsonb;
  v_events jsonb;
  v_first_action jsonb;
  v_saved jsonb;
  v_replay jsonb;
  v_cursor_at timestamptz;
  v_cursor_id uuid;
  v_cursor_revision bigint;
  v_failed boolean;
BEGIN
  IF date '2026-03-08'::timestamp AT TIME ZONE 'America/Chicago'
       <> timestamptz '2026-03-08 06:00:00+00'
     OR date '2026-11-01'::timestamp AT TIME ZONE 'America/Chicago'
       <> timestamptz '2026-11-01 05:00:00+00' THEN
    RAISE EXCEPTION 'Manager report Central-time boundaries did not respect daylight-saving transitions';
  END IF;
  SELECT facility_id INTO v_facility FROM v2.facility_scope WHERE singleton;
  INSERT INTO v2.staff_accounts (id, username, password_hash)
  VALUES
    (v_manager, 'ManagerOperationsTest', 'argon2id$v=19$m=19456,t=2,p=1$c2FsdA==$aGFzaA=='),
    (v_operator, 'ManagerOperationsOperator', 'argon2id$v=19$m=19456,t=2,p=1$c2FsdA==$aGFzaA==');
  INSERT INTO v2.user_roles (user_id, role_name)
  VALUES (v_manager, 'manager'), (v_operator, 'operator');

  v_run_a := gen_random_uuid();
  v_run_b := gen_random_uuid();
  INSERT INTO v2.runs (
    facility_id, id, status, revision, created_at, updated_at, started_at, paused_at, setup_snapshot
  ) VALUES
    (v_facility, v_run_a, 'paused', 2, v_now - interval '20 minutes',
      v_now - interval '5 minutes', v_now - interval '10 minutes', v_now - interval '5 minutes',
      '{"label":"Operations test run A","targetCases":12}'::jsonb),
    (v_facility, v_run_b, 'planned', 0, v_now - interval '19 minutes',
      v_now - interval '19 minutes', NULL, NULL,
      '{"label":"Operations test run B","targetCases":9}'::jsonb);
  INSERT INTO v2.run_events (
    facility_id, run_id, revision, actor_id, event_type, occurred_at, payload
  ) VALUES
    (v_facility, v_run_a, 0, v_manager, 'run.created', v_now - interval '20 minutes', '{"label":"Operations test run A"}'::jsonb),
    (v_facility, v_run_a, 1, v_manager, 'run.started', v_now - interval '10 minutes', '{"secret":"must not be returned"}'::jsonb),
    (v_facility, v_run_a, 2, v_manager, 'run.paused', v_now - interval '5 minutes', '{"secret":"must not be returned"}'::jsonb),
    (v_facility, v_run_b, 0, v_manager, 'run.created', v_now - interval '19 minutes', '{"label":"Operations test run B"}'::jsonb);
  INSERT INTO v2.run_station_progress (
    facility_id, run_id, station_key, status, revision, started_at, paused_at,
    progress, updated_at
  ) VALUES (
    v_facility, v_run_a, 'line', 'paused', 1, v_now - interval '10 minutes',
    v_now - interval '5 minutes', '{"casesProduced":7}'::jsonb, v_now - interval '5 minutes'
  );
  INSERT INTO v2.run_pause_intervals (
    facility_id, run_id, pause_number, paused_at
  ) VALUES (v_facility, v_run_a, 1, v_now - interval '5 minutes');

  SET LOCAL ROLE v2_api_test;
  v_snapshot := v2.get_manager_operations_snapshot(
    v_facility, v_manager, v_date, v_date, 1, NULL, NULL
  );
  IF v_snapshot->>'timeZone' <> 'America/Chicago'
     OR (v_snapshot->'summary'->>'runsCreated')::integer < 2
     OR jsonb_array_length(v_snapshot->'runs'->'items') <> 1
     OR (v_snapshot->'runs'->>'hasMore')::boolean IS NOT TRUE
     OR v_snapshot->'coverage'->'syncConflicts'->>'status' <> 'unavailable'
     OR v_snapshot->'coverage'->'incidentPatterns'->>'status' <> 'unavailable'
     OR (v_snapshot->'summary'->>'casesProduced')::numeric < 7
     OR v_snapshot->'coverage'->'scheduleHistory'->>'status' <> 'partial'
     OR v_snapshot::text LIKE '%setupSnapshot%'
     OR v_snapshot::text LIKE '%payload%' THEN
    RAISE EXCEPTION 'Manager report did not return bounded, privacy-safe, explicitly scoped coverage: %', v_snapshot;
  END IF;
  v_cursor_at := (v_snapshot->'runs'->'nextCursor'->>'createdAt')::timestamptz;
  v_cursor_id := (v_snapshot->'runs'->'nextCursor'->>'runId')::uuid;
  v_snapshot := v2.get_manager_operations_snapshot(
    v_facility, v_manager, v_date, v_date, 1, v_cursor_at, v_cursor_id
  );
  IF jsonb_array_length(v_snapshot->'runs'->'items') <> 1
     OR v_snapshot->'runs'->'items'->0->>'runId' = v_cursor_id::text THEN
    RAISE EXCEPTION 'Manager run history cursor did not advance to a distinct run';
  END IF;

  v_events := v2.list_manager_operation_events(
    v_facility, v_manager, v_date, v_date, 1, v_run_a, NULL, NULL, NULL
  );
  IF jsonb_array_length(v_events->'events') <> 1
     OR (v_events->>'hasMore')::boolean IS NOT TRUE
     OR v_events::text LIKE '%payload%' THEN
    RAISE EXCEPTION 'Manager run event page was not bounded or sanitized: %', v_events;
  END IF;
  v_cursor_at := (v_events->'nextCursor'->>'occurredAt')::timestamptz;
  v_cursor_id := (v_events->'nextCursor'->>'runId')::uuid;
  v_cursor_revision := (v_events->'nextCursor'->>'revision')::bigint;
  v_events := v2.list_manager_operation_events(
    v_facility, v_manager, v_date, v_date, 10, v_run_a, v_cursor_at, v_cursor_id, v_cursor_revision
  );
  IF jsonb_array_length(v_events->'events') < 1
     OR v_events->'events'->0->>'eventType' <> 'run.started' THEN
    RAISE EXCEPTION 'Manager event history cursor failed to return earlier lifecycle evidence';
  END IF;

  v_first_action := v2.get_manager_operations_snapshot(
    v_facility, v_manager, v_date, v_date, 10, NULL, NULL
  )->'actions'->0;
  IF v_first_action->>'status' <> 'pending'
     OR v_first_action->>'actionKey' <> 'run-pause:' || v_run_a::text || ':2' THEN
    RAISE EXCEPTION 'A recorded pause was not listed as a pending review action: %', v_first_action;
  END IF;

  v_saved := v2.record_manager_action_status(
    v_facility, v_manager, v_first_action->>'actionKey', 0,
    'ops-ack-a', repeat('5', 64), 'acknowledged', 'Reviewed the pause record'
  );
  IF v_saved->'event'->>'actorId' <> v_manager::text
     OR v_saved->'event'->>'status' <> 'acknowledged'
     OR v_saved->'event'->>'revision' <> '1' THEN
    RAISE EXCEPTION 'Manager action did not preserve the attributed status event: %', v_saved;
  END IF;
  v_replay := v2.record_manager_action_status(
    v_facility, v_manager, v_first_action->>'actionKey', 0,
    'ops-ack-a', repeat('5', 64), 'acknowledged', 'Reviewed the pause record'
  );
  IF (v_replay->>'replayed')::boolean IS NOT TRUE
     OR v_replay->'event'->>'id' <> v_saved->'event'->>'id' THEN
    RAISE EXCEPTION 'An exact manager action retry did not return its original event';
  END IF;
  v_failed := false;
  BEGIN
    PERFORM v2.record_manager_action_status(
      v_facility, v_manager, v_first_action->>'actionKey', 0,
      'ops-ack-a', repeat('8', 64), 'acknowledged', 'Different use of same key'
    );
  EXCEPTION WHEN invalid_parameter_value THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'A manager action request ID was reused with different details'; END IF;

  v_snapshot := v2.get_manager_operations_snapshot(v_facility, v_manager, v_date, v_date, 10, NULL, NULL);
  IF v_snapshot->'actions'->0->>'status' <> 'acknowledged'
     OR v_snapshot->'actions'->0->'lastAction'->>'note' <> 'Reviewed the pause record' THEN
    RAISE EXCEPTION 'Acknowledged action status did not persist in the read model';
  END IF;

  v_saved := v2.record_manager_action_status(
    v_facility, v_manager, v_first_action->>'actionKey', 1,
    'ops-unavailable-a', repeat('8', 64), 'unavailable-evidence', 'Source evidence needs follow-up'
  );
  IF v_saved->'event'->>'revision' <> '2'
     OR v_saved->'event'->>'status' <> 'unavailable-evidence' THEN
    RAISE EXCEPTION 'The unavailable-evidence status did not advance the action revision';
  END IF;
  v_saved := v2.record_manager_action_status(
    v_facility, v_manager, v_first_action->>'actionKey', 2,
    'ops-resolve-a', repeat('9', 64), 'resolved', 'Verified the pause record'
  );
  IF v_saved->'event'->>'revision' <> '3'
     OR v_saved->'event'->>'status' <> 'resolved' THEN
    RAISE EXCEPTION 'The resolved status did not advance the action revision';
  END IF;

  v_failed := false;
  BEGIN
    PERFORM v2.record_manager_action_status(
      v_facility, v_manager, v_first_action->>'actionKey', 0,
      'ops-stale-a', repeat('6', 64), 'resolved', 'Resolve stale action'
    );
  EXCEPTION WHEN serialization_failure THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'A stale manager action update was accepted'; END IF;

  v_failed := false;
  BEGIN
    PERFORM v2.record_manager_action_status(
      v_facility, v_operator, v_first_action->>'actionKey', 1,
      'ops-denied-a', repeat('7', 64), 'resolved', 'Operator cannot resolve'
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'An operator changed a manager action'; END IF;
  RESET ROLE;

  v_failed := false;
  BEGIN
    PERFORM v2.get_manager_operations_snapshot(
      v_facility, v_manager, v_date - 90, v_date, 10, NULL, NULL
    );
  EXCEPTION WHEN invalid_parameter_value THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'A report range longer than 90 days was accepted'; END IF;

  v_failed := false;
  BEGIN
    UPDATE v2.manager_action_events SET note = 'changed'
    WHERE facility_id = v_facility AND action_key = v_first_action->>'actionKey';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'Manager action history allowed an in-place edit'; END IF;

  IF (SELECT status FROM v2.runs WHERE facility_id = v_facility AND id = v_run_a) <> 'paused' THEN
    RAISE EXCEPTION 'Manager status change modified canonical run state';
  END IF;
END
$$;

UPDATE v2.staff_accounts SET disabled = true
WHERE id IN (
  '97000000-0000-4000-8000-000000000011',
  '97000000-0000-4000-8000-000000000012'
);
