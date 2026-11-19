BEGIN;

CREATE TABLE v2.die_default_settings (
  facility_id uuid NOT NULL,
  die_code text NOT NULL,
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  enabled boolean NOT NULL DEFAULT true,
  revision bigint NOT NULL CHECK (revision > 0),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (facility_id, die_code),
  FOREIGN KEY (facility_id, die_code)
    REFERENCES v2.setup_die_type_records (facility_id, code) ON DELETE RESTRICT,
  CHECK (
    v2.setup_catalog_object_size(data) = 9
    AND data ?& ARRAY[
      'crustsPerCycle','cycleSpeed','speedAdjustment','freezerTime','casesPerLayer',
      'preTunnelMin','postTunnelMin','pressOvenMin','frontlineMin'
    ]
    AND jsonb_typeof(data->'crustsPerCycle') = 'number'
    AND jsonb_typeof(data->'cycleSpeed') = 'number'
    AND jsonb_typeof(data->'speedAdjustment') = 'number'
    AND jsonb_typeof(data->'freezerTime') = 'number'
    AND jsonb_typeof(data->'casesPerLayer') = 'number'
    AND jsonb_typeof(data->'preTunnelMin') IN ('number','null')
    AND jsonb_typeof(data->'postTunnelMin') IN ('number','null')
    AND jsonb_typeof(data->'pressOvenMin') IN ('number','null')
    AND jsonb_typeof(data->'frontlineMin') IN ('number','null')
    AND (data->>'crustsPerCycle')::numeric BETWEEN 0 AND 100000
    AND (data->>'cycleSpeed')::numeric BETWEEN 0 AND 100000
    AND (data->>'speedAdjustment')::numeric BETWEEN 0 AND 100000
    AND (data->>'freezerTime')::numeric BETWEEN 0 AND 100000
    AND (data->>'casesPerLayer')::numeric BETWEEN 0 AND 100000
    AND (data->>'preTunnelMin' IS NULL OR (data->>'preTunnelMin')::numeric BETWEEN 0 AND 100000)
    AND (data->>'postTunnelMin' IS NULL OR (data->>'postTunnelMin')::numeric BETWEEN 0 AND 100000)
    AND (data->>'pressOvenMin' IS NULL OR (data->>'pressOvenMin')::numeric BETWEEN 0 AND 100000)
    AND (data->>'frontlineMin' IS NULL OR (data->>'frontlineMin')::numeric BETWEEN 0 AND 100000)
  )
);

CREATE TABLE v2.die_default_events (
  facility_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  die_code text NOT NULL,
  actor_id uuid NOT NULL,
  request_id text NOT NULL CHECK (length(btrim(request_id)) BETWEEN 1 AND 200),
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  action text NOT NULL CHECK (action IN ('created','updated','retired','re-enabled')),
  revision bigint NOT NULL CHECK (revision > 0),
  before_state jsonb,
  after_state jsonb NOT NULL CHECK (jsonb_typeof(after_state) = 'object'),
  result jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (facility_id, id),
  UNIQUE (facility_id, actor_id, request_id),
  FOREIGN KEY (facility_id, die_code)
    REFERENCES v2.setup_die_type_records (facility_id, code) ON DELETE RESTRICT
);

CREATE INDEX die_default_events_recent
  ON v2.die_default_events (facility_id, occurred_at DESC, id DESC);

CREATE TRIGGER die_default_events_append_only
  BEFORE UPDATE OR DELETE ON v2.die_default_events
  FOR EACH ROW EXECUTE FUNCTION v2.reject_immutable_row_mutation();

CREATE FUNCTION v2.list_die_defaults(p_facility_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
BEGIN
  IF p_facility_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM v2.facility_scope WHERE singleton AND facility_id = p_facility_id
  ) THEN
    RAISE EXCEPTION 'Invalid facility scope' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'code', die.code,
      'name', die.name,
      'status', CASE
        WHEN reviewed.die_code IS NULL THEN 'unreviewed'
        WHEN reviewed.enabled THEN 'active'
        ELSE 'disabled'
      END,
      'revision', COALESCE(reviewed.revision, 0),
      'defaults', CASE WHEN reviewed.die_code IS NULL THEN NULL ELSE reviewed.data END,
      'suggestedDefaults', CASE WHEN imported.code IS NULL THEN NULL ELSE jsonb_build_object(
        'crustsPerCycle', imported.data->'crusts_per_cycle',
        'cycleSpeed', imported.data->'cycle_speed',
        'speedAdjustment', imported.data->'speed_adjustment',
        'freezerTime', imported.data->'freezer_time',
        'casesPerLayer', imported.data->'cases_per_layer',
        'preTunnelMin', imported.data->'pre_tunnel_min',
        'postTunnelMin', imported.data->'post_tunnel_min',
        'pressOvenMin', imported.data->'press_oven_min',
        'frontlineMin', imported.data->'frontline_min'
      ) END
    ) ORDER BY lower(die.name), die.code)
    FROM v2.setup_die_type_records AS die
    LEFT JOIN v2.setup_die_default_records AS imported
      ON imported.facility_id = die.facility_id AND lower(imported.code) = lower(die.code)
    LEFT JOIN v2.die_default_settings AS reviewed
      ON reviewed.facility_id = die.facility_id AND lower(reviewed.die_code) = lower(die.code)
    WHERE die.facility_id = p_facility_id
  ), '[]'::jsonb);
END
$$;

CREATE FUNCTION v2.list_die_default_events(p_facility_id uuid, p_limit integer)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
BEGIN
  IF p_facility_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM v2.facility_scope WHERE singleton AND facility_id = p_facility_id
  ) THEN
    RAISE EXCEPTION 'Invalid facility scope' USING ERRCODE = '42501';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Invalid die default history request' USING ERRCODE = '22023';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', recent.id, 'dieCode', recent.die_code, 'actorId', recent.actor_id,
      'action', recent.action, 'revision', recent.revision,
      'before', recent.before_state, 'after', recent.after_state,
      'occurredAt', recent.occurred_at
    ) ORDER BY recent.occurred_at DESC, recent.id DESC)
    FROM (
      SELECT id, die_code, actor_id, action, revision, before_state, after_state, occurred_at
      FROM v2.die_default_events
      WHERE facility_id = p_facility_id
      ORDER BY occurred_at DESC, id DESC
      LIMIT p_limit
    ) AS recent
  ), '[]'::jsonb);
END
$$;

CREATE FUNCTION v2.save_die_default(
  p_facility_id uuid,
  p_actor_id uuid,
  p_request_id text,
  p_request_hash text,
  p_die_code text,
  p_expected_revision bigint,
  p_data jsonb,
  p_enabled boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_existing_event v2.die_default_events%ROWTYPE;
  v_existing v2.die_default_settings%ROWTYPE;
  v_die_code text;
  v_revision bigint;
  v_action text;
  v_before jsonb;
  v_after jsonb;
  v_result jsonb;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL OR p_die_code IS NULL
     OR p_expected_revision IS NULL OR p_expected_revision < 0
     OR p_request_id IS NULL OR length(btrim(p_request_id)) NOT BETWEEN 1 AND 200
     OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$'
     OR p_enabled IS NULL
     OR NOT EXISTS (SELECT 1 FROM v2.facility_scope WHERE singleton AND facility_id = p_facility_id)
     OR jsonb_typeof(p_data) <> 'object'
     OR v2.setup_catalog_object_size(p_data) <> 9
     OR NOT (p_data ?& ARRAY[
       'crustsPerCycle','cycleSpeed','speedAdjustment','freezerTime','casesPerLayer',
       'preTunnelMin','postTunnelMin','pressOvenMin','frontlineMin'
     ])
     OR EXISTS (
       SELECT 1 FROM jsonb_object_keys(p_data) AS item(key)
       WHERE item.key <> ALL (ARRAY[
         'crustsPerCycle','cycleSpeed','speedAdjustment','freezerTime','casesPerLayer',
         'preTunnelMin','postTunnelMin','pressOvenMin','frontlineMin'
       ])
     )
     OR jsonb_typeof(p_data->'crustsPerCycle') <> 'number'
     OR jsonb_typeof(p_data->'cycleSpeed') <> 'number'
     OR jsonb_typeof(p_data->'speedAdjustment') <> 'number'
     OR jsonb_typeof(p_data->'freezerTime') <> 'number'
     OR jsonb_typeof(p_data->'casesPerLayer') <> 'number'
     OR jsonb_typeof(p_data->'preTunnelMin') NOT IN ('number','null')
     OR jsonb_typeof(p_data->'postTunnelMin') NOT IN ('number','null')
     OR jsonb_typeof(p_data->'pressOvenMin') NOT IN ('number','null')
     OR jsonb_typeof(p_data->'frontlineMin') NOT IN ('number','null')
     OR (p_data->>'crustsPerCycle')::numeric NOT BETWEEN 0 AND 100000
     OR (p_data->>'cycleSpeed')::numeric NOT BETWEEN 0 AND 100000
     OR (p_data->>'speedAdjustment')::numeric NOT BETWEEN 0 AND 100000
     OR (p_data->>'freezerTime')::numeric NOT BETWEEN 0 AND 100000
     OR (p_data->>'casesPerLayer')::numeric NOT BETWEEN 0 AND 100000
     OR (p_data->>'preTunnelMin' IS NOT NULL AND (p_data->>'preTunnelMin')::numeric NOT BETWEEN 0 AND 100000)
     OR (p_data->>'postTunnelMin' IS NOT NULL AND (p_data->>'postTunnelMin')::numeric NOT BETWEEN 0 AND 100000)
     OR (p_data->>'pressOvenMin' IS NOT NULL AND (p_data->>'pressOvenMin')::numeric NOT BETWEEN 0 AND 100000)
     OR (p_data->>'frontlineMin' IS NOT NULL AND (p_data->>'frontlineMin')::numeric NOT BETWEEN 0 AND 100000) THEN
    RAISE EXCEPTION 'Invalid die default request' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_facility_id::text || ':die-default:' || lower(p_die_code), 0
  ));
  SELECT * INTO v_existing_event FROM v2.die_default_events
  WHERE facility_id = p_facility_id AND actor_id = p_actor_id AND request_id = p_request_id
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing_event.request_hash <> p_request_hash OR v_existing_event.die_code <> p_die_code THEN
      RAISE EXCEPTION 'Die default request ID was reused with different details' USING ERRCODE = '22023';
    END IF;
    RETURN v_existing_event.result || jsonb_build_object('replayed', true);
  END IF;
  SELECT code INTO v_die_code FROM v2.setup_die_type_records
  WHERE facility_id = p_facility_id AND lower(code) = lower(p_die_code)
  FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Die type is not available' USING ERRCODE = '23503'; END IF;

  SELECT * INTO v_existing FROM v2.die_default_settings
  WHERE facility_id = p_facility_id AND lower(die_code) = lower(v_die_code)
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.revision <> p_expected_revision THEN
      RAISE EXCEPTION 'Die defaults changed while being edited' USING ERRCODE = '40001';
    END IF;
    v_revision := v_existing.revision + 1;
    v_before := jsonb_build_object(
      'defaults', v_existing.data, 'enabled', v_existing.enabled, 'revision', v_existing.revision
    );
    v_action := CASE
      WHEN v_existing.enabled AND NOT p_enabled THEN 'retired'
      WHEN NOT v_existing.enabled AND p_enabled THEN 're-enabled'
      ELSE 'updated'
    END;
    UPDATE v2.die_default_settings
    SET data = p_data, enabled = p_enabled, revision = v_revision,
        updated_by = p_actor_id, updated_at = v_now
    WHERE facility_id = p_facility_id AND die_code = v_existing.die_code;
  ELSE
    IF p_expected_revision <> 0 THEN
      RAISE EXCEPTION 'Die defaults changed while being edited' USING ERRCODE = '40001';
    END IF;
    v_revision := 1;
    v_action := 'created';
    INSERT INTO v2.die_default_settings (
      facility_id, die_code, data, enabled, revision, created_by, updated_by, created_at, updated_at
    ) VALUES (
      p_facility_id, v_die_code, p_data, p_enabled, v_revision, p_actor_id, p_actor_id, v_now, v_now
    );
  END IF;
  v_after := jsonb_build_object('defaults', p_data, 'enabled', p_enabled, 'revision', v_revision);
  v_result := jsonb_build_object(
    'outcome', v_action, 'dieCode', v_die_code, 'revision', v_revision,
    'status', CASE WHEN p_enabled THEN 'active' ELSE 'disabled' END,
    'defaults', p_data, 'replayed', false
  );
  INSERT INTO v2.die_default_events (
    facility_id, die_code, actor_id, request_id, request_hash, action,
    revision, before_state, after_state, result, occurred_at
  ) VALUES (
    p_facility_id, v_die_code, p_actor_id, p_request_id, p_request_hash,
    v_action, v_revision, v_before, v_after, v_result, v_now
  );
  RETURN v_result;
END
$$;

CREATE OR REPLACE FUNCTION v2.list_run_products(p_facility_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_warehouse jsonb;
  v_products jsonb;
BEGIN
  IF p_facility_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM v2.facility_scope
    WHERE singleton AND facility_id = p_facility_id
  ) THEN
    RAISE EXCEPTION 'Invalid facility scope' USING ERRCODE = '42501';
  END IF;
  SELECT jsonb_build_object('id', w.id, 'name', w.name)
    INTO v_warehouse
    FROM v2.inventory_warehouses AS w
    WHERE w.facility_id = p_facility_id
      AND w.active
      AND w.is_production
      AND EXISTS (
        SELECT 1 FROM v2.opening_counts AS c
        WHERE c.facility_id = w.facility_id
          AND c.warehouse_id = w.id
          AND c.status = 'applied'
      );
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'code', p.code,
    'name', p.name,
    'doughCapacity', v2.dough_capacity_snapshot(p_facility_id, p.code),
    'productionSetups', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'code', s.code,
        'name', s.name,
        'hasDoughRecipe', EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(s.data->'recipe_codes') AS requested(code)
          JOIN v2.master_records AS r
            ON r.facility_id = p_facility_id AND r.kind = 'recipes'
            AND lower(r.code) = lower(requested.code)
            AND lower(r.product_code) = lower(p.code)
          WHERE r.data->>'station_key' = 'dough'
        )
      ) ORDER BY lower(s.name), s.code)
      FROM v2.master_records AS s
      WHERE s.facility_id = p_facility_id
        AND s.kind = 'production-setups'
        AND lower(s.product_code) = lower(p.code)
        AND s.data->>'sourceFamily' IS NULL
        AND jsonb_typeof(s.data->'recipe_codes') = 'array'
        AND jsonb_typeof(s.data->'packaging_per_case') = 'array'
    ), '[]'::jsonb)
  ) ORDER BY lower(p.name), p.code), '[]'::jsonb)
    INTO v_products
    FROM v2.products AS p
    WHERE p.facility_id = p_facility_id AND p.active;
  RETURN jsonb_build_object(
    'productionWarehouse', v_warehouse,
    'products', v_products,
    'dieTypes', v2.list_die_defaults(p_facility_id)
  );
END
$$;

CREATE OR REPLACE FUNCTION v2.create_planned_run(
  p_facility_id uuid,
  p_actor_id uuid,
  p_request_id text,
  p_request_hash text,
  p_setup_snapshot jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_existing_hash text;
  v_existing_response jsonb;
  v_run_id uuid;
  v_now timestamptz;
  v_setup jsonb;
  v_response jsonb;
  v_product v2.products%ROWTYPE;
  v_setup_record v2.master_records%ROWTYPE;
  v_warehouse v2.inventory_warehouses%ROWTYPE;
  v_plan jsonb;
  v_recipes jsonb;
  v_die_code text;
  v_die_name text;
  v_die_status text;
  v_die_revision bigint;
  v_die_defaults v2.die_default_settings%ROWTYPE;
  v_line_settings jsonb;
  v_has_dough boolean;
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL
     OR p_request_id IS NULL OR length(btrim(p_request_id)) = 0
     OR length(p_request_id) > 200
     OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$'
     OR p_setup_snapshot IS NULL OR jsonb_typeof(p_setup_snapshot) <> 'object'
     OR (p_setup_snapshot - ARRAY[
       'label', 'targetCases', 'productCode', 'productionSetupCode', 'dieSetup'
     ]) <> '{}'::jsonb
     OR jsonb_typeof(p_setup_snapshot->'label') IS DISTINCT FROM 'string'
     OR jsonb_typeof(p_setup_snapshot->'targetCases') IS DISTINCT FROM 'number'
     OR jsonb_typeof(p_setup_snapshot->'productCode') IS DISTINCT FROM 'string'
     OR p_setup_snapshot->>'productCode' !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$'
     OR jsonb_typeof(p_setup_snapshot->'productionSetupCode') IS DISTINCT FROM 'string'
     OR p_setup_snapshot->>'productionSetupCode' !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$'
     OR (p_setup_snapshot ? 'dieSetup' AND (
       jsonb_typeof(p_setup_snapshot->'dieSetup') IS DISTINCT FROM 'object'
       OR ((p_setup_snapshot->'dieSetup') - ARRAY[
         'dieTypeCode', 'expectedRevision', 'lineSettings'
       ]) <> '{}'::jsonb
       OR jsonb_typeof(p_setup_snapshot->'dieSetup'->'dieTypeCode') IS DISTINCT FROM 'string'
       OR p_setup_snapshot->'dieSetup'->>'dieTypeCode' !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$'
       OR jsonb_typeof(p_setup_snapshot->'dieSetup'->'expectedRevision') IS DISTINCT FROM 'number'
       OR (p_setup_snapshot->'dieSetup'->>'expectedRevision') !~ '^(0|[1-9][0-9]{0,17})$'
       OR jsonb_typeof(p_setup_snapshot->'dieSetup'->'lineSettings') IS DISTINCT FROM 'object'
       OR v2.setup_catalog_object_size(p_setup_snapshot->'dieSetup'->'lineSettings') <> 9
       OR NOT ((p_setup_snapshot->'dieSetup'->'lineSettings') ?& ARRAY[
         'crustsPerCycle','cycleSpeed','speedAdjustment','freezerTime','casesPerLayer',
         'preTunnelMin','postTunnelMin','pressOvenMin','frontlineMin'
       ])
       OR EXISTS (
         SELECT 1 FROM jsonb_object_keys(p_setup_snapshot->'dieSetup'->'lineSettings') AS item(key)
         WHERE item.key <> ALL (ARRAY[
           'crustsPerCycle','cycleSpeed','speedAdjustment','freezerTime','casesPerLayer',
           'preTunnelMin','postTunnelMin','pressOvenMin','frontlineMin'
         ])
       )
       OR EXISTS (
         SELECT 1
         FROM jsonb_each(p_setup_snapshot->'dieSetup'->'lineSettings') AS item(key, value)
         WHERE jsonb_typeof(item.value) NOT IN ('number','null')
           OR (jsonb_typeof(item.value) = 'number' AND (item.value #>> '{}')::numeric NOT BETWEEN 0 AND 100000)
       )
     )) THEN
    RAISE EXCEPTION 'Invalid run creation request' USING ERRCODE = '22023';
  END IF;
  IF length(btrim(p_setup_snapshot->>'label')) NOT BETWEEN 1 AND 120
     OR (p_setup_snapshot->>'targetCases') !~ '^[1-9][0-9]*$'
     OR (p_setup_snapshot->>'targetCases')::numeric > 9007199254740991 THEN
    RAISE EXCEPTION 'Invalid run setup snapshot' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_facility_id::text || ':' || p_actor_id::text || ':' || p_request_id, 0)
  );
  SELECT request_hash, response INTO v_existing_hash, v_existing_response
    FROM v2.command_receipts
    WHERE facility_id = p_facility_id AND actor_id = p_actor_id AND command_id = p_request_id;
  IF FOUND THEN
    IF v_existing_hash <> p_request_hash THEN
      RAISE EXCEPTION 'Run creation request ID was reused with different details'
        USING ERRCODE = '22023';
    END IF;
    RETURN v_existing_response || jsonb_build_object('replayed', true);
  END IF;

  SELECT * INTO v_product
    FROM v2.products
    WHERE facility_id = p_facility_id
      AND lower(code) = lower(p_setup_snapshot->>'productCode')
      AND active
    FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'The selected product is not active' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_setup_record
    FROM v2.master_records
    WHERE facility_id = p_facility_id
      AND kind = 'production-setups'
      AND lower(product_code) = lower(v_product.code)
      AND lower(code) = lower(p_setup_snapshot->>'productionSetupCode')
      AND data->>'sourceFamily' IS NULL
      AND jsonb_typeof(data->'recipe_codes') = 'array'
      AND jsonb_typeof(data->'packaging_per_case') = 'array'
    FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The selected production setup is not available for this product'
      USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_warehouse
    FROM v2.inventory_warehouses AS w
    WHERE w.facility_id = p_facility_id AND w.active AND w.is_production
      AND EXISTS (
        SELECT 1 FROM v2.opening_counts AS c
        WHERE c.facility_id = w.facility_id AND c.warehouse_id = w.id AND c.status = 'applied'
      )
    FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'An active production warehouse with an applied opening count is required'
      USING ERRCODE = '55000';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(v_setup_record.data->'recipe_codes') AS requested(code)
    JOIN v2.master_records AS r
      ON r.facility_id = p_facility_id AND r.kind = 'recipes'
      AND lower(r.code) = lower(requested.code)
      AND lower(r.product_code) = lower(v_product.code)
    WHERE r.data->>'station_key' = 'dough'
  ) INTO v_has_dough;

  SELECT jsonb_agg(jsonb_build_object(
    'code', r.code,
    'name', r.name,
    'stationKey', r.data->>'station_key',
    'ingredients', (
      SELECT jsonb_agg(jsonb_build_object(
        'productId', ingredient_product.id,
        'productCode', ingredient_product.code,
        'productName', ingredient_product.name,
        'quantity', ingredient.value->>'quantity',
        'unit', ingredient.value->>'unit'
      ) ORDER BY ingredient.ordinality)
      FROM jsonb_array_elements(r.data->'ingredients') WITH ORDINALITY AS ingredient(value, ordinality)
      JOIN v2.products AS ingredient_product
        ON ingredient_product.facility_id = p_facility_id
        AND lower(ingredient_product.code) = lower(ingredient.value->>'product_code')
        AND ingredient_product.active
    )
  ) ORDER BY requested.ordinality)
    INTO v_recipes
    FROM jsonb_array_elements_text(v_setup_record.data->'recipe_codes')
      WITH ORDINALITY AS requested(code, ordinality)
    JOIN v2.master_records AS r
      ON r.facility_id = p_facility_id AND r.kind = 'recipes'
      AND lower(r.code) = lower(requested.code)
      AND lower(r.product_code) = lower(v_product.code);
  IF jsonb_array_length(COALESCE(v_recipes, '[]'::jsonb))
       <> jsonb_array_length(v_setup_record.data->'recipe_codes') THEN
    RAISE EXCEPTION 'The production setup references unavailable recipe inventory lines'
      USING ERRCODE = '22023';
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'productId', packaging_product.id,
    'productCode', packaging_product.code,
    'productName', packaging_product.name,
    'quantity', packaging.value->>'quantity',
    'unit', packaging.value->>'unit'
  ) ORDER BY packaging.ordinality)
    INTO v_plan
    FROM jsonb_array_elements(v_setup_record.data->'packaging_per_case')
      WITH ORDINALITY AS packaging(value, ordinality)
    JOIN v2.products AS packaging_product
      ON packaging_product.facility_id = p_facility_id
      AND lower(packaging_product.code) = lower(packaging.value->>'product_code')
      AND packaging_product.active;
  IF jsonb_array_length(COALESCE(v_plan, '[]'::jsonb))
       <> jsonb_array_length(v_setup_record.data->'packaging_per_case') THEN
    RAISE EXCEPTION 'The production setup references unavailable packaging inventory lines'
      USING ERRCODE = '22023';
  END IF;

  v_plan := jsonb_build_object(
    'code', v_setup_record.code,
    'name', v_setup_record.name,
    'warehouse', jsonb_build_object('id', v_warehouse.id, 'name', v_warehouse.name),
    'recipes', v_recipes,
    'packagingPerCase', v_plan
  );
  v_setup := jsonb_build_object(
    'label', btrim(p_setup_snapshot->>'label'),
    'targetCases', (p_setup_snapshot->>'targetCases')::bigint,
    'productCode', v_product.code,
    'productionSetupCode', v_setup_record.code,
    'productionPlan', v_plan
  );
  IF p_setup_snapshot ? 'dieSetup' THEN
    IF NOT v_has_dough THEN
      RAISE EXCEPTION 'This production setup has no applicable dough die'
        USING ERRCODE = '22023';
    END IF;
    v_die_code := p_setup_snapshot->'dieSetup'->>'dieTypeCode';
    v_die_revision := (p_setup_snapshot->'dieSetup'->>'expectedRevision')::bigint;
    SELECT code, name INTO v_die_code, v_die_name
      FROM v2.setup_die_type_records
      WHERE facility_id = p_facility_id AND lower(code) = lower(v_die_code)
      FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'The selected die type is not available' USING ERRCODE = '23503'; END IF;
    SELECT * INTO v_die_defaults
      FROM v2.die_default_settings
      WHERE facility_id = p_facility_id AND lower(die_code) = lower(v_die_code)
      FOR SHARE;
    IF FOUND THEN
      IF v_die_defaults.revision <> v_die_revision THEN
        RAISE EXCEPTION 'Die defaults changed while this run was being prepared' USING ERRCODE = '40001';
      END IF;
      v_die_status := CASE WHEN v_die_defaults.enabled THEN 'active' ELSE 'disabled' END;
    ELSE
      IF v_die_revision <> 0 THEN
        RAISE EXCEPTION 'Die defaults changed while this run was being prepared' USING ERRCODE = '40001';
      END IF;
      v_die_status := 'unreviewed';
    END IF;
    v_line_settings := p_setup_snapshot->'dieSetup'->'lineSettings';
    v_setup := v_setup || jsonb_build_object('dieSetup', jsonb_build_object(
      'dieTypeCode', v_die_code,
      'dieTypeName', v_die_name,
      'defaultStatus', v_die_status,
      'defaultRevision', v_die_revision,
      'lineSettings', v_line_settings
    ));
  END IF;

  v_now := clock_timestamp();
  v_run_id := gen_random_uuid();
  INSERT INTO v2.runs (
    facility_id, id, status, revision, created_at, updated_at, setup_snapshot
  ) VALUES (
    p_facility_id, v_run_id, 'planned', 0, v_now, v_now, v_setup
  );
  v_response := jsonb_build_object(
    'outcome', 'created', 'replayed', false, 'run', v2.run_snapshot(p_facility_id, v_run_id)
  );
  INSERT INTO v2.run_events (
    facility_id, run_id, revision, actor_id, event_type, occurred_at, payload
  ) VALUES (
    p_facility_id, v_run_id, 0, p_actor_id, 'run.created', v_now, v_response
  );
  INSERT INTO v2.outbox_events (
    event_id, facility_id, run_id, revision, event_type, payload, created_at
  ) VALUES (
    gen_random_uuid(), p_facility_id, v_run_id, 0, 'run.created', v_response, v_now
  );
  INSERT INTO v2.command_receipts (
    facility_id, actor_id, command_id, request_hash, response, created_at
  ) VALUES (
    p_facility_id, p_actor_id, p_request_id, p_request_hash, v_response, v_now
  );
  RETURN v_response;
END
$$;

REVOKE ALL ON TABLE v2.die_default_settings, v2.die_default_events FROM PUBLIC;
REVOKE ALL ON FUNCTION v2.list_die_defaults(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION v2.list_die_default_events(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION v2.save_die_default(uuid, uuid, text, text, text, bigint, jsonb, boolean) FROM PUBLIC;

COMMENT ON TABLE v2.die_default_settings IS
  'Manager-reviewed, facility-scoped die line defaults; imported suggestions are not operational until reviewed here.';
COMMENT ON TABLE v2.die_default_events IS
  'Append-only manager-attributed die-default changes and idempotent write receipts.';

COMMIT;
