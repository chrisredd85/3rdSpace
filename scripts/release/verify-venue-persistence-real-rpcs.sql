-- Extension of verify-venue-persistence-boundary.sql; disposable local PG only.
-- Loads the ACTUAL current production function definitions from explicit
-- repository migration files. The surrounding schema is representative, not a
-- replay of every application trigger, policy, provider, or payment workflow.
-- The local runner executes from the repository root with no network listener.
\set fixture_repo_root `pwd`
SELECT set_config('fixture.repo_root', :'fixture_repo_root', true);

CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
GRANT USAGE ON SCHEMA auth TO service_role,authenticated;

ALTER TABLE public.plans ADD user_id uuid, ADD title text, ADD plan_revision_count integer DEFAULT 0,
  ADD excluded_cuisines text[], ADD excluded_vendor_attributes jsonb, ADD preferred_vendor_attributes jsonb,
  ADD vendor_out_of_city_approved boolean, ADD vendor_approved_adjacent_cities text[],
  ADD date_window_start date, ADD date_window_end date, ADD guest_count integer, ADD budget_cap_cents integer,
  ADD neighborhood text, ADD event_city text, ADD updated_at timestamptz,
  ADD materialized_event_id uuid, ADD committed_venue_id uuid REFERENCES public.discovery_venues(id),
  ADD committed_venue_quoted_price_cents integer, ADD committed_venue_quoted_deal_model text,
  ADD committed_venue_quoted_terms jsonb, ADD committed_venue_at timestamptz, ADD committed_vendors jsonb;
ALTER TABLE public.plan_messages ADD plan_id uuid, ADD role text, ADD created_at timestamptz DEFAULT now();
ALTER TABLE public.plan_revisions ADD plan_id uuid, ADD triggered_by_user_id uuid, ADD trigger_type text,
  ADD trigger_payload jsonb, ADD source_message_id uuid, ADD impact_summary jsonb,
  ADD rediscovery_triggered_for text[], ADD audit_log_id uuid;
ALTER TABLE public.recommendations ADD plan_id uuid, ADD superseded_at timestamptz, ADD superseded_by_revision_id uuid;
ALTER TABLE public.approvals ADD plan_id uuid, ADD agent_action_id uuid, ADD action_label text, ADD event_date date,
  ADD price_cents integer, ADD fees_cents integer, ADD package_details text, ADD requested_amount_cents integer,
  ADD expires_at timestamptz, ADD snapshot_schema_version integer, ADD notes text,
  ADD superseded_at timestamptz, ADD superseded_by_revision_id uuid, ADD superseded_reason text;
ALTER TABLE public.approvals ADD refund_terms text, ADD cancellation_terms text, ADD delivery_email text,
  ADD payment_method_id text, ADD authorized_amount_cents integer, ADD authorized_by uuid, ADD authorized_at timestamptz,
  ADD approved_by uuid, ADD approved_at timestamptz, ADD approval_type text, ADD settlement_run_id uuid,
  ADD root_approval_id uuid, ADD version_number integer DEFAULT 1, ADD supersedes_approval_id uuid,
  ADD superseded_by_approval_id uuid, ADD version_created_by uuid, ADD version_reason text, ADD updated_at timestamptz;
ALTER TABLE public.agent_actions ADD plan_id uuid, ADD action_type text, ADD description text,
  ADD currency text, ADD result_metadata jsonb, ADD approval_id uuid, ADD created_at timestamptz DEFAULT now(),
  ADD last_retry_status text, ADD executed_at timestamptz, ADD updated_at timestamptz;
ALTER TABLE public.agent_action_audit_log ADD action_id uuid, ADD plan_id uuid, ADD from_status text,
  ADD to_status text, ADD actor_id uuid, ADD actor_role text, ADD reason text, ADD metadata jsonb;
ALTER TABLE public.outreach_threads ADD plan_id uuid, ADD user_id uuid, ADD needs_attention boolean, ADD last_event_at timestamptz;
ALTER TABLE public.outreach_messages ADD thread_id uuid, ADD direction text, ADD subject text, ADD body_text text, ADD headers_json jsonb;
ALTER TABLE public.outreach_threads ADD source_agent_action_id uuid;
ALTER TABLE public.outreach_messages ADD agent_action_id uuid, ADD approval_id uuid;
ALTER TABLE public.venue_bookings ADD agent_action_id uuid, ADD approval_id uuid;
ALTER TABLE public.admin_tasks ADD agent_action_id uuid, ADD approval_id uuid;
CREATE TABLE public.vendor_bookings(id uuid PRIMARY KEY, agent_action_id uuid, approval_id uuid);
CREATE TABLE public.payment_intents(id uuid PRIMARY KEY, approval_id uuid);
CREATE TABLE public.vendor_transactions(id uuid PRIMARY KEY, approval_id uuid);
CREATE TABLE public.venue_payment_transactions(id uuid PRIMARY KEY, approval_id uuid);
CREATE TABLE public.platform_fee_transactions(id uuid PRIMARY KEY, approval_id uuid);
CREATE TABLE public.settlement_charges(id uuid PRIMARY KEY, approval_id uuid);
GRANT SELECT ON public.vendor_bookings,public.payment_intents,public.vendor_transactions,
  public.venue_payment_transactions,public.platform_fee_transactions,public.settlement_charges TO service_role;
ALTER TABLE public.audit_logs ADD user_id uuid, ADD plan_id uuid, ADD action text, ADD entity_type text, ADD entity_id uuid;
ALTER TABLE public.venue_outreach_responses ADD plan_id uuid, ADD quoted_price_cents integer,
  ADD quoted_deal_model text, ADD classification text, ADD classification_confidence real,
  ADD availability_confirmed boolean, ADD capacity_confirmed integer, ADD conditions jsonb,
  ADD raw_response_excerpt text, ADD extracted_at timestamptz;
ALTER TABLE public.plan_discovery_venue_candidates ADD plan_id uuid;
ALTER TABLE public.discovery_change_log DROP payload, DROP status, DROP amount_cents, DROP discovery_venue_id,
  ADD entity_type text, ADD entity_id uuid, ADD source text, ADD field_name text, ADD old_value jsonb, ADD new_value jsonb,
  ADD confidence real, ADD source_evidence text, ADD applied boolean, ADD applied_at timestamptz,
  ADD created_at timestamptz DEFAULT now(), ADD actor_id uuid, ADD cascade_impact jsonb, ADD review_notes text, ADD reviewed_by uuid;
CREATE TABLE public.events(id uuid PRIMARY KEY, plan_id uuid, event_date date);
GRANT SELECT ON public.events TO service_role;
-- Remove the earlier query-only compatibility stub before loading the full RPC.
DROP FUNCTION public.stage_plan_quote_booking(uuid);

DO $load_production_functions$
DECLARE v_source text; v_definition text; v_start integer; v_end text; v_body text;
BEGIN
  v_source := pg_read_file(current_setting('fixture.repo_root') || '/supabase/migrations/20260709120000_lock_down_function_and_view_privileges.sql');
  v_start := strpos(v_source,'CREATE OR REPLACE FUNCTION public.apply_plan_revision_atomic(');
  v_end := '$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;';
  IF v_start=0 OR strpos(substr(v_source,v_start),v_end)=0 THEN RAISE EXCEPTION 'Actual revision source contract changed'; END IF;
  v_definition := split_part(substr(v_source,v_start),v_end,1) || v_end;
  EXECUTE v_definition;
  RAISE NOTICE 'Loaded actual production apply_plan_revision_atomic; source definition md5=%',md5(v_definition);
  v_source := pg_read_file(current_setting('fixture.repo_root') || '/supabase/migrations/20260709162000_add_canonical_quote_booking_execution.sql');
  v_start := strpos(v_source,'CREATE OR REPLACE FUNCTION public.stage_plan_quote_booking(');
  v_end := '$function$;';
  IF v_start=0 OR strpos(substr(v_source,v_start),v_end)=0 THEN RAISE EXCEPTION 'Actual canonical stage source contract changed'; END IF;
  v_definition := split_part(substr(v_source,v_start),v_end,1) || v_end;
  EXECUTE v_definition;
  RAISE NOTICE 'Loaded actual production stage_plan_quote_booking; source definition md5=%',md5(v_definition);
  v_source := pg_read_file(current_setting('fixture.repo_root') || '/supabase/migrations/20260709169000_allow_waiting_quote_reapproval.sql');
  v_start := strpos(v_source,'CREATE OR REPLACE FUNCTION public.supersede_approval_version(');
  IF v_start=0 OR strpos(substr(v_source,v_start),v_end)=0 THEN RAISE EXCEPTION 'Actual supersede source contract changed'; END IF;
  v_definition := split_part(substr(v_source,v_start),v_end,1) || v_end;
  EXECUTE v_definition;
  RAISE NOTICE 'Loaded actual production supersede_approval_version; source definition md5=%',md5(v_definition);
  v_source := pg_read_file(current_setting('fixture.repo_root') || '/supabase/migrations/20260709140000_add_approval_version_retry_contract.sql');
  v_start := strpos(v_source,'CREATE OR REPLACE FUNCTION public.enforce_approval_version_lineage(');
  IF v_start=0 OR strpos(substr(v_source,v_start),v_end)=0 THEN RAISE EXCEPTION 'Actual lineage source contract changed'; END IF;
  v_definition := split_part(substr(v_source,v_start),v_end,1) || v_end;
  EXECUTE v_definition;
  RAISE NOTICE 'Loaded actual production enforce_approval_version_lineage; source definition md5=%',md5(v_definition);
END;
$load_production_functions$;
CREATE TRIGGER enforce_approval_version_lineage_trigger BEFORE INSERT OR UPDATE ON public.approvals
  FOR EACH ROW EXECUTE FUNCTION public.enforce_approval_version_lineage();
REVOKE ALL ON FUNCTION public.supersede_approval_version(uuid,uuid,text,uuid,integer,date,text,timestamptz,jsonb,jsonb,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.supersede_approval_version(uuid,uuid,text,uuid,integer,date,text,timestamptz,jsonb,jsonb,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.apply_plan_revision_atomic(uuid,uuid,jsonb,uuid,jsonb,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.apply_plan_revision_atomic(uuid,uuid,jsonb,uuid,jsonb,jsonb,text) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.stage_plan_quote_booking(uuid,uuid,text,uuid,uuid,uuid,timestamptz,jsonb,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.stage_plan_quote_booking(uuid,uuid,text,uuid,uuid,uuid,timestamptz,jsonb,jsonb,text) TO service_role;
-- This time C1 patches the actual complete production stage function, not a stub.
\ir ../../supabase/migrations/20260922000003_activate_venue_discovery_boundary.sql
-- Recreated routines have no warmed owner plans. The first safe-view execution
-- must work as a restricted API role without private schema USAGE/raw SELECT.
SET LOCAL ROLE service_role;
DISCARD PLANS;
SELECT pg_temp.assert_true((SELECT name='Independent hall' FROM public.discovery_venues_safe
  WHERE id='00000000-0000-0000-0000-000000000001') AND NOT has_schema_privilege(current_user,'private','USAGE'),
  'cold service safe read without private schema privilege');
RESET ROLE;

INSERT INTO public.plans(id,user_id,title,status,amount_cents,budget_cap_cents,guest_count,neighborhood,date_window_start,date_window_end,metadata)
VALUES
  ('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000100','Independent revision','drafting',70000,100000,60,'Host requested Mission','2026-12-01','2026-12-01','{"host_intent":"Independent requirement"}'),
  ('00000000-0000-0000-0000-000000000102','00000000-0000-0000-0000-000000000100','Independent stage','ready',70000,100000,60,'Host requested Mission','2026-12-01','2026-12-01','{}'),
  ('00000000-0000-0000-0000-000000000103','00000000-0000-0000-0000-000000000100','Unsafe stage','ready',70000,100000,60,'Host requested Mission','2026-12-01','2026-12-01','{}');
INSERT INTO public.venue_outreach_responses(id,discovery_venue_id,plan_id,quoted_price_cents,quoted_deal_model,classification,
  classification_confidence,availability_confirmed,capacity_confirmed,conditions,raw_response_excerpt,extracted_at)
VALUES
  ('00000000-0000-0000-0000-000000000112','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000102',70000,'flat_fee','quote_received',1,true,60,'[]','[Venue reply] $700 includes setup.',now()),
  ('00000000-0000-0000-0000-000000000113','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000103',70000,'flat_fee','quote_received',1,true,60,'[]','[Venue reply] $700 includes setup.',now());
INSERT INTO public.outreach_threads(id,plan_id,user_id,discovery_venue_id,target_type,target_name,target_email,state)
VALUES('00000000-0000-0000-0000-000000000141','00000000-0000-0000-0000-000000000101',
  '00000000-0000-0000-0000-000000000100','00000000-0000-0000-0000-000000000001','venue',
  'Independent hall','booking@example.com','draft');
-- Seed a retained legacy plan as historical data, then restore the fence before
-- invoking the real revision command under its normal API role.
ALTER TABLE public.plans DISABLE TRIGGER fence_venue_durable_sink;
INSERT INTO public.plans(id,user_id,title,status,amount_cents,budget_cap_cents,plan_revision_count,metadata)
VALUES('00000000-0000-0000-0000-000000000104','00000000-0000-0000-0000-000000000100','Legacy copy guard','drafting',70000,100000,0,
  '{"ranked_venues":[{"venue_id":"00000000-0000-0000-0000-000000000001","venue_name":"GOOGLE_CANARY"}]}');
ALTER TABLE public.plans ENABLE TRIGGER fence_venue_durable_sink;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role','service_role',true);
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000100',true);

DO $actual_revision_rpc$
DECLARE v_result record; v_before_count bigint;
BEGIN
  SELECT * INTO STRICT v_result FROM public.apply_plan_revision_atomic(
    '00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000100',
    '{"type":"host_update","field":"guest_count","value":65}',NULL,'{"guest_count":65}',
    '{"superseded_outreach_thread_ids":["00000000-0000-0000-0000-000000000141"]}','Host revised attendance.');
  PERFORM pg_temp.assert_true(v_result.new_revision_count=1 AND EXISTS(SELECT 1 FROM public.plans
    WHERE id='00000000-0000-0000-0000-000000000101' AND guest_count=65 AND amount_cents=70000),'actual revision happy path');
  PERFORM pg_temp.assert_true(EXISTS(SELECT 1 FROM public.audit_logs
    WHERE entity_id=v_result.revision_id AND before_state->>'guest_count'='60'
      AND before_state->>'amount_cents'='70000' AND after_state#>>'{plan_updates,guest_count}'='65'),
    'actual revision audit preserves independent before/after facts');
  PERFORM pg_temp.assert_true(EXISTS(SELECT 1 FROM public.outreach_threads WHERE id='00000000-0000-0000-0000-000000000141'
    AND state='cancelled') AND EXISTS(SELECT 1 FROM public.outreach_messages WHERE thread_id='00000000-0000-0000-0000-000000000141'
      AND body_text='Host revised attendance.'),'actual revision cancels outreach and records independent system message');
  SELECT count(*) INTO v_before_count FROM public.plan_revisions;
  BEGIN
    PERFORM public.apply_plan_revision_atomic('00000000-0000-0000-0000-000000000104',
      '00000000-0000-0000-0000-000000000100','{"type":"host_update"}',NULL,'{"budget_cap_cents":110000}','{}','Budget updated.');
    RAISE EXCEPTION 'FAIL actual revision copied retained Google content into audit';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  PERFORM pg_temp.assert_true((SELECT count(*) FROM public.plan_revisions)=v_before_count AND EXISTS(SELECT 1 FROM public.plans
    WHERE id='00000000-0000-0000-0000-000000000104' AND budget_cap_cents=100000 AND plan_revision_count=0
      AND metadata#>>'{ranked_venues,0,venue_name}'='GOOGLE_CANARY'),
    'actual rejected revision rolls back business/revision rows and preserves original history');
  RAISE NOTICE 'PASS: actual production revision RPC happy path and blocked unsafe audit copy with rollback';
END;
$actual_revision_rpc$;

DO $actual_canonical_stage_rpc$
DECLARE v_result jsonb; v_retry jsonb; v_payload jsonb; v_snapshot jsonb; v_envelope jsonb; v_hash text := repeat('b',64);
BEGIN
  SELECT jsonb_build_object('schema_version',1,'identity',jsonb_build_object('kind','venue','id',id,'place_id','existing'),
    'values',jsonb_build_object('name',name),'field_provenance',jsonb_build_object('name',metadata#>'{field_provenance,name}'))
    INTO v_envelope FROM public.discovery_venues_safe WHERE id='00000000-0000-0000-0000-000000000001';
  v_payload := jsonb_build_object('kind','canonical_quote_booking','quote_kind','venue',
    'quote_response_id','00000000-0000-0000-0000-000000000112','target_type','discovery_venue',
    'target_id','00000000-0000-0000-0000-000000000001','target_name','Independent hall',
    'booking_slot','venue','event_date','2026-12-01','requested_amount_cents',70000,'venue_data',v_envelope);
  v_snapshot := jsonb_build_object('schema_version',2,'plan',jsonb_build_object('neighborhood','Host requested Mission','guest_count',60),
    'approval',jsonb_build_object('provider','Independent hall','requested_amount_cents',70000,'notes','[Venue reply] $700 includes setup.'),
    'counterparty',jsonb_build_object('target_type','discovery_venue','target_id','00000000-0000-0000-0000-000000000001','display_name','Independent hall'),
    'action',jsonb_build_object('action_type','concierge_queue','target_type','discovery_venue',
      'target_id','00000000-0000-0000-0000-000000000001','amount_cents',70000,'payload_json',v_payload));
  v_result := public.stage_plan_quote_booking('00000000-0000-0000-0000-000000000102',
    '00000000-0000-0000-0000-000000000100','venue','00000000-0000-0000-0000-000000000112',
    '00000000-0000-0000-0000-000000000122','00000000-0000-0000-0000-000000000132',now()+interval '1 day',v_payload,v_snapshot,v_hash);
  PERFORM pg_temp.assert_true(v_result->'existing'='false'::jsonb
    AND v_result#>'{approval,snapshot_json}'=v_snapshot AND v_result#>>'{approval,snapshot_hash}'=v_hash
    AND v_result#>>'{plan,committed_venue_quoted_price_cents}'='70000'
    AND v_result#>>'{approval_message,metadata,state}'='canonical_quote_booking_approval_requested',
    'actual full canonical stage preserves consent, quote cents and approval message');
  v_retry := public.stage_plan_quote_booking('00000000-0000-0000-0000-000000000102',
    '00000000-0000-0000-0000-000000000100','venue','00000000-0000-0000-0000-000000000112',
    '00000000-0000-0000-0000-000000000123','00000000-0000-0000-0000-000000000133',now()+interval '1 day',v_payload,v_snapshot,v_hash);
  PERFORM pg_temp.assert_true(v_retry->'existing'='true'::jsonb AND v_retry#>>'{approval,id}'=v_result#>>'{approval,id}'
    AND (SELECT count(*) FROM public.approvals WHERE plan_id='00000000-0000-0000-0000-000000000102')=1,
    'actual canonical exact retry is idempotent');
  v_payload := jsonb_set(jsonb_set(v_payload,'{quote_response_id}','"00000000-0000-0000-0000-000000000113"'),'{target_name}','"GOOGLE_CANARY"');
  BEGIN
    PERFORM public.stage_plan_quote_booking('00000000-0000-0000-0000-000000000103',
      '00000000-0000-0000-0000-000000000100','venue','00000000-0000-0000-0000-000000000113',
      '00000000-0000-0000-0000-000000000124','00000000-0000-0000-0000-000000000134',now()+interval '1 day',v_payload,v_snapshot,v_hash);
    RAISE EXCEPTION 'FAIL actual canonical stage accepted unproven target label';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  PERFORM pg_temp.assert_true(EXISTS(SELECT 1 FROM public.plans WHERE id='00000000-0000-0000-0000-000000000103'
    AND committed_venue_id IS NULL AND metadata='{}'::jsonb)
    AND NOT EXISTS(SELECT 1 FROM public.agent_actions WHERE plan_id='00000000-0000-0000-0000-000000000103'),
    'actual rejected canonical stage rolls back plan commitment and action writes');
  RAISE NOTICE 'PASS: actual production canonical stage happy path, exact retry and blocked unsafe action with rollback';
END;
$actual_canonical_stage_rpc$;

DO $actual_stripe_history_shape$
DECLARE v_id uuid; v_evidence text := '{"account_id":"acct_fixture1","event_id":"evt_fixture1","charges_enabled":true,"payouts_enabled":false,"capabilities":{"card_payments":"active"},"requirements":{"currently_due":["external_account"]}}';
BEGIN
  INSERT INTO public.discovery_change_log(entity_type,entity_id,source,field_name,old_value,new_value,confidence,source_evidence,applied,applied_at)
    VALUES('discovery_venue','00000000-0000-0000-0000-000000000001','stripe_account_event','stripe_connect_status',
      '"capabilities_pending"','"active"',1,v_evidence,true,now()) RETURNING id INTO v_id;
  PERFORM pg_temp.assert_true(EXISTS(SELECT 1 FROM public.discovery_change_log WHERE id=v_id
    AND old_value='"capabilities_pending"'::jsonb AND new_value='"active"'::jsonb AND source_evidence=v_evidence),
    'typed Stripe operational history unchanged');
  BEGIN
    INSERT INTO public.discovery_change_log(entity_type,entity_id,source,field_name,old_value,new_value,confidence,source_evidence,applied,applied_at)
      VALUES('discovery_venue','00000000-0000-0000-0000-000000000001','stripe_account_event','name',
        '"GOOGLE_OLD"','"GOOGLE_NEW"',1,v_evidence,true,now());
    RAISE EXCEPTION 'FAIL Stripe source label exempted venue-name history';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    INSERT INTO public.discovery_change_log(entity_type,entity_id,source,field_name,old_value,new_value,confidence,source_evidence,applied,applied_at)
      VALUES('discovery_venue','00000000-0000-0000-0000-000000000001','stripe_account_event','stripe_connect_status',
        '"pending"','"GOOGLE_NAME"',1,v_evidence,true,now());
    RAISE EXCEPTION 'FAIL Stripe status accepted a business fact';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    INSERT INTO public.discovery_change_log(entity_type,entity_id,source,field_name,old_value,new_value,confidence,source_evidence,applied,applied_at)
      VALUES('discovery_venue','00000000-0000-0000-0000-000000000001','stripe_account_event','stripe_connect_status',
        '"pending"','"active"',1,jsonb_set(v_evidence::jsonb,'{requirements,googleLive}','{"displayName":"GOOGLE_CANARY"}')::text,true,now());
    RAISE EXCEPTION 'FAIL Stripe evidence exempted nested provider overlay';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  RAISE NOTICE 'PASS: real Stripe operational history columns; enum/source/evidence boundaries reject business content';
END;
$actual_stripe_history_shape$;

DO $actual_gmail_contact_reapproval$
DECLARE
  v_venue uuid := '00000000-0000-0000-0000-000000000001';
  v_plan uuid := '00000000-0000-0000-0000-000000000201';
  v_action uuid := '00000000-0000-0000-0000-000000000202';
  v_approval uuid := '00000000-0000-0000-0000-000000000203';
  v_message uuid := '00000000-0000-0000-0000-000000000204';
  v_evidence jsonb; v_envelope jsonb; v_targets jsonb; v_payload jsonb; v_snapshot jsonb;
  v_old_snapshot jsonb; v_old_hash text := repeat('c',64); v_new_hash text := repeat('d',64);
  v_next public.approvals; v_failure text; v_before_count bigint;
BEGIN
  SELECT jsonb_build_object('schema_version',1,'identity',jsonb_build_object('kind','venue','id',id,'place_id','existing'),
    'values',jsonb_build_object('name',name,'contact_email',contact_email),
    'field_provenance',jsonb_build_object('name',metadata#>'{field_provenance,name}',
      'contact_email',metadata#>'{field_provenance,contact_email}')),
    metadata#>'{field_provenance,contact_email}' INTO v_envelope,v_evidence
    FROM public.discovery_venues_safe WHERE id=v_venue;
  v_targets := jsonb_build_array(jsonb_build_object('kind','venue','name','Independent hall','email','booking@example.com',
    'discoveryVenueId',v_venue,'venue_data',v_envelope));
  v_payload := jsonb_build_object('kind','gmail_approved_outreach','targets',v_targets,
    'subject','Availability request','body_text','Please send availability.');
  v_snapshot := jsonb_build_object('schema_version',2,'plan',jsonb_build_object('guest_count',60),
    'approval',jsonb_build_object('action_label','Send outreach to 1 venue','provider','Gmail',
      'delivery_email','booking@example.com','package_details','Availability request — booking@example.com',
      'requested_amount_cents',0,'price_cents',0,'event_date',NULL,'notes',NULL),
    'counterparty',jsonb_build_object('provider','Gmail','delivery_email','booking@example.com','target_type',NULL,'target_id',NULL),
    'action',jsonb_build_object('action_type','email','target_type',NULL,'target_id',NULL,'amount_cents',0,'payload_json',v_payload));
  v_old_snapshot := v_snapshot;
  INSERT INTO public.plans(id,user_id,status,amount_cents,title) VALUES(v_plan,'00000000-0000-0000-0000-000000000100','drafting',0,'Gmail replacement');
  INSERT INTO public.agent_actions(id,plan_id,action_type,payload_json,status,amount_cents,approval_id)
    VALUES(v_action,v_plan,'email',v_payload,'pending',0,v_approval);
  INSERT INTO public.approvals(id,plan_id,agent_action_id,action_label,provider,delivery_email,package_details,
    status,requested_amount_cents,price_cents,snapshot_json,snapshot_hash,snapshot_schema_version)
    VALUES(v_approval,v_plan,v_action,'Send outreach to 1 venue','Gmail','booking@example.com',
      'Availability request — booking@example.com','pending',0,0,v_snapshot,v_old_hash,2);
  INSERT INTO public.plan_messages(id,plan_id,role,message_type,content,metadata)
    VALUES(v_message,v_plan,'agent','approval_request','Review this outreach.',jsonb_build_object(
      'kind','gmail_approved_outreach','approval_id',v_approval,
      'approval',(SELECT to_jsonb(a) FROM public.approvals a WHERE id=v_approval),
      'partner_targets',jsonb_build_array(jsonb_build_object('kind','venue','name','Independent hall',
        'email','booking@example.com','discovery_venue_id',v_venue,'venue_data',v_envelope)),
      'invites',jsonb_build_array(jsonb_build_object('target_type','venue','venue_response_json',
        jsonb_build_object('target_type','venue','target_name','Independent hall','target_email','booking@example.com',
          'discovery_venue_id',v_venue,'venue_data',v_envelope)))));

  v_evidence := jsonb_set(v_evidence,'{evidence_reference}','"venue-site-contact-revised"');
  PERFORM public.write_discovery_venue_independent_facts(v_venue,'{"contact_email":"new-booking@example.com"}',
    jsonb_build_object('contact_email',v_evidence));
  -- Operational changes must not revalidate retained immutable snapshots against
  -- today's contact or mutate the signed consent/hash. The real lineage trigger
  -- is loaded above as well as the C1 sink trigger.
  UPDATE public.approvals SET status='superseded',superseded_at=now() WHERE id=v_approval;
  PERFORM pg_temp.assert_true(EXISTS(SELECT 1 FROM public.approvals WHERE id=v_approval AND status='superseded'
    AND snapshot_json=v_old_snapshot AND snapshot_hash=v_old_hash),'old approval operational update retains exact old consent after contact changes');
  UPDATE public.approvals SET status='pending',superseded_at=NULL WHERE id=v_approval;

  v_envelope := jsonb_set(jsonb_set(v_envelope,'{values,contact_email}','"new-booking@example.com"'),
    '{field_provenance,contact_email}',v_evidence);
  v_targets := jsonb_build_array(jsonb_build_object('kind','venue','name','Independent hall','email','new-booking@example.com',
    'discoveryVenueId',v_venue,'venue_data',v_envelope));
  v_payload := jsonb_set(v_payload,'{targets}',v_targets);
  v_snapshot := jsonb_set(jsonb_set(jsonb_set(jsonb_set(v_snapshot,'{action,payload_json}',v_payload),
    '{approval,delivery_email}','"new-booking@example.com"'),'{counterparty,delivery_email}','"new-booking@example.com"'),
    '{approval,package_details}','"Availability request — new-booking@example.com"');
  SELECT count(*) INTO v_before_count FROM public.approvals WHERE plan_id=v_plan;
  BEGIN
    PERFORM public.supersede_approval_version(v_plan,v_approval,v_old_hash,
      '00000000-0000-0000-0000-000000000100',0,NULL,NULL,now()+interval '1 day',v_payload,
      jsonb_set(v_snapshot,'{counterparty,delivery_email}','"unreviewed@example.com"'),v_new_hash,'gmail_approval_replaced');
    RAISE EXCEPTION 'FAIL Gmail successor accepted inconsistent reviewed recipient';
  EXCEPTION WHEN invalid_parameter_value THEN
    GET STACKED DIAGNOSTICS v_failure=MESSAGE_TEXT;
    PERFORM pg_temp.assert_true(v_failure='venue_boundary_gmail_reapproval_snapshot_mismatch','Gmail recipient mismatch rejected at explicit boundary');
  END;
  BEGIN
    PERFORM public.supersede_approval_version(v_plan,v_approval,v_old_hash,
      '00000000-0000-0000-0000-000000000100',0,NULL,NULL,now()+interval '1 day',
      v_old_snapshot#>'{action,payload_json}',v_old_snapshot,v_new_hash,'gmail_approval_replaced');
    RAISE EXCEPTION 'FAIL Gmail successor recopied obsolete independently sourced contact';
  EXCEPTION WHEN invalid_parameter_value THEN
    GET STACKED DIAGNOSTICS v_failure=MESSAGE_TEXT;
    PERFORM pg_temp.assert_true(v_failure='venue_boundary_untrusted_envelope_fact','obsolete recipient still rejected by trusted-fact binding');
  END;
  PERFORM pg_temp.assert_true((SELECT count(*) FROM public.approvals WHERE plan_id=v_plan)=v_before_count
    AND EXISTS(SELECT 1 FROM public.approvals WHERE id=v_approval AND status='pending' AND superseded_at IS NULL
      AND snapshot_json=v_old_snapshot AND snapshot_hash=v_old_hash)
    AND EXISTS(SELECT 1 FROM public.agent_actions WHERE id=v_action AND approval_id=v_approval
      AND payload_json=v_old_snapshot#>'{action,payload_json}'),
    'rejected Gmail replacement rolls back prior operational updates and preserves original consent/action');
  SELECT * INTO STRICT v_next FROM public.supersede_approval_version(v_plan,v_approval,v_old_hash,
    '00000000-0000-0000-0000-000000000100',0,NULL,NULL,now()+interval '1 day',v_payload,v_snapshot,v_new_hash,'gmail_approval_replaced');
  PERFORM pg_temp.assert_true(v_next.delivery_email='new-booking@example.com'
    AND v_next.package_details='Availability request — new-booking@example.com'
    AND v_next.snapshot_json=v_snapshot AND v_next.snapshot_hash=v_new_hash,
    'real Gmail successor recipient and copied display fields match new consent');
  PERFORM pg_temp.assert_true(EXISTS(SELECT 1 FROM public.approvals WHERE id=v_approval AND status='superseded'
    AND snapshot_json=v_old_snapshot AND snapshot_hash=v_old_hash AND delivery_email='booking@example.com'
    AND superseded_by_approval_id=v_next.id),'real Gmail supersede preserves original approval/hash/contact and lineage');
  PERFORM pg_temp.assert_true(EXISTS(SELECT 1 FROM public.agent_actions WHERE id=v_action
    AND approval_id=v_next.id AND payload_json=v_payload AND status='pending'),'real Gmail action now requires fresh approval');
  PERFORM pg_temp.assert_true(EXISTS(SELECT 1 FROM public.plan_messages WHERE id=v_message
    AND metadata->>'status'='superseded' AND metadata->>'approval_id'=v_approval::text
    AND metadata->>'superseded_by_approval_id'=v_next.id::text
    AND NOT metadata ? 'partner_targets' AND NOT metadata ? 'invites' AND NOT metadata ? 'approval'),
    'old Gmail message becomes an operational reference without recopying old facts');
  RAISE NOTICE 'PASS: actual Gmail supersede preserves historical consent and refreshes recipient after contact change';
END;
$actual_gmail_contact_reapproval$;
RESET ROLE;
