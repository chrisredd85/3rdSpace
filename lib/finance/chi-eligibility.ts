import 'server-only'

import { isCHIVenueTypeEligible } from '@/lib/finance/community-host-incentive/venueEligibility'

const CHI_ELIGIBLE_VENUE_TYPES = ['bar', 'lounge', 'cafe', 'sports_bar', 'club'] as const

/**
 * Settlement-run eligibility delegates to the existing CHI compliance gate.
 * This keeps epsilon.2 aligned with the currently approved venue-type boundary.
 */
export function isChiEligibleVenueType(venueType: string | null | undefined): boolean {
  return isCHIVenueTypeEligible(venueType)
}

export function listChiEligibleVenueTypes(): readonly string[] {
  return CHI_ELIGIBLE_VENUE_TYPES
}
