-- P0.3: make planner execution, approval, outreach, and audit state server-owned.
--
-- Browser roles retain only the owner-scoped SELECT policies that are safe for
-- product rendering. All mutations require service_role and therefore pass
-- through an authenticated, caller-validating API route or reviewed RPC.
--
-- IMPORTANT: this migration intentionally fails when historical authorization
-- contradictions exist. Do not rewrite, deduplicate, or invent authorization
-- history in a schema migration. Run scripts/security/preflight-server-owned-
-- execution.sql first and remediate each row with an auditable operator action.

-- ---------------------------------------------------------------------------
-- Fail-closed historical preflight
-- ---------------------------------------------------------------------------

DO $preflight$
DECLARE
  v_count BIGINT;
BEGIN
  SELECT count(*)
  INTO v_count
  FROM (
    SELECT approval.agent_action_id
    FROM public.approvals approval
    WHERE approval.status IN ('pending', 'approved', 'authorized', 're_approval_required')
    GROUP BY approval.agent_action_id
    HAVING count(*) > 1
  ) duplicate_active;

  IF v_count > 0 THEN
    RAISE EXCEPTION 'execution_control_plane_preflight: % action(s) have multiple active approvals', v_count
      USING ERRCODE = 'P0001',
            HINT = 'Run scripts/security/preflight-server-owned-execution.sql and explicitly supersede invalid historical rows.';
  END IF;

  SELECT count(*)
  INTO v_count
  FROM public.approvals approval
  JOIN public.agent_actions action ON action.id = approval.agent_action_id
  WHERE approval.plan_id IS DISTINCT FROM action.plan_id;

  IF v_count > 0 THEN
    RAISE EXCEPTION 'execution_control_plane_preflight: % approval/action plan mismatch(es)', v_count
      USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*)
  INTO v_count
  FROM public.agent_actions action
  LEFT JOIN public.approvals approval
    ON approval.id = action.approval_id
   AND approval.agent_action_id = action.id
   AND approval.plan_id = action.plan_id
  WHERE action.approval_id IS NOT NULL
    AND approval.id IS NULL;

  IF v_count > 0 THEN
    RAISE EXCEPTION 'execution_control_plane_preflight: % action approval pointer mismatch(es)', v_count
      USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*)
  INTO v_count
  FROM public.approvals approval
  WHERE approval.authorized_amount_cents IS NOT NULL
    AND approval.authorized_amount_cents > approval.requested_amount_cents;

  IF v_count > 0 THEN
    RAISE EXCEPTION 'execution_control_plane_preflight: % approval(s) authorize more than requested', v_count
      USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*)
  INTO v_count
  FROM public.approvals approval
  WHERE approval.status IN ('approved', 'authorized')
    AND (
      approval.authorized_by IS NULL
      OR approval.authorized_at IS NULL
      OR NULLIF(btrim(approval.snapshot_hash), '') IS NULL
      OR (approval.expires_at IS NOT NULL AND approval.expires_at <= transaction_timestamp())
    );

  IF v_count > 0 THEN
    RAISE EXCEPTION 'execution_control_plane_preflight: % executable approval(s) lack actor, timestamp, snapshot, or are expired', v_count
      USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*)
  INTO v_count
  FROM public.payment_intents payment
  LEFT JOIN public.approvals approval ON approval.id = payment.approval_id
  WHERE approval.id IS NULL;

  IF v_count > 0 THEN
    RAISE EXCEPTION 'execution_control_plane_preflight: % payment intent(s) reference a missing approval', v_count
      USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*)
  INTO v_count
  FROM public.payment_intents payment
  JOIN public.approvals approval ON approval.id = payment.approval_id
  WHERE payment.plan_id IS DISTINCT FROM approval.plan_id;

  IF v_count > 0 THEN
    RAISE EXCEPTION 'execution_control_plane_preflight: % payment intent approval/plan mismatch(es)', v_count
      USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*)
  INTO v_count
  FROM public.settlement_charges charge
  LEFT JOIN public.approvals approval ON approval.id = charge.approval_id
  WHERE charge.approval_id IS NOT NULL
    AND approval.id IS NULL;

  IF v_count > 0 THEN
    RAISE EXCEPTION 'execution_control_plane_preflight: % settlement charge(s) reference a missing approval', v_count
      USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*)
  INTO v_count
  FROM public.settlement_charges charge
  JOIN public.approvals approval ON approval.id = charge.approval_id
  WHERE charge.approval_id IS NOT NULL
    AND charge.settlement_run_id IS DISTINCT FROM approval.settlement_run_id;

  IF v_count > 0 THEN
    RAISE EXCEPTION 'execution_control_plane_preflight: % settlement charge approval/run mismatch(es)', v_count
      USING ERRCODE = 'P0001';
  END IF;
END;
$preflight$;

-- ---------------------------------------------------------------------------
-- Relational and state-machine invariants
-- ---------------------------------------------------------------------------

-- Composite keys let PostgreSQL enforce aggregate identity without trusting
-- caller-supplied plan ids. The leading id remains the canonical identifier.
ALTER TABLE public.agent_actions
  ADD CONSTRAINT agent_actions_id_plan_id_key UNIQUE (id, plan_id);

ALTER TABLE public.approvals
  ADD CONSTRAINT approvals_id_plan_id_key UNIQUE (id, plan_id),
  ADD CONSTRAINT approvals_id_settlement_run_id_key UNIQUE (id, settlement_run_id);

ALTER TABLE public.approvals
  ADD CONSTRAINT approvals_action_plan_consistency_fkey
  FOREIGN KEY (agent_action_id, plan_id)
  REFERENCES public.agent_actions(id, plan_id)
  ON DELETE CASCADE;

ALTER TABLE public.payment_intents
  ADD CONSTRAINT payment_intents_approval_plan_consistency_fkey
  FOREIGN KEY (approval_id, plan_id)
  REFERENCES public.approvals(id, plan_id)
  ON DELETE RESTRICT;

-- approval_id is nullable so a deleted approval can be detached by the legacy
-- single-column ON DELETE SET NULL relationship while the financial ledger is
-- preserved. Whenever it is present, it must authorize this settlement run.
ALTER TABLE public.settlement_charges
  ADD CONSTRAINT settlement_charges_approval_run_consistency_fkey
  FOREIGN KEY (approval_id, settlement_run_id)
  REFERENCES public.approvals(id, settlement_run_id);

CREATE UNIQUE INDEX approvals_one_active_per_action
  ON public.approvals(agent_action_id)
  WHERE status IN ('pending', 'approved', 'authorized', 're_approval_required');

COMMENT ON INDEX public.approvals_one_active_per_action IS
  'At most one non-terminal approval may authorize an action. Prompt 6 must supersede an old approval before inserting its replacement.';

ALTER TABLE public.approvals
  ADD CONSTRAINT approvals_authorized_not_above_requested_check
  CHECK (
    authorized_amount_cents IS NULL
    OR authorized_amount_cents <= requested_amount_cents
  );

-- A trigger is required instead of a CHECK because expiry is evaluated at the
-- transition timestamp. Both approved and authorized are executable in
-- lib/planner/execution/approvalState.ts and therefore share the invariant.
CREATE OR REPLACE FUNCTION public.enforce_approval_execution_invariants()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.status IN ('approved', 'authorized') THEN
    IF NEW.authorized_by IS NULL OR NEW.authorized_at IS NULL THEN
      RAISE EXCEPTION 'approval_executable_requires_actor_and_timestamp'
        USING ERRCODE = '23514',
              CONSTRAINT = 'approvals_executable_actor_timestamp_check';
    END IF;

    IF NULLIF(btrim(NEW.snapshot_hash), '') IS NULL THEN
      RAISE EXCEPTION 'approval_executable_requires_snapshot_hash'
        USING ERRCODE = '23514',
              CONSTRAINT = 'approvals_executable_snapshot_check';
    END IF;

    IF NEW.expires_at IS NOT NULL AND NEW.expires_at <= transaction_timestamp() THEN
      RAISE EXCEPTION 'approval_executable_cannot_be_expired'
        USING ERRCODE = '23514',
              CONSTRAINT = 'approvals_executable_expiry_check';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_approval_execution_invariants()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_approval_execution_invariants()
  TO service_role;

DROP TRIGGER IF EXISTS enforce_approval_execution_invariants_trigger
  ON public.approvals;
CREATE TRIGGER enforce_approval_execution_invariants_trigger
  BEFORE INSERT OR UPDATE ON public.approvals
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_approval_execution_invariants();

-- agent_actions.approval_id is the reciprocal pointer. A trigger is used here
-- rather than another circular foreign key so the existing approval deletion
-- behavior can continue to set only approval_id to NULL while preserving the
-- action and its plan identity.
CREATE OR REPLACE FUNCTION public.enforce_agent_action_approval_consistency()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.approval_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.approvals approval
    WHERE approval.id = NEW.approval_id
      AND approval.agent_action_id = NEW.id
      AND approval.plan_id = NEW.plan_id
  ) THEN
    RAISE EXCEPTION 'agent_action_approval_pointer_mismatch'
      USING ERRCODE = '23514',
            CONSTRAINT = 'agent_actions_approval_reciprocal_check';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_agent_action_approval_consistency()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_agent_action_approval_consistency()
  TO service_role;

DROP TRIGGER IF EXISTS enforce_agent_action_approval_consistency_trigger
  ON public.agent_actions;
CREATE TRIGGER enforce_agent_action_approval_consistency_trigger
  BEFORE INSERT OR UPDATE OF approval_id, plan_id ON public.agent_actions
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_agent_action_approval_consistency();

-- ---------------------------------------------------------------------------
-- RLS rewrite: retain safe SELECT; service_role owns every mutation
-- ---------------------------------------------------------------------------

DO $policies$
DECLARE
  v_table TEXT;
  v_policy RECORD;
  v_tables CONSTANT TEXT[] := ARRAY[
    'agent_actions',
    'approvals',
    'admin_tasks',
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
    'kickback_payments',
    'settlement_charges'
  ];
BEGIN
  FOREACH v_table IN ARRAY v_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);

    -- Drop INSERT/UPDATE/DELETE and broad ALL policies, including the older
    -- service policies; one consistent service policy is recreated below.
    FOR v_policy IN
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = v_table
        AND cmd <> 'SELECT'
    LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', v_policy.policyname, v_table);
    END LOOP;

    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I',
      'Service role manages trusted state',
      v_table
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
      'Service role manages trusted state',
      v_table
    );
  END LOOP;
END;
$policies$;

-- These brief tables previously used a single FOR ALL owner policy. Restore
-- only the owner-scoped read half after the mutation policy is removed.
DROP POLICY IF EXISTS "Builders can view own opportunity briefs"
  ON public.venue_opportunity_briefs;
CREATE POLICY "Builders can view own opportunity briefs"
  ON public.venue_opportunity_briefs
  FOR SELECT TO authenticated
  USING (organizer_user_id = auth.uid());

DROP POLICY IF EXISTS "Builders can view own vendor opportunity briefs"
  ON public.vendor_opportunity_briefs;
CREATE POLICY "Builders can view own vendor opportunity briefs"
  ON public.vendor_opportunity_briefs
  FOR SELECT TO authenticated
  USING (organizer_user_id = auth.uid());

-- admin_tasks is an internal concierge queue. Its notes, metadata, assignment,
-- and operator status must never be selectable from the base table by a plan
-- owner. Hosts receive an explicitly projected status through a server route.
DROP POLICY IF EXISTS "Users can view own admin tasks" ON public.admin_tasks;

-- Revoke inherited/baseline grants as well as RLS mutation policies. This makes
-- the ACL itself match the reviewed classification instead of relying on RLS as
-- the only denial layer.
DO $grants$
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
BEGIN
  FOREACH v_table IN ARRAY v_owner_readable LOOP
    EXECUTE format(
      'REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC, anon, authenticated',
      v_table
    );
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', v_table);
    EXECUTE format('GRANT ALL PRIVILEGES ON TABLE public.%I TO service_role', v_table);
  END LOOP;

  FOREACH v_table IN ARRAY v_service_only LOOP
    EXECUTE format(
      'REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC, anon, authenticated',
      v_table
    );
    EXECUTE format('GRANT ALL PRIVILEGES ON TABLE public.%I TO service_role', v_table);
  END LOOP;
END;
$grants$;

COMMENT ON TABLE public.admin_tasks IS
  'Internal concierge and operations queue. Base-table access, including notes and metadata, is service-role only.';

COMMENT ON TABLE public.plan_messages IS
  'Planner conversation and approval-card cache. Owners may read; server routes exclusively create or mutate rows.';

COMMENT ON TABLE public.outreach_messages IS
  'Outbound/inbound execution record. Owners may read; service routes exclusively mutate delivery and autonomy state.';

COMMENT ON TABLE public.creator_outreach_policies IS
  'Versioned creator guardrails. Owners may read; validated service routes exclusively create policy versions or mutate policy state.';
