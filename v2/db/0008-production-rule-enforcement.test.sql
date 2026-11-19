BEGIN;
DO $$
DECLARE
  f uuid;
  a uuid := gen_random_uuid();
  imp uuid := gen_random_uuid();
  rid uuid := gen_random_uuid();
  blocked_id uuid := gen_random_uuid();
  response jsonb;
  replay jsonb;
  findings jsonb;
  command text := 'recovery-rule-start';
  request_hash text := repeat('a', 64);
BEGIN
  SELECT facility_id INTO STRICT f FROM v2.facility_scope;
  INSERT INTO v2.setup_catalog_imports
    (facility_id, id, actor_id, request_id, request_hash, family, records, status, applied_at)
  VALUES (f, imp, a, 'recovery-rules', repeat('b', 64), 'production-rules',
    '[{"code":"LIMIT","name":"Case limit","data":{}}]'::jsonb, 'applied', clock_timestamp());
  INSERT INTO v2.setup_production_rule_records
    (facility_id, code, name, source_import_id, data)
  VALUES (f, 'LIMIT', 'Case limit', imp,
    '{"type":"numeric-range","enforcement":"flexible","enabled":true,"field":"casesNeeded",
      "min":1,"max":100,"attribute":null,"before":null,"after":null,"bypass":[],"checklist":[]}'::jsonb);

  INSERT INTO v2.runs(facility_id,id,status,revision,created_at,updated_at,setup_snapshot)
  VALUES (f,rid,'planned',0,now(),now(),'{"label":"Synthetic rule run","targetCases":300}');
  findings := v2.run_snapshot(f,rid)->'productionRules';
  IF findings->0->>'status' <> 'violated' THEN
    RAISE EXCEPTION 'Flexible rule must warn, not silently pass: %', findings;
  END IF;

  UPDATE v2.setup_production_rule_records
    SET data=jsonb_set(data,'{enforcement}','"strict"') WHERE facility_id=f AND code='LIMIT';
  BEGIN
    INSERT INTO v2.runs(facility_id,id,status,revision,created_at,updated_at,setup_snapshot)
    VALUES (f,blocked_id,'planned',0,now(),now(),'{"label":"Blocked run","targetCases":300}');
    RAISE EXCEPTION 'Strict rule allowed invalid preparation';
  EXCEPTION WHEN SQLSTATE 'P2001' THEN NULL;
  END;
  IF EXISTS(SELECT 1 FROM v2.runs WHERE facility_id=f AND id=blocked_id) THEN
    RAISE EXCEPTION 'Rejected preparation left a run behind';
  END IF;
  BEGIN
    PERFORM v2.apply_run_lifecycle_command(f,rid,a,command,request_hash,'start',0);
    RAISE EXCEPTION 'Strict rule allowed invalid start';
  EXCEPTION WHEN SQLSTATE 'P2001' THEN NULL;
  END;
  IF (SELECT revision FROM v2.runs WHERE facility_id=f AND id=rid) <> 0
    OR EXISTS(SELECT 1 FROM v2.command_receipts WHERE facility_id=f AND actor_id=a AND command_id=command)
  THEN RAISE EXCEPTION 'Rejected start mutated the run or wrote a receipt'; END IF;

  UPDATE v2.setup_production_rule_records SET data=jsonb_set(data,'{bypass}',
    '[{"field":"casesNeeded","value":"300"}]') WHERE facility_id=f AND code='LIMIT';
  response := v2.apply_run_lifecycle_command(f,rid,a,command,request_hash,'start',0);
  IF response->>'outcome' <> 'accepted'
    OR response#>>'{run,productionRules,0,status}' <> 'bypassed'
  THEN RAISE EXCEPTION 'Approved imported bypass was not enforced or returned'; END IF;
  IF NOT EXISTS(SELECT 1 FROM v2.run_events WHERE facility_id=f AND run_id=rid
    AND payload#>>'{run,productionRules,0,status}'='bypassed') THEN
    RAISE EXCEPTION 'Accepted rule decision was not retained in immutable audit';
  END IF;

  UPDATE v2.setup_production_rule_records
    SET data=jsonb_set(data,'{enabled}','false') WHERE facility_id=f AND code='LIMIT';
  replay := v2.apply_run_lifecycle_command(f,rid,a,command,request_hash,'start',0);
  IF replay - 'replayed' <> response - 'replayed' OR replay->>'replayed' <> 'true' THEN
    RAISE EXCEPTION 'Command replay changed the original rule assessment';
  END IF;
  IF v2.run_snapshot(f,rid)#>>'{productionRules,0,status}' <> 'bypassed' THEN
    RAISE EXCEPTION 'Later rule edits replaced the started run decision';
  END IF;
  IF v2.assess_production_rules(f,'{"targetCases":300}',rid) <> '[]'::jsonb THEN
    RAISE EXCEPTION 'Disabled rule was still assessed';
  END IF;
  UPDATE v2.setup_production_rule_records SET data=data ||
    '{"enabled":true,"field":"dieType","type":"required-field","bypass":[]}'::jsonb
    WHERE facility_id=f AND code='LIMIT';
  findings:=v2.assess_production_rules(f,'{"targetCases":300}',rid);
  IF findings->0->>'status' <> 'unknown' THEN
    RAISE EXCEPTION 'Missing source input must remain unknown';
  END IF;
  IF v2.assess_production_rules('99000000-0000-4000-8000-000000000099',
    '{"targetCases":300}',rid) <> '[]'::jsonb THEN
    RAISE EXCEPTION 'Rules leaked outside the authenticated facility';
  END IF;
END
$$;
ROLLBACK;
