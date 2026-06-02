-- Migration: Add live event recommendations
-- Created: 2026-06-02
-- Context: Store deterministic live P&L trigger recommendations for organizer-facing
-- dashboards. Rows are scoped to the event builder/org.

CREATE TABLE IF NOT EXISTS public.live_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.builder_profiles(id) ON DELETE CASCADE,
  trigger_key text NOT NULL CHECK (
    trigger_key IN (
      'breakeven_crossed',
      'velocity_drop',
      'tier_imbalance',
      'refund_spike',
      'capacity_warning',
      'sellout_imminent',
      'cost_overrun',
      'margin_room_for_upgrade'
    )
  ),
  severity text NOT NULL CHECK (severity IN ('info', 'recommend', 'urgent')),
  suggested_action text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  agent_narrative text NOT NULL DEFAULT '',
  state text NOT NULL DEFAULT 'open' CHECK (
    state IN ('open', 'acknowledged', 'dismissed', 'acted_on')
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.live_recommendations IS
  'Live event P&L recommendations generated from deterministic trigger evidence and narrated by the economics agent.';
COMMENT ON COLUMN public.live_recommendations.org_id IS
  'Organizer scope. Uses builder_profiles.id until a dedicated organization membership table exists.';
COMMENT ON COLUMN public.live_recommendations.evidence IS
  'Exact deterministic trigger evidence that supports the recommendation.';

CREATE INDEX IF NOT EXISTS idx_live_recommendations_event
  ON public.live_recommendations(event_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_live_recommendations_org
  ON public.live_recommendations(org_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_live_recommendations_event_state
  ON public.live_recommendations(event_id, state, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_live_recommendations_open_trigger
  ON public.live_recommendations(event_id, trigger_key)
  WHERE state = 'open';

CREATE OR REPLACE FUNCTION public.validate_live_recommendation_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_builder_id uuid;
BEGIN
  SELECT events.builder_id
  INTO v_event_builder_id
  FROM public.events
  WHERE events.id = NEW.event_id;

  IF v_event_builder_id IS NULL THEN
    RAISE EXCEPTION 'Event % not found for live recommendation', NEW.event_id;
  END IF;

  IF NEW.org_id <> v_event_builder_id THEN
    RAISE EXCEPTION 'Live recommendation org_id must match the event builder scope';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_live_recommendation_scope
  ON public.live_recommendations;

CREATE TRIGGER validate_live_recommendation_scope
  BEFORE INSERT OR UPDATE OF event_id, org_id
  ON public.live_recommendations
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_live_recommendation_scope();

DROP TRIGGER IF EXISTS update_live_recommendations_updated_at
  ON public.live_recommendations;

CREATE TRIGGER update_live_recommendations_updated_at
  BEFORE UPDATE ON public.live_recommendations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.can_manage_live_recommendation_org(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1
      FROM public.builder_profiles
      WHERE builder_profiles.id = p_org_id
        AND builder_profiles.user_id = auth.uid()
    );
$$;

ALTER TABLE public.live_recommendations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members can view live recommendations"
  ON public.live_recommendations;
CREATE POLICY "Org members can view live recommendations"
  ON public.live_recommendations
  FOR SELECT
  USING (public.can_manage_live_recommendation_org(org_id));

DROP POLICY IF EXISTS "Org members can create live recommendations"
  ON public.live_recommendations;
CREATE POLICY "Org members can create live recommendations"
  ON public.live_recommendations
  FOR INSERT
  WITH CHECK (public.can_manage_live_recommendation_org(org_id));

DROP POLICY IF EXISTS "Org members can update live recommendations"
  ON public.live_recommendations;
CREATE POLICY "Org members can update live recommendations"
  ON public.live_recommendations
  FOR UPDATE
  USING (public.can_manage_live_recommendation_org(org_id))
  WITH CHECK (public.can_manage_live_recommendation_org(org_id));

DROP POLICY IF EXISTS "Org members can delete live recommendations"
  ON public.live_recommendations;
CREATE POLICY "Org members can delete live recommendations"
  ON public.live_recommendations
  FOR DELETE
  USING (public.can_manage_live_recommendation_org(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.live_recommendations TO authenticated;
GRANT ALL ON TABLE public.live_recommendations TO service_role;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.live_recommendations;
EXCEPTION
  WHEN duplicate_object OR undefined_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.event_sales_data;
EXCEPTION
  WHEN duplicate_object OR undefined_object THEN NULL;
END $$;
