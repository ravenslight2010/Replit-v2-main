BEGIN;

ALTER TABLE v2.qc_events
  DROP CONSTRAINT qc_events_event_type_check;
ALTER TABLE v2.qc_events
  ADD CONSTRAINT qc_events_event_type_check
  CHECK (event_type IN (
    'lot-recorded',
    'weight-check',
    'cleaning-recorded',
    'cleaning-verified',
    'date-code-observed',
    'brix-check',
    'qc-setting-reviewed',
    'review-signed-off',
    'run-check-reviewed',
    'run-substitution-proposed',
    'run-substitution-approved',
    'run-substitution-rejected',
    'run-substitution-corrected',
    'checkpoint-observed',
    'corrective-action-observed',
    'review-flag-raised',
    'review-flag-reviewed',
    'correction',
    'redaction'
  ));

CREATE UNIQUE INDEX qc_events_one_review_per_flag
  ON v2.qc_events (facility_id, (payload->>'targetEventId'))
  WHERE event_type = 'review-flag-reviewed';

CREATE OR REPLACE FUNCTION v2.record_qc_event(
  p_facility_id uuid,
  p_actor_id uuid,
  p_run_id uuid,
  p_request_id text,
  p_request_hash text,
  p_event_type text,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_existing v2.qc_events%ROWTYPE;
  v_event v2.qc_events%ROWTYPE;
  v_target v2.qc_events%ROWTYPE;
  v_key_count integer;
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM v2.facility_scope
       WHERE singleton AND facility_id = p_facility_id
     )
     OR p_request_id IS NULL OR length(btrim(p_request_id)) NOT BETWEEN 1 AND 200
     OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$'
     OR p_event_type IS NULL
     OR p_event_type NOT IN (
       'lot-recorded', 'weight-check', 'cleaning-recorded', 'cleaning-verified',
       'date-code-observed', 'brix-check', 'qc-setting-reviewed',
       'review-signed-off', 'run-check-reviewed', 'run-substitution-proposed',
       'run-substitution-approved', 'run-substitution-rejected',
       'run-substitution-corrected', 'checkpoint-observed',
       'corrective-action-observed', 'review-flag-raised',
       'review-flag-reviewed', 'correction', 'redaction'
     )
     OR p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object'
     OR octet_length(p_payload::text) > 65536
     OR (p_event_type = 'qc-setting-reviewed' AND p_run_id IS NOT NULL)
     OR (p_event_type NOT IN ('qc-setting-reviewed', 'redaction') AND p_run_id IS NULL) THEN
    RAISE EXCEPTION 'Invalid QC event request' USING ERRCODE = '22023';
  END IF;

  IF NOT v2.actor_can_record_qc(p_actor_id) THEN
    RAISE EXCEPTION 'QC recording is not authorized' USING ERRCODE = '42501';
  END IF;
  IF p_event_type IN (
    'qc-setting-reviewed', 'review-signed-off', 'review-flag-reviewed', 'redaction'
  ) AND NOT v2.actor_can_manage_qc(p_actor_id) THEN
    RAISE EXCEPTION 'QC management is not authorized' USING ERRCODE = '42501';
  END IF;
  IF p_run_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM v2.runs WHERE facility_id = p_facility_id AND id = p_run_id
  ) THEN
    RAISE EXCEPTION 'QC run is unavailable' USING ERRCODE = 'P0002';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_facility_id::text || ':' || p_actor_id::text || ':qc:' || p_request_id, 0
  ));
  SELECT * INTO v_existing
  FROM v2.qc_events
  WHERE facility_id = p_facility_id
    AND actor_id = p_actor_id
    AND request_id = p_request_id;
  IF FOUND THEN
    IF v_existing.request_hash <> p_request_hash
       OR v_existing.run_id IS DISTINCT FROM p_run_id
       OR v_existing.event_type <> p_event_type THEN
      RAISE EXCEPTION 'QC request ID was reused with different details'
        USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object(
      'event', jsonb_build_object(
        'id', v_existing.id,
        'runId', v_existing.run_id,
        'actorId', v_existing.actor_id,
        'eventType', v_existing.event_type,
        'payload', v_existing.payload,
        'occurredAt', v_existing.occurred_at
      ),
      'replayed', true
    );
  END IF;

  IF p_event_type = 'cleaning-verified' THEN
    SELECT count(*) INTO v_key_count FROM jsonb_object_keys(p_payload);
    IF p_payload ? 'verifierId' OR v_key_count <> 1
       OR coalesce(p_payload->>'targetEventId', '') !~*
         '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'Cleaning verification must reference one existing record'
        USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_target
    FROM v2.qc_events
    WHERE facility_id = p_facility_id
      AND id = (p_payload->>'targetEventId')::uuid
      AND run_id = p_run_id
      AND event_type = 'cleaning-recorded';
    IF NOT FOUND OR v_target.actor_id = p_actor_id THEN
      RAISE EXCEPTION 'A different authenticated QC staff member must verify cleaning'
        USING ERRCODE = '42501';
    END IF;
    IF EXISTS (
      SELECT 1 FROM v2.qc_events AS redaction
      WHERE redaction.facility_id = p_facility_id
        AND redaction.event_type = 'redaction'
        AND redaction.payload->>'targetEventId' = v_target.id::text
    ) THEN
      RAISE EXCEPTION 'The cleaning record is no longer available for verification'
        USING ERRCODE = '55000';
    END IF;
  ELSIF p_event_type = 'checkpoint-observed' THEN
    SELECT count(*) INTO v_key_count FROM jsonb_object_keys(p_payload);
    IF v_key_count NOT BETWEEN 6 AND 7
       OR (p_payload - ARRAY[
         'checkpointType', 'stationKey', 'checkpointLabel', 'observedValue',
         'unit', 'evaluationStatus', 'note'
       ]::text[]) <> '{}'::jsonb
       OR NOT (p_payload ?& ARRAY[
         'checkpointType', 'stationKey', 'checkpointLabel', 'observedValue', 'unit', 'evaluationStatus'
       ])
       OR coalesce(p_payload->>'checkpointType', '') NOT IN ('temperature', 'time')
       OR coalesce(p_payload->>'stationKey', '') NOT IN ('dough', 'cheese', 'pepperoni', 'sauce', 'frontline')
       OR length(btrim(coalesce(p_payload->>'checkpointLabel', ''))) NOT BETWEEN 1 AND 100
       OR coalesce(p_payload->>'observedValue', '') !~ '^-?(0|[1-9][0-9]{0,8})(\.[0-9]{1,6})?$'
       OR coalesce(p_payload->>'evaluationStatus', '') <> 'not_evaluated'
       OR (p_payload->>'checkpointType' = 'temperature' AND coalesce(p_payload->>'unit', '') NOT IN ('°C', '°F'))
       OR (p_payload->>'checkpointType' = 'time' AND coalesce(p_payload->>'unit', '') NOT IN ('s', 'min', 'h'))
       OR (p_payload->>'checkpointType' = 'time' AND (p_payload->>'observedValue')::numeric < 0)
       OR (p_payload ? 'note' AND length(btrim(coalesce(p_payload->>'note', ''))) NOT BETWEEN 1 AND 500) THEN
      RAISE EXCEPTION 'Invalid observation-only QC checkpoint'
        USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM v2.runs AS run
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(run.setup_snapshot->'productionPlan'->'recipes') = 'array'
            THEN run.setup_snapshot->'productionPlan'->'recipes'
          ELSE '[]'::jsonb
        END
      ) AS recipe(value)
      WHERE run.facility_id = p_facility_id
        AND run.id = p_run_id
        AND recipe.value->>'stationKey' = p_payload->>'stationKey'
    ) THEN
      RAISE EXCEPTION 'QC station is unavailable for this run'
        USING ERRCODE = 'P0002';
    END IF;
  ELSIF p_event_type = 'corrective-action-observed' THEN
    SELECT count(*) INTO v_key_count FROM jsonb_object_keys(p_payload);
    IF v_key_count NOT BETWEEN 2 AND 3
       OR (p_payload - ARRAY['targetEventId', 'actionObserved', 'followUpNote']::text[]) <> '{}'::jsonb
       OR NOT (p_payload ?& ARRAY['targetEventId', 'actionObserved'])
       OR coalesce(p_payload->>'targetEventId', '') !~*
         '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR length(btrim(coalesce(p_payload->>'actionObserved', ''))) NOT BETWEEN 3 AND 500
       OR (p_payload ? 'followUpNote' AND length(btrim(coalesce(p_payload->>'followUpNote', ''))) NOT BETWEEN 1 AND 500) THEN
      RAISE EXCEPTION 'Invalid corrective-action observation'
        USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_target
    FROM v2.qc_events
    WHERE facility_id = p_facility_id
      AND id = (p_payload->>'targetEventId')::uuid
      AND run_id = p_run_id
      AND event_type IN ('checkpoint-observed', 'review-flag-raised');
    IF NOT FOUND OR EXISTS (
      SELECT 1 FROM v2.qc_events AS redaction
      WHERE redaction.facility_id = p_facility_id
        AND redaction.event_type = 'redaction'
        AND redaction.payload->>'targetEventId' = v_target.id::text
    ) THEN
      RAISE EXCEPTION 'QC evidence is unavailable for corrective-action reference'
        USING ERRCODE = 'P0002';
    END IF;
  ELSIF p_event_type = 'review-flag-raised' THEN
    SELECT count(*) INTO v_key_count FROM jsonb_object_keys(p_payload);
    IF p_payload->>'targetType' = 'run' THEN
      IF v_key_count <> 2
         OR (p_payload - ARRAY['targetType', 'reason']::text[]) <> '{}'::jsonb
         OR length(btrim(coalesce(p_payload->>'reason', ''))) NOT BETWEEN 3 AND 500 THEN
        RAISE EXCEPTION 'Invalid run review flag' USING ERRCODE = '22023';
      END IF;
    ELSIF p_payload->>'targetType' = 'lot' THEN
      IF v_key_count <> 3
         OR (p_payload - ARRAY['targetType', 'targetEventId', 'reason']::text[]) <> '{}'::jsonb
         OR coalesce(p_payload->>'targetEventId', '') !~*
           '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
         OR length(btrim(coalesce(p_payload->>'reason', ''))) NOT BETWEEN 3 AND 500 THEN
        RAISE EXCEPTION 'Invalid lot review flag' USING ERRCODE = '22023';
      END IF;
      SELECT * INTO v_target
      FROM v2.qc_events
      WHERE facility_id = p_facility_id
        AND id = (p_payload->>'targetEventId')::uuid
        AND run_id = p_run_id
        AND event_type = 'lot-recorded';
      IF NOT FOUND OR EXISTS (
        SELECT 1 FROM v2.qc_events AS redaction
        WHERE redaction.facility_id = p_facility_id
          AND redaction.event_type = 'redaction'
          AND redaction.payload->>'targetEventId' = v_target.id::text
      ) THEN
        RAISE EXCEPTION 'QC lot record is unavailable for review'
          USING ERRCODE = 'P0002';
      END IF;
    ELSE
      RAISE EXCEPTION 'Choose a run or lot review flag' USING ERRCODE = '22023';
    END IF;
  ELSIF p_event_type = 'review-flag-reviewed' THEN
    SELECT count(*) INTO v_key_count FROM jsonb_object_keys(p_payload);
    IF v_key_count <> 2
       OR (p_payload - ARRAY['targetEventId', 'reviewNote']::text[]) <> '{}'::jsonb
       OR coalesce(p_payload->>'targetEventId', '') !~*
         '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR length(btrim(coalesce(p_payload->>'reviewNote', ''))) NOT BETWEEN 3 AND 500 THEN
      RAISE EXCEPTION 'Invalid QC review-flag decision' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_target
    FROM v2.qc_events
    WHERE facility_id = p_facility_id
      AND id = (p_payload->>'targetEventId')::uuid
      AND run_id = p_run_id
      AND event_type = 'review-flag-raised';
    IF NOT FOUND OR EXISTS (
      SELECT 1 FROM v2.qc_events AS redaction
      WHERE redaction.facility_id = p_facility_id
        AND redaction.event_type = 'redaction'
        AND redaction.payload->>'targetEventId' = v_target.id::text
    ) THEN
      RAISE EXCEPTION 'QC review flag is unavailable'
        USING ERRCODE = 'P0002';
    END IF;
    IF EXISTS (
      SELECT 1 FROM v2.qc_events AS reviewed
      WHERE reviewed.facility_id = p_facility_id
        AND reviewed.event_type = 'review-flag-reviewed'
        AND reviewed.payload->>'targetEventId' = v_target.id::text
    ) THEN
      RAISE EXCEPTION 'QC review flag was already reviewed'
        USING ERRCODE = '55000';
    END IF;
  ELSIF p_event_type IN ('correction', 'redaction') THEN
    IF coalesce(p_payload->>'targetEventId', '') !~*
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR length(btrim(coalesce(p_payload->>'reason', ''))) NOT BETWEEN 3 AND 500 THEN
      RAISE EXCEPTION 'QC correction or redaction requires a target and reason'
        USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_target
    FROM v2.qc_events
    WHERE facility_id = p_facility_id
      AND id = (p_payload->>'targetEventId')::uuid
      AND run_id IS NOT DISTINCT FROM p_run_id
      AND event_type NOT IN ('correction', 'redaction', 'review-signed-off');
    IF NOT FOUND THEN
      RAISE EXCEPTION 'QC evidence is unavailable for correction'
        USING ERRCODE = 'P0002';
    END IF;
    IF p_event_type = 'redaction' AND EXISTS (
      SELECT 1 FROM v2.qc_events AS prior
      WHERE prior.facility_id = p_facility_id
        AND prior.event_type = 'redaction'
        AND prior.payload->>'targetEventId' = v_target.id::text
    ) THEN
      RAISE EXCEPTION 'QC evidence has already been redacted'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  INSERT INTO v2.qc_events (
    facility_id, run_id, actor_id, request_id, request_hash, event_type, payload
  ) VALUES (
    p_facility_id, p_run_id, p_actor_id, p_request_id, p_request_hash,
    p_event_type, p_payload
  )
  RETURNING * INTO v_event;

  RETURN jsonb_build_object(
    'event', jsonb_build_object(
      'id', v_event.id,
      'runId', v_event.run_id,
      'actorId', v_event.actor_id,
      'eventType', v_event.event_type,
      'payload', v_event.payload,
      'occurredAt', v_event.occurred_at
    ),
    'replayed', false
  );
END
$$;

REVOKE ALL ON FUNCTION v2.record_qc_event(uuid, uuid, uuid, text, text, text, jsonb) FROM PUBLIC;

COMMENT ON FUNCTION v2.record_qc_event(uuid, uuid, uuid, text, text, text, jsonb) IS
  'Appends authenticated QC evidence, including observation-only checkpoints, corrective-action evidence, and advisory review flags.';

COMMIT;
