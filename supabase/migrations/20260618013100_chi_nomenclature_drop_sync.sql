-- Migration: CHI nomenclature sync trigger cleanup
-- Created: 2026-06-18
-- Context: Application code now dual-writes the legacy compatibility flag and
-- the CHI-named flag. The short-lived trigger from the additive migration is
-- removed so future writes make the chosen column explicit.

DROP TRIGGER IF EXISTS sync_chi_agreements_consumption_share_flag
  ON public.community_host_incentive_agreements;

DROP TRIGGER IF EXISTS sync_chi_settlements_consumption_share_flag
  ON public.community_host_incentive_settlements;

DROP FUNCTION IF EXISTS public.sync_chi_consumption_share_flag();

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
    RAISE EXCEPTION 'Cannot drop CHI agreement sync trigger with mismatched flags: % rows', v_agreement_mismatch_count;
  END IF;

  SELECT count(*)
  INTO v_settlement_mismatch_count
  FROM public.community_host_incentive_settlements
  WHERE is_legacy_consumption_share IS DISTINCT FROM is_legacy_revenue_share;

  IF v_settlement_mismatch_count <> 0 THEN
    RAISE EXCEPTION 'Cannot drop CHI settlement sync trigger with mismatched flags: % rows', v_settlement_mismatch_count;
  END IF;
END;
$$;
