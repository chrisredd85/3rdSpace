-- Migration: Add planner opportunity marketplace tables
-- Created: 2026-05-04
-- Context: Coherent planner events can be proposed to venue and vendor catalog
-- targets after organizer approval. Unclaimed listings route to concierge fallback.

CREATE TABLE IF NOT EXISTS public.venue_opportunity_briefs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES public.plans(id) ON DELETE CASCADE,
  organizer_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  event_type TEXT,
  event_components JSONB NOT NULL DEFAULT '[]'::jsonb,
  guest_count INTEGER,
  date_window_start DATE,
  date_window_end DATE,
  time_preference TEXT,
  neighborhood TEXT,
  budget_cents INTEGER, -- stored as integer cents
  must_haves JSONB NOT NULL DEFAULT '[]'::jsonb,
  requested_terms JSONB NOT NULL DEFAULT '{}'::jsonb,
  deposit_target_cents INTEGER, -- stored as integer cents
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT venue_opportunity_briefs_guest_count_check
    CHECK (guest_count IS NULL OR guest_count >= 0),
  CONSTRAINT venue_opportunity_briefs_budget_cents_check
    CHECK (budget_cents IS NULL OR budget_cents >= 0),
  CONSTRAINT venue_opportunity_briefs_deposit_target_cents_check
    CHECK (deposit_target_cents IS NULL OR deposit_target_cents >= 0),
  CONSTRAINT venue_opportunity_briefs_status_check
    CHECK (status IN (
      'draft',
      'approval_requested',
      'proposed',
      'collecting_offers',
      'offer_selected',
      'closed',
      'cancelled'
    ))
);

COMMENT ON TABLE public.venue_opportunity_briefs IS
  'Organizer-approved event opportunity briefs prepared by Agent Planner for venue/vendor outreach.';
COMMENT ON COLUMN public.venue_opportunity_briefs.deposit_target_cents IS
  'Suggested initial deposit exposure in integer cents. No charge is created by this row.';
COMMENT ON COLUMN public.venue_opportunity_briefs.requested_terms IS
  'Structured requirements sent to venues/vendors, such as exclusive use, bar terms, AV, or hospitality needs.';

CREATE INDEX IF NOT EXISTS idx_venue_opportunity_briefs_plan_id
  ON public.venue_opportunity_briefs(plan_id);
CREATE INDEX IF NOT EXISTS idx_venue_opportunity_briefs_organizer_status
  ON public.venue_opportunity_briefs(organizer_user_id, status);

DROP TRIGGER IF EXISTS update_venue_opportunity_briefs_updated_at
  ON public.venue_opportunity_briefs;
CREATE TRIGGER update_venue_opportunity_briefs_updated_at
  BEFORE UPDATE ON public.venue_opportunity_briefs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.venue_opportunity_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id UUID NOT NULL REFERENCES public.venue_opportunity_briefs(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL,
  venue_id UUID REFERENCES public.venues(id) ON DELETE SET NULL,
  vendor_profile_id UUID REFERENCES public.vendor_profiles(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending_organizer_approval',
  is_claimed BOOLEAN NOT NULL DEFAULT false,
  route_to_concierge BOOLEAN NOT NULL DEFAULT false,
  match_score INTEGER NOT NULL DEFAULT 0,
  capacity_fit BOOLEAN NOT NULL DEFAULT false,
  budget_fit BOOLEAN NOT NULL DEFAULT false,
  requirement_fit JSONB NOT NULL DEFAULT '{}'::jsonb,
  proposed_deposit_cents INTEGER, -- stored as integer cents
  quoted_price_cents INTEGER, -- stored as integer cents
  venue_response_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  admin_notes TEXT,
  sent_at TIMESTAMPTZ,
  responded_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT venue_opportunity_invites_target_type_check
    CHECK (target_type IN ('venue', 'vendor', 'concierge')),
  CONSTRAINT venue_opportunity_invites_status_check
    CHECK (status IN (
      'draft',
      'pending_organizer_approval',
      'sent',
      'viewed',
      'accepted',
      'countered',
      'declined',
      'expired',
      'concierge_queue',
      'cancelled'
    )),
  CONSTRAINT venue_opportunity_invites_match_score_check
    CHECK (match_score >= 0 AND match_score <= 100),
  CONSTRAINT venue_opportunity_invites_proposed_deposit_cents_check
    CHECK (proposed_deposit_cents IS NULL OR proposed_deposit_cents >= 0),
  CONSTRAINT venue_opportunity_invites_quoted_price_cents_check
    CHECK (quoted_price_cents IS NULL OR quoted_price_cents >= 0),
  CONSTRAINT venue_opportunity_invites_target_check
    CHECK (
      (target_type = 'venue' AND venue_id IS NOT NULL AND vendor_profile_id IS NULL)
      OR (target_type = 'vendor' AND vendor_profile_id IS NOT NULL AND venue_id IS NULL)
      OR (target_type = 'concierge' AND venue_id IS NULL AND vendor_profile_id IS NULL)
    )
);

COMMENT ON TABLE public.venue_opportunity_invites IS
  'Venue/vendor opportunity invitations with match status, response status, and concierge fallback routing.';
COMMENT ON COLUMN public.venue_opportunity_invites.route_to_concierge IS
  'True when an unclaimed or non-integrated listing must be handled by the internal concierge queue.';
COMMENT ON COLUMN public.venue_opportunity_invites.venue_response_json IS
  'Structured venue/vendor response payload, such as accepted terms, counteroffers, or decline reason.';

CREATE INDEX IF NOT EXISTS idx_venue_opportunity_invites_opportunity_id
  ON public.venue_opportunity_invites(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_venue_opportunity_invites_venue_status
  ON public.venue_opportunity_invites(venue_id, status)
  WHERE venue_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_venue_opportunity_invites_vendor_status
  ON public.venue_opportunity_invites(vendor_profile_id, status)
  WHERE vendor_profile_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_venue_opportunity_invites_concierge
  ON public.venue_opportunity_invites(route_to_concierge, status);

DROP TRIGGER IF EXISTS update_venue_opportunity_invites_updated_at
  ON public.venue_opportunity_invites;
CREATE TRIGGER update_venue_opportunity_invites_updated_at
  BEFORE UPDATE ON public.venue_opportunity_invites
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.venue_opportunity_briefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venue_opportunity_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Builders can manage own opportunity briefs"
  ON public.venue_opportunity_briefs;
CREATE POLICY "Builders can manage own opportunity briefs"
  ON public.venue_opportunity_briefs
  FOR ALL
  USING (organizer_user_id = auth.uid())
  WITH CHECK (organizer_user_id = auth.uid());

DROP POLICY IF EXISTS "Builders can read own opportunity invites"
  ON public.venue_opportunity_invites;
CREATE POLICY "Builders can read own opportunity invites"
  ON public.venue_opportunity_invites
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.venue_opportunity_briefs brief
      WHERE brief.id = venue_opportunity_invites.opportunity_id
        AND brief.organizer_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Builders can manage own opportunity invites"
  ON public.venue_opportunity_invites;
CREATE POLICY "Builders can manage own opportunity invites"
  ON public.venue_opportunity_invites
  FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM public.venue_opportunity_briefs brief
      WHERE brief.id = venue_opportunity_invites.opportunity_id
        AND brief.organizer_user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.venue_opportunity_briefs brief
      WHERE brief.id = venue_opportunity_invites.opportunity_id
        AND brief.organizer_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Claimed venues can read own opportunity invites"
  ON public.venue_opportunity_invites;
CREATE POLICY "Claimed venues can read own opportunity invites"
  ON public.venue_opportunity_invites
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.venues venue
      WHERE venue.id = venue_opportunity_invites.venue_id
        AND venue.claimed_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Claimed vendors can read own opportunity invites"
  ON public.venue_opportunity_invites;
CREATE POLICY "Claimed vendors can read own opportunity invites"
  ON public.venue_opportunity_invites
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.vendor_profiles vendor
      WHERE vendor.id = venue_opportunity_invites.vendor_profile_id
        AND vendor.claimed_user_id = auth.uid()
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.venue_opportunity_briefs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.venue_opportunity_invites TO authenticated;
GRANT ALL ON public.venue_opportunity_briefs TO service_role;
GRANT ALL ON public.venue_opportunity_invites TO service_role;
