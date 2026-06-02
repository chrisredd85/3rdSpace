-- Migration: Add event revenue terms
-- Created: 2026-06-02
-- Context: Store event-scoped tax, ticketing fee, service fee, venue kickback,
-- vendor rev-share, sponsor credit, and related revenue terms so actual net
-- revenue and P&L are explainable in cents.

CREATE TABLE IF NOT EXISTS public.event_revenue_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  -- In the current schema, a builder profile is the organizer/org scope.
  org_id uuid NOT NULL REFERENCES public.builder_profiles(id) ON DELETE CASCADE,
  term_type text NOT NULL CHECK (
    term_type IN (
      'sales_tax',
      'ticketing_fee',
      'service_fee',
      'venue_kickback',
      'venue_minimum_spend',
      'vendor_rev_share',
      'sponsor_credit',
      'other'
    )
  ),
  rate numeric,
  flat_cents integer,
  applies_to text NOT NULL CHECK (
    applies_to IN (
      'gross_ticket_revenue',
      'net_ticket_revenue',
      'bar_revenue',
      'per_ticket',
      'per_attendee'
    )
  ),
  party_id uuid,
  party_name text,
  notes text,
  confidence text NOT NULL DEFAULT 'low' CHECK (
    confidence IN ('low', 'medium', 'high')
  ),
  source text NOT NULL DEFAULT 'manual' CHECK (
    source IN ('manual', 'platform_default', 'outreach_reply')
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_revenue_terms_rate_check
    CHECK (rate IS NULL OR rate >= 0),
  CONSTRAINT event_revenue_terms_flat_cents_check
    CHECK (flat_cents IS NULL OR flat_cents >= 0),
  CONSTRAINT event_revenue_terms_amount_present_check
    CHECK (rate IS NOT NULL OR flat_cents IS NOT NULL)
);

COMMENT ON TABLE public.event_revenue_terms IS
  'Organizer-scoped tax, fee, rev-share, sponsor, and venue revenue terms used to compute event actuals and P&L.';
COMMENT ON COLUMN public.event_revenue_terms.org_id IS
  'Organizer scope. Uses builder_profiles.id until a dedicated organization membership table exists.';
COMMENT ON COLUMN public.event_revenue_terms.rate IS
  'Decimal percentage rate, e.g. 0.05 for 5%. The application tolerates legacy percent-style values.';
COMMENT ON COLUMN public.event_revenue_terms.flat_cents IS
  'Flat term amount in integer cents. For per-ticket and per-attendee terms this is the per-unit cent amount.';

CREATE INDEX IF NOT EXISTS idx_event_revenue_terms_event
  ON public.event_revenue_terms(event_id);

CREATE INDEX IF NOT EXISTS idx_event_revenue_terms_org
  ON public.event_revenue_terms(org_id);

CREATE INDEX IF NOT EXISTS idx_event_revenue_terms_type
  ON public.event_revenue_terms(event_id, term_type);

CREATE UNIQUE INDEX IF NOT EXISTS idx_event_revenue_terms_platform_default
  ON public.event_revenue_terms(event_id, term_type, source, party_name)
  WHERE source = 'platform_default' AND party_name IS NOT NULL;

CREATE OR REPLACE FUNCTION public.validate_event_revenue_term_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_builder_id uuid;
BEGIN
  SELECT events.builder_id
  INTO v_event_builder_id
  FROM public.events
  WHERE events.id = NEW.event_id;

  IF v_event_builder_id IS NULL THEN
    RAISE EXCEPTION 'Event % not found for revenue term', NEW.event_id;
  END IF;

  IF NEW.org_id <> v_event_builder_id THEN
    RAISE EXCEPTION 'Revenue term org_id must match the event builder scope';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_event_revenue_term_scope
  ON public.event_revenue_terms;

CREATE TRIGGER validate_event_revenue_term_scope
  BEFORE INSERT OR UPDATE OF event_id, org_id
  ON public.event_revenue_terms
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_event_revenue_term_scope();

DROP TRIGGER IF EXISTS update_event_revenue_terms_updated_at
  ON public.event_revenue_terms;

CREATE TRIGGER update_event_revenue_terms_updated_at
  BEFORE UPDATE ON public.event_revenue_terms
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.can_manage_event_revenue_term_org(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1
      FROM public.builder_profiles
      WHERE builder_profiles.id = p_org_id
        AND builder_profiles.user_id = auth.uid()
    );
$$;

ALTER TABLE public.event_revenue_terms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members can view event revenue terms"
  ON public.event_revenue_terms;
CREATE POLICY "Org members can view event revenue terms"
  ON public.event_revenue_terms
  FOR SELECT
  USING (public.can_manage_event_revenue_term_org(org_id));

DROP POLICY IF EXISTS "Org members can create event revenue terms"
  ON public.event_revenue_terms;
CREATE POLICY "Org members can create event revenue terms"
  ON public.event_revenue_terms
  FOR INSERT
  WITH CHECK (public.can_manage_event_revenue_term_org(org_id));

DROP POLICY IF EXISTS "Org members can update event revenue terms"
  ON public.event_revenue_terms;
CREATE POLICY "Org members can update event revenue terms"
  ON public.event_revenue_terms
  FOR UPDATE
  USING (public.can_manage_event_revenue_term_org(org_id))
  WITH CHECK (public.can_manage_event_revenue_term_org(org_id));

DROP POLICY IF EXISTS "Org members can delete event revenue terms"
  ON public.event_revenue_terms;
CREATE POLICY "Org members can delete event revenue terms"
  ON public.event_revenue_terms
  FOR DELETE
  USING (public.can_manage_event_revenue_term_org(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.event_revenue_terms TO authenticated;
GRANT ALL ON TABLE public.event_revenue_terms TO service_role;
