import type { CHIAgreementInput, CHISettlementResult } from './types'

function formatCents(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new Error('Invoice cents must be a non-negative integer')
  }

  const dollars = Math.floor(cents / 100)
  const centsPart = String(cents % 100).padStart(2, '0')
  return `$${dollars.toLocaleString('en-US')}.${centsPart}`
}

export function renderCHIInvoiceLine(input: {
  agreement: CHIAgreementInput
  settlement: CHISettlementResult
  verifiedAttendees: number
}): string {
  const { agreement, settlement, verifiedAttendees } = input
  const payout = formatCents(settlement.organizerPayoutCents)

  if (agreement.agreementType === 'per_verified_attendee') {
    return `Community Host Incentive - ${verifiedAttendees} verified attendees x ${formatCents(
      agreement.perHeadRateCents ?? 0
    )} = ${payout}`
  }

  if (agreement.agreementType === 'fixed_threshold') {
    return `Community Host Incentive - Fixed incentive after ${agreement.thresholdAttendees ?? 0}-attendee threshold met = ${payout}`
  }

  if (agreement.agreementType === 'base_plus_per_attendee') {
    return `Community Host Incentive - Base ${formatCents(
      agreement.baseAmountCents ?? 0
    )} + (${verifiedAttendees} verified attendees x ${formatCents(agreement.perHeadRateCents ?? 0)}) = ${payout}`
  }

  if (agreement.agreementType === 'manual_venue_approved') {
    return `Community Host Incentive - Venue-approved fixed incentive = ${payout}`
  }

  return `Community Host Incentive - Fixed incentive = ${payout}`
}
