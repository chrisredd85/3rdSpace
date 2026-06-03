-- Migration: Add outreach autonomy policy engine
-- Created: 2026-06-01
-- Context: Phase 5 introduces earned autonomy behind explicit creator
-- guardrails, policy-version auditability, notifications, pause, and undo.

ALTER TABLE public.outreach_threads
  DROP CONSTRAINT IF EXISTS outreach_threads_state_check;
ALTER TABLE public.outreach_threads
  ADD CONSTRAINT outreach_threads_state_check
  CHECK (state IN (
    'draft',
    'awaiting_reply',
    'in_negotiation',
    'confirmed',
    'declined',
    'stale',
    'cancelled',
    'awaiting_creator_review'
  ));

ALTER TABLE public.outreach_messages
  ADD COLUMN IF NOT EXISTS scheduled_send_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS autonomous_send_after TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS autonomy_policy_id UUID,
  ADD COLUMN IF NOT EXISTS autonomy_policy_version INTEGER,
  ADD COLUMN IF NOT EXISTS autonomy_status TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS undo_expires_at TIMESTAMPTZ;

ALTER TABLE public.outreach_messages
  DROP CONSTRAINT IF EXISTS outreach_messages_autonomy_status_check;
ALTER TABLE public.outreach_messages
  ADD CONSTRAINT outreach_messages_autonomy_status_check
  CHECK (autonomy_status IN (
    'manual',
    'pending_approval',
    'blocked',
    'scheduled',
    'sent',
    'cancelled',
    'undone'
  ));

CREATE INDEX IF NOT EXISTS idx_outreach_messages_scheduled_autonomy
  ON public.outreach_messages(scheduled_send_at)
  WHERE autonomy_status = 'scheduled' AND cancelled_at IS NULL AND sent_at IS NULL;

COMMENT ON COLUMN public.outreach_messages.scheduled_send_at IS
  'When an allowed autonomous outbound message may be dispatched.';
COMMENT ON COLUMN public.outreach_messages.autonomy_policy_version IS
  'Policy version that permitted or blocked the autonomous action.';
COMMENT ON COLUMN public.outreach_messages.undo_expires_at IS
  'Creator undo window for autonomous actions. Phase 5 requires up to four hours.';

CREATE TABLE IF NOT EXISTS public.creator_outreach_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  max_unattended_budget_cents INTEGER NOT NULL DEFAULT 0,
  allowed_autonomous_actions TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  quiet_hours_start_local TIME,
  quiet_hours_end_local TIME,
  max_inquiries_per_event INTEGER NOT NULL DEFAULT 0,
  max_followups_per_thread INTEGER NOT NULL DEFAULT 0,
  blacklisted_venue_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  blacklisted_keywords TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  require_approval_for_first_contact BOOLEAN NOT NULL DEFAULT true,
  irreversible_autonomous_actions TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  trust_level INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT creator_outreach_policies_version_check
    CHECK (version > 0),
  CONSTRAINT creator_outreach_policies_budget_check
    CHECK (max_unattended_budget_cents >= 0),
  CONSTRAINT creator_outreach_policies_limits_check
    CHECK (max_inquiries_per_event >= 0 AND max_followups_per_thread >= 0),
  CONSTRAINT creator_outreach_policies_trust_check
    CHECK (trust_level BETWEEN 0 AND 100)
);

COMMENT ON TABLE public.creator_outreach_policies IS
  'Versioned creator guardrails for earned autonomous outreach.';
COMMENT ON COLUMN public.creator_outreach_policies.allowed_autonomous_actions IS
  'Explicit creator opt-in action list. Empty means the outreach agent has zero autonomy.';
COMMENT ON COLUMN public.creator_outreach_policies.irreversible_autonomous_actions IS
  'Policy-level consent for irreversible categories. MVP should keep this empty.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_creator_outreach_policies_user_version
  ON public.creator_outreach_policies(user_id, version);

CREATE INDEX IF NOT EXISTS idx_creator_outreach_policies_latest
  ON public.creator_outreach_policies(user_id, version DESC);

DROP TRIGGER IF EXISTS update_creator_outreach_policies_updated_at ON public.creator_outreach_policies;
CREATE TRIGGER update_creator_outreach_policies_updated_at
  BEFORE UPDATE ON public.creator_outreach_policies
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.outreach_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  thread_id UUID REFERENCES public.outreach_threads(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT outreach_notifications_type_check
    CHECK (notification_type IN (
      'agent_acted_autonomously',
      'requires_approval',
      'quote_received',
      'booking_confirmed',
      'thread_stale',
      'policy_blocked_action'
    ))
);

COMMENT ON TABLE public.outreach_notifications IS
  'Creator-facing outreach events, including autonomous actions and policy blocks.';

CREATE INDEX IF NOT EXISTS idx_outreach_notifications_user_created
  ON public.outreach_notifications(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.outreach_policy_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  thread_id UUID REFERENCES public.outreach_threads(id) ON DELETE SET NULL,
  message_id UUID REFERENCES public.outreach_messages(id) ON DELETE SET NULL,
  policy_id UUID REFERENCES public.creator_outreach_policies(id) ON DELETE SET NULL,
  policy_version INTEGER,
  action TEXT NOT NULL,
  decision TEXT NOT NULL,
  reason TEXT NOT NULL,
  required_approval_type TEXT,
  model_name TEXT,
  human_intervened BOOLEAN NOT NULL DEFAULT false,
  context_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  result_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  reversible_until TIMESTAMPTZ,
  undone_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  retention_expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '2 years'),
  CONSTRAINT outreach_policy_audit_logs_decision_check
    CHECK (decision IN (
      'allowed',
      'blocked',
      'pending_approval',
      'autonomous_scheduled',
      'autonomous_sent',
      'manual_approval_required',
      'paused',
      'undone'
    ))
);

COMMENT ON TABLE public.outreach_policy_audit_logs IS
  'Two-year retained audit trail for policy gate decisions and autonomous outreach actions.';

CREATE INDEX IF NOT EXISTS idx_outreach_policy_audit_user_created
  ON public.outreach_policy_audit_logs(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_outreach_policy_audit_thread_created
  ON public.outreach_policy_audit_logs(thread_id, created_at DESC)
  WHERE thread_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.creator_outreach_trust_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  policy_id UUID REFERENCES public.creator_outreach_policies(id) ON DELETE SET NULL,
  policy_version INTEGER,
  trust_level INTEGER NOT NULL DEFAULT 0,
  metrics_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT creator_outreach_trust_history_trust_check
    CHECK (trust_level BETWEEN 0 AND 100)
);

COMMENT ON TABLE public.creator_outreach_trust_history IS
  'Weekly trust score snapshots for outreach autonomy observability.';

CREATE INDEX IF NOT EXISTS idx_creator_outreach_trust_history_user_computed
  ON public.creator_outreach_trust_history(user_id, computed_at DESC);

ALTER TABLE public.creator_outreach_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outreach_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outreach_policy_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creator_outreach_trust_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Creators can view own outreach policies" ON public.creator_outreach_policies;
CREATE POLICY "Creators can view own outreach policies"
  ON public.creator_outreach_policies FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Creators can create own outreach policies" ON public.creator_outreach_policies;
CREATE POLICY "Creators can create own outreach policies"
  ON public.creator_outreach_policies FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Creators can update own outreach policies" ON public.creator_outreach_policies;
CREATE POLICY "Creators can update own outreach policies"
  ON public.creator_outreach_policies FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Service role can manage outreach policies" ON public.creator_outreach_policies;
CREATE POLICY "Service role can manage outreach policies"
  ON public.creator_outreach_policies FOR ALL
  USING (auth.jwt()->>'role' = 'service_role')
  WITH CHECK (auth.jwt()->>'role' = 'service_role');

DROP POLICY IF EXISTS "Creators can view own outreach notifications" ON public.outreach_notifications;
CREATE POLICY "Creators can view own outreach notifications"
  ON public.outreach_notifications FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Creators can update own outreach notifications" ON public.outreach_notifications;
CREATE POLICY "Creators can update own outreach notifications"
  ON public.outreach_notifications FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Service role can manage outreach notifications" ON public.outreach_notifications;
CREATE POLICY "Service role can manage outreach notifications"
  ON public.outreach_notifications FOR ALL
  USING (auth.jwt()->>'role' = 'service_role')
  WITH CHECK (auth.jwt()->>'role' = 'service_role');

DROP POLICY IF EXISTS "Creators can view own outreach policy audit logs" ON public.outreach_policy_audit_logs;
CREATE POLICY "Creators can view own outreach policy audit logs"
  ON public.outreach_policy_audit_logs FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Service role can manage outreach policy audit logs" ON public.outreach_policy_audit_logs;
CREATE POLICY "Service role can manage outreach policy audit logs"
  ON public.outreach_policy_audit_logs FOR ALL
  USING (auth.jwt()->>'role' = 'service_role')
  WITH CHECK (auth.jwt()->>'role' = 'service_role');

DROP POLICY IF EXISTS "Creators can view own outreach trust history" ON public.creator_outreach_trust_history;
CREATE POLICY "Creators can view own outreach trust history"
  ON public.creator_outreach_trust_history FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Service role can manage outreach trust history" ON public.creator_outreach_trust_history;
CREATE POLICY "Service role can manage outreach trust history"
  ON public.creator_outreach_trust_history FOR ALL
  USING (auth.jwt()->>'role' = 'service_role')
  WITH CHECK (auth.jwt()->>'role' = 'service_role');

GRANT SELECT, INSERT, UPDATE ON public.creator_outreach_policies TO authenticated;
GRANT SELECT, UPDATE ON public.outreach_notifications TO authenticated;
GRANT SELECT ON public.outreach_policy_audit_logs TO authenticated;
GRANT SELECT ON public.creator_outreach_trust_history TO authenticated;
GRANT ALL ON public.creator_outreach_policies TO service_role;
GRANT ALL ON public.outreach_notifications TO service_role;
GRANT ALL ON public.outreach_policy_audit_logs TO service_role;
GRANT ALL ON public.creator_outreach_trust_history TO service_role;
