BEGIN;

CREATE TABLE v2.production_schedules (
  facility_id uuid NOT NULL REFERENCES v2.facility_scope (facility_id) ON DELETE RESTRICT,
  production_date date NOT NULL,
  revision bigint NOT NULL CHECK (revision BETWEEN 0 AND 9007199254740991),
  plan jsonb NOT NULL CHECK (jsonb_typeof(plan) = 'object'),
  time_zone text NOT NULL DEFAULT 'America/Chicago' CHECK (time_zone = 'America/Chicago'),
  updated_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (facility_id, production_date),
  CHECK (plan ?& ARRAY['productionStartTime', 'runs', 'breaks'])
);

CREATE TABLE v2.production_schedule_receipts (
  facility_id uuid NOT NULL REFERENCES v2.facility_scope (facility_id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL,
  request_id text NOT NULL CHECK (length(btrim(request_id)) BETWEEN 1 AND 200),
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  response jsonb NOT NULL CHECK (jsonb_typeof(response) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (facility_id, actor_id, request_id)
);

CREATE FUNCTION v2.schedule_default_start_time(p_facility_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
  SELECT CASE
    WHEN COALESCE(r.data->>'value', '') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      THEN r.data->>'value'
    ELSE '06:00'
  END
  FROM (SELECT 1) AS fallback
  LEFT JOIN v2.setup_manager_list_records AS r
    ON r.facility_id = p_facility_id
   AND r.code = 'run-calc-production-start-time'
$$;

CREATE FUNCTION v2.validate_production_schedule_runs(p_facility_id uuid, p_runs jsonb)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_run jsonb;
  v_count integer := 0;
BEGIN
  IF jsonb_typeof(p_runs) IS DISTINCT FROM 'array' THEN
    RETURN false;
  END IF;
  IF jsonb_array_length(p_runs) > 100 THEN
    RETURN false;
  END IF;
  FOR v_run IN SELECT value FROM jsonb_array_elements(p_runs) LOOP
    v_count := v_count + 1;
    IF jsonb_typeof(v_run) IS DISTINCT FROM 'object'
       OR v_run - ARRAY['id','productCode','productionSetupCode','runTemplateCode','targetCases','notes'] <> '{}'::jsonb
       OR NOT (v_run ?& ARRAY['id','productCode','productionSetupCode','runTemplateCode','targetCases','notes'])
       OR jsonb_typeof(v_run->'id') IS DISTINCT FROM 'string'
       OR (v_run->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR jsonb_typeof(v_run->'productCode') IS DISTINCT FROM 'string'
       OR (v_run->>'productCode') !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$'
       OR jsonb_typeof(v_run->'productionSetupCode') IS DISTINCT FROM 'string'
       OR (v_run->>'productionSetupCode') !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$'
       OR jsonb_typeof(v_run->'runTemplateCode') IS DISTINCT FROM 'string'
       OR (v_run->>'runTemplateCode') !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$'
       OR jsonb_typeof(v_run->'targetCases') IS DISTINCT FROM 'number'
       OR (v_run->>'targetCases') !~ '^[1-9][0-9]{0,6}$'
       OR jsonb_typeof(v_run->'notes') IS DISTINCT FROM 'string'
       OR length(v_run->>'notes') > 500 THEN
      RETURN false;
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_runs) AS earlier(value)
      WHERE earlier.value->>'id' = v_run->>'id'
        AND earlier.value <> v_run
    ) OR (
      SELECT count(*) FROM jsonb_array_elements(p_runs) AS duplicate(value)
      WHERE duplicate.value->>'id' = v_run->>'id'
    ) <> 1 THEN
      RETURN false;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM v2.products AS p
      WHERE p.facility_id = p_facility_id
        AND lower(p.code) = lower(v_run->>'productCode')
        AND p.active
    ) OR NOT EXISTS (
      SELECT 1 FROM v2.master_records AS s
      WHERE s.facility_id = p_facility_id
        AND s.kind = 'production-setups'
        AND lower(s.code) = lower(v_run->>'productionSetupCode')
        AND lower(s.product_code) = lower(v_run->>'productCode')
        AND s.data->>'sourceFamily' IS NULL
        AND jsonb_typeof(s.data->'recipe_codes') = 'array'
        AND jsonb_typeof(s.data->'packaging_per_case') = 'array'
    ) OR NOT EXISTS (
      SELECT 1 FROM v2.setup_run_template_records AS t
      WHERE t.facility_id = p_facility_id
        AND lower(t.code) = lower(v_run->>'runTemplateCode')
    ) THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN v_count <= 100;
END
$$;

CREATE FUNCTION v2.validate_production_schedule_breaks(p_runs jsonb, p_breaks jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog
AS $$
DECLARE
  v_break jsonb;
  v_slot integer := 0;
BEGIN
  IF jsonb_typeof(p_breaks) IS DISTINCT FROM 'array' THEN
    RETURN false;
  END IF;
  IF jsonb_array_length(p_breaks) <> 3 THEN
    RETURN false;
  END IF;
  FOR v_break IN SELECT value FROM jsonb_array_elements(p_breaks) LOOP
    v_slot := v_slot + 1;
    IF jsonb_typeof(v_break) IS DISTINCT FROM 'object'
       OR v_break - ARRAY['slot','enabled','runId'] <> '{}'::jsonb
       OR NOT (v_break ?& ARRAY['slot','enabled','runId'])
       OR jsonb_typeof(v_break->'slot') IS DISTINCT FROM 'number'
       OR (v_break->>'slot')::integer <> v_slot
       OR jsonb_typeof(v_break->'enabled') IS DISTINCT FROM 'boolean'
       OR NOT (
         v_break->'runId' = 'null'::jsonb
         OR (jsonb_typeof(v_break->'runId') = 'string'
           AND (v_break->>'runId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
           AND EXISTS (
             SELECT 1 FROM jsonb_array_elements(p_runs) AS run(value)
             WHERE run.value->>'id' = v_break->>'runId'
           ))
       ) THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
END
$$;

CREATE FUNCTION v2.get_production_schedule(p_facility_id uuid, p_date date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_schedule v2.production_schedules%ROWTYPE;
BEGIN
  IF p_facility_id IS NULL OR p_date IS NULL
     OR NOT EXISTS (SELECT 1 FROM v2.facility_scope WHERE singleton AND facility_id = p_facility_id) THEN
    RAISE EXCEPTION 'Invalid production schedule scope' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_schedule FROM v2.production_schedules
    WHERE facility_id = p_facility_id AND production_date = p_date;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'date', p_date, 'revision', 0, 'timeZone', 'America/Chicago',
      'productionStartTime', v2.schedule_default_start_time(p_facility_id),
      'runs', '[]'::jsonb,
      'breaks', jsonb_build_array(
        jsonb_build_object('slot',1,'enabled',false,'runId',NULL),
        jsonb_build_object('slot',2,'enabled',false,'runId',NULL),
        jsonb_build_object('slot',3,'enabled',false,'runId',NULL)
      ),
      'updatedAt', NULL
    );
  END IF;
  RETURN jsonb_build_object(
    'date', v_schedule.production_date, 'revision', v_schedule.revision,
    'timeZone', v_schedule.time_zone,
    'productionStartTime', v_schedule.plan->'productionStartTime',
    'runs', v_schedule.plan->'runs', 'breaks', v_schedule.plan->'breaks',
    'updatedAt', v_schedule.updated_at
  );
END
$$;

CREATE FUNCTION v2.list_schedule_run_templates(p_facility_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
BEGIN
  IF p_facility_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM v2.facility_scope WHERE singleton AND facility_id = p_facility_id) THEN
    RAISE EXCEPTION 'Invalid production schedule scope' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'code', code, 'name', name, 'brand', data->'brand', 'flavor', data->'flavor',
      'values', jsonb_strip_nulls(jsonb_build_object(
        'pizzasPerCase', data->'values'->'pizzasPerCase',
        'crustsPerCycle', data->'values'->'crustsPerCycle',
        'cycleSpeed', data->'values'->'cycleSpeed',
        'speedAdjustment', data->'values'->'speedAdjustment',
        'freezerTime', data->'values'->'freezerTime'
      ))
    ) ORDER BY lower(name), code)
    FROM v2.setup_run_template_records
    WHERE facility_id = p_facility_id
  ), '[]'::jsonb);
END
$$;

CREATE FUNCTION v2.apply_production_schedule_command(
  p_facility_id uuid,
  p_actor_id uuid,
  p_date date,
  p_request_id text,
  p_request_hash text,
  p_expected_revision bigint,
  p_command jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_receipt v2.production_schedule_receipts%ROWTYPE;
  v_current v2.production_schedules%ROWTYPE;
  v_runs jsonb;
  v_breaks jsonb;
  v_start text;
  v_next_runs jsonb;
  v_run jsonb;
  v_target_index integer;
  v_first_index integer;
  v_second_index integer;
  v_original jsonb;
  v_now timestamptz := clock_timestamp();
  v_revision bigint;
  v_response jsonb;
  v_type text;
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL OR p_date IS NULL
     OR p_expected_revision IS NULL OR p_expected_revision < 0 OR p_expected_revision > 9007199254740991
     OR p_request_id IS NULL OR length(btrim(p_request_id)) NOT BETWEEN 1 AND 200
     OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$'
     OR jsonb_typeof(p_command) IS DISTINCT FROM 'object'
     OR NOT EXISTS (SELECT 1 FROM v2.facility_scope WHERE singleton AND facility_id = p_facility_id) THEN
    RAISE EXCEPTION 'Invalid production schedule command' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_facility_id::text || ':' || p_date::text, 0));
  SELECT * INTO v_receipt FROM v2.production_schedule_receipts
    WHERE facility_id = p_facility_id AND actor_id = p_actor_id AND request_id = p_request_id;
  IF FOUND THEN
    IF v_receipt.request_hash <> p_request_hash THEN
      RAISE EXCEPTION 'Schedule request ID was reused with different details' USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object(
      'outcome', 'accepted', 'replayed', true,
      'schedule', v2.get_production_schedule(p_facility_id, p_date)
    );
  END IF;
  SELECT * INTO v_current FROM v2.production_schedules
    WHERE facility_id = p_facility_id AND production_date = p_date FOR UPDATE;
  IF FOUND THEN
    v_revision := v_current.revision;
    v_runs := v_current.plan->'runs';
    v_breaks := v_current.plan->'breaks';
    v_start := v_current.plan->>'productionStartTime';
  ELSE
    v_revision := 0;
    v_runs := '[]'::jsonb;
    v_breaks := jsonb_build_array(
      jsonb_build_object('slot',1,'enabled',false,'runId',NULL),
      jsonb_build_object('slot',2,'enabled',false,'runId',NULL),
      jsonb_build_object('slot',3,'enabled',false,'runId',NULL)
    );
    v_start := v2.schedule_default_start_time(p_facility_id);
  END IF;
  IF v_revision <> p_expected_revision THEN
    RETURN jsonb_build_object(
      'outcome', 'conflict', 'replayed', false,
      'schedule', v2.get_production_schedule(p_facility_id, p_date)
    );
  END IF;
  v_type := p_command->>'type';
  IF v_type = 'add' THEN
    IF (p_command - ARRAY['type','run']) <> '{}'::jsonb
       OR NOT (p_command ?& ARRAY['type','run'])
       OR jsonb_array_length(v_runs) >= 100 THEN
      RAISE EXCEPTION 'Invalid schedule addition' USING ERRCODE = '22023';
    END IF;
    v_runs := v_runs || jsonb_build_array(p_command->'run');
  ELSIF v_type = 'update' THEN
    IF (p_command - ARRAY['type','runId','changes']) <> '{}'::jsonb
       OR NOT (p_command ?& ARRAY['type','runId','changes'])
       OR jsonb_typeof(p_command->'changes') IS DISTINCT FROM 'object'
       OR (p_command->'changes' - ARRAY['productCode','productionSetupCode','runTemplateCode','targetCases','notes']) <> '{}'::jsonb THEN
      RAISE EXCEPTION 'Invalid planned-run update' USING ERRCODE = '22023';
    END IF;
    SELECT ordinality::integer - 1 INTO v_target_index
      FROM jsonb_array_elements(v_runs) WITH ORDINALITY AS item(value, ordinality)
      WHERE value->>'id' = p_command->>'runId';
    IF v_target_index IS NULL THEN RAISE EXCEPTION 'Planned run no longer exists' USING ERRCODE = 'P0002'; END IF;
    v_original := v_runs->v_target_index;
    v_runs := jsonb_set(v_runs, ARRAY[v_target_index::text], v_original || p_command->'changes', false);
  ELSIF v_type = 'remove' THEN
    IF (p_command - ARRAY['type','runId']) <> '{}'::jsonb
       OR NOT (p_command ?& ARRAY['type','runId']) THEN
      RAISE EXCEPTION 'Invalid planned-run removal' USING ERRCODE = '22023';
    END IF;
    SELECT ordinality::integer - 1 INTO v_target_index
      FROM jsonb_array_elements(v_runs) WITH ORDINALITY AS item(value, ordinality)
      WHERE value->>'id' = p_command->>'runId';
    IF v_target_index IS NULL THEN RAISE EXCEPTION 'Planned run no longer exists' USING ERRCODE = 'P0002'; END IF;
    v_runs := v_runs - v_target_index;
    SELECT COALESCE(jsonb_agg(
      CASE WHEN value->>'runId' = p_command->>'runId'
        THEN jsonb_set(value, '{runId}', 'null'::jsonb, false) ELSE value END
      ORDER BY ordinality
    ), '[]'::jsonb) INTO v_breaks
      FROM jsonb_array_elements(v_breaks) WITH ORDINALITY AS item(value, ordinality);
  ELSIF v_type = 'move' THEN
    IF (p_command - ARRAY['type','runId','toIndex']) <> '{}'::jsonb
       OR NOT (p_command ?& ARRAY['type','runId','toIndex'])
       OR jsonb_typeof(p_command->'toIndex') IS DISTINCT FROM 'number'
       OR (p_command->>'toIndex') !~ '^[0-9]{1,2}$' THEN
      RAISE EXCEPTION 'Invalid planned-run move' USING ERRCODE = '22023';
    END IF;
    SELECT ordinality::integer - 1, value INTO v_target_index, v_run
      FROM jsonb_array_elements(v_runs) WITH ORDINALITY AS item(value, ordinality)
      WHERE value->>'id' = p_command->>'runId';
    IF v_target_index IS NULL THEN RAISE EXCEPTION 'Planned run no longer exists' USING ERRCODE = 'P0002'; END IF;
    IF (p_command->>'toIndex')::integer >= jsonb_array_length(v_runs) THEN
      RAISE EXCEPTION 'Planned-run position is invalid' USING ERRCODE = '22023';
    END IF;
    v_runs := v_runs - v_target_index;
    v_runs := jsonb_insert(v_runs, ARRAY[(p_command->>'toIndex')], v_run, false);
  ELSIF v_type = 'swap' THEN
    IF (p_command - ARRAY['type','firstRunId','secondRunId']) <> '{}'::jsonb
       OR NOT (p_command ?& ARRAY['type','firstRunId','secondRunId'])
       OR p_command->>'firstRunId' = p_command->>'secondRunId' THEN
      RAISE EXCEPTION 'Invalid planned-run swap' USING ERRCODE = '22023';
    END IF;
    SELECT ordinality::integer - 1 INTO v_first_index FROM jsonb_array_elements(v_runs)
      WITH ORDINALITY AS item(value, ordinality) WHERE value->>'id' = p_command->>'firstRunId';
    SELECT ordinality::integer - 1 INTO v_second_index FROM jsonb_array_elements(v_runs)
      WITH ORDINALITY AS item(value, ordinality) WHERE value->>'id' = p_command->>'secondRunId';
    IF v_first_index IS NULL OR v_second_index IS NULL THEN
      RAISE EXCEPTION 'A planned run no longer exists' USING ERRCODE = 'P0002';
    END IF;
    v_original := v_runs->v_first_index;
    v_runs := jsonb_set(v_runs, ARRAY[v_first_index::text], v_runs->v_second_index, false);
    v_runs := jsonb_set(v_runs, ARRAY[v_second_index::text], v_original, false);
  ELSIF v_type = 'breaks' THEN
    IF (p_command - ARRAY['type','breaks']) <> '{}'::jsonb
       OR NOT (p_command ?& ARRAY['type','breaks']) THEN
      RAISE EXCEPTION 'Invalid schedule breaks' USING ERRCODE = '22023';
    END IF;
    v_breaks := p_command->'breaks';
  ELSIF v_type = 'merge-import' THEN
    IF (p_command - ARRAY['type','runs']) <> '{}'::jsonb
       OR NOT (p_command ?& ARRAY['type','runs'])
       OR jsonb_typeof(p_command->'runs') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Invalid reviewed schedule import' USING ERRCODE = '22023';
    END IF;
    IF jsonb_array_length(p_command->'runs') > 100 THEN
      RAISE EXCEPTION 'Invalid reviewed schedule import' USING ERRCODE = '22023';
    END IF;
    FOR v_run IN SELECT value FROM jsonb_array_elements(p_command->'runs') LOOP
      SELECT ordinality::integer - 1 INTO v_target_index
        FROM jsonb_array_elements(v_runs) WITH ORDINALITY AS item(value, ordinality)
        WHERE value->>'id' = v_run->>'id';
      IF v_target_index IS NULL THEN
        IF jsonb_array_length(v_runs) >= 100 THEN
          RAISE EXCEPTION 'The schedule cannot contain more than 100 planned runs' USING ERRCODE = '22023';
        END IF;
        v_runs := v_runs || jsonb_build_array(v_run);
      ELSE
        v_runs := jsonb_set(v_runs, ARRAY[v_target_index::text], v_run, false);
      END IF;
    END LOOP;
  ELSE
    RAISE EXCEPTION 'Unsupported production schedule command' USING ERRCODE = '22023';
  END IF;
  IF NOT v2.validate_production_schedule_runs(p_facility_id, v_runs)
     OR NOT v2.validate_production_schedule_breaks(v_runs, v_breaks) THEN
    RAISE EXCEPTION 'Schedule references or values are invalid' USING ERRCODE = '22023';
  END IF;
  IF v_start !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
    RAISE EXCEPTION 'Production start time is invalid' USING ERRCODE = '22023';
  END IF;
  INSERT INTO v2.production_schedules(
    facility_id, production_date, revision, plan, time_zone, updated_by, updated_at
  ) VALUES (
    p_facility_id, p_date, v_revision + 1,
    jsonb_build_object('productionStartTime',v_start,'runs',v_runs,'breaks',v_breaks),
    'America/Chicago', p_actor_id, v_now
  )
  ON CONFLICT (facility_id, production_date) DO UPDATE
    SET revision = EXCLUDED.revision,
        plan = EXCLUDED.plan,
        time_zone = EXCLUDED.time_zone,
        updated_by = EXCLUDED.updated_by,
        updated_at = EXCLUDED.updated_at;
  v_response := jsonb_build_object(
    'outcome', 'accepted', 'replayed', false,
    'schedule', v2.get_production_schedule(p_facility_id, p_date)
  );
  INSERT INTO v2.production_schedule_receipts(
    facility_id, actor_id, request_id, request_hash, response, created_at
  ) VALUES (
    p_facility_id, p_actor_id, p_request_id, p_request_hash,
    jsonb_build_object('outcome', 'accepted'), v_now
  );
  RETURN v_response;
END
$$;

REVOKE ALL ON FUNCTION v2.schedule_default_start_time(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION v2.validate_production_schedule_runs(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION v2.validate_production_schedule_breaks(jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION v2.get_production_schedule(uuid, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION v2.list_schedule_run_templates(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION v2.apply_production_schedule_command(uuid, uuid, date, text, text, bigint, jsonb) FROM PUBLIC;

COMMENT ON TABLE v2.production_schedules IS
  'Server-owned, date-scoped production plans; these rows are separate from live run lifecycle records.';
COMMENT ON TABLE v2.production_schedule_receipts IS
  'Append-only idempotency receipts for schedule commands, scoped to facility, actor, and request ID.';

COMMIT;
