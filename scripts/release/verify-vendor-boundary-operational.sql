-- Disposable representative proof of actual typed C2 outreach/history branches.
-- Payload shapes mirror gmailApprovalFlow.ts (dispatch/import) and freshness.ts;
-- no provider call, fake trusted marker, disabled guard or production operation.
BEGIN;
CREATE TABLE fixture.vendor_operational_context(
 host_id uuid,other_host_id uuid,vendor_id uuid,profile_id uuid,plan_id uuid,other_plan_id uuid,
 action_id uuid,approval_id uuid,thread_id uuid,other_thread_id uuid,revision_id uuid,other_revision_id uuid,
 dispatch jsonb,receipt jsonb,self_history jsonb,report_history jsonb,stripe_history jsonb);
GRANT USAGE ON SCHEMA fixture TO service_role,authenticated;
GRANT SELECT ON fixture.vendor_operational_context TO service_role,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.creator_email_accounts TO service_role;
-- Deliberately let an authenticated test reach the real row guard. This is a
-- fixture grant, not a proposed app permission; source RPC/view ACLs stay intact.
GRANT INSERT ON public.outreach_messages,public.discovery_change_log TO authenticated;
CREATE FUNCTION fixture.insert_vendor_message(p_row jsonb) RETURNS void LANGUAGE sql AS $$
 INSERT INTO public.outreach_messages SELECT r.* FROM jsonb_populate_record(NULL::public.outreach_messages,
   -- Mirror real NOT NULL defaults (20260601000000:107 and 000002:42-46).
   '{"headers_json":{},"attachments_json":[],"provider_metadata_json":{},"sent_manually":false}'::jsonb
   ||p_row||jsonb_build_object('id',gen_random_uuid())) r;
$$;
CREATE FUNCTION fixture.insert_vendor_history(p_row jsonb) RETURNS void LANGUAGE sql AS $$
 INSERT INTO public.discovery_change_log SELECT r.* FROM jsonb_populate_record(NULL::public.discovery_change_log,
   p_row||jsonb_build_object('id',gen_random_uuid())) r;
$$;

DO $setup$
DECLARE c fixture.vendor_operational_context; e jsonb:=fixture.evidence(); envelope jsonb; target jsonb; payload jsonb; snapshot jsonb;
BEGIN
 c.host_id:=gen_random_uuid(); c.other_host_id:=gen_random_uuid(); c.profile_id:=gen_random_uuid();
 c.plan_id:=gen_random_uuid(); c.other_plan_id:=gen_random_uuid(); c.action_id:=gen_random_uuid(); c.approval_id:=gen_random_uuid();
 c.thread_id:=gen_random_uuid(); c.other_thread_id:=gen_random_uuid(); c.revision_id:=gen_random_uuid(); c.other_revision_id:=gen_random_uuid();
 c.vendor_id:=(public.upsert_discovery_vendor_identity('c2-operational-vendor')->>'id')::uuid;
 PERFORM public.write_discovery_vendor_independent_facts(c.vendor_id,
  '{"name":"Independent DJ","service_type":"dj","contact_email":"booking@example.com"}',
  jsonb_build_object('name',e,'service_type',e,'contact_email',e));
 envelope:=jsonb_build_object('schema_version',1,'identity',jsonb_build_object('kind','vendor','id',c.vendor_id,'place_id','c2-operational-vendor'),
  'values',jsonb_build_object('name','Independent DJ','service_type','dj','contact_email','booking@example.com'),
  'field_provenance',jsonb_build_object('name',e,'service_type',e,'contact_email',e));
 INSERT INTO public.vendor_profiles(id,discovery_vendor_id,name,contact_email,user_id)
 VALUES(c.profile_id,c.vendor_id,'Independent DJ','booking@example.com',c.host_id);
 INSERT INTO public.plans(id,user_id,title,status) VALUES(c.plan_id,c.host_id,'Operator proof','ready'),(c.other_plan_id,c.other_host_id,'Other host proof','ready');
 INSERT INTO public.creator_email_accounts(user_id,provider,email_address) VALUES(c.host_id,'gmail','host@example.com');
 target:=jsonb_build_object('discoveryVendorId',c.vendor_id,'name','Independent DJ','email','booking@example.com','vendor_data',envelope);
 payload:=jsonb_build_object('kind','gmail_approved_outreach','sender_email','host@example.com','subject','Availability request',
  'body_text','Hello {{target_name}}, reply to {{sender_email}}.','targets',jsonb_build_array(target));
 snapshot:=jsonb_build_object('schema_version',2,'plan',jsonb_build_object('id',c.plan_id,'user_id',c.host_id),
  'approval','{}'::jsonb,'action',jsonb_build_object('payload_json',payload));
 INSERT INTO public.agent_actions(id,plan_id,action_type,status,payload_json,approval_id)
 VALUES(c.action_id,c.plan_id,'email','approved',payload,c.approval_id);
 INSERT INTO public.approvals(id,plan_id,agent_action_id,status,authorized_by,approved_by,snapshot_json,snapshot_schema_version,snapshot_hash)
 VALUES(c.approval_id,c.plan_id,c.action_id,'authorized',c.host_id,c.host_id,snapshot,2,repeat('d',64));
 INSERT INTO public.outreach_threads(id,plan_id,user_id,target_id,discovery_vendor_id,target_type,target_name,target_email,channel,state,source_agent_action_id,channel_strategy)
 VALUES(c.thread_id,c.plan_id,c.host_id,c.vendor_id,c.vendor_id,'discovery_vendor','Independent DJ','booking@example.com','email','awaiting_reply',c.action_id,
  jsonb_build_object('vendor_data',envelope)),
 (c.other_thread_id,c.other_plan_id,c.other_host_id,c.vendor_id,c.vendor_id,'discovery_vendor','Independent DJ','booking@example.com','email','awaiting_reply',NULL,
  jsonb_build_object('vendor_data',envelope));
 INSERT INTO public.plan_revisions(id,plan_id) VALUES(c.revision_id,c.plan_id),(c.other_revision_id,c.other_plan_id);
 c.dispatch:=jsonb_build_object('thread_id',c.thread_id,'agent_action_id',c.action_id,'approval_id',c.approval_id,'direction','outbound',
  'subject','Availability request','body_text','Hello Independent DJ, reply to host@example.com.',
  'body_html','Hello Independent DJ, reply to host@example.com.',
  'headers_json',jsonb_build_object('to','booking@example.com','from','host@example.com','message-id','<c2-proof@example.com>'),
  'provider_metadata_json',jsonb_build_object('provider','gmail','approval_flow','gmail_approved_outreach'),
  'attachments_json','[]'::jsonb,'sent_manually',true,'rfc_message_id','<c2-proof@example.com>',
  'gmail_message_id','initial-send','gmail_thread_id','operational-thread');
 c.receipt:=jsonb_build_object('thread_id',c.thread_id,'direction','inbound','subject','Partner reply','body_text','Available, quote attached in prose.',
  'headers_json','{}'::jsonb,'provider_metadata_json',jsonb_build_object('provider','gmail','sync_source','gmail.readonly'),
  'attachments_json','[]'::jsonb,'sent_manually',false,'gmail_message_id','reply-1','gmail_thread_id','operational-thread');
 c.self_history:=jsonb_build_object('entity_type','discovery_vendor','entity_id',c.vendor_id,'source','vendor_self_update',
  'field_name','service_area','old_value',NULL,'new_value','Bay Area','confidence',1,'actor_id',c.host_id,'applied',true,'applied_at','2026-11-10T12:00:00Z',
  'source_evidence',jsonb_build_object('route','/vendor/services','vendor_profile_id',c.profile_id,'updated_by_user_id',c.host_id)::text);
 c.report_history:=jsonb_build_object('entity_type','discovery_vendor','entity_id',c.vendor_id,'source','organizer_report',
  'field_name','contact_email','old_value',NULL,'new_value',jsonb_build_object('category','wrong_contact','details','Booking address bounced'),
  'confidence',0.3,'actor_id',c.host_id,'applied',false,'applied_at',NULL,
  'source_evidence',jsonb_build_object('category','wrong_contact','details','Booking address bounced','reporter_user_id',c.host_id,'plan_id',c.plan_id)::text);
 c.stripe_history:=jsonb_build_object('entity_type','discovery_vendor','entity_id',c.vendor_id,'source','stripe_account_event',
  'field_name','stripe_connect_status','old_value','pending','new_value','active','confidence',1,'applied',true,'applied_at','2026-11-10T12:00:00Z',
  'source_evidence',jsonb_build_object('account_id','acct_fixture','event_id','evt_fixture','charges_enabled',true,'payouts_enabled',true,
   'capabilities','{}'::jsonb,'requirements',NULL)::text);
 INSERT INTO fixture.vendor_operational_context SELECT c.*;
END;
$setup$;

SET LOCAL ROLE service_role;
DO $dispatch_and_import$
DECLARE c fixture.vendor_operational_context; bad jsonb;
BEGIN
 SELECT * INTO STRICT c FROM fixture.vendor_operational_context;
 PERFORM fixture.insert_vendor_message(c.dispatch);
 PERFORM fixture.assert_true((SELECT count(*)=1 FROM public.outreach_messages WHERE agent_action_id=c.action_id AND approval_id=c.approval_id),
  'approved dispatch preserves exact owned approval/action tuple and rendered body');
 PERFORM fixture.insert_vendor_message(c.receipt);
 PERFORM fixture.insert_vendor_message(c.receipt||'{"direction":"outbound","gmail_message_id":"reply-2"}');
 PERFORM fixture.assert_true((SELECT count(*)=2 FROM public.outreach_messages WHERE thread_id=c.thread_id AND agent_action_id IS NULL AND approval_id IS NULL),
  'trusted Gmail inbound and outbound imports allow no approval pointer');
 PERFORM fixture.expect_rejected(format('SELECT fixture.insert_vendor_message(%L)',c.receipt||'{"gmail_thread_id":"not-established"}'),
  'Gmail marker cannot invent a thread','vendor_boundary_untrusted_gmail_import');
 PERFORM fixture.expect_rejected(format('SELECT fixture.insert_vendor_message(%L)',c.receipt||jsonb_build_object('thread_id',c.other_thread_id)),
  'Gmail receipt cannot borrow another owner account/thread','vendor_boundary_untrusted_gmail_import');
 PERFORM fixture.expect_rejected(format('SELECT fixture.insert_vendor_message(%L)',c.receipt||jsonb_build_object('approval_id',c.approval_id)),
  'read-only receipt cannot claim approval-backed dispatch','vendor_boundary_untrusted_gmail_import');
 PERFORM fixture.expect_rejected(format('SELECT fixture.insert_vendor_message(%L)',c.receipt||'{"provider_metadata_json":{"provider":"gmail","sync_source":"gmail.readonly","trusted":true}}'),
  'extra Gmail trust marker cannot select import branch','vendor_boundary_unapproved_outreach_copy');
 PERFORM fixture.expect_rejected(format('SELECT fixture.insert_vendor_message(%L)',c.dispatch||'{"body_text":"Changed after approval"}'),
  'approved dispatch rejects altered rendered body','vendor_boundary_dispatch_copy_mismatch');
 PERFORM fixture.expect_rejected(format('SELECT fixture.insert_vendor_message(%L)',jsonb_set(c.dispatch,'{headers_json,to}','"other@example.com"')),
  'approved dispatch rejects recipient substitution','vendor_boundary_dispatch_copy_mismatch');
 PERFORM fixture.expect_rejected(format('SELECT fixture.insert_vendor_message(%L)',c.dispatch||jsonb_build_object('approval_id',gen_random_uuid())),
  'approved dispatch rejects forged approval tuple','vendor_boundary_unapproved_outreach_copy');
 PERFORM fixture.expect_rejected(format('SELECT fixture.insert_vendor_message(%L)',c.dispatch||jsonb_build_object('thread_id',c.other_thread_id)),
  'approved dispatch rejects cross-plan thread','vendor_boundary_unapproved_outreach_copy');
 -- Hold the request/snapshot fixed but change the mutable action payload. The
 -- immutable signed snapshot must still match before any new dispatch copy.
 UPDATE public.agent_actions SET payload_json=jsonb_set(payload_json,'{subject}','"Mutated subject"') WHERE id=c.action_id;
 PERFORM fixture.expect_rejected(format('SELECT fixture.insert_vendor_message(%L)',c.dispatch),
  'dispatch requires signed snapshot equality with current action','vendor_boundary_invalid_dispatch_contract');
 UPDATE public.agent_actions SET payload_json=jsonb_set(payload_json,'{subject}','"Availability request"') WHERE id=c.action_id;
 UPDATE public.creator_email_accounts SET revoked_at=now() WHERE user_id=c.host_id;
 PERFORM fixture.expect_rejected(format('SELECT fixture.insert_vendor_message(%L)',c.receipt),
  'revoked Gmail account cannot import','vendor_boundary_untrusted_gmail_import');
 UPDATE public.creator_email_accounts SET revoked_at=NULL WHERE user_id=c.host_id;
END;
$dispatch_and_import$;
RESET ROLE;

SET LOCAL ROLE authenticated;
DO $unauthenticated_markers$
DECLARE c fixture.vendor_operational_context;
BEGIN
 SELECT * INTO STRICT c FROM fixture.vendor_operational_context;
 PERFORM set_config('request.jwt.claim.sub',c.host_id::text,true);
 PERFORM fixture.expect_rejected(format('SELECT fixture.insert_vendor_message(%L)',c.receipt),
  'authenticated host cannot forge trusted Gmail import','vendor_boundary_untrusted_gmail_import');
 PERFORM fixture.expect_rejected(format('SELECT fixture.insert_vendor_message(%L)',c.dispatch),
  'authenticated host cannot forge dispatch service authority','vendor_boundary_unapproved_outreach_copy');
 PERFORM fixture.expect_rejected(format('SELECT fixture.insert_vendor_history(%L)',c.self_history),
  'authenticated host cannot use a self-update label as service authority','vendor_boundary_unresolved_history');
END;
$unauthenticated_markers$;
RESET ROLE;

SET LOCAL ROLE service_role;
DO $revision_retention_history$
DECLARE c fixture.vendor_operational_context; event jsonb; bad jsonb; redacted jsonb; receipt_id uuid; history_id uuid;
BEGIN
 SELECT * INTO STRICT c FROM fixture.vendor_operational_context;
 event:=jsonb_build_object('thread_id',c.thread_id,'direction','outbound','subject','Plan update superseded this outreach','body_text','Date changed',
  'headers_json',jsonb_build_object('system_event','plan_revision_superseded','revision_id',c.revision_id,'superseded_at','2026-11-10T12:00:00Z'));
 PERFORM fixture.insert_vendor_message(event);
 PERFORM fixture.assert_true((SELECT count(*)=1 FROM public.outreach_messages WHERE thread_id=c.thread_id AND headers_json->>'system_event'='plan_revision_superseded'),
  'same-plan revision inserts operational event without sending email');
 PERFORM fixture.expect_rejected(format('SELECT fixture.insert_vendor_message(%L)',jsonb_set(event,'{headers_json,revision_id}',to_jsonb(c.other_revision_id))),
  'revision event cannot reference another plan','vendor_boundary_invalid_revision_message');
 PERFORM fixture.expect_rejected(format('SELECT fixture.insert_vendor_message(%L)',event||'{"gmail_message_id":"pretend-send"}'),
  'revision marker cannot disguise a provider send','vendor_boundary_invalid_revision_message');
 SELECT id INTO STRICT receipt_id FROM public.outreach_messages WHERE thread_id=c.thread_id AND gmail_message_id='reply-1';
 UPDATE public.outreach_messages SET subject='[redacted by 3rdPlace data retention policy]',body_text='[redacted by 3rdPlace data retention policy]',
  body_html=NULL,transcript_text=NULL,headers_json='{}',provider_metadata_json='{}',attachments_json='[]' WHERE id=receipt_id;
 PERFORM fixture.assert_true((SELECT body_text='[redacted by 3rdPlace data retention policy]' FROM public.outreach_messages WHERE id=receipt_id),
  'trusted retention clears rich content while preserving receipt identity');
 PERFORM fixture.expect_rejected(format('UPDATE public.outreach_messages SET body_text=%L WHERE id=%L','Replacement content',receipt_id),
  'retention marker cannot authorize replacement prose','vendor_boundary_unapproved_outreach_copy');
 PERFORM fixture.insert_vendor_history(c.self_history);
 PERFORM fixture.insert_vendor_history(c.self_history||jsonb_build_object('old_value','Bay Area','new_value',NULL));
 PERFORM fixture.assert_true((SELECT count(*)=2 FROM public.discovery_change_log WHERE entity_id=c.vendor_id AND source='vendor_self_update'),
  'owned linked profile self-report preserves null transitions without inventing source provenance');
 bad:=c.self_history||jsonb_build_object('actor_id',c.other_host_id,'source_evidence',jsonb_build_object('route','/vendor/services',
  'vendor_profile_id',c.profile_id,'updated_by_user_id',c.other_host_id)::text);
 PERFORM fixture.expect_rejected(format('SELECT fixture.insert_vendor_history(%L)',bad),'self-report rejects profile/actor mismatch','vendor_boundary_unresolved_history');
 bad:=c.self_history||jsonb_build_object('source_evidence',jsonb_build_object('route','/vendor/services',
  'vendor_profile_id',gen_random_uuid(),'updated_by_user_id',c.host_id)::text);
 PERFORM fixture.expect_rejected(format('SELECT fixture.insert_vendor_history(%L)',bad),'self-report rejects unlinked profile','vendor_boundary_unresolved_history');
 PERFORM fixture.expect_rejected(format('SELECT fixture.insert_vendor_history(%L)',c.self_history||'{"field_name":"google_rating","new_value":5}'),
  'self-update label does not bless Google fields','vendor_boundary_unresolved_history');
 PERFORM fixture.insert_vendor_history(c.report_history);
 PERFORM fixture.assert_true((SELECT count(*)=1 FROM public.discovery_change_log WHERE entity_id=c.vendor_id AND source='organizer_report' AND NOT applied),
  'owned organizer report remains an unapplied report, not a confirmed fact');
 bad:=c.report_history||jsonb_build_object('source_evidence',jsonb_build_object('category','wrong_contact','details','Booking address bounced',
  'reporter_user_id',c.host_id,'plan_id',c.other_plan_id)::text);
 PERFORM fixture.expect_rejected(format('SELECT fixture.insert_vendor_history(%L)',bad),'organizer report rejects cross-owner plan','vendor_boundary_unresolved_history');
 PERFORM fixture.expect_rejected(format('SELECT fixture.insert_vendor_history(%L)',c.report_history||'{"applied":true,"confidence":1}'),
  'organizer report cannot manufacture confirmed provenance','vendor_boundary_unresolved_history');
 PERFORM fixture.insert_vendor_history(c.stripe_history);
 PERFORM fixture.assert_true((SELECT count(*)=1 FROM public.discovery_change_log WHERE entity_id=c.vendor_id AND source='stripe_account_event'),
  'typed Stripe status history remains operational');
 PERFORM fixture.expect_rejected(format('SELECT fixture.insert_vendor_history(%L)',c.stripe_history||'{"field_name":"name","new_value":"Google name"}'),
  'Stripe label cannot bless a vendor name','vendor_boundary_unresolved_history');
 PERFORM fixture.expect_rejected(format('SELECT fixture.insert_vendor_history(%L)',c.stripe_history||'{"source":"places_refresh"}'),
  'unrecognized history source fails closed','vendor_boundary_unresolved_history');
END;
$revision_retention_history$;
RESET ROLE;
-- Approved scope excludes vendor widening on these 12 existing attachments.
-- Six shared sites have only operational/current independent-catalog producers;
-- six are venue-only. Their venue checks remain active after dispatcher replacement.
DO $retained_scope$
DECLARE table_name text; venue_id uuid; envelope jsonb; safe jsonb; unsafe jsonb; vendor_only jsonb; row_id uuid; saved jsonb;
BEGIN
 venue_id:=(public.upsert_discovery_venue_identity('c2-retained-venue')->>'id')::uuid;
 PERFORM public.write_discovery_venue_independent_facts(venue_id,'{"name":"Independent retained hall"}',jsonb_build_object('name',fixture.evidence()));
 envelope:=jsonb_build_object('schema_version',1,'identity',jsonb_build_object('kind','venue','id',venue_id,'place_id','c2-retained-venue'),
  'values',jsonb_build_object('name','Independent retained hall'),'field_provenance',jsonb_build_object('name',fixture.evidence()));
 safe:=jsonb_build_object('target_type','discovery_venue','target_id',venue_id,'venue_data',envelope,'provider','Independent retained hall');
 unsafe:=jsonb_build_object('target_type','discovery_venue','target_id',venue_id,'provider','Unevidenced venue alias');
 vendor_only:=jsonb_build_object('target_type','discovery_vendor','target_id',gen_random_uuid(),'provider','Vendor semantics intentionally not added here');
 FOREACH table_name IN ARRAY ARRAY['agent_action_audit_log','event_templates','app_jobs','outreach_notifications','notifications','template_runs',
  'discovery_venue_events','supply_scout_venue_leads','plan_discovery_venue_candidates','venue_bookings','venue_opportunity_briefs','venue_opportunity_invites'] LOOP
  EXECUTE format('INSERT INTO public.%I(id,payload) VALUES(gen_random_uuid(),$1) RETURNING id,payload',table_name) INTO row_id,saved USING safe;
  PERFORM fixture.assert_true(saved=safe,table_name||' retained attachment accepts independently evidenced venue unchanged');
  PERFORM fixture.expect_rejected(format('INSERT INTO public.%I(id,payload) VALUES(gen_random_uuid(),%L::jsonb)',table_name,unsafe),
   table_name||' retained attachment still rejects unevidenced venue','venue_boundary_%');
  EXECUTE format('INSERT INTO public.%I(id,payload) VALUES(gen_random_uuid(),$1) RETURNING payload',table_name) INTO saved USING vendor_only;
  PERFORM fixture.assert_true(saved=vendor_only,table_name||' has no unapproved vendor widening');
 END LOOP;
 PERFORM fixture.assert_true(NOT EXISTS(SELECT FROM fixture.pre_activate_functions old JOIN pg_proc current ON current.oid=old.oid
  WHERE current.proname NOT IN ('fence_venue_durable_sink','stage_plan_quote_booking','apply_plan_revision_atomic',
   'complete_admin_task_execution','cancel_admin_task_execution') AND old.definition IS DISTINCT FROM pg_get_functiondef(current.oid)),
  'all preexisting routine definitions outside dispatcher and four producers remain unchanged');
END;
$retained_scope$;
-- Legacy manual identity and a real linked profile, seeded as database owner;
-- all tested acquisition/fact writes below run as service_role through RPCs.
CREATE TABLE fixture.vendor_contact_cases(profile_id uuid,manual_profile_id uuid,manual_vendor_id uuid);
DO $contact_seed$
DECLARE vendor_id uuid:=gen_random_uuid(); profile_id uuid:=gen_random_uuid(); manual_profile_id uuid:=gen_random_uuid();
BEGIN
 INSERT INTO public.discovery_vendors(id,source,source_external_id) VALUES(vendor_id,'manual_seed','c2-manual-contact');
 INSERT INTO public.vendor_profiles(id,discovery_vendor_id) VALUES(profile_id,NULL),(manual_profile_id,vendor_id);
 INSERT INTO fixture.vendor_contact_cases VALUES(profile_id,manual_profile_id,vendor_id);
END;
$contact_seed$;
GRANT SELECT ON fixture.vendor_contact_cases TO service_role;
SET LOCAL ROLE service_role;
DO $profile_and_contact_sources$
DECLARE c fixture.vendor_contact_cases; row_json jsonb; envelope jsonb; base_envelope jsonb; saved jsonb; payload jsonb;
 vendor_id uuid; host_evidence jsonb:=fixture.evidence(); site_evidence jsonb:=fixture.evidence('venue_site');
BEGIN
 SELECT * INTO STRICT c FROM fixture.vendor_contact_cases;
 row_json:=public.upsert_discovery_vendor_identity(NULL,c.manual_profile_id);
 PERFORM fixture.assert_true(row_json->>'id'=c.manual_vendor_id::text AND row_json->>'source'='manual_seed' AND row_json->>'google_place_id' IS NULL,
  'post-REVOKE linked manual profile retains canonical UUID with null Place ID');
 PERFORM public.write_discovery_vendor_independent_facts(c.manual_vendor_id,'{"name":"Manual independent supplier","service_type":"photography"}',
  jsonb_build_object('name',host_evidence,'service_type',host_evidence));
 base_envelope:=jsonb_build_object('schema_version',1,'identity',jsonb_build_object('kind','vendor','id',c.manual_vendor_id,'place_id',NULL),
  'values',jsonb_build_object('name','Manual independent supplier','service_type','photography'),
  'field_provenance',jsonb_build_object('name',host_evidence,'service_type',host_evidence));
 payload:=jsonb_build_object('discovery_vendor_id',c.manual_vendor_id,'vendor_data',base_envelope,'provider','Manual independent supplier');
 INSERT INTO public.plan_messages(metadata) VALUES(payload) RETURNING metadata INTO saved;
 PERFORM fixture.assert_true(saved=payload,'post161 manual null-Place-ID independent envelope passes actual sink unchanged');
 row_json:=public.upsert_discovery_vendor_identity(NULL,c.profile_id); vendor_id:=(row_json->>'id')::uuid;
 PERFORM fixture.assert_true(row_json->>'source'='vendor_self_service' AND row_json->>'google_place_id' IS NULL
  AND public.upsert_discovery_vendor_identity(NULL,c.profile_id)->>'id'=vendor_id::text,
  'post-REVOKE service-role profile identity RPC creates/reuses genuine self-service identity');
 PERFORM public.write_discovery_vendor_independent_facts(vendor_id,'{"name":"Profile independent supplier","service_type":"dj"}',
  jsonb_build_object('name',host_evidence,'service_type',host_evidence));
 PERFORM public.write_discovery_vendor_independent_facts(vendor_id,
  '{"organizer_provided_email":"host-rescue@example.com","extracted_emails":[{"email":"website-booking@example.com","confidence":0.9,"source_path":"/contact","extracted_at":"2026-11-10T00:00:00Z","is_likely_booking_contact":true,"source":"business_website","source_url":"https://business.example/contact"}]}',
  jsonb_build_object('organizer_provided_email',host_evidence,'extracted_emails',site_evidence));
 PERFORM fixture.assert_true((SELECT organizer_provided_email='host-rescue@example.com'
  AND extracted_emails->0->>'email'='website-booking@example.com' FROM public.discovery_vendors_safe WHERE id=vendor_id),
  'post161 fact RPC and safe view preserve independent rescue and website contact evidence');
 base_envelope:=jsonb_build_object('schema_version',1,'identity',jsonb_build_object('kind','vendor','id',vendor_id,'place_id',NULL),
  'values',jsonb_build_object('name','Profile independent supplier','service_type','dj'),
  'field_provenance',jsonb_build_object('name',host_evidence,'service_type',host_evidence));
 envelope:=base_envelope||jsonb_build_object('values',(base_envelope->'values')||jsonb_build_object('contact_email','host-rescue@example.com'),
  'field_provenance',(base_envelope->'field_provenance')||jsonb_build_object('contact_email',host_evidence));
 payload:=jsonb_build_object('discovery_vendor_id',vendor_id,'vendor_data',envelope,'target_email','host-rescue@example.com');
 INSERT INTO public.plan_messages(metadata) VALUES(payload) RETURNING metadata INTO saved;
 PERFORM fixture.assert_true(saved=payload,'host rescue maps contact_email alias to saved organizer_provided_email evidence');
 envelope:=base_envelope||jsonb_build_object('values',(base_envelope->'values')||jsonb_build_object('contact_email','website-booking@example.com'),
  'field_provenance',(base_envelope->'field_provenance')||jsonb_build_object('contact_email',site_evidence));
 payload:=jsonb_build_object('discovery_vendor_id',vendor_id,'vendor_data',envelope,'target_email','website-booking@example.com');
 INSERT INTO public.plan_messages(metadata) VALUES(payload) RETURNING metadata INTO saved;
 PERFORM fixture.assert_true(saved=payload,'website contact maps contact_email alias to saved extracted_emails evidence');
 PERFORM fixture.expect_rejected(format('INSERT INTO public.plan_messages(metadata) VALUES(%L::jsonb)',
  jsonb_set(payload,'{vendor_data,field_provenance,contact_email}',host_evidence)),
  'website contact cannot borrow unrelated host provenance','vendor_boundary_untrusted_envelope_fact');
 PERFORM fixture.expect_rejected(format('INSERT INTO public.plan_messages(metadata) VALUES(%L::jsonb)',
  jsonb_set(payload,'{vendor_data,values,contact_email}','"not-saved@example.com"')),
  'valid contact provenance cannot invent an unsaved recipient','vendor_boundary_untrusted_envelope_fact');
 PERFORM fixture.expect_rejected(format('INSERT INTO public.plans(metadata) VALUES(%L::jsonb)',
  jsonb_build_object('discovery_vendor_id',vendor_id,'vendor_data',base_envelope,'metadata',jsonb_build_object('candidate',
   jsonb_build_object('kind','venue','name','Unproven copied vendor','google_rating',5)))),
  'bare venue label cannot clear inherited vendor fact context','vendor_boundary_%');
 PERFORM fixture.expect_rejected(format('INSERT INTO public.plans(metadata) VALUES(%L::jsonb)',
  jsonb_build_object('discovery_vendor_id',vendor_id,'vendor_data',base_envelope,'metadata',jsonb_build_object('outcome_payload',
   jsonb_build_object('name','Unproven copied vendor','notes','Unproven vendor note')))),
  'outcome label inside discovery metadata cannot exempt vendor facts','vendor_boundary_%');
 PERFORM fixture.expect_rejected(format('INSERT INTO public.plans(metadata) VALUES(%L::jsonb)',
  jsonb_build_object('discovery_vendor_id',vendor_id,'vendor_data',base_envelope,'metadata',jsonb_build_object('admin_task_outcome',
   jsonb_build_object('name','Unproven copied vendor','notes','Unproven vendor note')))),
  'admin outcome label inside discovery metadata cannot exempt vendor facts','vendor_boundary_%');
 payload:=jsonb_build_object('partners',jsonb_build_array(base_envelope,
  jsonb_build_object('kind','venue','id',gen_random_uuid(),'name','Independent native catalog hall')));
 INSERT INTO public.plans(metadata) VALUES(payload) RETURNING metadata INTO saved;
 PERFORM fixture.assert_true(saved=payload,'native venue sibling remains separate from discovery vendor context');
END;
$profile_and_contact_sources$;
RESET ROLE;
COMMIT;
