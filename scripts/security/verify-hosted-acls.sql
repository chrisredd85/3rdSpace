-- Read-only production verification for migration
-- 20260709120000_lock_down_function_and_view_privileges.sql plus the reviewed
-- Prompt 7/8 SECURITY DEFINER additions through 20260709178000.
--
-- Run this in the hosted Supabase SQL editor after the migration lands. Any
-- mismatch raises an exception and stops the script. This script does not
-- create fixtures or mutate hosted data.

BEGIN READ ONLY;

DO $verify_hosted_acls$
DECLARE
  v_function regprocedure;
  v_unclassified text;
  v_service_only constant regprocedure[] := ARRAY[
    'public.advance_plan_after_confirmed_booking()'::regprocedure,
    'public.assert_canonical_booking_partner_binding(text,uuid,uuid,uuid,uuid)'::regprocedure,
    'public.bind_discovery_vendor_claim(uuid,uuid,uuid)'::regprocedure,
    'public.block_inflight_stripe_account_payments(text,text,text)'::regprocedure,
    'public.calculate_event_kickback(uuid)'::regprocedure,
    'public.cancel_executing_canonical_quote_booking(uuid,uuid,uuid,uuid,text)'::regprocedure,
    'public.canonical_booking_has_execution_provenance(text,uuid,uuid,uuid,uuid,uuid,uuid,integer,jsonb,text)'::regprocedure,
    'public.claim_app_jobs(integer,text)'::regprocedure,
    'public.confirm_canonical_booking(text,uuid,uuid,jsonb)'::regprocedure,
    'public.consume_webhook_rate_limit(text,integer,integer)'::regprocedure,
    'public.decline_canonical_bookings(text,uuid[],uuid,text,jsonb)'::regprocedure,
    'public.enforce_canonical_booking_execution_provenance()'::regprocedure,
    'public.ensure_canonical_booking_partner_binding(text,uuid,uuid,uuid,uuid)'::regprocedure,
    'public.freeze_canonical_booking_partner_binding()'::regprocedure,
    'public.handle_new_user()'::regprocedure,
    'public.increment_stripe_webhook_duplicate_count(text,text)'::regprocedure,
    'public.increment_stripe_webhook_duplicate_count(text)'::regprocedure,
    'public.insert_grouped_notification(uuid,text,text,text,text,uuid,jsonb,text)'::regprocedure,
    'public.next_vendor_invoice_number(integer)'::regprocedure,
    'public.notify_review_events()'::regprocedure,
    'public.notify_vendor_booking_events()'::regprocedure,
    'public.notify_vendor_transaction_events()'::regprocedure,
    'public.protect_vendor_profile_discovery_claim_link()'::regprocedure,
    'public.recalculate_vendor_review_stats(uuid)'::regprocedure,
    'public.record_stripe_webhook_event_result(text,text,jsonb,text,text,boolean,text,boolean,text)'::regprocedure,
    'public.refresh_projection_baselines()'::regprocedure,
    'public.refresh_vendor_analytics()'::regprocedure,
    'public.release_stale_stripe_webhook_reservations(interval)'::regprocedure,
    'public.reserve_stripe_webhook_event(text,text,jsonb,text,text,boolean)'::regprocedure,
    'public.sync_vendor_profile_discovery_claim_link()'::regprocedure,
    'public.sync_vendor_review_stats()'::regprocedure,
    'public.transition_settlement_charge_status(uuid,text,text,text,uuid,text,text,jsonb,jsonb)'::regprocedure,
    'public.transition_settlement_run_status(uuid,text,text,text,uuid,text,text,jsonb,jsonb)'::regprocedure,
    'public.unblock_stripe_account_settlements(text,text)'::regprocedure,
    'public.validate_event_cost_commitment_scope()'::regprocedure,
    'public.validate_event_revenue_term_scope()'::regprocedure,
    'public.validate_live_recommendation_scope()'::regprocedure
  ];
  v_authenticated constant regprocedure[] := ARRAY[
    'public.apply_plan_revision_atomic(uuid,uuid,jsonb,uuid,jsonb,jsonb,text)'::regprocedure,
    'public.can_manage_event_cost_commitment_org(uuid)'::regprocedure,
    'public.can_manage_event_revenue_term_org(uuid)'::regprocedure,
    'public.can_manage_live_recommendation_org(uuid)'::regprocedure,
    'public.can_manage_plan_read_model(uuid)'::regprocedure,
    'public.consume_builder_event_access(uuid,uuid,integer,integer,integer)'::regprocedure,
    'public.create_vendor_invite(uuid,text,text,text,text,text,numeric,uuid)'::regprocedure,
    'public.create_venue_invite(uuid,text,text,text,text,text,text,text,integer,integer,text,integer,uuid)'::regprocedure,
    'public.get_event_kickback_summary(uuid)'::regprocedure,
    'public.is_event_builder(uuid)'::regprocedure,
    'public.is_event_collaborator(uuid)'::regprocedure
  ];
BEGIN
  SELECT string_agg(privileged.signature, ', ' ORDER BY privileged.signature)
  INTO v_unclassified
  FROM (
    SELECT p.oid::regprocedure::text AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND NOT (p.oid::regprocedure = ANY(v_service_only || v_authenticated))
  ) privileged;

  IF v_unclassified IS NOT NULL THEN
    RAISE EXCEPTION 'Unclassified SECURITY DEFINER functions: %', v_unclassified;
  END IF;

  IF (
    SELECT count(*)
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
  ) <> cardinality(v_service_only) + cardinality(v_authenticated) THEN
    RAISE EXCEPTION 'Hosted SECURITY DEFINER count does not match the 48-function allowlist';
  END IF;

  FOREACH v_function IN ARRAY v_service_only LOOP
    IF has_function_privilege('anon', v_function, 'EXECUTE') THEN
      RAISE EXCEPTION 'anon can execute service-only function %', v_function;
    END IF;
    IF has_function_privilege('authenticated', v_function, 'EXECUTE') THEN
      RAISE EXCEPTION 'authenticated can execute service-only function %', v_function;
    END IF;
    IF NOT has_function_privilege('service_role', v_function, 'EXECUTE') THEN
      RAISE EXCEPTION 'service_role cannot execute service-only function %', v_function;
    END IF;
  END LOOP;

  FOREACH v_function IN ARRAY v_authenticated LOOP
    IF has_function_privilege('anon', v_function, 'EXECUTE') THEN
      RAISE EXCEPTION 'anon can execute authenticated function %', v_function;
    END IF;
    IF NOT has_function_privilege('authenticated', v_function, 'EXECUTE') THEN
      RAISE EXCEPTION 'authenticated cannot execute allowlisted function %', v_function;
    END IF;
    IF NOT has_function_privilege('service_role', v_function, 'EXECUTE') THEN
      RAISE EXCEPTION 'service_role cannot execute allowlisted function %', v_function;
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM pg_proc
      WHERE oid = v_function
        AND prosrc ~ 'auth\.(uid|role|jwt)'
    ) THEN
      RAISE EXCEPTION 'Authenticated function does not derive request identity: %', v_function;
    END IF;
  END LOOP;

  IF has_table_privilege('anon', 'public.event_ticket_sales_rollups', 'SELECT')
    OR has_table_privilege('anon', 'public.organizer_baselines', 'SELECT')
    OR has_table_privilege('anon', 'public.vendor_analytics', 'SELECT') THEN
    RAISE EXCEPTION 'anon retains SELECT on a protected financial view';
  END IF;

  IF NOT has_table_privilege('authenticated', 'public.event_ticket_sales_rollups', 'SELECT') THEN
    RAISE EXCEPTION 'authenticated lacks SELECT on the RLS-invoker ticket rollup';
  END IF;

  IF has_table_privilege('authenticated', 'public.organizer_baselines', 'SELECT')
    OR has_table_privilege('authenticated', 'public.vendor_analytics', 'SELECT') THEN
    RAISE EXCEPTION 'authenticated retains SELECT on a materialized financial view';
  END IF;

  IF NOT has_table_privilege('service_role', 'public.event_ticket_sales_rollups', 'SELECT')
    OR NOT has_table_privilege('service_role', 'public.organizer_baselines', 'SELECT')
    OR NOT has_table_privilege('service_role', 'public.vendor_analytics', 'SELECT') THEN
    RAISE EXCEPTION 'service_role lacks SELECT on a required financial view';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'event_ticket_sales_rollups'
      AND 'security_invoker=true' = ANY(COALESCE(c.reloptions, ARRAY[]::text[]))
  ) THEN
    RAISE EXCEPTION 'event_ticket_sales_rollups is not security_invoker=true';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_default_acl d
    CROSS JOIN LATERAL aclexplode(d.defaclacl) acl
    LEFT JOIN pg_roles grantee ON grantee.oid = acl.grantee
    WHERE d.defaclrole = 'postgres'::regrole
      AND d.defaclnamespace = 'public'::regnamespace
      AND (acl.grantee = 0 OR grantee.rolname IN ('anon', 'authenticated'))
  ) THEN
    RAISE EXCEPTION 'Unsafe PUBLIC/anon/authenticated default privileges remain in public';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE oid = 'public.apply_plan_revision_atomic(uuid,uuid,jsonb,uuid,jsonb,jsonb,text)'::regprocedure
      AND prosrc LIKE '%recommendations.plan_id = p_plan_id%'
      AND prosrc LIKE '%approvals.plan_id = p_plan_id%'
      AND prosrc LIKE '%outreach_threads.plan_id = p_plan_id%'
      AND prosrc LIKE '%plan_messages.plan_id = p_plan_id%'
  ) THEN
    RAISE EXCEPTION 'apply_plan_revision_atomic aggregate scoping markers are missing';
  END IF;

  RAISE NOTICE 'Hosted ACL verification passed: 37 service-only, 11 authenticated-scoped, 0 anonymous privileged functions.';
END;
$verify_hosted_acls$;

SELECT
  p.oid::regprocedure::text AS function_signature,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
  has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prosecdef
ORDER BY 1;

SELECT
  c.oid::regclass::text AS relation,
  c.relkind,
  has_table_privilege('anon', c.oid, 'SELECT') AS anon_select,
  has_table_privilege('authenticated', c.oid, 'SELECT') AS authenticated_select,
  has_table_privilege('service_role', c.oid, 'SELECT') AS service_role_select,
  c.reloptions
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
    'event_ticket_sales_rollups',
    'organizer_baselines',
    'vendor_analytics'
  )
ORDER BY 1;

ROLLBACK;
