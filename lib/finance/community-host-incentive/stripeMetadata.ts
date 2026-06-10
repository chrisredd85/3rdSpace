import type { CHIAgreementInput, CHISettlementResult } from './types'

export type CHIStripeMetadataInput = {
  chiAgreementId: string
  chiSettlementId: string
  agreement: CHIAgreementInput
  settlement: CHISettlementResult
  verifiedAttendees: number
  eventId: string | null
  venueId: string
  organizerId: string
  legacyPaymentId?: string
  builderStripeAccountId?: string
}

export function buildCHIStripeMetadata(input: CHIStripeMetadataInput): Record<string, string> {
  return {
    payment_type: 'community_host_incentive',
    incentive_type: input.agreement.agreementType,
    calculation_basis: input.settlement.calculationBasis,
    verified_attendees: String(input.verifiedAttendees),
    per_head_rate_cents: String(input.agreement.perHeadRateCents ?? 0),
    applied_floor: String(input.settlement.appliedFloor),
    applied_cap: String(input.settlement.appliedCap),
    is_revenue_share: 'false',
    is_percentage_of_alcohol: 'false',
    is_percentage_of_pos: 'false',
    event_id: input.eventId ?? '',
    venue_id: input.venueId,
    organizer_id: input.organizerId,
    chi_agreement_id: input.chiAgreementId,
    chi_settlement_id: input.chiSettlementId,
    legacy_payment_id: input.legacyPaymentId ?? '',
    builder_stripe_account_id: input.builderStripeAccountId ?? '',
    principal_cents: String(input.settlement.organizerPayoutCents),
    settlement_method: 'invoice',
  }
}
