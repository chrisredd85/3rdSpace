-- Full schema producer proof; run setup on160, execute after161. Disposable only.
\if :setup
BEGIN;
CREATE TABLE c2_activate_proof.stage_cases(case_number integer PRIMARY KEY, plan_id uuid,response_id uuid,action_id uuid,approval_id uuid,quote_kind text,payload jsonb,snapshot jsonb);
CREATE TABLE c2_activate_proof.stage_receipts(case_number integer,result jsonb);
CREATE TABLE c2_activate_proof.revision_cases(case_number integer PRIMARY KEY,plan_id uuid,action_id uuid,approval_id uuid,message_id uuid,source_id uuid,recommendation_id uuid,thread_id uuid);
CREATE TABLE c2_activate_proof.revision_receipts(case_number integer,revision_id uuid,impact jsonb,new_revision_count integer);
CREATE TABLE c2_activate_proof.saved_approval AS SELECT id,snapshot_json,snapshot_hash,authorized_at,authorized_by,authorized_amount_cents FROM public.approvals WHERE false;
CREATE FUNCTION c2_activate_proof.evidence() RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT jsonb_build_object('resolution','resolved','source','host_input','evidence_reference','fixture:owner-confirmation',
 'collected_at','2026-11-10T00:00:00Z','confidence',1,'confirmation_status','venue_confirmed','lineage','[]'::jsonb)
$$;
CREATE FUNCTION c2_activate_proof.stage(p_case integer,p_gateway boolean DEFAULT true) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE c c2_activate_proof.stage_cases;
BEGIN
 SELECT * INTO STRICT c FROM c2_activate_proof.stage_cases WHERE case_number=p_case;
 IF p_gateway THEN RETURN public.stage_vendor_quote_booking_checked(c.plan_id,'c2160000-0000-4000-8000-000000000001',c.quote_kind,c.response_id,c.action_id,c.approval_id,now()+interval '1 day',c.payload,c.snapshot,repeat('d',64)); END IF;
 RETURN public.stage_plan_quote_booking(c.plan_id,'c2160000-0000-4000-8000-000000000001',c.quote_kind,c.response_id,c.action_id,c.approval_id,now()+interval '1 day',c.payload,c.snapshot,repeat('d',64));
END;
$$;
DO $seed$
DECLARE vendor uuid; venue uuid; evidence jsonb:=c2_activate_proof.evidence(); envelope jsonb; venvelope jsonb; payload jsonb; snapshot jsonb;
 p uuid; a uuid; approval uuid; response uuid; msg uuid; src uuid; rec uuid; thread uuid; i integer; kind text; target uuid; name text;
BEGIN
 SELECT id INTO STRICT vendor FROM public.discovery_vendors_safe WHERE google_place_id='c2-activate-producer-proof';
 PERFORM public.write_discovery_vendor_independent_facts(vendor,'{"contact_email":"vendor@example.com"}',jsonb_build_object('contact_email',evidence));
 envelope:=jsonb_build_object('schema_version',1,'identity',jsonb_build_object('kind','vendor','id',vendor,'place_id','c2-activate-producer-proof'),
 'values',jsonb_build_object('name','Independent Supplier','service_type','dj','contact_email','vendor@example.com'),
 'field_provenance',jsonb_build_object('name',evidence,'service_type',evidence,'contact_email',evidence));
 venue:=(public.upsert_discovery_venue_identity('c2-activate-independent-hall')->>'id')::uuid;
 PERFORM public.write_discovery_venue_independent_facts(venue,'{"name":"Independent Hall"}',jsonb_build_object('name',evidence));
 venvelope:=jsonb_build_object('schema_version',1,'identity',jsonb_build_object('kind','venue','id',venue,'place_id','c2-activate-independent-hall'),
 'values',jsonb_build_object('name','Independent Hall'),'field_provenance',jsonb_build_object('name',evidence));
 INSERT INTO public.vendor_profiles(id,user_id,name,vendor_type,discovery_vendor_id)
 VALUES('c2160000-0000-4000-8000-000000000005','c2160000-0000-4000-8000-000000000002','Independent Supplier','DJ / Music',vendor);
 FOR i IN 1..12 LOOP
  kind:=CASE WHEN i=3 THEN 'venue' ELSE 'vendor' END; target:=CASE WHEN kind='venue' THEN venue ELSE vendor END; name:=CASE WHEN kind='venue' THEN 'Independent Hall' ELSE 'Independent Supplier' END;
  p:=gen_random_uuid(); response:=gen_random_uuid(); a:=gen_random_uuid(); approval:=gen_random_uuid();
  INSERT INTO public.plans(id,user_id,title,status,guest_count,budget_cap_cents,date_window_start,date_window_end,metadata,committed_vendors)
  VALUES(p,'c2160000-0000-4000-8000-000000000001','Producer stage proof','ready',24,140000,current_date+30,current_date+30,
   jsonb_build_object('legacy_vendor',jsonb_build_object('discovery_vendor_id',vendor,'name','Legacy Google name'),'event_archetype_lock',jsonb_build_object('key','founder_operator_dinner')),
   jsonb_build_array(jsonb_build_object('discovery_vendor_id',vendor,'service_type','other','name','Legacy Google name')));
  payload:=jsonb_build_object('kind','canonical_quote_booking','quote_kind',kind,'quote_response_id',response,
    'target_type','discovery_'||kind,'target_id',target,'target_name',name,'booking_slot',CASE WHEN kind='venue' THEN 'venue' ELSE 'vendor:dj' END,
    'event_date',(current_date+30)::text,'requested_amount_cents',70000,'price_cents',70000,
    CASE WHEN kind='venue' THEN 'venue_data' ELSE 'vendor_data' END,CASE WHEN kind='venue' THEN venvelope ELSE envelope END);
  IF kind='vendor' THEN payload:=payload||'{"service_type":"dj"}'; END IF;
  snapshot:=jsonb_build_object('schema_version',2,'plan','{}'::jsonb,'approval',jsonb_build_object('provider',name,'event_date',(current_date+30)::text,'requested_amount_cents',70000,'price_cents',70000,'fees_cents',0,'notes','Partner confirmed the $700 package includes setup.','package_details',CASE WHEN kind='vendor' THEN 'dj' ELSE NULL END),
   'counterparty',jsonb_build_object('provider',name,'display_name',name,'target_type','discovery_'||kind,'target_id',target),
   'action',jsonb_build_object('action_type','concierge_queue','target_type','discovery_'||kind,'target_id',target,'amount_cents',70000,'payload_json',payload));
  IF kind='venue' THEN
   INSERT INTO public.venue_outreach_responses(id,plan_id,discovery_venue_id,classification,quoted_price_cents,quoted_deal_model,availability_confirmed,raw_response_excerpt) VALUES(response,p,target,'quote_received',70000,'flat_fee',true,'Partner confirmed the $700 package includes setup.');
  ELSE
   INSERT INTO public.vendor_outreach_responses(id,plan_id,discovery_vendor_id,classification,quoted_package_cents,availability_confirmed,raw_response_excerpt) VALUES(response,p,target,'quote_received',70000,true,'Partner confirmed the $700 package includes setup.');
  END IF;
  INSERT INTO c2_activate_proof.stage_cases VALUES(i,p,response,a,approval,kind,payload,snapshot);
 END LOOP;
 -- Pre161 signed booking input proves no consent rewrite during activation.
 PERFORM c2_activate_proof.stage(11,false);
 UPDATE public.approvals SET status='authorized',authorized_by='c2160000-0000-4000-8000-000000000001',authorized_at=now(),authorized_amount_cents=70000,
  approved_by='c2160000-0000-4000-8000-000000000001',approved_at=now() WHERE id=(SELECT approval_id FROM c2_activate_proof.stage_cases WHERE case_number=11);
 UPDATE public.agent_actions SET status='approved' WHERE id=(SELECT action_id FROM c2_activate_proof.stage_cases WHERE case_number=11);
 PERFORM public.materialize_plan_event((SELECT plan_id FROM c2_activate_proof.stage_cases WHERE case_number=11),'c2160000-0000-4000-8000-000000000001','founder_operator_dinner',current_date+30,'18:00'::time,120,'America/Los_Angeles');
 FOR i IN 1..3 LOOP
  p:=gen_random_uuid();a:=gen_random_uuid();approval:=gen_random_uuid();msg:=gen_random_uuid();src:=gen_random_uuid();rec:=gen_random_uuid();thread:=gen_random_uuid();
  INSERT INTO public.plans(id,user_id,title,status,guest_count,budget_cap_cents,date_window_start,date_window_end,metadata)
  VALUES(p,'c2160000-0000-4000-8000-000000000001','Revision producer proof','ready',24,140000,current_date+30,current_date+30,jsonb_build_object('legacy_vendor',jsonb_build_object('discovery_vendor_id',vendor,'name','Legacy Google name')));
  payload:=jsonb_build_object('target_type','discovery_vendor','target_id',vendor,'vendor_data',envelope);
  INSERT INTO public.agent_actions(id,plan_id,action_type,description,provider,target_type,target_id,status,payload_json)
  VALUES(a,p,'vendor_contact','Independent Supplier','Independent Supplier','discovery_vendor',vendor,'pending',payload);
  snapshot:=jsonb_build_object('schema_version',2,'plan','{}'::jsonb,'approval',jsonb_build_object('provider','Independent Supplier'),'action',jsonb_build_object('target_type','discovery_vendor','target_id',vendor,'payload_json',payload));
  INSERT INTO public.approvals(id,plan_id,agent_action_id,action_label,provider,event_date,price_cents,fees_cents,requested_amount_cents,expires_at,snapshot_hash,snapshot_json,snapshot_schema_version)
  VALUES(approval,p,a,'Independent Supplier','Independent Supplier',current_date+30,70000,0,70000,now()+interval '1 day',repeat('e',64),snapshot,2);
  UPDATE public.agent_actions SET approval_id=approval WHERE id=a;
  INSERT INTO public.plan_messages(id,plan_id,role,message_type,content,metadata) VALUES
   (msg,p,'agent','approval_request','Approval requested',jsonb_build_object('approval',jsonb_build_object('id',approval,'status','pending','snapshot_hash',repeat('e',64),'provider','Legacy Google name'),'agent_action_id',a,'vendor_data',envelope)),
   (src,p,'user','text','Please revise the date.','{}');
  INSERT INTO public.recommendations(id,plan_id,type,rank,reference_id,external_name,metadata) VALUES(rec,p,'vendor',1,vendor,'Independent Supplier',jsonb_build_object('vendor_data',envelope,'legacy_vendor',jsonb_build_object('discovery_vendor_id',vendor,'name','Legacy Google name')));
  INSERT INTO public.outreach_threads(id,plan_id,user_id,target_type,target_id,target_name,target_email,discovery_vendor_id,state,channel_strategy)
  VALUES(thread,p,'c2160000-0000-4000-8000-000000000001','vendor',vendor,'Independent Supplier','vendor@example.com',vendor,CASE WHEN i=1 THEN 'draft' ELSE 'awaiting_reply' END,jsonb_build_object('vendor_data',envelope));
  INSERT INTO c2_activate_proof.revision_cases VALUES(i,p,a,approval,msg,src,rec,thread);
 END LOOP;
 INSERT INTO c2_activate_proof.saved_approval SELECT id,snapshot_json,snapshot_hash,authorized_at,authorized_by,authorized_amount_cents FROM public.approvals WHERE id IN(SELECT approval_id FROM c2_activate_proof.revision_cases);
END;
$seed$;
CREATE SCHEMA c2_attack;
CREATE TABLE c2_attack.plans(poison text);
CREATE TABLE c2_attack.approvals(poison text);
CREATE TABLE c2_attack.recommendations(poison text);
GRANT USAGE ON SCHEMA c2_attack TO authenticated,service_role;
GRANT ALL ON ALL TABLES IN SCHEMA c2_activate_proof TO service_role;
GRANT SELECT,INSERT ON ALL TABLES IN SCHEMA c2_activate_proof TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA c2_activate_proof TO service_role,authenticated;
COMMIT;
\else
BEGIN;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claim.role='service_role';
DO $stage$
DECLARE c c2_activate_proof.stage_cases; result jsonb; replay jsonb; i integer; before_count integer;
BEGIN
 FOREACH i IN ARRAY ARRAY[1,2,3] LOOP
  SELECT * INTO STRICT c FROM c2_activate_proof.stage_cases WHERE case_number=i;
  result:=c2_activate_proof.stage(i,i=1);
  replay:=c2_activate_proof.stage(i,i=1);
  PERFORM c2_activate_proof.assert_true(result->>'existing'='false' AND replay->>'existing'='true','stage direct/gateway '||i||' exact retry');
  PERFORM c2_activate_proof.assert_true(result#>>'{approval,notes}'='Partner confirmed the $700 package includes setup.','stage '||i||' preserves partner quote notes');
  PERFORM c2_activate_proof.assert_true(result#>'{approval,snapshot_json}'=c.snapshot AND result#>>'{approval,snapshot_hash}'=repeat('d',64),'stage '||i||' preserves supplied consent');
  PERFORM c2_activate_proof.assert_true((SELECT count(*)=1 FROM public.agent_actions WHERE plan_id=c.plan_id),'stage '||i||' creates one action');
  PERFORM c2_activate_proof.assert_true((SELECT metadata::text NOT LIKE '%Legacy Google%' FROM public.plans WHERE id=c.plan_id),'stage '||i||' projects copied mixed plan metadata');
  IF c.quote_kind='vendor' THEN
   PERFORM c2_activate_proof.assert_true(result#>'{plan,metadata,accepted_quote_state,vendors,0,vendor_data}' IS NOT NULL OR result#>'{plan,committed_vendors,0,vendor_data}' IS NOT NULL,'stage carries independently validated vendor envelope into quote');
  END IF;
  INSERT INTO c2_activate_proof.stage_receipts VALUES(i,result);
 END LOOP;
 SELECT * INTO STRICT c FROM c2_activate_proof.stage_cases WHERE case_number=4;
 UPDATE c2_activate_proof.stage_cases SET payload=jsonb_set(payload,'{target_name}','"Forged Supplier"') WHERE case_number=4;
 PERFORM c2_activate_proof.expect_error('SELECT c2_activate_proof.stage(4,true)','23514','payload/snapshot mismatch rejects before mutation');
 PERFORM c2_activate_proof.assert_true(NOT EXISTS(SELECT FROM public.agent_actions WHERE plan_id=c.plan_id),'bad stage leaves no partial action');
END;
$stage$;
COMMIT;
-- Actual authenticated explicit and chat callers under a hostile caller search_path.
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.role='authenticated';
SET LOCAL request.jwt.claim.sub='c2160000-0000-4000-8000-000000000001';
SET LOCAL search_path=c2_attack,public;
INSERT INTO c2_activate_proof.revision_receipts
SELECT 1,r.* FROM c2_activate_proof.revision_cases c CROSS JOIN LATERAL public.apply_plan_revision_atomic(c.plan_id,'c2160000-0000-4000-8000-000000000001','{"type":"date_change"}',NULL,'{"guest_count":30}',jsonb_build_object('invalidated_recommendation_ids',jsonb_build_array(c.recommendation_id),'superseded_approval_ids',jsonb_build_array(c.approval_id),'superseded_outreach_thread_ids',jsonb_build_array(c.thread_id),'triggers_rediscovery',jsonb_build_array('vendor')),'Host changed the plan.') r WHERE c.case_number=1;
INSERT INTO c2_activate_proof.revision_receipts
SELECT 2,r.* FROM c2_activate_proof.revision_cases c CROSS JOIN LATERAL public.apply_plan_revision_atomic(c.plan_id,'c2160000-0000-4000-8000-000000000001','{"type":"budget_change"}',c.source_id,'{"budget_cap_cents":150000}',jsonb_build_object('invalidated_recommendation_ids',jsonb_build_array(c.recommendation_id),'superseded_approval_ids',jsonb_build_array(c.approval_id),'superseded_outreach_thread_ids',jsonb_build_array(c.thread_id),'triggers_rediscovery',jsonb_build_array('vendor')),'Chat requested revision.') r WHERE c.case_number=2;
COMMIT;
BEGIN;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claim.role='service_role';
INSERT INTO c2_activate_proof.revision_receipts
SELECT 3,r.* FROM c2_activate_proof.revision_cases c CROSS JOIN LATERAL public.apply_plan_revision_atomic(c.plan_id,'c2160000-0000-4000-8000-000000000001','{"type":"budget_change"}',NULL,'{"budget_cap_cents":150000}',jsonb_build_object('invalidated_recommendation_ids',jsonb_build_array(c.recommendation_id),'superseded_approval_ids',jsonb_build_array(c.approval_id),'superseded_outreach_thread_ids',jsonb_build_array(c.thread_id),'triggers_rediscovery',jsonb_build_array('vendor')),'Service cascade revision.') r WHERE c.case_number=3;
SELECT c2_activate_proof.assert_true((SELECT count(*)=3 AND bool_and(new_revision_count=1) FROM c2_activate_proof.revision_receipts),'explicit/chat/service R1-A return tuple and counts');
SELECT c2_activate_proof.assert_true(NOT EXISTS(SELECT FROM c2_activate_proof.saved_approval b JOIN public.approvals a USING(id) WHERE (a.snapshot_json,a.snapshot_hash,a.authorized_at,a.authorized_by,a.authorized_amount_cents) IS DISTINCT FROM (b.snapshot_json,b.snapshot_hash,b.authorized_at,b.authorized_by,b.authorized_amount_cents)),'revision preserves all signed records');
SELECT c2_activate_proof.assert_true((SELECT bool_and(m.metadata#>>'{approval,id}'=c.approval_id::text AND m.metadata#>>'{approval,status}'='superseded' AND m.metadata#>>'{approval,snapshot_hash}'=repeat('e',64) AND m.metadata::text NOT LIKE '%Legacy Google%') FROM c2_activate_proof.revision_cases c JOIN public.plan_messages m ON m.id=c.message_id),'non-Gmail nested approval lookup/status/hash survive supersession');
SELECT c2_activate_proof.assert_true((SELECT bool_and(a.status='superseded' AND rec.status='superseded' AND t.state=CASE WHEN c.case_number=1 THEN 'cancelled' ELSE 'stale' END) FROM c2_activate_proof.revision_cases c JOIN public.approvals a ON a.id=c.approval_id JOIN public.recommendations rec ON rec.id=c.recommendation_id JOIN public.outreach_threads t ON t.id=c.thread_id),'revision impact transitions preserved');
SELECT c2_activate_proof.assert_true((SELECT count(*)=3 FROM public.outreach_messages m JOIN c2_activate_proof.revision_cases c ON c.thread_id=m.thread_id WHERE m.headers_json->>'system_event'='plan_revision_superseded'),'revision system events preserved');
SELECT c2_activate_proof.assert_true(NOT EXISTS(SELECT FROM public.audit_logs l JOIN c2_activate_proof.revision_cases c ON c.plan_id=l.plan_id WHERE l.action='planner.plan_revision.applied' AND l.before_state::text LIKE '%Legacy Google%'),'revision new audit omits legacy Google content');
COMMIT;
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.role='authenticated';
SET LOCAL request.jwt.claim.sub='c2160000-0000-4000-8000-000000000002';
SELECT c2_activate_proof.expect_error(format('SELECT * FROM public.apply_plan_revision_atomic(%L,%L,%L,NULL,%L,%L)',plan_id,'c2160000-0000-4000-8000-000000000001','{"type":"budget_change"}','{}','{}'),'42501','revision rejects actor/owner mismatch') FROM c2_activate_proof.revision_cases WHERE case_number=1;
SET LOCAL request.jwt.claim.sub='c2160000-0000-4000-8000-000000000001';
SELECT c2_activate_proof.expect_error(format('SELECT * FROM public.apply_plan_revision_atomic(%L,%L,%L,%L,%L,%L)',a.plan_id,'c2160000-0000-4000-8000-000000000001','{"type":"budget_change"}',b.source_id,'{}','{}'),'42501','revision rejects cross-plan source') FROM c2_activate_proof.revision_cases a,c2_activate_proof.revision_cases b WHERE a.case_number=1 AND b.case_number=2;
SELECT c2_activate_proof.expect_error(format('SELECT * FROM public.apply_plan_revision_atomic(%L,%L,%L,NULL,%L,%L)',a.plan_id,'c2160000-0000-4000-8000-000000000001','{"type":"budget_change"}','{}',jsonb_build_object('superseded_approval_ids',jsonb_build_array(b.approval_id))),'42501','revision rejects cross-plan impact approval') FROM c2_activate_proof.revision_cases a,c2_activate_proof.revision_cases b WHERE a.case_number=1 AND b.case_number=2;
COMMIT;
\endif
