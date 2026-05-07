-- Migration: Add admin concierge action audit tables
-- Created: 2026-05-04
-- Context: Internal operators need an auditable queue for venue opportunity
-- invites that cannot auto-send or need manual follow-up before response.

CREATE TABLE IF NOT EXISTS public.concierge_actions (
  id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  invite_id UUID NOT NULL REFERENCES public.venue_opportunity_invites(id) ON DELETE CASCADE,
  admin_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action_type TEXT NOT NULL,
  notes TEXT,
  outcome_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT concierge_actions_action_type_check
    CHECK (action_type IN ('outreach_attempt', 'response_logged', 'status_override', 'reassigned'))
);

COMMENT ON TABLE public.concierge_actions IS
  'Internal action log for venue opportunity invites handled by admin or concierge operators.';

CREATE INDEX IF NOT EXISTS idx_concierge_actions_invite_created_at
  ON public.concierge_actions(invite_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_concierge_actions_admin_created_at
  ON public.concierge_actions(admin_user_id, created_at DESC);

ALTER TABLE public.concierge_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role can manage concierge actions" ON public.concierge_actions;
CREATE POLICY "Service role can manage concierge actions"
  ON public.concierge_actions FOR ALL
  USING (auth.jwt()->>'role' = 'service_role')
  WITH CHECK (auth.jwt()->>'role' = 'service_role');

GRANT ALL ON TABLE public.concierge_actions TO service_role;

CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  admin_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  before_state JSONB,
  after_state JSONB,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.admin_audit_log IS
  'Service-role-only audit trail for internal admin mutations.';

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_admin_created_at
  ON public.admin_audit_log(admin_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_entity
  ON public.admin_audit_log(entity_type, entity_id);

ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role can manage admin audit log" ON public.admin_audit_log;
CREATE POLICY "Service role can manage admin audit log"
  ON public.admin_audit_log FOR ALL
  USING (auth.jwt()->>'role' = 'service_role')
  WITH CHECK (auth.jwt()->>'role' = 'service_role');

GRANT ALL ON TABLE public.admin_audit_log TO service_role;
