-- Migration: Add support tickets
-- Created: 2026-06-25
-- Context: Gives pilot users an in-app and public support path before paid launch.

CREATE TABLE IF NOT EXISTS public.support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id VARCHAR(32) UNIQUE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  email VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  category VARCHAR(32) NOT NULL,
  subject TEXT NOT NULL,
  description TEXT NOT NULL,
  severity VARCHAR(16) NOT NULL,
  related_plan_id UUID REFERENCES public.plans(id) ON DELETE SET NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'open',
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  resolution_notes TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT support_tickets_category_check
    CHECK (category IN ('bug', 'question', 'billing', 'account', 'feature_request', 'other')),
  CONSTRAINT support_tickets_severity_check
    CHECK (severity IN ('low', 'medium', 'high', 'urgent')),
  CONSTRAINT support_tickets_status_check
    CHECK (status IN ('open', 'in_progress', 'resolved', 'closed'))
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_user_created
  ON public.support_tickets (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_support_tickets_status_severity
  ON public.support_tickets (status, severity, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_support_tickets_related_plan
  ON public.support_tickets (related_plan_id)
  WHERE related_plan_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.set_support_ticket_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_support_ticket_updated_at ON public.support_tickets;
CREATE TRIGGER set_support_ticket_updated_at
  BEFORE UPDATE ON public.support_tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.set_support_ticket_updated_at();

ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read their own support tickets" ON public.support_tickets;
CREATE POLICY "Users can read their own support tickets"
  ON public.support_tickets
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins can read all support tickets" ON public.support_tickets;
CREATE POLICY "Admins can read all support tickets"
  ON public.support_tickets
  FOR SELECT
  USING (
    COALESCE((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false)
    OR COALESCE((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean, false)
  );

DROP POLICY IF EXISTS "Admins can update support tickets" ON public.support_tickets;
CREATE POLICY "Admins can update support tickets"
  ON public.support_tickets
  FOR UPDATE
  USING (
    COALESCE((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false)
    OR COALESCE((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean, false)
  )
  WITH CHECK (
    COALESCE((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false)
    OR COALESCE((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean, false)
  );

COMMENT ON TABLE public.support_tickets IS
'Support tickets submitted from authenticated planner users or the public support form. Service-role routes insert rows; users can read their own ticket history.';

COMMENT ON COLUMN public.support_tickets.metadata IS
'Context captured at submission time, including auth state, plan summary, URL, user agent, and email delivery result.';
