-- Phase gamma: expose CHI settlements through the payment-oriented read model
-- used by venue payout surfaces. Physical legacy table archival is deferred
-- until the per-caller fallback flag is removed.

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
  false::boolean AS is_legacy_revenue_share
FROM public.community_host_incentive_settlements settlement
JOIN public.community_host_incentive_agreements agreement
  ON agreement.id = settlement.agreement_id;

COMMENT ON VIEW public.community_host_incentive_payments IS
  'Payment-facing read model for Community Host Incentive settlements. Values are deterministic cents from approved CHI terms and verified attendance.';

GRANT SELECT ON public.community_host_incentive_payments TO authenticated;
GRANT SELECT ON public.community_host_incentive_payments TO service_role;
