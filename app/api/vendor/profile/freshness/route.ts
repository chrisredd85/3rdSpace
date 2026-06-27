export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { recordVendorProfileSelfUpdate } from '@/lib/discovery/freshness'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'

const profileSnapshotSchema = z.object({
  business_name: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  service_type: z.string().nullable().optional(),
  service_area: z.string().nullable().optional(),
  regions_served: z.string().nullable().optional(),
  base_rate: z.union([z.number(), z.string()]).nullable().optional(),
  contact_email: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
}).strict()

const bodySchema = z.object({
  vendor_id: z.string().uuid(),
  previous: profileSnapshotSchema,
  next: profileSnapshotSchema,
}).strict()

/**
 * Records discovery freshness changes after a vendor edits their public service
 * profile. This route does not own the profile update itself; it mirrors the
 * already-saved edit into discovery data and invalidation logs.
 */
export async function POST(request: NextRequest) {
  try {
    const parsed = bodySchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid freshness payload', details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const supabase = createClient()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: vendor, error: vendorError } = await supabase
      .from('vendor_profiles')
      .select('id')
      .eq('id', parsed.data.vendor_id)
      .eq('user_id', user.id)
      .maybeSingle()

    if (vendorError) {
      console.error('[vendor.profile.freshness] vendor_lookup_failed', vendorError)
      return NextResponse.json({ error: 'Failed to verify vendor profile' }, { status: 500 })
    }

    if (!vendor) {
      return NextResponse.json({ error: 'Vendor profile not found' }, { status: 403 })
    }

    const admin = createServiceRoleClient()
    const result = await recordVendorProfileSelfUpdate({
      admin,
      vendorId: parsed.data.vendor_id,
      actorId: user.id,
      previous: parsed.data.previous,
      next: parsed.data.next,
    })

    return NextResponse.json({
      changes: result.changes,
      discovery_vendor_id: result.discoveryVendorId,
    })
  } catch (error) {
    console.error('[vendor.profile.freshness] unexpected_error', error)
    return NextResponse.json({ error: 'Failed to record vendor profile freshness' }, { status: 500 })
  }
}
