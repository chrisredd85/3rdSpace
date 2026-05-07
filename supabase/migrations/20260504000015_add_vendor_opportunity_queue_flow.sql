-- Migration: Add vendor opportunity queue flow
-- Created: 2026-05-04
-- Context: Vendor quote requests mirror venue opportunity outreach with separate
-- brief/invite tables because vendor packages, quotes, and availability differ.

CREATE TABLE IF NOT EXISTS public.vendor_opportunity_briefs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES public.plans(id) ON DELETE CASCADE,
  organizer_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  package_type TEXT NOT NULL,
  summary TEXT NOT NULL,
  requirements JSONB NOT NULL DEFAULT '{}'::jsonb,
  budget_range_cents INT4RANGE,
  date_needed DATE,
  response_deadline TIMESTAMPTZ,
  quote_requested BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.vendor_opportunity_briefs IS
  'Organizer-approved vendor quote or availability briefs prepared by Agent Planner.';
COMMENT ON COLUMN public.vendor_opportunity_briefs.package_type IS
  'Vendor service package type such as catering, av, photo, security, or dj.';
COMMENT ON COLUMN public.vendor_opportunity_briefs.budget_range_cents IS
  'Target vendor budget range in integer cents.';
COMMENT ON COLUMN public.vendor_opportunity_briefs.quote_requested IS
  'True when vendor response should include a quote amount.';

CREATE TABLE IF NOT EXISTS public.vendor_opportunity_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brief_id UUID NOT NULL REFERENCES public.vendor_opportunity_briefs(id) ON DELETE CASCADE,
  vendor_id UUID NOT NULL REFERENCES public.vendor_profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued',
  magic_link_token TEXT,
  magic_link_expires_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  viewed_at TIMESTAMPTZ,
  response_at TIMESTAMPTZ,
  response_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  quoted_amount_cents INTEGER, -- stored as integer cents
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT vendor_opportunity_invites_status_check
    CHECK (status IN (
      'queued',
      'sent',
      'viewed',
      'accepted',
      'declined',
      'countered',
      'expired',
      'concierge_followup',
      'cancelled'
    )),
  CONSTRAINT vendor_opportunity_invites_quoted_amount_cents_check
    CHECK (quoted_amount_cents IS NULL OR quoted_amount_cents >= 0)
);

COMMENT ON TABLE public.vendor_opportunity_invites IS
  'Vendor opportunity invitations with quote response state and magic-link token placeholders.';
COMMENT ON COLUMN public.vendor_opportunity_invites.quoted_amount_cents IS
  'Vendor-provided quote amount in integer cents.';

CREATE INDEX IF NOT EXISTS idx_vendor_opportunity_briefs_plan_id
  ON public.vendor_opportunity_briefs(plan_id);
CREATE INDEX IF NOT EXISTS idx_vendor_opportunity_briefs_organizer
  ON public.vendor_opportunity_briefs(organizer_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vendor_opportunity_invites_brief_id
  ON public.vendor_opportunity_invites(brief_id);
CREATE INDEX IF NOT EXISTS idx_vendor_opportunity_invites_vendor_status
  ON public.vendor_opportunity_invites(vendor_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_opportunity_invites_magic_link_token
  ON public.vendor_opportunity_invites(magic_link_token)
  WHERE magic_link_token IS NOT NULL;

ALTER TABLE public.vendor_opportunity_briefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_opportunity_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Builders can manage own vendor opportunity briefs"
  ON public.vendor_opportunity_briefs;
CREATE POLICY "Builders can manage own vendor opportunity briefs"
  ON public.vendor_opportunity_briefs
  FOR ALL
  USING (organizer_user_id = auth.uid())
  WITH CHECK (organizer_user_id = auth.uid());

DROP POLICY IF EXISTS "Builders can read own vendor opportunity invites"
  ON public.vendor_opportunity_invites;
CREATE POLICY "Builders can read own vendor opportunity invites"
  ON public.vendor_opportunity_invites
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.vendor_opportunity_briefs brief
      WHERE brief.id = vendor_opportunity_invites.brief_id
        AND brief.organizer_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Builders can manage own vendor opportunity invites"
  ON public.vendor_opportunity_invites;
CREATE POLICY "Builders can manage own vendor opportunity invites"
  ON public.vendor_opportunity_invites
  FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM public.vendor_opportunity_briefs brief
      WHERE brief.id = vendor_opportunity_invites.brief_id
        AND brief.organizer_user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.vendor_opportunity_briefs brief
      WHERE brief.id = vendor_opportunity_invites.brief_id
        AND brief.organizer_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Service role can manage vendor opportunity briefs"
  ON public.vendor_opportunity_briefs;
CREATE POLICY "Service role can manage vendor opportunity briefs"
  ON public.vendor_opportunity_briefs
  FOR ALL
  USING (auth.jwt()->>'role' = 'service_role')
  WITH CHECK (auth.jwt()->>'role' = 'service_role');

DROP POLICY IF EXISTS "Service role can manage vendor opportunity invites"
  ON public.vendor_opportunity_invites;
CREATE POLICY "Service role can manage vendor opportunity invites"
  ON public.vendor_opportunity_invites
  FOR ALL
  USING (auth.jwt()->>'role' = 'service_role')
  WITH CHECK (auth.jwt()->>'role' = 'service_role');

ALTER TABLE public.agent_actions
  DROP CONSTRAINT IF EXISTS agent_actions_action_type_check;
ALTER TABLE public.agent_actions
  ADD CONSTRAINT agent_actions_action_type_check
  CHECK (
    action_type IN (
      'payment',
      'external_link',
      'concierge_queue',
      'email',
      'export',
      'hold',
      'hold_request',
      'vendor_contact',
      'external_checkout',
      'ai_query',
      'opportunity_send_venues',
      'opportunity_send_vendors'
    )
  );

CREATE INDEX IF NOT EXISTS idx_app_jobs_vendor_opportunity_invite_jobs
  ON public.app_jobs(job_type, status, scheduled_at)
  WHERE job_type IN (
    'opportunity_send_vendor_invite',
    'opportunity_remind_vendor_invite',
    'opportunity_expire_vendor_invite'
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.vendor_opportunity_briefs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vendor_opportunity_invites TO authenticated;
GRANT ALL ON public.vendor_opportunity_briefs TO service_role;
GRANT ALL ON public.vendor_opportunity_invites TO service_role;
