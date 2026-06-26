-- Migration: Add planner plan revision pipeline
-- Created: 2026-06-26
--
-- Context:
-- Organizer changes such as "no tacos", "I need flowers", date changes,
-- guest-count changes, or discovery-data changes must supersede stale
-- recommendations/approvals before any execution can happen.

ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS excluded_cuisines TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS excluded_vendor_attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS preferred_vendor_attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS plan_revision_count INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.plans.excluded_cuisines IS
  'Organizer-declared cuisines or food categories to exclude from future vendor discovery.';
COMMENT ON COLUMN public.plans.excluded_vendor_attributes IS
  'Organizer-declared vendor constraints to exclude from future discovery, such as no alcohol or no tacos.';
COMMENT ON COLUMN public.plans.preferred_vendor_attributes IS
  'Organizer-declared vendor preferences to boost in future discovery, such as delivery, Black-owned, or specific vendor names.';
COMMENT ON COLUMN public.plans.plan_revision_count IS
  'Monotonic count of material plan revisions that may invalidate recommendations, approvals, outreach, or financial assumptions.';

CREATE TABLE IF NOT EXISTS public.plan_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES public.plans(id) ON DELETE CASCADE,
  triggered_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  trigger_type VARCHAR(64) NOT NULL,
  trigger_payload JSONB NOT NULL,
  source_message_id UUID REFERENCES public.plan_messages(id) ON DELETE SET NULL,
  impact_summary JSONB NOT NULL,
  rediscovery_triggered_for TEXT[] NOT NULL DEFAULT '{}',
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  audit_log_id UUID REFERENCES public.audit_logs(id) ON DELETE SET NULL,
  CONSTRAINT plan_revisions_trigger_type_check
    CHECK (trigger_type IN (
      'negative_preference',
      'positive_preference',
      'vendor_stack_addition',
      'vendor_stack_removal',
      'date_change',
      'guest_count_change',
      'budget_change',
      'venue_swap',
      'scope_change',
      'discovery_data_changed'
    ))
);

COMMENT ON TABLE public.plan_revisions IS
  'Audit trail for organizer, admin, and discovery-data changes that can invalidate planner recommendations, approvals, outreach, or financial assumptions.';
COMMENT ON COLUMN public.plan_revisions.impact_summary IS
  'Structured summary of superseded recommendations, approvals, outreach threads, committed entities flagged for review, and rediscovery targets.';
COMMENT ON COLUMN public.plan_revisions.rediscovery_triggered_for IS
  'Service types or venue targets that should be rediscovered after this revision.';

CREATE INDEX IF NOT EXISTS idx_plan_revisions_plan_id
  ON public.plan_revisions(plan_id, applied_at DESC);

CREATE INDEX IF NOT EXISTS idx_plan_revisions_trigger_type
  ON public.plan_revisions(trigger_type, applied_at DESC);

ALTER TABLE public.recommendations
  ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS superseded_by_revision_id UUID REFERENCES public.plan_revisions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS plan_revision_at_creation INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'recommendations'
      AND constraint_name = 'recommendations_status_check'
  ) THEN
    ALTER TABLE public.recommendations
      DROP CONSTRAINT recommendations_status_check;
  END IF;
END $$;

ALTER TABLE public.recommendations
  ADD CONSTRAINT recommendations_status_check
  CHECK (status IN ('pending', 'selected', 'rejected', 'superseded', 'invalidated_entity_closed'));

COMMENT ON COLUMN public.recommendations.superseded_at IS
  'Timestamp when a material plan revision superseded this recommendation.';
COMMENT ON COLUMN public.recommendations.superseded_by_revision_id IS
  'Plan revision that superseded this recommendation.';
COMMENT ON COLUMN public.recommendations.plan_revision_at_creation IS
  'Plan revision count when this recommendation was created, used to detect stale cards.';

CREATE INDEX IF NOT EXISTS idx_recommendations_plan_status_revision
  ON public.recommendations(plan_id, status, plan_revision_at_creation);

ALTER TABLE public.approvals
  ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS superseded_by_revision_id UUID REFERENCES public.plan_revisions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS superseded_reason TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'approvals'
      AND constraint_name = 'approvals_status_check'
  ) THEN
    ALTER TABLE public.approvals
      DROP CONSTRAINT approvals_status_check;
  END IF;
END $$;

ALTER TABLE public.approvals
  ADD CONSTRAINT approvals_status_check
  CHECK (status IN (
    'pending',
    'approved',
    'authorized',
    'rejected',
    'cancelled',
    'expired',
    're_approval_required',
    'superseded'
  ));

COMMENT ON COLUMN public.approvals.superseded_at IS
  'Timestamp when a material plan revision superseded this approval.';
COMMENT ON COLUMN public.approvals.superseded_by_revision_id IS
  'Plan revision that superseded this approval.';
COMMENT ON COLUMN public.approvals.superseded_reason IS
  'Human-readable reason explaining why execution is blocked.';

CREATE INDEX IF NOT EXISTS idx_approvals_plan_superseded
  ON public.approvals(plan_id, superseded_at)
  WHERE superseded_at IS NOT NULL;

ALTER TABLE public.plan_revisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own plan revisions" ON public.plan_revisions;
CREATE POLICY "Users can view own plan revisions"
  ON public.plan_revisions FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.plans
      WHERE plans.id = plan_revisions.plan_id
        AND plans.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can create own plan revisions" ON public.plan_revisions;
CREATE POLICY "Users can create own plan revisions"
  ON public.plan_revisions FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.plans
      WHERE plans.id = plan_revisions.plan_id
        AND plans.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Service role can manage plan revisions" ON public.plan_revisions;
CREATE POLICY "Service role can manage plan revisions"
  ON public.plan_revisions FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

GRANT SELECT, INSERT ON TABLE public.plan_revisions TO authenticated;
GRANT ALL ON TABLE public.plan_revisions TO service_role;
