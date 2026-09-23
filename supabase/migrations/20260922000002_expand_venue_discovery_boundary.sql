-- C1 EXPAND: additive objects and nullable discovery identity fields only.
-- Preserve existing table/column/schema grants, existing routine definitions,
-- and historical rows. No persistence trigger is installed by this phase.
-- New object ACLs are explicitly initialized in this same transaction: API
-- access to the safe view and public boundary RPCs is service-role only.
-- Apply this file and its migration-ledger row in one outer transaction.
-- New application traffic remains closed until ACTIVATE completes.

CREATE SCHEMA IF NOT EXISTS private;

ALTER TABLE public.discovery_venues
  ALTER COLUMN name DROP NOT NULL,
  ALTER COLUMN name DROP DEFAULT,
  ALTER COLUMN city DROP NOT NULL,
  ALTER COLUMN city DROP DEFAULT,
  ALTER COLUMN state DROP NOT NULL,
  ALTER COLUMN state DROP DEFAULT;

CREATE OR REPLACE FUNCTION private.venue_boundary_provenance_valid(p_value JSONB, p_depth INTEGER DEFAULT 0)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $function$
DECLARE
  v_parent JSONB;
BEGIN
  IF p_depth > 16 OR jsonb_typeof(p_value) IS DISTINCT FROM 'object'
    OR p_value->>'resolution' IS DISTINCT FROM 'resolved'
    OR p_value->>'source' NOT IN ('venue_site', 'host_input', 'outreach_reply', 'derived')
    OR p_value->>'source' IS NULL
    OR jsonb_typeof(p_value->'evidence_reference') IS DISTINCT FROM 'string'
    OR length(btrim(p_value->>'evidence_reference')) NOT BETWEEN 1 AND 2048
    OR jsonb_typeof(p_value->'collected_at') IS DISTINCT FROM 'string'
    OR p_value->>'collected_at' !~ '^\d{4}-(0[1-9]|1[0-2])-([0-2][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]+)?(Z|[+-]([01][0-9]|2[0-3]):[0-5][0-9])$'
    OR p_value->>'confirmation_status' NOT IN ('unconfirmed', 'site_published', 'venue_confirmed')
    OR p_value->>'confirmation_status' IS NULL
    OR jsonb_typeof(p_value->'lineage') IS DISTINCT FROM 'array'
    OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_value) k WHERE k NOT IN
      ('resolution','source','evidence_reference','collected_at','confidence','confirmation_status','lineage'))
  THEN RETURN false; END IF;
  IF p_value ? 'confidence' AND p_value->'confidence' <> 'null'::JSONB THEN
    IF jsonb_typeof(p_value->'confidence') IS DISTINCT FROM 'number' THEN RETURN false; END IF;
    IF (p_value->>'confidence')::NUMERIC NOT BETWEEN 0 AND 1 THEN RETURN false; END IF;
  END IF;
  IF p_value->>'source' = 'derived' AND jsonb_array_length(p_value->'lineage') = 0 THEN RETURN false; END IF;
  FOR v_parent IN SELECT value FROM jsonb_array_elements(p_value->'lineage') LOOP
    IF jsonb_typeof(v_parent) IS DISTINCT FROM 'object'
      OR jsonb_typeof(v_parent->'field') IS DISTINCT FROM 'string'
      OR length(btrim(v_parent->>'field')) NOT BETWEEN 1 AND 128
      OR EXISTS (SELECT 1 FROM jsonb_object_keys(v_parent) k WHERE k NOT IN ('field','provenance'))
      OR NOT private.venue_boundary_provenance_valid(v_parent->'provenance', p_depth + 1)
    THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION private.venue_boundary_fact_valid(p_key TEXT, p_value JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $function$
DECLARE v_item JSONB;
BEGIN
  IF p_key IN ('name','address','neighborhood','city','state','contact_email','contact_phone','website',
    'instagram_handle','alcohol_policy','parking_notes','price_hint_note') THEN
    RETURN jsonb_typeof(p_value) = 'string' AND length(btrim(p_value #>> '{}')) BETWEEN 1 AND 8192;
  ELSIF p_key IN ('capacity_seated','capacity_standing','capacity_cocktail','inferred_capacity_seated',
    'inferred_capacity_standing','price_hint_cents_low','price_hint_cents_high') THEN
    IF jsonb_typeof(p_value) IS DISTINCT FROM 'number' THEN RETURN false; END IF;
    RETURN (p_value #>> '{}')::NUMERIC BETWEEN 0 AND 2147483647
      AND trunc((p_value #>> '{}')::NUMERIC) = (p_value #>> '{}')::NUMERIC;
  ELSIF p_key IN ('lat','lng') THEN
    IF jsonb_typeof(p_value) IS DISTINCT FROM 'number' THEN RETURN false; END IF;
    RETURN abs((p_value #>> '{}')::NUMERIC) <= CASE p_key WHEN 'lat' THEN 90 ELSE 180 END;
  ELSIF p_key = 'av_available' THEN RETURN jsonb_typeof(p_value) = 'boolean';
  ELSIF p_key = 'vibe_tags' THEN
    IF jsonb_typeof(p_value) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_value) LOOP
      IF jsonb_typeof(v_item) IS DISTINCT FROM 'string' OR length(btrim(v_item #>> '{}')) NOT BETWEEN 1 AND 256
      THEN RETURN false; END IF;
    END LOOP;
    RETURN true;
  ELSIF p_key IN ('extracted_emails','extracted_contact_forms','organizer_provided_emails') THEN
    IF jsonb_typeof(p_value) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_value) LOOP
      IF jsonb_typeof(v_item) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
      IF p_key = 'organizer_provided_emails' THEN
        IF EXISTS (SELECT 1 FROM jsonb_object_keys(v_item) k WHERE k NOT IN
          ('email','provided_by_user_id','provided_at','source'))
          OR v_item->>'source' IS DISTINCT FROM 'organizer_manual'
          OR COALESCE(v_item->>'email','') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
          OR COALESCE(v_item->>'provided_by_user_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          OR COALESCE(v_item->>'provided_at','') !~ '^\d{4}-\d{2}-\d{2}T'
        THEN RETURN false; END IF;
      ELSE
        IF EXISTS (SELECT 1 FROM jsonb_object_keys(v_item) k WHERE k NOT IN
          ('email','url','label','confidence','source_path','source_url','source','evidence_kind','extracted_at','is_likely_booking_contact'))
          OR COALESCE(v_item->>'source_path','') !~ '^/'
          OR COALESCE(v_item->>'extracted_at','') !~ '^\d{4}-\d{2}-\d{2}T'
          OR jsonb_typeof(v_item->'confidence') IS DISTINCT FROM 'number'
          OR jsonb_typeof(v_item->'is_likely_booking_contact') IS DISTINCT FROM 'boolean'
        THEN RETURN false; END IF;
        IF (v_item->>'confidence')::NUMERIC NOT BETWEEN 0 AND 1 THEN RETURN false; END IF;
        IF v_item ? 'source' AND v_item->>'source' IS DISTINCT FROM 'business_website' THEN RETURN false; END IF;
        IF v_item ? 'source_url' AND COALESCE(v_item->>'source_url','') !~ '^https?://[^[:space:]]+$' THEN RETURN false; END IF;
        IF v_item ? 'evidence_kind' AND v_item->>'evidence_kind' NOT IN ('observed_form','contact_link') THEN RETURN false; END IF;
        IF p_key = 'extracted_emails' AND
          (v_item ? 'url' OR v_item ? 'label' OR COALESCE(v_item->>'email','') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
        THEN RETURN false; END IF;
        IF p_key = 'extracted_contact_forms' AND
          (v_item ? 'email' OR COALESCE(v_item->>'url','') !~ '^https?://[^[:space:]]+$'
            OR jsonb_typeof(v_item->'label') IS DISTINCT FROM 'string')
        THEN RETURN false; END IF;
      END IF;
    END LOOP;
    RETURN true;
  END IF;
  RETURN false;
END;
$function$;

-- Compatibility is based on recorded successful page acquisition, not row source
-- or equal values. Do not carry the Google-context contact-selection flag forward.
CREATE OR REPLACE FUNCTION private.venue_boundary_legacy_contacts(p_row JSONB, p_key TEXT)
RETURNS JSONB LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $function$
DECLARE v_item JSONB; v_result JSONB := '[]';
BEGIN
  IF p_key NOT IN ('extracted_emails','extracted_contact_forms')
    OR jsonb_typeof(p_row->p_key) IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_row#>'{website_extraction_metadata,paths_successful}') IS DISTINCT FROM 'array'
    OR p_row->>'website_extraction_status' NOT IN ('successful','no_emails_found')
  THEN RETURN v_result; END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_row->p_key) LOOP
    IF private.venue_boundary_fact_valid(p_key, jsonb_build_array(v_item))
      AND (p_row#>'{website_extraction_metadata,paths_successful}') ? (v_item->>'source_path')
    THEN v_result := v_result || jsonb_build_array(v_item || '{"is_likely_booking_contact":false}'::JSONB); END IF;
  END LOOP;
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION private.discovery_venue_safe_json(p_row JSONB)
RETURNS JSONB LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = pg_catalog AS $function$
DECLARE
  v_key TEXT; v_value JSONB; v_evidence JSONB; v_contacts JSONB;
  v_provenance JSONB := '{}';
  v_result JSONB := jsonb_build_object('vibe_tags','[]'::JSONB,'google_photo_names','[]'::JSONB,
    'photos','[]'::JSONB,'opening_hours_json','{}'::JSONB,'extracted_emails','[]'::JSONB,
    'extracted_contact_forms','[]'::JSONB,'organizer_provided_emails','[]'::JSONB,'website_extraction_metadata','{}'::JSONB);
BEGIN
  FOREACH v_key IN ARRAY ARRAY['id','source','source_external_id','is_claimed','claimed_venue_id','created_at','updated_at',
    'last_enriched_at','last_verified_at','website_extraction_status','website_extraction_attempts',
    'website_extraction_attempted_at','organizer_rescue_count','last_rescue_at',
    'capacity_inference_admin_status','capacity_inference_extracted_at'] LOOP
    v_result := v_result || jsonb_build_object(v_key, p_row->v_key);
  END LOOP;
  FOR v_key, v_value IN SELECT key,value FROM jsonb_each(p_row) LOOP
    v_evidence := p_row#>ARRAY['metadata','field_provenance',v_key];
    IF p_row#>'{metadata,venue_boundary_version}' = '1'::JSONB
      AND private.venue_boundary_fact_valid(v_key,v_value)
      AND private.venue_boundary_provenance_valid(v_evidence)
    THEN
      v_result := v_result || jsonb_build_object(v_key,v_value);
      v_provenance := v_provenance || jsonb_build_object(v_key,v_evidence);
    END IF;
  END LOOP;
  FOREACH v_key IN ARRAY ARRAY['extracted_emails','extracted_contact_forms'] LOOP
    IF NOT v_provenance ? v_key THEN
      v_contacts := private.venue_boundary_legacy_contacts(p_row,v_key);
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
  RETURN v_result || jsonb_build_object('metadata',jsonb_build_object(
    'venue_boundary_version',1,'field_provenance',v_provenance));
END;
$function$;

CREATE OR REPLACE VIEW public.discovery_venues_safe WITH (security_barrier = true) AS
SELECT projection.* FROM public.discovery_venues AS original
CROSS JOIN LATERAL jsonb_populate_record(NULL::public.discovery_venues,
  private.discovery_venue_safe_json(to_jsonb(original))) AS projection;
COMMENT ON VIEW public.discovery_venues_safe IS
  'C1 independent-only venue projection. Same UUIDs; unknown legacy fields unavailable. Read separately, not through inferred PostgREST joins.';
REVOKE ALL ON public.discovery_venues_safe FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.discovery_venues_safe TO service_role;

CREATE OR REPLACE FUNCTION public.upsert_discovery_venue_identity(p_place_id TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $function$
DECLARE v_id UUID; v_result JSONB; v_ids UUID[];
BEGIN
  IF p_place_id IS NULL OR p_place_id !~ '^[A-Za-z0-9_-]{1,255}$' THEN
    RAISE EXCEPTION 'venue_boundary_invalid_place_id' USING ERRCODE = '22023';
  END IF;
  -- Preserve existing UUID/FK identity even when an older client stored a resource prefix.
  -- One transaction lock serializes this gateway's canonical-ID aliases; ambiguous
  -- historical duplicates pause this identity instead of choosing the wrong business.
  PERFORM pg_advisory_xact_lock(hashtextextended('venue_identity:' || p_place_id,0));
  SELECT array_agg(id) INTO v_ids FROM public.discovery_venues
    WHERE source='google_places' AND source_external_id IN (p_place_id,'places/' || p_place_id);
  IF cardinality(v_ids) > 1 THEN
    RAISE EXCEPTION 'venue_boundary_ambiguous_place_identity' USING ERRCODE = '22023';
  END IF;
  v_id := v_ids[1];
  IF v_id IS NULL THEN
    INSERT INTO public.discovery_venues(source,source_external_id,metadata)
    VALUES ('google_places',p_place_id,'{"venue_boundary_version":1,"field_provenance":{}}')
    ON CONFLICT (source,source_external_id) DO NOTHING RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      SELECT id INTO STRICT v_id FROM public.discovery_venues WHERE source='google_places' AND source_external_id=p_place_id;
    END IF;
  END IF;
  SELECT to_jsonb(v) INTO STRICT v_result FROM public.discovery_venues_safe v WHERE id = v_id;
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.write_discovery_venue_independent_facts(
  p_venue_id UUID, p_values JSONB, p_field_provenance JSONB, p_operational JSONB DEFAULT '{}'::JSONB
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $function$
DECLARE v_key TEXT; v_value JSONB; v_set TEXT := ''; v_result JSONB; v_current JSONB; v_provenance JSONB;
BEGIN
  IF jsonb_typeof(p_values) IS DISTINCT FROM 'object' OR jsonb_typeof(p_field_provenance) IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_operational) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'venue_boundary_invalid_contract' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_field_provenance) k WHERE NOT p_values ? k) THEN
    RAISE EXCEPTION 'venue_boundary_extra_evidence' USING ERRCODE = '22023';
  END IF;
  FOR v_key,v_value IN SELECT key,value FROM jsonb_each(p_values) LOOP
    IF NOT (v_value = 'null'::jsonb AND v_key IN ('name','address','neighborhood','city','state','contact_email','contact_phone','website','instagram_handle','capacity_seated','capacity_standing','capacity_cocktail','inferred_capacity_seated','inferred_capacity_standing','alcohol_policy','av_available','parking_notes','price_hint_cents_low','price_hint_cents_high','price_hint_note','lat','lng')) AND NOT COALESCE(private.venue_boundary_fact_valid(v_key,v_value),false)
      OR NOT private.venue_boundary_provenance_valid(p_field_provenance->v_key)
      OR (v_key IN ('extracted_emails','extracted_contact_forms') AND p_field_provenance->v_key->>'source' <> 'venue_site')
      OR (v_key = 'organizer_provided_emails' AND p_field_provenance->v_key->>'source' <> 'host_input') THEN
      RAISE EXCEPTION 'venue_boundary_invalid_fact' USING ERRCODE = '22023', DETAIL = v_key;
    END IF;
    v_set := v_set || format('%I = incoming.%I,',v_key,v_key);
  END LOOP;
  FOR v_key,v_value IN SELECT key,value FROM jsonb_each(p_operational) LOOP
    IF v_key NOT IN ('website_extraction_status','website_extraction_attempts','website_extraction_attempted_at',
      'last_enriched_at','last_verified_at','organizer_rescue_count','last_rescue_at',
      'capacity_inference_admin_status','capacity_inference_extracted_at') THEN
      RAISE EXCEPTION 'venue_boundary_invalid_operational_key' USING ERRCODE = '22023', DETAIL = v_key;
    END IF;
    IF v_key IN ('website_extraction_attempts','organizer_rescue_count') THEN
      IF jsonb_typeof(v_value) IS DISTINCT FROM 'number' THEN
        RAISE EXCEPTION 'venue_boundary_invalid_counter' USING ERRCODE = '22023';
      END IF;
      IF (v_value #>> '{}')::NUMERIC NOT BETWEEN 0 AND 2147483647
        OR trunc((v_value #>> '{}')::NUMERIC) <> (v_value #>> '{}')::NUMERIC THEN
        RAISE EXCEPTION 'venue_boundary_invalid_counter' USING ERRCODE = '22023';
      END IF;
    ELSIF v_value <> 'null'::JSONB AND jsonb_typeof(v_value) IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'venue_boundary_invalid_operational_value' USING ERRCODE = '22023';
    END IF;
    v_set := v_set || format('%I = incoming.%I,',v_key,v_key);
  END LOOP;
  SELECT metadata INTO STRICT v_current FROM public.discovery_venues WHERE id = p_venue_id FOR UPDATE;
  v_provenance := CASE WHEN v_current->'venue_boundary_version' = '1'::JSONB
    AND jsonb_typeof(v_current->'field_provenance') = 'object' THEN v_current->'field_provenance' ELSE '{}'::JSONB END;
  -- Preserve the original row's retained legacy metadata in place until D. It is
  -- never exposed by the safe view or returned by this command, nor snapshotted.
  v_current := jsonb_set(jsonb_set(v_current,'{venue_boundary_version}','1'),
    '{field_provenance}',v_provenance || p_field_provenance);
  EXECUTE 'UPDATE public.discovery_venues AS target SET ' || v_set || 'metadata = $3, updated_at = clock_timestamp() '
    || 'FROM jsonb_populate_record(NULL::public.discovery_venues,$2) AS incoming WHERE target.id = $1'
    USING p_venue_id,p_values || p_operational,v_current;
  SELECT to_jsonb(v) INTO STRICT v_result FROM public.discovery_venues_safe v WHERE id = p_venue_id;
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.upsert_discovery_venue_identity(TEXT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.write_discovery_venue_independent_facts(UUID,JSONB,JSONB,JSONB) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.upsert_discovery_venue_identity(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.write_discovery_venue_independent_facts(UUID,JSONB,JSONB,JSONB) TO service_role;
REVOKE ALL ON FUNCTION private.venue_boundary_provenance_valid(JSONB,INTEGER), private.venue_boundary_fact_valid(TEXT,JSONB),
  private.venue_boundary_legacy_contacts(JSONB,TEXT), private.discovery_venue_safe_json(JSONB) FROM PUBLIC, anon, authenticated, service_role;
-- The pure JSON projector owns only private-helper name resolution. It contains
-- no table access or dynamic SQL. Its fixed search path avoids granting private
-- schema USAGE/raw access merely to make a cold restricted-role view read work.
GRANT EXECUTE ON FUNCTION private.venue_boundary_provenance_valid(JSONB,INTEGER), private.venue_boundary_fact_valid(TEXT,JSONB),
  private.venue_boundary_legacy_contacts(JSONB,TEXT), private.discovery_venue_safe_json(JSONB) TO service_role;

-- A typed Stripe account-status event is operational payment evidence, not a
-- Places field change. Keep this exception exact; source labels alone confer
-- no permission to retain business-field history.
CREATE OR REPLACE FUNCTION private.venue_boundary_stripe_history_valid(p_value JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $function$
DECLARE v_evidence JSONB; v_key TEXT; v_status JSONB;
BEGIN
  IF p_value->>'entity_type' IS DISTINCT FROM 'discovery_venue'
    OR p_value->>'source' IS DISTINCT FROM 'stripe_account_event'
    OR p_value->>'field_name' IS DISTINCT FROM 'stripe_connect_status'
    OR length(btrim(COALESCE(p_value->>'entity_id',''))) = 0
    OR p_value->'confidence' IS DISTINCT FROM '1'::JSONB OR p_value->'applied' IS DISTINCT FROM 'true'::JSONB
    OR COALESCE(p_value->>'applied_at','') !~ '^\d{4}-\d{2}-\d{2}T'
    OR jsonb_typeof(p_value->'source_evidence') IS DISTINCT FROM 'string'
    OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_value) k WHERE k NOT IN
      ('entity_type','entity_id','source','field_name','old_value','new_value','confidence','source_evidence',
       'applied','applied_at','id','created_at','actor_id','cascade_impact','review_notes','reviewed_by'))
  THEN RETURN false; END IF;
  FOREACH v_key IN ARRAY ARRAY['old_value','new_value'] LOOP
    v_status := p_value->v_key;
    IF v_status IS NULL OR (v_status <> 'null'::JSONB AND
      (jsonb_typeof(v_status) <> 'string' OR v_status #>> '{}' NOT IN
        ('pending','pending_onboarding','onboarding_started','capabilities_pending','active','complete','restricted','disabled')))
    THEN RETURN false; END IF;
  END LOOP;
  FOREACH v_key IN ARRAY ARRAY['actor_id','cascade_impact','review_notes','reviewed_by'] LOOP
    IF p_value ? v_key AND p_value->v_key <> 'null'::JSONB THEN RETURN false; END IF;
  END LOOP;
  v_evidence := (p_value->>'source_evidence')::JSONB;
  IF jsonb_typeof(v_evidence) IS DISTINCT FROM 'object'
    OR EXISTS (SELECT 1 FROM jsonb_object_keys(v_evidence) k WHERE k NOT IN
      ('account_id','event_id','charges_enabled','payouts_enabled','capabilities','requirements'))
    OR COALESCE(v_evidence->>'account_id','') !~ '^acct_[A-Za-z0-9]+$'
    OR COALESCE(v_evidence->>'event_id','') !~ '^evt_[A-Za-z0-9]+$'
    OR jsonb_typeof(v_evidence->'charges_enabled') IS DISTINCT FROM 'boolean'
    OR jsonb_typeof(v_evidence->'payouts_enabled') IS DISTINCT FROM 'boolean'
    OR NOT v_evidence ?& ARRAY['capabilities','requirements']
    OR jsonb_typeof(v_evidence->'capabilities') NOT IN ('object','null')
    OR jsonb_typeof(v_evidence->'requirements') NOT IN ('object','null') THEN RETURN false; END IF;
  RETURN true;
END;
$function$;
REVOKE ALL ON FUNCTION private.venue_boundary_stripe_history_valid(JSONB) FROM PUBLIC,anon,authenticated,service_role;

-- Define the future guard without attaching it to any durable sink.
-- Structural shared-sink guard, not a name regex or a free-text provenance claim.
-- A venue field must travel inside the Gate A envelope, or be an explicit alias
-- of that envelope. Canonical identity labels are checked against the safe row.
-- No sanitizer silently rewrites an approval/hash or a commercial snapshot.
CREATE OR REPLACE FUNCTION private.assert_venue_durable_json(
  p_value JSONB, p_venue_context BOOLEAN DEFAULT false, p_venue_id TEXT DEFAULT NULL, p_depth INTEGER DEFAULT 0,
  p_envelope JSONB DEFAULT NULL, p_record_scope TEXT DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $function$
DECLARE
  v_key TEXT; v_item JSONB; v_context BOOLEAN := p_venue_context; v_id TEXT := p_venue_id;
  v_evidence JSONB := p_envelope->'field_provenance'; v_values JSONB := p_envelope->'values';
  v_envelope JSONB := p_envelope; v_safe JSONB; v_name TEXT; v_field TEXT;
  v_canonical BOOLEAN := false; v_lookup TEXT; v_derived BOOLEAN := false;
  v_verified_fields TEXT[] := '{}'; v_parent JSONB; v_contact_match BOOLEAN;
BEGIN
  IF p_depth > 64 THEN RAISE EXCEPTION 'venue_boundary_payload_depth' USING ERRCODE = '22023'; END IF;
  IF p_value IS NULL OR p_value = 'null'::JSONB THEN RETURN; END IF;
  IF jsonb_typeof(p_value) = 'array' THEN
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_value) LOOP
      PERFORM private.assert_venue_durable_json(v_item,v_context,v_id,p_depth+1,v_envelope,p_record_scope);
    END LOOP;
    RETURN;
  END IF;
  IF jsonb_typeof(p_value) <> 'object' THEN
    IF v_context AND p_record_scope IN ('snapshot','snapshot_json','metadata','payload_json','input','output',
      'input_json','output_json','request_json','result_json')
      AND jsonb_typeof(p_value) = 'string' AND p_value #>> '{}' ~ '^[[:space:]]*[\[{]' THEN
      RAISE EXCEPTION 'venue_boundary_opaque_serialized_payload' USING ERRCODE = '22023';
    END IF;
    RETURN;
  END IF;

  IF p_value ? 'googleLive' OR p_value ? 'google_live' OR p_value ? 'google_live_overlays' THEN
    RAISE EXCEPTION 'venue_boundary_live_overlay' USING ERRCODE = '22023';
  END IF;
  IF p_value->>'entity_type' = 'discovery_venue' AND p_value ? 'field_name' THEN
    -- Legacy field-change bodies have no per-field acquisition contract. They
    -- cannot be recopied, even if an admin approved the old Google value.
    IF NOT p_value ? 'venue_data' THEN
      IF NOT private.venue_boundary_stripe_history_valid(p_value) THEN
        RAISE EXCEPTION 'venue_boundary_unresolved_history' USING ERRCODE = '22023';
      END IF;
      PERFORM private.assert_venue_durable_json((p_value->>'source_evidence')::JSONB,false,NULL,p_depth+1);
    END IF;
  END IF;

  -- A vendor-only object does not enter the C1 venue contract.
  IF p_value#>>'{identity,kind}' = 'vendor' OR p_value->>'target_type' = 'discovery_vendor'
    OR (p_value->>'kind' = 'vendor' AND NOT p_value ? 'discovery_venue_id') THEN
    v_context := false; v_id := NULL; v_envelope := NULL; v_values := NULL; v_evidence := NULL;
  END IF;
  -- Old recommendation JSON used venue_id/reference_id without a discovery marker.
  -- Resolve only that explicit identity, never infer identity from a label. Native
  -- catalog recommendations do not inherit discovery restrictions just by nesting.
  v_lookup := COALESCE(p_value->>'venue_id', CASE WHEN p_value->>'type' = 'venue' THEN p_value->>'reference_id' END);
  IF v_lookup ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND EXISTS(SELECT 1 FROM public.discovery_venues WHERE id::TEXT=v_lookup) THEN
    v_context := true; v_id := v_lookup;
  END IF;
  v_context := v_context OR p_value#>>'{identity,kind}' = 'venue'
    OR p_value->>'entity_type' = 'discovery_venue'
    OR (p_value->>'source' = 'google_places' AND NOT p_value ? 'service_type' AND p_value->>'kind' IS DISTINCT FROM 'vendor')
    OR (p_value ? 'place_id' AND NOT p_value ? 'service_type' AND p_value->>'kind' IS DISTINCT FROM 'vendor')
    OR p_value->>'target_type' = 'discovery_venue' OR p_value->>'quote_kind' = 'venue'
    OR p_value#>>'{payload_json,quote_kind}' = 'venue'
    OR p_value#>>'{counterparty,target_type}' = 'discovery_venue'
    OR p_value#>>'{snapshot_json,counterparty,target_type}' = 'discovery_venue'
    OR NULLIF(p_value->>'discovery_venue_id','') IS NOT NULL
    OR NULLIF(p_value->>'discoveryVenueId','') IS NOT NULL
    OR (p_value->>'is_discovery' = 'true' AND p_value->>'kind' IS DISTINCT FROM 'vendor');
  v_context := COALESCE(v_context,false);
  v_id := COALESCE(NULLIF(p_value->>'discovery_venue_id',''),NULLIF(p_value->>'discoveryVenueId',''),
    CASE WHEN p_value->>'target_type' = 'discovery_venue' THEN p_value->>'target_id' END,
    CASE WHEN p_value#>>'{identity,kind}' = 'venue' THEN p_value#>>'{identity,id}' END,
    CASE WHEN p_value#>>'{counterparty,target_type}' = 'discovery_venue' THEN p_value#>>'{counterparty,target_id}' END,
    CASE WHEN p_value#>>'{snapshot_json,counterparty,target_type}' = 'discovery_venue' THEN p_value#>>'{snapshot_json,counterparty,target_id}' END,
    CASE WHEN p_value#>>'{payload_json,target_type}' = 'discovery_venue' THEN p_value#>>'{payload_json,target_id}' END,
    v_id);

  IF p_value#>>'{identity,kind}' = 'venue' THEN
    IF p_value->'schema_version' IS DISTINCT FROM '1'::JSONB
      OR jsonb_typeof(p_value->'values') IS DISTINCT FROM 'object'
      OR jsonb_typeof(p_value->'field_provenance') IS DISTINCT FROM 'object'
      OR COALESCE(v_id,'') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_value) k WHERE k NOT IN
        ('schema_version','identity','values','field_provenance'))
      OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_value->'identity') k WHERE k NOT IN ('kind','id','place_id'))
      OR NOT (p_value->'identity') ? 'place_id'
      OR (p_value#>'{identity,place_id}' <> 'null'::JSONB AND
        (jsonb_typeof(p_value#>'{identity,place_id}') <> 'string' OR p_value#>>'{identity,place_id}' !~ '^(places/)?[A-Za-z0-9_-]{1,255}$'))
      OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_value->'field_provenance') k WHERE NOT (p_value->'values') ? k)
    THEN RAISE EXCEPTION 'venue_boundary_invalid_envelope' USING ERRCODE = '22023'; END IF;
    SELECT to_jsonb(safe) INTO v_safe FROM public.discovery_venues_safe safe WHERE safe.id::TEXT = v_id;
    IF v_safe IS NULL OR NULLIF(regexp_replace(p_value#>>'{identity,place_id}','^places/',''),'')
      IS DISTINCT FROM NULLIF(regexp_replace(v_safe->>'source_external_id','^places/',''),'') THEN
      RAISE EXCEPTION 'venue_boundary_envelope_identity_mismatch' USING ERRCODE = '22023';
    END IF;
    FOR v_key,v_item IN SELECT key,value FROM jsonb_each(p_value->'values') LOOP
      IF NOT COALESCE(private.venue_boundary_fact_valid(v_key,v_item),false)
        OR NOT private.venue_boundary_provenance_valid(p_value#>ARRAY['field_provenance',v_key])
      THEN RAISE EXCEPTION 'venue_boundary_unproven_envelope_fact' USING ERRCODE = '22023', DETAIL = v_key; END IF;
      -- Provenance is not self-authorizing. Downstream callers, including direct
      -- authenticated table writers, must copy evidence saved by the privileged
      -- fact gateway. The only scalar projection is a selected, evidenced email.
      v_contact_match := false;
      IF v_key = 'contact_email' THEN
        SELECT EXISTS (
          SELECT 1 FROM (VALUES ('extracted_emails'),('organizer_provided_emails')) AS lists(field)
          CROSS JOIN LATERAL jsonb_array_elements(COALESCE(v_safe->lists.field,'[]'::JSONB)) contact
          WHERE contact->'email' = v_item
            AND p_value#>ARRAY['field_provenance',v_key] = v_safe#>ARRAY['metadata','field_provenance',lists.field]
        ) INTO v_contact_match;
      END IF;
      IF NOT v_contact_match AND (v_item IS DISTINCT FROM v_safe->v_key
        OR p_value#>ARRAY['field_provenance',v_key] IS DISTINCT FROM v_safe#>ARRAY['metadata','field_provenance',v_key]) THEN
        RAISE EXCEPTION 'venue_boundary_untrusted_envelope_fact' USING ERRCODE = '22023', DETAIL = v_key;
      END IF;
    END LOOP;
    RETURN;
  END IF;

  IF v_context THEN
    v_canonical := p_value->>'kind' = 'canonical_quote_booking' OR p_value->>'target_type' = 'discovery_venue'
      OR p_value#>>'{counterparty,target_type}' = 'discovery_venue'
      OR p_value#>>'{snapshot_json,counterparty,target_type}' = 'discovery_venue'
      OR p_value#>>'{payload_json,quote_kind}' = 'venue';
    IF v_id IS NOT NULL AND (v_canonical OR p_record_scope IN ('outreach_threads','approval','counterparty')) THEN
      SELECT to_jsonb(safe) INTO v_safe FROM public.discovery_venues_safe safe WHERE safe.id::TEXT = v_id;
      v_name := v_safe->>'name';
    END IF;
    -- Real signed records keep evidence in their action payload. Resolve it for
    -- sibling counterparty labels without modifying the signed object or hash.
    v_envelope := COALESCE(p_value->'venue_data',p_value#>'{payload_json,venue_data}',
      p_value#>'{action,payload_json,venue_data}',p_value#>'{snapshot_json,action,payload_json,venue_data}',v_envelope);
    IF v_envelope IS NOT NULL THEN
      IF v_envelope#>>'{identity,kind}' IS DISTINCT FROM 'venue' THEN
        RAISE EXCEPTION 'venue_boundary_invalid_envelope' USING ERRCODE = '22023';
      END IF;
      IF v_id IS NOT NULL AND v_envelope#>>'{identity,id}' IS DISTINCT FROM v_id THEN
        RAISE EXCEPTION 'venue_boundary_envelope_identity_mismatch' USING ERRCODE = '22023';
      END IF;
      PERFORM private.assert_venue_durable_json(v_envelope - 'derivation',true,v_id,p_depth+1);
      v_values := v_envelope->'values'; v_evidence := v_envelope->'field_provenance';
    END IF;
    v_derived := COALESCE(private.venue_boundary_provenance_valid(COALESCE(p_value->'venue_derivation',p_envelope->'derivation'))
      AND COALESCE(p_value#>>'{venue_derivation,source}',p_envelope#>>'{derivation,source}') = 'derived' AND v_envelope IS NOT NULL,false);
    IF v_derived THEN
      FOR v_parent IN SELECT value FROM jsonb_array_elements(COALESCE(p_value#>'{venue_derivation,lineage}',p_envelope#>'{derivation,lineage}')) LOOP
        IF v_parent->'provenance' IS DISTINCT FROM v_evidence->(v_parent->>'field') THEN
          RAISE EXCEPTION 'venue_boundary_untrusted_derivation_parent' USING ERRCODE = '22023';
        END IF;
      END LOOP;
    END IF;
    IF v_derived THEN v_envelope := v_envelope || jsonb_build_object('derivation',COALESCE(p_value->'venue_derivation',p_envelope->'derivation')); END IF;
    FOR v_key,v_item IN SELECT key,value FROM jsonb_each(p_value) LOOP
      IF v_item = 'null'::JSONB OR v_item = '[]'::JSONB OR v_item = '{}'::JSONB THEN CONTINUE; END IF;
      IF v_key IN ('googleLive','google_live','raw_data','rawData','places_response','google_places_response',
        'google_rating','google_user_ratings_total','google_photo_names','opening_hours_json','business_status',
        'formattedAddress','displayName','nationalPhoneNumber','websiteUri','primaryType','types','rating','userRatingCount',
        'googleMapsUri','attributions','businessStatus','priceLevel','location','reviews','photos','photo_urls','capacity_inference_source_quote') THEN
        RAISE EXCEPTION 'venue_boundary_provider_content' USING ERRCODE = '22023', DETAIL = v_key;
      END IF;
      v_field := CASE v_key WHEN 'venue_name' THEN 'name' WHEN 'external_name' THEN 'name'
        WHEN 'target_name' THEN 'name' WHEN 'display_name' THEN 'name' WHEN 'phone' THEN 'contact_phone'
        WHEN 'email' THEN 'contact_email' WHEN 'target_email' THEN 'contact_email' WHEN 'delivery_email' THEN 'contact_email'
        WHEN 'provider' THEN 'name' ELSE v_key END;
      -- These are typed host/operation fields, not discovery presentation. Keep
      -- provider/venue-node recursion below so this does not exempt nested data.
      IF v_key = 'neighborhood' AND p_record_scope IN ('plan','plans','plan_discovery_venue_candidates') THEN CONTINUE; END IF;
      IF v_key = 'state' AND (p_record_scope = 'outreach_threads' OR
        (p_value->>'source' = 'trusted_outreach_quote' AND p_value->>'quote_kind' = 'venue'
          AND v_item = '"canonical_quote_booking_approval_requested"'::JSONB)) THEN CONTINUE; END IF;
      IF v_field = 'name' AND v_item = '"Venue contact"'::jsonb THEN CONTINUE; END IF;
      IF (v_canonical OR p_record_scope IN ('approval','counterparty'))
        AND v_field = 'name' AND v_item = to_jsonb(v_name) AND v_name IS NOT NULL THEN CONTINUE; END IF;
      -- A thread stores no provenance JSON column. Its existing typed UUID must
      -- resolve to independently evidenced identity/contact in the safe reader.
      IF p_record_scope = 'outreach_threads' AND v_field = 'name'
        AND v_name IS NOT NULL AND v_item = to_jsonb(v_name) THEN CONTINUE; END IF;
      IF p_record_scope = 'outreach_threads' AND v_field = 'contact_email'
        AND (v_item = v_safe->'contact_email' OR EXISTS (
          SELECT 1 FROM jsonb_array_elements(COALESCE(v_safe->'extracted_emails','[]'::JSONB)
            || COALESCE(v_safe->'organizer_provided_emails','[]'::JSONB)) e WHERE e->'email' = v_item)) THEN CONTINUE; END IF;
      IF v_field IN ('name','address','neighborhood','city','state','contact_email','contact_phone','website',
        'instagram_handle','capacity_seated','capacity_standing','capacity_cocktail','inferred_capacity_seated',
        'inferred_capacity_standing','vibe_tags','alcohol_policy','av_available','parking_notes',
        'price_hint_cents_low','price_hint_cents_high','price_hint_note','lat','lng',
        'extracted_emails','extracted_contact_forms','organizer_provided_emails') THEN
        IF NOT COALESCE(private.venue_boundary_fact_valid(v_field,v_item),false)
          OR (v_values->v_field) IS DISTINCT FROM v_item
          OR NOT private.venue_boundary_provenance_valid(v_evidence->v_field) THEN
          RAISE EXCEPTION 'venue_boundary_unproven_venue_fact' USING ERRCODE = '22023', DETAIL = v_key;
        END IF;
        v_verified_fields := array_append(v_verified_fields,v_key);
      END IF;
      IF v_key IN ('reasoning','reason','fit_score','score','ranker_score') AND NOT v_derived THEN
        RAISE EXCEPTION 'venue_boundary_unproven_venue_derivative' USING ERRCODE = '22023', DETAIL = v_key;
      END IF;
    END LOOP;
  END IF;
  FOR v_key,v_item IN SELECT key,value FROM jsonb_each(p_value) LOOP
    -- Typed facts (including contact arrays) were checked atomically above.
    IF v_key = ANY(v_verified_fields) THEN CONTINUE; END IF;
    -- Commercial response/approval terms are independently received evidence;
    -- recurse for explicit provider structures but do not reinterpret their
    -- generic name/city fields as a discovery presentation object.
    PERFORM private.assert_venue_durable_json(v_item,
      CASE WHEN v_key IN ('quote_terms','requested_terms','conditions','raw_response_excerpt') THEN false
        ELSE v_context END,
      v_id,p_depth+1,v_envelope,v_key);
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION private.fence_venue_durable_sink()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $function$
DECLARE v_new JSONB := to_jsonb(NEW); v_old JSONB; v_checked JSONB := '{}'; v_key TEXT; v_value JSONB;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_old := to_jsonb(OLD);
    FOR v_key,v_value IN SELECT key,value FROM jsonb_each(v_new) LOOP
      IF v_value IS DISTINCT FROM v_old->v_key THEN v_checked := v_checked || jsonb_build_object(v_key,v_value); END IF;
    END LOOP;
    -- Unchanged historical columns stay in their original row until D. These
    -- identifiers add context only; no legacy payload is returned or copied.
    FOREACH v_key IN ARRAY ARRAY['discovery_venue_id','discoveryVenueId','target_type','target_id','quote_kind',
      'venue_id','reference_id','type','is_discovery','source','service_type'] LOOP
      IF v_new ? v_key THEN v_checked := v_checked || jsonb_build_object(v_key,v_new->v_key); END IF;
    END LOOP;
  ELSE v_checked := v_new; END IF;
  PERFORM private.assert_venue_durable_json(v_checked,false,NULL,0,NULL,TG_TABLE_NAME);
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.assert_venue_durable_json(JSONB,BOOLEAN,TEXT,INTEGER,JSONB,TEXT),private.fence_venue_durable_sink()
  FROM PUBLIC, anon, authenticated, service_role;

-- Preserve the existing one-year contact-retention policy behind the new role
-- boundary. This only defines the command; applying the migration purges nothing.
CREATE OR REPLACE FUNCTION public.redact_expired_discovery_venue_contacts(p_before TIMESTAMPTZ)
RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $function$
DECLARE v_count BIGINT;
BEGIN
  IF p_before IS NULL OR p_before > clock_timestamp() - INTERVAL '1 year' THEN
    RAISE EXCEPTION 'venue_retention_interval_too_short' USING ERRCODE = '22023';
  END IF;
  UPDATE public.discovery_venues SET contact_email=NULL,contact_phone=NULL,
    organizer_provided_emails='[]',extracted_emails='[]',
    metadata=CASE WHEN jsonb_typeof(metadata->'field_provenance')='object'
      THEN jsonb_set(metadata,'{field_provenance}',(metadata->'field_provenance')
        - ARRAY['contact_email','contact_phone','organizer_provided_emails','extracted_emails']) ELSE metadata END,
    website_extraction_metadata=jsonb_build_object('redacted_at',clock_timestamp(),'retention_policy','discovery_contact_data_1_year_unused')
  WHERE updated_at < p_before;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;
REVOKE ALL ON FUNCTION public.redact_expired_discovery_venue_contacts(TIMESTAMPTZ) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.redact_expired_discovery_venue_contacts(TIMESTAMPTZ) TO service_role;

-- Keep the existing stage procedure's consent/quote validation and locking.
-- The narrow privileged helper owns only the identity row lock; presentation is
-- read separately through the safe projection. No UPDATE privilege on IDs is granted.
CREATE OR REPLACE FUNCTION public.lock_discovery_venue_identity(p_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $function$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.discovery_venues WHERE id=p_id FOR KEY SHARE;
  RETURN v_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.lock_discovery_venue_identity(UUID) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.lock_discovery_venue_identity(UUID) TO service_role;
