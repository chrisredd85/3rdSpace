export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { jsonWithDeprecatedKeys } from '@/lib/api/legacy-key-compat'
import { createClient } from '@/lib/supabase/server'
import {
  buildVendorDiscoveryResult,
  normalizeOfferingRows,
  normalizePackageRows,
} from '@/lib/vendors/discovery'

const MARKETPLACE_CACHE_HEADERS = {
  'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
}

const PUBLIC_VENDOR_DISCOVERY_SELECT_COLUMNS = `
  id,
  user_id,
  name,
  vendor_type,
  service_type,
  bio,
  regions_served,
  service_area,
  availability_notes,
  pricing_model,
  hourly_rate,
  base_rate,
  per_person_rate,
  per_head_kickback,
  requires_deposit,
  deposit_amount,
  deposit_type,
  deposit_percentage,
  deposit_refundable,
  deposit_terms,
  is_published,
  is_claimed,
  claimed_user_id,
  is_admin_seeded,
  average_rating,
  rating,
  review_count,
  total_bookings,
  total_gigs,
  created_at,
  updated_at
`

const PUBLIC_VENDOR_OFFERING_SELECT_COLUMNS =
  'id, vendor_id, offering_name, description, base_price, duration_hours, service_category, max_capacity, portfolio_images, equipment_included'

const PUBLIC_VENDOR_PACKAGE_SELECT_COLUMNS =
  'id, vendor_id, package_name, description, price, duration_hours, inclusions'

/**
 * Gets a public vendor profile with services and packages.
 *
 * @route GET /api/vendors/{id}
 * @auth Public
 *
 * @param request - Vendor detail request.
 * @param params - Vendor id route params.
 * @returns Vendor profile detail.
 */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const parsedId = z.string().uuid().safeParse(params.id)
    if (!parsedId.success) {
      return NextResponse.json({ error: 'Invalid vendor id' }, { status: 400 })
    }

    const supabase = createClient()
    const { data: vendor, error: vendorError } = await supabase
      .from('vendor_profiles')
      .select(PUBLIC_VENDOR_DISCOVERY_SELECT_COLUMNS)
      .eq('id', parsedId.data)
      .eq('is_published', true)
      .maybeSingle()

    if (vendorError) {
      console.error('[vendors.detail] Vendor lookup failed', vendorError)
      return NextResponse.json({ error: 'Failed to load vendor' }, { status: 500 })
    }

    if (!vendor) {
      return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })
    }

    const [offeringsResult, packagesResult] = await Promise.all([
      supabase
        .from('vendor_offerings')
        .select(PUBLIC_VENDOR_OFFERING_SELECT_COLUMNS)
        .eq('vendor_id', parsedId.data)
        .eq('is_active', true)
        .order('base_price', { ascending: true }),
      supabase
        .from('vendor_packages')
        .select(PUBLIC_VENDOR_PACKAGE_SELECT_COLUMNS)
        .eq('vendor_id', parsedId.data)
        .eq('is_active', true)
        .order('display_order', { ascending: true }),
    ])

    if (offeringsResult.error || packagesResult.error) {
      console.error('[vendors.detail] Service lookup failed', {
        offerings: offeringsResult.error,
        packages: packagesResult.error,
      })
      return NextResponse.json({ error: 'Failed to load vendor services' }, { status: 500 })
    }

    const services = [
      ...normalizeOfferingRows((offeringsResult.data || []) as Record<string, any>[]),
      ...normalizePackageRows((packagesResult.data || []) as Record<string, any>[]),
    ]
    const detail = stripContactEmail(buildVendorDiscoveryResult(vendor as Record<string, any>, services))

    return jsonWithDeprecatedKeys(
      { vendor: detail },
      ['per_head_kickback'],
      { headers: MARKETPLACE_CACHE_HEADERS }
    )
  } catch (error) {
    console.error('[vendors.detail] Unexpected GET error', error)
    return NextResponse.json({ error: 'Failed to load vendor' }, { status: 500 })
  }
}

function stripContactEmail<T extends { contact_email?: unknown }>(item: T): Omit<T, 'contact_email'> {
  const publicItem = { ...item }
  delete publicItem.contact_email
  return publicItem
}
