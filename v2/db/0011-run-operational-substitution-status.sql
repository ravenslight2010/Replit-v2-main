BEGIN;

CREATE FUNCTION v2.list_run_operational_substitutions(
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
    RAISE EXCEPTION 'Invalid run substitution status request' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM v2.staff_accounts AS staff
    JOIN v2.user_roles AS user_role ON user_role.user_id = staff.id
    JOIN v2.roles AS role ON role.name = user_role.role_name
    WHERE staff.id = p_actor_id
      AND staff.disabled = false
      AND (
        role.capabilities ? 'run.read'
        OR role.capabilities ? 'record-qc'
        OR role.capabilities ? 'manage-qc'
      )
  ) THEN
    RAISE EXCEPTION 'Run substitution status access is not authorized'
      USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM v2.runs WHERE facility_id = p_facility_id AND id = p_run_id
  ) THEN
    RAISE EXCEPTION 'Run is unavailable' USING ERRCODE = 'P0002';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', latest.id,
      'proposalEventId', latest.proposal_event_id,
      'revision', latest.revision,
      'sourceItems', latest.source_items,
      'actorId', latest.actor_id,
      'replacementProductId', latest.replacement_product_id,
      'replacementProductCode', latest.replacement_product_code,
      'replacementProductName', latest.replacement_product_name,
      'replacementQuantity', latest.replacement_quantity::text,
      'replacementUnit', latest.replacement_unit,
      'replacementIngredientSnapshot', latest.replacement_ingredient_snapshot,
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

REVOKE ALL ON FUNCTION v2.list_run_operational_substitutions(uuid, uuid, uuid) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'v2_runtime_access') THEN
    GRANT EXECUTE ON FUNCTION v2.list_run_operational_substitutions(uuid, uuid, uuid) TO v2_runtime_access;
  END IF;
END
$$;

COMMENT ON FUNCTION v2.list_run_operational_substitutions(uuid, uuid, uuid) IS
  'Read-only, run-scoped approved substitution evidence for run readers and QC staff; does not expose QC history.';

COMMIT;
