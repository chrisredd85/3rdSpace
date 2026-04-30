import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import {
  buildVendorDiscoveryResult,
  normalizeOfferingRows,
  normalizePackageRows,
} from '@/lib/vendors/discovery'

const MARKETPLACE_CACHE_HEADERS = {
  'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
}

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
      .select('*')
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
        .select('*')
        .eq('vendor_id', parsedId.data)
        .eq('is_active', true)
        .order('base_price', { ascending: true }),
      supabase
        .from('vendor_packages')
        .select('*')
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
    const detail = buildVendorDiscoveryResult(vendor as Record<string, any>, services)

    return NextResponse.json(
      { vendor: detail },
      { headers: MARKETPLACE_CACHE_HEADERS }
    )
  } catch (error) {
    console.error('[vendors.detail] Unexpected GET error', error)
    return NextResponse.json({ error: 'Failed to load vendor' }, { status: 500 })
  }
}
