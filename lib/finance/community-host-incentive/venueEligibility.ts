const CHI_ELIGIBLE_VENUE_TYPES = new Set([
  'bar',
  'lounge',
  'cafe',
  'sports_bar',
  'club',
])

const RENTAL_ONLY_VENUE_TYPES = new Set([
  'event_space',
  'event_hall',
  'gallery',
  'studio',
  'coworking_event_space',
])

const HYBRID_REVIEW_VENUE_TYPES = new Set([
  'restaurant',
  'restaurant_buyout',
  'private_dining_room',
  'rooftop',
  'winery',
  'hotel',
  'retail',
  'market_hall',
  'outdoor_park',
])

export type CHIVenueEligibility =
  | 'community_host_incentive'
  | 'venue_rental'
  | 'manual_admin_review'

export function classifyCHIVenueType(venueType: string | null | undefined): CHIVenueEligibility {
  const normalized = venueType?.trim().toLowerCase()

  if (!normalized) return 'manual_admin_review'
  if (CHI_ELIGIBLE_VENUE_TYPES.has(normalized)) return 'community_host_incentive'
  if (RENTAL_ONLY_VENUE_TYPES.has(normalized)) return 'venue_rental'
  if (HYBRID_REVIEW_VENUE_TYPES.has(normalized)) return 'manual_admin_review'

  return 'manual_admin_review'
}

export function isCHIVenueTypeEligible(venueType: string | null | undefined): boolean {
  return classifyCHIVenueType(venueType) === 'community_host_incentive'
}
