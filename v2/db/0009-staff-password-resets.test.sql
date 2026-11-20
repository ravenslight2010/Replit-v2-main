BEGIN;

INSERT INTO v2.roles (name, capabilities, builtin)
VALUES
  ('password-reset-reviewer-test', '["approve-password-resets"]'::jsonb, false),
  ('operator-alt-test', '[]'::jsonb, false)
ON CONFLICT (name) DO NOTHING;

INSERT INTO v2.staff_accounts (id, username, password_hash, disabled)
VALUES
  ('81000000-0000-4000-8000-000000000001', 'ResetManager', 'argon2id$v=19$m=19456,t=2,p=1$c2FsdA==$aGFzaA==', false),
  ('81000000-0000-4000-8000-000000000002', 'ResetOperator', 'argon2id$v=19$m=19456,t=2,p=1$c2FsdA==$aGFzaA==', false),
  ('81000000-0000-4000-8000-000000000003', 'ResetDenied', 'argon2id$v=19$m=19456,t=2,p=1$c2FsdA==$aGFzaA==', false),
  ('81000000-0000-4000-8000-000000000004', 'ResetPrivileged', 'argon2id$v=19$m=19456,t=2,p=1$c2FsdA==$aGFzaA==', false),
  ('81000000-0000-4000-8000-000000000005', 'ResetReviewer', 'argon2id$v=19$m=19456,t=2,p=1$c2FsdA==$aGFzaA==', false),
  ('81000000-0000-4000-8000-000000000006', 'ResetDisabled', 'argon2id$v=19$m=19456,t=2,p=1$c2FsdA==$aGFzaA==', false),
  ('81000000-0000-4000-8000-000000000007', 'ResetExpired', 'argon2id$v=19$m=19456,t=2,p=1$c2FsdA==$aGFzaA==', false),
  ('81000000-0000-4000-8000-000000000008', 'ResetExpiredCode', 'argon2id$v=19$m=19456,t=2,p=1$c2FsdA==$aGFzaA==', false);

INSERT INTO v2.user_roles (user_id, role_name)
VALUES
  ('81000000-0000-4000-8000-000000000001', 'manager'),
  ('81000000-0000-4000-8000-000000000002', 'operator'),
  ('81000000-0000-4000-8000-000000000003', 'operator'),
  ('81000000-0000-4000-8000-000000000004', 'manager'),
  ('81000000-0000-4000-8000-000000000005', 'password-reset-reviewer-test'),
  ('81000000-0000-4000-8000-000000000006', 'operator'),
  ('81000000-0000-4000-8000-000000000007', 'operator'),
  ('81000000-0000-4000-8000-000000000008', 'operator');

DO $$
DECLARE
  v_request_id uuid;
  v_state text;
  v_result text;
  v_opened boolean;
  v_completed boolean;
  v_password_hash text;
  v_visible_count integer;
BEGIN
  IF v2.request_staff_password_reset('MissingResetAccount') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'unknown username unexpectedly created a recovery request';
  END IF;

  SELECT v2.open_staff_session(
    '81000000-0000-4000-8000-000000000002',
    repeat('a', 64), repeat('b', 64), clock_timestamp() + interval '1 day'
  ) INTO v_opened;
  IF v_opened IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'target account session fixture could not be opened';
  END IF;
  IF v2.request_staff_password_reset('ResetOperator') IS DISTINCT FROM true
     OR v2.request_staff_password_reset('ResetOperator') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'known account recovery request was not accepted idempotently';
  END IF;
  IF EXISTS (SELECT 1 FROM v2.resolve_staff_session(repeat('a', 64))) THEN
    RAISE EXCEPTION 'recovery request did not revoke existing account sessions';
  END IF;
  SELECT id INTO v_request_id
    FROM v2.staff_password_reset_requests
    WHERE staff_id = '81000000-0000-4000-8000-000000000002' AND state = 'pending';
  IF v_request_id IS NULL OR (
    SELECT count(*) FROM v2.staff_password_reset_requests
    WHERE staff_id = '81000000-0000-4000-8000-000000000002'
  ) <> 1 THEN
    RAISE EXCEPTION 'repeated requests created duplicate active recovery rows';
  END IF;

  SELECT v2.decide_staff_password_reset(
    '81000000-0000-4000-8000-000000000001',
    v_request_id, 'approve', repeat('1', 64), clock_timestamp() + interval '10 minutes'
  ) INTO v_result;
  IF v_result IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'manager could not approve a lower-privilege recovery request';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM v2.staff_password_reset_requests
    WHERE id = v_request_id AND state = 'approved'
      AND recovery_code_hash = repeat('1', 64)
      AND recovery_code_hash <> repeat('2', 43)
  ) THEN
    RAISE EXCEPTION 'approved recovery code hash was not stored as a hash';
  END IF;

  SELECT v2.open_staff_session(
    '81000000-0000-4000-8000-000000000002',
    repeat('c', 64), repeat('d', 64), clock_timestamp() + interval '1 day'
  ) INTO v_opened;
  IF v_opened IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'target could not open a post-request session fixture';
  END IF;
  SELECT v2.complete_staff_password_reset(
    'ResetOperator', repeat('2', 64),
    'argon2id$v=19$m=19456,t=2,p=1$bmV3c2FsdA==$bmV3aGFzaA=='
  ) INTO v_completed;
  IF v_completed IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'incorrect recovery code unexpectedly completed the reset';
  END IF;
  SELECT v2.complete_staff_password_reset(
    'ResetOperator', repeat('1', 64),
    'argon2id$v=19$m=19456,t=2,p=1$bmV3c2FsdA==$bmV3aGFzaA=='
  ) INTO v_completed;
  IF v_completed IS DISTINCT FROM true
     OR EXISTS (SELECT 1 FROM v2.resolve_staff_session(repeat('c', 64))) THEN
    RAISE EXCEPTION 'successful reset did not replace the password and revoke sessions';
  END IF;
  SELECT password_hash INTO v_password_hash
    FROM v2.staff_accounts WHERE id = '81000000-0000-4000-8000-000000000002';
  IF v_password_hash <> 'argon2id$v=19$m=19456,t=2,p=1$bmV3c2FsdA==$bmV3aGFzaA==' THEN
    RAISE EXCEPTION 'successful reset did not persist the submitted password hash';
  END IF;
  SELECT v2.complete_staff_password_reset(
    'ResetOperator', repeat('1', 64),
    'argon2id$v=19$m=19456,t=2,p=1$bmV3c2FsdA==$bmV3aGFzaA=='
  ) INTO v_completed;
  IF v_completed IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'one-use recovery code succeeded more than once';
  END IF;

  SELECT v2.open_staff_session(
    '81000000-0000-4000-8000-000000000003',
    repeat('e', 64), repeat('f', 64), clock_timestamp() + interval '1 day'
  ) INTO v_opened;
  PERFORM v2.request_staff_password_reset('ResetDenied');
  SELECT id INTO v_request_id FROM v2.staff_password_reset_requests
    WHERE staff_id = '81000000-0000-4000-8000-000000000003' AND state = 'pending';
  SELECT v2.decide_staff_password_reset(
    '81000000-0000-4000-8000-000000000001',
    v_request_id, 'deny', NULL, NULL
  ) INTO v_result;
  IF v_result IS DISTINCT FROM 'denied'
     OR EXISTS (SELECT 1 FROM v2.resolve_staff_session(repeat('e', 64))) THEN
    RAISE EXCEPTION 'denial did not clear the request and revoke sessions';
  END IF;

  PERFORM v2.request_staff_password_reset('ResetPrivileged');
  SELECT id INTO v_request_id FROM v2.staff_password_reset_requests
    WHERE staff_id = '81000000-0000-4000-8000-000000000004' AND state = 'pending';
  SELECT count(*) INTO v_visible_count FROM v2.list_staff_password_reset_requests(
    '81000000-0000-4000-8000-000000000005'
  ) WHERE staff_id = '81000000-0000-4000-8000-000000000004';
  SELECT v2.decide_staff_password_reset(
    '81000000-0000-4000-8000-000000000005',
    v_request_id, 'approve', repeat('3', 64), clock_timestamp() + interval '10 minutes'
  ) INTO v_result;
  IF v_visible_count <> 0 OR v_result IS DISTINCT FROM 'target_unavailable' THEN
    RAISE EXCEPTION 'narrow recovery reviewer could see or approve a more privileged account';
  END IF;
  PERFORM v2.decide_staff_password_reset(
    '81000000-0000-4000-8000-000000000001',
    v_request_id, 'deny', NULL, NULL
  );

  PERFORM v2.request_staff_password_reset('ResetDisabled');
  SELECT id INTO v_request_id FROM v2.staff_password_reset_requests
    WHERE staff_id = '81000000-0000-4000-8000-000000000006' AND state = 'pending';
  SELECT v2.update_staff_account(
    '81000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000006',
    true,
    NULL
  ) INTO v_result;
  SELECT state INTO v_state FROM v2.staff_password_reset_requests WHERE id = v_request_id;
  IF v_result IS DISTINCT FROM 'updated' OR v_state IS DISTINCT FROM 'cancelled' THEN
    RAISE EXCEPTION 'disabling an account did not cancel its active recovery request';
  END IF;

  PERFORM v2.request_staff_password_reset('ResetExpired');
  UPDATE v2.staff_password_reset_requests
    SET requested_at = clock_timestamp() - interval '8 days'
    WHERE staff_id = '81000000-0000-4000-8000-000000000007' AND state = 'pending';
  PERFORM v2.list_staff_password_reset_requests('81000000-0000-4000-8000-000000000001');
  SELECT state INTO v_state FROM v2.staff_password_reset_requests
    WHERE staff_id = '81000000-0000-4000-8000-000000000007';
  IF v_state IS DISTINCT FROM 'expired' THEN
    RAISE EXCEPTION 'expired pending recovery request remained active';
  END IF;

  PERFORM v2.request_staff_password_reset('ResetExpiredCode');
  SELECT id INTO v_request_id FROM v2.staff_password_reset_requests
    WHERE staff_id = '81000000-0000-4000-8000-000000000008' AND state = 'pending';
  PERFORM v2.decide_staff_password_reset(
    '81000000-0000-4000-8000-000000000001',
    v_request_id, 'approve', repeat('4', 64), clock_timestamp() + interval '10 minutes'
  );
  UPDATE v2.staff_password_reset_requests
    SET code_expires_at = clock_timestamp() - interval '1 second'
    WHERE id = v_request_id;
  SELECT v2.complete_staff_password_reset(
    'ResetExpiredCode', repeat('4', 64),
    'argon2id$v=19$m=19456,t=2,p=1$bmV3c2FsdA==$bmV3aGFzaA=='
  ) INTO v_completed;
  SELECT state INTO v_state FROM v2.staff_password_reset_requests WHERE id = v_request_id;
  IF v_completed IS DISTINCT FROM false OR v_state IS DISTINCT FROM 'expired' THEN
    RAISE EXCEPTION 'expired approved recovery code remained usable';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM v2.staff_password_reset_events
    WHERE event_type = 'requested' AND staff_id = '81000000-0000-4000-8000-000000000002'
  ) OR NOT EXISTS (
    SELECT 1 FROM v2.staff_password_reset_events
    WHERE event_type = 'completed' AND staff_id = '81000000-0000-4000-8000-000000000002'
  ) OR NOT EXISTS (
    SELECT 1 FROM v2.staff_password_reset_events
    WHERE event_type = 'expired' AND staff_id = '81000000-0000-4000-8000-000000000008'
  ) THEN
    RAISE EXCEPTION 'password recovery audit events were not retained';
  END IF;
END
$$;

ROLLBACK;
