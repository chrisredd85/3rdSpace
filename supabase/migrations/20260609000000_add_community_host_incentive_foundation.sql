-- Migration: Community Host Incentive foundation
-- Created: 2026-06-09
-- Context: Adds CHI tables alongside legacy settlement tables. No existing
-- kickback/revenue-share rows are renamed or converted in this phase.

CREATE TABLE IF NOT EXISTS public.community_host_incentive_agreements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid REFERENCES public.events(id) ON DELETE SET NULL,
  plan_id uuid REFERENCES public.plans(id) ON DELETE SET NULL,
  venue_id uuid NOT NULL REFERENCES public.venues(id),
  organizer_user_id uuid NOT NULL REFERENCES public.users(id),
  venue_owner_user_id uuid NOT NULL REFERENCES public.users(id),
  approval_id uuid REFERENCES public.approvals(id) ON DELETE SET NULL,
  agreement_type text NOT NULL,
  per_head_rate_cents integer,
  fixed_amount_cents integer,
  threshold_attendees integer,
  base_amount_cents integer,
  payout_floor_cents integer,
  payout_cap_cents integer,
  settlement_mode text NOT NULL DEFAULT 'community_host_incentive',
  status text NOT NULL DEFAULT 'draft',
  venue_approved boolean NOT NULL DEFAULT false,
  approved_at timestamptz,
  approved_by_venue_user_id uuid REFERENCES public.users(id),
  dispute_status text NOT NULL DEFAULT 'none',
  dispute_deadline_at timestamptz,
  settlement_due_at timestamptz,
  is_legacy_revenue_share boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT community_host_incentive_agreements_type_check
    CHECK (agreement_type IN (
      'per_verified_attendee',
      'fixed_threshold',
      'fixed_flat',
      'base_plus_per_attendee',
      'manual_venue_approved'
    )),
  CONSTRAINT community_host_incentive_agreements_settlement_mode_check
    CHECK (settlement_mode IN (
      'community_host_incentive',
      'venue_rental',
      'manual_admin_review'
    )),
  CONSTRAINT community_host_incentive_agreements_status_check
    CHECK (status IN (
      'draft',
      'pending_venue_approval',
      'approved',
      'active',
      'completed',
      'cancelled',
      'disputed',
      'archived'
    )),
  CONSTRAINT community_host_incentive_agreements_dispute_status_check
    CHECK (dispute_status IN ('none', 'open', 'under_review', 'resolved', 'escalated')),
  CONSTRAINT community_host_incentive_agreements_per_head_rate_cents_check
    CHECK (per_head_rate_cents IS NULL OR per_head_rate_cents >= 0),
  CONSTRAINT community_host_incentive_agreements_fixed_amount_cents_check
    CHECK (fixed_amount_cents IS NULL OR fixed_amount_cents >= 0),
  CONSTRAINT community_host_incentive_agreements_threshold_attendees_check
    CHECK (threshold_attendees IS NULL OR threshold_attendees >= 0),
  CONSTRAINT community_host_incentive_agreements_base_amount_cents_check
    CHECK (base_amount_cents IS NULL OR base_amount_cents >= 0),
  CONSTRAINT community_host_incentive_agreements_payout_floor_cents_check
    CHECK (payout_floor_cents IS NULL OR payout_floor_cents >= 0),
  CONSTRAINT community_host_incentive_agreements_payout_cap_cents_check
    CHECK (payout_cap_cents IS NULL OR payout_cap_cents >= 0),
  CONSTRAINT community_host_incentive_agreements_floor_cap_check
    CHECK (
      payout_floor_cents IS NULL
      OR payout_cap_cents IS NULL
      OR payout_floor_cents <= payout_cap_cents
    ),
  CONSTRAINT community_host_incentive_agreements_approval_fields_check
    CHECK (
      (
        venue_approved = false
        AND approved_at IS NULL
        AND approved_by_venue_user_id IS NULL
      )
      OR (
        venue_approved = true
        AND approved_at IS NOT NULL
        AND approved_by_venue_user_id IS NOT NULL
      )
    ),
  CONSTRAINT community_host_incentive_agreements_approved_status_check
    CHECK (
      status NOT IN ('approved', 'active', 'completed')
      OR venue_approved = true
    )
);

COMMENT ON TABLE public.community_host_incentive_agreements IS
  'Venue-approved Community Host Incentive terms. Created alongside legacy settlement tables; legacy rows are not converted silently.';
COMMENT ON COLUMN public.community_host_incentive_agreements.settlement_mode IS
  'Per-agreement mode used to distinguish CHI, rental, and manual admin review paths for hybrid venues.';
COMMENT ON COLUMN public.community_host_incentive_agreements.is_legacy_revenue_share IS
  'Always false for newly-created CHI rows. Future archival migrations use true only for preserved legacy rows.';

CREATE INDEX IF NOT EXISTS idx_chi_agreements_plan_status
  ON public.community_host_incentive_agreements(plan_id, status)
  WHERE plan_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_chi_agreements_event_status
  ON public.community_host_incentive_agreements(event_id, status)
  WHERE event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_chi_agreements_venue_status
  ON public.community_host_incentive_agreements(venue_id, status);

CREATE INDEX IF NOT EXISTS idx_chi_agreements_organizer_status
  ON public.community_host_incentive_agreements(organizer_user_id, status);

CREATE INDEX IF NOT EXISTS idx_chi_agreements_approval_id
  ON public.community_host_incentive_agreements(approval_id)
  WHERE approval_id IS NOT NULL;

DROP TRIGGER IF EXISTS update_community_host_incentive_agreements_updated_at
  ON public.community_host_incentive_agreements;
CREATE TRIGGER update_community_host_incentive_agreements_updated_at
  BEFORE UPDATE ON public.community_host_incentive_agreements
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.community_host_incentive_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id uuid NOT NULL REFERENCES public.community_host_incentive_agreements(id) ON DELETE CASCADE,
  event_id uuid REFERENCES public.events(id) ON DELETE SET NULL,
  verified_attendees integer NOT NULL,
  verification_source text NOT NULL,
  verification_source_id text,
  organizer_payout_cents integer NOT NULL,
  calculation_basis text NOT NULL,
  applied_floor boolean NOT NULL DEFAULT false,
  applied_cap boolean NOT NULL DEFAULT false,
  stripe_invoice_id text,
  stripe_transfer_id text,
  status text NOT NULL DEFAULT 'pending',
  due_at timestamptz,
  paid_at timestamptz,
  approval_id uuid REFERENCES public.approvals(id) ON DELETE SET NULL,
  is_legacy_revenue_share boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT community_host_incentive_settlements_verified_attendees_check
    CHECK (verified_attendees >= 0),
  CONSTRAINT chi_settlements_organizer_payout_cents_check
    CHECK (organizer_payout_cents >= 0),
  CONSTRAINT community_host_incentive_settlements_verification_source_check
    CHECK (verification_source IN (
      'ticketing_api',
      'ticketing_webhook',
      'csv_upload',
      'screenshot_ocr'
    )),
  CONSTRAINT community_host_incentive_settlements_calculation_basis_check
    CHECK (calculation_basis IN (
      'verified_attendance',
      'fixed_threshold_met',
      'fixed_flat',
      'base_plus_verified_attendance',
      'manual_venue_approved'
    )),
  CONSTRAINT community_host_incentive_settlements_status_check
    CHECK (status IN (
      'pending',
      'admin_review',
      'invoice_sent',
      'paid',
      'failed',
      'cancelled',
      'refunded',
      'disputed'
    ))
);

COMMENT ON TABLE public.community_host_incentive_settlements IS
  'Deterministic CHI settlement results from approved terms and verified attendance or fixed compensation rules.';
COMMENT ON COLUMN public.community_host_incentive_settlements.organizer_payout_cents IS
  'Organizer payout in integer cents. Never store or compare money as floating point.';
COMMENT ON COLUMN public.community_host_incentive_settlements.is_legacy_revenue_share IS
  'Always false for newly-created CHI rows. Future archival migrations use true only for preserved legacy rows.';

CREATE INDEX IF NOT EXISTS idx_chi_settlements_agreement_status
  ON public.community_host_incentive_settlements(agreement_id, status);

CREATE INDEX IF NOT EXISTS idx_chi_settlements_event_status
  ON public.community_host_incentive_settlements(event_id, status)
  WHERE event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_chi_settlements_due_status
  ON public.community_host_incentive_settlements(status, due_at)
  WHERE due_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_chi_settlements_approval_id
  ON public.community_host_incentive_settlements(approval_id)
  WHERE approval_id IS NOT NULL;

DROP TRIGGER IF EXISTS update_community_host_incentive_settlements_updated_at
  ON public.community_host_incentive_settlements;
CREATE TRIGGER update_community_host_incentive_settlements_updated_at
  BEFORE UPDATE ON public.community_host_incentive_settlements
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.community_host_incentive_agreements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_host_incentive_settlements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Participants can read CHI agreements"
  ON public.community_host_incentive_agreements;
CREATE POLICY "Participants can read CHI agreements"
  ON public.community_host_incentive_agreements
  FOR SELECT
  TO authenticated
  USING (
    organizer_user_id = auth.uid()
    OR venue_owner_user_id = auth.uid()
  );

DROP POLICY IF EXISTS "Service role can manage CHI agreements"
  ON public.community_host_incentive_agreements;
CREATE POLICY "Service role can manage CHI agreements"
  ON public.community_host_incentive_agreements
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Participants can read CHI settlements"
  ON public.community_host_incentive_settlements;
CREATE POLICY "Participants can read CHI settlements"
  ON public.community_host_incentive_settlements
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.community_host_incentive_agreements agreement
      WHERE agreement.id = community_host_incentive_settlements.agreement_id
        AND (
          agreement.organizer_user_id = auth.uid()
          OR agreement.venue_owner_user_id = auth.uid()
        )
    )
  );

DROP POLICY IF EXISTS "Service role can manage CHI settlements"
  ON public.community_host_incentive_settlements;
CREATE POLICY "Service role can manage CHI settlements"
  ON public.community_host_incentive_settlements
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

GRANT SELECT ON public.community_host_incentive_agreements TO authenticated;
GRANT SELECT ON public.community_host_incentive_settlements TO authenticated;
GRANT ALL ON public.community_host_incentive_agreements TO service_role;
GRANT ALL ON public.community_host_incentive_settlements TO service_role;
