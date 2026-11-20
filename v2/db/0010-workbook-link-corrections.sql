BEGIN;

CREATE OR REPLACE FUNCTION v2.dough_capacity_snapshot(p_facility_id uuid, p_product_code text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
  WITH selected_product AS (
    SELECT p.code
    FROM v2.products AS p
    WHERE p.facility_id = p_facility_id
      AND p.code = p_product_code
      AND p.active
  ),
  dough AS (
    SELECT
      count(*) AS row_count,
      CASE WHEN count(*) = 1 THEN min(
        CASE
          WHEN jsonb_typeof(m.data->'doughballYield') = 'number'
            AND m.data->>'doughballYield' ~ '^[0-9]+(\.[0-9]{1,6})?$'
          THEN (m.data->>'doughballYield')::numeric
          ELSE NULL
        END
      ) END AS doughball_yield
    FROM v2.master_records AS m
    JOIN selected_product AS p ON p.code = m.product_code
    WHERE m.facility_id = p_facility_id
      AND m.kind = 'recipes'
      AND m.data->>'sourceFamily' = 'dough-procedure'
      AND m.data->'capacitySourceCleared' IS DISTINCT FROM 'true'::jsonb
  ),
  shipping AS (
    SELECT
      count(*) AS row_count,
      CASE WHEN count(*) = 1 THEN min(
        CASE
          WHEN jsonb_typeof(m.data->'pizzasPerCase') = 'number'
            AND m.data->>'pizzasPerCase' ~ '^[1-9][0-9]*$'
          THEN (m.data->>'pizzasPerCase')::integer
          ELSE NULL
        END
      ) END AS pizzas_per_case
    FROM v2.master_records AS m
    JOIN selected_product AS p ON p.code = m.product_code
    WHERE m.facility_id = p_facility_id
      AND m.kind = 'production-setups'
      AND m.data->>'sourceFamily' = 'shipping-guide'
      AND m.data->'capacitySourceCleared' IS DISTINCT FROM 'true'::jsonb
  ),
  status AS (
    SELECT
      EXISTS (SELECT 1 FROM selected_product) AS product_found,
      dough.row_count AS dough_count,
      dough.doughball_yield,
      shipping.row_count AS shipping_count,
      shipping.pizzas_per_case
    FROM dough CROSS JOIN shipping
  )
  SELECT jsonb_build_object(
    'status', CASE
      WHEN product_found
        AND dough_count = 1
        AND shipping_count = 1
        AND doughball_yield BETWEEN 0.000001 AND 1000000
        AND pizzas_per_case BETWEEN 1 AND 100
        AND round(doughball_yield / pizzas_per_case, 4) > 0
      THEN 'available'
      ELSE 'unavailable'
    END,
    'reasons', to_jsonb(array_remove(ARRAY[
      CASE WHEN NOT product_found THEN 'product_not_selected' END,
      CASE WHEN product_found AND dough_count = 0 THEN 'dough_source_missing' END,
      CASE WHEN product_found AND dough_count > 1 THEN 'dough_source_ambiguous' END,
      CASE WHEN product_found AND dough_count = 1
        AND (doughball_yield IS NULL OR doughball_yield NOT BETWEEN 0.000001 AND 1000000
          OR (pizzas_per_case BETWEEN 1 AND 100 AND round(doughball_yield / pizzas_per_case, 4) <= 0))
        THEN 'dough_yield_invalid' END,
      CASE WHEN product_found AND shipping_count = 0 THEN 'shipping_source_missing' END,
      CASE WHEN product_found AND shipping_count > 1 THEN 'shipping_source_ambiguous' END,
      CASE WHEN product_found AND shipping_count = 1
        AND (pizzas_per_case IS NULL OR pizzas_per_case NOT BETWEEN 1 AND 100)
        THEN 'pizzas_per_case_invalid' END
    ], NULL)),
    'doughballYield', CASE
      WHEN dough_count = 1 AND doughball_yield BETWEEN 0.000001 AND 1000000
        AND pizzas_per_case BETWEEN 1 AND 100
        AND round(doughball_yield / pizzas_per_case, 4) > 0
      THEN doughball_yield ELSE NULL END,
    'pizzasPerCase', CASE
      WHEN shipping_count = 1 AND pizzas_per_case BETWEEN 1 AND 100
      THEN pizzas_per_case ELSE NULL END
  )
  FROM status
$$;

CREATE FUNCTION v2.correct_workbook_source_link(
  p_facility_id uuid,
  p_actor_id uuid,
  p_request_id text,
  p_request_hash text,
  p_source_family text,
  p_source_key text,
  p_expected_product_code text,
  p_product_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_existing_hash text;
  v_existing_response jsonb;
  v_source_id uuid;
  v_kind text;
  v_current_product_code text;
  v_previous_product_code text;
  v_target_product_code text;
  v_source_count integer;
  v_response jsonb;
  v_now timestamptz;
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM v2.facility_scope
       WHERE singleton AND facility_id = p_facility_id
     ) THEN
    RAISE EXCEPTION 'Invalid workbook link facility scope' USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL OR length(btrim(p_request_id)) NOT BETWEEN 1 AND 200
     OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$'
     OR p_source_family NOT IN ('dough-procedure', 'shipping-guide')
     OR p_source_key IS NULL OR p_source_key !~ '^[0-9a-f]{64}$'
     OR (p_expected_product_code IS NOT NULL
       AND p_expected_product_code !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$')
     OR (p_product_code IS NOT NULL
       AND p_product_code !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$') THEN
    RAISE EXCEPTION 'Invalid workbook link correction' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_facility_id::text || ':' || p_actor_id::text || ':workbook-link:' || p_request_id, 0)
  );
  SELECT request_hash, response
    INTO v_existing_hash, v_existing_response
    FROM v2.command_receipts
    WHERE facility_id = p_facility_id
      AND actor_id = p_actor_id
      AND command_id = p_request_id;
  IF FOUND THEN
    IF v_existing_hash <> p_request_hash THEN
      RAISE EXCEPTION 'Workbook link request ID was reused with different details'
        USING ERRCODE = '22023';
    END IF;
    RETURN v_existing_response || jsonb_build_object('replayed', true);
  END IF;

  v_kind := CASE p_source_family
    WHEN 'dough-procedure' THEN 'recipes'
    ELSE 'production-setups'
  END;

  SELECT count(*) INTO v_source_count
  FROM v2.master_records
  WHERE facility_id = p_facility_id
    AND kind = v_kind
    AND data->>'sourceFamily' = p_source_family
    AND data->>'sourceKey' = p_source_key;
  IF v_source_count <> 1 THEN
    RAISE EXCEPTION 'The saved workbook source is missing or ambiguous'
      USING ERRCODE = CASE WHEN v_source_count = 0 THEN 'P0002' ELSE '23514' END;
  END IF;

  SELECT id, product_code,
         CASE WHEN data->>'capacitySourceCleared' = 'true' THEN NULL ELSE product_code END
    INTO v_source_id, v_current_product_code, v_previous_product_code
    FROM v2.master_records
    WHERE facility_id = p_facility_id
      AND kind = v_kind
      AND data->>'sourceFamily' = p_source_family
      AND data->>'sourceKey' = p_source_key
    FOR UPDATE;
  IF v_previous_product_code IS DISTINCT FROM p_expected_product_code THEN
    RAISE EXCEPTION 'The saved workbook link changed while it was being reviewed'
      USING ERRCODE = '40001';
  END IF;
  IF (SELECT data->>'capacitySourceCleared'
      FROM v2.master_records
      WHERE facility_id = p_facility_id AND kind = v_kind AND id = v_source_id)
      = 'true'
     AND p_product_code IS NULL THEN
    v_response := jsonb_build_object(
      'outcome', 'unchanged',
      'sourceFamily', p_source_family,
      'sourceKey', p_source_key,
      'previousProductCode', NULL,
      'productCode', NULL,
      'replayed', false
    );
    v_now := clock_timestamp();
    INSERT INTO v2.command_receipts (facility_id, actor_id, command_id, request_hash, response, created_at)
    VALUES (p_facility_id, p_actor_id, p_request_id, p_request_hash, v_response, v_now);
    RETURN v_response;
  END IF;

  IF p_product_code IS NOT NULL THEN
    SELECT code INTO v_target_product_code
    FROM v2.products
    WHERE facility_id = p_facility_id
      AND lower(code) = lower(p_product_code)
      AND active
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Workbook link target must be an active product in this facility'
        USING ERRCODE = '23503';
    END IF;
  END IF;

  v_now := clock_timestamp();
  IF p_product_code IS NULL THEN
    UPDATE v2.master_records
    SET data = jsonb_set(data, '{capacitySourceCleared}', 'true'::jsonb, true),
        source_import_id = NULL,
        updated_at = v_now
    WHERE facility_id = p_facility_id AND kind = v_kind AND id = v_source_id;
    v_response := jsonb_build_object(
      'outcome', 'cleared',
      'sourceFamily', p_source_family,
      'sourceKey', p_source_key,
       'previousProductCode', v_previous_product_code,
      'productCode', NULL,
      'replayed', false
    );
  ELSIF p_expected_product_code IS NOT NULL
     AND lower(v_current_product_code) = lower(v_target_product_code) THEN
    v_response := jsonb_build_object(
      'outcome', 'unchanged',
      'sourceFamily', p_source_family,
      'sourceKey', p_source_key,
      'previousProductCode', v_previous_product_code,
      'productCode', v_previous_product_code,
      'replayed', false
    );
  ELSE
    UPDATE v2.master_records
    SET product_code = v_target_product_code,
        data = data - 'capacitySourceCleared',
        source_import_id = NULL,
        updated_at = v_now
    WHERE facility_id = p_facility_id AND kind = v_kind AND id = v_source_id;
    v_response := jsonb_build_object(
      'outcome', 'corrected',
      'sourceFamily', p_source_family,
      'sourceKey', p_source_key,
      'previousProductCode', v_previous_product_code,
      'productCode', v_target_product_code,
      'replayed', false
    );
  END IF;

  INSERT INTO v2.command_receipts (facility_id, actor_id, command_id, request_hash, response, created_at)
  VALUES (p_facility_id, p_actor_id, p_request_id, p_request_hash, v_response, v_now);
  RETURN v_response;
END
$$;

CREATE OR REPLACE FUNCTION v2.list_workbook_source_links(p_facility_id uuid, p_source_family text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
BEGIN
  IF p_facility_id IS NULL OR p_source_family NOT IN ('dough-procedure', 'shipping-guide')
     OR NOT EXISTS (
       SELECT 1 FROM v2.facility_scope
       WHERE singleton AND facility_id = p_facility_id
     ) THEN
    RAISE EXCEPTION 'Invalid workbook source scope' USING ERRCODE = '42501';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'sourceKey', links.source_key,
      'productCode', links.product_code
    ) ORDER BY links.source_key)
    FROM (
      SELECT m.data->>'sourceKey' AS source_key, p.code AS product_code
      FROM v2.master_records AS m
      JOIN v2.products AS p
        ON p.facility_id = m.facility_id
        AND p.code = m.product_code
        AND p.active
      WHERE m.facility_id = p_facility_id
        AND m.data->>'sourceFamily' = p_source_family
        AND m.data->'capacitySourceCleared' IS DISTINCT FROM 'true'::jsonb
        AND m.data->>'sourceKey' ~ '^[0-9a-f]{64}$'
      UNION ALL
      SELECT m.data->>'sourceKey' AS source_key, NULL::text AS product_code
      FROM v2.master_records AS m
      WHERE m.facility_id = p_facility_id
        AND m.data->>'sourceFamily' = p_source_family
        AND m.data->'capacitySourceCleared' = 'true'::jsonb
        AND m.data->>'sourceKey' ~ '^[0-9a-f]{64}$'
    ) AS links
  ), '[]'::jsonb);
END
$$;

REVOKE ALL ON FUNCTION v2.correct_workbook_source_link(uuid, uuid, text, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION v2.list_workbook_source_links(uuid, text) FROM PUBLIC;
COMMENT ON FUNCTION v2.correct_workbook_source_link(uuid, uuid, text, text, text, text, text, text) IS
  'Manager-reviewed, facility-scoped workbook source link correction with expected-value protection and idempotent retries; corrections detach prior import ownership so guarded Undo cannot overwrite them.';

COMMIT;
