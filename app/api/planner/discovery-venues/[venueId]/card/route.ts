import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getVenueDetails } from '@/lib/server/venue-places-details'
import { isGoogleVenueEnabled } from '@/lib/server/google-places-flags'
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const fetchCache = 'force-no-store'
const headers = { 'Cache-Control': 'private, no-store, max-age=0', 'CDN-Cache-Control': 'no-store', 'Vercel-CDN-Cache-Control': 'no-store' }
export async function GET(_request: Request, context: { params: Promise<{ venueId: string }> }) {
  if (!isGoogleVenueEnabled()) return new NextResponse(null, { status: 204, headers })
  try {
    const { venueId } = await context.params
    const db = createClient()
    const { data: { user } } = await db.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401, headers })
    const { data: owned, error } = await db.from('plan_discovery_venue_candidates').select('id,plans!inner(user_id)').eq('discovery_venue_id', venueId).eq('plans.user_id', user.id).limit(1).maybeSingle()
    if (error || !owned) return NextResponse.json({ error: 'Venue unavailable' }, { status: 404, headers })
    const { data: row } = await createServiceRoleClient().from('discovery_venues_safe').select('source_external_id').eq('id', venueId).maybeSingle()
    if (!row?.source_external_id) return new NextResponse(null, { status: 204, headers })
    const result = await getVenueDetails({ placeId: row.source_external_id, profile: 'pro' })
    return NextResponse.json({ venue_id: venueId, google_live: result }, { headers })
  } catch { return NextResponse.json({ error: 'Venue details unavailable' }, { status: 503, headers }) }
}
