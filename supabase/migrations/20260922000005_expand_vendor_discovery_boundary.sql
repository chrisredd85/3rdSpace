-- C2 EXPAND only. Preserve every existing grant, trigger and routine body.
-- Old direct writers remain available until the separately reviewed ACTIVATE.
-- Apply this file and its ledger entry together in one outer transaction.

ALTER TABLE public.discovery_vendors
  ADD COLUMN IF NOT EXISTS field_provenance JSONB NOT NULL DEFAULT '{}'::JSONB,
  ALTER COLUMN name DROP NOT NULL,
  ALTER COLUMN name DROP DEFAULT,
  ALTER COLUMN service_type DROP NOT NULL,
  ALTER COLUMN service_type DROP DEFAULT,
  ALTER COLUMN state DROP DEFAULT;

COMMENT ON COLUMN public.discovery_vendors.field_provenance IS
  'C2 evidence for independent scalar/contact values; missing or invalid evidence is unresolved, never independent by equality or row source.';

CREATE OR REPLACE FUNCTION private.vendor_boundary_fact_valid(p_key TEXT, p_value JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $function$
DECLARE v_item JSONB; v_field TEXT;
BEGIN
  IF p_key IN ('name','service_type','formatted_address','city','state','website','phone',
    'contact_email','organizer_provided_email') THEN
    RETURN jsonb_typeof(p_value) = 'string' AND length(btrim(p_value #>> '{}')) BETWEEN 1 AND 8192;
  ELSIF p_key IN ('inferred_hourly_rate_cents','inferred_package_rate_cents','inferred_minimum_cents') THEN
    IF jsonb_typeof(p_value) IS DISTINCT FROM 'number' THEN RETURN false; END IF;
    RETURN (p_value #>> '{}')::NUMERIC BETWEEN 0 AND 2147483647
      AND trunc((p_value #>> '{}')::NUMERIC) = (p_value #>> '{}')::NUMERIC;
  ELSIF p_key IN ('extracted_emails','extracted_contact_forms') THEN
    IF NOT COALESCE(private.venue_boundary_fact_valid(p_key,p_value),false) THEN RETURN false; END IF;
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_value) LOOP
      FOREACH v_field IN ARRAY ARRAY['email','url','label','source_path','source_url','source','evidence_kind','extracted_at'] LOOP
        IF v_item ? v_field AND jsonb_typeof(v_item->v_field) IS DISTINCT FROM 'string' THEN RETURN false; END IF;
      END LOOP;
      IF v_item ? 'evidence_kind' AND v_item->>'evidence_kind' NOT IN ('observed_form','contact_link') THEN RETURN false; END IF;
      FOREACH v_field IN ARRAY ARRAY['url','source_url'] LOOP
        IF v_item ? v_field AND substring(v_item->>v_field FROM '^https?://([^/?#]+)') LIKE '%@%' THEN RETURN false; END IF;
      END LOOP;
    END LOOP;
    RETURN true;
  END IF;
  RETURN false;
END;
$function$;

-- Reuse the reviewed, bounded provenance validator and typed website-contact
-- proof. No C1 routine is changed and no exception/subtransaction is recursive.
CREATE OR REPLACE FUNCTION private.discovery_vendor_safe_json(p_row JSONB)
RETURNS JSONB LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = pg_catalog AS $function$
DECLARE
  v_key TEXT; v_value JSONB; v_evidence JSONB; v_contacts JSONB; v_contact JSONB;
  v_provenance JSONB := '{}';
  v_result JSONB := '{"photos":[],"place_types":[],"extracted_emails":[],"extracted_contact_forms":[],"website_extraction_metadata":{}}';
BEGIN
  FOREACH v_key IN ARRAY ARRAY['id','source','source_external_id','created_at','updated_at',
    'website_extraction_status','website_extraction_attempted_at','website_extraction_attempts',
    'rate_inference_admin_status','rate_inference_extracted_at','last_refreshed_at',
    'last_places_refresh_at','last_meaningful_change_at','data_freshness_status'] LOOP
    v_result := v_result || jsonb_build_object(v_key,p_row->v_key);
  END LOOP;
  -- Place IDs, unlike provider facts/photo references, are durable identity.
  IF p_row->>'google_place_id' ~ '^[A-Za-z0-9_-]{1,255}$' THEN
    v_result := v_result || jsonb_build_object('google_place_id',p_row->'google_place_id');
  END IF;
  FOR v_key,v_value IN SELECT key,value FROM jsonb_each(p_row) LOOP
    v_evidence := p_row#>ARRAY['field_provenance',v_key];
    IF private.vendor_boundary_fact_valid(v_key,v_value)
      AND private.venue_boundary_provenance_valid(v_evidence)
      AND (v_key NOT IN ('extracted_emails','extracted_contact_forms') OR v_evidence->>'source'='venue_site')
      AND (v_key<>'organizer_provided_email' OR v_evidence->>'source'='host_input') THEN
      v_result := v_result || jsonb_build_object(v_key,v_value);
      v_provenance := v_provenance || jsonb_build_object(v_key,v_evidence);
    END IF;
  END LOOP;
  FOREACH v_key IN ARRAY ARRAY['extracted_emails','extracted_contact_forms'] LOOP
    IF NOT v_provenance ? v_key THEN
      v_contacts := '[]';
      FOR v_contact IN SELECT value FROM jsonb_array_elements(private.venue_boundary_legacy_contacts(p_row,v_key)) LOOP
        IF private.vendor_boundary_fact_valid(v_key,jsonb_build_array(v_contact)) THEN
          v_contacts := v_contacts || jsonb_build_array(v_contact);
        END IF;
      END LOOP;
      IF jsonb_array_length(v_contacts) > 0 THEN
        v_result := v_result || jsonb_build_object(v_key,v_contacts);
        v_provenance := v_provenance || jsonb_build_object(v_key,jsonb_build_object(
          'resolution','resolved','source','venue_site',
          'evidence_reference','legacy-website-extraction:' || (p_row->>'id') || ':' || v_key,
          'collected_at',v_contacts->0->>'extracted_at','confidence',NULL,
          'confirmation_status','site_published','lineage','[]'::JSONB));
      END IF;
    END IF;
  END LOOP;
  RETURN v_result || jsonb_build_object('field_provenance',v_provenance);
END;
$function$;

CREATE OR REPLACE VIEW public.discovery_vendors_safe WITH (security_barrier = true) AS
SELECT projection.* FROM public.discovery_vendors AS original
CROSS JOIN LATERAL jsonb_populate_record(NULL::public.discovery_vendors,
  private.discovery_vendor_safe_json(to_jsonb(original))) AS projection;
COMMENT ON VIEW public.discovery_vendors_safe IS
  'Independent vendor facts only; retained legacy Google facts are unavailable. Same UUIDs, separate safe reads instead of inferred PostgREST joins.';
REVOKE ALL ON public.discovery_vendors_safe FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.discovery_vendors_safe TO service_role;

CREATE OR REPLACE FUNCTION public.upsert_discovery_vendor_identity(
  p_place_id TEXT DEFAULT NULL, p_vendor_profile_id UUID DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $function$
DECLARE v_id UUID; v_ids UUID[]; v_source TEXT; v_external TEXT; v_result JSONB; v_linked_id UUID;
BEGIN
  IF (p_place_id IS NULL) = (p_vendor_profile_id IS NULL) THEN
    RAISE EXCEPTION 'vendor_boundary_exactly_one_identity_required' USING ERRCODE = '22023';
  END IF;
  IF p_place_id IS NOT NULL THEN
    IF p_place_id !~ '^[A-Za-z0-9_-]{1,255}$' THEN
      RAISE EXCEPTION 'vendor_boundary_invalid_place_id' USING ERRCODE = '22023';
    END IF;
    v_source := 'google_places'; v_external := p_place_id;
  ELSE
    SELECT discovery_vendor_id INTO v_linked_id FROM public.vendor_profiles WHERE id=p_vendor_profile_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'vendor_boundary_profile_not_found' USING ERRCODE = 'P0002';
    END IF;
    -- Preserve a prior canonical claim/link; never manufacture a second identity.
    -- A dangling link fails closed via STRICT rather than falling through to INSERT.
    IF v_linked_id IS NOT NULL THEN
      SELECT to_jsonb(v) INTO STRICT v_result FROM public.discovery_vendors_safe v WHERE id=v_linked_id;
      RETURN v_result;
    END IF;
    v_source := 'vendor_self_service'; v_external := 'vendor_profile:' || p_vendor_profile_id;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('vendor_identity:' || v_source || ':' || v_external,0));
  SELECT array_agg(id) INTO v_ids FROM public.discovery_vendors
    WHERE source=v_source AND (source_external_id=v_external OR
      (p_place_id IS NOT NULL AND (source_external_id='places/' || p_place_id OR google_place_id=p_place_id)));
  IF cardinality(v_ids)>1 THEN
    RAISE EXCEPTION 'vendor_boundary_ambiguous_place_identity' USING ERRCODE = '22023';
  END IF;
  v_id := v_ids[1];
  IF v_id IS NULL THEN
    INSERT INTO public.discovery_vendors(source,source_external_id,google_place_id)
      VALUES(v_source,v_external,p_place_id)
      ON CONFLICT(source,source_external_id) DO NOTHING RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      SELECT id INTO STRICT v_id FROM public.discovery_vendors WHERE source=v_source AND source_external_id=v_external;
    END IF;
  END IF;
  SELECT to_jsonb(v) INTO STRICT v_result FROM public.discovery_vendors_safe v WHERE id=v_id;
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.write_discovery_vendor_independent_facts(
  p_vendor_id UUID, p_values JSONB, p_field_provenance JSONB, p_operational JSONB DEFAULT '{}'::JSONB
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $function$
DECLARE v_key TEXT; v_value JSONB; v_set TEXT := ''; v_current JSONB; v_result JSONB;
BEGIN
  IF jsonb_typeof(p_values) IS DISTINCT FROM 'object' OR jsonb_typeof(p_field_provenance) IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_operational) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'vendor_boundary_invalid_contract' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_field_provenance) k WHERE NOT p_values ? k) THEN
    RAISE EXCEPTION 'vendor_boundary_extra_evidence' USING ERRCODE = '22023';
  END IF;
  FOR v_key,v_value IN SELECT key,value FROM jsonb_each(p_values) LOOP
    IF NOT (v_value='null'::JSONB AND v_key IN ('name','service_type','formatted_address','city','state','website','phone',
      'contact_email','organizer_provided_email','inferred_hourly_rate_cents','inferred_package_rate_cents','inferred_minimum_cents'))
      AND NOT COALESCE(private.vendor_boundary_fact_valid(v_key,v_value),false)
      OR NOT private.venue_boundary_provenance_valid(p_field_provenance->v_key)
      OR (v_key IN ('extracted_emails','extracted_contact_forms') AND p_field_provenance->v_key->>'source'<>'venue_site')
      OR (v_key='organizer_provided_email' AND p_field_provenance->v_key->>'source'<>'host_input') THEN
      RAISE EXCEPTION 'vendor_boundary_invalid_fact' USING ERRCODE = '22023', DETAIL = v_key;
    END IF;
    v_set := v_set || format('%I=incoming.%I,',v_key,v_key);
  END LOOP;
  FOR v_key,v_value IN SELECT key,value FROM jsonb_each(p_operational) LOOP
    IF v_key NOT IN ('website_extraction_status','website_extraction_attempts','website_extraction_attempted_at',
      'rate_inference_admin_status','rate_inference_extracted_at','last_refreshed_at',
      'last_places_refresh_at','last_meaningful_change_at','data_freshness_status') THEN
      RAISE EXCEPTION 'vendor_boundary_invalid_operational_key' USING ERRCODE = '22023', DETAIL = v_key;
    END IF;
    IF v_key='website_extraction_attempts' THEN
      IF jsonb_typeof(v_value) IS DISTINCT FROM 'number' THEN
        RAISE EXCEPTION 'vendor_boundary_invalid_counter' USING ERRCODE = '22023';
      END IF;
      IF (v_value#>>'{}')::NUMERIC NOT BETWEEN 0 AND 2147483647 OR trunc((v_value#>>'{}')::NUMERIC)<>(v_value#>>'{}')::NUMERIC THEN
        RAISE EXCEPTION 'vendor_boundary_invalid_counter' USING ERRCODE = '22023';
      END IF;
    ELSIF v_value<>'null'::JSONB AND jsonb_typeof(v_value) IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'vendor_boundary_invalid_operational_value' USING ERRCODE = '22023';
    END IF;
    IF v_key='website_extraction_status' AND COALESCE(v_value#>>'{}','') NOT IN
      ('never_attempted','successful','no_emails_found','blocked_by_robots','fetch_failed','rate_limited','failed','timeout','no_website','exhausted')
      OR v_key='rate_inference_admin_status' AND COALESCE(v_value#>>'{}','') NOT IN ('pending','approved','edited','rejected')
      OR v_key='data_freshness_status' AND COALESCE(v_value#>>'{}','') NOT IN ('fresh','stale','changed','under_review','closed') THEN
      RAISE EXCEPTION 'vendor_boundary_invalid_operational_enum' USING ERRCODE = '22023', DETAIL = v_key;
    END IF;
    v_set := v_set || format('%I=incoming.%I,',v_key,v_key);
  END LOOP;
  SELECT field_provenance INTO STRICT v_current FROM public.discovery_vendors WHERE id=p_vendor_id FOR UPDATE;
  -- Preserve retained legacy fields in place until D, never return them.
  EXECUTE 'UPDATE public.discovery_vendors AS target SET ' || v_set || 'field_provenance=$3,updated_at=clock_timestamp() '
    || 'FROM jsonb_populate_record(NULL::public.discovery_vendors,$2) AS incoming WHERE target.id=$1'
    USING p_vendor_id,p_values || p_operational,v_current || p_field_provenance;
  SELECT to_jsonb(v) INTO STRICT v_result FROM public.discovery_vendors_safe v WHERE id=p_vendor_id;
  RETURN v_result;
END;
$function$;

-- Thin pre-ACTIVATE compatibility gateway, not a lifecycle rewrite. Plan first,
-- then SHARE locks on response/vendor, including non-key direct legacy UPDATEs.
-- Locks last through the existing staging function and outer transaction.
-- No catch/retry: changed evidence fails before any action/approval/card write.
CREATE OR REPLACE FUNCTION public.stage_vendor_quote_booking_checked(
  p_plan_id UUID, p_actor_id UUID, p_quote_kind TEXT, p_response_id UUID,
  p_action_id UUID, p_approval_id UUID, p_expires_at TIMESTAMPTZ,
  p_action_payload JSONB, p_snapshot_json JSONB, p_snapshot_hash TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $function$
DECLARE v_owner UUID; v_row JSONB; v_safe JSONB; v_envelope JSONB; v_key TEXT; v_value JSONB; v_place_id TEXT;
BEGIN
  SELECT user_id INTO v_owner FROM public.plans WHERE id=p_plan_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'stage_plan_quote_booking_plan_not_found' USING ERRCODE = 'P0002'; END IF;
  IF p_actor_id IS NULL OR v_owner IS DISTINCT FROM p_actor_id THEN
    RAISE EXCEPTION 'stage_plan_quote_booking_actor_mismatch' USING ERRCODE = '42501';
  END IF;
  IF p_quote_kind IS DISTINCT FROM 'vendor' THEN
    RAISE EXCEPTION 'vendor_boundary_checked_stage_vendor_only' USING ERRCODE = '22023';
  END IF;
  SELECT to_jsonb(vendor) INTO v_row FROM public.vendor_outreach_responses response
    JOIN public.discovery_vendors vendor ON vendor.id=response.discovery_vendor_id
    WHERE response.id=p_response_id AND response.plan_id=p_plan_id FOR SHARE OF response,vendor;
  IF NOT FOUND THEN RAISE EXCEPTION 'stage_plan_quote_booking_response_not_found' USING ERRCODE = 'P0002'; END IF;
  v_safe := private.discovery_vendor_safe_json(v_row);
  v_place_id := CASE WHEN v_safe->>'source'='google_places' THEN
    COALESCE(v_safe->>'google_place_id',regexp_replace(v_safe->>'source_external_id','^places/','')) ELSE NULL END;
  v_envelope := p_action_payload->'vendor_data';
  IF jsonb_typeof(v_envelope) IS DISTINCT FROM 'object' OR v_envelope->'schema_version' IS DISTINCT FROM '1'::JSONB
    OR jsonb_typeof(v_envelope->'identity') IS DISTINCT FROM 'object'
    OR v_envelope#>>'{identity,kind}' IS DISTINCT FROM 'vendor'
    OR v_envelope#>>'{identity,id}' IS DISTINCT FROM v_row->>'id'
    OR v_envelope#>>'{identity,place_id}' IS DISTINCT FROM v_place_id
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(v_envelope) k WHERE k NOT IN ('schema_version','identity','values','field_provenance'))
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(v_envelope->'identity') k WHERE k NOT IN ('kind','id','place_id'))
    OR jsonb_typeof(v_envelope->'values') IS DISTINCT FROM 'object'
    OR jsonb_typeof(v_envelope->'field_provenance') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'vendor_boundary_invalid_stage_envelope' USING ERRCODE = '22023';
  END IF;
  FOR v_key,v_value IN SELECT key,value FROM jsonb_each(v_envelope->'values') LOOP
    IF NOT COALESCE(private.vendor_boundary_fact_valid(v_key,v_value),false)
      OR v_value IS DISTINCT FROM v_safe->v_key
      OR v_envelope#>ARRAY['field_provenance',v_key] IS DISTINCT FROM v_safe#>ARRAY['field_provenance',v_key]
      OR NOT private.venue_boundary_provenance_valid(v_envelope#>ARRAY['field_provenance',v_key]) THEN
      RAISE EXCEPTION 'vendor_boundary_stage_fact_changed' USING ERRCODE = '23514', DETAIL = v_key;
    END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(v_envelope->'field_provenance') k WHERE NOT (v_envelope->'values') ? k)
    OR NOT ((v_envelope->'values') ?& ARRAY['name','service_type'])
    OR v_safe->>'name' IS NULL OR v_safe->>'service_type' IS NULL
    OR p_action_payload->>'target_name' IS DISTINCT FROM v_safe->>'name'
    OR p_action_payload->>'service_type' IS DISTINCT FROM v_safe->>'service_type'
    OR p_action_payload->>'target_type' IS DISTINCT FROM 'discovery_vendor'
    OR p_snapshot_json#>'{action,payload_json}' IS DISTINCT FROM p_action_payload
    OR p_snapshot_json#>>'{action,target_id}' IS DISTINCT FROM v_row->>'id'
    OR p_snapshot_json#>>'{action,target_type}' IS DISTINCT FROM 'discovery_vendor'
    OR p_snapshot_json#>>'{approval,provider}' IS DISTINCT FROM v_safe->>'name'
    OR p_snapshot_json#>>'{approval,package_details}' IS DISTINCT FROM v_safe->>'service_type'
    OR p_snapshot_json#>>'{counterparty,provider}' IS DISTINCT FROM v_safe->>'name'
    OR p_snapshot_json#>>'{counterparty,display_name}' IS DISTINCT FROM v_safe->>'name'
    OR p_snapshot_json#>>'{counterparty,target_id}' IS DISTINCT FROM v_row->>'id'
    OR p_snapshot_json#>>'{counterparty,target_type}' IS DISTINCT FROM 'discovery_vendor' THEN
    RAISE EXCEPTION 'vendor_boundary_stage_snapshot_mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN public.stage_plan_quote_booking(p_plan_id,p_actor_id,p_quote_kind,p_response_id,
    p_action_id,p_approval_id,p_expires_at,p_action_payload,p_snapshot_json,p_snapshot_hash);
END;
$function$;

REVOKE ALL ON FUNCTION private.vendor_boundary_fact_valid(TEXT,JSONB),private.discovery_vendor_safe_json(JSONB)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.vendor_boundary_fact_valid(TEXT,JSONB),private.discovery_vendor_safe_json(JSONB) TO service_role;
REVOKE ALL ON FUNCTION public.upsert_discovery_vendor_identity(TEXT,UUID),
  public.write_discovery_vendor_independent_facts(UUID,JSONB,JSONB,JSONB),
  public.stage_vendor_quote_booking_checked(UUID,UUID,TEXT,UUID,UUID,UUID,TIMESTAMPTZ,JSONB,JSONB,TEXT)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.upsert_discovery_vendor_identity(TEXT,UUID),
  public.write_discovery_vendor_independent_facts(UUID,JSONB,JSONB,JSONB),
  public.stage_vendor_quote_booking_checked(UUID,UUID,TEXT,UUID,UUID,UUID,TIMESTAMPTZ,JSONB,JSONB,TEXT) TO service_role;
