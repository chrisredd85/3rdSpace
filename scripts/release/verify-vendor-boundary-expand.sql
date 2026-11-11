-- Local representative schema after the existing C1 realized-function fixture.
-- Never run against hosted. The Python runner creates an isolated socket-only PG.
CREATE SCHEMA fixture;
CREATE TABLE fixture.baseline_functions AS SELECT oid,pg_get_functiondef(oid) definition,proacl
  FROM pg_proc WHERE pronamespace IN ('public'::regnamespace,'private'::regnamespace) AND prokind='f';
CREATE TABLE fixture.baseline_acl AS SELECT oid,relacl FROM pg_class WHERE relnamespace='public'::regnamespace;
CREATE TABLE fixture.baseline_triggers AS SELECT oid,pg_get_triggerdef(oid) definition FROM pg_trigger WHERE NOT tgisinternal;

-- Read the actual vendor source schema, without its unrelated outreach migration.
DO $load_vendor_schema$
DECLARE src text; definition text;
BEGIN
  src := pg_read_file(current_setting('fixture.repo_root') || '/supabase/migrations/20260624011000_add_vendor_discovery_response_commitments.sql');
  definition := split_part(substr(src,strpos(src,'CREATE TABLE IF NOT EXISTS public.discovery_vendors (')),E'\n);',1)||E'\n);';
  EXECUTE definition;
  definition := split_part(substr(src,strpos(src,'CREATE TABLE IF NOT EXISTS public.vendor_outreach_responses (')),E'\n);',1)||E'\n);';
  EXECUTE definition;
END;
$load_vendor_schema$;
ALTER TABLE public.discovery_vendors ADD extracted_contact_forms jsonb DEFAULT '[]',
  ADD last_places_refresh_at timestamptz,ADD last_meaningful_change_at timestamptz,
  ADD data_freshness_status varchar(32) NOT NULL DEFAULT 'fresh';
ALTER TABLE public.discovery_vendors DROP CONSTRAINT discovery_vendors_source_check;
ALTER TABLE public.discovery_vendors ADD CONSTRAINT discovery_vendors_source_check CHECK
  (source IN ('google_places','manual_seed','creator_referral','scrape','vendor_self_service'));
CREATE TABLE public.vendor_profiles(id uuid PRIMARY KEY,discovery_vendor_id uuid REFERENCES public.discovery_vendors(id)
  DEFERRABLE INITIALLY DEFERRED);
CREATE TABLE public.plan_discovery_vendor_candidates(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),plan_id uuid,
  discovery_vendor_id uuid,status text,service_type text);
GRANT ALL ON public.discovery_vendors,public.vendor_profiles,public.vendor_outreach_responses,
  public.plan_discovery_vendor_candidates TO service_role;
GRANT SELECT ON public.discovery_vendors TO authenticated;
CREATE TABLE fixture.vendor_before_acl AS SELECT relacl FROM pg_class WHERE oid='public.discovery_vendors'::regclass;
CREATE TABLE fixture.stage_inputs(case_id integer PRIMARY KEY,plan_id uuid,response_id uuid,action_id uuid,
  approval_id uuid,payload jsonb,snapshot jsonb);
GRANT USAGE ON SCHEMA fixture TO service_role;
GRANT SELECT ON fixture.stage_inputs TO service_role;
CREATE FUNCTION fixture.evidence(p_source text DEFAULT 'host_input') RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('resolution','resolved','source',p_source,'evidence_reference','fixture:independent-owner',
    'collected_at','2026-11-10T00:00:00Z','confidence',1,'confirmation_status','venue_confirmed','lineage','[]'::jsonb)
$$;
CREATE FUNCTION fixture.assert_true(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF; RAISE NOTICE 'PASS: %',label; END;
$$;
CREATE FUNCTION fixture.setup_case(p_case integer,p_vendor uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE p uuid:=gen_random_uuid(); r uuid:=gen_random_uuid(); v jsonb; e jsonb; a jsonb; s jsonb;
BEGIN
  SELECT to_jsonb(row) INTO STRICT v FROM public.discovery_vendors_safe row WHERE id=p_vendor;
  e:=jsonb_build_object('schema_version',1,'identity',jsonb_build_object('kind','vendor','id',p_vendor,
    'place_id',v->>'google_place_id'),'values',jsonb_build_object('name',v->'name','service_type',v->'service_type'),
    'field_provenance',jsonb_build_object('name',v#>'{field_provenance,name}','service_type',v#>'{field_provenance,service_type}'));
  a:=jsonb_build_object('kind','canonical_quote_booking','quote_kind','vendor','quote_response_id',r,
    'target_type','discovery_vendor','target_id',p_vendor,'target_name',v->>'name','service_type',v->>'service_type',
    'booking_slot','vendor:'||(v->>'service_type'),'event_date','2026-12-01','requested_amount_cents',70000,'vendor_data',e);
  s:=jsonb_build_object('schema_version',2,'approval',jsonb_build_object('provider',v->>'name','package_details',v->>'service_type'),
    'counterparty',jsonb_build_object('provider',v->>'name','display_name',v->>'name','target_type','discovery_vendor','target_id',p_vendor),
    'action',jsonb_build_object('action_type','concierge_queue','target_type','discovery_vendor','target_id',p_vendor,
      'amount_cents',70000,'payload_json',a));
  INSERT INTO public.plans(id,user_id,status,date_window_start,date_window_end,metadata) VALUES
    (p,'c2000000-0000-4000-8000-000000000001','ready','2026-12-01','2026-12-01','{}');
  INSERT INTO public.vendor_outreach_responses(id,plan_id,discovery_vendor_id,classification,quoted_package_cents,availability_confirmed)
    VALUES(r,p,p_vendor,'quote_received',70000,true);
  INSERT INTO fixture.stage_inputs VALUES(p_case,p,r,gen_random_uuid(),gen_random_uuid(),a,s);
END;
$$;
CREATE FUNCTION fixture.stage(p_case integer) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE i fixture.stage_inputs;
BEGIN
  SELECT * INTO STRICT i FROM fixture.stage_inputs WHERE case_id=p_case;
  RETURN public.stage_vendor_quote_booking_checked(i.plan_id,'c2000000-0000-4000-8000-000000000001','vendor',
    i.response_id,i.action_id,i.approval_id,now()+interval '1 day',i.payload,i.snapshot,repeat('c',64));
END;
$$;
