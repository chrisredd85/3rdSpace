-- Places outreach pipeline: organizer-provided contacts + plan-scoped candidates.
-- Context: Google Places does not return email addresses. Website extraction
-- resolves some contacts, and organizers can paste verified contacts for the
-- remaining opportunities before creating approval-gated Gmail outreach.

ALTER TABLE public.discovery_venues
  ADD COLUMN IF NOT EXISTS organizer_provided_emails JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS organizer_rescue_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_rescue_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS photos JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.discovery_venues.organizer_provided_emails IS
  'Emails the organizer pasted in manually after finding them on the venue website or contact form. Format: array of { email, provided_by_user_id, provided_at, source: "organizer_manual" }. Takes priority over extracted_emails when both are present.';

COMMENT ON COLUMN public.discovery_venues.organizer_rescue_count IS
  'Future analytics counter for organizer-rescued discovery venues whose manual contact eventually produces a reply.';

COMMENT ON COLUMN public.discovery_venues.last_rescue_at IS
  'Future analytics timestamp for the most recent organizer-rescued contact that produced a reply.';

COMMENT ON COLUMN public.discovery_venues.photos IS
  'Google Places photo references. Format: array of { name, heightPx, widthPx, authorAttributions: [{displayName, uri}] }. Photo binaries are fetched on demand through the planner discovery photo proxy.';

ALTER TABLE public.discovery_venues
  DROP CONSTRAINT IF EXISTS discovery_venues_organizer_rescue_count_check;
ALTER TABLE public.discovery_venues
  ADD CONSTRAINT discovery_venues_organizer_rescue_count_check
  CHECK (organizer_rescue_count >= 0);

CREATE INDEX IF NOT EXISTS idx_discovery_venues_has_organizer_email
  ON public.discovery_venues (id)
  WHERE jsonb_array_length(organizer_provided_emails) > 0;

CREATE TABLE IF NOT EXISTS public.plan_discovery_venue_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES public.plans(id) ON DELETE CASCADE,
  discovery_venue_id UUID NOT NULL REFERENCES public.discovery_venues(id) ON DELETE CASCADE,
  searched_by_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  search_query TEXT NOT NULL,
  archetype_id TEXT,
  neighborhood TEXT,
  fit_score INTEGER,
  status TEXT NOT NULL DEFAULT 'candidate',
  dismissed_at TIMESTAMPTZ,
  places_request_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  outreach_approval_created_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT plan_discovery_venue_candidates_status_check
    CHECK (status IN ('candidate', 'dismissed', 'approval_created')),
  CONSTRAINT plan_discovery_venue_candidates_fit_score_check
    CHECK (fit_score IS NULL OR (fit_score >= 0 AND fit_score <= 100)),
  UNIQUE (plan_id, discovery_venue_id)
);

COMMENT ON TABLE public.plan_discovery_venue_candidates IS
  'Plan-scoped Google Places discovery candidates. Keeps global discovery_venues reusable while preserving per-plan search, dismissal, and approval state.';

COMMENT ON COLUMN public.plan_discovery_venue_candidates.places_request_json IS
  'Sanitized Places request shape used to produce this candidate, stored for auditability and explaining why the venue was suggested.';

CREATE INDEX IF NOT EXISTS idx_plan_discovery_candidates_plan
  ON public.plan_discovery_venue_candidates (plan_id, status, fit_score DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_plan_discovery_candidates_discovery_venue
  ON public.plan_discovery_venue_candidates (discovery_venue_id);

DROP TRIGGER IF EXISTS update_plan_discovery_venue_candidates_updated_at
  ON public.plan_discovery_venue_candidates;
CREATE TRIGGER update_plan_discovery_venue_candidates_updated_at
  BEFORE UPDATE ON public.plan_discovery_venue_candidates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.plan_discovery_venue_candidates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Plan owners can read discovery candidates"
  ON public.plan_discovery_venue_candidates;
CREATE POLICY "Plan owners can read discovery candidates"
  ON public.plan_discovery_venue_candidates FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.plans
      WHERE plans.id = plan_discovery_venue_candidates.plan_id
        AND plans.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Plan owners can create discovery candidates"
  ON public.plan_discovery_venue_candidates;
CREATE POLICY "Plan owners can create discovery candidates"
  ON public.plan_discovery_venue_candidates FOR INSERT
  TO authenticated
  WITH CHECK (
    searched_by_user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.plans
      WHERE plans.id = plan_discovery_venue_candidates.plan_id
        AND plans.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Plan owners can update discovery candidates"
  ON public.plan_discovery_venue_candidates;
CREATE POLICY "Plan owners can update discovery candidates"
  ON public.plan_discovery_venue_candidates FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.plans
      WHERE plans.id = plan_discovery_venue_candidates.plan_id
        AND plans.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.plans
      WHERE plans.id = plan_discovery_venue_candidates.plan_id
        AND plans.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Service role can manage discovery candidates"
  ON public.plan_discovery_venue_candidates;
CREATE POLICY "Service role can manage discovery candidates"
  ON public.plan_discovery_venue_candidates FOR ALL
  USING (auth.jwt()->>'role' = 'service_role')
  WITH CHECK (auth.jwt()->>'role' = 'service_role');

GRANT SELECT, INSERT, UPDATE ON public.plan_discovery_venue_candidates TO authenticated;
GRANT ALL ON public.plan_discovery_venue_candidates TO service_role;
