import { parseGooglePhotoAttribution, type GooglePhotoAttribution } from './foundation/attribution'

export type GooglePhotoEntityType = 'discovery_venue' | 'discovery_vendor'

/** One transient response: image and credit must never be fetched or stored separately. */
export type GooglePlacesPhotoResponse = {
  dataUrl: string
  attribution: GooglePhotoAttribution
  entityType: GooglePhotoEntityType
  entityId: string
  index: number
}

export function readGooglePlacesPhotoResponse(
  value: unknown,
  expected: Pick<GooglePlacesPhotoResponse, 'entityType' | 'entityId' | 'index'>
): GooglePlacesPhotoResponse | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const response = value as Record<string, unknown>
  if (response.entityType !== expected.entityType || response.entityId !== expected.entityId || response.index !== expected.index) return null
  if (typeof response.dataUrl !== 'string' || !/^data:image\/(?:jpeg|png|webp|gif|avif);base64,[A-Za-z0-9+/]+={0,2}$/.test(response.dataUrl)) return null

  const attribution = parseGooglePhotoAttribution(response.attribution)
  if (!attribution?.googleMapsUri) return null
  const supplied = response.attribution as Record<string, unknown>
  if (!Array.isArray(supplied.authorAttributions)
    || supplied.authorAttributions.length !== attribution.authorAttributions.length
    || attribution.authorAttributions.some((author) => !author.displayName || !author.uri)) return null

  return { ...expected, dataUrl: response.dataUrl, attribution }
}
