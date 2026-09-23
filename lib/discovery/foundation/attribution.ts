export type GooglePhotoAuthorAttribution = {
  displayName: string | null
  uri: string | null
}

export type GooglePhotoAttribution = {
  /** The individual photo's URI, never substituted with the enclosing place URI. */
  googleMapsUri: string | null
  authorAttributions: GooglePhotoAuthorAttribution[]
}

/**
 * Reads attribution from one fresh photo object. This is a transient presentation
 * value, not a storage format or proof that an image and its credit are paired.
 */
export function parseGooglePhotoAttribution(value: unknown): GooglePhotoAttribution | null {
  const photo = readRecord(value)
  if (!photo) return null

  const authorAttributions = Array.isArray(photo.authorAttributions)
    ? photo.authorAttributions.flatMap((entry): GooglePhotoAuthorAttribution[] => {
      const author = readRecord(entry)
      if (!author) return []

      const displayName = readText(author.displayName)
      const uri = readSafeHttpsUrl(author.uri)
      return displayName || uri ? [{ displayName, uri }] : []
    })
    : []

  return {
    googleMapsUri: readSafeHttpsUrl(photo.googleMapsUri),
    authorAttributions,
  }
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text.length > 0 ? text : null
}

function readSafeHttpsUrl(value: unknown): string | null {
  const text = readText(value)
  if (!text || !/^https:\/\//i.test(text) || /[\u0000-\u0020\u007f\\]/.test(text)) return null

  try {
    const url = new URL(text)
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return null
    return url.href
  } catch {
    return null
  }
}
