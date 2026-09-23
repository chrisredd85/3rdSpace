-- C1 ACTIVATE: install 26 durable-sink guards, switch the two existing RPC
-- bodies to their safe behavior, and revoke raw discovery table/column access.
-- Run only inside the existing Phase 4 write-pause window after admitted work
-- drains and the reviewed application is ready. This file and its ledger row
-- MUST share one outer transaction (psql --single-transaction, ON_ERROR_STOP).
-- Use the approved bounded lock/statement timeouts. The control-row lock below
-- must remain held through the final DDL and ledger commit, not just this DO.
-- This migration never changes the pause state or rewrites historical data.

DO $require_venue_boundary_write_pause$
DECLARE v_state TEXT; v_enabled BOOLEAN;
BEGIN
  SELECT state, enabled INTO v_state, v_enabled
  FROM public.release_runtime_controls
  WHERE control_key = 'write_pause'
  FOR SHARE;
  IF NOT FOUND OR v_state IS DISTINCT FROM 'paused'
    OR v_enabled IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'venue_boundary_activation_requires_write_pause'
      USING ERRCODE = '55000';
  END IF;
END;
$require_venue_boundary_write_pause$;

-- Table revocation alone does not remove pre-existing column ACLs.
REVOKE ALL ON public.discovery_venues FROM PUBLIC, anon, authenticated, service_role;
DO $column_acl$
DECLARE v_columns TEXT;
BEGIN
  SELECT string_agg(quote_ident(attname),',') INTO v_columns FROM pg_attribute
  WHERE attrelid = 'public.discovery_venues'::REGCLASS AND attnum > 0 AND NOT attisdropped;
  EXECUTE format('REVOKE SELECT (%1$s), INSERT (%1$s), UPDATE (%1$s), REFERENCES (%1$s) ON public.discovery_venues FROM PUBLIC, anon, authenticated, service_role',v_columns);
END;
$column_acl$;
-- Existing invoker booking routines read only these stable binding identifiers.
GRANT SELECT (id,claimed_venue_id) ON public.discovery_venues TO service_role;

-- Attach the already-defined guard to the 26 ACTIVATE sinks. template_runs
-- is intentionally deferred to the separately approved HARDEN phase.
DO $sink_triggers$
DECLARE v_table TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['plans','plan_messages','plan_versions','plan_revisions','recommendations','approvals',
    'agent_actions','admin_tasks','audit_logs','admin_audit_log','agent_action_audit_log','templates','event_templates',
    'agent_runs','app_jobs','outreach_threads','outreach_messages','outreach_notifications',
    'discovery_venue_events','supply_scout_venue_leads','plan_discovery_venue_candidates','venue_bookings','discovery_change_log',
    'venue_opportunity_briefs','venue_opportunity_invites','notifications'] LOOP
    IF to_regclass('public.' || v_table) IS NULL THEN
      RAISE EXCEPTION 'venue_boundary_required_sink_missing' USING DETAIL = v_table;
    END IF;
    EXECUTE format('DROP TRIGGER IF EXISTS fence_venue_durable_sink ON public.%I',v_table);
    EXECUTE format('CREATE TRIGGER fence_venue_durable_sink BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION private.fence_venue_durable_sink()',v_table);
  END LOOP;
END;
$sink_triggers$;

-- Preserve canonical consent/quote validation; use the safe reader and identity lock.
DO $canonical_safe_read$
DECLARE v_oid OID; v_definition TEXT;
BEGIN
  SELECT oid INTO STRICT v_oid FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='stage_plan_quote_booking';
  v_definition := pg_get_functiondef(v_oid);
  IF position('JOIN public.discovery_venues AS venue ON venue.id = response.discovery_venue_id' IN v_definition) > 0 THEN
    v_definition := replace(v_definition,
      'JOIN public.discovery_venues AS venue ON venue.id = response.discovery_venue_id',
      'JOIN public.discovery_venues_safe AS venue ON venue.id = public.lock_discovery_venue_identity(response.discovery_venue_id)');
    v_definition := replace(v_definition,'FOR KEY SHARE OF response, venue;','FOR KEY SHARE OF response;');
    EXECUTE v_definition;
  ELSIF position('JOIN public.discovery_venues_safe AS venue ON venue.id = public.lock_discovery_venue_identity(response.discovery_venue_id)' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'venue_boundary_stage_function_contract_changed';
  END IF;
END;
$canonical_safe_read$;

-- Gmail reapproval creates a new consent version after independently evidenced
-- contact changes. Do not recopy an obsolete rich message or let scalar delivery
-- fields disagree with the new reviewed snapshot. Historical approval snapshots
-- and their hashes remain untouched; this runs only when the command is invoked.
DO $gmail_reapproval_safe_copy$
DECLARE
  v_oid OID; v_definition TEXT; v_old TEXT; v_new TEXT;
BEGIN
  v_oid := 'public.supersede_approval_version(uuid,uuid,text,uuid,integer,date,text,timestamptz,jsonb,jsonb,text,text)'::regprocedure;
  v_definition := pg_get_functiondef(v_oid);
  IF position('venue_boundary_gmail_reapproval_snapshot_mismatch' IN v_definition) > 0 THEN RETURN; END IF;
  v_old := $match$  UPDATE public.approvals
  SET status = 'superseded',$match$;
  v_new := $replacement$  -- C1 Gmail snapshot agreement precedes every mutation. The shared sink
  -- trigger separately binds each new target envelope to trusted saved facts.
  IF v_action.action_type = 'email' AND v_action.payload_json->>'kind' = 'gmail_approved_outreach' THEN
    IF p_action_payload_json->>'kind' IS DISTINCT FROM 'gmail_approved_outreach'
      OR jsonb_typeof(p_action_payload_json->'targets') IS DISTINCT FROM 'array'
      OR jsonb_array_length(p_action_payload_json->'targets') = 0
      OR COALESCE(p_action_payload_json#>>'{targets,0,email}','') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      OR p_snapshot_json#>>'{approval,delivery_email}' IS DISTINCT FROM p_action_payload_json#>>'{targets,0,email}'
      OR p_snapshot_json#>>'{counterparty,delivery_email}' IS DISTINCT FROM p_action_payload_json#>>'{targets,0,email}'
      OR p_snapshot_json#>>'{approval,provider}' IS DISTINCT FROM 'Gmail'
      OR p_snapshot_json#>>'{counterparty,provider}' IS DISTINCT FROM 'Gmail'
      OR jsonb_typeof(p_snapshot_json#>'{approval,action_label}') IS DISTINCT FROM 'string'
      OR NULLIF(btrim(p_snapshot_json#>>'{approval,action_label}'),'') IS NULL
      OR jsonb_typeof(p_snapshot_json#>'{approval,package_details}') IS DISTINCT FROM 'string'
      OR NULLIF(btrim(p_snapshot_json#>>'{approval,package_details}'),'') IS NULL
    THEN
      RAISE EXCEPTION 'venue_boundary_gmail_reapproval_snapshot_mismatch' USING ERRCODE = '22023';
    END IF;
  END IF;

  UPDATE public.approvals
  SET status = 'superseded',$replacement$;
  IF position(v_old IN v_definition) = 0 THEN RAISE EXCEPTION 'venue_boundary_supersede_update_contract_changed'; END IF;
  v_definition := replace(v_definition,v_old,v_new);
  v_old := 'v_previous.action_label, v_previous.provider, p_event_date,';
  v_new := $replacement$CASE WHEN v_action.action_type = 'email' AND v_action.payload_json->>'kind' = 'gmail_approved_outreach'
      THEN p_snapshot_json#>>'{approval,action_label}' ELSE v_previous.action_label END,
    v_previous.provider, p_event_date,$replacement$;
  IF position(v_old IN v_definition) = 0 THEN RAISE EXCEPTION 'venue_boundary_supersede_label_contract_changed'; END IF;
  v_definition := replace(v_definition,v_old,v_new);
  v_old := $match$v_previous.cancellation_terms, v_previous.package_details,
    v_previous.delivery_email, v_previous.payment_method_id, 'pending',$match$;
  v_new := $replacement$v_previous.cancellation_terms,
    CASE WHEN v_action.action_type = 'email' AND v_action.payload_json->>'kind' = 'gmail_approved_outreach'
      THEN p_snapshot_json#>>'{approval,package_details}' ELSE v_previous.package_details END,
    CASE WHEN v_action.action_type = 'email' AND v_action.payload_json->>'kind' = 'gmail_approved_outreach'
      THEN p_snapshot_json#>>'{approval,delivery_email}' ELSE v_previous.delivery_email END,
    v_previous.payment_method_id, 'pending',$replacement$;
  IF position(v_old IN v_definition) = 0 THEN RAISE EXCEPTION 'venue_boundary_supersede_delivery_contract_changed'; END IF;
  v_definition := replace(v_definition,v_old,v_new);
  v_old := $match$  SET metadata = message.metadata
    || jsonb_build_object(
      'status', 'pending',
      'approval_id', v_next.id,
      'approval', COALESCE(message.metadata -> 'approval', '{}'::jsonb)
        || (to_jsonb(v_next) - 'payment_method_id')
    )$match$;
  v_new := $replacement$  SET metadata = CASE
    WHEN v_action.action_type = 'email' AND v_action.payload_json->>'kind' = 'gmail_approved_outreach' THEN
      jsonb_build_object('kind','gmail_approved_outreach','status','superseded',
        'approval_id',v_previous.id,'superseded_by_approval_id',v_next.id,'snapshot_hash',v_previous.snapshot_hash)
    ELSE message.metadata || jsonb_build_object(
      'status','pending','approval_id',v_next.id,
      'approval',COALESCE(message.metadata->'approval','{}'::jsonb) || (to_jsonb(v_next)-'payment_method_id'))
    END$replacement$;
  IF position(v_old IN v_definition) = 0 THEN RAISE EXCEPTION 'venue_boundary_supersede_message_contract_changed'; END IF;
  v_definition := replace(v_definition,v_old,v_new);
  EXECUTE v_definition;
END;
$gmail_reapproval_safe_copy$;
