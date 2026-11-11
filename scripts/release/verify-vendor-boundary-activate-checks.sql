-- Assertions against the actual ACTIVATE definitions on representative tables.
-- Disposable instrumentation only; measure safe-row materializations per payload.
SET track_functions = 'all';
SELECT fixture.assert_true((SELECT count(*)=27 FROM pg_trigger WHERE tgname='fence_venue_durable_sink' AND NOT tgisinternal),
 'all 27 existing C1 attachments retained');
SELECT fixture.assert_true((SELECT count(*)=1 FROM pg_trigger WHERE tgname='fence_vendor_booking_durable_snapshot' AND NOT tgisinternal),
 'exactly one new vendor-booking attachment');
SELECT fixture.assert_true(NOT EXISTS(SELECT FROM fixture.pre_activate_triggers old
 WHERE NOT EXISTS(SELECT FROM pg_trigger now WHERE now.tgrelid=old.tgrelid AND now.tgname=old.tgname
 AND pg_get_triggerdef(now.oid)=old.definition)), 'no existing attachment removed or changed');
SELECT fixture.assert_true(NOT EXISTS(SELECT FROM pg_proc WHERE pronamespace='private'::regnamespace
 AND (proname LIKE '%vendor%' OR proname='fence_venue_durable_sink')
 AND prosrc ~* 'EXCEPTION[[:space:]]+WHEN'), 'vendor validators and guards have no exception-handler subtransactions');

DO $permissions$
DECLARE role_name text; privilege_name text; column_name text;
BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  FOREACH privilege_name IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
   PERFORM fixture.assert_true(NOT has_table_privilege(role_name,'public.discovery_vendors',privilege_name),role_name||' direct table '||privilege_name||' revoked');
  END LOOP;
  FOR column_name IN SELECT attname FROM pg_attribute WHERE attrelid='public.discovery_vendors'::regclass AND attnum>0 AND NOT attisdropped LOOP
   FOREACH privilege_name IN ARRAY ARRAY['SELECT','INSERT','UPDATE','REFERENCES'] LOOP
    IF has_column_privilege(role_name,'public.discovery_vendors',column_name,privilege_name) THEN
     RAISE EXCEPTION 'FAIL: residual column grant % % %',role_name,column_name,privilege_name;
    END IF;
   END LOOP;
  END LOOP;
  PERFORM fixture.assert_true(has_table_privilege(role_name,'public.discovery_vendors_safe','SELECT')=(role_name='service_role'),role_name||' safe-view permission');
 END LOOP;
END;
$permissions$;

DO $boundaries$
DECLARE vendor uuid; row_id uuid; evidence jsonb:=fixture.evidence(); envelope jsonb; safe jsonb; unsafe jsonb; sink record;
BEGIN
 vendor:=(public.upsert_discovery_vendor_identity('c2_activate_fixture')->>'id')::uuid;
 PERFORM public.write_discovery_vendor_independent_facts(vendor,'{"name":"Independent Supplier","service_type":"dj"}',
  jsonb_build_object('name',evidence,'service_type',evidence));
 envelope:=jsonb_build_object('schema_version',1,'identity',jsonb_build_object('kind','vendor','id',vendor,'place_id','c2_activate_fixture'),
  'values',jsonb_build_object('name','Independent Supplier','service_type','dj'),
  'field_provenance',jsonb_build_object('name',evidence,'service_type',evidence));
 safe:=jsonb_build_object('target_type','discovery_vendor','target_id',vendor,'vendor_data',envelope,'provider','Independent Supplier');
 unsafe:=jsonb_build_object('target_type','discovery_vendor','target_id',vendor,'provider','Unevidenced Google name');
 FOR sink IN SELECT * FROM fixture.sink_contract ORDER BY table_name LOOP
  PERFORM fixture.expect_rejected(format('INSERT INTO public.%I(id,%I) VALUES(gen_random_uuid(),%L::jsonb)',sink.table_name,sink.column_name,unsafe),sink.table_name||' rejects unevidenced vendor aliases');
  PERFORM fixture.expect_rejected(format('INSERT INTO public.%I(id,%I) VALUES(gen_random_uuid(),%L::jsonb)',sink.table_name,sink.column_name,
   jsonb_set(safe,'{vendor_data,values,name}','"Forged Supplier"')),sink.table_name||' rejects forged independent value');
  PERFORM fixture.expect_rejected(format('INSERT INTO public.%I(id,%I) VALUES(gen_random_uuid(),%L::jsonb)',sink.table_name,sink.column_name,
   jsonb_set(safe,'{vendor_data,field_provenance,name,source}','"google_places"')),sink.table_name||' rejects Google-origin evidence');
  PERFORM fixture.expect_rejected(format('INSERT INTO public.%I(id,%I) VALUES(gen_random_uuid(),%L::jsonb)',sink.table_name,sink.column_name,
   jsonb_set(safe,'{vendor_data,field_provenance,name,resolution}','"unresolved"')),sink.table_name||' rejects unresolved evidence');
  PERFORM fixture.expect_rejected(format('INSERT INTO public.%I(id,%I) VALUES(gen_random_uuid(),%L::jsonb)',sink.table_name,sink.column_name,
   safe||'{"googleLive":{"name":"provider overlay"}}'),sink.table_name||' rejects explicit provider overlay','%boundary%');
  row_id:=gen_random_uuid();
  EXECUTE format('INSERT INTO public.%I(id,%I) VALUES($1,$2)',sink.table_name,sink.column_name) USING row_id,safe;
  RAISE NOTICE 'PASS: % accepts independently evidenced vendor facts',sink.table_name;
  -- Alias-only changes cannot borrow an unchanged envelope or stable ID.
  PERFORM fixture.expect_rejected(format('UPDATE public.%I SET %I=%L::jsonb WHERE id=%L',sink.table_name,sink.column_name,
   safe||'{"provider":"Changed without evidence"}',row_id),sink.table_name||' rejects alias-only mutation',
   CASE WHEN sink.table_name='approvals' THEN 'approval_version_identity_is_immutable' ELSE 'vendor_boundary_%' END);
 END LOOP;
 PERFORM fixture.expect_rejected(format('SELECT private.assert_vendor_durable_json(%L::jsonb)',
  jsonb_set(safe,'{vendor_data,field_provenance,name,source}','"google_places"')),'Google-origin evidence does not become independent');
 PERFORM fixture.expect_rejected(format('SELECT private.assert_vendor_durable_json(%L::jsonb)',
  jsonb_set(safe,'{vendor_data,field_provenance,name,resolution}','"unresolved"')),'unresolved evidence is fail-closed');
 PERFORM fixture.assert_true((SELECT count(*)=15 FROM fixture.sink_contract),'exact approved 15-table test scope');
END;
$boundaries$;

-- Partner quote prose is a typed received record, not a discovery description.
DO $approval_notes$
DECLARE vendor uuid; plan uuid:=gen_random_uuid(); other_plan uuid:=gen_random_uuid(); response uuid:=gen_random_uuid();
 envelope jsonb; payload jsonb; snapshot jsonb; signed_before jsonb; approval uuid:=gen_random_uuid();
 action uuid:=gen_random_uuid(); approval_copy jsonb; forged jsonb; field_name text; saved jsonb;
BEGIN
 SELECT id INTO vendor FROM public.discovery_vendors_safe WHERE source_external_id='c2_activate_fixture';
 SELECT jsonb_build_object('schema_version',1,'identity',jsonb_build_object('kind','vendor','id',id,'place_id',google_place_id),
  'values',jsonb_build_object('name',name,'service_type',service_type),
  'field_provenance',jsonb_build_object('name',field_provenance->'name','service_type',field_provenance->'service_type'))
 INTO envelope FROM public.discovery_vendors_safe WHERE id=vendor;
 INSERT INTO public.plans(id) VALUES(plan),(other_plan);
 INSERT INTO public.vendor_outreach_responses(id,plan_id,discovery_vendor_id,classification,raw_response_excerpt)
 VALUES(response,plan,vendor,'quote_received','Partner confirmed the setup and price.');
 payload:=jsonb_build_object('kind','canonical_quote_booking','quote_kind','vendor','quote_response_id',response,
  'target_type','discovery_vendor','target_id',vendor,'vendor_data',envelope);
 snapshot:=jsonb_build_object('schema_version',2,'plan',jsonb_build_object('id',plan),
  'approval',jsonb_build_object('provider','Independent Supplier','notes','Partner confirmed the setup and price.'),
  'counterparty',jsonb_build_object('target_type','discovery_vendor','target_id',vendor,'provider','Independent Supplier'),
  'action',jsonb_build_object('payload_json',payload,'target_type','discovery_vendor','target_id',vendor));
 signed_before:=snapshot;
 INSERT INTO public.agent_actions(id,plan_id,action_type,target_type,target_id,status,payload_json,description)
 VALUES(action,plan,'concierge_queue','discovery_vendor',vendor,'pending',payload,'Prepare booking from accepted vendor quote');
 INSERT INTO public.approvals(id,plan_id,agent_action_id,status,snapshot_json,snapshot_schema_version,snapshot_hash,notes)
 VALUES(approval,plan,action,'pending',snapshot,2,repeat('b',64),'Partner confirmed the setup and price.');
 UPDATE public.agent_actions SET approval_id=approval WHERE id=action;
 PERFORM fixture.assert_true((SELECT notes='Partner confirmed the setup and price.' AND snapshot_json=signed_before
  FROM public.approvals WHERE id=approval),'physical approval preserves received quote notes and exact signed snapshot');
 SELECT to_jsonb(a) INTO approval_copy FROM public.approvals a WHERE a.id=approval;
 INSERT INTO public.plan_messages(plan_id,message_type,metadata)
 VALUES(plan,'approval_request',jsonb_build_object('approval',approval_copy)) RETURNING metadata INTO saved;
 PERFORM fixture.assert_true(saved->'approval'=approval_copy,'exact saved approval copy preserves partner notes and signed tuple');
 FOREACH field_name IN ARRAY ARRAY['id','plan_id','agent_action_id','snapshot_hash','snapshot_json'] LOOP
  forged:=CASE field_name
   WHEN 'snapshot_hash' THEN jsonb_set(approval_copy,ARRAY[field_name],to_jsonb(repeat('e',64)))
   WHEN 'snapshot_json' THEN jsonb_set(approval_copy,'{snapshot_json,plan,guest_count}','51'::jsonb)
   ELSE jsonb_set(approval_copy,ARRAY[field_name],to_jsonb(gen_random_uuid())) END;
  PERFORM fixture.assert_true(forged->'notes'=approval_copy->'notes','forged approval copy keeps note fixed while changing '||field_name);
  PERFORM fixture.expect_rejected(format('INSERT INTO public.plan_messages(plan_id,message_type,metadata) VALUES(%L,%L,%L::jsonb)',
   plan,'approval_request',jsonb_build_object('approval',forged)),
   'copied approval rejects changed '||field_name,'vendor_boundary_%');
 END LOOP;
 PERFORM fixture.expect_rejected(format($insert$INSERT INTO public.approvals(id,plan_id,status,snapshot_json,snapshot_schema_version,snapshot_hash,notes) VALUES(gen_random_uuid(),%L,'pending',%L,2,%L,%L)$insert$,
  plan,snapshot,repeat('b',64),'Unbound prose'),'approval notes must match signed received excerpt');
 PERFORM fixture.expect_rejected(format($insert$INSERT INTO public.approvals(id,plan_id,status,snapshot_json,snapshot_schema_version,snapshot_hash,notes) VALUES(gen_random_uuid(),%L,'pending',%L,2,%L,%L)$insert$,
  other_plan,snapshot,repeat('b',64),'Partner confirmed the setup and price.'),'approval excerpt cannot borrow another plan response');
 snapshot:=jsonb_set(snapshot,'{approval,notes}','"Forged same-value copy"');
 PERFORM fixture.expect_rejected(format($insert$INSERT INTO public.approvals(id,plan_id,status,snapshot_json,snapshot_schema_version,snapshot_hash,notes) VALUES(gen_random_uuid(),%L,'pending',%L,2,%L,%L)$insert$,
  plan,snapshot,repeat('b',64),'Forged same-value copy'),'matching self-authored snapshot notes do not establish received source');
END;
$approval_notes$;

DO $deep$
DECLARE payload jsonb:='{"amount_cents":500,"status":"pending"}'; i integer;
BEGIN
 FOR i IN 1..40 LOOP payload:=jsonb_build_object('child',payload,'siblings',jsonb_build_array(1,2,3,4,5)); END LOOP;
 PERFORM private.assert_vendor_durable_json(payload);
 RAISE NOTICE 'PASS: hundreds of nodes and 40 levels succeed without per-node exception boundaries';
 FOR i IN 41..70 LOOP payload:=jsonb_build_object('child',payload); END LOOP;
 PERFORM fixture.expect_rejected(format('SELECT private.assert_vendor_durable_json(%L::jsonb)',payload),'depth over 64 rejects deterministically');
END;
$deep$;

-- UPDATE checks use the same representative receiving columns as the matrix.
-- Legacy seeds are deliberately installed with only this fixture's guard off;
-- every tested operation runs with it enabled again.
DO $updates$
DECLARE sink record; row_id uuid; legacy jsonb; safe jsonb; envelope jsonb; vendor uuid; other_vendor uuid;
BEGIN
 SELECT id INTO vendor FROM public.discovery_vendors WHERE source_external_id='c2_activate_fixture';
 SELECT jsonb_build_object('schema_version',1,'identity',jsonb_build_object('kind','vendor','id',id,'place_id',google_place_id),
  'values',jsonb_build_object('name',name,'service_type',service_type),
  'field_provenance',jsonb_build_object('name',field_provenance->'name','service_type',field_provenance->'service_type'))
 INTO envelope FROM public.discovery_vendors_safe WHERE id=vendor;
 safe:=jsonb_build_object('target_type','discovery_vendor','target_id',vendor,'vendor_data',envelope,'provider','Independent Supplier');
 legacy:=jsonb_build_object('target_type','discovery_vendor','target_id',vendor,'provider','Untouched legacy Google name');
 FOR sink IN SELECT * FROM fixture.sink_contract ORDER BY table_name LOOP
  row_id:=gen_random_uuid();
  EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER fence_venue_durable_sink',sink.table_name);
  EXECUTE format('INSERT INTO public.%I(id,%I) VALUES($1,$2)',sink.table_name,sink.column_name) USING row_id,legacy;
  EXECUTE format('ALTER TABLE public.%I ENABLE TRIGGER fence_venue_durable_sink',sink.table_name);
  -- An exact no-op UPDATE also exercises trigger processing without a new copy.
  EXECUTE format('UPDATE public.%I SET id=id WHERE id=$1',sink.table_name) USING row_id;
  RAISE NOTICE 'PASS: % no-op UPDATE does not revalidate untouched legacy content',sink.table_name;
  IF sink.table_name NOT IN ('discovery_change_log','approvals') THEN
   EXECUTE format('UPDATE public.%I SET status=''pending'' WHERE id=$1',sink.table_name) USING row_id;
   RAISE NOTICE 'PASS: % operational-only UPDATE preserves untouched legacy content',sink.table_name;
  END IF;
 END LOOP;
 INSERT INTO public.recommendations(id,type,reference_id,external_name,metadata)
  VALUES(gen_random_uuid(),'vendor',vendor,'Independent Supplier',safe) RETURNING id INTO row_id;
 PERFORM fixture.expect_rejected(format('UPDATE public.recommendations SET external_name=''Unproven'' WHERE id=%L',row_id),
  'changed root alias with unchanged identity still requires evidence');
 -- A real discovery identity exercises source substitution; random IDs also represent native catalog vendors.
 other_vendor := (public.upsert_discovery_vendor_identity('c2_second_identity')->>'id')::uuid;
 PERFORM fixture.expect_rejected(format('UPDATE public.recommendations SET reference_id=%L WHERE id=%L',other_vendor,row_id),
  'identity substitution cannot retain stale root aliases');
 PERFORM fixture.expect_rejected(format('UPDATE public.recommendations SET metadata=%L::jsonb WHERE id=%L',
  jsonb_set(safe,'{vendor_data,identity,id}',to_jsonb(gen_random_uuid()::text)),row_id),'envelope substitution cannot retain old identity');
END;
$updates$;

DO $mixed_and_large$
DECLARE vendor jsonb; venue jsonb; mixed jsonb; big jsonb; saved jsonb; row_id uuid; i integer; started timestamptz; venue_id uuid; calls_before bigint; calls_after bigint;
BEGIN
 SELECT jsonb_build_object('schema_version',1,'identity',jsonb_build_object('kind','vendor','id',id,'place_id',google_place_id),
  'values',jsonb_build_object('name',name),'field_provenance',jsonb_build_object('name',field_provenance->'name'))
 INTO vendor FROM public.discovery_vendors_safe WHERE source_external_id='c2_activate_fixture';
 venue_id := (public.upsert_discovery_venue_identity('c2_mixed_venue')->>'id')::uuid;
 PERFORM public.write_discovery_venue_independent_facts(venue_id,'{"name":"Independent Hall"}',jsonb_build_object('name',fixture.evidence()));
 SELECT jsonb_build_object('schema_version',1,'identity',jsonb_build_object('kind','venue','id',id,'place_id',source_external_id),
  'values',jsonb_build_object('name',name),'field_provenance',jsonb_build_object('name',metadata#>'{field_provenance,name}'))
 INTO venue FROM public.discovery_venues_safe WHERE id=venue_id;
 PERFORM fixture.assert_true(vendor IS NOT NULL AND venue IS NOT NULL,'mixed payload contains both real independently evidenced partners');
 mixed:=jsonb_build_object('partners',jsonb_build_array(vendor,venue),'amount_cents',70000,'approved',true);
 INSERT INTO public.plans(metadata) VALUES(mixed) RETURNING id,metadata INTO row_id,saved;
 PERFORM fixture.assert_true(saved=mixed,'mixed independently evidenced venue and vendor pass both guards unchanged');
 SELECT jsonb_build_object('entries',jsonb_agg(jsonb_build_object('amount_cents',n,'approved',true))) INTO big FROM generate_series(1,500) n;
 FOR i IN 1..32 LOOP big:=jsonb_build_object('nested',big); END LOOP;
 big:=big||jsonb_build_object('vendor_data',vendor,'target_type','discovery_vendor','target_id',vendor#>>'{identity,id}');
 SELECT COALESCE(sum(calls),0) INTO calls_before FROM pg_stat_xact_user_functions
  WHERE funcid='private.discovery_vendor_safe_json(jsonb)'::regprocedure;
 started:=clock_timestamp();
 INSERT INTO public.plan_messages(metadata) VALUES(big) RETURNING id,metadata INTO row_id,saved;
 PERFORM fixture.assert_true(saved=big,'500-entry deep payload passes actual attachment unchanged');
 RAISE NOTICE 'MEASURED local deep INSERT milliseconds: %',extract(epoch FROM clock_timestamp()-started)*1000;
 SELECT COALESCE(sum(calls),0) INTO calls_after FROM pg_stat_xact_user_functions
  WHERE funcid='private.discovery_vendor_safe_json(jsonb)'::regprocedure;
 PERFORM fixture.assert_true(calls_after-calls_before BETWEEN 1 AND 2,
  '500-entry payload materializes source at most twice rather than once per node');
 RAISE NOTICE 'MEASURED safe vendor source materializations: %',calls_after-calls_before;
 PERFORM fixture.expect_rejected(format('UPDATE public.plan_messages SET metadata=%L::jsonb WHERE id=%L',
  jsonb_set(big,'{nested}',jsonb_build_object('googleLive',jsonb_build_object('name','forbidden'))),row_id),
  'large payload update with provider overlay fails closed','%boundary%');
 PERFORM fixture.assert_true((SELECT metadata=big FROM public.plan_messages WHERE id=row_id),'failed large update preserves money and original content');
 FOR i IN 1..70 LOOP mixed:=jsonb_build_object('nested',mixed); END LOOP;
 PERFORM fixture.expect_rejected(format('INSERT INTO public.plan_messages(metadata) VALUES(%L::jsonb)',mixed),
  'actual attachment bounds depth beyond 64','%boundary%');
END;
$mixed_and_large$;

\ir verify-vendor-boundary-operational.sql
