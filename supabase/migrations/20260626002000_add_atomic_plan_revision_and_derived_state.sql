-- Migration: Add atomic plan revision RPC and derived-state cache
-- Created: 2026-06-26
--
-- Context:
-- Plan revisions supersede recommendations, approvals, and outreach. The
-- multi-step write must be atomic so stale approvals cannot remain executable
-- after a material plan change.

ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS brief_render_version INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS derived_state_recomputed_at TIMESTAMPTZ;

COMMENT ON COLUMN public.plans.brief_render_version IS
  'Monotonic version incremented whenever cached event brief derived state is recomputed.';
COMMENT ON COLUMN public.plans.derived_state_recomputed_at IS
  'Timestamp of the latest derived event brief recompute.';

CREATE TABLE IF NOT EXISTS public.plan_derived_state (
  plan_id UUID PRIMARY KEY REFERENCES public.plans(id) ON DELETE CASCADE,
  profit_assumptions JSONB NOT NULL DEFAULT '{}'::jsonb,
  shopping_list JSONB NOT NULL DEFAULT '[]'::jsonb,
  authorization_cards JSONB NOT NULL DEFAULT '[]'::jsonb,
  baseline_source VARCHAR(32) NOT NULL DEFAULT 'default',
  baseline_n_events INTEGER,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  brief_render_version INTEGER NOT NULL DEFAULT 0
);

COMMENT ON TABLE public.plan_derived_state IS
  'Cached event brief inputs recomputed after plan revisions, discovery changes, and quote commitment changes.';
COMMENT ON COLUMN public.plan_derived_state.profit_assumptions IS
  'Derived profit-window inputs from plan, active recommendations, approvals, and committed quotes.';
COMMENT ON COLUMN public.plan_derived_state.shopping_list IS
  'Derived venue/vendor shopping list for the current plan version.';
COMMENT ON COLUMN public.plan_derived_state.authorization_cards IS
  'Active non-superseded approvals that can still be acted on.';
COMMENT ON COLUMN public.plan_derived_state.brief_render_version IS
  'Version matching plans.brief_render_version after recompute.';

ALTER TABLE public.plan_derived_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own plan derived state" ON public.plan_derived_state;
CREATE POLICY "Users can view own plan derived state"
  ON public.plan_derived_state FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.plans
      WHERE plans.id = plan_derived_state.plan_id
        AND plans.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can insert own plan derived state" ON public.plan_derived_state;
CREATE POLICY "Users can insert own plan derived state"
  ON public.plan_derived_state FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.plans
      WHERE plans.id = plan_derived_state.plan_id
        AND plans.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can update own plan derived state" ON public.plan_derived_state;
CREATE POLICY "Users can update own plan derived state"
  ON public.plan_derived_state FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM public.plans
      WHERE plans.id = plan_derived_state.plan_id
        AND plans.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.plans
      WHERE plans.id = plan_derived_state.plan_id
        AND plans.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Service role can manage plan derived state" ON public.plan_derived_state;
CREATE POLICY "Service role can manage plan derived state"
  ON public.plan_derived_state FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

GRANT SELECT, INSERT, UPDATE ON TABLE public.plan_derived_state TO authenticated;
GRANT ALL ON TABLE public.plan_derived_state TO service_role;

CREATE OR REPLACE FUNCTION public.apply_plan_revision_atomic(
  p_plan_id UUID,
  p_user_id UUID,
  p_trigger JSONB,
  p_source_message_id UUID DEFAULT NULL,
  p_plan_updates JSONB DEFAULT '{}'::jsonb,
  p_impact JSONB DEFAULT '{}'::jsonb,
  p_reason TEXT DEFAULT 'Plan changed; previous recommendation or approval requires review.'
) RETURNS TABLE (
  revision_id UUID,
  impact JSONB,
  new_revision_count INTEGER
) AS $$
DECLARE
  v_plan public.plans%ROWTYPE;
  v_revision_id UUID;
  v_audit_log_id UUID;
  v_revision_count INTEGER;
  v_superseded_at TIMESTAMPTZ := now();
BEGIN
  IF auth.role() <> 'service_role' AND auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'User mismatch for plan revision';
  END IF;

  SELECT *
  INTO v_plan
  FROM public.plans
  WHERE id = p_plan_id
    AND user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Plan not found or not owned by user';
  END IF;

  v_revision_count := COALESCE(v_plan.plan_revision_count, 0) + 1;

  UPDATE public.plans
  SET
    plan_revision_count = v_revision_count,
    metadata = COALESCE(p_plan_updates->'metadata', metadata),
    excluded_cuisines = CASE
      WHEN p_plan_updates ? 'excluded_cuisines'
        THEN ARRAY(SELECT jsonb_array_elements_text(p_plan_updates->'excluded_cuisines'))
      ELSE excluded_cuisines
    END,
    excluded_vendor_attributes = COALESCE(p_plan_updates->'excluded_vendor_attributes', excluded_vendor_attributes),
    preferred_vendor_attributes = COALESCE(p_plan_updates->'preferred_vendor_attributes', preferred_vendor_attributes),
    vendor_out_of_city_approved = COALESCE((p_plan_updates->>'vendor_out_of_city_approved')::BOOLEAN, vendor_out_of_city_approved),
    vendor_approved_adjacent_cities = CASE
      WHEN p_plan_updates ? 'vendor_approved_adjacent_cities'
        THEN ARRAY(SELECT jsonb_array_elements_text(p_plan_updates->'vendor_approved_adjacent_cities'))
      ELSE vendor_approved_adjacent_cities
    END,
    date_window_start = COALESCE(p_plan_updates->>'date_window_start', date_window_start),
    date_window_end = COALESCE(p_plan_updates->>'date_window_end', date_window_end),
    guest_count = COALESCE((p_plan_updates->>'guest_count')::INTEGER, guest_count),
    budget_cap_cents = COALESCE((p_plan_updates->>'budget_cap_cents')::INTEGER, budget_cap_cents),
    neighborhood = COALESCE(p_plan_updates->>'neighborhood', neighborhood),
    event_city = COALESCE(p_plan_updates->>'event_city', event_city),
    updated_at = v_superseded_at
  WHERE id = p_plan_id
    AND user_id = p_user_id;

  INSERT INTO public.plan_revisions (
    plan_id,
    triggered_by_user_id,
    trigger_type,
    trigger_payload,
    source_message_id,
    impact_summary,
    rediscovery_triggered_for
  ) VALUES (
    p_plan_id,
    p_user_id,
    p_trigger->>'type',
    p_trigger,
    p_source_message_id,
    p_impact,
    COALESCE(
      ARRAY(SELECT jsonb_array_elements_text(p_impact->'triggers_rediscovery')),
      '{}'::TEXT[]
    )
  )
  RETURNING id INTO v_revision_id;

  UPDATE public.recommendations
  SET
    status = 'superseded',
    superseded_at = v_superseded_at,
    superseded_by_revision_id = v_revision_id,
    metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
      'superseded_reason', p_reason,
      'superseded_at', v_superseded_at,
      'superseded_by_revision_id', v_revision_id
    )
  WHERE id IN (
    SELECT jsonb_array_elements_text(p_impact->'invalidated_recommendation_ids')::UUID
  );

  UPDATE public.approvals
  SET
    status = 'superseded',
    superseded_at = v_superseded_at,
    superseded_by_revision_id = v_revision_id,
    superseded_reason = p_reason
  WHERE id IN (
    SELECT jsonb_array_elements_text(p_impact->'superseded_approval_ids')::UUID
  )
    AND status IN ('pending', 'approved', 'authorized');

  UPDATE public.outreach_threads
  SET
    state = 'cancelled',
    needs_attention = TRUE,
    last_event_at = v_superseded_at
  WHERE id IN (
    SELECT jsonb_array_elements_text(p_impact->'superseded_outreach_thread_ids')::UUID
  )
    AND state = 'draft';

  UPDATE public.outreach_threads
  SET
    state = 'stale',
    needs_attention = TRUE,
    last_event_at = v_superseded_at
  WHERE id IN (
    SELECT jsonb_array_elements_text(p_impact->'superseded_outreach_thread_ids')::UUID
  )
    AND state IN ('awaiting_reply', 'in_negotiation');

  INSERT INTO public.outreach_messages (
    thread_id,
    direction,
    subject,
    body_text,
    headers_json
  )
  SELECT
    thread_id,
    'outbound',
    'Plan update superseded this outreach',
    p_reason,
    jsonb_build_object(
      'system_event', 'plan_revision_superseded',
      'revision_id', v_revision_id,
      'superseded_at', v_superseded_at
    )
  FROM (
    SELECT jsonb_array_elements_text(p_impact->'superseded_outreach_thread_ids')::UUID AS thread_id
  ) threads;

  UPDATE public.plan_messages
  SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
    'status', 'superseded',
    'superseded_at', v_superseded_at,
    'superseded_by_revision_id', v_revision_id,
    'superseded_reason', p_reason
  )
  WHERE plan_id = p_plan_id
    AND message_type = 'approval_request'
    AND (
      metadata->'approval'->>'id' IN (
        SELECT jsonb_array_elements_text(p_impact->'superseded_approval_ids')
      )
      OR metadata->>'approval_id' IN (
        SELECT jsonb_array_elements_text(p_impact->'superseded_approval_ids')
      )
    );

  INSERT INTO public.audit_logs (
    user_id,
    plan_id,
    action,
    entity_type,
    entity_id,
    before_state,
    after_state
  ) VALUES (
    p_user_id,
    p_plan_id,
    'planner.plan_revision.applied',
    'plan_revision',
    v_revision_id,
    to_jsonb(v_plan),
    jsonb_build_object(
      'trigger', p_trigger,
      'plan_updates', p_plan_updates,
      'source_message_id', p_source_message_id,
      'impact', p_impact
    )
  )
  RETURNING id INTO v_audit_log_id;

  UPDATE public.plan_revisions
  SET audit_log_id = v_audit_log_id
  WHERE id = v_revision_id;

  revision_id := v_revision_id;
  impact := p_impact;
  new_revision_count := v_revision_count;
  RETURN NEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

COMMENT ON FUNCTION public.apply_plan_revision_atomic(UUID, UUID, JSONB, UUID, JSONB, JSONB, TEXT) IS
  'Atomically applies plan revision updates, inserts audit records, and supersedes stale recommendations, approvals, and outreach threads.';

GRANT EXECUTE ON FUNCTION public.apply_plan_revision_atomic(UUID, UUID, JSONB, UUID, JSONB, JSONB, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_plan_revision_atomic(UUID, UUID, JSONB, UUID, JSONB, JSONB, TEXT) TO service_role;
