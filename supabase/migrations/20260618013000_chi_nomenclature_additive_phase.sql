-- Migration: CHI nomenclature additive phase
-- Created: 2026-06-18
-- Context: Add CHI-named schema surfaces alongside legacy names. This is
-- additive only: legacy columns/tables stay in place for rollback safety.

-- Track A: event_revenue_terms term_type values.
-- Existing rows keep their stored values; application writes move to the
-- CHI-named values while readers accept both during the compatibility window.
ALTER TABLE public.event_revenue_terms
  DROP CONSTRAINT IF EXISTS event_revenue_terms_term_type_check;

ALTER TABLE public.event_revenue_terms
  ADD CONSTRAINT event_revenue_terms_term_type_check
  CHECK (
    term_type IN (
      'sales_tax',
      'ticketing_fee',
      'service_fee',
      'venue_kickback',
      'venue_chi',
      'venue_minimum_spend',
      'vendor_rev_share',
      'vendor_consumption_share',
      'sponsor_credit',
      'other'
    )
  );

COMMENT ON TABLE public.event_revenue_terms IS
  'Organizer-scoped tax, fee, CHI, sponsor, and venue revenue terms used to compute event actuals and P&L.';

-- Track A: CHI foundation legacy flag rename.
ALTER TABLE public.community_host_incentive_agreements
  ADD COLUMN IF NOT EXISTS is_legacy_consumption_share boolean;

UPDATE public.community_host_incentive_agreements
SET is_legacy_consumption_share = is_legacy_revenue_share
WHERE is_legacy_consumption_share IS NULL;

ALTER TABLE public.community_host_incentive_agreements
  ALTER COLUMN is_legacy_consumption_share SET DEFAULT false,
  ALTER COLUMN is_legacy_consumption_share SET NOT NULL;

COMMENT ON COLUMN public.community_host_incentive_agreements.is_legacy_consumption_share IS
  'Always false for newly-created CHI rows. Future archival migrations use true only for preserved legacy rows.';

ALTER TABLE public.community_host_incentive_settlements
  ADD COLUMN IF NOT EXISTS is_legacy_consumption_share boolean;

UPDATE public.community_host_incentive_settlements
SET is_legacy_consumption_share = is_legacy_revenue_share
WHERE is_legacy_consumption_share IS NULL;

ALTER TABLE public.community_host_incentive_settlements
  ALTER COLUMN is_legacy_consumption_share SET DEFAULT false,
  ALTER COLUMN is_legacy_consumption_share SET NOT NULL;

COMMENT ON COLUMN public.community_host_incentive_settlements.is_legacy_consumption_share IS
  'Always false for newly-created CHI rows. Future archival migrations use true only for preserved legacy rows.';

CREATE OR REPLACE FUNCTION public.sync_chi_consumption_share_flag()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.is_legacy_consumption_share :=
      COALESCE(NEW.is_legacy_consumption_share, NEW.is_legacy_revenue_share, false);
    NEW.is_legacy_revenue_share :=
      COALESCE(NEW.is_legacy_revenue_share, NEW.is_legacy_consumption_share, false);
    RETURN NEW;
  END IF;

  IF NEW.is_legacy_consumption_share IS DISTINCT FROM OLD.is_legacy_consumption_share THEN
    NEW.is_legacy_revenue_share := NEW.is_legacy_consumption_share;
  ELSIF NEW.is_legacy_revenue_share IS DISTINCT FROM OLD.is_legacy_revenue_share THEN
    NEW.is_legacy_consumption_share := NEW.is_legacy_revenue_share;
  END IF;

  NEW.is_legacy_consumption_share := COALESCE(NEW.is_legacy_consumption_share, false);
  NEW.is_legacy_revenue_share := COALESCE(NEW.is_legacy_revenue_share, false);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_chi_agreements_consumption_share_flag
  ON public.community_host_incentive_agreements;
CREATE TRIGGER sync_chi_agreements_consumption_share_flag
  BEFORE INSERT OR UPDATE OF is_legacy_revenue_share, is_legacy_consumption_share
  ON public.community_host_incentive_agreements
  FOR EACH ROW EXECUTE FUNCTION public.sync_chi_consumption_share_flag();

DROP TRIGGER IF EXISTS sync_chi_settlements_consumption_share_flag
  ON public.community_host_incentive_settlements;
CREATE TRIGGER sync_chi_settlements_consumption_share_flag
  BEFORE INSERT OR UPDATE OF is_legacy_revenue_share, is_legacy_consumption_share
  ON public.community_host_incentive_settlements
  FOR EACH ROW EXECUTE FUNCTION public.sync_chi_consumption_share_flag();

CREATE INDEX IF NOT EXISTS idx_chi_agreements_legacy_consumption_share
  ON public.community_host_incentive_agreements(is_legacy_consumption_share)
  WHERE is_legacy_consumption_share = true;

CREATE INDEX IF NOT EXISTS idx_chi_settlements_legacy_consumption_share
  ON public.community_host_incentive_settlements(is_legacy_consumption_share)
  WHERE is_legacy_consumption_share = true;

CREATE OR REPLACE VIEW public.community_host_incentive_payments
WITH (security_invoker = true) AS
SELECT
  settlement.id,
  settlement.agreement_id,
  settlement.event_id,
  agreement.plan_id,
  agreement.venue_id,
  agreement.organizer_user_id,
  agreement.venue_owner_user_id,
  settlement.organizer_payout_cents AS amount_cents,
  settlement.organizer_payout_cents AS builder_payout_cents,
  settlement.status,
  settlement.stripe_invoice_id,
  settlement.stripe_transfer_id,
  settlement.due_at,
  settlement.paid_at,
  settlement.created_at,
  settlement.updated_at,
  settlement.metadata,
  settlement.is_legacy_revenue_share,
  settlement.is_legacy_consumption_share
FROM public.community_host_incentive_settlements settlement
JOIN public.community_host_incentive_agreements agreement
  ON agreement.id = settlement.agreement_id;

COMMENT ON VIEW public.community_host_incentive_payments IS
  'Payment-facing read model for Community Host Incentive settlements. Uses is_legacy_consumption_share as the canonical flag and exposes is_legacy_revenue_share for compatibility until δ.5.';

GRANT SELECT ON public.community_host_incentive_payments TO authenticated;
GRANT SELECT ON public.community_host_incentive_payments TO service_role;

DO $$
DECLARE
  v_agreement_mismatch_count integer;
  v_settlement_mismatch_count integer;
BEGIN
  SELECT count(*)
  INTO v_agreement_mismatch_count
  FROM public.community_host_incentive_agreements
  WHERE is_legacy_consumption_share IS DISTINCT FROM is_legacy_revenue_share;

  IF v_agreement_mismatch_count <> 0 THEN
    RAISE EXCEPTION 'CHI agreement legacy flag backfill mismatch: % rows', v_agreement_mismatch_count;
  END IF;

  SELECT count(*)
  INTO v_settlement_mismatch_count
  FROM public.community_host_incentive_settlements
  WHERE is_legacy_consumption_share IS DISTINCT FROM is_legacy_revenue_share;

  IF v_settlement_mismatch_count <> 0 THEN
    RAISE EXCEPTION 'CHI settlement legacy flag backfill mismatch: % rows', v_settlement_mismatch_count;
  END IF;
END;
$$;
