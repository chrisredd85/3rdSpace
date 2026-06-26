export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { readPlacesPhotos } from '@/lib/server/places-outreach'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'

type RouteContext = {
  params: Promise<{
    venueId: string
    index: string
  }>
}

const GOOGLE_PLACES_PHOTO_MAX_WIDTH = 900
const GOOGLE_PLACES_PHOTO_MAX_HEIGHT = 600

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const index = Number.parseInt((await context.params).index, 10)
    if (!Number.isInteger(index) || index < 0 || index > 9) {
      return NextResponse.json({ error: 'Invalid photo index' }, { status: 400 })
    }

    const apiKey = process.env.GOOGLE_PLACES_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'GOOGLE_PLACES_API_KEY is not configured' }, { status: 500 })
    }

    const supabase = createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const ownsCandidate = await userOwnsDiscoveryVenue(supabase, user.id, (await context.params).venueId)
    if (!ownsCandidate) {
      return NextResponse.json({ error: 'Discovery venue not found' }, { status: 404 })
    }

    const admin = createServiceRoleClient()
    const { data: venue, error: loadError } = await admin
      .from('discovery_venues')
      .select('id,photos')
      .eq('id', (await context.params).venueId)
      .maybeSingle()

    if (loadError || !venue) {
      return NextResponse.json({ error: 'Discovery venue not found' }, { status: 404 })
    }

    const photo = readPlacesPhotos(venue.photos)[index]
    if (!photo) {
      return NextResponse.json({ error: 'Photo not found' }, { status: 404 })
    }

    const mediaResponse = await fetchGooglePhotoMedia(photo.name, apiKey)
    if (!mediaResponse.ok) {
      console.error('[planner.discovery-venues.photo] media_fetch_failed', {
        venue_id: (await context.params).venueId,
        status: mediaResponse.status,
      })
      return NextResponse.json({ error: 'Failed to fetch photo' }, { status: 502 })
    }

    const contentType = mediaResponse.headers.get('content-type') ?? ''
    let imageResponse = mediaResponse

    if (contentType.includes('application/json')) {
      const payload = await mediaResponse.json().catch(() => null)
      const photoUri = payload && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as { photoUri?: unknown }).photoUri
        : null
      if (typeof photoUri !== 'string' || !photoUri) {
        return NextResponse.json({ error: 'Photo media URL missing' }, { status: 502 })
      }
      imageResponse = await fetch(photoUri)
      if (!imageResponse.ok) {
        return NextResponse.json({ error: 'Failed to fetch photo image' }, { status: 502 })
      }
    }

    const image = await imageResponse.arrayBuffer()
    return new NextResponse(image, {
      status: 200,
      headers: {
        'Content-Type': imageResponse.headers.get('content-type') ?? 'image/jpeg',
        'Cache-Control': 'public, max-age=86400, s-maxage=86400',
        'X-3rdPlace-Photo-Source': 'google_places',
      },
    })
  } catch (error) {
    console.error('[planner.discovery-venues.photo] GET failed', error)
    return NextResponse.json({ error: 'Failed to fetch photo' }, { status: 500 })
  }
}

function fetchGooglePhotoMedia(photoName: string, apiKey: string) {
  const url = new URL(`https://places.googleapis.com/v1/${photoName}/media`)
  url.searchParams.set('maxWidthPx', String(GOOGLE_PLACES_PHOTO_MAX_WIDTH))
  url.searchParams.set('maxHeightPx', String(GOOGLE_PLACES_PHOTO_MAX_HEIGHT))
  url.searchParams.set('skipHttpRedirect', 'true')
  return fetch(url, {
    headers: {
      'X-Goog-Api-Key': apiKey,
    },
  })
}

async function userOwnsDiscoveryVenue(
  db: ReturnType<typeof createClient>,
  userId: string,
  venueId: string
) {
  const { data, error } = await db
    .from('plan_discovery_venue_candidates')
    .select('id,plans!inner(id,user_id)')
    .eq('discovery_venue_id', venueId)
    .eq('plans.user_id', userId)
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error('[planner.discovery-venues.photo] ownership_check_failed', {
      error: error.message,
      venue_id: venueId,
    })
    return false
  }

  return Boolean(data)
}
