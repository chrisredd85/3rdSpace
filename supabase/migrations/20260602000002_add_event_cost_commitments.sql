-- Migration: Add event cost commitments
-- Created: 2026-06-02
-- Context: Replace free-floating economics cost inputs with typed, state-tracked
-- cost commitments that can later be populated by outreach replies, receipt
-- uploads, CSV imports, and provider webhooks.

CREATE TABLE IF NOT EXISTS public.event_cost_commitments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  plan_id uuid REFERENCES public.plans(id) ON DELETE SET NULL,
  -- In the current schema, a builder profile is the organizer/org scope.
  org_id uuid NOT NULL REFERENCES public.builder_profiles(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (
    category IN ('venue', 'vendor', 'staff', 'marketing', 'platform_fee', 'tax', 'other')
  ),
  party_id uuid,
  party_name text,
  description text,
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  currency text NOT NULL DEFAULT 'USD',
  state text NOT NULL DEFAULT 'estimated' CHECK (
    state IN ('estimated', 'quoted', 'accepted', 'invoiced', 'paid', 'cancelled')
  ),
  confidence text NOT NULL DEFAULT 'low' CHECK (
    confidence IN ('low', 'medium', 'high')
  ),
  evidence_url text,
  evidence_type text NOT NULL DEFAULT 'none' CHECK (
    evidence_type IN ('contract', 'invoice', 'receipt', 'screenshot', 'none')
  ),
  source text NOT NULL DEFAULT 'manual' CHECK (
    source IN ('manual', 'outreach_reply', 'receipt_upload', 'csv_import', 'webhook')
  ),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  committed_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.event_cost_commitments IS
  'Organizer-scoped venue, vendor, staffing, marketing, platform, tax, and other event costs with evidence and lifecycle state.';
COMMENT ON COLUMN public.event_cost_commitments.org_id IS
  'Organizer scope. Uses builder_profiles.id until a dedicated organization membership table exists.';
COMMENT ON COLUMN public.event_cost_commitments.amount_cents IS
  'Cost amount stored as integer cents.';

CREATE INDEX IF NOT EXISTS idx_event_cost_commitments_event
  ON public.event_cost_commitments(event_id);

CREATE INDEX IF NOT EXISTS idx_event_cost_commitments_event_state
  ON public.event_cost_commitments(event_id, state);

CREATE INDEX IF NOT EXISTS idx_event_cost_commitments_org
  ON public.event_cost_commitments(org_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_event_cost_commitments_party_category_unique
  ON public.event_cost_commitments(event_id, party_id, category)
  WHERE party_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.validate_event_cost_commitment_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_builder_id uuid;
  v_builder_user_id uuid;
BEGIN
  SELECT events.builder_id, builder_profiles.user_id
  INTO v_event_builder_id, v_builder_user_id
  FROM public.events
  JOIN public.builder_profiles
    ON builder_profiles.id = events.builder_id
  WHERE events.id = NEW.event_id;

  IF v_event_builder_id IS NULL THEN
    RAISE EXCEPTION 'Event % not found for cost commitment', NEW.event_id;
  END IF;

  IF NEW.org_id <> v_event_builder_id THEN
    RAISE EXCEPTION 'Cost commitment org_id must match the event builder scope';
  END IF;

  IF NEW.plan_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.plans
    WHERE plans.id = NEW.plan_id
      AND plans.user_id = v_builder_user_id
  ) THEN
    RAISE EXCEPTION 'Cost commitment plan_id must belong to the same organizer';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_event_cost_commitment_scope
  ON public.event_cost_commitments;

CREATE TRIGGER validate_event_cost_commitment_scope
  BEFORE INSERT OR UPDATE OF event_id, plan_id, org_id
  ON public.event_cost_commitments
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_event_cost_commitment_scope();

DROP TRIGGER IF EXISTS update_event_cost_commitments_updated_at
  ON public.event_cost_commitments;

CREATE TRIGGER update_event_cost_commitments_updated_at
  BEFORE UPDATE ON public.event_cost_commitments
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.can_manage_event_cost_commitment_org(p_org_id uuid)
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

ALTER TABLE public.event_cost_commitments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members can view event cost commitments"
  ON public.event_cost_commitments;
CREATE POLICY "Org members can view event cost commitments"
  ON public.event_cost_commitments
  FOR SELECT
  USING (public.can_manage_event_cost_commitment_org(org_id));

DROP POLICY IF EXISTS "Org members can create event cost commitments"
  ON public.event_cost_commitments;
CREATE POLICY "Org members can create event cost commitments"
  ON public.event_cost_commitments
  FOR INSERT
  WITH CHECK (public.can_manage_event_cost_commitment_org(org_id));

DROP POLICY IF EXISTS "Org members can update event cost commitments"
  ON public.event_cost_commitments;
CREATE POLICY "Org members can update event cost commitments"
  ON public.event_cost_commitments
  FOR UPDATE
  USING (public.can_manage_event_cost_commitment_org(org_id))
  WITH CHECK (public.can_manage_event_cost_commitment_org(org_id));

GRANT SELECT, INSERT, UPDATE ON TABLE public.event_cost_commitments TO authenticated;
GRANT ALL ON TABLE public.event_cost_commitments TO service_role;
