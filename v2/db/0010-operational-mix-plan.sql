BEGIN;

CREATE FUNCTION v2.get_operational_mix_plan_sources(p_facility_id uuid, p_make_date date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
BEGIN
  IF p_facility_id IS NULL OR p_make_date IS NULL OR NOT EXISTS (
    SELECT 1 FROM v2.facility_scope
    WHERE singleton AND facility_id = p_facility_id
  ) THEN
    RAISE EXCEPTION 'Invalid operational mix plan scope' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'makeDate', p_make_date,
    'timeZone', 'America/Chicago',
    'mixes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'code', m.code,
        'name', m.name,
        'enabled', COALESCE((m.data->>'enabled')::boolean, false),
        'isPrep', COALESCE((m.data->>'isPrep')::boolean, false),
        'brand', m.data->>'brand',
        'flavor', m.data->>'flavor',
        'daysEarly', m.data->'daysEarly',
        'batchSizeLbs', m.data->'batchSizeLbs',
        'outputProductCode', output_product.code,
        'outputProductName', output_product.name,
        'outputProductUnit', output_product.base_unit,
        'outputStockUnitsPerLb', output_link.stock_units_per_lb::text,
        'components', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'ingredientName', component.value->>'ingredientName',
            'declaredIngredientCode', component.value->>'ingredientCode',
            'linkedIngredientCode', component_link.ingredient_code,
            'ingredientCode', COALESCE(component_link.ingredient_code, component.value->>'ingredientCode'),
            'perPizzaOz', component.value->'perPizzaOz',
            'perBatchLbs', component.value->'perBatchLbs',
            'productCode', raw_product.code,
            'productName', raw_product.name,
            'productUnit', raw_product.base_unit,
            'stockUnitsPerLb', ingredient_link.stock_units_per_lb::text
          ) ORDER BY component.ordinality)
          FROM jsonb_array_elements(COALESCE(m.data->'components', '[]'::jsonb))
            WITH ORDINALITY AS component(value, ordinality)
          LEFT JOIN v2.setup_mix_component_links component_link
            ON component_link.facility_id = m.facility_id
            AND lower(component_link.mix_code) = lower(m.code)
            AND component_link.component_index = component.ordinality - 1
          LEFT JOIN v2.setup_ingredient_inventory_links ingredient_link
            ON ingredient_link.facility_id = m.facility_id
            AND lower(ingredient_link.ingredient_code)
              = lower(COALESCE(component_link.ingredient_code, component.value->>'ingredientCode'))
          LEFT JOIN v2.products raw_product
            ON raw_product.facility_id = ingredient_link.facility_id
            AND raw_product.id = ingredient_link.product_id
            AND raw_product.active
        ), '[]'::jsonb)
      ) ORDER BY lower(m.name), m.code)
      FROM v2.setup_mix_records m
      LEFT JOIN v2.setup_mix_inventory_links output_link
        ON output_link.facility_id = m.facility_id
        AND lower(output_link.mix_code) = lower(m.code)
      LEFT JOIN v2.products output_product
        ON output_product.facility_id = output_link.facility_id
        AND output_product.id = output_link.product_id
        AND output_product.active
      WHERE m.facility_id = p_facility_id
    ), '[]'::jsonb),
    'schedules', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'date', s.production_date,
        'revision', s.revision,
        'runs', s.plan->'runs'
      ) ORDER BY s.production_date)
      FROM v2.production_schedules s
      WHERE s.facility_id = p_facility_id
        AND s.production_date >= p_make_date
        AND s.production_date < p_make_date + 366
    ), '[]'::jsonb),
    'scheduleHorizonTruncated', EXISTS (
      SELECT 1 FROM v2.production_schedules s
      WHERE s.facility_id = p_facility_id
        AND s.production_date >= p_make_date + 366
    ),
    'templates', v2.list_schedule_run_templates(p_facility_id),
    'setups', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'productCode', setup.product_code,
        'productionSetupCode', setup.code,
        'productionSetupName', setup.name,
        'recipes', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'code', recipe.code,
            'name', recipe.name,
            'stationKey', recipe.data->>'station_key',
            'ingredients', COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                'productCode', ingredient.value->>'product_code',
                'productName', COALESCE(product.name, ingredient.value->>'product_code'),
                'quantity', ingredient.value->'quantity',
                'unit', ingredient.value->'unit'
              ) ORDER BY ingredient.ordinality)
              FROM jsonb_array_elements(COALESCE(recipe.data->'ingredients', '[]'::jsonb))
                WITH ORDINALITY AS ingredient(value, ordinality)
              LEFT JOIN v2.products product
                ON product.facility_id = setup.facility_id
                AND lower(product.code) = lower(ingredient.value->>'product_code')
                AND product.active
            ), '[]'::jsonb)
          ) ORDER BY requested.ordinality)
          FROM jsonb_array_elements_text(setup.data->'recipe_codes')
            WITH ORDINALITY AS requested(code, ordinality)
          JOIN v2.master_records recipe
            ON recipe.facility_id = setup.facility_id
            AND recipe.kind = 'recipes'
            AND lower(recipe.product_code) = lower(setup.product_code)
            AND lower(recipe.code) = lower(requested.code)
        ), '[]'::jsonb)
      ) ORDER BY lower(setup.product_code), lower(setup.name), setup.code)
      FROM v2.master_records setup
      WHERE setup.facility_id = p_facility_id
        AND setup.kind = 'production-setups'
        AND setup.data->>'sourceFamily' IS NULL
        AND jsonb_typeof(setup.data->'recipe_codes') = 'array'
        AND jsonb_typeof(setup.data->'packaging_per_case') = 'array'
    ), '[]'::jsonb),
    'activeRuns', COALESCE((
      SELECT jsonb_agg(v2.run_snapshot(p_facility_id, r.id) ORDER BY r.started_at, r.id)
      FROM v2.runs r
      WHERE r.facility_id = p_facility_id
        AND r.status IN ('running', 'paused')
    ), '[]'::jsonb),
    'substitutions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'runId', supply.run_id,
        'plannedProductCode', planned.code,
        'actualProductCode', actual.code,
        'actualProductName', actual.name,
        'unit', actual.base_unit,
        'quantity', supply.quantity::text
      ) ORDER BY supply.run_id, supply.occurred_at, supply.id)
      FROM v2.run_inventory_staged_supplies supply
      JOIN v2.runs run
        ON run.facility_id = supply.facility_id
        AND run.id = supply.run_id
        AND run.status IN ('running', 'paused')
      JOIN v2.products planned
        ON planned.facility_id = supply.facility_id
        AND planned.id = supply.planned_product_id
      JOIN v2.products actual
        ON actual.facility_id = supply.facility_id
        AND actual.id = supply.actual_product_id
      WHERE supply.facility_id = p_facility_id
    ), '[]'::jsonb)
  );
END
$$;

REVOKE ALL ON FUNCTION v2.get_operational_mix_plan_sources(uuid, date) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'v2_runtime_access') THEN
    GRANT EXECUTE ON FUNCTION v2.get_operational_mix_plan_sources(uuid, date) TO v2_runtime_access;
  END IF;
END
$$;

COMMENT ON FUNCTION v2.get_operational_mix_plan_sources(uuid, date) IS
  'Read-only canonical sources for the operator mix plan; active runs remain frozen snapshots.';

COMMIT;
