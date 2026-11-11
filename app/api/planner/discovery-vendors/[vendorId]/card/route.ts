import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getVendorDetails } from '@/lib/server/vendor-places-details'
import { isGoogleVendorEnabled } from '@/lib/server/google-places-flags'
import { readSafeDiscoveryVendor, SAFE_VENDOR_TABLE } from '@/lib/discovery/vendorRepository'
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const fetchCache = 'force-no-store'
const headers = { 'Cache-Control': 'private, no-store, max-age=0', 'CDN-Cache-Control': 'no-store', 'Vercel-CDN-Cache-Control': 'no-store' }
export async function GET(_request: Request, context: { params: Promise<{ vendorId: string }> }) {
  if (!isGoogleVendorEnabled()) return new NextResponse(null, { status: 204, headers })
  try {
    const { vendorId } = await context.params
    const db = createClient()
    const { data: { user } } = await db.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401, headers })
    const { data: owned, error } = await db.from('plan_discovery_vendor_candidates').select('id,plans!inner(user_id)').eq('discovery_vendor_id', vendorId).eq('plans.user_id', user.id).limit(1).maybeSingle()
    if (error || !owned) return NextResponse.json({ error: 'Vendor unavailable' }, { status: 404, headers })
    const { data: row } = await createServiceRoleClient().from(SAFE_VENDOR_TABLE).select('id, source, source_external_id, google_place_id').eq('id', vendorId).maybeSingle()
    if (!row || row.source !== 'google_places') return new NextResponse(null, { status: 204, headers })
    const vendor = readSafeDiscoveryVendor(row)
    if (!vendor.source_external_id) return new NextResponse(null, { status: 204, headers })
    const result = await getVendorDetails({ placeId: vendor.source_external_id, profile: 'pro' })
    return NextResponse.json({ vendor_id: vendorId, google_live: result }, { headers })
  } catch { return NextResponse.json({ error: 'Vendor details unavailable' }, { status: 503, headers }) }
}
