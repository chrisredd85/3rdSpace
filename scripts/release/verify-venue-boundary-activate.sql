\set ON_ERROR_STOP on
\set fixture_repo_root `pwd`
BEGIN;
SELECT set_config('fixture.repo_root', :'fixture_repo_root', true);
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
\ir verify-venue-boundary-pause-setup.sql
UPDATE public.release_runtime_controls SET state='paused' WHERE control_key='write_pause';
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
\ir ../../supabase/migrations/20260922000002_expand_venue_discovery_boundary.sql
CREATE TEMP TABLE original_validator_contract AS
SELECT oid,proargtypes,prorettype,prosecdef,proconfig,proacl FROM pg_proc
WHERE oid='private.assert_venue_durable_json(jsonb,boolean,text,integer,jsonb,text)'::regprocedure;
\ir ../../supabase/migrations/20260922000003_activate_venue_discovery_boundary.sql
\ir ../../supabase/migrations/20260922000002_expand_venue_discovery_boundary.sql
\ir ../../supabase/migrations/20260922000003_activate_venue_discovery_boundary.sql
CREATE FUNCTION pg_temp.assert_true(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF; RAISE NOTICE 'PASS: %',label; END $$;
SELECT pg_temp.assert_true((SELECT row(p.oid,p.proargtypes,p.prorettype,p.prosecdef,p.proconfig,p.proacl)
  IS NOT DISTINCT FROM row(o.oid,o.proargtypes,o.prorettype,o.prosecdef,o.proconfig,o.proacl)
  FROM pg_proc p CROSS JOIN original_validator_contract o
  WHERE p.oid='private.assert_venue_durable_json(jsonb,boolean,text,integer,jsonb,text)'::regprocedure),
  'operational amendment preserves validator OID, signature, security, search path and ACL');
SELECT pg_temp.assert_true((SELECT to_jsonb(v) FROM public.discovery_venues v WHERE id='00000000-0000-0000-0000-000000000001')=(SELECT value FROM original_rows WHERE value->>'id'='00000000-0000-0000-0000-000000000001'),'historical rows untouched');
SELECT pg_temp.assert_true((SELECT name IS NULL AND city IS NULL AND google_rating IS NULL FROM public.discovery_venues_safe WHERE id='00000000-0000-0000-0000-000000000001'),'legacy content masked');
SELECT pg_temp.assert_true(NOT has_table_privilege('service_role','public.discovery_venues','UPDATE'),'stale role cannot update');
SELECT pg_temp.assert_true(NOT has_column_privilege('service_role','public.discovery_venues','name','SELECT'),'raw label cannot be read');
SELECT pg_temp.assert_true(NOT has_function_privilege('authenticated','public.write_discovery_venue_independent_facts(uuid,jsonb,jsonb,jsonb)','EXECUTE'),'untrusted browser provenance rejected');
SET LOCAL ROLE service_role;
SELECT public.upsert_discovery_venue_identity('prefixed');
SELECT public.upsert_discovery_venue_identity('new-id');
SELECT public.upsert_discovery_venue_identity('new-id');
SELECT public.write_discovery_venue_independent_facts('00000000-0000-0000-0000-000000000001','{"name":"Independent hall","capacity_standing":100}',
'{"name":{"resolution":"resolved","source":"venue_site","evidence_reference":"https://example.com/events","collected_at":"2026-09-23T00:00:00Z","confidence":null,"confirmation_status":"site_published","lineage":[]},"capacity_standing":{"resolution":"resolved","source":"venue_site","evidence_reference":"https://example.com/events","collected_at":"2026-09-23T00:00:00Z","confidence":null,"confirmation_status":"site_published","lineage":[]}}');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.discovery_venues WHERE source_external_id IN ('prefixed','places/prefixed')),'legacy prefix does not create a second UUID');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.discovery_venues WHERE source_external_id='new-id'),'upsert idempotent');
SELECT pg_temp.assert_true((SELECT name IS NULL AND city IS NULL AND state IS NULL FROM public.discovery_venues WHERE source_external_id='new-id'),'identity insert has no default facts');
SELECT pg_temp.assert_true((SELECT name='Independent hall' AND capacity_standing=100 AND google_rating IS NULL FROM public.discovery_venues_safe WHERE id='00000000-0000-0000-0000-000000000001'),'independent equal-value gateway');
INSERT INTO public.venue_outreach_responses VALUES ('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001');
SET LOCAL ROLE service_role;
SELECT public.stage_plan_quote_booking('00000000-0000-0000-0000-000000000002');
RESET ROLE;
DO $checks$
DECLARE v_table text; v_failed boolean; v_evidence jsonb := '{"resolution":"resolved","source":"google_places","evidence_reference":"google","collected_at":"2026-09-23T00:00:00Z","confidence":null,"confirmation_status":"unconfirmed","lineage":[]}';
BEGIN
  BEGIN
    PERFORM public.write_discovery_venue_independent_facts('00000000-0000-0000-0000-000000000001','{"name":"GOOGLE_BAD"}',jsonb_build_object('name',v_evidence));
    RAISE EXCEPTION 'FAIL expected forbidden provenance';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  FOREACH v_table IN ARRAY ARRAY['plans','plan_messages','plan_versions','plan_revisions','recommendations','approvals','agent_actions','admin_tasks','audit_logs','admin_audit_log','agent_action_audit_log','templates','event_templates','agent_runs','app_jobs','outreach_threads','outreach_messages','outreach_notifications','discovery_venue_events','supply_scout_venue_leads','plan_discovery_venue_candidates','venue_bookings','discovery_change_log','venue_opportunity_briefs','venue_opportunity_invites','notifications'] LOOP
    v_failed:=false;
    BEGIN
      EXECUTE format('INSERT INTO public.%I(payload) VALUES ($1)',v_table) USING '{"discovery_venue_id":"00000000-0000-0000-0000-000000000001","googleLive":{"displayName":"GOOGLE_CANARY"}}'::jsonb;
    EXCEPTION WHEN invalid_parameter_value THEN v_failed:=true; END;
    IF NOT v_failed THEN RAISE EXCEPTION 'FAIL sink % accepted provider content',v_table; END IF;
    RAISE NOTICE 'PASS: required sink % rejects provider data',v_table;
    EXECUTE format('INSERT INTO public.%I(payload,amount_cents,status) VALUES ($1,70000,''approved'')',v_table) USING '{"discovery_venue_id":"00000000-0000-0000-0000-000000000001","consent":true,"quote_terms":{"name":"Independently received reply","price_cents":70000}}'::jsonb;
  END LOOP;
END;
$checks$;
-- A single forbidden field must fail without relying on a sibling name canary.
DO $provider_aliases$
DECLARE v_key text; v_nested boolean; v_payload jsonb;
BEGIN
  FOREACH v_key IN ARRAY ARRAY['displayName','formattedAddress','websiteUri','nationalPhoneNumber',
    'userRatingCount','primaryType','googleMapsUri','attributions','businessStatus','priceLevel','location'] LOOP
    FOREACH v_nested IN ARRAY ARRAY[false,true] LOOP
      v_payload := jsonb_build_object(v_key,'GOOGLE_ONE_FIELD_CANARY');
      IF v_nested THEN v_payload := jsonb_build_object('metadata',v_payload); END IF;
      v_payload := v_payload || jsonb_build_object('discovery_venue_id','00000000-0000-0000-0000-000000000001');
      BEGIN
        INSERT INTO public.plans(payload) VALUES(v_payload);
        RAISE EXCEPTION 'FAIL provider alias % nested=% accepted',v_key,v_nested;
      EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
    END LOOP;
  END LOOP;
END;
$provider_aliases$;
-- Exercise real JSON shapes, not just a provider-key canary.
DO $snapshot_contract$
DECLARE v_snapshot jsonb; v_envelope jsonb; v_provenance jsonb; v_derived jsonb; v_unchanged jsonb;
BEGIN
  SELECT jsonb_build_object('schema_version',1,'identity',jsonb_build_object('kind','venue','id',id,'place_id','existing'),
    'values',jsonb_build_object('name',name),
    'field_provenance',jsonb_build_object('name',metadata#>'{field_provenance,name}')) INTO v_envelope
    FROM public.discovery_venues_safe WHERE id='00000000-0000-0000-0000-000000000001';
  v_provenance := v_envelope#>'{field_provenance,name}';
  v_derived := jsonb_build_object('resolution','resolved','source','derived','evidence_reference','independent_projection',
    'collected_at','2026-09-23T00:00:00Z','confidence',null,'confirmation_status','unconfirmed',
    'lineage',jsonb_build_array(jsonb_build_object('field','name','provenance',v_provenance)));
  v_snapshot := jsonb_build_object('venue_id','00000000-0000-0000-0000-000000000001','venue_name','Independent hall','fit_score',81,
    'venue_data',v_envelope,'venue_derivation',v_derived);
  INSERT INTO public.plan_messages(payload) VALUES(jsonb_build_object('ranked_venues',jsonb_build_array(v_snapshot)));
  INSERT INTO public.approvals(payload) VALUES(jsonb_build_object('snapshot_hash','unchanged-signature','snapshot_json',v_snapshot)) RETURNING payload INTO v_unchanged;
  PERFORM pg_temp.assert_true(v_unchanged=jsonb_build_object('snapshot_hash','unchanged-signature','snapshot_json',v_snapshot),'signed snapshot unchanged');
  INSERT INTO public.recommendations(payload) VALUES(jsonb_build_object('type','venue','reference_id','00000000-0000-0000-0000-000000000001',
    'venue_data',v_envelope,'venue_derivation',v_derived,'metadata',jsonb_build_object('score',81,'reasoning',jsonb_build_array('Fits the host requirements'))));
  -- A native catalog recommendation has no discovery UUID and needs no invented discovery evidence.
  INSERT INTO public.plan_messages(payload) VALUES('{"ranked_venues":[{"venue_id":"00000000-0000-0000-0000-000000000099","venue_name":"Registered partner","fit_score":81}]}');
  BEGIN
    INSERT INTO public.plan_messages(payload) VALUES('{"ranked_venues":[{"venue_id":"00000000-0000-0000-0000-000000000001","venue_name":"GOOGLE_CANARY","fit_score":81}]}');
    RAISE EXCEPTION 'FAIL old recommendation without source marker accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM private.assert_venue_durable_json(jsonb_set(v_snapshot,'{venue_derivation,lineage,0,provenance,source}','"google_places"'));
    RAISE EXCEPTION 'FAIL Google-derived score accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END;
$snapshot_contract$;

-- The actual V2 approval shape from reapproval.ts, canonical staging's message
-- metadata, and Gmail's target/thread records must preserve their entire input.
DO $real_workflow_shapes$
DECLARE
  v_id uuid := '00000000-0000-0000-0000-000000000001'; v_row_id uuid;
  v_evidence jsonb; v_envelope jsonb; v_payload jsonb; v_snapshot jsonb; v_message jsonb;
  v_targets jsonb; v_saved jsonb; v_hash text := repeat('a',64);
BEGIN
  SELECT metadata#>'{field_provenance,name}' INTO v_evidence FROM public.discovery_venues_safe WHERE id=v_id;
  PERFORM public.write_discovery_venue_independent_facts(v_id,'{"contact_email":"booking@example.com"}',
    jsonb_build_object('contact_email',v_evidence));
  v_envelope := jsonb_build_object('schema_version',1,'identity',jsonb_build_object('kind','venue','id',v_id,'place_id','existing'),
    'values',jsonb_build_object('name','Independent hall','contact_email','booking@example.com'),
    'field_provenance',jsonb_build_object('name',v_evidence,'contact_email',v_evidence));
  v_payload := jsonb_build_object('kind','canonical_quote_booking','quote_kind','venue','target_type','discovery_venue',
    'target_id',v_id,'target_name','Independent hall','requested_amount_cents',70000,'price_cents',70000,
    'event_date','2026-12-01','quote_terms',jsonb_build_object('source','trusted_outreach_response','quoted_price_cents',70000,
      'conditions',jsonb_build_array('Keep the bar minimum'),'raw_response_excerpt','[Venue reply] $700 includes setup.'),
    'venue_data',v_envelope);
  v_snapshot := jsonb_build_object('schema_version',2,
    'plan',jsonb_build_object('event_type','mixer','guest_count',60,'budget_cap_cents',100000,'neighborhood','Host requested Mission',
      'date_window_start','2026-12-01','date_window_end','2026-12-01','ticketed',true,'profit_goal_cents',30000),
    'approval',jsonb_build_object('action_label','Approve booking request with Independent hall','provider','Independent hall',
      'price_cents',70000,'fees_cents',0,'requested_amount_cents',70000,'notes','[Venue reply] $700 includes setup.',
      'refund_terms','Refundable until Nov 1','package_details','Venue quote'),
    'counterparty',jsonb_build_object('provider','Independent hall','target_type','discovery_venue','target_id',v_id,
      'display_name','Independent hall','delivery_email',NULL,'venue_ids','[]'::jsonb,'vendor_ids','[]'::jsonb),
    'action',jsonb_build_object('action_type','concierge_queue','target_type','discovery_venue','target_id',v_id,
      'amount_cents',70000,'payload_json',v_payload));
  INSERT INTO public.agent_actions(target_type,target_id,payload_json,provider,amount_cents,status)
    VALUES('discovery_venue',v_id,v_payload,'Independent hall',70000,'pending');
  INSERT INTO public.approvals(snapshot_json,snapshot_hash,provider,amount_cents,status)
    VALUES(v_snapshot,v_hash,'Independent hall',70000,'pending') RETURNING snapshot_json INTO v_saved;
  PERFORM pg_temp.assert_true(v_saved=v_snapshot,'complete canonical V2 snapshot unchanged');
  PERFORM pg_temp.assert_true(EXISTS(SELECT 1 FROM public.approvals WHERE snapshot_json=v_snapshot AND snapshot_hash=v_hash),
    'canonical approval consent hash unchanged');
  v_message := jsonb_build_object('state','canonical_quote_booking_approval_requested','status','pending',
    'source','trusted_outreach_quote','quote_kind','venue','approval',jsonb_build_object('snapshot_json',v_snapshot,
      'snapshot_hash',v_hash,'provider','Independent hall','requested_amount_cents',70000));
  INSERT INTO public.plan_messages(metadata,content,message_type) VALUES(v_message,'The quote is frozen for review.','approval_request')
    RETURNING metadata INTO v_saved;
  PERFORM pg_temp.assert_true(v_saved=v_message,'canonical SQL approval message unchanged');

  v_targets := jsonb_build_array(jsonb_build_object('kind','venue','name','Independent hall','email','booking@example.com',
    'discoveryVenueId',v_id,'venue_data',v_envelope));
  INSERT INTO public.agent_actions(payload_json,provider,status) VALUES(jsonb_build_object('kind','gmail_approved_outreach',
    'targets',v_targets,'subject','Availability request','body_text','[Host introduction] Please send pricing.'),'Gmail','pending');
  v_message := jsonb_build_object('kind','gmail_approved_outreach',
    'partner_targets',jsonb_build_array(jsonb_build_object('kind','venue','name','Independent hall','email','booking@example.com',
      'discovery_venue_id',v_id,'venue_data',v_envelope)),
    'invites',jsonb_build_array(jsonb_build_object('target_type','venue','venue_response_json',jsonb_build_object(
      'target_type','venue','target_name','Independent hall','target_email','booking@example.com','discovery_venue_id',v_id,'venue_data',v_envelope))));
  INSERT INTO public.plan_messages(metadata,content,message_type) VALUES(v_message,'Review this outreach.','approval_request')
    RETURNING metadata INTO v_saved;
  PERFORM pg_temp.assert_true(v_saved=v_message,'Gmail approval target metadata unchanged');
  INSERT INTO public.outreach_threads(discovery_venue_id,target_name,target_type,target_email,state,channel_strategy)
    VALUES(v_id,'Independent hall','venue','booking@example.com','draft','{"approval_required":true}') RETURNING id INTO v_row_id;
  UPDATE public.outreach_threads SET state='awaiting_reply' WHERE id=v_row_id;
  PERFORM pg_temp.assert_true(EXISTS(SELECT 1 FROM public.outreach_threads WHERE id=v_row_id AND state='awaiting_reply'
    AND target_name='Independent hall' AND target_email='booking@example.com'),'Gmail operational state survives independent thread');

  -- An old binary can update a recommendation's metadata without resending its
  -- source IDs. The trigger must recover context from the unchanged row columns.
  INSERT INTO public.recommendations(type,reference_id,metadata) VALUES('venue',v_id,'{}') RETURNING id INTO v_row_id;
  BEGIN
    UPDATE public.recommendations SET metadata='{"name":"GOOGLE_CANARY"}' WHERE id=v_row_id;
    RAISE EXCEPTION 'FAIL stale metadata update escaped recommendation identity context';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    INSERT INTO public.outreach_threads(discovery_venue_id,target_name,target_type,target_email,state)
      VALUES(v_id,'GOOGLE_CANARY','venue','booking@example.com','draft');
    RAISE EXCEPTION 'FAIL stale outreach label copied';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    INSERT INTO public.approvals(snapshot_json,snapshot_hash) VALUES(jsonb_set(v_snapshot,'{counterparty,display_name}','"GOOGLE_CANARY"'),v_hash);
    RAISE EXCEPTION 'FAIL unsafe nested signed label copied';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    INSERT INTO public.approvals(snapshot_json,snapshot_hash) VALUES(jsonb_set(v_snapshot,'{approval,provider}','"GOOGLE_CANARY"'),v_hash);
    RAISE EXCEPTION 'FAIL unsafe signed provider alias copied';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    INSERT INTO public.approvals(snapshot_json,snapshot_hash) VALUES(jsonb_set(v_snapshot,'{counterparty,delivery_email}','"not-acquired@example.com"'),v_hash);
    RAISE EXCEPTION 'FAIL unsafe signed delivery address copied';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    INSERT INTO public.agent_actions(payload_json) VALUES(jsonb_set(v_payload,'{target_name}','"GOOGLE_CANARY"') || '{"service_type":"venue"}'::jsonb);
    RAISE EXCEPTION 'FAIL service_type hid explicit venue identity';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM private.assert_venue_durable_json(jsonb_build_object('discovery_venue_id',v_id,'name','Independent hall',
      'venue_data',jsonb_set(v_envelope,'{identity,id}','"00000000-0000-0000-0000-000000000099"')));
    RAISE EXCEPTION 'FAIL evidence for another venue accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  RAISE NOTICE 'PASS: actual canonical/Gmail shapes, operational state, host intent, signed identity and stale-update context';
END;
$real_workflow_shapes$;

DO $contact_projection$
DECLARE v_id uuid := '00000000-0000-0000-0000-000000000001'; v_site jsonb; v_host jsonb; v_envelope jsonb;
BEGIN
  SELECT metadata#>'{field_provenance,name}' INTO v_site FROM public.discovery_venues_safe WHERE id=v_id;
  v_host := v_site || '{"source":"host_input","evidence_reference":"host-input:fixture-contact","confirmation_status":"unconfirmed"}'::jsonb;
  PERFORM public.write_discovery_venue_independent_facts(v_id,
    '{"extracted_emails":[{"email":"events@example.com","source_path":"/events","extracted_at":"2026-09-23T00:00:00Z","confidence":0.8,"is_likely_booking_contact":false}],"organizer_provided_emails":[{"email":"host-contact@example.com","provided_by_user_id":"00000000-0000-0000-0000-000000000020","provided_at":"2026-09-23T00:00:00Z","source":"organizer_manual"}]}',
    jsonb_build_object('extracted_emails',v_site,'organizer_provided_emails',v_host));
  v_envelope := jsonb_build_object('schema_version',1,'identity',jsonb_build_object('kind','venue','id',v_id,'place_id','places/existing'),
    'values',jsonb_build_object('contact_email','events@example.com'),'field_provenance',jsonb_build_object('contact_email',v_site));
  INSERT INTO public.plan_messages(metadata) VALUES(jsonb_build_object('venue_data',v_envelope));
  v_envelope := jsonb_set(jsonb_set(v_envelope,'{values,contact_email}','"host-contact@example.com"'),'{field_provenance,contact_email}',v_host);
  INSERT INTO public.plan_messages(metadata) VALUES(jsonb_build_object('venue_data',v_envelope));
  BEGIN
    INSERT INTO public.plan_messages(metadata) VALUES(jsonb_build_object('venue_data',jsonb_set(v_envelope,'{values,contact_email}','"not-acquired@example.com"')));
    RAISE EXCEPTION 'FAIL arbitrary projected email accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    INSERT INTO public.plan_messages(metadata) VALUES(jsonb_build_object('venue_data',jsonb_set(v_envelope,'{field_provenance,contact_email}',v_site)));
    RAISE EXCEPTION 'FAIL projected contact with wrong array evidence accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  RAISE NOTICE 'PASS: exact extracted/manual contact projection, evidence binding, canonical Place ID prefix';
END;
$contact_projection$;

-- The real planner allows authenticated shared-table writes. Such a caller
-- cannot mint evidence by putting a plausible host_input label in an envelope.
SELECT set_config('fixture.authorized_envelope', (
  SELECT jsonb_build_object('schema_version',1,'identity',jsonb_build_object('kind','venue','id',id,'place_id','existing'),
    'values',jsonb_build_object('name',name),'field_provenance',jsonb_build_object('name',metadata#>'{field_provenance,name}'))::text
  FROM public.discovery_venues_safe WHERE id='00000000-0000-0000-0000-000000000001'), true);
GRANT INSERT ON public.plan_messages TO authenticated;
SET LOCAL ROLE authenticated;
DO $forged_envelope$
DECLARE v_envelope jsonb; v_evidence jsonb;
BEGIN
  v_envelope := current_setting('fixture.authorized_envelope')::jsonb;
  INSERT INTO public.plan_messages(metadata) VALUES(jsonb_build_object('venue_data',v_envelope));
  BEGIN
    INSERT INTO public.plan_messages(metadata) VALUES(jsonb_build_object('venue_data',jsonb_set(v_envelope,'{values,name}','"GOOGLE_CANARY"')));
    RAISE EXCEPTION 'FAIL browser forged a value under real evidence';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  v_evidence := v_envelope#>'{field_provenance,name}' || '{"source":"host_input","evidence_reference":"attacker-self-assertion"}'::jsonb;
  BEGIN
    INSERT INTO public.plan_messages(metadata) VALUES(jsonb_build_object('venue_data',jsonb_set(v_envelope,'{field_provenance,name}',v_evidence)));
    RAISE EXCEPTION 'FAIL browser forged evidence for an equal value';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END;
$forged_envelope$;
RESET ROLE;

-- Model the actual SECURITY DEFINER revision pattern: mutate a business field,
-- then write to_jsonb(old_plan) to audit. A rejected new copy rolls back that
-- command; a separate, unrelated update does not rewrite the historical blob.
CREATE FUNCTION public.fixture_copy_plan_to_audit(p_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_plan public.plans;
BEGIN
  SELECT * INTO STRICT v_plan FROM public.plans WHERE id=p_id;
  UPDATE public.plans SET status='updated' WHERE id=p_id;
  INSERT INTO public.audit_logs(before_state,after_state) VALUES(to_jsonb(v_plan),'{"amount_cents":70000,"consent":true}');
END;
$$;
ALTER TABLE public.plans DISABLE TRIGGER fence_venue_durable_sink;
INSERT INTO public.plans(id,status,amount_cents,metadata) VALUES('00000000-0000-0000-0000-000000000010','approved',70000,
  '{"ranked_venues":[{"venue_id":"00000000-0000-0000-0000-000000000001","venue_name":"GOOGLE_CANARY"}]}');
ALTER TABLE public.plans ENABLE TRIGGER fence_venue_durable_sink;
SET LOCAL ROLE service_role;
DO $stale_role$
BEGIN
  BEGIN UPDATE public.discovery_venues SET name='GOOGLE_CANARY'; RAISE EXCEPTION 'FAIL stale writer accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM name FROM public.discovery_venues; RAISE EXCEPTION 'FAIL legacy read accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.fixture_copy_plan_to_audit('00000000-0000-0000-0000-000000000010');
    RAISE EXCEPTION 'FAIL owner RPC copied unresolved legacy plan';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  PERFORM pg_temp.assert_true(EXISTS(SELECT 1 FROM public.plans WHERE id='00000000-0000-0000-0000-000000000010'
    AND status='approved' AND amount_cents=70000),'failed owner RPC rolled back before business commit');
  UPDATE public.plans SET amount_cents=71000 WHERE id='00000000-0000-0000-0000-000000000010';
  PERFORM pg_temp.assert_true(EXISTS(SELECT 1 FROM public.plans WHERE id='00000000-0000-0000-0000-000000000010'
    AND amount_cents=71000 AND metadata#>>'{ranked_venues,0,venue_name}'='GOOGLE_CANARY'),'unrelated money update preserves original historical blob');
END;
$stale_role$;
RESET ROLE;

DO $retention_contract$
DECLARE v_metadata jsonb; v_count bigint;
BEGIN
  SELECT metadata || '{"retained_legacy_data":{"name":"GOOGLE_OLD_HISTORY"}}'::jsonb INTO v_metadata
    FROM public.discovery_venues WHERE id='00000000-0000-0000-0000-000000000001';
  INSERT INTO public.discovery_venues(id,source_external_id,name,contact_email,contact_phone,extracted_emails,
    organizer_provided_emails,metadata,updated_at) VALUES('00000000-0000-0000-0000-000000000030','retention-fixture',
    'Independent hall','booking@example.com','555-0100','[]','[]',v_metadata,'2020-01-01T00:00:00Z');
  BEGIN
    PERFORM public.redact_expired_discovery_venue_contacts(clock_timestamp());
    RAISE EXCEPTION 'FAIL retention accepted a short interval';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  v_count := public.redact_expired_discovery_venue_contacts(clock_timestamp()-interval '1 year');
  PERFORM pg_temp.assert_true(v_count=1 AND EXISTS(SELECT 1 FROM public.discovery_venues
    WHERE id='00000000-0000-0000-0000-000000000030' AND contact_email IS NULL AND contact_phone IS NULL
      AND extracted_emails='[]'::jsonb AND organizer_provided_emails='[]'::jsonb
      AND NOT (metadata->'field_provenance') ?| ARRAY['contact_email','contact_phone','extracted_emails','organizer_provided_emails']
      AND metadata#>>'{retained_legacy_data,name}'='GOOGLE_OLD_HISTORY'
      AND metadata#>'{field_provenance,name}'=v_metadata#>'{field_provenance,name}'),
    'retention clears only expired contacts/evidence, retaining independent identity and original historical siblings');
END;
$retention_contract$;
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='private'::regnamespace AND prosrc ~* 'EXCEPTION[[:space:]]+WHEN'),'no recursive exception subtransactions');
\ir verify-venue-persistence-real-rpcs.sql
\ir verify-venue-operational-reasons.sql

-- Hundreds of nodes within the explicit depth bound exercise the real trigger.
-- Handler-free recursive bodies provide the structural proof of zero per-node
-- subtransactions; this is a bounded correctness check, not a concurrency benchmark.
DO $large_payload$
DECLARE v_payload jsonb; v_saved jsonb; v_id uuid; v_depth int;
BEGIN
  SELECT jsonb_build_object('items',jsonb_agg(jsonb_build_object('amount_cents',n,'consent',true)))
    INTO v_payload FROM generate_series(1,1000) n;
  FOR v_depth IN 1..32 LOOP v_payload:=jsonb_build_object('nested',v_payload); END LOOP;
  v_payload:=v_payload || '{"discovery_venue_id":"00000000-0000-0000-0000-000000000001"}'::jsonb;
  INSERT INTO public.plan_messages(payload) VALUES(v_payload) RETURNING id,payload INTO v_id,v_saved;
  PERFORM pg_temp.assert_true(v_saved=v_payload,'1000-item payload with 32 nested levels passes real guard unchanged');
  BEGIN
    UPDATE public.plan_messages SET payload=jsonb_set(v_payload,'{nested}',
      (v_payload->'nested') || '{"googleLive":{"photos":[{"name":"places/fake/photos/token"}]}}') WHERE id=v_id;
    RAISE EXCEPTION 'FAIL large payload accepted provider overlay';
  EXCEPTION WHEN invalid_parameter_value THEN
    RAISE NOTICE 'PASS: large payload still rejects provider content';
  END;
  PERFORM pg_temp.assert_true((SELECT payload=v_payload FROM public.plan_messages WHERE id=v_id),
    'large rejected update rolls back without changing financial content');
  PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='private'::regnamespace
    AND proname IN ('assert_venue_durable_json','fence_venue_durable_sink','venue_boundary_provenance_valid',
      'venue_boundary_fact_valid','venue_boundary_legacy_contacts','discovery_venue_safe_json','venue_boundary_stripe_history_valid')
    AND prosrc ~* 'EXCEPTION[[:space:]]+WHEN'),'all guard and validator bodies have zero exception boundaries');
END;
$large_payload$;
SELECT pg_temp.assert_true((SELECT count(*)=26 FROM pg_trigger WHERE tgname='fence_venue_durable_sink'),
  'ACTIVATE installs exactly 26 guards');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.template_runs'::regclass
  AND tgname='fence_venue_durable_sink'),'template_runs remains deferred after ACTIVATE');
-- Machine-readable contract from this realized local catalog, before rollback.
SELECT jsonb_build_object('contract','venue_boundary_catalog_v1','columns',(
  SELECT jsonb_agg(jsonb_build_object('name',column_name,'data_type',data_type,'udt_name',udt_name,
    'nullable',is_nullable='YES') ORDER BY ordinal_position)
  FROM information_schema.columns WHERE table_schema='public' AND table_name='discovery_venues_safe'),
  'functions',(SELECT jsonb_agg(jsonb_build_object('name',proname,'arguments',pg_get_function_arguments(oid),
    'result',pg_get_function_result(oid)) ORDER BY proname) FROM pg_proc
    WHERE pronamespace='public'::regnamespace AND proname IN ('upsert_discovery_venue_identity',
      'write_discovery_venue_independent_facts','redact_expired_discovery_venue_contacts','lock_discovery_venue_identity')));
SELECT 'PASS: C1 fixture role boundary, masking, immutable history, new facts, all shared sinks, idempotency, canonical lock query';
ROLLBACK;
