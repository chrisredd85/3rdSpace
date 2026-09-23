import 'server-only'

import { NextResponse } from 'next/server'
import { parseGooglePhotoAttribution } from '@/lib/discovery/foundation/attribution'
import type { GooglePlacesPhotoResponse } from '@/lib/discovery/googlePhoto'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'

const NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  'CDN-Cache-Control': 'no-store',
  'Vercel-CDN-Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
}
const MAX_IMAGE_BYTES = 2 * 1024 * 1024
const RASTER_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'])

/** One request owns the fresh reference, bytes and credits; nothing is persisted. */
export async function getDiscoveryPhoto(
  entityType: GooglePlacesPhotoResponse['entityType'],
  entityId: string,
  rawIndex: string,
) {
  // Rollback is hide-only. Stored names and public caching are never re-enabled.
  if (process.env.GOOGLE_PLACES_PHOTOS_ENABLED !== 'true') return unavailable()
  if (!/^[0-9]$/.test(rawIndex)) return unavailable(400)
  const index = Number(rawIndex)

  try {
    const db = createClient()
    const { data: { user }, error: authError } = await db.auth.getUser()
    if (authError || !user) return unavailable(401)

    const isVenue = entityType === 'discovery_venue'
    const { data: candidate, error: ownershipError } = await db
      .from(isVenue ? 'plan_discovery_venue_candidates' : 'plan_discovery_vendor_candidates')
      .select('id,plans!inner(id,user_id)')
      .eq(isVenue ? 'discovery_venue_id' : 'discovery_vendor_id', entityId)
      .eq('plans.user_id', user.id)
      .limit(1)
      .maybeSingle()
    if (ownershipError || !candidate) return unavailable(404)

    const admin = createServiceRoleClient()
    const lookup = isVenue
      ? await admin.from('discovery_venues').select('source,source_external_id').eq('id', entityId).maybeSingle()
      : await admin.from('discovery_vendors').select('source,source_external_id,google_place_id').eq('id', entityId).maybeSingle()
    const entity = lookup.data
    const placeId = entity?.source === 'google_places'
      ? ('google_place_id' in entity ? entity.google_place_id ?? entity.source_external_id : entity.source_external_id)
      : null
    const apiKey = process.env.GOOGLE_PLACES_API_KEY
    if (lookup.error || typeof placeId !== 'string' || !/^[a-zA-Z0-9_-]{1,255}$/.test(placeId) || !apiKey) return unavailable()

    const signal = AbortSignal.timeout(10_000)
    const details = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
      cache: 'no-store',
      redirect: 'error',
      signal,
      headers: { 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': 'id,photos' },
    })
    if (!details.ok) return unavailable()
    const place = await details.json()
    if (place?.id !== placeId || !Array.isArray(place.photos)) return unavailable()
    const photo = place.photos[index]
    const name = typeof photo?.name === 'string' ? photo.name : ''
    const prefix = `places/${placeId}/photos/`
    if (!name.startsWith(prefix) || !/^[a-zA-Z0-9_-]+$/.test(name.slice(prefix.length))) return unavailable()

    const attribution = parseGooglePhotoAttribution(photo)
    // Never display an image if its individual source or supplied credits are lost.
    if (!attribution?.googleMapsUri || !Array.isArray(photo.authorAttributions)
      || attribution.authorAttributions.length !== photo.authorAttributions.length
      || attribution.authorAttributions.some((author) => !author.displayName || !author.uri)) return unavailable()

    const mediaUrl = new URL(`https://places.googleapis.com/v1/${name}/media`)
    mediaUrl.searchParams.set('maxWidthPx', '900')
    mediaUrl.searchParams.set('maxHeightPx', '600')
    mediaUrl.searchParams.set('skipHttpRedirect', 'true')
    const media = await fetch(mediaUrl, {
      cache: 'no-store', redirect: 'error', signal, headers: { 'X-Goog-Api-Key': apiKey },
    })
    if (!media.ok) return unavailable()
    let image = media
    if (media.headers.get('content-type')?.includes('application/json')) {
      const payload = await media.json()
      const imageUrl = readGoogleImageUrl(payload?.photoUri)
      if (!imageUrl) return unavailable()
      image = await fetch(imageUrl, { cache: 'no-store', redirect: 'error', signal })
    }
    const contentType = image.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? ''
    if (!image.ok || !RASTER_TYPES.has(contentType)) return unavailable()
    const bytes = await readBoundedImage(image)
    if (!bytes) return unavailable()

    const paired: GooglePlacesPhotoResponse = {
      entityType, entityId, index,
      dataUrl: `data:${contentType};base64,${bytes.toString('base64')}`,
      attribution,
    }
    return NextResponse.json(paired, { headers: NO_STORE_HEADERS })
  } catch {
    // Provider errors may contain the photo token or API key; do not log them.
    return unavailable()
  }
}

function unavailable(status = 204) {
  return status === 204
    ? new NextResponse(null, { status, headers: NO_STORE_HEADERS })
    : NextResponse.json({ error: 'Photo unavailable' }, { status, headers: NO_STORE_HEADERS })
}

function readGoogleImageUrl(value: unknown): URL | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password
      && (url.hostname === 'googleusercontent.com' || url.hostname.endsWith('.googleusercontent.com'))
      ? url : null
  } catch {
    return null
  }
}

async function readBoundedImage(response: Response): Promise<Buffer | null> {
  if (Number(response.headers.get('content-length')) > MAX_IMAGE_BYTES || !response.body) return null
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_IMAGE_BYTES) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
    return size > 0 ? Buffer.concat(chunks) : null
  } finally {
    reader.releaseLock()
  }
}
