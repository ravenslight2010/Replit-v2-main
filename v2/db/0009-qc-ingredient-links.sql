BEGIN;

CREATE TABLE v2.qc_ingredient_link_events (
  facility_id uuid NOT NULL REFERENCES v2.facility_scope (facility_id) ON DELETE RESTRICT,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL,
  request_id text NOT NULL CHECK (length(btrim(request_id)) BETWEEN 1 AND 200),
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  product_id uuid NOT NULL,
  product_code_snapshot text NOT NULL,
  product_name_snapshot text NOT NULL,
  action text NOT NULL CHECK (action IN ('linked', 'unlinked')),
  previous_ingredient_code text,
  previous_ingredient_name text,
  ingredient_code text,
  ingredient_name text,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (facility_id, id),
  UNIQUE (facility_id, actor_id, request_id),
  FOREIGN KEY (facility_id, product_id)
    REFERENCES v2.products (facility_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (facility_id, previous_ingredient_code)
    REFERENCES v2.setup_ingredient_records (facility_id, code) ON DELETE RESTRICT,
  FOREIGN KEY (facility_id, ingredient_code)
    REFERENCES v2.setup_ingredient_records (facility_id, code) ON DELETE RESTRICT,
  CHECK (
    (action = 'linked' AND ingredient_code IS NOT NULL AND ingredient_name IS NOT NULL)
    OR (action = 'unlinked' AND ingredient_code IS NULL AND ingredient_name IS NULL)
  )
);

CREATE INDEX qc_ingredient_link_events_latest
  ON v2.qc_ingredient_link_events (facility_id, product_id, occurred_at DESC, id DESC);
CREATE INDEX qc_ingredient_link_events_history
  ON v2.qc_ingredient_link_events (facility_id, occurred_at DESC, id DESC);

CREATE FUNCTION v2.prevent_qc_ingredient_link_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, v2
AS $$
BEGIN
  RAISE EXCEPTION 'Ingredient-link audit records are append-only'
    USING ERRCODE = '55000';
END
$$;

CREATE TRIGGER qc_ingredient_link_events_append_only
  BEFORE UPDATE OR DELETE ON v2.qc_ingredient_link_events
  FOR EACH ROW EXECUTE FUNCTION v2.prevent_qc_ingredient_link_event_mutation();

CREATE FUNCTION v2.actor_can_manage_allergens(p_actor_id uuid)
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
      AND role.capabilities ? 'manage-allergens'
  )
$$;

CREATE FUNCTION v2.list_qc_ingredient_links(
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
    RAISE EXCEPTION 'Invalid ingredient-link request' USING ERRCODE = '22023';
  END IF;
  IF NOT v2.actor_can_manage_allergens(p_actor_id) THEN
    RAISE EXCEPTION 'Allergen management is not authorized' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'products', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'productId', product.id,
        'productCode', product.code,
        'productName', product.name,
        'ingredientCode', CASE WHEN product.action = 'linked' THEN product.ingredient_code END,
        'ingredientName', CASE WHEN product.action = 'linked' THEN product.ingredient_name END,
        'linkedAt', CASE WHEN product.action = 'linked' THEN product.occurred_at END,
        'linkedBy', CASE WHEN product.action = 'linked' THEN product.actor_id END,
        'linkEventId', CASE WHEN product.action = 'linked' THEN product.event_id END
      ) ORDER BY lower(product.name), product.code)
      FROM (
        SELECT
          product.id, product.code, product.name, latest.action,
          latest.ingredient_code, latest.ingredient_name, latest.occurred_at,
          latest.actor_id, latest.id AS event_id
        FROM v2.products AS product
        LEFT JOIN LATERAL (
          SELECT event.*
          FROM v2.qc_ingredient_link_events AS event
          WHERE event.facility_id = p_facility_id
            AND event.product_id = product.id
          ORDER BY event.occurred_at DESC, event.id DESC
          LIMIT 1
        ) AS latest ON true
        WHERE product.facility_id = p_facility_id
          AND product.active
        ORDER BY lower(product.name), product.code
        LIMIT 2000
      ) AS product
    ), '[]'::jsonb),
    'productsTruncated', (
      SELECT count(*) > 2000
      FROM v2.products AS product
      WHERE product.facility_id = p_facility_id AND product.active
    ),
    'ingredients', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'ingredientCode', ingredient.code,
        'ingredientName', ingredient.name,
        'allergens', ingredient.data->'allergens',
        'allergensReviewed', ingredient.data->'allergensReviewed',
        'updatedAt', ingredient.updated_at
      ) ORDER BY lower(ingredient.name), ingredient.code)
      FROM (
        SELECT ingredient.*
        FROM v2.setup_ingredient_records AS ingredient
        WHERE ingredient.facility_id = p_facility_id
          AND ingredient.data->>'enabled' = 'true'
          AND ingredient.merged_into_code IS NULL
        ORDER BY lower(ingredient.name), ingredient.code
        LIMIT 2000
      ) AS ingredient
    ), '[]'::jsonb),
    'ingredientsTruncated', (
      SELECT count(*) > 2000
      FROM v2.setup_ingredient_records AS ingredient
      WHERE ingredient.facility_id = p_facility_id
        AND ingredient.data->>'enabled' = 'true'
        AND ingredient.merged_into_code IS NULL
    ),
    'events', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', event.id,
        'actorId', event.actor_id,
        'productId', event.product_id,
        'productCode', event.product_code_snapshot,
        'productName', event.product_name_snapshot,
        'action', event.action,
        'previousIngredientCode', event.previous_ingredient_code,
        'previousIngredientName', event.previous_ingredient_name,
        'ingredientCode', event.ingredient_code,
        'ingredientName', event.ingredient_name,
        'occurredAt', event.occurred_at
      ) ORDER BY event.occurred_at DESC, event.id DESC)
      FROM (
        SELECT * FROM v2.qc_ingredient_link_events
        WHERE facility_id = p_facility_id
        ORDER BY occurred_at DESC, id DESC
        LIMIT 100
      ) AS event
    ), '[]'::jsonb)
  );
END
$$;

CREATE FUNCTION v2.record_qc_ingredient_link(
  p_facility_id uuid,
  p_actor_id uuid,
  p_request_id text,
  p_request_hash text,
  p_product_id uuid,
  p_ingredient_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_existing v2.qc_ingredient_link_events%ROWTYPE;
  v_event v2.qc_ingredient_link_events%ROWTYPE;
  v_product v2.products%ROWTYPE;
  v_ingredient v2.setup_ingredient_records%ROWTYPE;
  v_previous v2.qc_ingredient_link_events%ROWTYPE;
  v_previous_code text;
  v_previous_name text;
  v_ingredient_code text;
  v_action text;
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL OR p_product_id IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM v2.facility_scope
       WHERE singleton AND facility_id = p_facility_id
     )
     OR p_request_id IS NULL OR length(btrim(p_request_id)) NOT BETWEEN 1 AND 200
     OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$'
     OR (p_ingredient_code IS NOT NULL AND (
       length(btrim(p_ingredient_code)) NOT BETWEEN 1 AND 80
       OR p_ingredient_code !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$'
     )) THEN
    RAISE EXCEPTION 'Invalid ingredient-link request' USING ERRCODE = '22023';
  END IF;
  IF NOT v2.actor_can_manage_allergens(p_actor_id) THEN
    RAISE EXCEPTION 'Allergen management is not authorized' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_facility_id::text || ':' || p_actor_id::text || ':qc-link:' || p_request_id, 0
  ));
  SELECT * INTO v_existing
  FROM v2.qc_ingredient_link_events
  WHERE facility_id = p_facility_id
    AND actor_id = p_actor_id
    AND request_id = p_request_id;
  IF FOUND THEN
    IF v_existing.request_hash <> p_request_hash OR v_existing.product_id <> p_product_id
       OR lower(v_existing.ingredient_code) IS DISTINCT FROM lower(p_ingredient_code) THEN
      RAISE EXCEPTION 'Ingredient-link request ID was reused with different details'
        USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object(
      'event', jsonb_build_object(
        'id', v_existing.id,
        'actorId', v_existing.actor_id,
        'productId', v_existing.product_id,
        'productCode', v_existing.product_code_snapshot,
        'productName', v_existing.product_name_snapshot,
        'action', v_existing.action,
        'previousIngredientCode', v_existing.previous_ingredient_code,
        'previousIngredientName', v_existing.previous_ingredient_name,
        'ingredientCode', v_existing.ingredient_code,
        'ingredientName', v_existing.ingredient_name,
        'occurredAt', v_existing.occurred_at
      ),
      'replayed', true
    );
  END IF;

  SELECT * INTO v_product
  FROM v2.products
  WHERE facility_id = p_facility_id
    AND id = p_product_id
    AND active
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inventory product is unavailable' USING ERRCODE = 'P0002';
  END IF;

  v_action := CASE WHEN p_ingredient_code IS NULL THEN 'unlinked' ELSE 'linked' END;
  IF p_ingredient_code IS NOT NULL THEN
    SELECT * INTO v_ingredient
    FROM v2.setup_ingredient_records
    WHERE facility_id = p_facility_id
      AND lower(code) = lower(p_ingredient_code)
      AND data->>'enabled' = 'true'
      AND merged_into_code IS NULL
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Choose an enabled canonical ingredient identity' USING ERRCODE = '22023';
    END IF;
    v_ingredient_code := v_ingredient.code;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_facility_id::text || ':' || p_product_id::text || ':qc-ingredient-link', 0
  ));
  SELECT * INTO v_previous
  FROM v2.qc_ingredient_link_events
  WHERE facility_id = p_facility_id
    AND product_id = p_product_id
  ORDER BY occurred_at DESC, id DESC
  LIMIT 1;
  IF FOUND AND v_previous.action = 'linked' THEN
    v_previous_code := v_previous.ingredient_code;
    v_previous_name := v_previous.ingredient_name;
  END IF;

  INSERT INTO v2.qc_ingredient_link_events (
    facility_id, actor_id, request_id, request_hash,
    product_id, product_code_snapshot, product_name_snapshot,
    action, previous_ingredient_code, previous_ingredient_name,
    ingredient_code, ingredient_name
  ) VALUES (
    p_facility_id, p_actor_id, p_request_id, p_request_hash,
    p_product_id, v_product.code, v_product.name,
    v_action, v_previous_code, v_previous_name,
    v_ingredient_code, CASE WHEN v_ingredient_code IS NULL THEN NULL ELSE v_ingredient.name END
  )
  RETURNING * INTO v_event;

  RETURN jsonb_build_object(
    'event', jsonb_build_object(
      'id', v_event.id,
      'actorId', v_event.actor_id,
      'productId', v_event.product_id,
      'productCode', v_event.product_code_snapshot,
      'productName', v_event.product_name_snapshot,
      'action', v_event.action,
      'previousIngredientCode', v_event.previous_ingredient_code,
      'previousIngredientName', v_event.previous_ingredient_name,
      'ingredientCode', v_event.ingredient_code,
      'ingredientName', v_event.ingredient_name,
      'occurredAt', v_event.occurred_at
    ),
    'replayed', false
  );
END
$$;

CREATE FUNCTION v2.snapshot_run_ingredient_allergens()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_plan jsonb;
  v_recipes jsonb;
  v_recipe jsonb;
  v_ingredients jsonb;
  v_ingredient jsonb;
  v_snapshot jsonb;
  v_product_id uuid;
  v_recipe_index integer;
  v_ingredient_index integer;
  v_link v2.qc_ingredient_link_events%ROWTYPE;
  v_catalog v2.setup_ingredient_records%ROWTYPE;
BEGIN
  v_plan := NEW.setup_snapshot->'productionPlan';
  v_recipes := v_plan->'recipes';
  IF jsonb_typeof(v_recipes) IS DISTINCT FROM 'array' THEN
    RETURN NEW;
  END IF;

  IF jsonb_array_length(v_recipes) > 0 THEN
    FOR v_recipe_index IN 0..jsonb_array_length(v_recipes) - 1 LOOP
      v_recipe := v_recipes->v_recipe_index;
      v_ingredients := v_recipe->'ingredients';
      IF jsonb_typeof(v_ingredients) IS DISTINCT FROM 'array' THEN
        CONTINUE;
      END IF;
      IF jsonb_array_length(v_ingredients) > 0 THEN
        FOR v_ingredient_index IN 0..jsonb_array_length(v_ingredients) - 1 LOOP
          v_ingredient := v_ingredients->v_ingredient_index;
          v_snapshot := jsonb_build_object(
            'status', 'unknown',
            'reason', 'missing-link'
          );
          IF coalesce(v_ingredient->>'productId', '') ~*
             '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
            v_product_id := (v_ingredient->>'productId')::uuid;
            SELECT * INTO v_link
            FROM v2.qc_ingredient_link_events AS event
            WHERE event.facility_id = NEW.facility_id
              AND event.product_id = v_product_id
            ORDER BY event.occurred_at DESC, event.id DESC
            LIMIT 1;
            IF FOUND AND v_link.action = 'linked' THEN
              SELECT * INTO v_catalog
              FROM v2.setup_ingredient_records AS ingredient
              WHERE ingredient.facility_id = NEW.facility_id
                AND ingredient.code = v_link.ingredient_code
                AND ingredient.data->>'enabled' = 'true'
                AND ingredient.merged_into_code IS NULL;
              IF FOUND THEN
                v_snapshot := jsonb_build_object(
                  'status', 'linked',
                  'ingredientCode', v_catalog.code,
                  'ingredientName', v_catalog.name,
                  'allergens', v_catalog.data->'allergens',
                  'allergensReviewed', v_catalog.data->'allergensReviewed',
                  'linkEventId', v_link.id,
                  'ingredientUpdatedAt',
                    to_char(v_catalog.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
                );
              ELSE
                v_snapshot := jsonb_build_object(
                  'status', 'unknown',
                  'reason', 'canonical-ingredient-unavailable',
                  'linkEventId', v_link.id
                );
              END IF;
            END IF;
          END IF;
          v_ingredient := v_ingredient || jsonb_build_object('ingredientSnapshot', v_snapshot);
          v_ingredients := jsonb_set(v_ingredients, ARRAY[v_ingredient_index::text], v_ingredient);
        END LOOP;
      END IF;
      v_recipe := jsonb_set(v_recipe, '{ingredients}', v_ingredients);
      v_recipes := jsonb_set(v_recipes, ARRAY[v_recipe_index::text], v_recipe);
    END LOOP;
  END IF;

  v_plan := jsonb_set(v_plan, '{recipes}', v_recipes);
  NEW.setup_snapshot := jsonb_set(NEW.setup_snapshot, '{productionPlan}', v_plan);
  RETURN NEW;
END
$$;

CREATE TRIGGER runs_snapshot_ingredient_allergens
  BEFORE INSERT ON v2.runs
  FOR EACH ROW EXECUTE FUNCTION v2.snapshot_run_ingredient_allergens();

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
    'correction',
    'redaction'
  ));

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
       'review-signed-off', 'run-check-reviewed', 'correction', 'redaction'
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

REVOKE ALL ON TABLE v2.qc_ingredient_link_events FROM PUBLIC;
REVOKE ALL ON FUNCTION v2.prevent_qc_ingredient_link_event_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION v2.actor_can_manage_allergens(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION v2.list_qc_ingredient_links(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION v2.record_qc_ingredient_link(uuid, uuid, text, text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION v2.snapshot_run_ingredient_allergens() FROM PUBLIC;
REVOKE ALL ON FUNCTION v2.record_qc_event(uuid, uuid, uuid, text, text, text, jsonb) FROM PUBLIC;

COMMENT ON TABLE v2.qc_ingredient_link_events IS
  'Append-only manager-reviewed links from inventory products to existing canonical setup ingredients.';
COMMENT ON FUNCTION v2.snapshot_run_ingredient_allergens() IS
  'Freezes the current reviewed ingredient identity and allergen facts into new run snapshots; never backfills historical runs.';

COMMIT;
