BEGIN;

CREATE TABLE v2.staff_account_change_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid,
  actor_type text NOT NULL CHECK (actor_type IN ('staff', 'bootstrap')),
  actor_username text NOT NULL CHECK (length(actor_username) BETWEEN 3 AND 40),
  target_id uuid NOT NULL,
  target_username text NOT NULL CHECK (length(target_username) BETWEEN 3 AND 40),
  change_type text NOT NULL CHECK (change_type IN ('created', 'updated')),
  before_state jsonb,
  after_state jsonb NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (before_state IS NULL OR (
    jsonb_typeof(before_state) = 'object'
    AND before_state - ARRAY['roleName', 'disabled'] = '{}'::jsonb
  )),
  CHECK (
    jsonb_typeof(after_state) = 'object'
    AND after_state - ARRAY['roleName', 'disabled'] = '{}'::jsonb
    AND after_state ? 'roleName'
    AND after_state ? 'disabled'
    AND jsonb_typeof(after_state->'roleName') = 'string'
    AND jsonb_typeof(after_state->'disabled') = 'boolean'
  ),
  CHECK (before_state IS NULL OR (
    before_state ? 'roleName'
    AND before_state ? 'disabled'
    AND jsonb_typeof(before_state->'roleName') = 'string'
    AND jsonb_typeof(before_state->'disabled') = 'boolean'
  )),
  CHECK ((change_type = 'created') = (before_state IS NULL)),
  CHECK ((actor_type = 'staff') = (actor_id IS NOT NULL))
);

CREATE INDEX staff_account_change_events_latest
  ON v2.staff_account_change_events (occurred_at DESC, id DESC);

CREATE FUNCTION v2.prevent_staff_account_change_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, v2
AS $$
BEGIN
  RAISE EXCEPTION 'Staff account history is append-only'
    USING ERRCODE = '55000';
END
$$;

CREATE TRIGGER staff_account_change_events_append_only
  BEFORE UPDATE OR DELETE ON v2.staff_account_change_events
  FOR EACH ROW EXECUTE FUNCTION v2.prevent_staff_account_change_mutation();

CREATE OR REPLACE FUNCTION v2.bootstrap_first_manager(
  p_username text,
  p_password_hash text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  IF p_username IS NULL
     OR length(btrim(p_username)) NOT BETWEEN 3 AND 40
     OR p_username <> btrim(p_username)
     OR p_username ~ '[[:cntrl:]]'
     OR p_password_hash IS NULL
     OR length(p_password_hash) NOT BETWEEN 20 AND 256
     OR p_password_hash NOT LIKE 'argon2id$v=19$m=19456,t=2,p=1$%$%' THEN
    RAISE EXCEPTION 'Invalid first-manager request'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(20855409, 1);
  IF EXISTS (SELECT 1 FROM v2.staff_bootstrap_marker)
     OR EXISTS (SELECT 1 FROM v2.staff_accounts) THEN
    RETURN false;
  END IF;

  INSERT INTO v2.staff_accounts (username, password_hash)
    VALUES (p_username, p_password_hash)
    RETURNING id INTO v_user_id;
  INSERT INTO v2.user_roles (user_id, role_name)
    VALUES (v_user_id, 'manager');
  INSERT INTO v2.staff_bootstrap_marker (singleton) VALUES (true);
  INSERT INTO v2.staff_account_change_events (
    actor_id, actor_type, actor_username, target_id, target_username,
    change_type, before_state, after_state
  ) VALUES (
    NULL, 'bootstrap', 'First-manager setup', v_user_id, p_username, 'created', NULL,
    jsonb_build_object('roleName', 'manager', 'disabled', false)
  );
  RETURN true;
END
$$;

CREATE OR REPLACE FUNCTION v2.create_staff_account(
  p_actor_id uuid,
  p_username text,
  p_password_hash text,
  p_role_name text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_user_id uuid;
  v_actor_username text;
BEGIN
  IF p_username IS NULL
     OR length(btrim(p_username)) NOT BETWEEN 3 AND 40
     OR p_username <> btrim(p_username)
     OR p_username ~ '[[:cntrl:]]'
     OR p_password_hash IS NULL
     OR length(p_password_hash) NOT BETWEEN 20 AND 256
     OR p_password_hash NOT LIKE 'argon2id$v=19$m=19456,t=2,p=1$%$%' THEN
    RAISE EXCEPTION 'Invalid staff account request'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(20855409, 1);
  IF NOT v2.actor_can_manage_staff(p_actor_id) THEN
    RAISE EXCEPTION 'Staff management is not authorized'
      USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM v2.roles WHERE name = p_role_name) THEN
    RETURN 'invalid_role';
  END IF;
  SELECT username INTO v_actor_username FROM v2.staff_accounts WHERE id = p_actor_id;

  INSERT INTO v2.staff_accounts (username, password_hash)
    VALUES (p_username, p_password_hash)
    RETURNING id INTO v_user_id;
  INSERT INTO v2.user_roles (user_id, role_name)
    VALUES (v_user_id, p_role_name);
  INSERT INTO v2.staff_account_change_events (
    actor_id, actor_type, actor_username, target_id, target_username,
    change_type, before_state, after_state
  ) VALUES (
    p_actor_id, 'staff', v_actor_username, v_user_id, p_username, 'created', NULL,
    jsonb_build_object('roleName', p_role_name, 'disabled', false)
  );
  RETURN 'created';
EXCEPTION
  WHEN unique_violation THEN
    RETURN 'duplicate';
END
$$;

CREATE OR REPLACE FUNCTION v2.update_staff_account(
  p_actor_id uuid,
  p_staff_id uuid,
  p_disabled boolean,
  p_role_name text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_current_disabled boolean;
  v_current_role text;
  v_next_disabled boolean;
  v_next_role text;
  v_target_username text;
  v_actor_username text;
BEGIN
  IF p_staff_id IS NULL OR (p_disabled IS NULL AND p_role_name IS NULL) THEN
    RAISE EXCEPTION 'Invalid staff account update'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(20855409, 1);
  IF NOT v2.actor_can_manage_staff(p_actor_id) THEN
    RAISE EXCEPTION 'Staff management is not authorized'
      USING ERRCODE = '42501';
  END IF;
  IF p_role_name IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM v2.roles WHERE name = p_role_name) THEN
    RETURN 'invalid_role';
  END IF;

  SELECT u.disabled, r.name, u.username
    INTO v_current_disabled, v_current_role, v_target_username
    FROM v2.staff_accounts AS u
    JOIN v2.user_roles AS ur ON ur.user_id = u.id
    JOIN v2.roles AS r ON r.name = ur.role_name
    WHERE u.id = p_staff_id
    FOR UPDATE OF u, ur;
  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;

  v_next_disabled := coalesce(p_disabled, v_current_disabled);
  v_next_role := coalesce(p_role_name, v_current_role);

  IF v_current_disabled = false
     AND v_current_role = 'manager'
     AND (v_next_disabled OR v_next_role <> 'manager')
     AND (
       SELECT count(*)
       FROM v2.staff_accounts AS u
       JOIN v2.user_roles AS ur ON ur.user_id = u.id
       WHERE u.disabled = false AND ur.role_name = 'manager'
     ) <= 1 THEN
    RETURN 'last_manager';
  END IF;
  IF p_actor_id = p_staff_id THEN
    RETURN 'self_change';
  END IF;

  IF v_current_disabled = v_next_disabled AND v_current_role = v_next_role THEN
    RETURN 'unchanged';
  END IF;

  SELECT username INTO v_actor_username FROM v2.staff_accounts WHERE id = p_actor_id;
  UPDATE v2.staff_accounts
    SET disabled = v_next_disabled
    WHERE id = p_staff_id;
  UPDATE v2.user_roles
    SET role_name = v_next_role,
        updated_at = clock_timestamp()
    WHERE user_id = p_staff_id;
  UPDATE v2.staff_sessions
    SET revoked_at = clock_timestamp()
    WHERE user_id = p_staff_id AND revoked_at IS NULL;
  INSERT INTO v2.staff_account_change_events (
    actor_id, actor_type, actor_username, target_id, target_username,
    change_type, before_state, after_state
  ) VALUES (
    p_actor_id, 'staff', v_actor_username, p_staff_id, v_target_username, 'updated',
    jsonb_build_object('roleName', v_current_role, 'disabled', v_current_disabled),
    jsonb_build_object('roleName', v_next_role, 'disabled', v_next_disabled)
  );
  RETURN 'updated';
END
$$;

CREATE FUNCTION v2.list_staff_account_change_history(
  p_actor_id uuid,
  p_limit integer,
  p_before_occurred_at timestamptz DEFAULT NULL,
  p_before_id uuid DEFAULT NULL
)
RETURNS TABLE (
  event_id uuid,
  actor_id uuid,
  actor_type text,
  actor_username text,
  target_id uuid,
  target_username text,
  change_type text,
  before_state jsonb,
  after_state jsonb,
  occurred_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
BEGIN
  IF p_actor_id IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50
     OR ((p_before_occurred_at IS NULL) <> (p_before_id IS NULL)) THEN
    RAISE EXCEPTION 'Invalid staff account history request'
      USING ERRCODE = '22023';
  END IF;
  IF NOT v2.actor_can_manage_staff(p_actor_id) THEN
    RAISE EXCEPTION 'Staff management is not authorized'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT e.id, e.actor_id, e.actor_type, e.actor_username, e.target_id, e.target_username,
           e.change_type, e.before_state, e.after_state, e.occurred_at
    FROM v2.staff_account_change_events AS e
    WHERE p_before_occurred_at IS NULL
       OR (e.occurred_at, e.id) < (p_before_occurred_at, p_before_id)
    ORDER BY e.occurred_at DESC, e.id DESC
    LIMIT p_limit + 1;
END
$$;

REVOKE ALL ON TABLE v2.staff_account_change_events FROM PUBLIC;
REVOKE ALL ON FUNCTION v2.prevent_staff_account_change_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION v2.list_staff_account_change_history(uuid, integer, timestamptz, uuid) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'v2_runtime_access') THEN
    GRANT EXECUTE ON FUNCTION v2.list_staff_account_change_history(uuid, integer, timestamptz, uuid)
      TO v2_runtime_access;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'v2_api_test') THEN
    GRANT EXECUTE ON FUNCTION v2.list_staff_account_change_history(uuid, integer, timestamptz, uuid)
      TO v2_api_test;
  END IF;
END
$$;

COMMENT ON TABLE v2.staff_account_change_events IS
  'Append-only V2 staff access history. Captures only actor, target, role, enabled state, and server time.';

COMMIT;
