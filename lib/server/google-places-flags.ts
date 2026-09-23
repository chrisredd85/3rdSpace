import 'server-only'

/** Venue acquisition is globally opt-in. No cohort or legacy fallback. */
export function isGoogleVenueEnabled(): boolean {
  return process.env.GOOGLE_PLACES_VENUES_ENABLED === 'true'
}

export function areGooglePhotosEnabled(entity: 'discovery_venue' | 'discovery_vendor' | 'venue' | 'vendor'): boolean {
  return (entity === 'venue' || entity === 'discovery_venue')
    && isGoogleVenueEnabled()
    && process.env.GOOGLE_PLACES_PHOTOS_ENABLED === 'true'
}
