-- EXPAND-only compatibility fixture: original 23 checks plus corrected role denials.
\set ON_ERROR_STOP on
\set fixture_repo_root `pwd`
BEGIN;
SELECT set_config('fixture.repo_root', :'fixture_repo_root', true);
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
\ir verify-venue-boundary-pause-setup.sql
CREATE SCHEMA IF NOT EXISTS auth;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT current_setting('request.jwt.claim.role',true) $$;
CREATE TABLE public.discovery_venues (
  address text,
  alcohol_policy text,
  av_available boolean DEFAULT false,
  business_status text,
  capacity_cocktail integer,
  capacity_inference_admin_status varchar(20),
  capacity_inference_confidence real,
  capacity_inference_extracted_at timestamptz,
  capacity_inference_model varchar(64),
  capacity_inference_source_quote text,
  capacity_seated integer,
  capacity_standing integer,
  city text NOT NULL DEFAULT 'Legacy default',
  claimed_venue_id uuid,
  contact_email text,
  contact_phone text,
  created_at timestamptz,
  data_freshness_status text,
  extracted_contact_forms jsonb DEFAULT '{}'::jsonb,
  extracted_emails jsonb DEFAULT '{}'::jsonb,
  google_photo_names text[] DEFAULT '{}'::text[],
  google_rating numeric(2,1),
  google_user_ratings_total integer,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inferred_capacity_seated integer,
  inferred_capacity_standing integer,
  instagram_handle text,
  is_claimed boolean DEFAULT false,
  last_enriched_at timestamptz,
  last_meaningful_change_at timestamptz,
  last_places_refresh_at timestamptz,
  last_rescue_at timestamptz,
  last_verified_at timestamptz,
  lat double precision,
  lng double precision,
  metadata jsonb DEFAULT '{}'::jsonb,
  name text NOT NULL DEFAULT 'Legacy default',
  neighborhood text,
  opening_hours_json jsonb DEFAULT '{}'::jsonb,
  organizer_provided_emails jsonb DEFAULT '{}'::jsonb,
  organizer_rescue_count integer,
  parking_notes text,
  photos jsonb DEFAULT '{}'::jsonb,
  price_hint_cents_high integer,
  price_hint_cents_low integer,
  price_hint_note text,
  source text NOT NULL DEFAULT 'google_places',
  source_external_id text,
  state text NOT NULL DEFAULT 'Legacy default',
  updated_at timestamptz,
  vibe_tags text[] DEFAULT '{}'::text[],
  website text,
  website_extraction_attempted_at timestamptz,
  website_extraction_attempts integer,
  website_extraction_metadata jsonb DEFAULT '{}'::jsonb,
  website_extraction_status text, UNIQUE(source,source_external_id));
CREATE TABLE public.plans (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), payload jsonb, status text, amount_cents integer, discovery_venue_id uuid REFERENCES public.discovery_venues(id));
CREATE TABLE public.plan_messages (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), payload jsonb, status text, amount_cents integer, discovery_venue_id uuid REFERENCES public.discovery_venues(id));
CREATE TABLE public.plan_versions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), payload jsonb, status text, amount_cents integer, discovery_venue_id uuid REFERENCES public.discovery_venues(id));
CREATE TABLE public.plan_revisions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), payload jsonb, status text, amount_cents integer, discovery_venue_id uuid REFERENCES public.discovery_venues(id));
CREATE TABLE public.recommendations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), payload jsonb, status text, amount_cents integer, discovery_venue_id uuid REFERENCES public.discovery_venues(id));
CREATE TABLE public.approvals (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), payload jsonb, status text, amount_cents integer, discovery_venue_id uuid REFERENCES public.discovery_venues(id));
CREATE TABLE public.agent_actions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), payload jsonb, status text, amount_cents integer, discovery_venue_id uuid REFERENCES public.discovery_venues(id));
CREATE TABLE public.admin_tasks (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), payload jsonb, status text, amount_cents integer, discovery_venue_id uuid REFERENCES public.discovery_venues(id));
CREATE TABLE public.audit_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), payload jsonb, status text, amount_cents integer, discovery_venue_id uuid REFERENCES public.discovery_venues(id));
CREATE TABLE public.admin_audit_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), payload jsonb, status text, amount_cents integer, discovery_venue_id uuid REFERENCES public.discovery_venues(id));
CREATE TABLE public.agent_action_audit_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), payload jsonb, status text, amount_cents integer, discovery_venue_id uuid REFERENCES public.discovery_venues(id));
CREATE TABLE public.templates (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), payload jsonb, status text, amount_cents integer, discovery_venue_id uuid REFERENCES public.discovery_venues(id));
CREATE TABLE public.event_templates (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), payload jsonb, status text, amount_cents integer, discovery_venue_id uuid REFERENCES public.discovery_venues(id));
CREATE TABLE public.template_runs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), payload jsonb, status text, amount_cents integer, discovery_venue_id uuid REFERENCES public.discovery_venues(id));
CREATE TABLE public.agent_runs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), payload jsonb, status text, amount_cents integer, discovery_venue_id uuid REFERENCES public.discovery_venues(id));
CREATE TABLE public.app_jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), payload jsonb, status text, amount_cents integer, discovery_venue_id uuid REFERENCES public.discovery_venues(id));
CREATE TABLE public.outreach_threads (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), payload jsonb, status text, amount_cents integer, discovery_venue_id uuid REFERENCES public.discovery_venues(id));
CREATE TABLE public.outreach_messages (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), payload jsonb, status text, amount_cents integer, discovery_venue_id uuid REFERENCES public.discovery_venues(id));
CREATE TABLE public.outreach_notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), payload jsonb, status text, amount_cents integer, discovery_venue_id uuid REFERENCES public.discovery_venues(id));
CREATE TABLE public.discovery_venue_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), payload jsonb, status text, amount_cents integer, discovery_venue_id uuid REFERENCES public.discovery_venues(id));
CREATE TABLE public.supply_scout_venue_leads (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), payload jsonb, status text, amount_cents integer, discovery_venue_id uuid REFERENCES public.discovery_venues(id));
CREATE TABLE public.plan_discovery_venue_candidates (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), payload jsonb, status text, amount_cents integer, discovery_venue_id uuid REFERENCES public.discovery_venues(id));
CREATE TABLE public.venue_bookings (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), payload jsonb, status text, amount_cents integer, discovery_venue_id uuid REFERENCES public.discovery_venues(id));
CREATE TABLE public.discovery_change_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), payload jsonb, status text, amount_cents integer, discovery_venue_id uuid REFERENCES public.discovery_venues(id));
CREATE TABLE public.venue_opportunity_briefs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), payload jsonb, status text, amount_cents integer, discovery_venue_id uuid REFERENCES public.discovery_venues(id));
CREATE TABLE public.venue_opportunity_invites (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), payload jsonb, status text, amount_cents integer, discovery_venue_id uuid REFERENCES public.discovery_venues(id));
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), payload jsonb, status text, amount_cents integer, discovery_venue_id uuid REFERENCES public.discovery_venues(id));
-- Real receiving column names below supplement the reduced schema. This is not
-- a replay of the entire application schema or the complete booking workflow.
ALTER TABLE public.outreach_threads ADD state text, ADD target_name text, ADD target_type text,
  ADD target_email text, ADD channel_strategy jsonb;
ALTER TABLE public.recommendations ADD type text, ADD reference_id uuid, ADD metadata jsonb, ADD external_name text;
ALTER TABLE public.plans ADD metadata jsonb;
ALTER TABLE public.plan_messages ADD metadata jsonb, ADD content text, ADD message_type text;
ALTER TABLE public.agent_actions ADD target_type text, ADD target_id uuid, ADD payload_json jsonb, ADD provider text;
ALTER TABLE public.approvals ADD snapshot_json jsonb, ADD snapshot_hash text, ADD provider text;
ALTER TABLE public.audit_logs ADD before_state jsonb, ADD after_state jsonb;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
CREATE TABLE public.venue_outreach_responses (id uuid,discovery_venue_id uuid REFERENCES public.discovery_venues(id));
GRANT ALL ON public.venue_outreach_responses TO service_role;
-- C1 patches this exact deployed definition; relation details used at execution
-- are supplied later by the real-function extension, without a behavior stub.
DO $load_supersede_for_migration$
DECLARE v_source text; v_start integer; v_definition text;
BEGIN
  v_source := pg_read_file(current_setting('fixture.repo_root') || '/supabase/migrations/20260709169000_allow_waiting_quote_reapproval.sql');
  v_start := strpos(v_source,'CREATE OR REPLACE FUNCTION public.supersede_approval_version(');
  IF v_start=0 OR strpos(substr(v_source,v_start),'$function$;')=0 THEN RAISE EXCEPTION 'Actual supersede source contract changed'; END IF;
  v_definition := split_part(substr(v_source,v_start),'$function$;',1) || '$function$;';
  EXECUTE v_definition;
END;
$load_supersede_for_migration$;
-- Representative executable invoker query uses the exact current stage join/lock.
CREATE FUNCTION public.stage_plan_quote_booking(p_id uuid) RETURNS text LANGUAGE plpgsql SECURITY INVOKER AS $function$
DECLARE v_name text;
BEGIN
SELECT venue.name INTO v_name FROM public.venue_outreach_responses AS response
JOIN public.discovery_venues AS venue ON venue.id = response.discovery_venue_id
WHERE response.id=p_id
FOR KEY SHARE OF response, venue;
RETURN v_name;
END;
$function$;
INSERT INTO public.discovery_venues(id,name,city,state,source_external_id,google_rating,metadata)
VALUES ('00000000-0000-0000-0000-000000000001','GOOGLE_CANARY','San Francisco','CA','existing',4.8,'{"nested":{"google_name":"GOOGLE_CANARY"}}');
INSERT INTO public.discovery_venues(id,name,city,state,source_external_id) VALUES ('00000000-0000-0000-0000-000000000003','Old prefixed identity','City','CA','places/prefixed');
CREATE TEMP TABLE original_rows AS SELECT to_jsonb(v) AS value FROM public.discovery_venues v;

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

-- Reproduce repository defaults for the same creator role, postgres. These are
-- BASELINE SETUP, not part of the EXPAND projection.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon,authenticated,service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM PUBLIC,anon,authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC,anon,authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC,anon,authenticated;
CREATE FUNCTION pg_temp.assert_true(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF; RAISE NOTICE 'PASS: %',label; END $$;
ALTER TABLE public.plan_discovery_venue_candidates ADD fit_score numeric;
ALTER TABLE public.approvals ALTER COLUMN action_label SET NOT NULL;
CREATE TEMP TABLE old_function_definitions AS SELECT oid::regprocedure::text AS signature,pg_get_functiondef(oid) AS definition,proacl FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('stage_plan_quote_booking','supersede_approval_version','apply_plan_revision_atomic');
GRANT SELECT ON public.discovery_venues TO authenticated;
GRANT SELECT(name),UPDATE(city) ON public.discovery_venues TO service_role;
CREATE TEMP TABLE old_table_grants AS SELECT oid,relacl FROM pg_class WHERE oid='public.discovery_venues'::regclass;
CREATE TEMP TABLE old_column_grants AS SELECT attnum,attacl FROM pg_attribute WHERE attrelid='public.discovery_venues'::regclass;
CREATE TEMP TABLE old_trigger_definitions AS SELECT oid,pg_get_triggerdef(oid) AS definition FROM pg_trigger WHERE NOT tgisinternal;
INSERT INTO public.plans(id,user_id,title,status,amount_cents,budget_cap_cents,guest_count,neighborhood,date_window_start,date_window_end,metadata)
VALUES ('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000100','Old before','ready',70000,100000,60,'Host requested Mission','2026-12-01','2026-12-01','{}'),
('00000000-0000-0000-0000-000000000102','00000000-0000-0000-0000-000000000100','Old after','ready',70000,100000,60,'Host requested Mission','2026-12-01','2026-12-01','{}');
INSERT INTO public.venue_outreach_responses(id,discovery_venue_id,plan_id,quoted_price_cents,quoted_deal_model,classification,classification_confidence,availability_confirmed,capacity_confirmed,conditions,raw_response_excerpt,extracted_at)
VALUES ('00000000-0000-0000-0000-000000000111','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000101',70000,'flat_fee','quote_received',1,true,60,'[]','Independent reply $700',now()),
('00000000-0000-0000-0000-000000000112','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000102',70000,'flat_fee','quote_received',1,true,60,'[]','Independent reply $700',now());
CREATE FUNCTION pg_temp.old_stage(p_plan uuid,p_response uuid,p_action uuid,p_approval uuid) RETURNS void LANGUAGE plpgsql AS $smoke$
DECLARE v_payload jsonb; v_snapshot jsonb; v_result jsonb;
BEGIN
v_payload:=jsonb_build_object('kind','canonical_quote_booking','quote_kind','venue','quote_response_id',p_response,'target_type','discovery_venue','target_id','00000000-0000-0000-0000-000000000001','target_name','GOOGLE_CANARY','booking_slot','venue','event_date','2026-12-01','requested_amount_cents',70000);
v_snapshot:=jsonb_build_object('schema_version',2,'plan',jsonb_build_object('neighborhood','Host requested Mission','guest_count',60),'approval',jsonb_build_object('provider','GOOGLE_CANARY','requested_amount_cents',70000,'notes','Independent reply $700'),'counterparty',jsonb_build_object('target_type','discovery_venue','target_id','00000000-0000-0000-0000-000000000001','display_name','GOOGLE_CANARY'),'action',jsonb_build_object('action_type','concierge_queue','target_type','discovery_venue','target_id','00000000-0000-0000-0000-000000000001','amount_cents',70000,'payload_json',v_payload));
v_result:=public.stage_plan_quote_booking(p_plan,'00000000-0000-0000-0000-000000000100','venue',p_response,p_action,p_approval,now()+interval '1 day',v_payload,v_snapshot,repeat('b',64));
PERFORM pg_temp.assert_true(v_result#>>'{approval,action_label}'='Approve booking request with GOOGLE_CANARY','old full canonical RPC retains label behavior');
PERFORM pg_temp.assert_true(v_result#>'{approval,snapshot_json}'=v_snapshot AND v_result#>>'{approval,snapshot_hash}'=repeat('b',64),'old canonical snapshot and consent hash unchanged');
END;
$smoke$;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role','service_role',true);
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000100',true);
INSERT INTO public.plan_discovery_venue_candidates(discovery_venue_id,fit_score,status) VALUES ('00000000-0000-0000-0000-000000000001',65,'candidate');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.plan_discovery_venue_candidates),'old candidate write works before EXPAND');
SELECT pg_temp.old_stage('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000111','00000000-0000-0000-0000-000000000121','00000000-0000-0000-0000-000000000131');
RESET ROLE;
\ir ../../supabase/migrations/20260922000002_expand_venue_discovery_boundary.sql
\ir ../../supabase/migrations/20260922000002_expand_venue_discovery_boundary.sql

SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM old_function_definitions b JOIN pg_proc p ON p.oid=to_regprocedure(b.signature) WHERE b.definition IS DISTINCT FROM pg_get_functiondef(p.oid) OR b.proacl IS DISTINCT FROM p.proacl),'existing booking/revision/approval definitions and ACLs byte-identical');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM old_table_grants b JOIN pg_class c ON b.oid=c.oid WHERE b.relacl IS DISTINCT FROM c.relacl),'existing discovery table grants unchanged');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM old_column_grants b JOIN pg_attribute a ON b.attnum=a.attnum WHERE a.attrelid='public.discovery_venues'::regclass AND b.attacl IS DISTINCT FROM a.attacl),'existing discovery column grants unchanged');
SELECT pg_temp.assert_true((SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal)=(SELECT count(*) FROM old_trigger_definitions) AND NOT EXISTS(SELECT 1 FROM old_trigger_definitions b JOIN pg_trigger t ON t.oid=b.oid WHERE pg_get_triggerdef(t.oid) IS DISTINCT FROM b.definition),'no active triggers added or changed');
SELECT pg_temp.assert_true((SELECT count(*)=3 FROM pg_attribute WHERE attrelid='public.discovery_venues'::regclass AND attname IN ('name','city','state') AND NOT attnotnull AND NOT atthasdef),'nullable identity columns have no defaults');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM original_rows b JOIN public.discovery_venues v ON v.id::text=b.value->>'id' WHERE b.value IS DISTINCT FROM to_jsonb(v)),'retained discovery rows unchanged');
SET LOCAL ROLE service_role;
DISCARD PLANS;
SELECT pg_temp.assert_true((SELECT name='GOOGLE_CANARY' FROM public.discovery_venues WHERE source_external_id='existing'),'old direct SELECT works after EXPAND twice');
INSERT INTO public.discovery_venues(name,city,state,source_external_id) VALUES ('Old direct venue','City','CA','old-direct') ON CONFLICT(source,source_external_id) DO UPDATE SET name=excluded.name;
UPDATE public.discovery_venues SET name='Old direct updated' WHERE source_external_id='old-direct';
SELECT pg_temp.assert_true((SELECT name='Old direct updated' FROM public.discovery_venues WHERE source_external_id='old-direct'),'old direct INSERT/upsert/UPDATE works after EXPAND');
INSERT INTO public.plan_discovery_venue_candidates(discovery_venue_id,fit_score,status) VALUES ('00000000-0000-0000-0000-000000000001',65,'candidate');
SELECT pg_temp.assert_true((SELECT count(*)=2 FROM public.plan_discovery_venue_candidates),'old candidate write works after EXPAND');
INSERT INTO public.discovery_change_log(entity_type,entity_id,source,field_name,old_value,new_value,confidence,source_evidence,applied) VALUES ('discovery_venue','00000000-0000-0000-0000-000000000001','places_refresh','name','"old"','"new"',1,'fixture',false);
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.discovery_change_log),'old history write works after EXPAND');
SELECT pg_temp.old_stage('00000000-0000-0000-0000-000000000102','00000000-0000-0000-0000-000000000112','00000000-0000-0000-0000-000000000122','00000000-0000-0000-0000-000000000132');
SELECT pg_temp.assert_true((SELECT name IS NULL AND google_rating IS NULL FROM public.discovery_venues_safe WHERE source_external_id='existing'),'new safe view masks old Google content');
SELECT pg_temp.assert_true(public.upsert_discovery_venue_identity('new-expand')->>'source_external_id'='new-expand','new identity RPC works');
SELECT pg_temp.assert_true(public.upsert_discovery_venue_identity('new-expand')->>'source_external_id'='new-expand','new identity RPC retry works');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.discovery_venues WHERE source_external_id='new-expand'),'identity retry does not duplicate rows');
SELECT pg_temp.assert_true((SELECT name IS NULL AND city IS NULL AND state IS NULL FROM public.discovery_venues WHERE source_external_id='new-expand'),'new identity has no fabricated facts');
SELECT public.write_discovery_venue_independent_facts('00000000-0000-0000-0000-000000000003','{"name":"Independent fixture"}','{"name":{"resolution":"resolved","source":"host_input","evidence_reference":"host fixture","collected_at":"2026-09-23T00:00:00Z","confirmation_status":"unconfirmed","lineage":[]}}');
SELECT pg_temp.assert_true((SELECT name='Independent fixture' FROM public.discovery_venues_safe WHERE id='00000000-0000-0000-0000-000000000003'),'new facts RPC and safe read work');
DO $reject$
BEGIN
BEGIN
PERFORM public.write_discovery_venue_independent_facts('00000000-0000-0000-0000-000000000003','{"name":"Google"}','{"name":{"resolution":"resolved","source":"google_places","evidence_reference":"google fixture","collected_at":"2026-09-23T00:00:00Z","confirmation_status":"unconfirmed","lineage":[]}}');
RAISE EXCEPTION 'FAIL Google fact should reject';
EXCEPTION WHEN invalid_parameter_value THEN RAISE NOTICE 'PASS: provenance RPC rejects Google-derived fact'; END;
END;
$reject$;
RESET ROLE;
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='private'::regnamespace AND proname LIKE 'venue_boundary%' AND prosrc ~* 'exception[[:space:]]+when'),'recursive validators contain no exception handlers');

SELECT pg_temp.assert_true(NOT has_function_privilege('anon','public.upsert_discovery_venue_identity(text)','EXECUTE') AND NOT has_function_privilege('authenticated','public.write_discovery_venue_independent_facts(uuid,jsonb,jsonb,jsonb)','EXECUTE'),'new privileged RPC execution denied to API roles');
SELECT pg_temp.assert_true(NOT has_table_privilege('anon','public.discovery_venues_safe','SELECT') AND NOT has_table_privilege('authenticated','public.discovery_venues_safe','SELECT'),'safe view SELECT denied to API roles per approved policy');
SET LOCAL ROLE authenticated;
DO $role_denial$
DECLARE v_message text;
BEGIN
 BEGIN
  PERFORM name FROM public.discovery_venues_safe WHERE id='00000000-0000-0000-0000-000000000003';
  RAISE EXCEPTION 'FAIL expected authenticated reader denial';
 EXCEPTION WHEN insufficient_privilege THEN
  GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
  RAISE NOTICE 'PASS: authenticated safe view denied as required (42501): %',v_message;
 END;
END;
$role_denial$;
SELECT pg_temp.assert_true((SELECT name='GOOGLE_CANARY' FROM public.discovery_venues WHERE source_external_id='existing'),'old authenticated raw read remains intact after EXPAND');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_true((SELECT name='Independent fixture' FROM public.discovery_venues_safe WHERE id='00000000-0000-0000-0000-000000000003'),'service-role safe view reads the same evidenced row successfully');
RESET ROLE;

DO $rpc_acl$
DECLARE v_role text; v_rpc text;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    EXECUTE format('SET LOCAL ROLE %I',v_role);
    BEGIN
      PERFORM name FROM public.discovery_venues_safe;
      RAISE EXCEPTION 'FAIL safe view exposed to %',v_role;
    EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS: % safe view denied',v_role; END;
    FOREACH v_rpc IN ARRAY ARRAY[
      $call$SELECT public.upsert_discovery_venue_identity('forbidden')$call$,
      $call$SELECT public.write_discovery_venue_independent_facts('00000000-0000-0000-0000-000000000003','{}','{}')$call$,
      $call$SELECT public.lock_discovery_venue_identity('00000000-0000-0000-0000-000000000003')$call$,
      $call$SELECT public.redact_expired_discovery_venue_contacts(now()-interval '1 year')$call$
    ] LOOP
      BEGIN
        EXECUTE v_rpc;
        RAISE EXCEPTION 'FAIL privileged RPC exposed to %',v_role;
      EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS: % write RPC denied',v_role; END;
    END LOOP;
    RESET ROLE;
  END LOOP;
  PERFORM pg_temp.assert_true(NOT EXISTS(
    SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
    WHERE p.oid IN ('public.upsert_discovery_venue_identity(text)'::regprocedure,
      'public.write_discovery_venue_independent_facts(uuid,jsonb,jsonb,jsonb)'::regprocedure,
      'public.lock_discovery_venue_identity(uuid)'::regprocedure,
      'public.redact_expired_discovery_venue_contacts(timestamptz)'::regprocedure)
      AND a.grantee=0 AND a.privilege_type='EXECUTE'),'PUBLIC has no write RPC EXECUTE');
  PERFORM pg_temp.assert_true(NOT EXISTS(
    SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a
    WHERE c.oid='public.discovery_venues_safe'::regclass AND a.grantee=0 AND a.privilege_type='SELECT'),
    'PUBLIC has no safe view SELECT');
END;
$rpc_acl$;
ROLLBACK;
