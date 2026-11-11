SELECT fixture.assert_true((SELECT relacl=(SELECT relacl FROM fixture.vendor_before_acl) FROM pg_class
  WHERE oid='public.discovery_vendors'::regclass),'old vendor table grants unchanged');
SELECT fixture.assert_true(NOT EXISTS(SELECT FROM fixture.baseline_functions old JOIN pg_proc p USING(oid)
  WHERE old.definition IS DISTINCT FROM pg_get_functiondef(p.oid) OR old.proacl IS DISTINCT FROM p.proacl),
  'all preexisting routine bodies and privileges unchanged');
SELECT fixture.assert_true(NOT EXISTS(SELECT FROM fixture.baseline_acl old JOIN pg_class c USING(oid)
  WHERE old.relacl IS DISTINCT FROM c.relacl),'all preexisting relation grants unchanged');
SELECT fixture.assert_true((SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal)=(SELECT count(*) FROM fixture.baseline_triggers)
  AND NOT EXISTS(SELECT FROM fixture.baseline_triggers old JOIN pg_trigger t USING(oid)
  WHERE old.definition IS DISTINCT FROM pg_get_triggerdef(t.oid)),'no trigger added or changed');
SELECT fixture.assert_true(NOT EXISTS(SELECT FROM pg_proc WHERE proname IN ('vendor_boundary_fact_valid',
  'discovery_vendor_safe_json','upsert_discovery_vendor_identity','write_discovery_vendor_independent_facts',
  'stage_vendor_quote_booking_checked') AND (prosrc~*'EXCEPTION[[:space:]]+WHEN' OR proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog'])),
  'all new routines pin search_path; no exception boundaries');
SELECT fixture.assert_true(NOT has_table_privilege('anon','public.discovery_vendors_safe','SELECT')
  AND NOT has_table_privilege('authenticated','public.discovery_vendors_safe','SELECT')
  AND has_table_privilege('service_role','public.discovery_vendors_safe','SELECT'),'safe view service-role only');
SELECT fixture.assert_true(NOT EXISTS(SELECT FROM pg_proc WHERE proname IN ('vendor_boundary_fact_valid','discovery_vendor_safe_json',
  'upsert_discovery_vendor_identity','write_discovery_vendor_independent_facts','stage_vendor_quote_booking_checked') AND
  (has_function_privilege('anon',oid,'EXECUTE') OR has_function_privilege('authenticated',oid,'EXECUTE')
    OR NOT has_function_privilege('service_role',oid,'EXECUTE'))),'new helper and RPC ACLs service-role only');

-- Existing direct old app access still succeeds after EXPAND.
SET ROLE service_role;
INSERT INTO public.discovery_vendors(source,source_external_id,name,service_type,google_rating,website)
  VALUES('google_places','legacy_direct','Legacy Google label','dj',4.9,'https://google-bootstrap.example');
UPDATE public.discovery_vendors SET name='Old direct writer still works' WHERE source_external_id='legacy_direct';
SELECT fixture.assert_true((SELECT name='Old direct writer still works' FROM public.discovery_vendors
  WHERE source_external_id='legacy_direct'),'old direct INSERT/UPDATE/SELECT remain usable');
DISCARD PLANS;
SELECT fixture.assert_true((SELECT name IS NULL AND service_type IS NULL AND website IS NULL AND google_rating IS NULL
  FROM public.discovery_vendors_safe WHERE source_external_id='legacy_direct'),'cold safe view hides unresolved Google content');
UPDATE public.discovery_vendors SET website_extraction_status='successful',website_extraction_metadata='{"paths_successful":["/contact"]}',
  extracted_contact_forms='[{"url":"https://independent.example/contact","label":"Observed contact","confidence":0.9,"source_path":"/contact","extracted_at":"2026-11-10T00:00:00Z","is_likely_booking_contact":true,"evidence_kind":"contact_link"},{"url":"https://independent.example/contact","label":"Invalid legacy contact","confidence":0.9,"source_path":"/contact","extracted_at":"2026-11-10T00:00:00Z","is_likely_booking_contact":true,"evidence_kind":null}]'
  WHERE source_external_id='legacy_direct';
SELECT fixture.assert_true((SELECT jsonb_array_length(extracted_contact_forms)=1 AND
  extracted_contact_forms->0->>'label'='Observed contact' AND extracted_contact_forms->0->'is_likely_booking_contact'='false'::jsonb
  FROM public.discovery_vendors_safe WHERE source_external_id='legacy_direct'),
  'legacy contact fallback retains typed observed facts only, removing Google-context selection flag');
SELECT fixture.assert_true((public.upsert_discovery_vendor_identity('c2_fixture')->>'name') IS NULL
  AND (public.upsert_discovery_vendor_identity('c2_fixture')->>'service_type') IS NULL,
  'identity insertion needs no fabricated name or service');
SELECT fixture.assert_true((public.upsert_discovery_vendor_identity('c2_fixture')->>'state') IS NULL,'no fabricated CA default');
SELECT fixture.assert_true((SELECT count(*)=1 FROM public.discovery_vendors WHERE source_external_id='c2_fixture'),
  'identity retry reuses one UUID');
SELECT public.write_discovery_vendor_independent_facts((SELECT id FROM public.discovery_vendors WHERE source_external_id='c2_fixture'),
  '{"name":"Independent DJ","service_type":"dj","inferred_package_rate_cents":70000}',
  jsonb_build_object('name',fixture.evidence(),'service_type',fixture.evidence(),'inferred_package_rate_cents',fixture.evidence()));
SELECT fixture.assert_true((SELECT name='Independent DJ' AND service_type='dj' AND inferred_package_rate_cents=70000
  FROM public.discovery_vendors_safe WHERE source_external_id='c2_fixture'),'independent scalar values and integer cents survive');
SELECT public.write_discovery_vendor_independent_facts((SELECT id FROM public.discovery_vendors WHERE source_external_id='c2_fixture'),
  '{"organizer_provided_email":"host-rescue@example.com","extracted_emails":[{"email":"booking@example.com","confidence":0.9,"source_path":"/contact","extracted_at":"2026-11-10T00:00:00Z","is_likely_booking_contact":true,"source":"business_website","source_url":"https://business.example/contact"}],"extracted_contact_forms":[{"url":"https://business.example/booking","label":"Booking","confidence":0.9,"source_path":"/booking","extracted_at":"2026-11-10T00:00:00Z","is_likely_booking_contact":true,"evidence_kind":"contact_link"}]}',
  jsonb_build_object('organizer_provided_email',fixture.evidence(),'extracted_emails',fixture.evidence('venue_site'),'extracted_contact_forms',fixture.evidence('venue_site')));
SELECT fixture.assert_true((SELECT organizer_provided_email='host-rescue@example.com' AND extracted_emails->0->>'email'='booking@example.com'
  AND extracted_contact_forms->0->>'evidence_kind'='contact_link' FROM public.discovery_vendors_safe WHERE source_external_id='c2_fixture'),
  'typed website contacts, neutral booking links and independent host rescue survive safe read');
RESET ROLE;
DO $invalid_facts$
DECLARE v_id uuid; n integer; bad jsonb; d jsonb;
BEGIN
  SELECT id INTO v_id FROM public.discovery_vendors WHERE source_external_id='c2_fixture';
  FOREACH bad IN ARRAY ARRAY['{}'::jsonb,fixture.evidence('google_places'),
    jsonb_set(fixture.evidence(),'{resolution}','"unresolved"'),
    fixture.evidence('derived')||jsonb_build_object('lineage',jsonb_build_array(jsonb_build_object('field','google_name','provenance',fixture.evidence('google_places'))))] LOOP
    BEGIN
      PERFORM public.write_discovery_vendor_independent_facts(v_id,'{"name":"Rejected"}',jsonb_build_object('name',bad));
      RAISE EXCEPTION 'FAIL: invalid provenance accepted';
    EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  END LOOP;
  PERFORM fixture.assert_true((SELECT name='Independent DJ' FROM public.discovery_vendors WHERE id=v_id),
    'missing, Google, unresolved and Google-ancestor provenance reject before mutation');
  BEGIN
    PERFORM public.write_discovery_vendor_independent_facts(v_id,'{"photos":["places/photo/token"]}',jsonb_build_object('photos',fixture.evidence()));
    RAISE EXCEPTION 'FAIL: prohibited photo fact accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM public.write_discovery_vendor_independent_facts(v_id,'{}','{}','{"website_extraction_metadata":{"google_name":"bad"}}');
    RAISE EXCEPTION 'FAIL: metadata escape accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM public.write_discovery_vendor_independent_facts(v_id,'{"inferred_package_rate_cents":7.5}',jsonb_build_object('inferred_package_rate_cents',fixture.evidence()));
    RAISE EXCEPTION 'FAIL: fractional cents accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM public.write_discovery_vendor_independent_facts(v_id,'{"extracted_emails":[{"email":"booking@example.com","googleLive":{"name":"bad"}}]}',jsonb_build_object('extracted_emails',fixture.evidence('venue_site')));
    RAISE EXCEPTION 'FAIL: contact metadata escape accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  FOREACH bad IN ARRAY ARRAY[
    '{"url":"https://business.example/contact","label":{"googleLive":"hidden"},"confidence":0.9,"source_path":"/contact","extracted_at":"2026-11-10T00:00:00Z","is_likely_booking_contact":true}'::jsonb,
    '{"url":"https://business.example/contact","label":"Contact","confidence":0.9,"source_path":"/contact","extracted_at":"2026-11-10T00:00:00Z","is_likely_booking_contact":true,"evidence_kind":null}'::jsonb,
    '{"url":"https://credentials@business.example/contact","label":"Contact","confidence":0.9,"source_path":"/contact","extracted_at":"2026-11-10T00:00:00Z","is_likely_booking_contact":true}'::jsonb] LOOP
    BEGIN
      PERFORM public.write_discovery_vendor_independent_facts(v_id,jsonb_build_object('extracted_contact_forms',jsonb_build_array(bad)),jsonb_build_object('extracted_contact_forms',fixture.evidence('venue_site')));
      RAISE EXCEPTION 'FAIL: malformed typed contact accepted';
    EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  END LOOP;
  PERFORM fixture.assert_true((SELECT inferred_package_rate_cents=70000 AND extracted_emails->0->>'email'='booking@example.com' FROM public.discovery_vendors WHERE id=v_id),
    'fractional cents and contact metadata escape reject without losing saved data');
  d:=fixture.evidence();
  FOR n IN 1..12 LOOP d:=fixture.evidence('derived')||jsonb_build_object('lineage',jsonb_build_array(jsonb_build_object('field','name','provenance',d))); END LOOP;
  PERFORM public.write_discovery_vendor_independent_facts(v_id,'{"name":"Independent DJ"}',jsonb_build_object('name',d));
  PERFORM fixture.assert_true((SELECT name='Independent DJ' FROM public.discovery_vendors_safe WHERE id=v_id),'deep independent lineage works without recursive exceptions');
  PERFORM public.write_discovery_vendor_independent_facts(v_id,'{"name":"Independent DJ"}',jsonb_build_object('name',fixture.evidence()));
  FOR n IN 1..12 LOOP PERFORM fixture.setup_case(n,v_id); END LOOP;
END;
$invalid_facts$;

INSERT INTO public.vendor_profiles(id) VALUES('c2000000-0000-4000-8000-000000000002');
SELECT fixture.assert_true(public.upsert_discovery_vendor_identity(NULL,'c2000000-0000-4000-8000-000000000002')->>'source'
  ='vendor_self_service','self-service identity derived from existing profile');
DO $identities$
DECLARE first_id text; linked_id uuid; before_count integer;
BEGIN
  first_id:=public.upsert_discovery_vendor_identity(NULL,'c2000000-0000-4000-8000-000000000002')->>'id';
  PERFORM fixture.assert_true(public.upsert_discovery_vendor_identity(NULL,'c2000000-0000-4000-8000-000000000002')->>'id'=first_id,
    'self-service identity retry reuses UUID');
  SELECT id INTO linked_id FROM public.discovery_vendors WHERE source_external_id='c2_fixture';
  INSERT INTO public.vendor_profiles(id,discovery_vendor_id) VALUES('c2000000-0000-4000-8000-000000000003',linked_id);
  SELECT count(*) INTO before_count FROM public.discovery_vendors;
  PERFORM fixture.assert_true(public.upsert_discovery_vendor_identity(NULL,'c2000000-0000-4000-8000-000000000003')->>'id'=linked_id::text
    AND (SELECT count(*)=before_count FROM public.discovery_vendors),'linked profile preserves canonical discovery UUID without creating a second row');
  INSERT INTO public.vendor_profiles(id,discovery_vendor_id) VALUES('c2000000-0000-4000-8000-000000000004',gen_random_uuid());
  BEGIN PERFORM public.upsert_discovery_vendor_identity(NULL,'c2000000-0000-4000-8000-000000000004'); RAISE EXCEPTION 'FAIL: dangling identity invented a replacement';
    EXCEPTION WHEN no_data_found THEN NULL; END;
  DELETE FROM public.vendor_profiles WHERE id='c2000000-0000-4000-8000-000000000004';
  PERFORM fixture.assert_true((SELECT count(*)=before_count FROM public.discovery_vendors),'missing linked row fails closed without replacement');
  BEGIN PERFORM public.upsert_discovery_vendor_identity(NULL,gen_random_uuid()); RAISE EXCEPTION 'FAIL: nonexistent profile accepted';
    EXCEPTION WHEN no_data_found THEN NULL; END;
  BEGIN PERFORM public.upsert_discovery_vendor_identity('places/bad'); RAISE EXCEPTION 'FAIL: uncanonical Place ID accepted';
    EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM public.upsert_discovery_vendor_identity('both','c2000000-0000-4000-8000-000000000002'); RAISE EXCEPTION 'FAIL: two identities accepted';
    EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  INSERT INTO public.discovery_vendors(source,source_external_id,name,service_type) VALUES
    ('google_places','places/ambiguous','old one','dj'),('google_places','ambiguous','old two','dj');
  BEGIN PERFORM public.upsert_discovery_vendor_identity('ambiguous'); RAISE EXCEPTION 'FAIL: ambiguous aliases collapsed';
    EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  PERFORM fixture.assert_true((SELECT count(*)=2 FROM public.discovery_vendors WHERE source_external_id IN ('places/ambiguous','ambiguous')),
    'invalid identities and ambiguous legacy aliases fail closed without merging or overwriting');
END;
$identities$;
SET ROLE service_role;
SELECT set_config('request.jwt.claim.role','service_role',false);
SELECT fixture.assert_true(fixture.stage(1)->'existing'='false'::jsonb,'checked gateway delegates real staging successfully');
SELECT fixture.assert_true(fixture.stage(1)->'existing'='true'::jsonb,'checked exact retry preserves old idempotency');
SELECT fixture.assert_true((SELECT count(*)=1 FROM public.approvals WHERE plan_id=(SELECT plan_id FROM fixture.stage_inputs WHERE case_id=1)),
  'one staged approval only');
SELECT fixture.assert_true((SELECT a.snapshot_json=i.snapshot AND a.snapshot_hash=repeat('c',64)
  AND action.payload_json=i.payload AND a.provider='Independent DJ'
  FROM fixture.stage_inputs i JOIN public.approvals a ON a.id=i.approval_id
  JOIN public.agent_actions action ON action.id=i.action_id WHERE i.case_id=1),'reviewed payload, snapshot and hash persist byte-equivalently');
RESET ROLE;
DO $bad_stage$
DECLARE i fixture.stage_inputs; before_plan jsonb; n integer;
BEGIN
  SELECT * INTO i FROM fixture.stage_inputs WHERE case_id=2;
  SELECT to_jsonb(p) INTO before_plan FROM public.plans p WHERE id=i.plan_id;
  UPDATE fixture.stage_inputs SET payload=jsonb_set(payload,'{target_name}','"Forged"') WHERE case_id=2;
  BEGIN PERFORM fixture.stage(2); RAISE EXCEPTION 'FAIL: mismatched name accepted';
    EXCEPTION WHEN check_violation THEN NULL; END;
  UPDATE fixture.stage_inputs SET payload=i.payload,snapshot=jsonb_set(snapshot,'{action,payload_json,target_name}','"Forged"') WHERE case_id=2;
  BEGIN PERFORM fixture.stage(2); RAISE EXCEPTION 'FAIL: mismatched signed payload accepted';
    EXCEPTION WHEN check_violation THEN NULL; END;
  UPDATE fixture.stage_inputs SET payload=i.payload,snapshot=i.snapshot WHERE case_id=2;
  BEGIN PERFORM public.stage_vendor_quote_booking_checked(i.plan_id,gen_random_uuid(),'vendor',i.response_id,i.action_id,i.approval_id,
    now()+interval '1 day',i.payload,i.snapshot,repeat('c',64)); RAISE EXCEPTION 'FAIL: other actor accepted';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM fixture.assert_true((SELECT to_jsonb(p)=before_plan FROM public.plans p WHERE id=i.plan_id)
    AND NOT EXISTS(SELECT FROM public.agent_actions WHERE plan_id=i.plan_id)
    AND NOT EXISTS(SELECT FROM public.approvals WHERE plan_id=i.plan_id)
    AND NOT EXISTS(SELECT FROM public.plan_messages WHERE plan_id=i.plan_id),
    'stale/forged evidence and wrong actor leave plan/action/approval/card untouched');
END;
$bad_stage$;

-- The new gateway does not replace the old producer or old direct entry point.
SET ROLE service_role;
SELECT public.stage_plan_quote_booking(plan_id,'c2000000-0000-4000-8000-000000000001','vendor',response_id,
  action_id,approval_id,now()+interval '1 day',payload-'vendor_data',snapshot,repeat('d',64))
  FROM fixture.stage_inputs WHERE case_id=3;
RESET ROLE;
SELECT fixture.assert_true(EXISTS(SELECT FROM public.approvals WHERE id=(SELECT approval_id FROM fixture.stage_inputs WHERE case_id=3)),
  'old staging entry point remains backward compatible');
