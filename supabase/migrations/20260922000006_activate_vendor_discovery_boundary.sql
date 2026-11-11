-- C2 ACTIVATE (ledger 161). Apply this file AND its ledger row in one caller-owned
-- transaction: psql --single-transaction -v ON_ERROR_STOP=1. Never toggle the
-- release control here. A populated database requires the reviewed write-pause
-- window; empty, READ COMMITTED bootstrap/reset replay is supported.
-- Existing C1 enforcement is preserved. Exactly fifteen existing attachments
-- gain vendor validation, and vendor_bookings gains the only new attachment.
-- No historical rows are rewritten. No recursive/row helper catches exceptions.

DO $require_vendor_boundary_write_pause$
DECLARE
  v_state TEXT; v_enabled BOOLEAN; v_table TEXT; v_has_rows BOOLEAN;
  v_tables CONSTANT TEXT[] := ARRAY[
    'admin_audit_log','admin_tasks','agent_actions','agent_runs','approvals','audit_logs',
    'discovery_change_log','discovery_vendors','outreach_messages','outreach_threads',
    'plan_messages','plan_revisions','plan_versions','plans','recommendations','templates','vendor_bookings'
  ];
BEGIN
  SELECT state,enabled INTO v_state,v_enabled FROM public.release_runtime_controls
    WHERE control_key='write_pause' FOR SHARE;
  IF FOUND AND v_state='paused' AND v_enabled IS TRUE THEN RETURN; END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'vendor_boundary_empty_replay_requires_read_committed' USING ERRCODE='25001';
  END IF;
  -- Lock ALL affected tables before checking ANY rows. An insert cannot race the
  -- empty-replay decision; a committed pre-lock writer is visible to EXISTS.
  FOREACH v_table IN ARRAY v_tables LOOP
    EXECUTE format('LOCK TABLE public.%I IN SHARE ROW EXCLUSIVE MODE',v_table);
  END LOOP;
  FOREACH v_table IN ARRAY v_tables LOOP
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I)',v_table) INTO v_has_rows;
    IF v_has_rows THEN
      RAISE EXCEPTION 'vendor_boundary_activation_requires_write_pause' USING ERRCODE='55000',DETAIL=v_table;
    END IF;
  END LOOP;
END;
$require_vendor_boundary_write_pause$;

-- SET ROLE survives entry into a DEFINER. current_user does not: it becomes the
-- function owner, and therefore must NEVER establish importer authority. A
-- native superuser maintenance session is also trusted, but SET ROLE authenticated
-- on that same connection is not. No caller-set JWT/GUC marker grants authority.
CREATE OR REPLACE FUNCTION private.vendor_boundary_service_request()
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=pg_catalog AS $function$
  SELECT current_setting('role',true)='service_role'
    OR (current_setting('role',true) IN ('none',session_user::TEXT)
      AND EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=session_user AND rolsuper));
$function$;

-- This is partner-reported history, NOT a database before-image or a provenance
-- upgrade. Scalar null transitions and service-area strings are intentionally
-- allowed without claiming a corresponding safe-row source fact. Facts themselves
-- can still be changed only through the independently validating source RPC.
CREATE OR REPLACE FUNCTION private.vendor_boundary_history_valid(p_value JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $function$
DECLARE v_evidence JSONB; v_key TEXT; v_item JSONB; v_expected TEXT;
BEGIN
  IF NOT private.vendor_boundary_service_request()
    OR p_value->>'entity_type' IS DISTINCT FROM 'discovery_vendor'
    OR COALESCE(p_value->>'entity_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR NOT EXISTS(SELECT 1 FROM public.discovery_vendors WHERE id::TEXT=p_value->>'entity_id')
    OR jsonb_typeof(p_value->'source_evidence') IS DISTINCT FROM 'string'
    OR length(p_value->>'source_evidence') > 16384
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_value) k WHERE k NOT IN
      ('entity_type','entity_id','source','field_name','old_value','new_value','confidence','source_evidence',
       'applied','applied_at','id','created_at','actor_id','cascade_impact','review_notes','reviewed_by'))
  THEN RETURN false; END IF;
  -- Invalid JSON fails closed. This is one typed history value, not an opaque
  -- recursive parse loop or a per-node exception/subtransaction.
  v_evidence := (p_value->>'source_evidence')::JSONB;
  IF jsonb_typeof(v_evidence) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  IF p_value->>'source'='stripe_account_event' THEN
    RETURN private.venue_boundary_stripe_history_valid(
      jsonb_set(p_value,'{entity_type}','"discovery_venue"'::JSONB));
  END IF;
  FOREACH v_key IN ARRAY ARRAY['cascade_impact','review_notes','reviewed_by'] LOOP
    IF p_value ? v_key AND p_value->v_key <> 'null'::JSONB THEN RETURN false; END IF;
  END LOOP;
  IF p_value->>'source'='vendor_self_update' THEN
    IF v_evidence->>'route' IS DISTINCT FROM '/vendor/services'
      OR NOT v_evidence ?& ARRAY['route','vendor_profile_id','updated_by_user_id']
      OR EXISTS(SELECT 1 FROM jsonb_object_keys(v_evidence) k WHERE k NOT IN ('route','vendor_profile_id','updated_by_user_id'))
      OR v_evidence->>'updated_by_user_id' IS DISTINCT FROM p_value->>'actor_id'
      OR NOT EXISTS(SELECT 1 FROM public.vendor_profiles profile
        WHERE profile.id::TEXT=v_evidence->>'vendor_profile_id'
          AND profile.discovery_vendor_id::TEXT=p_value->>'entity_id'
          AND profile.user_id::TEXT=p_value->>'actor_id')
      OR p_value->>'field_name' NOT IN ('name','service_type','service_area','regions_served','base_rate','contact_email')
      OR p_value->'confidence' IS DISTINCT FROM '1'::JSONB
      OR p_value->'applied' IS DISTINCT FROM 'true'::JSONB
      OR COALESCE(p_value->>'applied_at','') !~ '^\d{4}-\d{2}-\d{2}T'
    THEN RETURN false; END IF;
    FOREACH v_key IN ARRAY ARRAY['old_value','new_value'] LOOP
      v_item:=p_value->v_key;
      IF v_item IS NULL THEN RETURN false; END IF;
      IF v_item='null'::JSONB THEN CONTINUE; END IF;
      IF p_value->>'field_name'='base_rate' THEN
        IF NOT COALESCE(private.vendor_boundary_fact_valid('inferred_package_rate_cents',v_item),false) THEN RETURN false; END IF;
      ELSIF jsonb_typeof(v_item) IS DISTINCT FROM 'string' OR length(v_item #>> '{}')>8192 THEN RETURN false;
      END IF;
    END LOOP;
    RETURN true;
  ELSIF p_value->>'source'='organizer_report' THEN
    v_expected:=CASE v_evidence->>'category' WHEN 'closed' THEN 'business_status'
      WHEN 'wrong_address' THEN 'formatted_address' WHEN 'wrong_contact' THEN 'contact_email'
      WHEN 'wrong_capacity' THEN 'capacity' WHEN 'rates_outdated' THEN 'rate' WHEN 'other' THEN 'general' END;
    RETURN v_expected IS NOT NULL AND p_value->>'field_name'=v_expected
      AND v_evidence ?& ARRAY['category','details','reporter_user_id','plan_id']
      AND NOT EXISTS(SELECT 1 FROM jsonb_object_keys(v_evidence) k WHERE k NOT IN ('category','details','reporter_user_id','plan_id'))
      AND jsonb_typeof(v_evidence->'details')='string' AND length(v_evidence->>'details') BETWEEN 1 AND 8192
      AND v_evidence->>'reporter_user_id'=p_value->>'actor_id'
      AND EXISTS(SELECT 1 FROM public.plans WHERE id::TEXT=v_evidence->>'plan_id' AND user_id::TEXT=p_value->>'actor_id')
      AND p_value->'old_value'='null'::JSONB
      AND p_value->'new_value'=jsonb_build_object('category',v_evidence->'category','details',v_evidence->'details')
      AND p_value->'confidence'='0.3'::JSONB AND p_value->'applied'='false'::JSONB AND p_value->'applied_at'='null'::JSONB;
  END IF;
  RETURN false;
END;
$function$;

CREATE OR REPLACE FUNCTION private.assert_vendor_durable_json(
  p_value JSONB, p_vendor_context BOOLEAN DEFAULT false, p_vendor_id TEXT DEFAULT NULL, p_depth INTEGER DEFAULT 0,
  p_envelope JSONB DEFAULT NULL, p_record_scope TEXT DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $function$
DECLARE
  v_key TEXT; v_item JSONB; v_context BOOLEAN:=COALESCE(p_vendor_context,false); v_id TEXT:=p_vendor_id;
  v_envelope JSONB:=p_envelope; v_values JSONB:=p_envelope->'values'; v_evidence JSONB:=p_envelope->'field_provenance';
  v_safe JSONB; v_lookup TEXT; v_place_id TEXT; v_field TEXT; v_parent JSONB; v_derivation JSONB; v_local_envelope JSONB;
  v_contact_match BOOLEAN; v_derived BOOLEAN:=false; v_signed BOOLEAN:=false; v_signed_member BOOLEAN:=false;
  v_verified_fields TEXT[]:='{}'; v_scope TEXT; v_child_context BOOLEAN; v_child_envelope JSONB;
BEGIN
  IF p_depth>64 THEN RAISE EXCEPTION 'vendor_boundary_payload_depth' USING ERRCODE='22023'; END IF;
  IF p_value IS NULL OR p_value='null'::JSONB THEN RETURN; END IF;
  -- A trigger may supply its same-row envelope to bind a changed alias. Verify
  -- it once on entry; recursive descendants receive only this verified value.
  IF p_depth=0 AND p_envelope IS NOT NULL THEN
    PERFORM private.assert_vendor_durable_json(p_envelope,true,p_vendor_id,1,NULL,NULL);
  END IF;
  IF jsonb_typeof(p_value)='array' THEN
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_value) LOOP
      PERFORM private.assert_vendor_durable_json(v_item,v_context,v_id,p_depth+1,v_envelope,p_record_scope);
    END LOOP;
    RETURN;
  END IF;
  IF jsonb_typeof(p_value)<>'object' THEN
    IF v_context AND p_record_scope IN ('snapshot','snapshot_json','approved_terms_snapshot','metadata','payload_json',
      'input','output','input_json','output_json','request_json','result_json','input_payload','output_payload',
      'messages_payload','raw_model_output','before_state','after_state')
      AND jsonb_typeof(p_value)='string' AND p_value #>> '{}' ~ '^[[:space:]]*[\[{]' THEN
      RAISE EXCEPTION 'vendor_boundary_opaque_serialized_payload' USING ERRCODE='22023';
    END IF;
    RETURN;
  END IF;
  IF p_value ?| ARRAY['googleLive','google_live','google_live_overlays','vendor_google_overlay'] THEN
    RAISE EXCEPTION 'vendor_boundary_live_overlay' USING ERRCODE='22023';
  END IF;
  IF p_value->>'entity_type'='discovery_vendor' AND p_value ? 'field_name' THEN
    IF p_depth<>0 OR p_record_scope IS DISTINCT FROM 'discovery_change_log'
      OR NOT COALESCE(private.vendor_boundary_history_valid(p_value),false) THEN
      RAISE EXCEPTION 'vendor_boundary_unresolved_history' USING ERRCODE='22023';
    END IF;
    PERFORM private.assert_vendor_durable_json((p_value->>'source_evidence')::JSONB,false,NULL,p_depth+1);
    RETURN;
  END IF;
  -- An explicit venue identity is validated by C1 instead. A bare kind label
  -- cannot clear inherited vendor context and smuggle unproven facts. Native
  -- catalog siblings already start without an inherited vendor context.
  IF p_value#>>'{identity,kind}'='venue' OR p_value->>'target_type'='discovery_venue' THEN
    v_context:=false; v_id:=NULL; v_envelope:=NULL; v_values:=NULL; v_evidence:=NULL;
  END IF;
  v_lookup:=CASE WHEN p_value->>'type'='vendor' THEN p_value->>'reference_id' END;
  IF v_lookup ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND EXISTS(SELECT 1 FROM public.discovery_vendors WHERE id::TEXT=v_lookup) THEN v_context:=true; v_id:=v_lookup; END IF;
  v_context:=COALESCE(v_context OR p_value#>>'{identity,kind}'='vendor'
    OR p_value->>'entity_type'='discovery_vendor' OR p_value->>'target_type'='discovery_vendor'
    OR NULLIF(p_value->>'discovery_vendor_id','') IS NOT NULL OR NULLIF(p_value->>'discoveryVendorId','') IS NOT NULL
    OR (p_value->>'source'='discovery' AND (p_value->>'kind'='vendor' OR p_value->>'type'='vendor'))
    OR p_value ? 'vendor_data' OR p_value#>'{metadata,vendor_data}' IS NOT NULL
    OR p_value#>'{payload_json,vendor_data}' IS NOT NULL OR p_value#>'{channel_strategy,vendor_data}' IS NOT NULL
    OR p_value#>>'{counterparty,target_type}'='discovery_vendor'
    OR p_value#>>'{snapshot_json,counterparty,target_type}'='discovery_vendor',false);
  v_id:=COALESCE(NULLIF(p_value->>'discovery_vendor_id',''),NULLIF(p_value->>'discoveryVendorId',''),
    CASE WHEN p_value->>'target_type'='discovery_vendor' THEN p_value->>'target_id' END,
    CASE WHEN p_value#>>'{identity,kind}'='vendor' THEN p_value#>>'{identity,id}' END,
    CASE WHEN p_value#>>'{counterparty,target_type}'='discovery_vendor' THEN p_value#>>'{counterparty,target_id}' END,
    CASE WHEN p_value#>>'{snapshot_json,counterparty,target_type}'='discovery_vendor' THEN p_value#>>'{snapshot_json,counterparty,target_id}' END,
    CASE WHEN p_value#>>'{payload_json,target_type}'='discovery_vendor' THEN p_value#>>'{payload_json,target_id}' END,v_id);
  IF v_context THEN
    FOREACH v_key IN ARRAY ARRAY['discovery_vendor_id','discoveryVendorId'] LOOP
      IF NULLIF(p_value->>v_key,'') IS NOT NULL AND p_value->>v_key IS DISTINCT FROM v_id THEN
        RAISE EXCEPTION 'vendor_boundary_envelope_identity_mismatch' USING ERRCODE='22023';
      END IF;
    END LOOP;
    IF p_value->>'target_type'='discovery_vendor' AND p_value->>'target_id' IS DISTINCT FROM v_id THEN
      RAISE EXCEPTION 'vendor_boundary_envelope_identity_mismatch' USING ERRCODE='22023';
    END IF;
  END IF;
  IF p_value#>>'{identity,kind}'='vendor' THEN
    IF p_value->'schema_version' IS DISTINCT FROM '1'::JSONB
      OR jsonb_typeof(p_value->'identity') IS DISTINCT FROM 'object'
      OR jsonb_typeof(p_value->'values') IS DISTINCT FROM 'object'
      OR jsonb_typeof(p_value->'field_provenance') IS DISTINCT FROM 'object'
      OR COALESCE(v_id,'') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_value) k WHERE k NOT IN ('schema_version','identity','values','field_provenance'))
      OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_value->'identity') k WHERE k NOT IN ('kind','id','place_id'))
      OR NOT (p_value->'identity') ? 'place_id'
      OR (p_value#>'{identity,place_id}'<>'null'::JSONB AND (jsonb_typeof(p_value#>'{identity,place_id}')<>'string'
        OR p_value#>>'{identity,place_id}' !~ '^(places/)?[A-Za-z0-9_-]{1,255}$'))
      OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_value->'field_provenance') k WHERE NOT (p_value->'values') ? k)
    THEN RAISE EXCEPTION 'vendor_boundary_invalid_envelope' USING ERRCODE='22023'; END IF;
    SELECT to_jsonb(safe) INTO v_safe FROM public.discovery_vendors_safe safe WHERE safe.id::TEXT=v_id;
    v_place_id:=CASE WHEN v_safe->>'source'='google_places' THEN
      COALESCE(v_safe->>'google_place_id',regexp_replace(v_safe->>'source_external_id','^places/','')) ELSE NULL END;
    IF v_safe IS NULL OR NULLIF(regexp_replace(p_value#>>'{identity,place_id}','^places/',''),'') IS DISTINCT FROM v_place_id THEN
      RAISE EXCEPTION 'vendor_boundary_envelope_identity_mismatch' USING ERRCODE='22023';
    END IF;
    FOR v_key,v_item IN SELECT key,value FROM jsonb_each(p_value->'values') LOOP
      IF NOT COALESCE(private.vendor_boundary_fact_valid(v_key,v_item),false)
        OR NOT private.venue_boundary_provenance_valid(p_value#>ARRAY['field_provenance',v_key]) THEN
        RAISE EXCEPTION 'vendor_boundary_unproven_envelope_fact' USING ERRCODE='22023',DETAIL=v_key;
      END IF;
      v_contact_match:=false;
      IF v_key='contact_email' THEN
        v_contact_match:=COALESCE(v_item=v_safe->'organizer_provided_email'
          AND p_value#>ARRAY['field_provenance',v_key]=v_safe#>'{field_provenance,organizer_provided_email}',false)
          OR EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_safe->'extracted_emails','[]'::JSONB)) contact
            WHERE contact->'email'=v_item AND p_value#>ARRAY['field_provenance',v_key]=v_safe#>'{field_provenance,extracted_emails}');
      END IF;
      IF NOT v_contact_match AND (v_item IS DISTINCT FROM v_safe->v_key
        OR p_value#>ARRAY['field_provenance',v_key] IS DISTINCT FROM v_safe#>ARRAY['field_provenance',v_key]) THEN
        RAISE EXCEPTION 'vendor_boundary_untrusted_envelope_fact' USING ERRCODE='22023',DETAIL=v_key;
      END IF;
    END LOOP;
    RETURN;
  END IF;
  v_signed:=(p_value ? 'snapshot_json' AND p_value ?| ARRAY['snapshot_hash','snapshot_schema_version'])
    OR (p_value->'schema_version'='2'::JSONB AND p_value ?& ARRAY['approval','action','plan']);
  v_signed:=COALESCE(v_signed,false);
  -- Internal scope markers are generated only on actual signed edges below.
  v_signed_member:=p_record_scope IN ('vendor_signed_approval','vendor_signed_counterparty','vendor_signed_action');
  IF v_context THEN
    v_local_envelope:=COALESCE(p_value->'vendor_data',p_value#>'{metadata,vendor_data}',p_value#>'{payload_json,vendor_data}',
      p_value#>'{channel_strategy,vendor_data}',CASE WHEN v_signed THEN COALESCE(p_value#>'{action,payload_json,vendor_data}',
        p_value#>'{snapshot_json,action,payload_json,vendor_data}') END);
    v_envelope:=COALESCE(v_local_envelope,v_envelope);
    IF v_envelope IS NOT NULL THEN
      IF v_envelope#>>'{identity,kind}' IS DISTINCT FROM 'vendor' THEN
        RAISE EXCEPTION 'vendor_boundary_invalid_envelope' USING ERRCODE='22023';
      END IF;
      IF v_id IS NOT NULL AND v_envelope#>>'{identity,id}' IS DISTINCT FROM v_id THEN
        RAISE EXCEPTION 'vendor_boundary_envelope_identity_mismatch' USING ERRCODE='22023';
      END IF;
      -- No per-node source SELECT. A different locally introduced envelope must
      -- be verified; an inherited exact envelope was already bound to the source.
      IF v_local_envelope IS NOT NULL AND v_local_envelope IS DISTINCT FROM p_envelope THEN
        PERFORM private.assert_vendor_durable_json(v_local_envelope,true,v_id,p_depth+1);
      END IF;
      v_id:=COALESCE(v_id,v_envelope#>>'{identity,id}'); v_values:=v_envelope->'values'; v_evidence:=v_envelope->'field_provenance';
      IF p_value ? 'source_external_id' AND v_envelope#>'{identity,place_id}'<>'null'::JSONB
        AND regexp_replace(p_value->>'source_external_id','^places/','') IS DISTINCT FROM regexp_replace(v_envelope#>>'{identity,place_id}','^places/','') THEN
        RAISE EXCEPTION 'vendor_boundary_envelope_identity_mismatch' USING ERRCODE='22023';
      END IF;
    END IF;
    IF p_record_scope='outreach_threads' AND v_id IS NOT NULL THEN
      SELECT to_jsonb(safe) INTO v_safe FROM public.discovery_vendors_safe safe WHERE safe.id::TEXT=v_id;
    END IF;
    v_derivation:=COALESCE(p_value->'vendor_derivation',p_value#>'{metadata,vendor_derivation}');
    v_derived:=COALESCE(private.venue_boundary_provenance_valid(v_derivation)
      AND v_derivation->>'source'='derived' AND v_envelope IS NOT NULL,false);
    IF v_derived THEN
      FOR v_parent IN SELECT value FROM jsonb_array_elements(v_derivation->'lineage') LOOP
        IF v_parent->'provenance' IS DISTINCT FROM v_evidence->(v_parent->>'field') THEN
          RAISE EXCEPTION 'vendor_boundary_untrusted_derivation_parent' USING ERRCODE='22023';
        END IF;
      END LOOP;
    END IF;
    FOR v_key,v_item IN SELECT key,value FROM jsonb_each(p_value) LOOP
      IF v_item IN ('null'::JSONB,'""'::JSONB) THEN CONTINUE; END IF;
      IF v_item='[]'::JSONB AND v_key IN ('photos','place_types','extracted_emails','extracted_contact_forms','pros','cons') THEN CONTINUE; END IF;
      IF v_signed_member AND v_key NOT IN ('provider','display_name','name','target_name','delivery_email','action_label') THEN CONTINUE; END IF;
      -- Canonical staging copies the partner's received excerpt into both the
      -- physical approval and its signed terms/card. Bind the initial row to
      -- the owned response; later copies must also match the saved approval.
      -- A notes key elsewhere is still a discovery derivative.
      IF v_key='notes' AND v_signed
        AND ((p_depth=0 AND p_record_scope='approvals')
          OR EXISTS(SELECT 1 FROM public.approvals approval
            WHERE approval.id::TEXT=p_value->>'id'
              AND approval.plan_id::TEXT=p_value->>'plan_id'
              AND to_jsonb(approval.agent_action_id)=p_value->'agent_action_id'
              AND approval.snapshot_hash=p_value->>'snapshot_hash'
              AND approval.snapshot_json=p_value->'snapshot_json'
              AND to_jsonb(approval.notes)=v_item))
        AND jsonb_typeof(v_item)='string'
        AND v_item=p_value#>'{snapshot_json,approval,notes}'
        AND p_value#>>'{snapshot_json,action,payload_json,kind}'='canonical_quote_booking'
        AND p_value#>>'{snapshot_json,action,payload_json,quote_kind}'='vendor'
        AND EXISTS(SELECT 1 FROM public.vendor_outreach_responses response
          WHERE response.id::TEXT=p_value#>>'{snapshot_json,action,payload_json,quote_response_id}'
            AND response.plan_id::TEXT=p_value->>'plan_id'
            AND response.discovery_vendor_id::TEXT=v_id
            AND to_jsonb(response.raw_response_excerpt)=v_item)
      THEN CONTINUE; END IF;
      -- Only the physical task's root notes column is internal operator input.
      -- A nested notes/reason inside metadata or a vendor fact stays strict.
      IF p_depth=0 AND p_record_scope='admin_tasks' AND v_key='notes' THEN
        IF jsonb_typeof(v_item) IS DISTINCT FROM 'string' THEN
          RAISE EXCEPTION 'vendor_boundary_invalid_operator_notes' USING ERRCODE='22023';
        END IF;
        CONTINUE;
      END IF;
      IF v_key IN ('raw_data','rawData','places_response','google_places_response','google_rating','google_user_rating_count',
        'google_user_ratings_total','google_price_level','google_primary_type','google_photo_names','business_status','place_types',
        'displayName','formattedAddress','websiteUri','nationalPhoneNumber','userRatingCount','primaryType','googleMapsUri',
        'attributions','businessStatus','priceLevel','location','reviews','photos','photo_urls','rating','review_count') THEN
        RAISE EXCEPTION 'vendor_boundary_provider_content' USING ERRCODE='22023',DETAIL=v_key;
      END IF;
      v_field:=CASE WHEN v_key IN ('vendor_name','target_name','display_name','external_name','provider') THEN 'name'
        WHEN v_key IN ('email','target_email','delivery_email') THEN 'contact_email'
        WHEN v_key IN ('contact_phone','target_phone') THEN 'phone' WHEN v_key='address' THEN 'formatted_address' ELSE v_key END;
      IF v_key='state' AND ((p_value->>'channel'='email' AND v_item #>> '{}' IN
        ('draft','awaiting_reply','in_negotiation','confirmed','declined','stale','cancelled','awaiting_creator_review'))
        OR (p_value->>'source'='trusted_outreach_quote' AND p_value->>'quote_kind'='vendor'
          AND v_item='"canonical_quote_booking_approval_requested"'::JSONB)) THEN CONTINUE; END IF;
      IF v_key='description' AND p_value->>'action_type'='concierge_queue'
        AND p_value#>>'{payload_json,kind}'='canonical_quote_booking'
        AND v_item='"Prepare booking from accepted vendor quote"'::JSONB THEN CONTINUE; END IF;
      IF v_key IN ('name','target_name','provider') AND v_item='"Vendor contact"'::JSONB THEN CONTINUE; END IF;
      IF p_record_scope='outreach_threads' AND ((v_field='name' AND v_item=v_safe->'name')
        OR (v_field='phone' AND v_item=v_safe->'phone')
        OR (v_field='contact_email' AND (v_item=v_safe->'contact_email' OR v_item=v_safe->'organizer_provided_email'
          OR EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_safe->'extracted_emails','[]'::JSONB)) e WHERE e->'email'=v_item))))
      THEN v_verified_fields:=array_append(v_verified_fields,v_key); CONTINUE; END IF;
      IF v_key='action_label' AND v_envelope IS NOT NULL
        AND v_item IS DISTINCT FROM to_jsonb('Approve booking request with ' || (v_values->>'name')) THEN
        RAISE EXCEPTION 'vendor_boundary_unproven_vendor_fact' USING ERRCODE='22023',DETAIL=v_key;
      END IF;
      IF v_field IN ('name','service_type','formatted_address','city','state','website','phone','contact_email',
        'organizer_provided_email','extracted_emails','extracted_contact_forms','inferred_hourly_rate_cents',
        'inferred_package_rate_cents','inferred_minimum_cents') THEN
        IF NOT COALESCE(private.vendor_boundary_fact_valid(v_field,v_item),false)
          OR v_values->v_field IS DISTINCT FROM v_item OR NOT private.venue_boundary_provenance_valid(v_evidence->v_field) THEN
          RAISE EXCEPTION 'vendor_boundary_unproven_vendor_fact' USING ERRCODE='22023',DETAIL=v_key;
        END IF;
        v_verified_fields:=array_append(v_verified_fields,v_key);
      END IF;
      IF v_key='reason' AND (
        (p_record_scope='agent_actions.result_metadata.canonical_quote_reapproval' AND p_depth=2
          AND p_value ?& ARRAY['approval_id','snapshot_hash','reason','required_at']
          AND NOT EXISTS(SELECT 1 FROM jsonb_object_keys(p_value) k WHERE k NOT IN ('approval_id','snapshot_hash','reason','required_at'))
          AND p_value->>'approval_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          AND p_value->>'snapshot_hash' ~ '^[0-9a-f]{64}$' AND p_value->>'required_at' ~ '^\d{4}-\d{2}-\d{2}T'
          AND v_item IN ('"approval_expired"'::JSONB,'"approval_stale"'::JSONB))
        OR (p_record_scope='agent_actions.result_metadata.canonical_booking_decline' AND p_depth=2
          AND p_value ?& ARRAY['booking_id','booking_kind','approval_id','approval_snapshot_hash','declined_by','declined_at','reason','context']
          AND NOT EXISTS(SELECT 1 FROM jsonb_object_keys(p_value) k WHERE k NOT IN
            ('booking_id','booking_kind','approval_id','approval_snapshot_hash','declined_by','declined_at','reason','context'))
          AND p_value->>'booking_kind'='vendor'
          AND p_value->>'booking_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          AND p_value->>'approval_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          AND p_value->>'declined_by' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          AND p_value->>'approval_snapshot_hash' ~ '^[0-9a-f]{64}$' AND p_value->>'declined_at' ~ '^\d{4}-\d{2}-\d{2}T'
          AND jsonb_typeof(p_value->'context')='object' AND jsonb_typeof(v_item)='string' AND length(btrim(v_item #>> '{}')) BETWEEN 1 AND 1000)
      ) THEN CONTINUE; END IF;
      IF v_key IN ('reason','reasoning','fit_score','match_score','score','ranker_score','notes','description','pros','cons') AND NOT v_derived THEN
        RAISE EXCEPTION 'vendor_boundary_unproven_vendor_derivative' USING ERRCODE='22023',DETAIL=v_key;
      END IF;
    END LOOP;
  END IF;
  FOR v_key,v_item IN SELECT key,value FROM jsonb_each(p_value) LOOP
    IF v_key=ANY(v_verified_fields) THEN CONTINUE; END IF;
    IF v_key='vendor_data' AND v_item=v_envelope THEN CONTINUE; END IF;
    v_scope:=v_key;
    v_child_context:=v_context; v_child_envelope:=v_envelope;
    IF v_key IN ('vendor_data','vendor_derivation','field_provenance','quote_terms','quoted_terms','requested_terms','plan','consent','conditions','raw_response_excerpt')
      -- Outcome prose is separate only at the actual concierge record positions.
      -- An arbitrary outcome-named object inside vendor facts keeps its context.
      OR (p_depth=0 AND p_record_scope='admin_tasks' AND v_key='outcome_payload')
      OR (p_depth=1 AND p_record_scope='agent_actions.result_metadata' AND v_key='admin_task_outcome') THEN
      v_child_context:=false; v_child_envelope:=NULL;
    END IF;
    IF v_signed AND v_key IN ('approval','counterparty','action') THEN v_scope:='vendor_signed_' || v_key;
    ELSIF v_key IN ('vendor_signed_approval','vendor_signed_counterparty','vendor_signed_action') THEN v_scope:=NULL;
    ELSIF p_depth=0 AND p_record_scope='agent_actions' AND v_key='result_metadata' AND jsonb_typeof(v_item)='object' THEN
      v_scope:='agent_actions.result_metadata';
    ELSIF p_depth=1 AND p_record_scope='agent_actions.result_metadata' AND v_key IN ('canonical_quote_reapproval','canonical_booking_decline')
      AND jsonb_typeof(v_item)='object' THEN v_scope:=p_record_scope || '.' || v_key;
    ELSIF v_key IN ('agent_actions.result_metadata','agent_actions.result_metadata.canonical_quote_reapproval','agent_actions.result_metadata.canonical_booking_decline') THEN v_scope:=NULL;
    END IF;
    PERFORM private.assert_vendor_durable_json(v_item,v_child_context,v_id,p_depth+1,v_child_envelope,v_scope);
  END LOOP;
END;
$function$;

-- Existing native-catalog vendor_contact drafts carry a linked discovery UUID
-- but acquire their name/contact from the independent vendor_profiles row. This
-- exact owned/approved path is not a Places source or a general marker exemption.
CREATE OR REPLACE FUNCTION private.vendor_boundary_profile_thread_valid(p_row JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $function$
BEGIN
  RETURN private.vendor_boundary_service_request()
    AND p_row->>'target_type'='vendor' AND p_row->>'channel'='email'
    AND p_row->'channel_strategy'='{"source":"approved_vendor_contact","approval_required_for_send":true}'::JSONB
    AND EXISTS(SELECT 1 FROM public.vendor_profiles profile
      JOIN public.plans plan ON plan.id::TEXT=p_row->>'plan_id' AND plan.user_id::TEXT=p_row->>'user_id'
      JOIN public.agent_actions action ON action.id::TEXT=p_row->>'source_agent_action_id'
        AND action.plan_id=plan.id AND action.target_id=profile.id AND action.action_type='vendor_contact'
      JOIN public.approvals approval ON approval.id=action.approval_id AND approval.agent_action_id=action.id
        AND approval.plan_id=plan.id AND approval.status IN ('authorized','approved')
        AND COALESCE(approval.authorized_by,approval.approved_by)=plan.user_id
      WHERE profile.id::TEXT=p_row->>'target_id' AND profile.discovery_vendor_id::TEXT=p_row->>'discovery_vendor_id'
        AND profile.name=p_row->>'target_name' AND lower(btrim(profile.contact_email))=p_row->>'target_email'
        AND action.status IN ('approved','executing','complete')
        AND COALESCE(action.payload_json->>'kind','')<>'vendor_reply_capture');
END;
$function$;

-- FK-based message mapping; a bare thread UUID is not visible to recursive JSON
-- inspection. The four message contracts below are deliberately distinct.
CREATE OR REPLACE FUNCTION private.assert_vendor_outreach_message(p_new JSONB,p_old JSONB,p_changed JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $function$
DECLARE
  v_thread JSONB; v_action JSONB; v_approval JSONB; v_target JSONB; v_revision JSONB;
  v_payload JSONB; v_body TEXT; v_html TEXT; v_sender TEXT; v_profile JSONB; v_plan JSONB;
  v_message_keys CONSTANT TEXT[]:=ARRAY['thread_id','agent_action_id','approval_id','direction','subject','body_text','body_html',
    'headers_json','provider_metadata_json','attachments_json','transcript_text'];
BEGIN
  SELECT to_jsonb(thread) INTO v_thread FROM public.outreach_threads thread WHERE thread.id::TEXT=p_new->>'thread_id';
  IF v_thread->>'discovery_vendor_id' IS NULL THEN
    PERFORM private.assert_vendor_durable_json(p_changed,false,NULL,0,NULL,'outreach_messages'); RETURN;
  END IF;
  -- Delivery timestamps/status/classification changes must not re-copy/revalidate
  -- untouched legacy correspondence. Explicit structured vendor content still runs.
  IF p_old IS NOT NULL AND NOT p_changed ?| v_message_keys THEN
    PERFORM private.assert_vendor_durable_json(p_changed,false,NULL,0,NULL,'outreach_messages'); RETURN;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.plans plan WHERE plan.id::TEXT=v_thread->>'plan_id' AND plan.user_id::TEXT=v_thread->>'user_id') THEN
    RAISE EXCEPTION 'vendor_boundary_message_thread_owner_mismatch' USING ERRCODE='23514';
  END IF;
  -- Retention clears, never replaces, rich content; only the trusted cleanup path.
  IF p_old IS NOT NULL AND private.vendor_boundary_service_request()
    AND p_new->>'subject'='[redacted by 3rdPlace data retention policy]'
    AND p_new->>'body_text'='[redacted by 3rdPlace data retention policy]'
    AND p_new->'body_html'='null'::JSONB AND p_new->'transcript_text'='null'::JSONB
    AND p_new->'headers_json'='{}'::JSONB AND p_new->'provider_metadata_json'='{}'::JSONB AND p_new->'attachments_json'='[]'::JSONB
    AND NOT EXISTS(SELECT 1 FROM jsonb_object_keys(p_changed) k WHERE k NOT IN
      ('subject','body_text','body_html','transcript_text','headers_json','provider_metadata_json','attachments_json','updated_at'))
  THEN RETURN; END IF;
  -- A plan-revision marker records an operational event; it is not an email send.
  IF p_new#>>'{headers_json,system_event}'='plan_revision_superseded' THEN
    SELECT to_jsonb(revision) INTO v_revision FROM public.plan_revisions revision
      WHERE revision.id::TEXT=p_new#>>'{headers_json,revision_id}' AND revision.plan_id::TEXT=v_thread->>'plan_id';
    IF v_revision IS NULL OR p_new->>'direction' IS DISTINCT FROM 'outbound'
      OR p_new->>'subject' IS DISTINCT FROM 'Plan update superseded this outreach'
      OR NOT (private.vendor_boundary_service_request() OR v_thread->>'user_id'=auth.uid()::TEXT)
      OR NOT (p_new->'headers_json') ?& ARRAY['system_event','revision_id','superseded_at']
      OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_new->'headers_json') k WHERE k NOT IN ('system_event','revision_id','superseded_at'))
      OR COALESCE(p_new#>>'{headers_json,superseded_at}','') !~ '^\d{4}-\d{2}-\d{2}T'
      OR p_new->'agent_action_id'<>'null'::JSONB OR p_new->'approval_id'<>'null'::JSONB
      OR COALESCE(p_new->'provider_metadata_json','{}'::JSONB)<>'{}'::JSONB
      OR COALESCE(p_new->'attachments_json','[]'::JSONB)<>'[]'::JSONB
      OR p_new->>'gmail_message_id' IS NOT NULL OR p_new->>'gmail_thread_id' IS NOT NULL
      OR p_new->>'body_html' IS NOT NULL OR p_new->>'transcript_text' IS NOT NULL
    THEN RAISE EXCEPTION 'vendor_boundary_invalid_revision_message' USING ERRCODE='23514'; END IF;
    PERFORM private.assert_vendor_durable_json(p_changed,false,NULL,0,NULL,'outreach_messages'); RETURN;
  END IF;
  -- Gmail READONLY imports may be inbound OR outbound and have no approval ID.
  -- Matching an established Gmail thread and an owned active account is required;
  -- marker text alone cannot grant authenticated writers this service exception.
  IF p_new->'provider_metadata_json'='{"provider":"gmail","sync_source":"gmail.readonly"}'::JSONB THEN
    IF NOT private.vendor_boundary_service_request()
      OR p_new->>'direction' NOT IN ('inbound','outbound')
      OR COALESCE(p_new->>'gmail_message_id','') !~ '^[A-Za-z0-9_-]{1,255}$'
      OR COALESCE(p_new->>'gmail_thread_id','') !~ '^[A-Za-z0-9_-]{1,255}$'
      OR p_new->'sent_manually' IS DISTINCT FROM 'false'::JSONB
      OR p_new->>'agent_action_id' IS NOT NULL OR p_new->>'approval_id' IS NOT NULL
      OR p_new->'attachments_json' IS DISTINCT FROM '[]'::JSONB
      OR NOT EXISTS(SELECT 1 FROM public.creator_email_accounts account
        WHERE account.user_id::TEXT=v_thread->>'user_id' AND account.provider='gmail' AND account.revoked_at IS NULL)
      OR NOT EXISTS(SELECT 1 FROM public.outreach_messages message
        WHERE message.thread_id::TEXT=v_thread->>'id' AND message.gmail_thread_id=p_new->>'gmail_thread_id')
    THEN RAISE EXCEPTION 'vendor_boundary_untrusted_gmail_import' USING ERRCODE='23514'; END IF;
    PERFORM private.assert_vendor_durable_json(p_changed,false,NULL,0,NULL,'outreach_messages'); RETURN;
  END IF;
  SELECT to_jsonb(action) INTO v_action FROM public.agent_actions action
    WHERE action.id::TEXT=p_new->>'agent_action_id' AND action.plan_id::TEXT=v_thread->>'plan_id';
  SELECT to_jsonb(approval) INTO v_approval FROM public.approvals approval
    WHERE approval.id::TEXT=p_new->>'approval_id' AND approval.agent_action_id::TEXT=v_action->>'id'
      AND approval.plan_id::TEXT=v_thread->>'plan_id';
  IF NOT private.vendor_boundary_service_request() OR v_action IS NULL OR v_approval IS NULL
    OR v_action->>'approval_id' IS DISTINCT FROM v_approval->>'id'
    OR v_thread->>'source_agent_action_id' IS DISTINCT FROM v_action->>'id'
    OR COALESCE(v_approval->>'authorized_by',v_approval->>'approved_by') IS DISTINCT FROM v_thread->>'user_id'
    OR v_approval->>'status' NOT IN ('authorized','approved')
    OR v_action->>'status' NOT IN ('approved','executing','complete') OR p_new->>'direction' IS DISTINCT FROM 'outbound'
  THEN RAISE EXCEPTION 'vendor_boundary_unapproved_outreach_copy' USING ERRCODE='23514'; END IF;
  IF p_new->'provider_metadata_json'='{"draft_kind":"vendor_contact","approval_required_for_send":true,"outbound_message_sent":false}'::JSONB
    AND private.vendor_boundary_profile_thread_valid(v_thread) THEN
    SELECT to_jsonb(profile) INTO v_profile FROM public.vendor_profiles profile WHERE profile.id::TEXT=v_thread->>'target_id';
    SELECT to_jsonb(plan) INTO v_plan FROM public.plans plan WHERE plan.id::TEXT=v_thread->>'plan_id';
    v_body:=concat_ws(E'\n\n','Hi ' || (v_profile->>'name') || ' team,',
      'I am planning ' || (v_plan->>'title') || CASE WHEN v_plan->>'date_window_start' IS NOT NULL THEN ' for ' || (v_plan->>'date_window_start') ELSE '' END
        || CASE WHEN v_plan->>'guest_count' IS NOT NULL THEN ' for ' || (v_plan->>'guest_count') || ' guests' ELSE '' END || '.',
      'Could you confirm availability, pricing, package details, deposit terms, and setup requirements?','Thank you.');
    IF p_new->>'subject' IS DISTINCT FROM left((v_plan->>'title') || ' availability and quote request',500)
      OR p_new->>'body_text' IS DISTINCT FROM v_body OR p_new->>'body_html' IS NOT NULL
      OR p_new->'headers_json' IS DISTINCT FROM jsonb_build_object('to',v_thread->>'target_email')
      OR p_new->'attachments_json' IS DISTINCT FROM '[]'::JSONB OR p_new->'sent_manually' IS DISTINCT FROM 'false'::JSONB
      OR p_new->>'delivery_status' IS NOT NULL OR p_new->>'sent_at' IS NOT NULL
      OR p_new->>'gmail_message_id' IS NOT NULL OR p_new->>'gmail_thread_id' IS NOT NULL
    THEN RAISE EXCEPTION 'vendor_boundary_invalid_catalog_draft' USING ERRCODE='23514'; END IF;
    PERFORM private.assert_vendor_durable_json(p_changed,false,NULL,0,NULL,'outreach_messages'); RETURN;
  END IF;
  v_payload:=v_action->'payload_json';
  IF v_action->>'action_type' IS DISTINCT FROM 'email' OR v_payload->>'kind' IS DISTINCT FROM 'gmail_approved_outreach'
    OR p_new#>>'{provider_metadata_json,provider}' IS DISTINCT FROM 'gmail'
    OR p_new#>>'{provider_metadata_json,approval_flow}' IS DISTINCT FROM 'gmail_approved_outreach'
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_new->'provider_metadata_json') k WHERE k NOT IN
      ('provider','approval_flow','label_ids','reconciled_by_rfc_message_id'))
    OR v_approval#>'{snapshot_json,action,payload_json}' IS DISTINCT FROM v_payload
  THEN RAISE EXCEPTION 'vendor_boundary_invalid_dispatch_contract' USING ERRCODE='23514'; END IF;
  SELECT target INTO v_target FROM jsonb_array_elements(v_payload->'targets') target
    WHERE target->>'discoveryVendorId'=v_thread->>'discovery_vendor_id' AND target->>'email'=v_thread->>'target_email'
      AND target->>'name'=v_thread->>'target_name' LIMIT 1;
  IF v_target IS NULL THEN RAISE EXCEPTION 'vendor_boundary_dispatch_target_mismatch' USING ERRCODE='23514'; END IF;
  PERFORM private.assert_vendor_durable_json(v_target,true,v_thread->>'discovery_vendor_id',0,NULL,'outreach_dispatch_target');
  PERFORM private.assert_vendor_durable_json(v_approval,false,NULL,0,NULL,'approvals');
  v_sender:=v_payload->>'sender_email';
  IF NOT EXISTS(SELECT 1 FROM public.creator_email_accounts account WHERE account.user_id::TEXT=v_thread->>'user_id'
    AND account.provider='gmail' AND account.revoked_at IS NULL AND account.email_address=v_sender) THEN
    RAISE EXCEPTION 'vendor_boundary_dispatch_sender_mismatch' USING ERRCODE='23514'; END IF;
  -- Same approved template substitutions as renderBodyForTarget. Escape regex
  -- replacement backslashes; recipient text is data, never a regex replacement.
  v_body:=regexp_replace(v_payload->>'body_text','\{\{\s*(venue_name|target_name|place_name)\s*\}\}',
    replace(v_target->>'name',E'\\',E'\\\\'),'gi');
  v_body:=regexp_replace(v_body,'\{\{\s*sender_email\s*\}\}',replace(v_sender,E'\\',E'\\\\'),'gi');
  v_body:=regexp_replace(v_body,'\{\{\s*[^}]+\s*\}\}','','g');
  v_html:=replace(replace(replace(replace(replace(replace(v_body,'&','&amp;'),'<','&lt;'),'>','&gt;'),'"','&quot;'),'''','&#039;'),E'\n','<br />');
  IF p_new->>'subject' IS DISTINCT FROM v_payload->>'subject' OR p_new->>'body_text' IS DISTINCT FROM v_body
    OR p_new->>'body_html' IS DISTINCT FROM v_html
    OR p_new#>>'{headers_json,to}' IS DISTINCT FROM v_thread->>'target_email'
    OR p_new#>>'{headers_json,from}' IS DISTINCT FROM v_sender
    OR p_new#>>'{headers_json,message-id}' IS DISTINCT FROM p_new->>'rfc_message_id'
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_new->'headers_json') k WHERE k NOT IN ('from','to','message-id'))
    OR p_new->'attachments_json' IS DISTINCT FROM '[]'::JSONB OR p_new->'sent_manually' IS DISTINCT FROM 'true'::JSONB
  THEN RAISE EXCEPTION 'vendor_boundary_dispatch_copy_mismatch' USING ERRCODE='23514'; END IF;
  PERFORM private.assert_vendor_durable_json(p_changed,false,NULL,0,NULL,'outreach_messages');
END;
$function$;

CREATE OR REPLACE FUNCTION private.fence_venue_durable_sink()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $function$
DECLARE
  v_new JSONB:=to_jsonb(NEW); v_old JSONB; v_checked JSONB:='{}'; v_vendor JSONB:='{}';
  v_changed JSONB:='{}'; v_key TEXT; v_value JSONB; v_envelope JSONB; v_rebind BOOLEAN;
BEGIN
  -- C1 projection and validator call are unchanged, including its original
  -- stable-identifier list. Vendor mapping uses a distinct payload below.
  IF TG_OP='UPDATE' THEN
    v_old:=to_jsonb(OLD);
    FOR v_key,v_value IN SELECT key,value FROM jsonb_each(v_new) LOOP
      IF v_value IS DISTINCT FROM v_old->v_key THEN v_checked:=v_checked || jsonb_build_object(v_key,v_value); END IF;
    END LOOP;
    v_changed:=v_checked;
    FOREACH v_key IN ARRAY ARRAY['discovery_venue_id','discoveryVenueId','target_type','target_id','quote_kind',
      'venue_id','reference_id','type','is_discovery','source','service_type'] LOOP
      IF v_new ? v_key THEN v_checked:=v_checked || jsonb_build_object(v_key,v_new->v_key); END IF;
    END LOOP;
  ELSE v_checked:=v_new; v_changed:=v_new; END IF;
  PERFORM private.assert_venue_durable_json(v_checked,false,NULL,0,NULL,TG_TABLE_NAME);
  IF TG_TABLE_NAME = ANY(ARRAY['plans','plan_messages','plan_versions','plan_revisions','recommendations','approvals',
    'agent_actions','admin_tasks','audit_logs','admin_audit_log','templates','agent_runs','discovery_change_log','outreach_threads','outreach_messages']) THEN
    IF TG_TABLE_NAME='outreach_messages' THEN
      PERFORM private.assert_vendor_outreach_message(v_new,v_old,v_changed); RETURN NEW;
    END IF;
    v_vendor:=v_changed;
    FOREACH v_key IN ARRAY ARRAY['discovery_vendor_id','discoveryVendorId','target_type','target_id','quote_kind',
      'reference_id','type','kind','is_discovery','source','entity_type','entity_id','channel','action_type',
      'source_agent_action_id','plan_id','agent_action_id','approval_id'] LOOP
      IF v_new ? v_key THEN v_vendor:=v_vendor || jsonb_build_object(v_key,v_new->v_key); END IF;
    END LOOP;
    -- Identity/envelope changes must rebind any sibling aliases. A timestamp or
    -- lifecycle-only update does not fetch/copy an untouched legacy snapshot.
    v_rebind:=TG_OP='INSERT' OR v_changed ?| ARRAY['discovery_vendor_id','discoveryVendorId','target_type','target_id',
      'reference_id','metadata','payload_json','channel_strategy','vendor_data'];
    IF v_rebind THEN
      FOREACH v_key IN ARRAY ARRAY['vendor_name','target_name','target_email','target_phone','external_name','name',
        'display_name','provider','email','delivery_email','phone','contact_phone','service_type','notes','description'] LOOP
        IF v_new ? v_key THEN v_vendor:=v_vendor || jsonb_build_object(v_key,v_new->v_key); END IF;
      END LOOP;
    END IF;
    IF TG_TABLE_NAME='discovery_change_log' AND v_new->>'entity_type'='discovery_vendor' THEN
      -- History INSERT/meaningful edits validate the entire typed record. A later
      -- operational cascade counter alone is not a new old/new-value copy.
      IF TG_OP='INSERT' OR v_changed ?| ARRAY['entity_type','entity_id','source','field_name','old_value','new_value','source_evidence','actor_id','applied','applied_at'] THEN
        v_vendor:=v_new;
      ELSE RETURN NEW; END IF;
    END IF;
    IF TG_TABLE_NAME='outreach_threads' AND private.vendor_boundary_profile_thread_valid(v_new) THEN
      v_vendor:=v_vendor - ARRAY['target_name','target_email'];
    END IF;
    -- The existing same-row envelope may establish a changed alias's source, but
    -- do not validate historical evidence for an unrelated status-only UPDATE.
    IF v_rebind OR v_changed ?| ARRAY['vendor_name','target_name','target_email','target_phone','external_name','name',
      'display_name','provider','email','delivery_email','phone','contact_phone','service_type','notes','description'] THEN
      v_envelope:=COALESCE(v_new->'vendor_data',v_new#>'{metadata,vendor_data}',v_new#>'{payload_json,vendor_data}',v_new#>'{channel_strategy,vendor_data}');
    END IF;
    PERFORM private.assert_vendor_durable_json(v_vendor,false,NULL,0,v_envelope,TG_TABLE_NAME);
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION private.fence_vendor_booking_durable_snapshot()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $function$
DECLARE v_new JSONB:=to_jsonb(NEW); v_old JSONB; v_key TEXT; v_value JSONB; v_checked JSONB:='{}'; v_approved JSONB;
BEGIN
  IF TG_OP='UPDATE' THEN
    v_old:=to_jsonb(OLD);
    FOR v_key,v_value IN SELECT key,value FROM jsonb_each(v_new) LOOP
      IF v_value IS DISTINCT FROM v_old->v_key THEN v_checked:=v_checked || jsonb_build_object(v_key,v_value); END IF;
    END LOOP;
  ELSE v_checked:=v_new; END IF;
  IF v_checked ? 'approved_terms_snapshot' AND v_checked->'approved_terms_snapshot'<>'null'::JSONB THEN
    SELECT snapshot_json INTO v_approved FROM public.approvals WHERE id=NEW.approval_id AND plan_id=NEW.plan_id;
    IF v_approved IS NULL OR v_approved IS DISTINCT FROM NEW.approved_terms_snapshot THEN
      RAISE EXCEPTION 'vendor_boundary_booking_snapshot_mismatch' USING ERRCODE='23514';
    END IF;
    PERFORM private.assert_vendor_durable_json(NEW.approved_terms_snapshot,false,NULL,0,NULL,'approved_terms_snapshot');
  END IF;
  PERFORM private.assert_vendor_durable_json(v_checked,false,NULL,0,NULL,'vendor_bookings');
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS fence_vendor_booking_durable_snapshot ON public.vendor_bookings;
CREATE TRIGGER fence_vendor_booking_durable_snapshot BEFORE INSERT OR UPDATE ON public.vendor_bookings
  FOR EACH ROW EXECUTE FUNCTION private.fence_vendor_booking_durable_snapshot();

-- Source ACLs: revoke preexisting COLUMN grants as well as table access. There
-- is deliberately no service-role identity-column exception. The reviewed
-- owner-authorized source RPCs and safe SELECT view are the entire app gateway.
REVOKE ALL ON public.discovery_vendors FROM PUBLIC,anon,authenticated,service_role;
DO $vendor_column_acl$
DECLARE v_columns TEXT;
BEGIN
  SELECT string_agg(quote_ident(attname),',' ORDER BY attnum) INTO v_columns FROM pg_catalog.pg_attribute
    WHERE attrelid='public.discovery_vendors'::REGCLASS AND attnum>0 AND NOT attisdropped;
  EXECUTE format('REVOKE SELECT (%1$s), INSERT (%1$s), UPDATE (%1$s), REFERENCES (%1$s) ON public.discovery_vendors FROM PUBLIC,anon,authenticated,service_role',v_columns);
END;
$vendor_column_acl$;
REVOKE ALL ON public.discovery_vendors_safe FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.discovery_vendors_safe TO service_role;
REVOKE ALL ON FUNCTION public.upsert_discovery_vendor_identity(TEXT,UUID),
  public.write_discovery_vendor_independent_facts(UUID,JSONB,JSONB,JSONB),
  public.stage_vendor_quote_booking_checked(UUID,UUID,TEXT,UUID,UUID,UUID,TIMESTAMPTZ,JSONB,JSONB,TEXT)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.upsert_discovery_vendor_identity(TEXT,UUID),
  public.write_discovery_vendor_independent_facts(UUID,JSONB,JSONB,JSONB),
  public.stage_vendor_quote_booking_checked(UUID,UUID,TEXT,UUID,UUID,UUID,TIMESTAMPTZ,JSONB,JSONB,TEXT) TO service_role;

REVOKE ALL ON FUNCTION private.vendor_boundary_service_request(),private.vendor_boundary_history_valid(JSONB),
  private.vendor_boundary_profile_thread_valid(JSONB),private.assert_vendor_outreach_message(JSONB,JSONB,JSONB),
  private.fence_vendor_booking_durable_snapshot(),private.fence_venue_durable_sink(),
  private.assert_vendor_durable_json(JSONB,BOOLEAN,TEXT,INTEGER,JSONB,TEXT) FROM PUBLIC,anon,authenticated,service_role;
-- The existing service-only INVOKER staging and concierge routines call this
-- assertion; granting it reveals no source values and authorizes no mutation.
-- Baseline private-schema USAGE is owner-only. Every preexisting private helper
-- already has an explicit function ACL; this does not expose owner-only helpers
-- or grant anon/authenticated schema access. INVOKER producers stay INVOKER.
GRANT USAGE ON SCHEMA private TO service_role;
GRANT EXECUTE ON FUNCTION private.assert_vendor_durable_json(JSONB,BOOLEAN,TEXT,INTEGER,JSONB,TEXT) TO service_role;

-- C2 producer adaptations. App contracts and lifecycle state machines are retained.
-- Existing signatures, lifecycle checks and committed return contracts remain intact.

-- Explicit lock-before-read: callers issue this in its own statement, then read
-- the safe view in a later statement. SHARE blocks non-key fact updates too.
CREATE OR REPLACE FUNCTION public.lock_discovery_vendor_identity(p_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $function$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.discovery_vendors WHERE id=p_id FOR SHARE;
  RETURN v_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.lock_discovery_vendor_identity(UUID) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.lock_discovery_vendor_identity(UUID) TO service_role;

-- Existing mutable copies only. New caller content goes through the rejecting
-- validator, never through this projection. No signed snapshot is modified.
CREATE OR REPLACE FUNCTION private.project_vendor_mutable_json(
  p_value JSONB, p_context BOOLEAN DEFAULT false, p_id TEXT DEFAULT NULL,
  p_depth INTEGER DEFAULT 0, p_envelope JSONB DEFAULT NULL, p_scope TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $function$
DECLARE
  v_key TEXT; v_item JSONB; v_result JSONB; v_child JSONB; v_field TEXT;
  v_context BOOLEAN := p_context; v_id TEXT := p_id; v_envelope JSONB := p_envelope;
  v_local JSONB; v_safe JSONB; v_values JSONB := '{}'; v_provenance JSONB := '{}';
  v_parent JSONB; v_derived BOOLEAN := false; v_removed BOOLEAN := false; v_carry BOOLEAN;
BEGIN
  IF p_depth>64 THEN RAISE EXCEPTION 'vendor_boundary_projection_depth' USING ERRCODE='22023'; END IF;
  IF p_value IS NULL THEN RETURN NULL; END IF;
  IF jsonb_typeof(p_value)='string' THEN
    IF p_context AND p_scope IN ('metadata','payload_json','input','output','result_metadata',
      'snapshot','vendor_data','committed_vendors','accepted_quote_state')
      AND p_value#>>'{}' ~ '^\s*[\[{]' THEN
      RAISE EXCEPTION 'vendor_boundary_serialized_projection' USING ERRCODE='22023';
    END IF;
    RETURN p_value;
  END IF;
  IF jsonb_typeof(p_value)='array' THEN
    v_result := '[]';
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_value) LOOP
      v_result := v_result || jsonb_build_array(private.project_vendor_mutable_json(
        v_item,p_context,p_id,p_depth+1,p_envelope,p_scope));
    END LOOP;
    RETURN v_result;
  END IF;
  IF jsonb_typeof(p_value)<>'object' THEN RETURN p_value; END IF;
  IF (p_value->'snapshot_json' IS NOT NULL AND p_value->'snapshot_json'<>'null'::JSONB
      AND (p_value ? 'snapshot_hash' OR p_value ? 'snapshot_schema_version'))
    OR (p_value->'schema_version'='2'::JSONB AND p_value ?& ARRAY['approval','action','plan']) THEN
    PERFORM private.assert_vendor_durable_json(p_value,p_context,p_id,0,p_envelope,p_scope);
    RETURN p_value;
  END IF;
  -- Preserve the reviewed operational command shapes, not arbitrary reason text.
  IF p_scope IN ('agent_actions.result_metadata.canonical_quote_reapproval',
      'agent_actions.result_metadata.canonical_booking_decline') THEN
    PERFORM private.assert_vendor_durable_json(p_value,p_context,p_id,2,p_envelope,p_scope);
    RETURN p_value;
  END IF;
  v_id := COALESCE(p_value->>'discovery_vendor_id',p_value->>'discoveryVendorId',
    CASE WHEN p_value->>'target_type'='discovery_vendor' THEN p_value->>'target_id' END,
    CASE WHEN p_value#>>'{identity,kind}'='vendor' THEN p_value#>>'{identity,id}' END,p_id);
  v_context := p_context OR p_value#>>'{identity,kind}'='vendor'
    OR p_value->>'entity_type'='discovery_vendor' OR p_value->>'target_type'='discovery_vendor'
    OR p_value ? 'discovery_vendor_id' OR p_value ? 'discoveryVendorId'
    OR p_value ? 'vendor_data' OR p_value#>'{metadata,vendor_data}' IS NOT NULL
    OR (p_value->>'source'='discovery' AND COALESCE(p_value->>'kind',p_value->>'type')='vendor');
  v_context := COALESCE(v_context,false);
  v_local := CASE WHEN p_value#>>'{identity,kind}'='vendor' THEN p_value ELSE
    COALESCE(p_value->'vendor_data',p_value#>'{metadata,vendor_data}',
      p_value#>'{payload_json,vendor_data}',p_value#>'{channel_strategy,vendor_data}') END;
  IF v_local IS NOT NULL THEN
    v_envelope := NULL;
    IF jsonb_typeof(v_local)='object' AND v_local->'schema_version'='1'::JSONB
      AND v_local#>>'{identity,kind}'='vendor'
      AND v_local#>>'{identity,id}' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND (v_id IS NULL OR v_id=v_local#>>'{identity,id}')
      AND jsonb_typeof(v_local->'values')='object'
      AND jsonb_typeof(v_local->'field_provenance')='object' THEN
      v_id := v_local#>>'{identity,id}';
      SELECT to_jsonb(v) INTO v_safe FROM public.discovery_vendors_safe v WHERE id=v_id::UUID;
      IF v_safe IS NOT NULL THEN
        FOR v_key,v_item IN SELECT key,value FROM jsonb_each(v_local->'values') LOOP
          IF private.vendor_boundary_fact_valid(v_key,v_item)
            AND private.venue_boundary_provenance_valid(v_local#>ARRAY['field_provenance',v_key])
            AND ((v_item IS NOT DISTINCT FROM v_safe->v_key
                AND v_local#>ARRAY['field_provenance',v_key] IS NOT DISTINCT FROM v_safe#>ARRAY['field_provenance',v_key])
              OR (v_key='contact_email' AND (
                (v_item IS NOT DISTINCT FROM v_safe->'organizer_provided_email'
                  AND v_local#>'{field_provenance,contact_email}' IS NOT DISTINCT FROM v_safe#>'{field_provenance,organizer_provided_email}')
                OR (EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_safe->'extracted_emails','[]')) e WHERE e->'email'=v_item)
                  AND v_local#>'{field_provenance,contact_email}' IS NOT DISTINCT FROM v_safe#>'{field_provenance,extracted_emails}')
              ))) THEN
            v_values := v_values || jsonb_build_object(v_key,v_item);
            v_provenance := v_provenance || jsonb_build_object(v_key,v_local#>ARRAY['field_provenance',v_key]);
          END IF;
        END LOOP;
        v_envelope := jsonb_build_object('schema_version',1,'identity',jsonb_build_object(
          'kind','vendor','id',v_id,'place_id',CASE WHEN v_safe->>'source'='google_places'
            THEN COALESCE(v_safe->>'google_place_id',regexp_replace(v_safe->>'source_external_id','^places/','')) END),
          'values',v_values,'field_provenance',v_provenance);
      END IF;
    END IF;
    v_removed := v_envelope IS DISTINCT FROM v_local;
  END IF;
  IF p_value#>>'{identity,kind}'='vendor' AND p_value->'schema_version'='1'::JSONB THEN
    IF v_envelope IS NULL THEN RAISE EXCEPTION 'vendor_boundary_projection_identity' USING ERRCODE='22023'; END IF;
    RETURN v_envelope;
  END IF;
  v_local := COALESCE(p_value->'vendor_derivation',p_value#>'{metadata,vendor_derivation}');
  IF v_envelope IS NOT NULL AND private.venue_boundary_provenance_valid(v_local)
    AND v_local->>'source'='derived' AND jsonb_array_length(v_local->'lineage')>0 THEN
    v_derived := true;
    FOR v_parent IN SELECT value FROM jsonb_array_elements(v_local->'lineage') LOOP
      IF v_parent->'provenance' IS DISTINCT FROM v_envelope#>ARRAY['field_provenance',v_parent->>'field'] THEN
        v_derived := false;
      END IF;
    END LOOP;
  END IF;
  v_result := '{}';
  FOR v_key,v_item IN SELECT key,value FROM jsonb_each(p_value) LOOP
    -- The task column is typed operator history, not a vendor-derived fact.
    -- Preserve it only at this actual record root; never exempt nested notes.
    IF p_depth=0 AND p_scope='admin_tasks' AND v_key='notes' THEN
      IF v_item<>'null'::JSONB AND jsonb_typeof(v_item) IS DISTINCT FROM 'string' THEN
        RAISE EXCEPTION 'vendor_boundary_invalid_operator_notes' USING ERRCODE='22023';
      END IF;
      v_result := v_result || jsonb_build_object(v_key,v_item); CONTINUE;
    END IF;
    IF v_key IN ('googleLive','google_live','google_live_overlays','vendor_google_overlay')
      OR (v_context AND v_key IN ('raw_data','rawData','places_response','google_places_response',
        'google_rating','google_user_rating_count','google_user_ratings_total','google_photo_names','google_price_level','business_status',
        'place_types','photos','google_primary_type','displayName','formattedAddress','websiteUri','nationalPhoneNumber',
        'userRatingCount','primaryType','googleMapsUri','attributions','businessStatus','priceLevel','location','reviews','photo_urls')) THEN
      v_removed := true; CONTINUE;
    END IF;
    IF v_key='vendor_data' THEN v_result := v_result || jsonb_build_object(v_key,v_envelope); CONTINUE; END IF;
    IF v_key='vendor_derivation' AND NOT v_derived THEN v_removed := true; CONTINUE; END IF;
    IF v_context AND v_key IN ('name','service_type','formatted_address','city','state','website','phone','contact_email',
      'organizer_provided_email','inferred_hourly_rate_cents','inferred_package_rate_cents','inferred_minimum_cents',
      'vendor_name','target_name','display_name','external_name','provider','email','target_email','delivery_email',
      'contact_phone','address','rating','review_count','fit_score','match_score','reason','reasoning','notes','description','pros','cons') THEN
      v_field := CASE WHEN v_key IN ('vendor_name','target_name','display_name','external_name','provider') THEN 'name'
        WHEN v_key IN ('email','target_email','delivery_email') THEN 'contact_email'
        WHEN v_key='contact_phone' THEN 'phone' WHEN v_key='address' THEN 'formatted_address' ELSE v_key END;
      IF (v_key IN ('name','target_name','provider') AND v_item='"Vendor contact"'::JSONB)
        OR (v_key='state' AND p_value->>'channel'='email' AND v_item#>>'{}' IN
          ('draft','awaiting_reply','in_negotiation','confirmed','declined','stale','cancelled','awaiting_creator_review'))
        OR (v_key='description' AND p_value->>'action_type'='concierge_queue'
          AND p_value#>>'{payload_json,kind}'='canonical_quote_booking'
          AND v_item='"Prepare booking from accepted vendor quote"'::JSONB)
        OR (v_derived AND v_key IN ('fit_score','match_score','reason','reasoning','notes','description','pros','cons')) THEN
        v_child := v_item;
      ELSE v_child := COALESCE(v_envelope#>ARRAY['values',v_field],'null'::JSONB); END IF;
      v_removed := v_removed OR v_child IS DISTINCT FROM v_item;
      v_result := v_result || jsonb_build_object(v_key,v_child); CONTINUE;
    END IF;
    v_carry := v_key NOT IN ('vendor_data','vendor_derivation','field_provenance','quote_terms','quoted_terms',
      'requested_terms','plan','consent')
      AND NOT (p_depth=0 AND p_scope='admin_tasks' AND v_key='outcome_payload')
      -- The producer supplies the typed result_metadata itself at depth zero.
      AND NOT (p_depth=0 AND p_scope='agent_actions.result_metadata' AND v_key='admin_task_outcome')
      AND (v_key='metadata' OR p_context);
    v_child := private.project_vendor_mutable_json(v_item,v_carry AND v_context,
      CASE WHEN v_carry THEN v_id END,p_depth+1,CASE WHEN v_carry THEN v_envelope END,
      CASE WHEN p_scope='agent_actions.result_metadata' AND v_key IN ('canonical_quote_reapproval','canonical_booking_decline')
        THEN p_scope || '.' || v_key ELSE v_key END);
    v_result := v_result || jsonb_build_object(v_key,v_child);
    v_removed := v_removed OR v_child IS DISTINCT FROM v_item;
  END LOOP;
  IF v_removed AND p_value->>'role' IS DISTINCT FROM 'user' THEN
    FOREACH v_key IN ARRAY ARRAY['content','summary','message','raw_model_output'] LOOP
      IF jsonb_typeof(v_result->v_key)='string' THEN v_result := jsonb_set(v_result,ARRAY[v_key],'null'); END IF;
    END LOOP;
  END IF;
  -- A task/action FK can supply independently saved sibling evidence. Carry that
  -- reviewed envelope with the new mutable copy so the existing app reader need
  -- not perform a privileged FK lookup to validate the returned aliases.
  IF p_context AND p_scope='metadata' AND v_envelope IS NOT NULL THEN
    v_result := v_result || jsonb_build_object('vendor_data',v_envelope);
  END IF;
  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION private.project_vendor_mutable_json(JSONB,BOOLEAN,TEXT,INTEGER,JSONB,TEXT)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.project_vendor_mutable_json(JSONB,BOOLEAN,TEXT,INTEGER,JSONB,TEXT) TO service_role;

-- Direct legacy stage calls get the same source/snapshot agreement as the thin
-- checked gateway. Caller has locked plan -> response -> vendor before this read.
CREATE OR REPLACE FUNCTION private.assert_vendor_stage_contract(
  p_vendor_id UUID, p_action_payload JSONB, p_snapshot_json JSONB
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $function$
DECLARE v_safe JSONB; v_envelope JSONB := p_action_payload->'vendor_data'; v_key TEXT; v_value JSONB; v_place_id TEXT;
BEGIN
  SELECT to_jsonb(v) INTO STRICT v_safe FROM public.discovery_vendors_safe v WHERE id=p_vendor_id;
  v_place_id := CASE WHEN v_safe->>'source'='google_places' THEN
    COALESCE(v_safe->>'google_place_id',regexp_replace(v_safe->>'source_external_id','^places/','')) END;
  IF jsonb_typeof(v_envelope) IS DISTINCT FROM 'object' OR v_envelope->'schema_version' IS DISTINCT FROM '1'::JSONB
    OR jsonb_typeof(v_envelope->'identity') IS DISTINCT FROM 'object'
    OR v_envelope#>>'{identity,kind}' IS DISTINCT FROM 'vendor'
    OR v_envelope#>>'{identity,id}' IS DISTINCT FROM p_vendor_id::TEXT
    OR v_envelope#>>'{identity,place_id}' IS DISTINCT FROM v_place_id
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(v_envelope) k WHERE k NOT IN ('schema_version','identity','values','field_provenance'))
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(v_envelope->'identity') k WHERE k NOT IN ('kind','id','place_id'))
    OR jsonb_typeof(v_envelope->'values') IS DISTINCT FROM 'object'
    OR jsonb_typeof(v_envelope->'field_provenance') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'vendor_boundary_invalid_stage_envelope' USING ERRCODE='22023';
  END IF;
  FOR v_key,v_value IN SELECT key,value FROM jsonb_each(v_envelope->'values') LOOP
    IF NOT COALESCE(private.vendor_boundary_fact_valid(v_key,v_value),false)
      OR v_value IS DISTINCT FROM v_safe->v_key
      OR v_envelope#>ARRAY['field_provenance',v_key] IS DISTINCT FROM v_safe#>ARRAY['field_provenance',v_key]
      OR NOT private.venue_boundary_provenance_valid(v_envelope#>ARRAY['field_provenance',v_key]) THEN
      RAISE EXCEPTION 'vendor_boundary_stage_fact_changed' USING ERRCODE='23514',DETAIL=v_key;
    END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(v_envelope->'field_provenance') k WHERE NOT (v_envelope->'values') ? k)
    OR NOT ((v_envelope->'values') ?& ARRAY['name','service_type'])
    OR v_safe->>'name' IS NULL OR v_safe->>'service_type' IS NULL
    OR p_action_payload->>'target_id' IS DISTINCT FROM p_vendor_id::TEXT
    OR p_action_payload->>'target_name' IS DISTINCT FROM v_safe->>'name'
    OR p_action_payload->>'service_type' IS DISTINCT FROM v_safe->>'service_type'
    OR p_action_payload->>'target_type' IS DISTINCT FROM 'discovery_vendor'
    OR p_snapshot_json#>'{action,payload_json}' IS DISTINCT FROM p_action_payload
    OR p_snapshot_json#>>'{action,target_id}' IS DISTINCT FROM p_vendor_id::TEXT
    OR p_snapshot_json#>>'{action,target_type}' IS DISTINCT FROM 'discovery_vendor'
    OR p_snapshot_json#>>'{approval,provider}' IS DISTINCT FROM v_safe->>'name'
    OR p_snapshot_json#>>'{approval,package_details}' IS DISTINCT FROM v_safe->>'service_type'
    OR p_snapshot_json#>>'{counterparty,provider}' IS DISTINCT FROM v_safe->>'name'
    OR p_snapshot_json#>>'{counterparty,display_name}' IS DISTINCT FROM v_safe->>'name'
    OR p_snapshot_json#>>'{counterparty,target_id}' IS DISTINCT FROM p_vendor_id::TEXT
    OR p_snapshot_json#>>'{counterparty,target_type}' IS DISTINCT FROM 'discovery_vendor' THEN
    RAISE EXCEPTION 'vendor_boundary_stage_snapshot_mismatch' USING ERRCODE='23514';
  END IF;
  PERFORM private.assert_vendor_durable_json(p_action_payload,false,NULL,0,NULL,'payload_json');
  PERFORM private.assert_vendor_durable_json(p_snapshot_json,false,NULL,0,NULL,'snapshot_json');
END;
$function$;
REVOKE ALL ON FUNCTION private.assert_vendor_stage_contract(UUID,JSONB,JSONB) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.assert_vendor_stage_contract(UUID,JSONB,JSONB) TO service_role;

-- No full historical task copy enters a new audit row. IDs, outcome, lifecycle,
-- assignment and approval/financial references explain the operation itself.
CREATE OR REPLACE FUNCTION private.vendor_task_audit(p_task public.admin_tasks)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $function$
DECLARE v_result JSONB;
BEGIN
  v_result := jsonb_build_object('id',p_task.id,'plan_id',p_task.plan_id,'event_id',p_task.event_id,
    'agent_action_id',p_task.agent_action_id,'approval_id',p_task.approval_id,
    'assigned_to',p_task.assigned_to,'task_type',p_task.task_type,'status',p_task.status,
    'priority',p_task.priority,'due_at',p_task.due_at,'completed_at',p_task.completed_at,
    'created_at',p_task.created_at,'updated_at',p_task.updated_at,
    'outcome_payload',private.project_vendor_mutable_json(p_task.outcome_payload,false,NULL,0,NULL,'outcome_payload'),
    'approved_snapshot_hash',p_task.metadata->'approved_snapshot_hash');
  PERFORM private.assert_vendor_durable_json(v_result,false,NULL,0,NULL,'admin_audit_log');
  RETURN v_result;
END;
$function$;

-- Same composite, identifiers and operator notes as before. Mutable legacy
-- discovery presentation is projected; description must remain a string because
-- the console searches it with .toLowerCase(). Empty string means unavailable.
CREATE OR REPLACE FUNCTION private.vendor_task_return(p_task public.admin_tasks)
RETURNS public.admin_tasks LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $function$
DECLARE v_result JSONB; v_task public.admin_tasks; v_action public.agent_actions; v_envelope JSONB;
BEGIN
  SELECT a.* INTO v_action FROM public.agent_actions a
    WHERE a.id=p_task.agent_action_id AND a.plan_id=p_task.plan_id AND a.approval_id=p_task.approval_id;
  IF v_action.target_type='discovery_vendor' AND v_action.payload_json->'vendor_data' IS NOT NULL THEN
    v_envelope := private.project_vendor_mutable_json(v_action.payload_json->'vendor_data',false,NULL,0,NULL,'vendor_data');
  END IF;
  v_result := private.project_vendor_mutable_json(to_jsonb(p_task),COALESCE(v_action.target_type='discovery_vendor',false),
    CASE WHEN v_action.target_type='discovery_vendor' THEN v_action.target_id::TEXT END,0,v_envelope,'admin_tasks');
  v_result := jsonb_set(v_result,'{description}',to_jsonb(COALESCE(v_result->>'description','')));
  PERFORM private.assert_vendor_durable_json(v_result,false,NULL,0,NULL,'admin_tasks');
  SELECT * INTO v_task FROM jsonb_populate_record(NULL::public.admin_tasks,v_result);
  RETURN v_task;
END;
$function$;
REVOKE ALL ON FUNCTION private.vendor_task_audit(public.admin_tasks),private.vendor_task_return(public.admin_tasks)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.vendor_task_audit(public.admin_tasks),private.vendor_task_return(public.admin_tasks) TO service_role;

-- A superseded card remains a reference to its immutable approval. It does not
-- need a newly copied rich approval/snapshot to retain its identity and status.
CREATE OR REPLACE FUNCTION private.vendor_superseded_card_metadata(p_metadata JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $function$
DECLARE v_result JSONB;
BEGIN
  v_result := private.project_vendor_mutable_json(COALESCE(p_metadata,'{}')-'approval',false,NULL,0,NULL,'metadata');
  IF p_metadata#>>'{approval,id}' IS NOT NULL AND NOT (v_result ? 'approval_id') THEN
    v_result := v_result || jsonb_build_object('approval_id',p_metadata#>'{approval,id}');
  END IF;
  IF p_metadata#>>'{approval,snapshot_hash}' IS NOT NULL AND NOT (v_result ? 'snapshot_hash') THEN
    v_result := v_result || jsonb_build_object('snapshot_hash',p_metadata#>'{approval,snapshot_hash}');
  END IF;
  -- Non-Gmail successor lookup and the live-plan panel read approval.id/status.
  -- Preserve that operational reference, never the rich historical approval or
  -- its signed snapshot. The original hash is copied verbatim, never recomputed.
  IF p_metadata#>>'{approval,id}' IS NOT NULL THEN
    v_result := v_result || jsonb_build_object('approval',jsonb_strip_nulls(jsonb_build_object(
      'id',p_metadata#>'{approval,id}','status','superseded',
      'snapshot_hash',p_metadata#>'{approval,snapshot_hash}')));
  END IF;
  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION private.vendor_superseded_card_metadata(JSONB) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.vendor_superseded_card_metadata(JSONB) TO service_role;

DO $vendor_stage_producer$
DECLARE v_definition TEXT; v_old TEXT; v_new TEXT; v_count INTEGER;
BEGIN
  v_definition := pg_get_functiondef('public.stage_plan_quote_booking(uuid,uuid,text,uuid,uuid,uuid,timestamp with time zone,jsonb,jsonb,text)'::REGPROCEDURE);
  IF position('-- c2_vendor_stage_v1' IN v_definition)>0 THEN RETURN; END IF;
  -- Require C1's effective venue branch. Never replace it with a stale full body.
  IF position('JOIN public.discovery_venues_safe AS venue ON venue.id = public.lock_discovery_venue_identity(response.discovery_venue_id)' IN v_definition)=0 THEN
    RAISE EXCEPTION 'vendor_boundary_stage_c1_contract_changed';
  END IF;
  FOR v_old,v_new,v_count IN SELECT * FROM (VALUES
    ($old$BEGIN
  IF current_user <> 'postgres'$old$,$new$BEGIN
  -- c2_vendor_stage_v1: preserve lifecycle, validate and project only new copies.
  IF current_user <> 'postgres'$new$,1),
    ($old$  ELSE
    SELECT
      response.discovery_vendor_id,$old$,$new$  ELSE
    -- Separate statements are required: the safe read must happen AFTER waiting
    -- for response/source locks, rather than share the pre-wait query snapshot.
    SELECT response.discovery_vendor_id INTO v_discovery_id
    FROM public.vendor_outreach_responses AS response
    WHERE response.id=p_response_id AND response.plan_id=p_plan_id FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'stage_plan_quote_booking_response_not_found' USING ERRCODE='P0002';
    END IF;
    PERFORM public.lock_discovery_vendor_identity(v_discovery_id);
    SELECT
      response.discovery_vendor_id,$new$,1),
    ($old$JOIN public.discovery_vendors AS vendor ON vendor.id = response.discovery_vendor_id$old$,
      $new$JOIN public.discovery_vendors_safe AS vendor ON vendor.id = response.discovery_vendor_id$new$,1),
    ($old$FOR KEY SHARE OF response, vendor;$old$,$new$FOR SHARE OF response;$new$,1),
    ($old$  -- Exact retry returns the original aggregate instead of creating a second$old$,$new$  IF p_quote_kind='vendor' THEN
    PERFORM private.assert_vendor_stage_contract(v_discovery_id,p_action_payload,p_snapshot_json);
  END IF;

  -- Exact retry returns the original aggregate instead of creating a second$new$,1),
    ($old$  v_metadata := COALESCE(v_plan.metadata, '{}'::jsonb);$old$,$new$  IF p_quote_kind='vendor' THEN
    v_quote := v_quote || jsonb_build_object('vendor_data',p_action_payload->'vendor_data');
  END IF;
  v_metadata := private.project_vendor_mutable_json(COALESCE(v_plan.metadata,'{}'::JSONB),false,NULL,0,NULL,'metadata');$new$,1),
    ($old$    v_existing_vendors := COALESCE(v_plan.committed_vendors, '[]'::jsonb);$old$,$new$    v_existing_vendors := private.project_vendor_mutable_json(COALESCE(v_plan.committed_vendors,'[]'::JSONB),false,NULL,0,NULL,'committed_vendors');$new$,1),
    ($old$    UPDATE public.plans AS plan_row
    SET committed_venue_id$old$,$new$    PERFORM private.assert_vendor_durable_json(v_metadata,false,NULL,0,NULL,'metadata');
    UPDATE public.plans AS plan_row
    SET committed_venue_id$new$,1),
    ($old$    UPDATE public.plans AS plan_row
    SET committed_vendors$old$,$new$    PERFORM private.assert_vendor_durable_json(v_next_vendors,false,NULL,0,NULL,'committed_vendors');
    PERFORM private.assert_vendor_durable_json(v_metadata,false,NULL,0,NULL,'metadata');
    UPDATE public.plans AS plan_row
    SET committed_vendors$new$,1)
  ) AS patches(old_text,new_text,expected_count) LOOP
    IF (length(v_definition)-length(replace(v_definition,v_old,'')))/length(v_old)<>v_count THEN
      RAISE EXCEPTION 'vendor_boundary_stage_definition_changed' USING DETAIL=left(v_old,120);
    END IF;
    v_definition := replace(v_definition,v_old,v_new);
  END LOOP;
  EXECUTE v_definition;
END;
$vendor_stage_producer$;

DO $vendor_revision_producer$
DECLARE v_definition TEXT; v_old TEXT; v_new TEXT; v_count INTEGER;
BEGIN
  v_definition := pg_get_functiondef('public.apply_plan_revision_atomic(uuid,uuid,jsonb,uuid,jsonb,jsonb,text)'::REGPROCEDURE);
  IF position('-- c2_vendor_revision_v1' IN v_definition)>0 THEN RETURN; END IF;
  FOR v_old,v_new,v_count IN SELECT * FROM (VALUES
    ($old$  v_revision_count := COALESCE(v_plan.plan_revision_count, 0) + 1;$old$,$new$  -- c2_vendor_revision_v1: reject new inputs; project only existing mutable copies.
  PERFORM private.assert_vendor_durable_json(p_trigger,false,NULL,0,NULL,'trigger_payload');
  PERFORM private.assert_vendor_durable_json(p_plan_updates,false,NULL,0,NULL,'plans');
  PERFORM private.assert_vendor_durable_json(p_impact,false,NULL,0,NULL,'impact_summary');
  v_revision_count := COALESCE(v_plan.plan_revision_count, 0) + 1;$new$,1),
    ($old$    metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object($old$,$new$    metadata = private.project_vendor_mutable_json(COALESCE(metadata,'{}'::JSONB),false,NULL,0,NULL,'metadata') || jsonb_build_object($new$,1),
    ($old$  SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object($old$,$new$  SET metadata = private.vendor_superseded_card_metadata(metadata) || jsonb_build_object($new$,1),
    ($old$    to_jsonb(v_plan),
    jsonb_build_object($old$,$new$    jsonb_build_object('id',v_plan.id,'user_id',v_plan.user_id,
      'materialized_event_id',v_plan.materialized_event_id,'status',v_plan.status,
      'plan_revision_count',v_plan.plan_revision_count,'date_window_start',v_plan.date_window_start,
      'date_window_end',v_plan.date_window_end,'guest_count',v_plan.guest_count,
      'budget_cap_cents',v_plan.budget_cap_cents,'committed_venue_id',v_plan.committed_venue_id),
    jsonb_build_object($new$,1)
  ) AS patches(old_text,new_text,expected_count) LOOP
    IF (length(v_definition)-length(replace(v_definition,v_old,'')))/length(v_old)<>v_count THEN
      RAISE EXCEPTION 'vendor_boundary_revision_definition_changed' USING DETAIL=left(v_old,120);
    END IF;
    v_definition := replace(v_definition,v_old,v_new);
  END LOOP;
  EXECUTE v_definition;
END;
$vendor_revision_producer$;
-- Approved R1-A: keep the deployed authenticated owned-aggregate entry point.
-- Its relations and auth calls are already schema qualified; builtins resolve
-- through pg_catalog. No broadening to anon/PUBLIC, and no authority check removed.
ALTER FUNCTION public.apply_plan_revision_atomic(UUID,UUID,JSONB,UUID,JSONB,JSONB,TEXT) SET search_path=pg_catalog;
REVOKE ALL ON FUNCTION public.apply_plan_revision_atomic(UUID,UUID,JSONB,UUID,JSONB,JSONB,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.apply_plan_revision_atomic(UUID,UUID,JSONB,UUID,JSONB,JSONB,TEXT) TO authenticated,service_role;

DO $vendor_admin_producers$
DECLARE v_definition TEXT; v_signature TEXT; v_old TEXT; v_new TEXT; v_count INTEGER;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.complete_admin_task_execution(uuid,uuid,jsonb,text,text)',
    'public.cancel_admin_task_execution(uuid,uuid,text,text)'
  ] LOOP
    v_definition := pg_get_functiondef(v_signature::REGPROCEDURE);
    IF position('-- c2_vendor_task_v1' IN v_definition)>0 THEN CONTINUE; END IF;
    FOR v_old,v_new,v_count IN SELECT * FROM (VALUES
      ($old$  v_before_task := to_jsonb(v_task);$old$,$new$  -- c2_vendor_task_v1: reject incompatible response before any new effect.
  PERFORM private.vendor_task_return(v_task);
  v_before_task := private.vendor_task_audit(v_task);$new$,1),
      ($old$COALESCE(action_row.result_metadata, '{}'::jsonb)$old$,$new$private.project_vendor_mutable_json(COALESCE(action_row.result_metadata,'{}'::JSONB),
          v_action.target_type='discovery_vendor',v_action.target_id::TEXT,0,
          v_action.payload_json->'vendor_data','agent_actions.result_metadata')$new$,1),
      ($old$    to_jsonb(v_task),$old$,$new$    private.vendor_task_audit(v_task),$new$,1),
      ($old$RETURN v_task;$old$,$new$RETURN private.vendor_task_return(v_task);$new$,2)
    ) AS patches(old_text,new_text,expected_count) LOOP
      IF (length(v_definition)-length(replace(v_definition,v_old,'')))/length(v_old)<>v_count THEN
        RAISE EXCEPTION 'vendor_boundary_task_definition_changed' USING DETAIL=v_signature || ':' || left(v_old,120);
      END IF;
      v_definition := replace(v_definition,v_old,v_new);
    END LOOP;
    -- Root notes are typed operator history. Keep the existing append unchanged;
    -- only discovery-bearing mutable copies and typed audit/return projections differ.
    EXECUTE v_definition;
  END LOOP;
END;
$vendor_admin_producers$;
