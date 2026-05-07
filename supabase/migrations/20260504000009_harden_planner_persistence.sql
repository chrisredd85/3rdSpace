-- Migration: Harden planner persistence and lifecycle transitions
-- Created: 2026-05-04
-- Context: The existing Agent Planner tables are the canonical persistence
-- layer. This migration adds missing structured fields, an update audit table,
-- and database-level lifecycle transition enforcement.

DO $$
BEGIN
  CREATE TYPE public.planner_plan_status AS ENUM (
    'drafting',
    'ready',
    'approved',
    'executing',
    'complete',
    'archived'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS ticketing_model TEXT,
  ADD COLUMN IF NOT EXISTS food_responsibility TEXT,
  ADD COLUMN IF NOT EXISTS venue_terms TEXT,
  ADD COLUMN IF NOT EXISTS agent_action TEXT;

ALTER TABLE public.plans
  DROP CONSTRAINT IF EXISTS plans_status_check;

ALTER TABLE public.plans
  ALTER COLUMN status DROP DEFAULT,
  ALTER COLUMN status TYPE public.planner_plan_status
    USING status::text::public.planner_plan_status,
  ALTER COLUMN status SET DEFAULT 'drafting'::public.planner_plan_status;

COMMENT ON COLUMN public.plans.ticketing_model IS
  'Planner intake answer for ticketing, such as free RSVP, paid admission, or external platform.';
COMMENT ON COLUMN public.plans.food_responsibility IS
  'Planner intake answer for food and beverage responsibility.';
COMMENT ON COLUMN public.plans.venue_terms IS
  'Planner intake answer for preferred venue deal structure.';
COMMENT ON COLUMN public.plans.agent_action IS
  'Planner intake answer for what the agent may do after recommendations.';

CREATE TABLE IF NOT EXISTS public.planner_plan_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES public.plans(id) ON DELETE CASCADE,
  field TEXT NOT NULL,
  old_value JSONB,
  new_value JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.planner_plan_updates IS
  'Field-level audit trail for planner plan mutations made through the planner API.';

CREATE INDEX IF NOT EXISTS idx_planner_plan_updates_plan_id_created_at
  ON public.planner_plan_updates(plan_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.enforce_planner_plan_status_transition()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'drafting'::public.planner_plan_status
    AND NEW.status IN ('ready'::public.planner_plan_status, 'archived'::public.planner_plan_status) THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'ready'::public.planner_plan_status
    AND NEW.status IN ('approved'::public.planner_plan_status, 'drafting'::public.planner_plan_status, 'archived'::public.planner_plan_status) THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'approved'::public.planner_plan_status
    AND NEW.status IN ('executing'::public.planner_plan_status, 'archived'::public.planner_plan_status) THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'executing'::public.planner_plan_status
    AND NEW.status IN ('complete'::public.planner_plan_status, 'archived'::public.planner_plan_status) THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'complete'::public.planner_plan_status
    AND NEW.status = 'archived'::public.planner_plan_status THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Illegal planner plan status transition from % to %', OLD.status, NEW.status
    USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS enforce_planner_plan_status_transition ON public.plans;
CREATE TRIGGER enforce_planner_plan_status_transition
  BEFORE UPDATE OF status ON public.plans
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_planner_plan_status_transition();

ALTER TABLE public.approvals
  ADD COLUMN IF NOT EXISTS plan_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'approvals_plan_id_fkey'
      AND conrelid = 'public.approvals'::regclass
  ) THEN
    ALTER TABLE public.approvals
      ADD CONSTRAINT approvals_plan_id_fkey
      FOREIGN KEY (plan_id) REFERENCES public.plans(id) ON DELETE CASCADE;
  END IF;
END $$;

ALTER TABLE public.planner_plan_updates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own planner plan updates" ON public.planner_plan_updates;
CREATE POLICY "Users can view own planner plan updates"
  ON public.planner_plan_updates FOR SELECT
  USING (plan_id IN (SELECT id FROM public.plans WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Users can create own planner plan updates" ON public.planner_plan_updates;
CREATE POLICY "Users can create own planner plan updates"
  ON public.planner_plan_updates FOR INSERT
  WITH CHECK (plan_id IN (SELECT id FROM public.plans WHERE user_id = auth.uid()));

GRANT ALL ON TABLE public.planner_plan_updates TO anon;
GRANT ALL ON TABLE public.planner_plan_updates TO authenticated;
GRANT ALL ON TABLE public.planner_plan_updates TO service_role;
