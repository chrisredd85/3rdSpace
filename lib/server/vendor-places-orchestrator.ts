import 'server-only'

import { canonicalGooglePlaceId, parseVenuePlace, type VenuePlaceCandidate } from './google-places-client'
import { createVendorDetailsContext, getVendorDetails, type VendorDetailsContext, type VendorDetailsResult } from './vendor-places-details'
import { isGoogleVendorEnabled } from './google-places-flags'

export const DEFAULT_VENDOR_SHORTLIST_SIZE = 4
export const MAX_VENDOR_SHORTLIST_SIZE = 4
export const VENDOR_DETAILS_CONCURRENCY = 3

export function vendorResultLimit(value?: number): number {
  return Number.isFinite(value) ? Math.min(MAX_VENDOR_SHORTLIST_SIZE, Math.max(1, Math.trunc(value!))) : DEFAULT_VENDOR_SHORTLIST_SIZE
}

/** score receives the entire unique Pro pool, with rating fields removed. */
export function selectVendorPlaces<T extends { place: VenuePlaceCandidate }>(
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
    .slice(0, vendorResultLimit(limit)).map(({ candidate }) => candidate)
}

/** Only selected IDs enter this function; failures never hydrate replacement IDs. */
export async function hydrateVendorShortlist(
  places: VenuePlaceCandidate[], options: { apiKey: string; context?: VendorDetailsContext; profile?: 'pro' | 'enterprise' }
): Promise<VendorDetailsResult[]> {
  if (!isGoogleVendorEnabled()) return []
  const selected = [...new Map(places.slice(0, MAX_VENDOR_SHORTLIST_SIZE).map((place) => [place.id, place])).values()]
  const context = options.context ?? createVendorDetailsContext()
  const results: VendorDetailsResult[] = new Array(selected.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(VENDOR_DETAILS_CONCURRENCY, selected.length) }, async () => {
    while (next < selected.length) {
      const index = next++
      results[index] = await getVendorDetails({ placeId: selected[index].id, apiKey: options.apiKey, profile: options.profile, context })
    }
  }))
  return results
}
