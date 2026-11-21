BEGIN;

CREATE FUNCTION pg_temp.reject_staff_history_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $trigger$
BEGIN
  IF NEW.target_username IN ('RejectAtomicCreate', 'StaffHistoryOperator') THEN
    RAISE EXCEPTION 'intentional account-history write failure' USING ERRCODE = '22000';
  END IF;
  RETURN NEW;
END
$trigger$;

DO $$
DECLARE
  v_manager uuid := '79000000-0000-4000-8000-000000000001';
  v_operator uuid := '79000000-0000-4000-8000-000000000002';
  v_nonmanager uuid := '79000000-0000-4000-8000-000000000003';
  v_created uuid;
  v_page_count integer;
  v_failed boolean := false;
  v_manager_history integer;
  v_operator_history integer;
  v_history_text text;
  v_event record;
BEGIN
  IF v2.bootstrap_first_manager(
    'StaffHistoryManager',
    'argon2id$v=19$m=19456,t=2,p=1$c2FsdA==$aGFzaA=='
  ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'V2 manager bootstrap failed during account history test';
  END IF;
  SELECT id INTO v_manager FROM v2.staff_accounts WHERE lower(username) = 'staffhistorymanager';
  INSERT INTO v2.staff_accounts (id, username, password_hash)
    VALUES (v_nonmanager, 'StaffHistoryNonManager',
      'argon2id$v=19$m=19456,t=2,p=1$c2FsdA==$aGFzaA==');
  INSERT INTO v2.user_roles (user_id, role_name) VALUES (v_nonmanager, 'operator');
  IF NOT EXISTS (
    SELECT 1 FROM v2.staff_account_change_events
    WHERE actor_type = 'bootstrap' AND actor_id IS NULL
      AND actor_username = 'First-manager setup'
      AND target_id = v_manager AND change_type = 'created'
      AND before_state IS NULL
      AND after_state = '{"roleName":"manager","disabled":false}'::jsonb
  ) THEN
    RAISE EXCEPTION 'First-manager bootstrap was not recorded with safe before and after values';
  END IF;

  SELECT v2.create_staff_account(
    v_manager, 'StaffHistoryOperator',
    'argon2id$v=19$m=19456,t=2,p=1$c2FsdA==$aGFzaA==', 'operator'
  ) INTO v_history_text;
  IF v_history_text IS DISTINCT FROM 'created' THEN
    RAISE EXCEPTION 'Manager account creation failed: %', v_history_text;
  END IF;
  SELECT id INTO v_operator FROM v2.staff_accounts WHERE lower(username) = 'staffhistoryoperator';
  IF v2.update_staff_account(v_manager, v_operator, NULL, 'manager') <> 'updated'
     OR v2.update_staff_account(v_manager, v_operator, true, NULL) <> 'updated'
     OR v2.update_staff_account(v_manager, v_operator, false, NULL) <> 'updated' THEN
    RAISE EXCEPTION 'Staff role or enabled-state updates failed';
  END IF;

  SELECT count(*) INTO v_page_count
  FROM v2.list_staff_account_change_history(v_manager, 2, NULL, NULL);
  IF v_page_count <> 3 THEN
    RAISE EXCEPTION 'Staff history did not return one bounded lookahead row';
  END IF;
  SELECT * INTO v_event
  FROM v2.list_staff_account_change_history(v_manager, 2, NULL, NULL)
  ORDER BY occurred_at DESC, event_id DESC
  LIMIT 1;
  IF v_event.actor_type <> 'staff'
     OR v_event.actor_id <> v_manager
     OR v_event.target_id <> v_operator
     OR v_event.change_type <> 'updated'
     OR v_event.before_state->>'disabled' <> 'true'
      OR v_event.after_state->>'disabled' <> 'false'
      OR v_event.occurred_at IS NULL
      OR v_event.occurred_at > clock_timestamp() THEN
    RAISE EXCEPTION 'Staff history did not preserve the actor, target, or enabled-state change';
  END IF;
  SELECT * INTO v_event
  FROM v2.list_staff_account_change_history(v_manager, 50, NULL, NULL)
  WHERE target_id = v_operator AND before_state->>'roleName' = 'operator'
    AND after_state->>'roleName' = 'manager'
  ORDER BY occurred_at DESC, event_id DESC
  LIMIT 1;
  IF v_event.event_id IS NULL OR v_event.actor_id <> v_manager
     OR v_event.before_state->>'roleName' <> 'operator'
     OR v_event.after_state->>'roleName' <> 'manager' THEN
    RAISE EXCEPTION 'Staff history did not preserve the actor and role transition';
  END IF;

  SELECT count(*) INTO v_manager_history
    FROM v2.list_staff_account_change_history(v_manager, 50, NULL, NULL);
  BEGIN
    PERFORM * FROM v2.list_staff_account_change_history(v_nonmanager, 50, NULL, NULL);
    RAISE EXCEPTION 'Non-manager unexpectedly read staff account history';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  SELECT string_agg(row_to_json(events)::text, '')
    INTO v_history_text
    FROM v2.list_staff_account_change_history(v_manager, 50, NULL, NULL) AS events;
  IF v_history_text ~* '(password|hash|bootstrapcode|session|csrf)' THEN
    RAISE EXCEPTION 'Staff history returned sensitive account or session fields';
  END IF;

  CREATE TRIGGER reject_staff_history_insert
    BEFORE INSERT ON v2.staff_account_change_events
    FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_staff_history_insert();

  BEGIN
    PERFORM v2.create_staff_account(
      v_manager, 'RejectAtomicCreate',
      'argon2id$v=19$m=19456,t=2,p=1$c2FsdA==$aGFzaA==', 'operator'
    );
  EXCEPTION WHEN data_exception THEN
    v_failed := true;
  END;
  IF NOT v_failed
     OR EXISTS (SELECT 1 FROM v2.staff_accounts WHERE username = 'RejectAtomicCreate') THEN
    RAISE EXCEPTION 'Account creation was not rolled back when its audit insert failed';
  END IF;

  v_failed := false;
  BEGIN
    PERFORM v2.update_staff_account(v_manager, v_operator, true, NULL);
  EXCEPTION WHEN data_exception THEN
    v_failed := true;
  END;
  IF NOT v_failed
     OR (SELECT disabled FROM v2.staff_accounts WHERE id = v_operator) IS DISTINCT FROM false
     OR (SELECT role_name FROM v2.user_roles WHERE user_id = v_operator) IS DISTINCT FROM 'manager' THEN
    RAISE EXCEPTION 'Account update was not rolled back when its audit insert failed';
  END IF;

  BEGIN
    UPDATE v2.staff_account_change_events SET target_username = 'tampered'
    WHERE target_id = v_operator;
    RAISE EXCEPTION 'Append-only account history accepted an update';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    NULL;
  END;

  SELECT count(*) INTO v_manager_history
    FROM v2.list_staff_account_change_history(v_manager, 50, NULL, NULL);
  IF v_manager_history <> 5 THEN
    RAISE EXCEPTION 'Authorized history omitted expected account changes';
  END IF;
  BEGIN
    PERFORM * FROM v2.list_staff_account_change_history(v_nonmanager, 50, NULL, NULL);
    RAISE EXCEPTION 'Non-manager unexpectedly read staff account history';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END
$$;

ROLLBACK;
