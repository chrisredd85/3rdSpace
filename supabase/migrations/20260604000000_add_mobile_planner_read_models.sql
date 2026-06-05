-- Migration: Add mobile planner read models
-- Created: 2026-06-04
-- Context: Supports the mobile planner shell with plan-owned budget and
-- activity read models. Outreach-derived rows intentionally land later with
-- the outreach runtime; this migration only adds inert planner-owned tables.

CREATE TABLE IF NOT EXISTS public.plan_budget (
  plan_id uuid PRIMARY KEY REFERENCES public.plans(id) ON DELETE CASCADE,
  target_cents integer CHECK (target_cents IS NULL OR target_cents >= 0),
  buffer_target_cents integer CHECK (buffer_target_cents IS NULL OR buffer_target_cents >= 0),
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.plan_budget IS
  'Plan-scoped budget guardrails for the mobile planner read model. Amounts are integer cents.';

CREATE TABLE IF NOT EXISTS public.plan_budget_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES public.plans(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (
    category IN ('venue', 'food_bar', 'vendor', 'staff', 'marketing', 'ticketing', 'platform_fee', 'tax', 'buffer', 'other')
  ),
  label text NOT NULL,
  low_cents integer NOT NULL DEFAULT 0 CHECK (low_cents >= 0),
  high_cents integer NOT NULL DEFAULT 0 CHECK (high_cents >= 0),
  status text NOT NULL DEFAULT 'planned' CHECK (
    status IN ('planned', 'quoted', 'committed', 'paid', 'cancelled')
  ),
  source text NOT NULL DEFAULT 'manual' CHECK (
    source IN ('manual', 'recommendation', 'commitment', 'ticketing', 'system')
  ),
  source_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plan_budget_lines_range_check CHECK (low_cents <= high_cents)
);

COMMENT ON TABLE public.plan_budget_lines IS
  'Plan-scoped budget line ranges used by mobile planner budget summaries. Amounts are integer cents.';

CREATE INDEX IF NOT EXISTS idx_plan_budget_lines_plan
  ON public.plan_budget_lines(plan_id);

CREATE INDEX IF NOT EXISTS idx_plan_budget_lines_plan_status
  ON public.plan_budget_lines(plan_id, status);

CREATE TABLE IF NOT EXISTS public.plan_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES public.plans(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (
    kind IN ('plan_update', 'approval', 'payment', 'ticketing', 'budget', 'problem', 'system')
  ),
  summary text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.plan_activity IS
  'Plan-scoped activity rows for the mobile planner feed. Outreach activity is intentionally excluded until the outreach runtime lands.';

CREATE INDEX IF NOT EXISTS idx_plan_activity_plan_occurred
  ON public.plan_activity(plan_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION public.can_manage_plan_read_model(p_plan_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1
      FROM public.plans
      WHERE plans.id = p_plan_id
        AND plans.user_id = auth.uid()
    );
$$;

DROP TRIGGER IF EXISTS update_plan_budget_updated_at
  ON public.plan_budget;
CREATE TRIGGER update_plan_budget_updated_at
  BEFORE UPDATE ON public.plan_budget
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_plan_budget_lines_updated_at
  ON public.plan_budget_lines;
CREATE TRIGGER update_plan_budget_lines_updated_at
  BEFORE UPDATE ON public.plan_budget_lines
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.plan_budget ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plan_budget_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plan_activity ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Plan owners can view plan budget" ON public.plan_budget;
CREATE POLICY "Plan owners can view plan budget"
  ON public.plan_budget
  FOR SELECT
  USING (public.can_manage_plan_read_model(plan_id));

DROP POLICY IF EXISTS "Plan owners can insert plan budget" ON public.plan_budget;
CREATE POLICY "Plan owners can insert plan budget"
  ON public.plan_budget
  FOR INSERT
  WITH CHECK (public.can_manage_plan_read_model(plan_id));

DROP POLICY IF EXISTS "Plan owners can update plan budget" ON public.plan_budget;
CREATE POLICY "Plan owners can update plan budget"
  ON public.plan_budget
  FOR UPDATE
  USING (public.can_manage_plan_read_model(plan_id))
  WITH CHECK (public.can_manage_plan_read_model(plan_id));

DROP POLICY IF EXISTS "Plan owners can delete plan budget" ON public.plan_budget;
CREATE POLICY "Plan owners can delete plan budget"
  ON public.plan_budget
  FOR DELETE
  USING (public.can_manage_plan_read_model(plan_id));

DROP POLICY IF EXISTS "Plan owners can view plan budget lines" ON public.plan_budget_lines;
CREATE POLICY "Plan owners can view plan budget lines"
  ON public.plan_budget_lines
  FOR SELECT
  USING (public.can_manage_plan_read_model(plan_id));

DROP POLICY IF EXISTS "Plan owners can insert plan budget lines" ON public.plan_budget_lines;
CREATE POLICY "Plan owners can insert plan budget lines"
  ON public.plan_budget_lines
  FOR INSERT
  WITH CHECK (public.can_manage_plan_read_model(plan_id));

DROP POLICY IF EXISTS "Plan owners can update plan budget lines" ON public.plan_budget_lines;
CREATE POLICY "Plan owners can update plan budget lines"
  ON public.plan_budget_lines
  FOR UPDATE
  USING (public.can_manage_plan_read_model(plan_id))
  WITH CHECK (public.can_manage_plan_read_model(plan_id));

DROP POLICY IF EXISTS "Plan owners can delete plan budget lines" ON public.plan_budget_lines;
CREATE POLICY "Plan owners can delete plan budget lines"
  ON public.plan_budget_lines
  FOR DELETE
  USING (public.can_manage_plan_read_model(plan_id));

DROP POLICY IF EXISTS "Plan owners can view plan activity" ON public.plan_activity;
CREATE POLICY "Plan owners can view plan activity"
  ON public.plan_activity
  FOR SELECT
  USING (public.can_manage_plan_read_model(plan_id));

DROP POLICY IF EXISTS "Plan owners can insert plan activity" ON public.plan_activity;
CREATE POLICY "Plan owners can insert plan activity"
  ON public.plan_activity
  FOR INSERT
  WITH CHECK (public.can_manage_plan_read_model(plan_id));

DROP POLICY IF EXISTS "Plan owners can update plan activity" ON public.plan_activity;
CREATE POLICY "Plan owners can update plan activity"
  ON public.plan_activity
  FOR UPDATE
  USING (public.can_manage_plan_read_model(plan_id))
  WITH CHECK (public.can_manage_plan_read_model(plan_id));

DROP POLICY IF EXISTS "Plan owners can delete plan activity" ON public.plan_activity;
CREATE POLICY "Plan owners can delete plan activity"
  ON public.plan_activity
  FOR DELETE
  USING (public.can_manage_plan_read_model(plan_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.plan_budget TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.plan_budget_lines TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.plan_activity TO authenticated;
GRANT ALL ON TABLE public.plan_budget TO service_role;
GRANT ALL ON TABLE public.plan_budget_lines TO service_role;
GRANT ALL ON TABLE public.plan_activity TO service_role;
