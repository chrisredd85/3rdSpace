import 'server-only'

import { canonicalGooglePlaceId, parseVenuePlace, type VenuePlaceCandidate } from './google-places-client'
import { createVenueDetailsContext, getVenueDetails, type VenueDetailsContext, type VenueDetailsResult } from './venue-places-details'
import { isGoogleVenueEnabled } from './google-places-flags'

export const DEFAULT_VENUE_SHORTLIST_SIZE = 8
export const MAX_VENUE_SHORTLIST_SIZE = 20
export const VENUE_DETAILS_CONCURRENCY = 3

export function venueResultLimit(value?: number): number {
  return Number.isFinite(value) ? Math.min(MAX_VENUE_SHORTLIST_SIZE, Math.max(1, Math.trunc(value!))) : DEFAULT_VENUE_SHORTLIST_SIZE
}

/** score receives the entire unique Pro pool, with rating fields removed. */
export function selectVenuePlaces<T extends { place: VenuePlaceCandidate }>(
  candidates: T[], score: (places: VenuePlaceCandidate[]) => Map<string, number>, limit?: number
): T[] {
  const unique = new Map<string, T>()
  for (const candidate of candidates) {
    const id = canonicalGooglePlaceId(candidate.place.id)
    if (!id || unique.has(id)) continue
    const pro = parseVenuePlace(candidate.place, 'pro')!
    unique.set(id, { ...candidate, place: { ...pro, id } })
  }
  const pool = [...unique.values()]
  const scores = score(pool.map((candidate) => candidate.place))
  return pool.map((candidate, ordinal) => ({ candidate, ordinal, score: scores.get(candidate.place.id) ?? 0 }))
    .filter(entry => entry.score >= 0)
    .sort((a, b) => b.score - a.score || a.ordinal - b.ordinal)
    .slice(0, venueResultLimit(limit)).map(({ candidate }) => candidate)
}

/** Only selected IDs enter this function; failures never hydrate replacement IDs. */
export async function hydrateVenueShortlist(
  places: VenuePlaceCandidate[], options: { apiKey: string; context?: VenueDetailsContext; profile?: 'pro' | 'enterprise' }
): Promise<VenueDetailsResult[]> {
  if (!isGoogleVenueEnabled()) return []
  const selected = [...new Map(places.slice(0, MAX_VENUE_SHORTLIST_SIZE).map((place) => [place.id, place])).values()]
  const context = options.context ?? createVenueDetailsContext()
  const results: VenueDetailsResult[] = new Array(selected.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(VENUE_DETAILS_CONCURRENCY, selected.length) }, async () => {
    while (next < selected.length) {
      const index = next++
      results[index] = await getVenueDetails({ placeId: selected[index].id, apiKey: options.apiKey, profile: options.profile, context })
    }
  }))
  return results
}
