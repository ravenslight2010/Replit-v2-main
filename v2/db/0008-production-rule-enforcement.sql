-- Recovery reconstruction of imported-rule enforcement.
-- Apply only through an explicitly approved database change. Startup never runs SQL.
BEGIN;

CREATE FUNCTION v2.production_rule_value(p_setup jsonb, p_field text)
RETURNS jsonb LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT CASE
    WHEN p_field = 'casesNeeded' THEN p_setup->'targetCases'
    WHEN p_field IN ('label', 'targetCases', 'productCode', 'productionSetupCode',
      'brand', 'flavor', 'lineSpeed', 'targetDoughballWeight',
      'sauceOzPerPizza', 'dieType') THEN p_setup->p_field
    ELSE NULL
  END
$$;

CREATE FUNCTION v2.assess_production_rules(
  p_facility_id uuid, p_setup jsonb, p_run_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  r record;
  v_value jsonb;
  v_previous jsonb;
  v_before jsonb;
  v_status text;
  v_result jsonb := '[]'::jsonb;
BEGIN
  SELECT setup_snapshot INTO v_previous FROM v2.runs
  WHERE facility_id = p_facility_id AND id IS DISTINCT FROM p_run_id
    AND started_at IS NOT NULL
    AND (p_run_id IS NULL OR started_at < COALESCE(
      (SELECT started_at FROM v2.runs WHERE facility_id = p_facility_id AND id = p_run_id),
      'infinity'::timestamptz))
  ORDER BY started_at DESC, id DESC LIMIT 1;

  FOR r IN SELECT code, name, data, source_import_id
    FROM v2.setup_production_rule_records
    WHERE facility_id = p_facility_id AND source_import_id IS NOT NULL
      AND data->'enabled' = 'true'::jsonb
    ORDER BY code
  LOOP
    v_value := v2.production_rule_value(p_setup, r.data->>'field');
    v_status := 'unknown';
    IF r.data->>'type' = 'required-field' THEN
      v_status := CASE
        WHEN v_value IS NULL OR v_value = 'null'::jsonb THEN 'unknown'
        WHEN btrim(v_value #>> '{}') = '' THEN 'violated'
        ELSE 'passed' END;
    ELSIF r.data->>'type' = 'numeric-range' AND jsonb_typeof(v_value) = 'number' THEN
      v_status := CASE WHEN
        (jsonb_typeof(r.data->'min') <> 'number' OR (v_value::text)::numeric >= (r.data->>'min')::numeric)
        AND (jsonb_typeof(r.data->'max') <> 'number' OR (v_value::text)::numeric <= (r.data->>'max')::numeric)
        THEN 'passed' ELSE 'violated' END;
    ELSIF r.data->>'type' = 'sequence' THEN
      v_value := v2.production_rule_value(p_setup, r.data->>'attribute');
      v_before := v2.production_rule_value(v_previous, r.data->>'attribute');
      IF v_previous IS NULL THEN
        v_status := 'passed';
      ELSIF v_value IS NOT NULL AND v_value <> 'null'::jsonb
        AND v_before IS NOT NULL AND v_before <> 'null'::jsonb THEN
        v_status := CASE
          WHEN lower(v_before #>> '{}') <> lower(r.data->>'before')
            OR lower(v_value #>> '{}') = lower(r.data->>'after')
          THEN 'passed' ELSE 'violated' END;
      END IF;
    END IF;
    -- Only the bypass conditions in a manager-reviewed import can waive a rule.
    -- Missing values never match a bypass; clients cannot supply an override.
    IF v_status <> 'passed' AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(r.data->'bypass', '[]'::jsonb)) b
      WHERE v2.production_rule_value(p_setup, b->>'field') IS NOT NULL
        AND lower(v2.production_rule_value(p_setup, b->>'field') #>> '{}') = lower(b->>'value')
    ) THEN v_status := 'bypassed'; END IF;
    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'code', r.code, 'name', r.name, 'enforcement', r.data->>'enforcement',
      'status', v_status, 'sourceImportId', r.source_import_id));
  END LOOP;
  RETURN v_result;
END
$$;

CREATE FUNCTION v2.guard_production_rules()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE v_assessment jsonb;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status <> 'planned' OR NEW.status <> 'running' THEN RETURN NEW; END IF;
  END IF;
  -- Serialize starts within this facility for sequence rules. A table share
  -- lock also prevents a newly inserted rule from appearing between validation
  -- and the immutable command snapshot (row locks alone miss that phantom).
  -- Locks span only the lifecycle transaction, never an auto-track tick.
  PERFORM pg_advisory_xact_lock(hashtextextended('v2-production-rules:' || NEW.facility_id::text, 0));
  LOCK TABLE v2.setup_production_rule_records IN SHARE MODE;
  v_assessment := v2.assess_production_rules(NEW.facility_id, NEW.setup_snapshot, NEW.id);
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_assessment) finding
    WHERE finding->>'enforcement' = 'strict'
      AND finding->>'status' IN ('unknown', 'violated')
  ) THEN
    RAISE EXCEPTION 'Production rules block this action. Review the imported rules and required setup.'
      USING ERRCODE = 'P2001';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER production_rules_before_prepare
  BEFORE INSERT ON v2.runs
  FOR EACH ROW EXECUTE FUNCTION v2.guard_production_rules();
CREATE TRIGGER production_rules_before_start
  BEFORE UPDATE OF status ON v2.runs
  FOR EACH ROW EXECUTE FUNCTION v2.guard_production_rules();

-- Preserve the original snapshot, including inventory receipts and station state.
-- Accepted command receipts and immutable events retain the exact assessment.
ALTER FUNCTION v2.run_snapshot(uuid, uuid) RENAME TO run_snapshot_without_rules;
CREATE FUNCTION v2.run_snapshot(p_facility_id uuid, p_run_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
  SELECT v2.run_snapshot_without_rules(p_facility_id, p_run_id) ||
    jsonb_build_object('productionRules', COALESCE((
      SELECT e.payload#>'{run,productionRules}' FROM v2.run_events e
      WHERE e.facility_id=p_facility_id AND e.run_id=p_run_id
        AND e.event_type='run.started'
      ORDER BY e.revision LIMIT 1
    ), v2.assess_production_rules(p_facility_id, r.setup_snapshot, p_run_id)))
  FROM v2.runs r WHERE r.facility_id = p_facility_id AND r.id = p_run_id
$$;

REVOKE ALL ON FUNCTION v2.production_rule_value(jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION v2.assess_production_rules(uuid, jsonb, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION v2.guard_production_rules() FROM PUBLIC;
REVOKE ALL ON FUNCTION v2.run_snapshot(uuid, uuid) FROM PUBLIC;
COMMIT;
