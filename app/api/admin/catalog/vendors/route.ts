export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { SERVICE_TYPE_LABELS } from '@/lib/constants/account-setup'
import { getAdminContext } from '@/lib/server/admin-auth'
import { createServiceRoleClient } from '@/lib/supabase/server'
import type { ServiceType } from '@/lib/types'
import type { Database as GeneratedDatabase } from '@/lib/types/database-generated'

const serviceTypeSchema = z.enum([
  'dj',
  'catering',
  'bartending',
  'photography',
  'videography',
  'av_tech',
  'event_planning',
  'florist',
  'other',
])

const vendorSeedSchema = z.object({
  name: z.string().trim().min(1).max(180),
  service_type: serviceTypeSchema,
  neighborhood: z.string().trim().min(1).max(120).nullable().default(null),
  price_band: z.enum(['budget', 'mid', 'premium']),
  contact_email: z.string().email(),
  package_summary: z.string().trim().max(1200).nullable().default(null),
  lead_time_days: z.number().int().nonnegative().nullable().default(null),
  notes: z.string().trim().max(2000).nullable().default(null),
})

const vendorPublishSchema = z.object({
  id: z.string().trim().min(1),
  is_published: z.boolean(),
})

/**
 * Seeds a new unclaimed vendor listing into the catalog.
 *
 * No owner account is required. The vendor remains read-only to hosts until the
 * claim flow creates a vendor account and links it to the listing.
 *
 * @param request - Admin-authenticated request containing the vendor seed body.
 * @returns The inserted vendor id and success flag.
 */
export async function POST(request: NextRequest) {
  const context = await getAdminContext()
  if (!context.authorized) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const parsed = vendorSeedSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid vendor seed payload', details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const vendor = parsed.data
  const admin = createServiceRoleClient() as unknown as SupabaseClient<GeneratedDatabase>
  const insertPayload = {
    user_id: null,
    name: vendor.name,
    vendor_type: SERVICE_TYPE_LABELS[vendor.service_type as ServiceType],
    service_type: vendor.service_type,
    regions_served: vendor.neighborhood,
    contact_email: vendor.contact_email,
    is_claimed: false,
    claimed_user_id: null,
    is_admin_seeded: true,
    is_published: true,
    pricing_model: 'flat_rate',
    bio: vendor.notes ?? vendor.package_summary ?? '',
    availability_notes: vendor.notes ?? '',
    services_offered: buildSeededVendorServices(vendor.package_summary, vendor.price_band, vendor.lead_time_days),
  }

  const { data, error } = await admin
    .from('vendor_profiles')
    .insert(insertPayload)
    .select('id')
    .single()

  if (error) {
    console.error('[admin.catalog.vendors] Seed failed', error)
    return NextResponse.json(
      { error: 'Failed to seed vendors', details: error.message },
      { status: 500 }
    )
  }

  return NextResponse.json(
    { success: true, vendorId: (data as { id: string } | null)?.id }
  )
}

/**
 * Lists all admin-seeded vendor catalog rows for internal review.
 *
 * The response intentionally includes private claim fields because this route is
 * admin-only and bypasses RLS with the service-role client.
 *
 * @returns Admin-only vendor catalog rows ordered newest first.
 */
export async function GET() {
  const context = await getAdminContext()
  if (!context.authorized) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const admin = createServiceRoleClient()
  const { data, error } = await admin
    .from('vendor_profiles')
    .select('*')
    .eq('is_admin_seeded', true)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[admin.catalog.vendors] List failed', error)
    return NextResponse.json(
      { error: 'Failed to fetch admin-seeded vendors', details: error.message },
      { status: 500 }
    )
  }

  return NextResponse.json({ vendors: data ?? [] })
}

/**
 * Publishes or unpublishes an admin-seeded vendor listing.
 *
 * @param request - Admin-authenticated request containing the vendor id and visibility state.
 * @returns The updated vendor catalog row.
 */
export async function PATCH(request: NextRequest) {
  const context = await getAdminContext()
  if (!context.authorized) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const parsed = vendorPublishSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid vendor publish payload', details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const admin = createServiceRoleClient()
  const { data, error } = await admin
    .from('vendor_profiles')
    .update({
      is_published: parsed.data.is_published,
      updated_at: new Date().toISOString(),
    } as never)
    .eq('id', parsed.data.id)
    .eq('is_admin_seeded', true)
    .select('*')
    .single()

  if (error) {
    console.error('[admin.catalog.vendors] Publish update failed', error)
    return NextResponse.json(
      { error: 'Failed to update vendor visibility', details: error.message },
      { status: 500 }
    )
  }

  return NextResponse.json({ success: true, vendor: data })
}

function buildSeededVendorServices(
  packageSummary: string | null,
  priceBand: 'budget' | 'mid' | 'premium',
  leadTimeDays: number | null
): string[] {
  return [
    packageSummary,
    `Price band: ${priceBand}`,
    leadTimeDays == null ? null : `Lead time: ${leadTimeDays} days`,
  ].filter((value): value is string => Boolean(value))
}
