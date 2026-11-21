BEGIN;

CREATE TABLE v2.manager_action_events (
  facility_id uuid NOT NULL REFERENCES v2.facility_scope (facility_id) ON DELETE RESTRICT,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  action_key text NOT NULL CHECK (
    length(action_key) BETWEEN 1 AND 180
    AND action_key ~ '^run-pause:[0-9a-f-]{36}:[1-9][0-9]{0,15}$'
  ),
  revision bigint NOT NULL CHECK (revision BETWEEN 1 AND 9007199254740991),
  actor_id uuid NOT NULL REFERENCES v2.staff_accounts (id) ON DELETE RESTRICT,
  request_id text NOT NULL CHECK (length(btrim(request_id)) BETWEEN 1 AND 200),
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('acknowledged', 'resolved', 'unavailable-evidence')),
  note text NOT NULL CHECK (length(btrim(note)) BETWEEN 3 AND 500 AND note !~ '[[:cntrl:]]'),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (facility_id, id),
  UNIQUE (facility_id, action_key, revision),
  UNIQUE (facility_id, actor_id, request_id)
);

CREATE INDEX manager_action_events_latest
  ON v2.manager_action_events (facility_id, action_key, revision DESC);

CREATE FUNCTION v2.prevent_manager_action_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, v2
AS $$
BEGIN
  RAISE EXCEPTION 'Manager action history is append-only'
    USING ERRCODE = '55000';
END
$$;

CREATE TRIGGER manager_action_events_append_only
  BEFORE UPDATE OR DELETE ON v2.manager_action_events
  FOR EACH ROW EXECUTE FUNCTION v2.prevent_manager_action_event_mutation();

CREATE FUNCTION v2.actor_can_review_operations(p_actor_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM v2.staff_accounts AS staff
    JOIN v2.user_roles AS user_role ON user_role.user_id = staff.id
    JOIN v2.roles AS role ON role.name = user_role.role_name
    WHERE staff.id = p_actor_id
      AND staff.disabled = false
      AND role.capabilities ? 'review-incidents'
  )
$$;

CREATE FUNCTION v2.get_manager_operations_snapshot(
  p_facility_id uuid,
  p_actor_id uuid,
  p_from_date date,
  p_to_date date,
  p_limit integer,
  p_before_created_at timestamptz DEFAULT NULL,
  p_before_run_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_from timestamptz;
  v_until timestamptz;
  v_runs jsonb;
  v_has_more boolean;
  v_next_cursor jsonb := NULL;
  v_summary jsonb;
  v_active_runs jsonb;
  v_pause_trend jsonb;
  v_event_patterns jsonb;
  v_actions jsonb;
  v_unknown_links integer;
  v_unknown_link_runs integer;
  v_run_event_count bigint;
  v_qc_event_count bigint;
  v_inventory_event_count bigint;
  v_import_count bigint;
  v_schedule_count bigint;
  v_action_count bigint;
  v_active_run_count bigint;
  v_runs_with_case_output bigint;
  v_runs_without_case_output bigint;
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL
     OR p_from_date IS NULL OR p_to_date IS NULL
     OR p_to_date < p_from_date OR p_to_date - p_from_date > 89
     OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100
     OR ((p_before_created_at IS NULL) <> (p_before_run_id IS NULL)) THEN
    RAISE EXCEPTION 'Invalid manager operations request' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM v2.facility_scope
    WHERE singleton AND facility_id = p_facility_id
  ) THEN
    RAISE EXCEPTION 'Manager operations scope is unavailable' USING ERRCODE = 'P0002';
  END IF;
  IF NOT v2.actor_can_review_operations(p_actor_id) THEN
    RAISE EXCEPTION 'Manager operations are not authorized' USING ERRCODE = '42501';
  END IF;

  v_from := p_from_date::timestamp AT TIME ZONE 'America/Chicago';
  v_until := (p_to_date + 1)::timestamp AT TIME ZONE 'America/Chicago';

  WITH page AS (
    SELECT r.id, r.created_at, r.status, r.revision, r.started_at, r.paused_at,
           r.completed_at, r.setup_snapshot
    FROM v2.runs AS r
    WHERE r.facility_id = p_facility_id
      AND r.created_at >= v_from AND r.created_at < v_until
      AND (p_before_created_at IS NULL OR (r.created_at, r.id) < (p_before_created_at, p_before_run_id))
    ORDER BY r.created_at DESC, r.id DESC
    LIMIT p_limit + 1
  ),
  visible AS (
    SELECT * FROM page
    ORDER BY created_at DESC, id DESC
    LIMIT p_limit
  )
  SELECT
    (SELECT count(*) > p_limit FROM page),
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'runId', visible.id,
        'label', visible.setup_snapshot->>'label',
        'status', visible.status,
        'revision', visible.revision,
        'targetCases', NULLIF(visible.setup_snapshot->>'targetCases', '')::bigint,
        'productCode', visible.setup_snapshot->>'productCode',
        'productionSetupCode', visible.setup_snapshot->>'productionSetupCode',
        'createdAt', visible.created_at,
        'startedAt', visible.started_at,
        'pausedAt', visible.paused_at,
        'completedAt', visible.completed_at
      ) ORDER BY visible.created_at DESC, visible.id DESC)
      FROM visible
    ), '[]'::jsonb),
    CASE WHEN (SELECT count(*) > p_limit FROM page) THEN (
      SELECT jsonb_build_object('createdAt', last_row.created_at, 'runId', last_row.id)
      FROM visible AS last_row
      ORDER BY last_row.created_at ASC, last_row.id ASC
      LIMIT 1
    ) ELSE NULL END
  INTO v_has_more, v_runs, v_next_cursor;

  SELECT jsonb_build_object(
    'runsCreated', count(*),
    'planned', count(*) FILTER (WHERE r.status = 'planned'),
    'running', count(*) FILTER (WHERE r.status = 'running'),
    'paused', count(*) FILTER (WHERE r.status = 'paused'),
    'completed', count(*) FILTER (WHERE r.status = 'completed'),
    'targetCases', COALESCE(sum(NULLIF(r.setup_snapshot->>'targetCases', '')::numeric), 0),
    'casesProduced', sum(CASE WHEN line.progress ? 'casesProduced'
      THEN NULLIF(line.progress->>'casesProduced', '')::numeric END),
    'runsWithRecordedCaseOutput', count(*) FILTER (WHERE line.progress ? 'casesProduced'),
    'runsWithoutRecordedCaseOutput', count(*) FILTER (WHERE NOT COALESCE(line.progress ? 'casesProduced', false)),
    'averageRunMinutes', round(avg(EXTRACT(EPOCH FROM (r.completed_at - r.started_at)) / 60.0)
      FILTER (WHERE r.completed_at IS NOT NULL AND r.started_at IS NOT NULL), 1)
  )
  INTO v_summary
  FROM v2.runs AS r
  LEFT JOIN v2.run_station_progress AS line
    ON line.facility_id = r.facility_id AND line.run_id = r.id AND line.station_key = 'line'
  WHERE r.facility_id = p_facility_id
    AND r.created_at >= v_from AND r.created_at < v_until;
  v_runs_with_case_output := COALESCE((v_summary->>'runsWithRecordedCaseOutput')::bigint, 0);
  v_runs_without_case_output := COALESCE((v_summary->>'runsWithoutRecordedCaseOutput')::bigint, 0);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'runId', active.id,
    'label', active.setup_snapshot->>'label',
    'status', active.status,
    'updatedAt', active.updated_at,
    'targetCases', NULLIF(active.setup_snapshot->>'targetCases', '')::bigint
  ) ORDER BY active.updated_at DESC, active.id DESC), '[]'::jsonb)
  INTO v_active_runs
  FROM (
    SELECT r.id, r.setup_snapshot, r.status, r.updated_at
    FROM v2.runs AS r
    WHERE r.facility_id = p_facility_id AND r.status IN ('running', 'paused')
    ORDER BY r.updated_at DESC, r.id DESC
    LIMIT 100
  ) AS active;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'date', day.day::date,
    'pauseMinutes', round(COALESCE(pauses.minutes, 0)::numeric, 1)
  ) ORDER BY day.day), '[]'::jsonb)
  INTO v_pause_trend
  FROM generate_series(p_from_date, p_to_date, interval '1 day') AS day(day)
  LEFT JOIN LATERAL (
    SELECT sum(GREATEST(
      0,
      EXTRACT(EPOCH FROM (
        LEAST(COALESCE(p.resumed_at, statement_timestamp()), ((day.day::date + 1)::timestamp AT TIME ZONE 'America/Chicago'))
        - GREATEST(p.paused_at, (day.day::date::timestamp AT TIME ZONE 'America/Chicago'))
      )) / 60.0
    )) AS minutes
    FROM v2.run_pause_intervals AS p
    WHERE p.facility_id = p_facility_id
      AND p.paused_at < ((day.day::date + 1)::timestamp AT TIME ZONE 'America/Chicago')
      AND COALESCE(p.resumed_at, statement_timestamp()) > (day.day::date::timestamp AT TIME ZONE 'America/Chicago')
  ) AS pauses ON true;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'eventType', patterns.event_type,
    'count', patterns.event_count
  ) ORDER BY patterns.event_count DESC, patterns.event_type), '[]'::jsonb)
  INTO v_event_patterns
  FROM (
    SELECT event.event_type, count(*) AS event_count
    FROM v2.run_events AS event
    WHERE event.facility_id = p_facility_id
      AND event.occurred_at >= v_from AND event.occurred_at < v_until
    GROUP BY event.event_type
    ORDER BY count(*) DESC, event.event_type
    LIMIT 12
  ) AS patterns;

  SELECT count(*) INTO v_run_event_count
  FROM v2.run_events AS event
  WHERE event.facility_id = p_facility_id
    AND event.occurred_at >= v_from AND event.occurred_at < v_until;

  SELECT count(*), count(DISTINCT r.id)
  INTO v_unknown_links, v_unknown_link_runs
  FROM v2.runs AS r
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(r.setup_snapshot->'productionPlan'->'recipes') = 'array'
      THEN r.setup_snapshot->'productionPlan'->'recipes' ELSE '[]'::jsonb END
  ) AS recipe(value)
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(recipe.value->'ingredients') = 'array'
      THEN recipe.value->'ingredients' ELSE '[]'::jsonb END
  ) AS ingredient(value)
  WHERE r.facility_id = p_facility_id
    AND r.created_at >= v_from AND r.created_at < v_until
    AND ingredient.value->'ingredientSnapshot'->>'status' = 'unknown';

  WITH candidate_actions AS (
    SELECT
      'run-pause:' || event.run_id::text || ':' || event.revision::text AS action_key,
      event.run_id,
      event.revision AS source_revision,
      event.occurred_at,
      run.setup_snapshot->>'label' AS run_label,
      latest.revision AS action_revision,
      latest.status,
      latest.actor_id,
      latest.note,
      latest.occurred_at AS action_at
    FROM v2.run_events AS event
    JOIN v2.runs AS run
      ON run.facility_id = event.facility_id AND run.id = event.run_id
    LEFT JOIN LATERAL (
      SELECT action.revision, action.status, action.actor_id, action.note, action.occurred_at
      FROM v2.manager_action_events AS action
      WHERE action.facility_id = p_facility_id
        AND action.action_key = 'run-pause:' || event.run_id::text || ':' || event.revision::text
      ORDER BY action.revision DESC
      LIMIT 1
    ) AS latest ON true
    WHERE event.facility_id = p_facility_id
      AND event.event_type = 'run.paused'
      AND event.occurred_at >= v_from AND event.occurred_at < v_until
    ORDER BY CASE COALESCE(latest.status, 'pending')
      WHEN 'pending' THEN 0 WHEN 'acknowledged' THEN 1 WHEN 'unavailable-evidence' THEN 2 ELSE 3 END,
      event.occurred_at DESC
    LIMIT 100
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'actionKey', action_key,
    'runId', run_id,
    'runLabel', run_label,
    'title', 'Review paused run',
    'status', COALESCE(status, 'pending'),
    'revision', COALESCE(action_revision, 0),
    'sourceRevision', source_revision,
    'occurredAt', occurred_at,
    'lastAction', CASE WHEN action_revision IS NULL THEN NULL ELSE jsonb_build_object(
      'status', status, 'actorId', actor_id, 'note', note, 'occurredAt', action_at
    ) END
  ) ORDER BY CASE COALESCE(status, 'pending')
      WHEN 'pending' THEN 0 WHEN 'acknowledged' THEN 1 WHEN 'unavailable-evidence' THEN 2 ELSE 3 END,
      occurred_at DESC), '[]'::jsonb)
  INTO v_actions
  FROM candidate_actions;

  SELECT count(*) INTO v_action_count
  FROM v2.run_events AS event
  WHERE event.facility_id = p_facility_id
    AND event.event_type = 'run.paused'
    AND event.occurred_at >= v_from AND event.occurred_at < v_until;

  SELECT count(*) INTO v_active_run_count
  FROM v2.runs AS run
  WHERE run.facility_id = p_facility_id AND run.status IN ('running', 'paused');

  SELECT count(*) INTO v_qc_event_count
  FROM v2.qc_events AS event
  WHERE event.facility_id = p_facility_id
    AND event.occurred_at >= v_from AND event.occurred_at < v_until;

  SELECT count(*) INTO v_inventory_event_count
  FROM v2.inventory_movements AS movement
  WHERE movement.facility_id = p_facility_id
    AND movement.occurred_at >= v_from AND movement.occurred_at < v_until;

  SELECT
    (SELECT count(*) FROM v2.setup_imports AS item
      WHERE item.facility_id = p_facility_id AND item.created_at >= v_from AND item.created_at < v_until)
    + (SELECT count(*) FROM v2.setup_catalog_imports AS item
      WHERE item.facility_id = p_facility_id AND item.created_at >= v_from AND item.created_at < v_until)
  INTO v_import_count;

  SELECT count(*) INTO v_schedule_count
  FROM v2.production_schedules AS schedule
  WHERE schedule.facility_id = p_facility_id
    AND schedule.updated_at >= v_from AND schedule.updated_at < v_until;

  RETURN jsonb_build_object(
    'timeZone', 'America/Chicago',
    'fromDate', p_from_date,
    'toDate', p_to_date,
    'generatedAt', statement_timestamp(),
    'runs', jsonb_build_object('items', v_runs, 'hasMore', v_has_more, 'nextCursor', v_next_cursor),
    'summary', v_summary,
    'activeRuns', v_active_runs,
    'pauseTrend', v_pause_trend,
    'eventPatterns', v_event_patterns,
    'actions', v_actions,
    'dataHealth', jsonb_build_object(
      'unknownIngredientReferences', v_unknown_links,
      'runsWithUnknownIngredientReferences', v_unknown_link_runs,
      'interpretation', 'Unknown means the run snapshot did not establish a reference; it is not proof of incorrect or corrupted data.'
    ),
    'coverage', jsonb_build_object(
      'runs', jsonb_build_object('status', 'available', 'records', (v_summary->>'runsCreated')::bigint),
      'runEvents', jsonb_build_object('status', 'available', 'records', v_run_event_count),
      'pauseIntervals', jsonb_build_object('status', 'available'),
      'operationalReports', jsonb_build_object(
        'status', 'available',
        'records', (v_summary->>'runsCreated')::bigint,
        'note', 'Generated on demand from canonical run and station records; V2 report exports are not retained as separate records.'
      ),
      'shiftHandoff', jsonb_build_object(
        'status', 'available',
        'records', v_active_run_count,
        'note', 'Current active and paused runs only; V2 does not retain archived handoff digests.'
      ),
      'managerActions', jsonb_build_object(
        'status', CASE WHEN v_action_count > 100 THEN 'partial' ELSE 'available' END,
        'records', v_action_count,
        'note', CASE WHEN v_action_count > 100
          THEN 'The action queue is prioritized and bounded to 100 entries; narrow the date range to review a smaller slice.'
          ELSE 'Run-pause follow-ups and attributed manager status history are available for this range.'
        END
      ),
      'actualCaseOutput', jsonb_build_object(
        'status', CASE
          WHEN (v_summary->>'runsCreated')::bigint = 0 OR v_runs_without_case_output = 0 THEN 'available'
          WHEN v_runs_with_case_output = 0 THEN 'unavailable'
          ELSE 'partial'
        END,
        'records', v_runs_with_case_output,
        'note', 'Counts come from recorded line-station casesProduced; runs without that value are not treated as zero.'
      ),
      'runInsights', jsonb_build_object(
        'status', 'available',
        'records', v_run_event_count,
        'note', 'Descriptive run totals, pause intervals, and event-type counts only; no setup changes are recommended or applied.'
      ),
      'incidentPatterns', jsonb_build_object(
        'status', 'unavailable',
        'note', 'V2 does not persist a canonical incident record, so incident patterns cannot be reported.'
      ),
      'dataHealth', jsonb_build_object(
        'status', 'partial',
        'records', v_unknown_links,
        'note', 'Only unknown ingredient references in frozen run snapshots are checked here; this is not a full profile or master-data health audit.'
      ),
      'referenceLinks', jsonb_build_object(
        'status', 'partial',
        'records', v_unknown_links,
        'note', 'Reference findings are limited to ingredient links captured in run snapshots.'
      ),
      'qcHistory', jsonb_build_object('status', 'available', 'records', v_qc_event_count),
      'inventoryHistory', jsonb_build_object('status', 'available', 'records', v_inventory_event_count),
      'importHistory', jsonb_build_object('status', 'available', 'records', v_import_count),
      'scheduleHistory', jsonb_build_object(
        'status', 'partial', 'records', v_schedule_count,
        'note', 'Only the current schedule revision is retained here; this is not a complete schedule change history.'
      ),
      'syncConflicts', jsonb_build_object(
        'status', 'unavailable',
        'note', 'V2 does not persist sync-conflict records, so no conflict count or incident pattern can be reported.'
      )
    )
  );
END
$$;

CREATE FUNCTION v2.list_manager_operation_events(
  p_facility_id uuid,
  p_actor_id uuid,
  p_from_date date,
  p_to_date date,
  p_limit integer,
  p_run_id uuid DEFAULT NULL,
  p_before_at timestamptz DEFAULT NULL,
  p_before_run_id uuid DEFAULT NULL,
  p_before_revision bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_from timestamptz;
  v_until timestamptz;
  v_has_more boolean;
  v_events jsonb;
  v_next_cursor jsonb := NULL;
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL
     OR p_from_date IS NULL OR p_to_date IS NULL
     OR p_to_date < p_from_date OR p_to_date - p_from_date > 89
     OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100
      OR ((p_before_at IS NULL) <> (p_before_run_id IS NULL))
      OR ((p_before_at IS NULL) <> (p_before_revision IS NULL))
      OR (p_before_revision IS NOT NULL AND p_before_revision < 0) THEN
    RAISE EXCEPTION 'Invalid manager event request' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM v2.facility_scope
    WHERE singleton AND facility_id = p_facility_id
  ) THEN
    RAISE EXCEPTION 'Manager event scope is unavailable' USING ERRCODE = 'P0002';
  END IF;
  IF NOT v2.actor_can_review_operations(p_actor_id) THEN
    RAISE EXCEPTION 'Manager operations are not authorized' USING ERRCODE = '42501';
  END IF;
  IF p_run_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM v2.runs WHERE facility_id = p_facility_id AND id = p_run_id
  ) THEN
    RAISE EXCEPTION 'The selected run is unavailable' USING ERRCODE = 'P0002';
  END IF;

  v_from := p_from_date::timestamp AT TIME ZONE 'America/Chicago';
  v_until := (p_to_date + 1)::timestamp AT TIME ZONE 'America/Chicago';
  WITH page AS (
    SELECT event.revision, event.run_id, event.actor_id, event.event_type, event.occurred_at,
           run.setup_snapshot->>'label' AS run_label
    FROM v2.run_events AS event
    JOIN v2.runs AS run
      ON run.facility_id = event.facility_id AND run.id = event.run_id
    WHERE event.facility_id = p_facility_id
      AND event.occurred_at >= v_from AND event.occurred_at < v_until
      AND (p_run_id IS NULL OR event.run_id = p_run_id)
      AND (p_before_at IS NULL OR (event.occurred_at, event.run_id, event.revision)
        < (p_before_at, p_before_run_id, p_before_revision))
    ORDER BY event.occurred_at DESC, event.run_id DESC, event.revision DESC
    LIMIT p_limit + 1
  ),
  visible AS (
    SELECT * FROM page
    ORDER BY occurred_at DESC, run_id DESC, revision DESC
    LIMIT p_limit
  )
  SELECT
    (SELECT count(*) > p_limit FROM page),
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'eventId', visible.run_id::text || ':' || visible.revision::text,
      'runId', visible.run_id,
      'runLabel', visible.run_label,
      'actorId', visible.actor_id,
      'eventType', visible.event_type,
      'occurredAt', visible.occurred_at
    ) ORDER BY visible.occurred_at DESC, visible.run_id DESC, visible.revision DESC) FROM visible), '[]'::jsonb),
    CASE WHEN (SELECT count(*) > p_limit FROM page) THEN (
      SELECT jsonb_build_object(
        'occurredAt', last_row.occurred_at,
        'runId', last_row.run_id,
        'revision', last_row.revision
      )
      FROM visible AS last_row
      ORDER BY last_row.occurred_at ASC, last_row.run_id ASC, last_row.revision ASC
      LIMIT 1
    ) ELSE NULL END
  INTO v_has_more, v_events, v_next_cursor;

  RETURN jsonb_build_object(
    'events', v_events,
    'hasMore', v_has_more,
    'nextCursor', v_next_cursor,
    'fromDate', p_from_date,
    'toDate', p_to_date,
    'timeZone', 'America/Chicago'
  );
END
$$;

CREATE FUNCTION v2.record_manager_action_status(
  p_facility_id uuid,
  p_actor_id uuid,
  p_action_key text,
  p_expected_revision bigint,
  p_request_id text,
  p_request_hash text,
  p_status text,
  p_note text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_existing v2.manager_action_events%ROWTYPE;
  v_latest v2.manager_action_events%ROWTYPE;
  v_run_id uuid;
  v_source_revision bigint;
  v_next_revision bigint;
  v_event v2.manager_action_events%ROWTYPE;
  v_allowed boolean;
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL
     OR p_action_key IS NULL OR length(p_action_key) > 180
     OR p_action_key !~ '^run-pause:[0-9a-f-]{36}:[1-9][0-9]{0,15}$'
     OR p_expected_revision IS NULL OR p_expected_revision < 0
     OR p_request_id IS NULL OR length(btrim(p_request_id)) NOT BETWEEN 1 AND 200
     OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$'
     OR p_status IS NULL OR p_status NOT IN ('acknowledged', 'resolved', 'unavailable-evidence')
     OR p_note IS NULL OR length(btrim(p_note)) NOT BETWEEN 3 AND 500
     OR p_note ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'Invalid manager action status request' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM v2.facility_scope
    WHERE singleton AND facility_id = p_facility_id
  ) THEN
    RAISE EXCEPTION 'Manager action scope is unavailable' USING ERRCODE = 'P0002';
  END IF;
  IF NOT v2.actor_can_review_operations(p_actor_id) THEN
    RAISE EXCEPTION 'Manager operations are not authorized' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_facility_id::text || ':' || p_action_key, 0));
  SELECT * INTO v_existing
  FROM v2.manager_action_events
  WHERE facility_id = p_facility_id AND actor_id = p_actor_id AND request_id = p_request_id;
  IF FOUND THEN
    IF v_existing.request_hash <> p_request_hash THEN
      RAISE EXCEPTION 'Request ID was reused with different manager action details'
        USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object('replayed', true, 'event', jsonb_build_object(
      'id', v_existing.id, 'actionKey', v_existing.action_key, 'revision', v_existing.revision,
      'status', v_existing.status, 'actorId', v_existing.actor_id, 'note', v_existing.note,
      'occurredAt', v_existing.occurred_at
    ));
  END IF;

  v_run_id := substring(p_action_key FROM '^run-pause:([0-9a-f-]{36}):')::uuid;
  v_source_revision := substring(p_action_key FROM ':([1-9][0-9]{0,15})$')::bigint;
  IF NOT EXISTS (
    SELECT 1 FROM v2.run_events AS source
    WHERE source.facility_id = p_facility_id
      AND source.run_id = v_run_id
      AND source.revision = v_source_revision
      AND source.event_type = 'run.paused'
  ) THEN
    RAISE EXCEPTION 'The action evidence is unavailable' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_latest
  FROM v2.manager_action_events
  WHERE facility_id = p_facility_id AND action_key = p_action_key
  ORDER BY revision DESC
  LIMIT 1;
  IF FOUND THEN
    IF v_latest.revision <> p_expected_revision THEN
      RAISE EXCEPTION 'The manager action changed after it was opened' USING ERRCODE = '40001';
    END IF;
    v_allowed := CASE v_latest.status
      WHEN 'acknowledged' THEN p_status IN ('resolved', 'unavailable-evidence')
      WHEN 'resolved' THEN p_status = 'acknowledged'
      WHEN 'unavailable-evidence' THEN p_status IN ('acknowledged', 'resolved')
      ELSE false
    END;
  ELSE
    IF p_expected_revision <> 0 THEN
      RAISE EXCEPTION 'The manager action changed after it was opened' USING ERRCODE = '40001';
    END IF;
    v_allowed := p_status IN ('acknowledged', 'resolved', 'unavailable-evidence');
  END IF;
  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Choose a valid next manager action status' USING ERRCODE = '22023';
  END IF;

  v_next_revision := COALESCE(v_latest.revision, 0) + 1;
  INSERT INTO v2.manager_action_events (
    facility_id, action_key, revision, actor_id, request_id, request_hash, status, note
  ) VALUES (
    p_facility_id, p_action_key, v_next_revision, p_actor_id, p_request_id,
    p_request_hash, p_status, btrim(p_note)
  ) RETURNING * INTO v_event;

  RETURN jsonb_build_object('replayed', false, 'event', jsonb_build_object(
    'id', v_event.id, 'actionKey', v_event.action_key, 'revision', v_event.revision,
    'status', v_event.status, 'actorId', v_event.actor_id, 'note', v_event.note,
    'occurredAt', v_event.occurred_at
  ));
END
$$;

REVOKE ALL ON FUNCTION v2.actor_can_review_operations(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION v2.get_manager_operations_snapshot(uuid, uuid, date, date, integer, timestamptz, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION v2.list_manager_operation_events(uuid, uuid, date, date, integer, uuid, timestamptz, uuid, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION v2.record_manager_action_status(uuid, uuid, text, bigint, text, text, text, text) FROM PUBLIC;

COMMIT;
