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
    'correction',
    'redaction'
  ));

CREATE TABLE v2.qc_run_substitutions (
  facility_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  proposal_event_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  prior_substitution_id uuid,
  source_product_id uuid NOT NULL,
  source_product_code text NOT NULL,
  source_product_name text NOT NULL,
  source_quantity numeric(20,6) NOT NULL CHECK (source_quantity > 0),
  source_unit text NOT NULL,
  station_key text NOT NULL CHECK (station_key IN ('dough', 'cheese', 'pepperoni', 'sauce', 'frontline')),
  source_items jsonb NOT NULL CHECK (
    jsonb_typeof(source_items) = 'array'
    AND jsonb_array_length(source_items) BETWEEN 1 AND 20
  ),
  replacement_product_id uuid NOT NULL,
  replacement_product_code text NOT NULL,
  replacement_product_name text NOT NULL,
  replacement_quantity numeric(20,6) NOT NULL CHECK (replacement_quantity > 0),
  replacement_unit text NOT NULL,
  replacement_ingredient_snapshot jsonb NOT NULL CHECK (
    jsonb_typeof(replacement_ingredient_snapshot) = 'object'
  ),
  actor_id uuid NOT NULL,
  request_id text NOT NULL CHECK (length(btrim(request_id)) BETWEEN 1 AND 200),
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  movement_group_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (facility_id, id),
  UNIQUE (facility_id, proposal_event_id, revision),
  UNIQUE (facility_id, actor_id, request_id),
  FOREIGN KEY (facility_id, run_id)
    REFERENCES v2.runs (facility_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (facility_id, proposal_event_id)
    REFERENCES v2.qc_events (facility_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (facility_id, prior_substitution_id)
    REFERENCES v2.qc_run_substitutions (facility_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (facility_id, source_product_id)
    REFERENCES v2.products (facility_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (facility_id, replacement_product_id)
    REFERENCES v2.products (facility_id, id) ON DELETE RESTRICT,
  CHECK (length(btrim(source_product_code)) BETWEEN 1 AND 80),
  CHECK (length(btrim(source_product_name)) BETWEEN 1 AND 120),
  CHECK (length(btrim(replacement_product_code)) BETWEEN 1 AND 80),
  CHECK (length(btrim(replacement_product_name)) BETWEEN 1 AND 120),
  CHECK (source_unit ~ '^[A-Za-z][A-Za-z0-9._/-]{0,15}$'),
  CHECK (replacement_unit ~ '^[A-Za-z][A-Za-z0-9._/-]{0,15}$')
);

CREATE INDEX qc_run_substitutions_latest
  ON v2.qc_run_substitutions (facility_id, run_id, proposal_event_id, revision DESC);

CREATE FUNCTION v2.prevent_qc_run_substitution_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, v2
AS $$
BEGIN
  RAISE EXCEPTION 'QC substitution history is append-only'
    USING ERRCODE = '55000';
END
$$;

CREATE TRIGGER qc_run_substitutions_append_only
  BEFORE UPDATE OR DELETE ON v2.qc_run_substitutions
  FOR EACH ROW EXECUTE FUNCTION v2.prevent_qc_run_substitution_mutation();

CREATE FUNCTION v2.resolve_qc_substitution_sources(
  p_facility_id uuid,
  p_run_snapshot jsonb,
  p_source_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_input jsonb;
  v_recipe jsonb;
  v_ingredient jsonb;
  v_source v2.products%ROWTYPE;
  v_result jsonb := '[]'::jsonb;
  v_seen text[] := ARRAY[]::text[];
  v_key text;
  v_source_id uuid;
  v_station text;
  v_recipe_code text;
  v_unit text;
  v_quantity numeric(20,6);
  v_found boolean;
  v_keys text[];
  v_expected text[] := ARRAY['productId', 'quantity', 'recipeCode', 'stationKey', 'unit'];
  v_actual text[];
BEGIN
  IF jsonb_typeof(p_source_items) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_source_items) NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION 'Choose one to twenty planned source components'
      USING ERRCODE = '22023';
  END IF;

  FOR v_input IN SELECT value FROM jsonb_array_elements(p_source_items)
  LOOP
    IF jsonb_typeof(v_input) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'Invalid source component' USING ERRCODE = '22023';
    END IF;
    SELECT array_agg(key ORDER BY key) INTO v_actual
    FROM jsonb_object_keys(v_input) AS item(key);
    SELECT array_agg(key ORDER BY key) INTO v_keys
    FROM unnest(v_expected) AS item(key);
    IF v_actual IS DISTINCT FROM v_keys
       OR coalesce(v_input->>'productId', '') !~*
         '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR coalesce(v_input->>'recipeCode', '') !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$'
       OR v_input->>'stationKey' NOT IN ('dough', 'cheese', 'pepperoni', 'sauce', 'frontline')
       OR coalesce(v_input->>'quantity', '') !~ '^(0|[1-9][0-9]{0,13})(\.[0-9]{1,6})?$'
       OR (v_input->>'quantity')::numeric <= 0
       OR coalesce(v_input->>'unit', '') !~ '^[A-Za-z][A-Za-z0-9._/-]{0,15}$' THEN
      RAISE EXCEPTION 'Invalid source component fields' USING ERRCODE = '22023';
    END IF;
    v_source_id := (v_input->>'productId')::uuid;
    v_station := v_input->>'stationKey';
    v_recipe_code := v_input->>'recipeCode';
    v_unit := v_input->>'unit';
    v_quantity := (v_input->>'quantity')::numeric;
    v_key := v_recipe_code || ':' || v_station || ':' || v_source_id::text;
    IF v_key = ANY(v_seen) THEN
      RAISE EXCEPTION 'A source component can appear only once in a substitution'
        USING ERRCODE = '22023';
    END IF;
    v_seen := array_append(v_seen, v_key);

    v_found := false;
    FOR v_recipe IN
      SELECT value FROM jsonb_array_elements(
        coalesce(p_run_snapshot->'productionPlan'->'recipes', '[]'::jsonb)
      )
    LOOP
      IF v_recipe->>'code' <> v_recipe_code
         OR v_recipe->>'stationKey' <> v_station THEN
        CONTINUE;
      END IF;
      FOR v_ingredient IN
        SELECT value FROM jsonb_array_elements(
          coalesce(v_recipe->'ingredients', '[]'::jsonb)
        )
      LOOP
        IF v_ingredient->>'productId' = v_source_id::text
           AND v_ingredient->>'unit' = v_unit THEN
          v_found := true;
          EXIT;
        END IF;
      END LOOP;
      EXIT WHEN v_found;
    END LOOP;
    IF NOT v_found THEN
      RAISE EXCEPTION 'Choose every source component from this run snapshot'
        USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_source FROM v2.products
    WHERE facility_id = p_facility_id AND id = v_source_id
    FOR SHARE;
    IF NOT FOUND OR v_source.base_unit <> v_unit THEN
      RAISE EXCEPTION 'A source component unit does not match its inventory identity'
        USING ERRCODE = '22023';
    END IF;

    SELECT recipe.value INTO v_recipe
    FROM jsonb_array_elements(
      coalesce(p_run_snapshot->'productionPlan'->'recipes', '[]'::jsonb)
    ) AS recipe(value)
    WHERE recipe.value->>'code' = v_recipe_code
      AND recipe.value->>'stationKey' = v_station
    LIMIT 1;
    SELECT ingredient.value INTO v_ingredient
    FROM jsonb_array_elements(coalesce(v_recipe->'ingredients', '[]'::jsonb)) AS ingredient(value)
    WHERE ingredient.value->>'productId' = v_source_id::text
      AND ingredient.value->>'unit' = v_unit
    LIMIT 1;
    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'productId', v_source_id,
      'productCode', v_ingredient->>'productCode',
      'productName', v_ingredient->>'productName',
      'recipeCode', v_recipe_code,
      'recipeName', v_recipe->>'name',
      'stationKey', v_station,
      'quantity', v_quantity::text,
      'unit', v_unit,
      'ingredientSnapshot', coalesce(v_ingredient->'ingredientSnapshot',
        '{"status":"unknown","reason":"missing-link"}'::jsonb)
    ));
  END LOOP;
  RETURN v_result;
END
$$;

CREATE FUNCTION v2.qc_current_product_ingredient_snapshot(
  p_facility_id uuid,
  p_product_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_link v2.qc_ingredient_link_events%ROWTYPE;
  v_catalog v2.setup_ingredient_records%ROWTYPE;
BEGIN
  SELECT * INTO v_link
  FROM v2.qc_ingredient_link_events
  WHERE facility_id = p_facility_id AND product_id = p_product_id
  ORDER BY occurred_at DESC, id DESC
  LIMIT 1;
  IF NOT FOUND OR v_link.action <> 'linked' THEN
    RETURN '{"status":"unknown","reason":"missing-link"}'::jsonb;
  END IF;
  SELECT * INTO v_catalog
  FROM v2.setup_ingredient_records
  WHERE facility_id = p_facility_id
    AND code = v_link.ingredient_code
    AND data->>'enabled' = 'true'
    AND merged_into_code IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'status', 'unknown',
      'reason', 'canonical-ingredient-unavailable',
      'linkEventId', v_link.id
    );
  END IF;
  RETURN jsonb_build_object(
    'status', 'linked',
    'ingredientCode', v_catalog.code,
    'ingredientName', v_catalog.name,
    'allergens', v_catalog.data->'allergens',
    'allergensReviewed', v_catalog.data->'allergensReviewed',
    'linkEventId', v_link.id,
    'ingredientUpdatedAt', v_catalog.updated_at
  );
END
$$;

CREATE FUNCTION v2.adjust_qc_substitution_inventory(
  p_facility_id uuid,
  p_warehouse_id uuid,
  p_run_id uuid,
  p_actor_id uuid,
  p_movement_group_id uuid,
  p_old_product_id uuid,
  p_old_quantity numeric,
  p_new_product_id uuid,
  p_new_quantity numeric,
  p_reason text,
  p_occurred_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_move record;
  v_balance v2.inventory_balances%ROWTYPE;
BEGIN
  FOR v_move IN
    SELECT product_id, sum(delta)::numeric(20,6) AS delta
    FROM (
      SELECT p_old_product_id AS product_id, coalesce(p_old_quantity, 0)::numeric AS delta
      WHERE p_old_product_id IS NOT NULL
      UNION ALL
      SELECT p_new_product_id, -coalesce(p_new_quantity, 0)::numeric
      WHERE p_new_product_id IS NOT NULL
    ) AS changes
    GROUP BY product_id
    HAVING sum(delta) <> 0
    ORDER BY product_id
  LOOP
    INSERT INTO v2.inventory_balances (facility_id, warehouse_id, product_id)
    VALUES (p_facility_id, p_warehouse_id, v_move.product_id)
    ON CONFLICT DO NOTHING;
    SELECT * INTO v_balance
    FROM v2.inventory_balances
    WHERE facility_id = p_facility_id
      AND warehouse_id = p_warehouse_id
      AND product_id = v_move.product_id
    FOR UPDATE;
    IF v_move.delta < 0 AND v_balance.quantity < abs(v_move.delta) THEN
      RAISE EXCEPTION 'Insufficient stock for the approved substitution'
        USING ERRCODE = '22003';
    END IF;
    IF v_balance.revision >= 9007199254740991 THEN
      RAISE EXCEPTION 'Inventory revision is exhausted' USING ERRCODE = '22003';
    END IF;
    UPDATE v2.inventory_balances
    SET quantity = quantity + v_move.delta,
        revision = revision + 1,
        updated_at = p_occurred_at
    WHERE facility_id = p_facility_id
      AND warehouse_id = p_warehouse_id
      AND product_id = v_move.product_id;
    INSERT INTO v2.inventory_movements (
      facility_id, id, warehouse_id, product_id, movement_group_id, movement_type,
      quantity_delta, reason, actor_id, command_id, occurred_at, run_id
    ) VALUES (
      p_facility_id, gen_random_uuid(), p_warehouse_id, v_move.product_id,
      p_movement_group_id, 'adjustment', v_move.delta, p_reason, p_actor_id,
      'qc-substitution:' || p_movement_group_id::text || ':' || v_move.product_id::text,
      p_occurred_at, p_run_id
    );
  END LOOP;
END
$$;

CREATE UNIQUE INDEX qc_events_one_substitution_decision
  ON v2.qc_events (facility_id, (payload->>'proposalEventId'))
  WHERE event_type IN ('run-substitution-approved', 'run-substitution-rejected');

CREATE UNIQUE INDEX qc_events_one_substitution_correction_request
  ON v2.qc_events (facility_id, (payload->>'targetSubstitutionId'), (request_id))
  WHERE event_type = 'run-substitution-corrected';

CREATE FUNCTION v2.list_qc_component_products(
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
    RAISE EXCEPTION 'Invalid QC component request' USING ERRCODE = '22023';
  END IF;
  IF NOT v2.actor_can_record_qc(p_actor_id) THEN
    RAISE EXCEPTION 'QC component access is not authorized' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'products', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'productId', selected.id,
        'productCode', selected.code,
        'productName', selected.name,
        'unit', selected.base_unit
      ) ORDER BY lower(selected.name), selected.code)
      FROM (
        SELECT product.id, product.code, product.name, product.base_unit
        FROM v2.products AS product
        WHERE product.facility_id = p_facility_id AND product.active
        ORDER BY lower(product.name), product.code
        LIMIT 2000
      ) AS selected
    ), '[]'::jsonb),
    'productsTruncated', (
      SELECT count(*) > 2000
      FROM v2.products AS product
      WHERE product.facility_id = p_facility_id AND product.active
    )
  );
END
$$;

CREATE FUNCTION v2.list_qc_run_substitutions(
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
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL OR p_run_id IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM v2.facility_scope
       WHERE singleton AND facility_id = p_facility_id
     ) THEN
    RAISE EXCEPTION 'Invalid QC substitution request' USING ERRCODE = '22023';
  END IF;
  IF NOT v2.actor_can_record_qc(p_actor_id) THEN
    RAISE EXCEPTION 'QC substitution access is not authorized' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM v2.runs WHERE facility_id = p_facility_id AND id = p_run_id
  ) THEN
    RAISE EXCEPTION 'QC run is unavailable' USING ERRCODE = 'P0002';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', latest.id,
      'proposalEventId', latest.proposal_event_id,
      'revision', latest.revision,
      'sourceItems', latest.source_items,
      'sourceProductId', latest.source_product_id,
      'sourceProductCode', latest.source_product_code,
      'sourceProductName', latest.source_product_name,
      'sourceQuantity', latest.source_quantity::text,
      'sourceUnit', latest.source_unit,
      'stationKey', latest.station_key,
      'replacementProductId', latest.replacement_product_id,
      'replacementProductCode', latest.replacement_product_code,
      'replacementProductName', latest.replacement_product_name,
      'replacementQuantity', latest.replacement_quantity::text,
      'replacementUnit', latest.replacement_unit,
      'replacementIngredientSnapshot', latest.replacement_ingredient_snapshot,
      'actorId', latest.actor_id,
      'movementGroupId', latest.movement_group_id,
      'occurredAt', latest.occurred_at
    ) ORDER BY latest.occurred_at, latest.id)
    FROM (
      SELECT DISTINCT ON (substitution.proposal_event_id) substitution.*
      FROM v2.qc_run_substitutions AS substitution
      WHERE substitution.facility_id = p_facility_id
        AND substitution.run_id = p_run_id
      ORDER BY substitution.proposal_event_id, substitution.revision DESC
      LIMIT 200
    ) AS latest
  ), '[]'::jsonb);
END
$$;

CREATE FUNCTION v2.record_qc_substitution(
  p_facility_id uuid,
  p_actor_id uuid,
  p_run_id uuid,
  p_request_id text,
  p_request_hash text,
  p_action text,
  p_proposal_event_id uuid,
  p_target_substitution_id uuid,
  p_details jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_run v2.runs%ROWTYPE;
  v_proposal v2.qc_events%ROWTYPE;
  v_existing v2.qc_events%ROWTYPE;
  v_previous v2.qc_run_substitutions%ROWTYPE;
  v_current v2.qc_run_substitutions%ROWTYPE;
  v_source v2.products%ROWTYPE;
  v_replacement v2.products%ROWTYPE;
  v_warehouse v2.inventory_warehouses%ROWTYPE;
  v_balance v2.inventory_balances%ROWTYPE;
  v_event v2.qc_events%ROWTYPE;
  v_substitution v2.qc_run_substitutions%ROWTYPE;
  v_event_type text;
  v_payload jsonb;
  v_proposal_payload jsonb;
  v_source_id uuid;
  v_replacement_id uuid;
  v_source_code text;
  v_source_name text;
  v_source_unit text;
  v_replacement_code text;
  v_replacement_name text;
  v_replacement_unit text;
  v_source_quantity numeric(20,6);
  v_replacement_quantity numeric(20,6);
  v_movement_group uuid;
  v_now timestamptz;
  v_recipe jsonb;
  v_ingredient jsonb;
  v_found_source boolean := false;
  v_expected_keys text[];
  v_actual_keys text[];
  v_source_items jsonb;
  v_source_item jsonb;
  v_replacement_snapshot jsonb;
  v_old_replacement_id uuid;
  v_old_replacement_quantity numeric(20,6);
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL OR p_run_id IS NULL
     OR p_request_id IS NULL OR length(btrim(p_request_id)) NOT BETWEEN 1 AND 200
     OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$'
     OR p_action IS NULL OR p_action NOT IN ('propose', 'approve', 'reject', 'correct')
     OR p_details IS NULL OR jsonb_typeof(p_details) <> 'object'
     OR NOT EXISTS (
       SELECT 1 FROM v2.facility_scope
       WHERE singleton AND facility_id = p_facility_id
     ) THEN
    RAISE EXCEPTION 'Invalid QC substitution request' USING ERRCODE = '22023';
  END IF;

  IF NOT v2.actor_can_record_qc(p_actor_id)
     OR (p_action <> 'propose' AND NOT v2.actor_can_manage_qc(p_actor_id)) THEN
    RAISE EXCEPTION 'QC substitution action is not authorized' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_facility_id::text || ':' || p_actor_id::text || ':qc-substitution:' || p_request_id, 0
  ));
  SELECT * INTO v_existing
  FROM v2.qc_events
  WHERE facility_id = p_facility_id
    AND actor_id = p_actor_id
    AND request_id = p_request_id;
  IF FOUND THEN
    IF v_existing.request_hash <> p_request_hash
       OR v_existing.run_id IS DISTINCT FROM p_run_id
       OR v_existing.event_type NOT IN (
         'run-substitution-proposed', 'run-substitution-approved',
         'run-substitution-rejected', 'run-substitution-corrected'
       ) THEN
      RAISE EXCEPTION 'QC substitution request ID was reused with different details'
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

  SELECT * INTO v_run
  FROM v2.runs
  WHERE facility_id = p_facility_id AND id = p_run_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'QC run is unavailable' USING ERRCODE = 'P0002';
  END IF;
  IF v_run.status = 'completed' THEN
    RAISE EXCEPTION 'Completed runs cannot receive substitution changes'
      USING ERRCODE = '55000';
  END IF;

  IF p_action = 'propose' THEN
    v_expected_keys := ARRAY[
      'reason', 'replacementProductId', 'replacementQuantity', 'replacementUnit', 'sourceItems'
    ];
    SELECT array_agg(key ORDER BY key) INTO v_actual_keys
    FROM jsonb_object_keys(p_details) AS item(key);
    SELECT array_agg(key ORDER BY key) INTO v_expected_keys
    FROM unnest(v_expected_keys) AS item(key);
    IF v_actual_keys IS DISTINCT FROM v_expected_keys
       OR coalesce(p_details->>'replacementProductId', '') !~*
         '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR coalesce(p_details->>'replacementQuantity', '') !~ '^(0|[1-9][0-9]{0,13})(\.[0-9]{1,6})?$'
       OR (p_details->>'replacementQuantity')::numeric <= 0
       OR coalesce(p_details->>'replacementUnit', '') !~ '^[A-Za-z][A-Za-z0-9._/-]{0,15}$'
       OR length(btrim(coalesce(p_details->>'reason', ''))) NOT BETWEEN 3 AND 500 THEN
      RAISE EXCEPTION 'Invalid substitution proposal fields' USING ERRCODE = '22023';
    END IF;
    v_replacement_id := (p_details->>'replacementProductId')::uuid;
    v_replacement_unit := p_details->>'replacementUnit';
    v_replacement_quantity := (p_details->>'replacementQuantity')::numeric;
    v_source_items := v2.resolve_qc_substitution_sources(
      p_facility_id, v_run.setup_snapshot, p_details->'sourceItems'
    );
    v_source_item := v_source_items->0;
    v_source_id := (v_source_item->>'productId')::uuid;
    v_source_code := v_source_item->>'productCode';
    v_source_name := v_source_item->>'productName';
    v_source_unit := v_source_item->>'unit';
    v_source_quantity := (v_source_item->>'quantity')::numeric;
    SELECT * INTO v_replacement FROM v2.products
    WHERE facility_id = p_facility_id AND id = v_replacement_id AND active
    FOR SHARE;
    IF NOT FOUND OR v_replacement.base_unit <> v_replacement_unit THEN
      RAISE EXCEPTION 'The replacement must be an active product in its exact inventory unit'
        USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_source_items) AS source(value)
      WHERE source.value->>'productId' = v_replacement_id::text
    ) THEN
      RAISE EXCEPTION 'The replacement cannot be one of the source components'
        USING ERRCODE = '22023';
    END IF;
    v_event_type := 'run-substitution-proposed';
    v_payload := jsonb_build_object(
      'sourceItems', v_source_items,
      'sourceProductId', v_source_id,
      'sourceProductCode', v_source_code,
      'sourceProductName', v_source_name,
      'sourceQuantity', v_source_quantity::text,
      'sourceUnit', v_source_unit,
      'stationKey', v_source_item->>'stationKey',
      'replacementProductId', v_replacement.id,
      'replacementProductCode', v_replacement.code,
      'replacementProductName', v_replacement.name,
      'replacementQuantity', v_replacement_quantity::text,
      'replacementUnit', v_replacement_unit,
      'reason', btrim(p_details->>'reason')
    );
  ELSIF p_action = 'approve' OR p_action = 'reject' THEN
    IF p_proposal_event_id IS NULL THEN
      RAISE EXCEPTION 'Choose a substitution proposal' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_proposal
    FROM v2.qc_events
    WHERE facility_id = p_facility_id
      AND id = p_proposal_event_id
      AND run_id = p_run_id
      AND event_type = 'run-substitution-proposed'
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The substitution proposal is not available' USING ERRCODE = 'P0002';
    END IF;
    IF EXISTS (
      SELECT 1 FROM v2.qc_events
      WHERE facility_id = p_facility_id
        AND event_type IN ('run-substitution-approved', 'run-substitution-rejected')
        AND payload->>'proposalEventId' = p_proposal_event_id::text
    ) THEN
      RAISE EXCEPTION 'The substitution proposal already has a decision'
        USING ERRCODE = '55000';
    END IF;
    IF p_action = 'reject' THEN
      IF (p_details - ARRAY['reason']) <> '{}'::jsonb
         OR length(btrim(coalesce(p_details->>'reason', ''))) NOT BETWEEN 3 AND 500 THEN
        RAISE EXCEPTION 'A rejection reason is required' USING ERRCODE = '22023';
      END IF;
      v_event_type := 'run-substitution-rejected';
      v_payload := jsonb_build_object(
        'proposalEventId', p_proposal_event_id,
        'reason', btrim(p_details->>'reason')
      );
    ELSE
      IF p_details <> '{}'::jsonb THEN
        RAISE EXCEPTION 'Approval does not accept replacement values' USING ERRCODE = '22023';
      END IF;
      v_proposal_payload := v_proposal.payload;
      SELECT * INTO v_warehouse
      FROM v2.inventory_warehouses
      WHERE facility_id = p_facility_id
        AND id = (v_run.setup_snapshot->'productionPlan'->'warehouse'->>'id')::uuid
        AND active AND is_production
      FOR UPDATE;
      IF NOT FOUND OR NOT EXISTS (
        SELECT 1 FROM v2.opening_counts
        WHERE facility_id = p_facility_id
          AND warehouse_id = v_warehouse.id
          AND status = 'applied'
      ) THEN
        RAISE EXCEPTION 'The run production warehouse is unavailable'
          USING ERRCODE = '55000';
      END IF;
      v_replacement_id := (v_proposal_payload->>'replacementProductId')::uuid;
      v_replacement_quantity := (v_proposal_payload->>'replacementQuantity')::numeric;
      SELECT * INTO v_replacement FROM v2.products
      WHERE facility_id = p_facility_id
        AND id = v_replacement_id AND active
      FOR SHARE;
      IF NOT FOUND OR v_replacement.base_unit <> v_proposal_payload->>'replacementUnit' THEN
        RAISE EXCEPTION 'The replacement product or its unit changed; submit the proposal again'
          USING ERRCODE = '40001';
      END IF;
      v_replacement_snapshot := v2.qc_current_product_ingredient_snapshot(
        p_facility_id, v_replacement_id
      );
      v_now := clock_timestamp();
      v_movement_group := gen_random_uuid();
      v_event_type := 'run-substitution-approved';
      v_payload := v_proposal_payload || jsonb_build_object(
        'proposalEventId', p_proposal_event_id,
        'movementGroupId', v_movement_group,
        'approvedAt', v_now,
        'replacementIngredientSnapshot', v_replacement_snapshot
      );
      PERFORM v2.adjust_qc_substitution_inventory(
        p_facility_id, v_warehouse.id, p_run_id, p_actor_id,
        v_movement_group, NULL, 0, v_replacement_id, v_replacement_quantity,
        'QC-approved substitution for run ' || p_run_id::text, v_now
      );
      INSERT INTO v2.qc_events (
        facility_id, id, run_id, actor_id, request_id, request_hash, event_type, payload, occurred_at
      ) VALUES (
        p_facility_id, v_movement_group, p_run_id, p_actor_id, p_request_id,
        p_request_hash, v_event_type, v_payload, v_now
      ) RETURNING * INTO v_event;
      INSERT INTO v2.qc_run_substitutions (
        facility_id, id, run_id, proposal_event_id, revision,
        source_product_id, source_product_code, source_product_name, source_quantity, source_unit, station_key,
        source_items,
        replacement_product_id, replacement_product_code, replacement_product_name,
        replacement_quantity, replacement_unit, replacement_ingredient_snapshot,
        actor_id, request_id, request_hash,
        movement_group_id, occurred_at
      ) VALUES (
        p_facility_id, gen_random_uuid(), p_run_id, p_proposal_event_id, 1,
        (v_proposal_payload->>'sourceProductId')::uuid,
        v_proposal_payload->>'sourceProductCode',
        v_proposal_payload->>'sourceProductName',
        (v_proposal_payload->>'sourceQuantity')::numeric,
        v_proposal_payload->>'sourceUnit',
        v_proposal_payload->>'stationKey',
        v_proposal_payload->'sourceItems',
        v_replacement.id, v_replacement.code, v_replacement.name,
        v_replacement_quantity, v_replacement.base_unit, v_replacement_snapshot, p_actor_id,
        p_request_id, p_request_hash, v_movement_group, v_now
      ) RETURNING * INTO v_substitution;
      RETURN jsonb_build_object(
        'event', jsonb_build_object(
          'id', v_event.id, 'runId', v_event.run_id, 'actorId', v_event.actor_id,
          'eventType', v_event.event_type, 'payload', v_event.payload,
          'occurredAt', v_event.occurred_at
        ),
        'substitution', jsonb_build_object(
          'id', v_substitution.id, 'movementGroupId', v_substitution.movement_group_id,
          'replacementProductId', v_substitution.replacement_product_id,
          'replacementQuantity', v_substitution.replacement_quantity::text,
          'replacementUnit', v_substitution.replacement_unit
        ),
        'replayed', false
      );
    END IF;
  ELSE
    IF p_target_substitution_id IS NULL
       OR (p_details - ARRAY[
         'sourceItems', 'replacementProductId', 'replacementQuantity', 'replacementUnit', 'reason'
       ]) <> '{}'::jsonb THEN
      RAISE EXCEPTION 'Invalid substitution correction fields' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_previous
    FROM v2.qc_run_substitutions
    WHERE facility_id = p_facility_id AND id = p_target_substitution_id
      AND run_id = p_run_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The approved substitution is not available' USING ERRCODE = 'P0002';
    END IF;
    SELECT * INTO v_current
    FROM v2.qc_run_substitutions
    WHERE facility_id = p_facility_id
      AND proposal_event_id = v_previous.proposal_event_id
    ORDER BY revision DESC
    LIMIT 1
    FOR UPDATE;
    IF coalesce(p_details->>'replacementProductId', '') !~*
         '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR coalesce(p_details->>'replacementQuantity', '') !~ '^(0|[1-9][0-9]{0,13})(\.[0-9]{1,6})?$'
       OR (p_details->>'replacementQuantity')::numeric <= 0
       OR coalesce(p_details->>'replacementUnit', '') !~ '^[A-Za-z][A-Za-z0-9._/-]{0,15}$'
       OR length(btrim(coalesce(p_details->>'reason', ''))) NOT BETWEEN 3 AND 500 THEN
      RAISE EXCEPTION 'Invalid substitution correction values' USING ERRCODE = '22023';
    END IF;
    v_source_items := v2.resolve_qc_substitution_sources(
      p_facility_id, v_run.setup_snapshot, p_details->'sourceItems'
    );
    v_source_item := v_source_items->0;
    v_source_id := (v_source_item->>'productId')::uuid;
    v_source_code := v_source_item->>'productCode';
    v_source_name := v_source_item->>'productName';
    v_source_unit := v_source_item->>'unit';
    v_source_quantity := (v_source_item->>'quantity')::numeric;
    v_replacement_id := (p_details->>'replacementProductId')::uuid;
    v_replacement_unit := p_details->>'replacementUnit';
    v_replacement_quantity := (p_details->>'replacementQuantity')::numeric;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_source_items) AS source(value)
      WHERE source.value->>'productId' = v_replacement_id::text
    ) THEN
      RAISE EXCEPTION 'The replacement cannot be one of the source components'
        USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_replacement FROM v2.products
    WHERE facility_id = p_facility_id AND id = v_replacement_id AND active FOR SHARE;
    IF NOT FOUND OR v_replacement.base_unit <> v_replacement_unit THEN
      RAISE EXCEPTION 'The corrected replacement must use its exact active inventory unit'
        USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_warehouse
    FROM v2.inventory_warehouses
    WHERE facility_id = p_facility_id
      AND id = (v_run.setup_snapshot->'productionPlan'->'warehouse'->>'id')::uuid
      AND active AND is_production
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The run production warehouse is unavailable'
        USING ERRCODE = '55000';
    END IF;
    v_replacement_snapshot := v2.qc_current_product_ingredient_snapshot(
      p_facility_id, v_replacement_id
    );
    v_movement_group := gen_random_uuid();
    v_event_type := 'run-substitution-corrected';
    v_now := clock_timestamp();
    v_payload := jsonb_build_object(
      'targetSubstitutionId', v_previous.id,
      'proposalEventId', v_previous.proposal_event_id,
      'sourceItems', v_source_items,
      'sourceProductId', v_source_id,
      'sourceProductCode', v_source_code,
      'sourceProductName', v_source_name,
      'sourceQuantity', v_source_quantity::text,
      'sourceUnit', v_source_unit,
      'stationKey', v_source_item->>'stationKey',
      'replacementProductId', v_replacement.id,
      'replacementProductCode', v_replacement.code,
      'replacementProductName', v_replacement.name,
      'replacementQuantity', v_replacement_quantity::text,
      'replacementUnit', v_replacement.base_unit,
      'replacementIngredientSnapshot', v_replacement_snapshot,
      'reason', btrim(p_details->>'reason'),
      'movementGroupId', v_movement_group
    );
    INSERT INTO v2.qc_events (
      facility_id, id, run_id, actor_id, request_id, request_hash, event_type, payload, occurred_at
    ) VALUES (
      p_facility_id, v_movement_group, p_run_id, p_actor_id, p_request_id,
      p_request_hash, v_event_type, v_payload, v_now
    ) RETURNING * INTO v_event;
    INSERT INTO v2.qc_run_substitutions (
      facility_id, id, run_id, proposal_event_id, revision, prior_substitution_id,
      source_product_id, source_product_code, source_product_name, source_quantity, source_unit, station_key,
      source_items,
      replacement_product_id, replacement_product_code, replacement_product_name,
      replacement_quantity, replacement_unit, replacement_ingredient_snapshot,
      actor_id, request_id, request_hash,
      movement_group_id, occurred_at
    ) VALUES (
      p_facility_id, gen_random_uuid(), p_run_id, v_previous.proposal_event_id,
      v_current.revision + 1, v_current.id,
      v_source_id, v_source_code, v_source_name, v_source_quantity, v_source_unit,
      v_source_item->>'stationKey',
      v_source_items,
      v_replacement.id, v_replacement.code, v_replacement.name,
      v_replacement_quantity, v_replacement.base_unit, v_replacement_snapshot, p_actor_id,
      p_request_id, p_request_hash, v_movement_group, v_now
    ) RETURNING * INTO v_substitution;

    PERFORM v2.adjust_qc_substitution_inventory(
      p_facility_id, v_warehouse.id, p_run_id, p_actor_id,
      v_movement_group, v_current.replacement_product_id,
      v_current.replacement_quantity, v_replacement.id,
      v_replacement_quantity, 'QC substitution correction for run ' || p_run_id::text,
      v_now
    );
    RETURN jsonb_build_object(
      'event', jsonb_build_object(
        'id', v_event.id, 'runId', v_event.run_id, 'actorId', v_event.actor_id,
        'eventType', v_event.event_type, 'payload', v_event.payload,
        'occurredAt', v_event.occurred_at
      ),
      'substitution', jsonb_build_object(
        'id', v_substitution.id, 'movementGroupId', v_substitution.movement_group_id
      ),
      'replayed', false
    );
  END IF;

  v_now := clock_timestamp();
  INSERT INTO v2.qc_events (
    facility_id, run_id, actor_id, request_id, request_hash, event_type, payload, occurred_at
  ) VALUES (
    p_facility_id, p_run_id, p_actor_id, p_request_id, p_request_hash,
    v_event_type, v_payload, v_now
  ) RETURNING * INTO v_event;
  RETURN jsonb_build_object(
    'event', jsonb_build_object(
      'id', v_event.id, 'runId', v_event.run_id, 'actorId', v_event.actor_id,
      'eventType', v_event.event_type, 'payload', v_event.payload,
      'occurredAt', v_event.occurred_at
    ),
    'replayed', false
  );
END
$$;

CREATE OR REPLACE FUNCTION v2.apply_run_inventory_consumption(
  p_facility_id uuid,
  p_run_id uuid,
  p_actor_id uuid,
  p_plan jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_warehouse_id uuid;
  v_warehouse_name text;
  v_balance v2.inventory_balances%ROWTYPE;
  v_demand record;
  v_deducted numeric;
  v_shortfall numeric;
  v_lines jsonb := '[]'::jsonb;
  v_substitutions jsonb := '[]'::jsonb;
  v_component_demand jsonb := '[]'::jsonb;
  v_detail jsonb;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_facility_id IS NULL OR p_run_id IS NULL OR p_actor_id IS NULL
     OR jsonb_typeof(p_plan) IS DISTINCT FROM 'object'
     OR NOT EXISTS (
       SELECT 1 FROM v2.facility_scope WHERE singleton AND facility_id = p_facility_id
     ) THEN
    RAISE EXCEPTION 'Invalid run inventory scope' USING ERRCODE = '42501';
  END IF;
  BEGIN
    v_warehouse_id := (p_plan->'warehouse'->>'id')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Invalid run inventory warehouse' USING ERRCODE = '22023';
  END;
  SELECT w.name INTO v_warehouse_name
  FROM v2.inventory_warehouses AS w
  WHERE w.facility_id = p_facility_id AND w.id = v_warehouse_id
    AND w.active AND EXISTS (
      SELECT 1 FROM v2.opening_counts AS c
      WHERE c.facility_id = w.facility_id AND c.warehouse_id = w.id AND c.status = 'applied'
    )
  FOR UPDATE;
  IF v_warehouse_name IS NULL THEN
    RAISE EXCEPTION 'The run production warehouse is unavailable' USING ERRCODE = '55000';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', substitution.id,
    'proposalEventId', substitution.proposal_event_id,
    'revision', substitution.revision,
    'sourceItems', substitution.source_items,
    'sourceProductId', substitution.source_product_id,
    'sourceProductCode', substitution.source_product_code,
    'sourceProductName', substitution.source_product_name,
    'sourceQuantity', substitution.source_quantity::text,
    'sourceUnit', substitution.source_unit,
    'stationKey', substitution.station_key,
    'replacementProductId', substitution.replacement_product_id,
    'replacementProductCode', substitution.replacement_product_code,
    'replacementProductName', substitution.replacement_product_name,
    'replacementQuantity', substitution.replacement_quantity::text,
    'replacementUnit', substitution.replacement_unit,
    'replacementIngredientSnapshot', substitution.replacement_ingredient_snapshot,
    'movementGroupId', substitution.movement_group_id,
    'approvedBy', substitution.actor_id,
    'approvedAt', substitution.occurred_at
  ) ORDER BY substitution.occurred_at, substitution.id), '[]'::jsonb)
  INTO v_substitutions
  FROM (
    SELECT DISTINCT ON (record.proposal_event_id) record.*
    FROM v2.qc_run_substitutions AS record
    WHERE record.facility_id = p_facility_id AND record.run_id = p_run_id
    ORDER BY record.proposal_event_id, record.revision DESC
  ) AS substitution;

  WITH station_counts AS (
    SELECT s.station_key,
      CASE
        WHEN s.station_key = 'sauce' AND s.progress->>'barrelsMade' ~ '^[0-9]+$'
          THEN (s.progress->>'barrelsMade')::numeric
        WHEN s.progress->>'batchesMade' ~ '^[0-9]+$'
          THEN (s.progress->>'batchesMade')::numeric
        ELSE 0::numeric
      END AS quantity
    FROM v2.run_station_progress AS s
    WHERE s.facility_id = p_facility_id AND s.run_id = p_run_id
  ),
  source_demand AS (
    SELECT
      (ingredient.value->>'productId')::uuid AS product_id,
      ingredient.value->>'productCode' AS product_code,
      ingredient.value->>'productName' AS product_name,
      ingredient.value->>'unit' AS unit,
      recipe.value->>'code' AS recipe_code,
      recipe.value->>'name' AS recipe_name,
      recipe.value->>'stationKey' AS station_key,
      sum((ingredient.value->>'quantity')::numeric * station.quantity) AS required
    FROM jsonb_array_elements(p_plan->'recipes') AS recipe(value)
    JOIN station_counts AS station ON station.station_key = recipe.value->>'stationKey'
    CROSS JOIN LATERAL jsonb_array_elements(recipe.value->'ingredients') AS ingredient(value)
    GROUP BY ingredient.value->>'productId', ingredient.value->>'productCode',
      ingredient.value->>'productName', ingredient.value->>'unit',
      recipe.value->>'code', recipe.value->>'name', recipe.value->>'stationKey'
  ),
  source_replacements AS (
    SELECT source.value->>'productId' AS product_id,
      source.value->>'recipeCode' AS recipe_code,
      source.value->>'stationKey' AS station_key,
      source.value->>'unit' AS unit,
      sum((source.value->>'quantity')::numeric) AS replaced
    FROM (
      SELECT DISTINCT ON (record.proposal_event_id) record.*
      FROM v2.qc_run_substitutions AS record
      WHERE record.facility_id = p_facility_id AND record.run_id = p_run_id
      ORDER BY record.proposal_event_id, record.revision DESC
    ) AS substitution
    CROSS JOIN LATERAL jsonb_array_elements(substitution.source_items) AS source(value)
    GROUP BY source.value->>'productId', source.value->>'recipeCode',
      source.value->>'stationKey', source.value->>'unit'
  ),
  effective_components AS (
    SELECT source.*,
      greatest(0::numeric, source.required - coalesce(replacement.replaced, 0::numeric)) AS remaining
    FROM source_demand AS source
    LEFT JOIN source_replacements AS replacement
      ON replacement.product_id = source.product_id::text
     AND replacement.recipe_code = source.recipe_code
     AND replacement.station_key = source.station_key
     AND replacement.unit = source.unit
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'productId', component.product_id,
    'productCode', component.product_code,
    'productName', component.product_name,
    'recipeCode', component.recipe_code,
    'recipeName', component.recipe_name,
    'stationKey', component.station_key,
    'unit', component.unit,
    'plannedQuantity', component.required::text,
    'replacedQuantity', greatest(0::numeric, component.required - component.remaining)::text,
    'remainingQuantity', component.remaining::text
  ) ORDER BY component.station_key, component.recipe_code, component.product_id), '[]'::jsonb)
  INTO v_component_demand
  FROM effective_components AS component;

  FOR v_demand IN
    WITH station_counts AS (
      SELECT s.station_key,
        CASE
          WHEN s.station_key = 'sauce' AND s.progress->>'barrelsMade' ~ '^[0-9]+$'
            THEN (s.progress->>'barrelsMade')::numeric
          WHEN s.progress->>'batchesMade' ~ '^[0-9]+$'
            THEN (s.progress->>'batchesMade')::numeric
          ELSE 0::numeric
        END AS quantity
      FROM v2.run_station_progress AS s
      WHERE s.facility_id = p_facility_id AND s.run_id = p_run_id
    ),
    source_demand AS (
      SELECT
        (ingredient.value->>'productId')::uuid AS product_id,
        ingredient.value->>'productCode' AS product_code,
        ingredient.value->>'productName' AS product_name,
        ingredient.value->>'unit' AS unit,
        recipe.value->>'code' AS recipe_code,
        recipe.value->>'stationKey' AS station_key,
        sum((ingredient.value->>'quantity')::numeric * station.quantity) AS required
      FROM jsonb_array_elements(p_plan->'recipes') AS recipe(value)
      JOIN station_counts AS station ON station.station_key = recipe.value->>'stationKey'
      CROSS JOIN LATERAL jsonb_array_elements(recipe.value->'ingredients') AS ingredient(value)
      GROUP BY ingredient.value->>'productId', ingredient.value->>'productCode',
        ingredient.value->>'productName', ingredient.value->>'unit',
        recipe.value->>'code', recipe.value->>'stationKey'
    ),
    substituted_source_amounts AS (
      SELECT
        source.value->>'productId' AS product_id,
        source.value->>'recipeCode' AS recipe_code,
        source.value->>'stationKey' AS station_key,
        source.value->>'unit' AS unit,
        sum((source.value->>'quantity')::numeric) AS replaced
      FROM (
        SELECT DISTINCT ON (record.proposal_event_id) record.*
        FROM v2.qc_run_substitutions AS record
        WHERE record.facility_id = p_facility_id AND record.run_id = p_run_id
        ORDER BY record.proposal_event_id, record.revision DESC
      ) AS substitution
      CROSS JOIN LATERAL jsonb_array_elements(substitution.source_items) AS source(value)
      GROUP BY source.value->>'productId', source.value->>'recipeCode',
        source.value->>'stationKey', source.value->>'unit'
    ),
    adjusted_recipe_demand AS (
      SELECT
        source.product_id, source.product_code, source.product_name, source.unit,
        greatest(0::numeric, source.required - coalesce(substitution.replaced, 0::numeric)) AS required
      FROM source_demand AS source
      LEFT JOIN substituted_source_amounts AS substitution
        ON substitution.product_id = source.product_id::text
       AND substitution.recipe_code = source.recipe_code
       AND substitution.station_key = source.station_key
       AND substitution.unit = source.unit
    ),
    packed_cases AS (
      SELECT coalesce(max(
        CASE WHEN s.progress->>'casesPacked' ~ '^[0-9]+$'
          THEN (s.progress->>'casesPacked')::numeric ELSE 0::numeric END
      ), 0::numeric) AS quantity
      FROM v2.run_station_progress AS s
      WHERE s.facility_id = p_facility_id AND s.run_id = p_run_id AND s.station_key = 'packaging'
    ),
    packaging_demand AS (
      SELECT (line.value->>'productId')::uuid AS product_id,
        line.value->>'productCode' AS product_code,
        line.value->>'productName' AS product_name,
        line.value->>'unit' AS unit,
        sum((line.value->>'quantity')::numeric * packed_cases.quantity) AS required
      FROM jsonb_array_elements(p_plan->'packagingPerCase') AS line(value)
      CROSS JOIN packed_cases
      GROUP BY line.value->>'productId', line.value->>'productCode',
        line.value->>'productName', line.value->>'unit'
    ),
    combined AS (
      SELECT product_id, product_code, product_name, unit, required FROM adjusted_recipe_demand
      UNION ALL
      SELECT product_id, product_code, product_name, unit, required FROM packaging_demand
    )
    SELECT product_id, product_code, product_name, unit, sum(required) AS required
    FROM combined
    WHERE required > 0
    GROUP BY product_id, product_code, product_name, unit
    ORDER BY product_id
  LOOP
    INSERT INTO v2.inventory_balances (facility_id, warehouse_id, product_id)
    VALUES (p_facility_id, v_warehouse_id, v_demand.product_id)
    ON CONFLICT DO NOTHING;
    SELECT * INTO v_balance FROM v2.inventory_balances AS b
    WHERE b.facility_id = p_facility_id
      AND b.warehouse_id = v_warehouse_id AND b.product_id = v_demand.product_id
    FOR UPDATE;
    v_deducted := least(v_demand.required, v_balance.quantity);
    v_shortfall := v_demand.required - v_deducted;
    IF v_deducted > 0 THEN
      IF v_balance.revision >= 9007199254740991 THEN
        RAISE EXCEPTION 'Inventory revision is exhausted' USING ERRCODE = '22003';
      END IF;
      UPDATE v2.inventory_balances
      SET quantity = quantity - v_deducted, revision = revision + 1, updated_at = v_now
      WHERE facility_id = p_facility_id
        AND warehouse_id = v_warehouse_id AND product_id = v_demand.product_id;
      INSERT INTO v2.inventory_movements (
        facility_id, warehouse_id, product_id, movement_group_id, movement_type,
        quantity_delta, reason, actor_id, command_id, occurred_at, run_id
      ) VALUES (
        p_facility_id, v_warehouse_id, v_demand.product_id, p_run_id, 'run_consumption',
        -v_deducted, 'Run completion inventory use', p_actor_id,
        'run:' || p_run_id::text || ':' || v_demand.product_id::text, v_now, p_run_id
      );
    END IF;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'productId', v_demand.product_id, 'productCode', v_demand.product_code,
      'productName', v_demand.product_name, 'unit', v_demand.unit,
      'required', v_demand.required::text, 'deducted', v_deducted::text,
      'shortfall', v_shortfall::text
    ));
  END LOOP;

  v_detail := jsonb_build_object(
    'status', 'completed',
    'runId', p_run_id,
    'warehouseId', v_warehouse_id,
    'warehouseName', v_warehouse_name,
    'lines', v_lines,
    'componentDemand', v_component_demand,
    'qcSubstitutions', v_substitutions,
    'occurredAt', to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
  INSERT INTO v2.run_inventory_consumptions (
    facility_id, run_id, warehouse_id, actor_id, details, occurred_at
  ) VALUES (p_facility_id, p_run_id, v_warehouse_id, p_actor_id, v_detail, v_now);
  RETURN v_detail;
END
$$;

REVOKE ALL ON TABLE v2.qc_run_substitutions FROM PUBLIC;
REVOKE ALL ON FUNCTION v2.prevent_qc_run_substitution_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION v2.resolve_qc_substitution_sources(uuid, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION v2.qc_current_product_ingredient_snapshot(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION v2.adjust_qc_substitution_inventory(uuid, uuid, uuid, uuid, uuid, uuid, numeric, uuid, numeric, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION v2.list_qc_component_products(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION v2.list_qc_run_substitutions(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION v2.record_qc_substitution(uuid, uuid, uuid, text, text, text, uuid, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION v2.apply_run_inventory_consumption(uuid, uuid, uuid, jsonb) FROM PUBLIC;

COMMENT ON TABLE v2.qc_run_substitutions IS
  'Append-only approved per-run substitutions; approval posts replacement stock and completion excludes replaced original quantity.';
COMMENT ON FUNCTION v2.record_qc_substitution(uuid, uuid, uuid, text, text, text, uuid, uuid, jsonb) IS
  'Records QC substitution proposals and decisions; approvals atomically post the replacement inventory movement.';

COMMIT;
