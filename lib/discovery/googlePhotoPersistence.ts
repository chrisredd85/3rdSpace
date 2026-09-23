/** Google photo identifiers are request-only. Independent uploaded images are unaffected. */
const photoKeys = new Set([
  'google_photo_names', 'google_photos', 'places_photos', 'photo_reference',
  'photo_references', 'photoReference', 'photoreference', 'photoName', 'photo_name',
  'authorAttributions', 'photoUri', 'photo_uri',
])

const photoText = /https?:\/\/places\.googleapis\.com\/[^\s"'<>]*\/photos\/[^\s"'<>]*|https?:\/\/maps\.googleapis\.com\/maps\/api\/place\/photo[^\s"'<>]*|https?:\/\/lh\d*\.googleusercontent\.com\/(?:places|p)\/[^\s"'<>]*|places(?:\/|%2f)[^\s"'<>]+?(?:\/|%2f)photos(?:\/|%2f)[^\s"'<>]+/gi
const omitted = '[Google photo omitted]'
const photoObjectKeys = new Set([
  'name', 'url', 'photo_url', 'photoUri', 'heightPx', 'widthPx', 'width', 'height',
  'caption', 'source', 'authorAttributions', 'googleMapsUri',
  'dataUrl', 'attribution', 'entityType', 'entityId', 'index',
])

export function isGooglePhotoField(field: string): boolean {
  return photoKeys.has(field) || field === 'photos'
}

/**
 * Photo-only copy boundary for JSON-shaped payloads, including old nested copies.
 * It does not edit existing database rows or establish other Places retention rights.
 */
export function stripGooglePhotoData<T>(value: T): T {
  return strip(value) as T
}

export function containsGooglePhotoData(value: unknown): boolean {
  return JSON.stringify(strip(value)) !== JSON.stringify(value)
}

function strip(value: unknown): unknown {
  if (typeof value === 'string') {
    // Agent outputs can contain serialized JSON with opaque legacy photo tokens.
    if (/^\s*[\[{]/.test(value)) {
      try {
        const parsed = JSON.parse(value)
        const sanitized = strip(parsed)
        if (JSON.stringify(parsed) !== JSON.stringify(sanitized)) return JSON.stringify(sanitized)
      } catch { /* Ordinary prose is handled below. */ }
    }
    return value.replace(photoText, omitted)
  }
  if (Array.isArray(value)) return value.filter(item => !isGooglePhotoObject(item)).map(strip)
  if (!value || typeof value !== 'object') return value
  if (value instanceof Date) return value
  if (isGooglePhotoObject(value)) return null

  const result: Record<string, unknown> = {}
  const row = value as Record<string, unknown>
  for (const [key, entry] of Object.entries(value)) {
    if (photoKeys.has(key)) continue
    if (key === 'dataUrl' && hasPhotoAttribution(row.attribution)) continue
    if (key === 'googleMapsUri' && Array.isArray(row.authorAttributions)) continue
    if (key === 'photos' && (row.source === 'google_places' || typeof row.google_place_id === 'string')) {
      // Keep independent URLs even in mixed-origin rows; opaque strings are old
      // provider names, not independently hosted images.
      const independentImages = Array.isArray(entry) ? entry.filter(item => {
        if (typeof item === 'string') return /^https?:\/\//i.test(item)
        if (!item || typeof item !== 'object') return false
        const image = item as Record<string, unknown>
        return typeof image.url === 'string' || typeof image.image_url === 'string'
      }) : []
      Object.defineProperty(result, key, { value: strip(independentImages), enumerable: true, writable: true, configurable: true })
      continue
    }
    Object.defineProperty(result, key, { value: strip(entry), enumerable: true, writable: true, configurable: true })
  }
  return result
}

function isGooglePhotoObject(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  // A business record may have an incidental image URL alongside money/IDs.
  // Remove the whole object only when it is a photo record, not that business row.
  if (!Object.keys(row).every(key => photoObjectKeys.has(key))) return false
  if (typeof row.dataUrl === 'string' && hasPhotoAttribution(row.attribution)) return true
  if (typeof row.googleMapsUri === 'string' && Array.isArray(row.authorAttributions)) return true
  return [row.name, row.photoUri, row.photo_url, row.url].some(entry =>
    typeof entry === 'string' && entry.replace(photoText, omitted) !== entry)
}

function hasPhotoAttribution(value: unknown): boolean {
  return value !== null && typeof value === 'object' &&
    ('authorAttributions' in value || 'googleMapsUri' in value)
}
