-- Migration: Add creator Gmail outreach loop
-- Created: 2026-06-01
-- Context: Phase 1 agentic outreach sends approved venue/vendor drafts from
-- the creator's own Gmail account and ingests replies into planner-owned
-- outreach threads.

CREATE TABLE IF NOT EXISTS public.creator_email_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'gmail',
  email_address TEXT NOT NULL,
  oauth_access_token TEXT NOT NULL,
  oauth_refresh_token TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ,
  history_id TEXT,
  label_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  CONSTRAINT creator_email_accounts_provider_check
    CHECK (provider IN ('gmail')),
  CONSTRAINT creator_email_accounts_email_address_check
    CHECK (position('@' in email_address) > 1)
);

COMMENT ON TABLE public.creator_email_accounts IS
  'Creator-owned email accounts used to send planner outreach from the creator identity.';
COMMENT ON COLUMN public.creator_email_accounts.oauth_access_token IS
  'AES-256-GCM encrypted OAuth access token. Never store raw OAuth tokens.';
COMMENT ON COLUMN public.creator_email_accounts.oauth_refresh_token IS
  'AES-256-GCM encrypted OAuth refresh token. Never store raw OAuth tokens.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_creator_email_accounts_active_provider
  ON public.creator_email_accounts(user_id, provider)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_creator_email_accounts_active
  ON public.creator_email_accounts(provider, revoked_at, token_expires_at);

CREATE TABLE IF NOT EXISTS public.outreach_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES public.plans(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL,
  target_id UUID,
  target_name TEXT NOT NULL,
  target_email TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'email',
  state TEXT NOT NULL DEFAULT 'draft',
  source_agent_action_id UUID REFERENCES public.agent_actions(id) ON DELETE SET NULL,
  needs_attention BOOLEAN NOT NULL DEFAULT false,
  follow_up_count INTEGER NOT NULL DEFAULT 0,
  last_event_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_outbound_at TIMESTAMPTZ,
  last_inbound_at TIMESTAMPTZ,
  next_action_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT outreach_threads_target_type_check
    CHECK (target_type IN ('venue', 'vendor')),
  CONSTRAINT outreach_threads_channel_check
    CHECK (channel IN ('email')),
  CONSTRAINT outreach_threads_state_check
    CHECK (state IN ('draft', 'awaiting_reply', 'in_negotiation', 'confirmed', 'declined', 'stale', 'cancelled')),
  CONSTRAINT outreach_threads_follow_up_count_check
    CHECK (follow_up_count >= 0),
  CONSTRAINT outreach_threads_target_email_check
    CHECK (position('@' in target_email) > 1)
);

COMMENT ON TABLE public.outreach_threads IS
  'Planner-owned venue/vendor outreach conversations sent from creator email accounts.';
COMMENT ON COLUMN public.outreach_threads.source_agent_action_id IS
  'Approved planner action that authorized the initial outreach draft for this thread.';
COMMENT ON COLUMN public.outreach_threads.needs_attention IS
  'True when a reply classifier or send failure needs creator review.';

CREATE INDEX IF NOT EXISTS idx_outreach_threads_user_state
  ON public.outreach_threads(user_id, state, last_event_at DESC);

CREATE INDEX IF NOT EXISTS idx_outreach_threads_plan
  ON public.outreach_threads(plan_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_outreach_threads_active_poll
  ON public.outreach_threads(user_id, state, next_action_at)
  WHERE state IN ('awaiting_reply', 'in_negotiation');

CREATE UNIQUE INDEX IF NOT EXISTS idx_outreach_threads_plan_target_active
  ON public.outreach_threads(plan_id, target_type, target_id)
  WHERE target_id IS NOT NULL AND state <> 'cancelled';

DROP TRIGGER IF EXISTS update_outreach_threads_updated_at ON public.outreach_threads;
CREATE TRIGGER update_outreach_threads_updated_at
  BEFORE UPDATE ON public.outreach_threads
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.outreach_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES public.outreach_threads(id) ON DELETE CASCADE,
  agent_action_id UUID REFERENCES public.agent_actions(id) ON DELETE SET NULL,
  approval_id UUID REFERENCES public.approvals(id) ON DELETE SET NULL,
  direction TEXT NOT NULL,
  gmail_message_id TEXT,
  gmail_thread_id TEXT,
  subject TEXT NOT NULL,
  body_text TEXT NOT NULL,
  body_html TEXT,
  headers_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  sent_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  classification_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT outreach_messages_direction_check
    CHECK (direction IN ('outbound', 'inbound'))
);

COMMENT ON TABLE public.outreach_messages IS
  'Outbound creator Gmail drafts/sends and inbound Gmail replies for outreach threads.';
COMMENT ON COLUMN public.outreach_messages.agent_action_id IS
  'Planner action whose approval authorizes this outbound draft or follow-up.';
COMMENT ON COLUMN public.outreach_messages.classification_json IS
  'Reply classifier result for inbound messages, including extracted quote details and review flags.';

CREATE INDEX IF NOT EXISTS idx_outreach_messages_thread_created
  ON public.outreach_messages(thread_id, created_at);

CREATE INDEX IF NOT EXISTS idx_outreach_messages_agent_action
  ON public.outreach_messages(agent_action_id)
  WHERE agent_action_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_outreach_messages_gmail_message
  ON public.outreach_messages(gmail_message_id)
  WHERE gmail_message_id IS NOT NULL;

ALTER TABLE public.creator_email_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outreach_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outreach_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Creators can view own email accounts" ON public.creator_email_accounts;
CREATE POLICY "Creators can view own email accounts"
  ON public.creator_email_accounts FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Creators can create own email accounts" ON public.creator_email_accounts;
CREATE POLICY "Creators can create own email accounts"
  ON public.creator_email_accounts FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Creators can update own email accounts" ON public.creator_email_accounts;
CREATE POLICY "Creators can update own email accounts"
  ON public.creator_email_accounts FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Service role can manage email accounts" ON public.creator_email_accounts;
CREATE POLICY "Service role can manage email accounts"
  ON public.creator_email_accounts FOR ALL
  USING (auth.jwt()->>'role' = 'service_role')
  WITH CHECK (auth.jwt()->>'role' = 'service_role');

DROP POLICY IF EXISTS "Creators can view own outreach threads" ON public.outreach_threads;
CREATE POLICY "Creators can view own outreach threads"
  ON public.outreach_threads FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Creators can create own outreach threads" ON public.outreach_threads;
CREATE POLICY "Creators can create own outreach threads"
  ON public.outreach_threads FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Creators can update own outreach threads" ON public.outreach_threads;
CREATE POLICY "Creators can update own outreach threads"
  ON public.outreach_threads FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Service role can manage outreach threads" ON public.outreach_threads;
CREATE POLICY "Service role can manage outreach threads"
  ON public.outreach_threads FOR ALL
  USING (auth.jwt()->>'role' = 'service_role')
  WITH CHECK (auth.jwt()->>'role' = 'service_role');

DROP POLICY IF EXISTS "Creators can view own outreach messages" ON public.outreach_messages;
CREATE POLICY "Creators can view own outreach messages"
  ON public.outreach_messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.outreach_threads thread
      WHERE thread.id = outreach_messages.thread_id
        AND thread.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Creators can create own outreach messages" ON public.outreach_messages;
CREATE POLICY "Creators can create own outreach messages"
  ON public.outreach_messages FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.outreach_threads thread
      WHERE thread.id = outreach_messages.thread_id
        AND thread.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Creators can update own outreach messages" ON public.outreach_messages;
CREATE POLICY "Creators can update own outreach messages"
  ON public.outreach_messages FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM public.outreach_threads thread
      WHERE thread.id = outreach_messages.thread_id
        AND thread.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.outreach_threads thread
      WHERE thread.id = outreach_messages.thread_id
        AND thread.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Service role can manage outreach messages" ON public.outreach_messages;
CREATE POLICY "Service role can manage outreach messages"
  ON public.outreach_messages FOR ALL
  USING (auth.jwt()->>'role' = 'service_role')
  WITH CHECK (auth.jwt()->>'role' = 'service_role');

GRANT SELECT, INSERT, UPDATE ON public.creator_email_accounts TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.outreach_threads TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.outreach_messages TO authenticated;
GRANT ALL ON public.creator_email_accounts TO service_role;
GRANT ALL ON public.outreach_threads TO service_role;
GRANT ALL ON public.outreach_messages TO service_role;
