BEGIN;

CREATE TABLE v2.staff_password_reset_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES v2.staff_accounts (id) ON DELETE CASCADE,
  state text NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'approved', 'denied', 'completed', 'expired', 'cancelled')),
  recovery_code_hash text CHECK (recovery_code_hash IS NULL OR recovery_code_hash ~ '^[0-9a-f]{64}$'),
  requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  decided_at timestamptz,
  decided_by uuid,
  code_expires_at timestamptz,
  completed_at timestamptz,
  CHECK (
    (state = 'approved' AND recovery_code_hash IS NOT NULL AND code_expires_at IS NOT NULL)
    OR (state <> 'approved' AND recovery_code_hash IS NULL AND code_expires_at IS NULL)
  ),
  CHECK (state <> 'completed' OR completed_at IS NOT NULL)
);

CREATE UNIQUE INDEX staff_password_reset_active_account
  ON v2.staff_password_reset_requests (staff_id)
  WHERE state IN ('pending', 'approved');

CREATE INDEX staff_password_reset_queue
  ON v2.staff_password_reset_requests (requested_at, id)
  WHERE state IN ('pending', 'approved');

CREATE TABLE v2.staff_password_reset_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES v2.staff_password_reset_requests (id) ON DELETE CASCADE,
  staff_id uuid NOT NULL,
  actor_id uuid,
  event_type text NOT NULL CHECK (
    event_type IN ('requested', 'approved', 'reissued', 'denied', 'completed', 'expired', 'cancelled')
  ),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX staff_password_reset_events_staff
  ON v2.staff_password_reset_events (staff_id, occurred_at, id);

CREATE FUNCTION v2.expire_staff_password_reset_requests()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_expired record;
BEGIN
  PERFORM pg_advisory_xact_lock(20855409, 1);
  FOR v_expired IN
    UPDATE v2.staff_password_reset_requests
      SET state = 'expired', recovery_code_hash = NULL, code_expires_at = NULL
      WHERE (state = 'pending' AND requested_at <= v_now - interval '7 days')
         OR (state = 'approved' AND code_expires_at <= v_now)
      RETURNING id, staff_id
  LOOP
    INSERT INTO v2.staff_password_reset_events (request_id, staff_id, event_type, occurred_at)
      VALUES (v_expired.id, v_expired.staff_id, 'expired', v_now);
  END LOOP;
END
$$;

CREATE FUNCTION v2.can_approve_staff_password_reset(p_actor_id uuid, p_staff_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM v2.staff_accounts AS actor
    JOIN v2.user_roles AS actor_role ON actor_role.user_id = actor.id
    JOIN v2.roles AS actor_definition ON actor_definition.name = actor_role.role_name
    JOIN v2.staff_accounts AS target ON target.id = p_staff_id
    JOIN v2.user_roles AS target_role ON target_role.user_id = target.id
    JOIN v2.roles AS target_definition ON target_definition.name = target_role.role_name
    WHERE actor.id = p_actor_id
      AND actor.disabled = false
      AND actor_definition.capabilities ? 'approve-password-resets'
      AND target.disabled = false
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(target_definition.capabilities) AS capability(name)
        WHERE NOT (actor_definition.capabilities ? capability.name)
      )
  )
$$;

CREATE FUNCTION v2.request_staff_password_reset(p_username text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_staff_id uuid;
  v_request_id uuid;
  v_created boolean := false;
BEGIN
  IF p_username IS NULL OR length(btrim(p_username)) NOT BETWEEN 3 AND 40
     OR p_username <> btrim(p_username) OR p_username ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'Invalid password recovery request' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(20855409, 1);
  SELECT id INTO v_staff_id
    FROM v2.staff_accounts
    WHERE lower(username) = lower(btrim(p_username)) AND disabled = false
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  PERFORM v2.expire_staff_password_reset_requests();

  UPDATE v2.staff_sessions
    SET revoked_at = v_now
    WHERE user_id = v_staff_id AND revoked_at IS NULL;

  SELECT id INTO v_request_id
    FROM v2.staff_password_reset_requests
    WHERE staff_id = v_staff_id AND state IN ('pending', 'approved')
    FOR UPDATE;
  IF FOUND THEN
    RETURN true;
  END IF;

  INSERT INTO v2.staff_password_reset_requests (staff_id, state, requested_at)
    VALUES (v_staff_id, 'pending', v_now)
    RETURNING id INTO v_request_id;
  INSERT INTO v2.staff_password_reset_events (request_id, staff_id, event_type, occurred_at)
    VALUES (v_request_id, v_staff_id, 'requested', v_now);
  v_created := true;
  RETURN v_created;
END
$$;

CREATE FUNCTION v2.list_staff_password_reset_requests(p_actor_id uuid)
RETURNS TABLE (
  request_id uuid,
  staff_id uuid,
  username text,
  state text,
  requested_at timestamptz,
  decided_at timestamptz,
  code_expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(20855409, 1);
  IF NOT EXISTS (
    SELECT 1
    FROM v2.staff_accounts AS actor
    JOIN v2.user_roles AS ur ON ur.user_id = actor.id
    JOIN v2.roles AS role ON role.name = ur.role_name
    WHERE actor.id = p_actor_id AND actor.disabled = false
      AND role.capabilities ? 'approve-password-resets'
  ) THEN
    RAISE EXCEPTION 'Password recovery review is not authorized' USING ERRCODE = '42501';
  END IF;
  PERFORM v2.expire_staff_password_reset_requests();

  RETURN QUERY
    SELECT request.id, staff.id, staff.username, request.state,
           request.requested_at, request.decided_at, request.code_expires_at
    FROM v2.staff_password_reset_requests AS request
    JOIN v2.staff_accounts AS staff ON staff.id = request.staff_id
    WHERE request.state IN ('pending', 'approved')
      AND v2.can_approve_staff_password_reset(p_actor_id, staff.id)
    ORDER BY request.requested_at, request.id
    LIMIT 100;
END
$$;

CREATE FUNCTION v2.decide_staff_password_reset(
  p_actor_id uuid,
  p_request_id uuid,
  p_decision text,
  p_recovery_code_hash text,
  p_code_expires_at timestamptz
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_staff_id uuid;
  v_state text;
BEGIN
  IF p_actor_id IS NULL OR p_request_id IS NULL
     OR p_decision IS NULL OR p_decision NOT IN ('approve', 'deny')
     OR (p_decision = 'approve'
       AND (p_recovery_code_hash IS NULL OR p_recovery_code_hash !~ '^[0-9a-f]{64}$'
         OR p_code_expires_at IS NULL OR p_code_expires_at <= v_now
         OR p_code_expires_at > v_now + interval '10 minutes'))
     OR (p_decision = 'deny' AND (p_recovery_code_hash IS NOT NULL OR p_code_expires_at IS NOT NULL)) THEN
    RAISE EXCEPTION 'Invalid password recovery decision' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(20855409, 1);
  PERFORM v2.expire_staff_password_reset_requests();
  IF NOT EXISTS (
    SELECT 1
    FROM v2.staff_accounts AS actor
    JOIN v2.user_roles AS ur ON ur.user_id = actor.id
    JOIN v2.roles AS role ON role.name = ur.role_name
    WHERE actor.id = p_actor_id AND actor.disabled = false
      AND role.capabilities ? 'approve-password-resets'
  ) THEN
    RAISE EXCEPTION 'Password recovery review is not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT request.staff_id, request.state
    INTO v_staff_id, v_state
    FROM v2.staff_password_reset_requests AS request
    WHERE request.id = p_request_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;
  IF v_state NOT IN ('pending', 'approved') THEN
    RETURN 'not_active';
  END IF;

  PERFORM 1 FROM v2.staff_accounts WHERE id = v_staff_id FOR UPDATE;
  IF p_decision = 'approve' THEN
    IF NOT v2.can_approve_staff_password_reset(p_actor_id, v_staff_id) THEN
      RETURN 'target_unavailable';
    END IF;
    IF v_state <> 'pending' THEN
      RETURN 'already_approved';
    END IF;
    UPDATE v2.staff_password_reset_requests
      SET state = 'approved', recovery_code_hash = p_recovery_code_hash,
          code_expires_at = p_code_expires_at, decided_at = v_now, decided_by = p_actor_id
      WHERE id = p_request_id;
    UPDATE v2.staff_sessions
      SET revoked_at = v_now
      WHERE user_id = v_staff_id AND revoked_at IS NULL;
    INSERT INTO v2.staff_password_reset_events (request_id, staff_id, actor_id, event_type, occurred_at)
      VALUES (p_request_id, v_staff_id, p_actor_id, 'approved', v_now);
    RETURN 'approved';
  END IF;

  UPDATE v2.staff_password_reset_requests
    SET state = 'denied', recovery_code_hash = NULL, code_expires_at = NULL,
        decided_at = v_now, decided_by = p_actor_id
    WHERE id = p_request_id;
  UPDATE v2.staff_sessions
    SET revoked_at = v_now
    WHERE user_id = v_staff_id AND revoked_at IS NULL;
  INSERT INTO v2.staff_password_reset_events (request_id, staff_id, actor_id, event_type, occurred_at)
    VALUES (p_request_id, v_staff_id, p_actor_id, 'denied', v_now);
  RETURN 'denied';
END
$$;

CREATE FUNCTION v2.reissue_staff_password_reset_code(
  p_actor_id uuid,
  p_request_id uuid,
  p_recovery_code_hash text,
  p_code_expires_at timestamptz
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_staff_id uuid;
  v_state text;
BEGIN
  IF p_actor_id IS NULL OR p_request_id IS NULL
     OR p_recovery_code_hash IS NULL OR p_recovery_code_hash !~ '^[0-9a-f]{64}$'
     OR p_code_expires_at IS NULL OR p_code_expires_at <= v_now
      OR p_code_expires_at > v_now + interval '10 minutes' THEN
    RAISE EXCEPTION 'Invalid password recovery code request' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(20855409, 1);
  PERFORM v2.expire_staff_password_reset_requests();
  IF NOT EXISTS (
    SELECT 1
    FROM v2.staff_accounts AS actor
    JOIN v2.user_roles AS ur ON ur.user_id = actor.id
    JOIN v2.roles AS role ON role.name = ur.role_name
    WHERE actor.id = p_actor_id AND actor.disabled = false
      AND role.capabilities ? 'approve-password-resets'
  ) THEN
    RAISE EXCEPTION 'Password recovery review is not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT request.staff_id, request.state
    INTO v_staff_id, v_state
    FROM v2.staff_password_reset_requests AS request
    WHERE request.id = p_request_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;
  IF v_state <> 'approved' THEN
    RETURN 'not_active';
  END IF;

  PERFORM 1 FROM v2.staff_accounts WHERE id = v_staff_id FOR UPDATE;
  IF NOT v2.can_approve_staff_password_reset(p_actor_id, v_staff_id) THEN
    RETURN 'target_unavailable';
  END IF;

  UPDATE v2.staff_password_reset_requests
    SET recovery_code_hash = p_recovery_code_hash, code_expires_at = p_code_expires_at,
        decided_at = v_now, decided_by = p_actor_id
    WHERE id = p_request_id;
  UPDATE v2.staff_sessions
    SET revoked_at = v_now
    WHERE user_id = v_staff_id AND revoked_at IS NULL;
  INSERT INTO v2.staff_password_reset_events (request_id, staff_id, actor_id, event_type, occurred_at)
    VALUES (p_request_id, v_staff_id, p_actor_id, 'reissued', v_now);
  RETURN 'reissued';
END
$$;

CREATE FUNCTION v2.complete_staff_password_reset(
  p_username text,
  p_recovery_code_hash text,
  p_password_hash text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_staff_id uuid;
  v_request_id uuid;
BEGIN
  IF p_username IS NULL OR length(btrim(p_username)) NOT BETWEEN 3 AND 40
     OR p_username <> btrim(p_username) OR p_username ~ '[[:cntrl:]]'
     OR p_recovery_code_hash IS NULL OR p_recovery_code_hash !~ '^[0-9a-f]{64}$'
     OR p_password_hash IS NULL OR length(p_password_hash) NOT BETWEEN 20 AND 256
     OR p_password_hash NOT LIKE 'argon2id$v=19$m=19456,t=2,p=1$%$%' THEN
    RAISE EXCEPTION 'Invalid password recovery completion' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(20855409, 1);
  PERFORM v2.expire_staff_password_reset_requests();
  SELECT request.id, staff.id
    INTO v_request_id, v_staff_id
    FROM v2.staff_password_reset_requests AS request
    JOIN v2.staff_accounts AS staff ON staff.id = request.staff_id
    WHERE lower(staff.username) = lower(btrim(p_username))
      AND staff.disabled = false
      AND request.state = 'approved'
      AND request.recovery_code_hash = p_recovery_code_hash
      AND request.code_expires_at > v_now
    FOR UPDATE OF request, staff;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  UPDATE v2.staff_accounts SET password_hash = p_password_hash WHERE id = v_staff_id;
  UPDATE v2.staff_password_reset_requests
    SET state = 'completed', recovery_code_hash = NULL, code_expires_at = NULL,
        completed_at = v_now
    WHERE id = v_request_id;
  UPDATE v2.staff_sessions
    SET revoked_at = v_now
    WHERE user_id = v_staff_id AND revoked_at IS NULL;
  INSERT INTO v2.staff_password_reset_events (request_id, staff_id, event_type, occurred_at)
    VALUES (v_request_id, v_staff_id, 'completed', v_now);
  RETURN true;
END
$$;

CREATE FUNCTION v2.cancel_staff_password_resets_after_account_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_staff_id uuid;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF TG_TABLE_NAME = 'staff_accounts' THEN
    IF OLD.disabled IS NOT DISTINCT FROM NEW.disabled THEN
      RETURN NEW;
    END IF;
    v_staff_id := NEW.id;
  ELSIF OLD.role_name IS NOT DISTINCT FROM NEW.role_name THEN
    RETURN NEW;
  ELSE
    v_staff_id := NEW.user_id;
  END IF;

  WITH cancelled AS (
    UPDATE v2.staff_password_reset_requests
      SET state = 'cancelled', recovery_code_hash = NULL, code_expires_at = NULL
      WHERE staff_id = v_staff_id AND state IN ('pending', 'approved')
      RETURNING id, staff_id
  )
  INSERT INTO v2.staff_password_reset_events (request_id, staff_id, event_type, occurred_at)
    SELECT id, staff_id, 'cancelled', v_now FROM cancelled;
  RETURN NEW;
END
$$;

CREATE TRIGGER staff_password_reset_account_status_changed
  AFTER UPDATE OF disabled ON v2.staff_accounts
  FOR EACH ROW EXECUTE FUNCTION v2.cancel_staff_password_resets_after_account_change();

CREATE TRIGGER staff_password_reset_role_changed
  AFTER UPDATE OF role_name ON v2.user_roles
  FOR EACH ROW EXECUTE FUNCTION v2.cancel_staff_password_resets_after_account_change();

REVOKE ALL ON TABLE v2.staff_password_reset_requests FROM PUBLIC;
REVOKE ALL ON TABLE v2.staff_password_reset_events FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA v2 FROM PUBLIC;

COMMENT ON TABLE v2.staff_password_reset_requests IS
  'V2-only password recovery state; stores only SHA-256 hashes of one-use recovery codes.';
COMMENT ON TABLE v2.staff_password_reset_events IS
  'Durable password recovery audit events; never stores credentials or recovery codes.';

COMMIT;
