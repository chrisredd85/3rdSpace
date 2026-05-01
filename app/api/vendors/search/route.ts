export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import {
  buildVendorDiscoveryResult,
  normalizeOfferingRows,
  normalizePackageRows,
  normalizeVendorType,
  sortVendorDiscoveryResults,
  type VendorDiscoveryService,
  type VendorSearchSort,
} from '@/lib/vendors/discovery'

const searchSchema = z.object({
  type: z.string().optional().nullable(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  minPrice: z.coerce.number().min(0).optional().nullable(),
  maxPrice: z.coerce.number().min(0).optional().nullable(),
  minRating: z.coerce.number().min(0).max(5).optional().nullable(),
  query: z.string().optional().nullable(),
  sort: z.enum(['rating', 'price', 'popularity']).default('rating'),
})

const MARKETPLACE_CACHE_HEADERS = {
  'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
}

/**
 * Searches published vendors for builder discovery.
 *
 * @route GET /api/vendors/search?type={DJ}&date={YYYY-MM-DD}&maxPrice={1000}
 * @auth Public
 *
 * @param request - Search request with filters.
 * @returns Matching vendors enriched with starting price and services.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = createClient()
    const params = Object.fromEntries(request.nextUrl.searchParams.entries())
    const parsed = searchSchema.safeParse({
      ...params,
      type: request.nextUrl.searchParams.get('type') || request.nextUrl.searchParams.get('service_type'),
      minPrice: request.nextUrl.searchParams.get('minPrice') || request.nextUrl.searchParams.get('min_price'),
      maxPrice: request.nextUrl.searchParams.get('maxPrice') || request.nextUrl.searchParams.get('max_price'),
      minRating: request.nextUrl.searchParams.get('minRating') || request.nextUrl.searchParams.get('rating'),
      query: request.nextUrl.searchParams.get('query') || request.nextUrl.searchParams.get('q'),
      sort: request.nextUrl.searchParams.get('sort') || 'rating',
    })

    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid vendor search filters', details: parsed.error.flatten() }, { status: 400 })
    }

    const filters = parsed.data
    const serviceType = normalizeVendorType(filters.type || null)

    let vendorQuery = supabase
      .from('vendor_profiles')
      .select('*')
      .eq('is_published', true)

    if (serviceType) {
      vendorQuery = vendorQuery.eq('service_type', serviceType)
    }

    if (filters.query) {
      vendorQuery = vendorQuery.or(`name.ilike.%${filters.query}%,bio.ilike.%${filters.query}%,vendor_type.ilike.%${filters.query}%`)
    }

    const { data: vendorRows, error: vendorError } = await vendorQuery

    if (vendorError) {
      console.error('[vendors.search] Vendor lookup failed', vendorError)
      return NextResponse.json({ error: 'Failed to search vendors' }, { status: 500 })
    }

    const vendorIds = ((vendorRows as Record<string, any>[] | null) || []).map((vendor) => vendor.id)
    if (vendorIds.length === 0) {
      return NextResponse.json(
        { vendors: [], count: 0 },
        { headers: MARKETPLACE_CACHE_HEADERS }
      )
    }

    const [offeringsResult, packagesResult, availabilityResult, bookingsResult] = await Promise.all([
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
      filters.date
        ? supabase
            .from('vendor_availability')
            .select('vendor_id, status')
            .in('vendor_id', vendorIds)
            .eq('date', filters.date)
        : Promise.resolve({ data: [], error: null }),
      filters.date
        ? supabase
            .from('vendor_bookings')
            .select('vendor_id, status, booking_date, requested_date, confirmed_date')
            .in('vendor_id', vendorIds)
            .in('status', ['pending', 'confirmed'])
        : Promise.resolve({ data: [], error: null }),
    ])

    if (offeringsResult.error || packagesResult.error || availabilityResult.error || bookingsResult.error) {
      console.error('[vendors.search] Related lookup failed', {
        offerings: offeringsResult.error,
        packages: packagesResult.error,
        availability: availabilityResult.error,
        bookings: bookingsResult.error,
      })
      return NextResponse.json({ error: 'Failed to load vendor search details' }, { status: 500 })
    }

    const offerings = normalizeOfferingRows((offeringsResult.data || []) as Record<string, any>[])
    const packages = normalizePackageRows((packagesResult.data || []) as Record<string, any>[])
    const servicesByVendor = new Map<string, VendorDiscoveryService[]>()
    ;[...offerings, ...packages].forEach((service) => {
      const existing = servicesByVendor.get(service.vendor_id) || []
      existing.push(service)
      servicesByVendor.set(service.vendor_id, existing)
    })

    const unavailableVendorIds = new Set<string>()
    if (filters.date) {
      ;((availabilityResult.data || []) as Array<{ vendor_id: string; status: string }>).forEach((row) => {
        if (['blocked', 'booked', 'tentative'].includes(row.status)) unavailableVendorIds.add(row.vendor_id)
      })
      ;((bookingsResult.data || []) as Array<Record<string, any>>).forEach((booking) => {
        const bookingDate = booking.status === 'confirmed'
          ? booking.confirmed_date || booking.requested_date || booking.booking_date
          : booking.requested_date || booking.booking_date || booking.confirmed_date
        if (bookingDate === filters.date) unavailableVendorIds.add(booking.vendor_id)
      })
    }

    let vendors = ((vendorRows as Record<string, any>[] | null) || [])
      .filter((vendor) => !filters.date || !unavailableVendorIds.has(vendor.id))
      .map((vendor) => buildVendorDiscoveryResult(vendor, servicesByVendor.get(vendor.id) || [], filters.date ? true : undefined))

    if (filters.minRating != null) {
      vendors = vendors.filter((vendor) => vendor.rating >= Number(filters.minRating))
    }

    if (filters.minPrice != null) {
      vendors = vendors.filter((vendor) => (vendor.starting_price ?? Number.MAX_SAFE_INTEGER) >= Number(filters.minPrice))
    }

    if (filters.maxPrice != null) {
      vendors = vendors.filter((vendor) => (vendor.starting_price ?? Number.MAX_SAFE_INTEGER) <= Number(filters.maxPrice))
    }

    vendors = sortVendorDiscoveryResults(vendors, filters.sort as VendorSearchSort)

    return NextResponse.json(
      { vendors, count: vendors.length },
      { headers: MARKETPLACE_CACHE_HEADERS }
    )
  } catch (error) {
    console.error('[vendors.search] Unexpected GET error', error)
    return NextResponse.json({ error: 'Failed to search vendors' }, { status: 500 })
  }
}
