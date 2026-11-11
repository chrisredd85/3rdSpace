import 'server-only'

import type { DiscoveryCascadeImpact, DiscoveryEntityType } from '@/lib/discovery/cascadeInvalidation'
import { getVenueDetails } from '@/lib/server/venue-places-details'
import { getVendorDetails } from '@/lib/server/vendor-places-details'
import { isGoogleVenueEnabled, isGoogleVendorEnabled } from '@/lib/server/google-places-flags'
import { SAFE_VENUE_TABLE } from '@/lib/discovery/venueRepository'
import { SAFE_VENDOR_TABLE } from '@/lib/discovery/vendorRepository'
import type { SupabaseAdminClient } from '@/lib/planner/planRevisions'

export type DiscoveryRefreshResult = {
  entity_type: DiscoveryEntityType
  entity_id: string
  changes_detected: number
  applied_changes: string[]
  cascade_impact: DiscoveryCascadeImpact
  observation_status?: string
}

type RefreshInput = {
  supabase: SupabaseAdminClient
  entityType: DiscoveryEntityType
  entityId: string
  apiKey: string
  actorId?: string | null
}

const EMPTY_IMPACT: DiscoveryCascadeImpact = {
  invalidated_recommendation_ids: [],
  flagged_commitment_ids: [],
  superseded_outreach_thread_ids: [],
  notifications_to_send: [],
}

/** An observation is request-only: never replace saved facts or create listing history. */
export async function refreshDiscoveryEntityFromPlaces(input: RefreshInput): Promise<DiscoveryRefreshResult> {
  const base = { entity_type: input.entityType, entity_id: input.entityId,
    changes_detected: 0, applied_changes: [], cascade_impact: EMPTY_IMPACT }
  const venue = input.entityType === 'discovery_venue'
  if (!(venue ? isGoogleVenueEnabled() : isGoogleVendorEnabled())) {
    return { ...base, observation_status: 'disabled' }
  }
  const { data, error } = await input.supabase
    .from(venue ? SAFE_VENUE_TABLE : SAFE_VENDOR_TABLE)
    .select('id,source,source_external_id').eq('id', input.entityId).maybeSingle()
  if (error || !data) throw new Error('Discovery identity unavailable')
  if (!venue && data.source !== 'google_places') return { ...base, observation_status: 'unavailable' }
  const details = venue ? getVenueDetails : getVendorDetails
  const result = await details({ placeId: String(data.source_external_id ?? ''), apiKey: input.apiKey, profile: 'pro' })
  return { ...base, observation_status: result.status }
}
