export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  buildVendorDiscoveryResult,
  normalizeOfferingRows,
  normalizePackageRows,
  sortVendorDiscoveryResults,
  type VendorDiscoveryService,
} from '@/lib/vendors/discovery'

const MARKETPLACE_CACHE_HEADERS = {
  'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
}

/**
 * Gets featured vendors for marketplace entry points.
 *
 * Featured is currently derived from rating and booking/popularity columns.
 *
 * @route GET /api/vendors/featured
 * @auth Public
 *
 * @param request - Featured vendor request.
 * @returns Featured vendors.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = createClient()
    const limit = Number(request.nextUrl.searchParams.get('limit') || 6)

    const { data: vendorRows, error: vendorError } = await supabase
      .from('vendor_profiles')
      .select('*')
      .eq('is_published', true)
      .order('average_rating', { ascending: false, nullsFirst: false })
      .order('total_bookings', { ascending: false, nullsFirst: false })
      .limit(Math.min(Math.max(limit, 1), 12))

    if (vendorError) {
      console.error('[vendors.featured] Vendor lookup failed', vendorError)
      return NextResponse.json({ error: 'Failed to load featured vendors' }, { status: 500 })
    }

    const vendorIds = ((vendorRows as Record<string, any>[] | null) || []).map((vendor) => vendor.id)
    if (vendorIds.length === 0) {
      return NextResponse.json(
        { vendors: [], count: 0 },
        { headers: MARKETPLACE_CACHE_HEADERS }
      )
    }

    const [offeringsResult, packagesResult] = await Promise.all([
      supabase
        .from('vendor_offerings')
        .select('id, vendor_id, offering_name, description, base_price, duration_hours, service_category, max_capacity, portfolio_images, equipment_included')
        .in('vendor_id', vendorIds)
        .eq('is_active', true),
      supabase
        .from('vendor_packages')
        .select('id, vendor_id, package_name, description, price, duration_hours, inclusions')
        .in('vendor_id', vendorIds)
        .eq('is_active', true),
    ])

    if (offeringsResult.error || packagesResult.error) {
      console.error('[vendors.featured] Related lookup failed', {
        offerings: offeringsResult.error,
        packages: packagesResult.error,
      })
      return NextResponse.json({ error: 'Failed to load featured vendor details' }, { status: 500 })
    }

    const servicesByVendor = new Map<string, VendorDiscoveryService[]>()
    ;[
      ...normalizeOfferingRows((offeringsResult.data || []) as Record<string, any>[]),
      ...normalizePackageRows((packagesResult.data || []) as Record<string, any>[]),
    ].forEach((service) => {
      const existing = servicesByVendor.get(service.vendor_id) || []
      existing.push(service)
      servicesByVendor.set(service.vendor_id, existing)
    })

    const vendors = sortVendorDiscoveryResults(
      ((vendorRows as Record<string, any>[] | null) || []).map((vendor) =>
        buildVendorDiscoveryResult(vendor, servicesByVendor.get(vendor.id) || [])
      ),
      'rating'
    )

    return NextResponse.json(
      { vendors, count: vendors.length },
      { headers: MARKETPLACE_CACHE_HEADERS }
    )
  } catch (error) {
    console.error('[vendors.featured] Unexpected GET error', error)
    return NextResponse.json({ error: 'Failed to load featured vendors' }, { status: 500 })
  }
}
