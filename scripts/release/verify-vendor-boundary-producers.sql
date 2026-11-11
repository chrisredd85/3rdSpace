-- LOCAL DISPOSABLE FULL-SCHEMA PROOF ONLY. setup before161; execute after paused161.
\if :setup
BEGIN;
CREATE SCHEMA c2_activate_proof;
CREATE TABLE c2_activate_proof.cases(case_number integer PRIMARY KEY,plan_id uuid,action_id uuid,approval_id uuid,task_id uuid);
CREATE TABLE c2_activate_proof.signed_before AS SELECT id,snapshot_hash,snapshot_json,authorized_by,authorized_at,authorized_amount_cents FROM public.approvals WHERE false;
CREATE TABLE c2_activate_proof.payload_before AS SELECT id,payload_json FROM public.agent_actions WHERE false;
CREATE TABLE c2_activate_proof.receipts(scenario text,rpc text,request_args jsonb,result jsonb);
CREATE FUNCTION c2_activate_proof.assert_true(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF; RAISE NOTICE 'PASS: %',label; END;
$$;
INSERT INTO auth.users(id,aud,role,email,created_at,updated_at) VALUES
 ('c2160000-0000-4000-8000-000000000001','authenticated','authenticated','c2-proof-host@example.com',now(),now()),
 ('c2160000-0000-4000-8000-000000000002','authenticated','authenticated','c2-proof-admin@example.com',now(),now());
INSERT INTO public.users(id,email,role,user_type) VALUES
 ('c2160000-0000-4000-8000-000000000001','c2-proof-host@example.com','builder','community_builder'),
 ('c2160000-0000-4000-8000-000000000002','c2-proof-admin@example.com','owner','venue_owner');
INSERT INTO public.builder_profiles(user_id,name) VALUES('c2160000-0000-4000-8000-000000000001','Local C2 proof host');

DO $seed$
DECLARE vendor uuid; evidence jsonb; envelope jsonb; payload jsonb; snapshot jsonb; p uuid; a uuid; approval uuid; task uuid; i integer;
BEGIN
 evidence:=jsonb_build_object('resolution','resolved','source','host_input','evidence_reference','fixture:owner-confirmation',
  'collected_at','2026-11-10T00:00:00Z','confidence',1,'confirmation_status','venue_confirmed','lineage','[]'::jsonb);
 vendor:=(public.upsert_discovery_vendor_identity('c2-activate-producer-proof')->>'id')::uuid;
 PERFORM public.write_discovery_vendor_independent_facts(vendor,'{"name":"Independent Supplier","service_type":"dj"}',jsonb_build_object('name',evidence,'service_type',evidence));
 envelope:=jsonb_build_object('schema_version',1,'identity',jsonb_build_object('kind','vendor','id',vendor,'place_id','c2-activate-producer-proof'),
  'values',jsonb_build_object('name','Independent Supplier','service_type','dj'),'field_provenance',jsonb_build_object('name',evidence,'service_type',evidence));
 FOR i IN 1..3 LOOP
  p:=gen_random_uuid();a:=gen_random_uuid();approval:=gen_random_uuid();
  INSERT INTO public.plans(id,user_id,title,status,date_window_start,date_window_end,guest_count,metadata)
   VALUES(p,'c2160000-0000-4000-8000-000000000001','Local producer proof','ready',current_date+30,current_date+30,24,
    jsonb_build_object('vendor_data',envelope,'legacy_vendor',jsonb_build_object('discovery_vendor_id',vendor,'name','Legacy Google name'))||'{"event_archetype_lock":{"key":"founder_operator_dinner"}}'::jsonb);
  payload:=jsonb_build_object('kind','concierge_booking','target_type','discovery_vendor','target_id',vendor,'vendor_data',envelope);
  INSERT INTO public.agent_actions(id,plan_id,action_type,description,provider,target_type,target_id,amount_cents,status,payload_json,result_metadata)
   VALUES(a,p,'concierge_queue','Approved operator request','Independent Supplier','discovery_vendor',vendor,70000,'pending',payload,
    jsonb_build_object('vendor_data',envelope,'legacy_vendor',jsonb_build_object('discovery_vendor_id',vendor,'name','Legacy Google name')));
  snapshot:=jsonb_build_object('schema_version',2,'action',jsonb_build_object('action_type','concierge_queue','target_type','discovery_vendor','target_id',vendor,'payload_json',payload,'amount_cents',70000),
   'approval',jsonb_build_object('provider','Independent Supplier'),'counterparty',jsonb_build_object('provider','Independent Supplier','target_type','discovery_vendor','target_id',vendor));
  INSERT INTO public.approvals(id,plan_id,agent_action_id,action_label,provider,event_date,price_cents,fees_cents,requested_amount_cents,expires_at,snapshot_hash,snapshot_json,snapshot_schema_version)
   VALUES(approval,p,a,'Approve operator request','Independent Supplier',current_date+30,70000,0,70000,now()+interval '7 days',repeat('c',64),snapshot,2);
  UPDATE public.agent_actions SET approval_id=approval WHERE id=a;
  UPDATE public.approvals SET status='authorized',authorized_amount_cents=70000,
   authorized_by='c2160000-0000-4000-8000-000000000001',authorized_at=now(),
   approved_by='c2160000-0000-4000-8000-000000000001',approved_at=now() WHERE id=approval;
  UPDATE public.agent_actions SET status='approved' WHERE id=a;
  PERFORM public.materialize_plan_event(p,'c2160000-0000-4000-8000-000000000001','founder_operator_dinner',current_date+30,'18:00'::time,120,'America/Los_Angeles');
  SELECT id INTO task FROM public.enqueue_approved_admin_task(p,a,approval,'c2160000-0000-4000-8000-000000000001',
   'concierge_booking','Approved operator request','normal',
   jsonb_build_object('vendor_data',envelope),NULL,NULL);
  UPDATE public.admin_tasks SET notes='Prior operator note.', metadata=metadata||jsonb_build_object('legacy_vendor',jsonb_build_object('discovery_vendor_id',vendor,'name','Legacy Google name')) WHERE id=task;
  INSERT INTO c2_activate_proof.cases VALUES(i,p,a,approval,task);
 END LOOP;
 INSERT INTO c2_activate_proof.signed_before SELECT id,snapshot_hash,snapshot_json,authorized_by,authorized_at,authorized_amount_cents
  FROM public.approvals WHERE id IN(SELECT approval_id FROM c2_activate_proof.cases);
 INSERT INTO c2_activate_proof.payload_before SELECT id,payload_json FROM public.agent_actions WHERE id IN(SELECT action_id FROM c2_activate_proof.cases);
END;
$seed$;
CREATE FUNCTION c2_activate_proof.expect_error(command text,code text,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 BEGIN EXECUTE command;
 EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE IS DISTINCT FROM code THEN RAISE; END IF;
  RAISE NOTICE 'PASS: % [%]',label,SQLSTATE; RETURN;
 END;
 RAISE EXCEPTION 'FAIL: expected rejection % [%]',label,code;
END;
$$;
GRANT USAGE ON SCHEMA c2_activate_proof TO service_role,authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA c2_activate_proof TO service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA c2_activate_proof TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA c2_activate_proof TO service_role,authenticated;
COMMIT;
\else
BEGIN;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claim.role='service_role';
DO $commands$
DECLARE c c2_activate_proof.cases; value jsonb; args jsonb; key text; ids jsonb; bad jsonb; expr text;
BEGIN
 SELECT * INTO STRICT c FROM c2_activate_proof.cases WHERE case_number=3;
 ids:=jsonb_build_object('p_plan_id',c.plan_id,'p_action_id',c.action_id,'p_approval_id',c.approval_id);
 -- Explicit SQL-null cases, rather than null-sensitive <> assertions.
 FOREACH key IN ARRAY ARRAY['p_plan_id','p_action_id','p_approval_id'] LOOP
  bad:=ids||jsonb_build_object(key,NULL);
  expr:=format('SELECT public.cancel_approved_admin_task(%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L,NULL)',bad->>'p_plan_id',bad->>'p_action_id',bad->>'p_approval_id','c2160000-0000-4000-8000-000000000001','Host requested cancellation.');
  PERFORM c2_activate_proof.expect_error(expr,'23514','host wrapper rejects null '||key);
  bad:=ids||jsonb_build_object(key,'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
  expr:=format('SELECT public.cancel_approved_admin_task(%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L,NULL)',bad->>'p_plan_id',bad->>'p_action_id',bad->>'p_approval_id','c2160000-0000-4000-8000-000000000001','Host requested cancellation.');
  PERFORM c2_activate_proof.expect_error(expr,'23514','host wrapper rejects mismatched '||key);
 END LOOP;
 PERFORM c2_activate_proof.expect_error(format('SELECT public.cancel_approved_admin_task(%L,%L,%L,%L,NULL,NULL)',c.plan_id,c.action_id,c.approval_id,'c2160000-0000-4000-8000-000000000002'),'23514','host wrapper rejects another actor before effect');
 PERFORM c2_activate_proof.assert_true((SELECT status='open' FROM public.admin_tasks WHERE id=c.task_id),'rejected host tuples left task open');
 PERFORM c2_activate_proof.expect_error(format('UPDATE public.admin_tasks SET metadata=jsonb_set(metadata,%L,%L::jsonb) WHERE id=%L','{vendor_data,values,name}','"Forged Vendor"',c.task_id),'22023','forged task envelope rejected');

 SELECT * INTO STRICT c FROM c2_activate_proof.cases WHERE case_number=1;
 args:=jsonb_build_object('p_task_id',c.task_id,'p_admin_user_id','c2160000-0000-4000-8000-000000000002','p_outcome_payload',jsonb_build_object('outcome','completed','summary','Operator completed the agreed setup.'),'p_host_message',NULL,'p_internal_note','Operator confirmed setup with host.');
 SELECT to_jsonb(r) INTO value FROM public.complete_admin_task_execution(c.task_id,'c2160000-0000-4000-8000-000000000002',args->'p_outcome_payload',NULL,args->>'p_internal_note') r;
 INSERT INTO c2_activate_proof.receipts VALUES('complete','complete_admin_task_execution',args,value);
 SELECT to_jsonb(r) INTO value FROM public.complete_admin_task_execution(c.task_id,'c2160000-0000-4000-8000-000000000002',args->'p_outcome_payload',NULL,args->>'p_internal_note') r;
 INSERT INTO c2_activate_proof.receipts VALUES('complete_repeat','complete_admin_task_execution',args,value);
 SELECT * INTO STRICT c FROM c2_activate_proof.cases WHERE case_number=2;
 args:=jsonb_build_object('p_task_id',c.task_id,'p_actor_id','c2160000-0000-4000-8000-000000000002','p_reason','Host requested cancellation.','p_host_message',NULL);
 SELECT to_jsonb(r) INTO value FROM public.cancel_admin_task_execution(c.task_id,'c2160000-0000-4000-8000-000000000002',args->>'p_reason',NULL) r;
 INSERT INTO c2_activate_proof.receipts VALUES('cancel','cancel_admin_task_execution',args,value);
 SELECT to_jsonb(r) INTO value FROM public.cancel_admin_task_execution(c.task_id,'c2160000-0000-4000-8000-000000000002',args->>'p_reason',NULL) r;
 INSERT INTO c2_activate_proof.receipts VALUES('cancel_repeat','cancel_admin_task_execution',args,value);
 SELECT * INTO STRICT c FROM c2_activate_proof.cases WHERE case_number=3;
 args:=ids||jsonb_build_object('p_actor_id','c2160000-0000-4000-8000-000000000001','p_reason','Host requested cancellation.','p_host_message',NULL);
 SELECT to_jsonb(r) INTO value FROM public.cancel_approved_admin_task(c.plan_id,c.action_id,c.approval_id,'c2160000-0000-4000-8000-000000000001',args->>'p_reason',NULL) r;
 INSERT INTO c2_activate_proof.receipts VALUES('host_cancel','cancel_approved_admin_task',args,value);
END;
$commands$;
SELECT c2_activate_proof.assert_true(NOT EXISTS(SELECT FROM c2_activate_proof.signed_before b JOIN public.approvals a USING(id)
 WHERE (b.snapshot_hash,b.snapshot_json,b.authorized_by,b.authorized_at,b.authorized_amount_cents) IS DISTINCT FROM
       (a.snapshot_hash,a.snapshot_json,a.authorized_by,a.authorized_at,a.authorized_amount_cents)), 'complete/cancel preserve signed snapshot hash and authorization byte-for-byte');
SELECT c2_activate_proof.assert_true(NOT EXISTS(SELECT FROM c2_activate_proof.payload_before b JOIN public.agent_actions a USING(id)
 WHERE a.payload_json IS DISTINCT FROM b.payload_json), 'complete/cancel preserve original approved action payload');
SELECT c2_activate_proof.assert_true((SELECT count(*)=3 FROM public.plan_messages WHERE plan_id IN(SELECT plan_id FROM c2_activate_proof.cases)
 AND metadata->>'state' IN('concierge_task_completed','concierge_task_cancelled')), 'repeated completion/cancellation emits one outcome message per task');
SELECT c2_activate_proof.assert_true(NOT EXISTS(SELECT FROM public.agent_actions WHERE id IN(SELECT action_id FROM c2_activate_proof.cases)
 AND result_metadata::text LIKE '%Legacy Google%'), 'new action result copies contain no legacy Google fact');
SELECT c2_activate_proof.assert_true(NOT EXISTS(SELECT FROM public.admin_audit_log WHERE entity_id IN(SELECT task_id FROM c2_activate_proof.cases)
 AND (before_state::text LIKE '%Legacy Google%' OR after_state::text LIKE '%Legacy Google%')), 'new task audit copies contain no legacy Google fact');
SELECT c2_activate_proof.assert_true((SELECT bool_and(result->>'notes' LIKE '%Prior operator note.%') FROM c2_activate_proof.receipts), 'prior operator notes preserved on all five receipts');
SELECT c2_activate_proof.assert_true((SELECT result FROM c2_activate_proof.receipts WHERE scenario='complete') IS NOT DISTINCT FROM (SELECT result FROM c2_activate_proof.receipts WHERE scenario='complete_repeat'), 'completion repeat is identical');
SELECT c2_activate_proof.assert_true((SELECT result FROM c2_activate_proof.receipts WHERE scenario='cancel') IS NOT DISTINCT FROM (SELECT result FROM c2_activate_proof.receipts WHERE scenario='cancel_repeat'), 'cancellation repeat is identical');
COMMIT;
SELECT jsonb_agg(to_jsonb(r) ORDER BY scenario) FROM c2_activate_proof.receipts r;
\endif
