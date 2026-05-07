-- Migration: Add security and observability hardening
-- Created: 2026-05-04
-- Context: Adds planner action transition audit logs and a bounded client/server
-- error log sink used by route-group error boundaries and smoke-test diagnostics.

CREATE TABLE IF NOT EXISTS public.agent_action_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id UUID REFERENCES public.agent_actions(id) ON DELETE SET NULL,
  plan_id UUID REFERENCES public.plans(id) ON DELETE SET NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_role TEXT NOT NULL DEFAULT 'user',
  reason TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.agent_action_audit_log IS
  'Append-only transition log for planner agent action lifecycle changes.';

CREATE INDEX IF NOT EXISTS idx_agent_action_audit_log_action_created_at
  ON public.agent_action_audit_log(action_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_action_audit_log_plan_created_at
  ON public.agent_action_audit_log(plan_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.error_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  source TEXT NOT NULL,
  message TEXT NOT NULL,
  stack TEXT,
  path TEXT,
  user_agent TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.error_logs IS
  'Bounded application error reports captured from route error boundaries and client logging.';

CREATE INDEX IF NOT EXISTS idx_error_logs_source_created_at
  ON public.error_logs(source, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_logs_user_created_at
  ON public.error_logs(user_id, created_at DESC);

ALTER TABLE public.agent_action_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.error_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own agent action audit logs" ON public.agent_action_audit_log;
CREATE POLICY "Users can view own agent action audit logs"
  ON public.agent_action_audit_log FOR SELECT
  USING (plan_id IN (SELECT id FROM public.plans WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Users can create own agent action audit logs" ON public.agent_action_audit_log;
CREATE POLICY "Users can create own agent action audit logs"
  ON public.agent_action_audit_log FOR INSERT
  WITH CHECK (
    actor_id = auth.uid()
    AND plan_id IN (SELECT id FROM public.plans WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Service role can manage agent action audit logs" ON public.agent_action_audit_log;
CREATE POLICY "Service role can manage agent action audit logs"
  ON public.agent_action_audit_log FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role can manage error logs" ON public.error_logs;
CREATE POLICY "Service role can manage error logs"
  ON public.error_logs FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

GRANT SELECT, INSERT ON TABLE public.agent_action_audit_log TO authenticated;
GRANT ALL ON TABLE public.agent_action_audit_log TO service_role;
GRANT ALL ON TABLE public.error_logs TO service_role;
