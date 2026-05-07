-- Migration: Add queued venue opportunity invite flow
-- Created: 2026-05-04
-- Context: Organizer-approved venue opportunity briefs create queued invite rows
-- with token placeholders before any email or public response page exists.

ALTER TABLE public.venue_opportunity_briefs
  ADD COLUMN IF NOT EXISTS summary TEXT,
  ADD COLUMN IF NOT EXISTS requirements JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS budget_range_cents INT4RANGE,
  ADD COLUMN IF NOT EXISTS date_window DATERANGE,
  ADD COLUMN IF NOT EXISTS response_deadline TIMESTAMPTZ;

COMMENT ON COLUMN public.venue_opportunity_briefs.summary IS
  'Host-facing opportunity summary shown before venue outreach is authorized.';
COMMENT ON COLUMN public.venue_opportunity_briefs.requirements IS
  'Structured opportunity requirements such as amenities, food responsibility, and revenue model.';
COMMENT ON COLUMN public.venue_opportunity_briefs.budget_range_cents IS
  'Target opportunity budget range in integer cents.';
COMMENT ON COLUMN public.venue_opportunity_briefs.date_window IS
  'Target opportunity date window.';
COMMENT ON COLUMN public.venue_opportunity_briefs.response_deadline IS
  'Deadline for venues to respond to this opportunity.';

ALTER TABLE public.venue_opportunity_invites
  ADD COLUMN IF NOT EXISTS brief_id UUID REFERENCES public.venue_opportunity_briefs(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS magic_link_token TEXT,
  ADD COLUMN IF NOT EXISTS magic_link_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS viewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS response_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS response_payload JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE public.venue_opportunity_invites
SET brief_id = opportunity_id
WHERE brief_id IS NULL;

ALTER TABLE public.venue_opportunity_invites
  ALTER COLUMN brief_id SET NOT NULL;

ALTER TABLE public.venue_opportunity_invites
  DROP CONSTRAINT IF EXISTS venue_opportunity_invites_status_check;
ALTER TABLE public.venue_opportunity_invites
  ADD CONSTRAINT venue_opportunity_invites_status_check
  CHECK (status IN (
    'queued',
    'sent',
    'viewed',
    'accepted',
    'declined',
    'countered',
    'expired',
    'concierge_followup',
    'draft',
    'pending_organizer_approval',
    'concierge_queue',
    'cancelled'
  ));

COMMENT ON COLUMN public.venue_opportunity_invites.brief_id IS
  'Alias for opportunity_id used by the venue opportunity queue flow.';
COMMENT ON COLUMN public.venue_opportunity_invites.magic_link_token IS
  'Random token for the future public response page. Generated on organizer authorization.';
COMMENT ON COLUMN public.venue_opportunity_invites.magic_link_expires_at IS
  'Expiration timestamp for magic_link_token.';
COMMENT ON COLUMN public.venue_opportunity_invites.response_payload IS
  'Structured venue response payload for future accept, decline, or counter flows.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_venue_opportunity_invites_magic_link_token
  ON public.venue_opportunity_invites(magic_link_token)
  WHERE magic_link_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_venue_opportunity_invites_brief_id
  ON public.venue_opportunity_invites(brief_id);

-- Venue/vendor responses will use a service-role token validation route later.
-- Until then, only plan owners should read invite rows directly through RLS.
DROP POLICY IF EXISTS "Claimed venues can read own opportunity invites"
  ON public.venue_opportunity_invites;
DROP POLICY IF EXISTS "Claimed vendors can read own opportunity invites"
  ON public.venue_opportunity_invites;

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
      'opportunity_send_venues'
    )
  );
