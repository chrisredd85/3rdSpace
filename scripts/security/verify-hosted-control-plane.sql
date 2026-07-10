-- Read-only production verification for migration
-- 20260709130000_server_owned_execution_control_plane.sql.
--
-- Run after the migration in the hosted Supabase SQL editor. This script does
-- not create fixtures or mutate hosted state; any mismatch raises an exception.

BEGIN READ ONLY;

DO $verify$
DECLARE
  v_table TEXT;
  v_owner_readable CONSTANT TEXT[] := ARRAY[
    'agent_actions',
    'approvals',
    'agent_authorizations',
    'payment_intents',
    'plan_derived_state',
    'plan_versions',
    'plan_revisions',
    'planner_plan_updates',
    'plan_activity',
    'audit_logs',
    'agent_action_audit_log',
    'agent_runs',
    'venue_booking_approval_audit',
    'plan_messages',
    'outreach_threads',
    'outreach_messages',
    'creator_outreach_policies',
    'venue_opportunity_briefs',
    'venue_opportunity_invites',
    'vendor_opportunity_briefs',
    'vendor_opportunity_invites',
    'vendor_transactions',
    'platform_fee_transactions',
    'settlement_charges'
  ];
  v_service_only CONSTANT TEXT[] := ARRAY[
    'admin_tasks',
    'kickback_payments'
  ];
  v_required_constraints CONSTANT TEXT[] := ARRAY[
    'agent_actions_id_plan_id_key',
    'approvals_id_plan_id_key',
    'approvals_id_settlement_run_id_key',
    'approvals_action_plan_consistency_fkey',
    'approvals_authorized_not_above_requested_check',
    'payment_intents_approval_plan_consistency_fkey',
    'settlement_charges_approval_run_consistency_fkey'
  ];
BEGIN
  FOREACH v_table IN ARRAY v_owner_readable LOOP
    IF NOT has_table_privilege('authenticated', format('public.%I', v_table), 'SELECT') THEN
      RAISE EXCEPTION 'authenticated lacks SELECT on owner-readable table %', v_table;
    END IF;
    IF has_table_privilege('authenticated', format('public.%I', v_table), 'INSERT,UPDATE,DELETE') THEN
      RAISE EXCEPTION 'authenticated retains DML on trusted table %', v_table;
    END IF;
    IF has_table_privilege('anon', format('public.%I', v_table), 'SELECT,INSERT,UPDATE,DELETE') THEN
      RAISE EXCEPTION 'anon retains access on trusted table %', v_table;
    END IF;
    IF NOT has_table_privilege('service_role', format('public.%I', v_table), 'SELECT,INSERT,UPDATE,DELETE') THEN
      RAISE EXCEPTION 'service_role lacks required access on trusted table %', v_table;
    END IF;
  END LOOP;

  FOREACH v_table IN ARRAY v_service_only LOOP
    IF has_table_privilege('authenticated', format('public.%I', v_table), 'SELECT,INSERT,UPDATE,DELETE')
      OR has_table_privilege('anon', format('public.%I', v_table), 'SELECT,INSERT,UPDATE,DELETE') THEN
      RAISE EXCEPTION 'browser role retains access on service-only table %', v_table;
    END IF;
    IF NOT has_table_privilege('service_role', format('public.%I', v_table), 'SELECT,INSERT,UPDATE,DELETE') THEN
      RAISE EXCEPTION 'service_role lacks required access on service-only table %', v_table;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = ANY(v_owner_readable || v_service_only)
      AND cmd <> 'SELECT'
      AND (
        NOT ('service_role' = ANY(roles))
        OR cardinality(roles) <> 1
      )
  ) THEN
    RAISE EXCEPTION 'A trusted table has a browser mutation policy';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(v_owner_readable || v_service_only) expected(table_name)
    LEFT JOIN pg_class relation
      ON relation.oid = format('public.%I', expected.table_name)::regclass
    WHERE NOT relation.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'A trusted table does not have RLS enabled';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(v_required_constraints) expected(constraint_name)
    LEFT JOIN pg_constraint constraint_row
      ON constraint_row.conname = expected.constraint_name
    WHERE constraint_row.oid IS NULL
      OR NOT constraint_row.convalidated
  ) THEN
    RAISE EXCEPTION 'A required execution control-plane constraint is missing or unvalidated';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'approvals_one_active_per_action'
      AND indexdef LIKE '%WHERE (status = ANY%pending%approved%authorized%re_approval_required%'
  ) THEN
    RAISE EXCEPTION 'The active-approval unique index is missing or has the wrong status set';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace
      AND proname IN (
        'enforce_agent_action_approval_consistency',
        'enforce_approval_execution_invariants'
      )
      AND NOT prosecdef
  ) <> 2 THEN
    RAISE EXCEPTION 'Control-plane invariant functions are missing or are not SECURITY INVOKER';
  END IF;

  IF has_function_privilege('authenticated', 'public.enforce_agent_action_approval_consistency()', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.enforce_approval_execution_invariants()', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated can directly execute a control-plane trigger function';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.agent_actions'::regclass
      AND tgname = 'enforce_agent_action_approval_consistency_trigger'
      AND tgenabled <> 'D'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.approvals'::regclass
      AND tgname = 'enforce_approval_execution_invariants_trigger'
      AND tgenabled <> 'D'
  ) THEN
    RAISE EXCEPTION 'A control-plane invariant trigger is missing or disabled';
  END IF;

  RAISE NOTICE 'Hosted execution control-plane verification passed for % owner-readable and % service-only tables.',
    cardinality(v_owner_readable), cardinality(v_service_only);
END;
$verify$;

SELECT
  relation.oid::regclass::TEXT AS relation,
  relation.relrowsecurity AS rls_enabled,
  has_table_privilege('anon', relation.oid, 'SELECT,INSERT,UPDATE,DELETE') AS anon_access,
  has_table_privilege('authenticated', relation.oid, 'SELECT') AS authenticated_select,
  has_table_privilege('authenticated', relation.oid, 'INSERT,UPDATE,DELETE') AS authenticated_dml,
  has_table_privilege('service_role', relation.oid, 'SELECT,INSERT,UPDATE,DELETE') AS service_access
FROM pg_class relation
JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
WHERE namespace.nspname = 'public'
  AND relation.relname IN (
    'agent_actions', 'approvals', 'admin_tasks', 'agent_authorizations',
    'payment_intents', 'plan_derived_state', 'plan_versions', 'plan_revisions',
    'planner_plan_updates', 'plan_activity', 'audit_logs',
    'agent_action_audit_log', 'agent_runs', 'venue_booking_approval_audit',
    'plan_messages', 'outreach_threads', 'outreach_messages',
    'creator_outreach_policies', 'venue_opportunity_briefs',
    'venue_opportunity_invites', 'vendor_opportunity_briefs',
    'vendor_opportunity_invites', 'vendor_transactions',
    'platform_fee_transactions', 'kickback_payments', 'settlement_charges'
  )
ORDER BY relation.relname;

ROLLBACK;
