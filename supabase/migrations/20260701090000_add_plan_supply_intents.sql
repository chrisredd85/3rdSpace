-- Migration: Add planner supply intents
-- Created: 2026-07-01
--
-- Context:
-- Activity-driven events such as tennis, bowling, basketball, Pilates, golf,
-- and cooking can require multiple supply categories before normal venue
-- sourcing is useful. Store those intent decisions beside plans so Google
-- Places sourcing, outreach approvals, event briefs, and analytics can agree
-- on what the agent is trying to find.

CREATE TABLE IF NOT EXISTS public.plan_supply_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES public.plans(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  activity_type TEXT,
  label TEXT NOT NULL,
  requirements JSONB NOT NULL DEFAULT '{}'::jsonb,
  confidence NUMERIC(4,3) NOT NULL DEFAULT 0.700,
  source TEXT NOT NULL DEFAULT 'intake',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT plan_supply_intents_category_check
    CHECK (category IN ('activity_facility', 'social_venue', 'instructor_vendor', 'watch_party', 'special_supply')),
  CONSTRAINT plan_supply_intents_source_check
    CHECK (source IN ('intake', 'clarification', 'reply_parsing', 'manual')),
  CONSTRAINT plan_supply_intents_confidence_check
    CHECK (confidence >= 0 AND confidence <= 1)
);

COMMENT ON TABLE public.plan_supply_intents IS
  'Normalized activity/supply intent rows for a planner plan. Mirrors plans.metadata.supply_intents for queryability and future analytics.';
COMMENT ON COLUMN public.plan_supply_intents.category IS
  'What supply category this plan needs: activity facility, social venue, instructor/vendor, watch party, or special supply.';
COMMENT ON COLUMN public.plan_supply_intents.activity_type IS
  'Activity keyword such as tennis, bowling, basketball, Pilates, golf, cooking, or art. Nullable for generic special supply.';
COMMENT ON COLUMN public.plan_supply_intents.requirements IS
  'Structured requirements extracted from intake or clarification, e.g. court count, group size, duration, or location constraints.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_plan_supply_intents_unique_active
  ON public.plan_supply_intents(plan_id, category, COALESCE(activity_type, ''));

CREATE INDEX IF NOT EXISTS idx_plan_supply_intents_plan
  ON public.plan_supply_intents(plan_id, category, activity_type);

DROP TRIGGER IF EXISTS update_plan_supply_intents_updated_at
  ON public.plan_supply_intents;
CREATE TRIGGER update_plan_supply_intents_updated_at
  BEFORE UPDATE ON public.plan_supply_intents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.plan_supply_intents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Plan owners can read supply intents"
  ON public.plan_supply_intents;
CREATE POLICY "Plan owners can read supply intents"
  ON public.plan_supply_intents FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.plans
      WHERE plans.id = plan_supply_intents.plan_id
        AND plans.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Plan owners can create supply intents"
  ON public.plan_supply_intents;
CREATE POLICY "Plan owners can create supply intents"
  ON public.plan_supply_intents FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.plans
      WHERE plans.id = plan_supply_intents.plan_id
        AND plans.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Plan owners can update supply intents"
  ON public.plan_supply_intents;
CREATE POLICY "Plan owners can update supply intents"
  ON public.plan_supply_intents FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.plans
      WHERE plans.id = plan_supply_intents.plan_id
        AND plans.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.plans
      WHERE plans.id = plan_supply_intents.plan_id
        AND plans.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Plan owners can delete supply intents"
  ON public.plan_supply_intents;
CREATE POLICY "Plan owners can delete supply intents"
  ON public.plan_supply_intents FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.plans
      WHERE plans.id = plan_supply_intents.plan_id
        AND plans.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Service role can manage supply intents"
  ON public.plan_supply_intents;
CREATE POLICY "Service role can manage supply intents"
  ON public.plan_supply_intents FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

GRANT SELECT, INSERT, UPDATE, DELETE ON public.plan_supply_intents TO authenticated;
GRANT ALL ON public.plan_supply_intents TO service_role;
