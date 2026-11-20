BEGIN;

CREATE TABLE v2.qc_events (
  facility_id uuid NOT NULL REFERENCES v2.facility_scope (facility_id) ON DELETE RESTRICT,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  run_id uuid,
  actor_id uuid NOT NULL,
  request_id text NOT NULL CHECK (length(btrim(request_id)) BETWEEN 1 AND 200),
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  event_type text NOT NULL CHECK (event_type IN (
    'lot-recorded',
    'weight-check',
    'cleaning-recorded',
    'cleaning-verified',
    'date-code-observed',
    'brix-check',
    'qc-setting-reviewed',
    'review-signed-off',
    'correction',
    'redaction'
  )),
  payload jsonb NOT NULL CHECK (
    jsonb_typeof(payload) = 'object'
    AND octet_length(payload::text) <= 65536
  ),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (facility_id, id),
  UNIQUE (facility_id, actor_id, request_id),
  FOREIGN KEY (facility_id, run_id)
    REFERENCES v2.runs (facility_id, id) ON DELETE RESTRICT
);

CREATE INDEX qc_events_run_history
  ON v2.qc_events (facility_id, run_id, occurred_at DESC, id DESC);
CREATE INDEX qc_events_facility_history
  ON v2.qc_events (facility_id, occurred_at DESC, id DESC);
CREATE UNIQUE INDEX qc_events_one_cleaning_verification
  ON v2.qc_events (facility_id, (payload->>'targetEventId'))
  WHERE event_type = 'cleaning-verified';
CREATE UNIQUE INDEX qc_events_one_redaction
  ON v2.qc_events (facility_id, (payload->>'targetEventId'))
  WHERE event_type = 'redaction';

INSERT INTO v2.roles (name, capabilities, builtin)
VALUES ('qc-operator', '["record-qc"]'::jsonb, true)
ON CONFLICT (name) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM v2.roles
    WHERE name = 'qc-operator'
      AND capabilities = '["record-qc"]'::jsonb
      AND builtin = true
  ) THEN
    RAISE EXCEPTION 'V2 QC operator role conflicts with the approved capability boundary';
  END IF;
END
$$;

CREATE FUNCTION v2.prevent_qc_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, v2
AS $$
BEGIN
  RAISE EXCEPTION 'QC evidence is append-only'
    USING ERRCODE = '55000';
END
$$;

CREATE TRIGGER qc_events_append_only
  BEFORE UPDATE OR DELETE ON v2.qc_events
  FOR EACH ROW EXECUTE FUNCTION v2.prevent_qc_event_mutation();

CREATE FUNCTION v2.actor_can_record_qc(p_actor_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM v2.staff_accounts AS u
    JOIN v2.user_roles AS ur ON ur.user_id = u.id
    JOIN v2.roles AS r ON r.name = ur.role_name
    WHERE u.id = p_actor_id
      AND u.disabled = false
      AND (r.capabilities ? 'record-qc' OR r.capabilities ? 'manage-qc')
  )
$$;

CREATE FUNCTION v2.actor_can_manage_qc(p_actor_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM v2.staff_accounts AS u
    JOIN v2.user_roles AS ur ON ur.user_id = u.id
    JOIN v2.roles AS r ON r.name = ur.role_name
    WHERE u.id = p_actor_id
      AND u.disabled = false
      AND r.capabilities ? 'manage-qc'
  )
$$;

CREATE FUNCTION v2.record_qc_event(
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
       'review-signed-off', 'correction', 'redaction'
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
  IF p_event_type IN ('qc-setting-reviewed', 'review-signed-off', 'redaction')
     AND NOT v2.actor_can_manage_qc(p_actor_id) THEN
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

CREATE FUNCTION v2.list_qc_events(
  p_facility_id uuid,
  p_actor_id uuid,
  p_run_id uuid,
  p_limit integer
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM v2.facility_scope
       WHERE singleton AND facility_id = p_facility_id
     )
     OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 10001 THEN
    RAISE EXCEPTION 'Invalid QC history request' USING ERRCODE = '22023';
  END IF;
  IF NOT v2.actor_can_record_qc(p_actor_id) THEN
    RAISE EXCEPTION 'QC history is not authorized' USING ERRCODE = '42501';
  END IF;
  IF p_run_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM v2.runs WHERE facility_id = p_facility_id AND id = p_run_id
  ) THEN
    RAISE EXCEPTION 'QC run is unavailable' USING ERRCODE = 'P0002';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', event.id,
      'runId', event.run_id,
      'actorId', event.actor_id,
      'eventType', event.event_type,
      'payload', CASE
        WHEN EXISTS (
          SELECT 1 FROM v2.qc_events AS redaction
          WHERE redaction.facility_id = event.facility_id
            AND redaction.event_type = 'redaction'
            AND redaction.payload->>'targetEventId' = event.id::text
        ) THEN jsonb_build_object('redacted', true)
        ELSE event.payload
      END,
      'occurredAt', event.occurred_at
    ) ORDER BY event.occurred_at DESC, event.id DESC)
    FROM (
      SELECT * FROM v2.qc_events AS event
      WHERE event.facility_id = p_facility_id
        AND (p_run_id IS NULL OR event.run_id = p_run_id)
      ORDER BY event.occurred_at DESC, event.id DESC
      LIMIT p_limit
    ) AS event
  ), '[]'::jsonb);
END
$$;

CREATE FUNCTION v2.list_qc_settings(
  p_facility_id uuid,
  p_actor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM v2.facility_scope
       WHERE singleton AND facility_id = p_facility_id
     ) THEN
    RAISE EXCEPTION 'Invalid QC settings request' USING ERRCODE = '22023';
  END IF;
  IF NOT v2.actor_can_record_qc(p_actor_id) THEN
    RAISE EXCEPTION 'QC settings are not authorized' USING ERRCODE = '42501';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', latest.id,
      'actorId', latest.actor_id,
      'settingKey', latest.payload->>'settingKey',
      'settingType', latest.payload->>'settingType',
      'subjectCode', latest.payload->>'subjectCode',
      'stationKey', latest.payload->>'stationKey',
      'target', latest.payload->'target',
      'tolerance', latest.payload->'tolerance',
      'unit', latest.payload->>'unit',
      'sourceReference', latest.payload->>'sourceReference',
      'occurredAt', latest.occurred_at
    ) ORDER BY latest.payload->>'settingKey')
    FROM (
      SELECT DISTINCT ON (event.payload->>'settingKey') event.*
      FROM v2.qc_events AS event
      WHERE event.facility_id = p_facility_id
        AND event.event_type = 'qc-setting-reviewed'
      ORDER BY event.payload->>'settingKey', event.occurred_at DESC, event.id DESC
      LIMIT 1000
    ) AS latest
    WHERE NOT EXISTS (
      SELECT 1 FROM v2.qc_events AS redaction
      WHERE redaction.facility_id = latest.facility_id
        AND redaction.event_type = 'redaction'
        AND redaction.payload->>'targetEventId' = latest.id::text
    )
  ), '[]'::jsonb);
END
$$;

CREATE FUNCTION v2.get_qc_review_state(
  p_facility_id uuid,
  p_actor_id uuid,
  p_run_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_signoff v2.qc_events%ROWTYPE;
  v_latest_evidence v2.qc_events%ROWTYPE;
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL OR p_run_id IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM v2.facility_scope
       WHERE singleton AND facility_id = p_facility_id
     )
     OR NOT EXISTS (
       SELECT 1 FROM v2.runs WHERE facility_id = p_facility_id AND id = p_run_id
     ) THEN
    RAISE EXCEPTION 'Invalid QC review request' USING ERRCODE = '22023';
  END IF;
  IF NOT v2.actor_can_record_qc(p_actor_id) THEN
    RAISE EXCEPTION 'QC review is not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_signoff
  FROM v2.qc_events
  WHERE facility_id = p_facility_id
    AND run_id = p_run_id
    AND event_type = 'review-signed-off'
  ORDER BY occurred_at DESC, id DESC
  LIMIT 1;
  SELECT * INTO v_latest_evidence
  FROM v2.qc_events
  WHERE facility_id = p_facility_id
    AND run_id = p_run_id
    AND event_type NOT IN ('review-signed-off', 'redaction')
  ORDER BY occurred_at DESC, id DESC
  LIMIT 1;

  RETURN jsonb_build_object(
    'status', CASE WHEN v_signoff.id IS NOT NULL
        AND (v_latest_evidence.id IS NULL
          OR (v_signoff.occurred_at, v_signoff.id) >= (v_latest_evidence.occurred_at, v_latest_evidence.id))
      THEN 'signed-off'
      ELSE 'needs-review'
    END,
    'signedOffAt', v_signoff.occurred_at,
    'signedOffBy', v_signoff.actor_id
  );
END
$$;

REVOKE ALL ON TABLE v2.qc_events FROM PUBLIC;
REVOKE ALL ON FUNCTION v2.prevent_qc_event_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION v2.actor_can_record_qc(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION v2.actor_can_manage_qc(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION v2.record_qc_event(uuid, uuid, uuid, text, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION v2.list_qc_events(uuid, uuid, uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION v2.list_qc_settings(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION v2.get_qc_review_state(uuid, uuid, uuid) FROM PUBLIC;

COMMENT ON TABLE v2.qc_events IS
  'Facility-scoped append-only V2 QC evidence and reviewed settings; intentionally outside reset/purge paths.';
COMMENT ON FUNCTION v2.record_qc_event(uuid, uuid, uuid, text, text, text, jsonb) IS
  'Appends authenticated QC evidence; validates separate-person cleaning verification and audited correction/redaction references.';

COMMIT;
