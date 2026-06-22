export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { updateVenueProfileFromCompleteForm } from '@/lib/venues/venueOpportunityRecovery'

export const runtime = 'nodejs'

const profileSchema = z.object({
  opportunityToken: z.string().trim().max(256).optional().nullable(),
  venueName: z.string().trim().min(1).max(160),
  address: z.string().trim().min(1).max(240),
  city: z.string().trim().min(1).max(120),
  state: z.string().trim().min(2).max(2),
  zipCode: z.string().trim().min(5).max(12),
  capacity: z.number().int().positive().max(100000),
  venueType: z.string().trim().max(80).optional().nullable(),
  contactEmail: z.string().trim().email().optional().nullable(),
})

/**
 * Completes the venue profile after a token-gated venue opportunity claim.
 */
export async function POST(request: NextRequest) {
  const parsed = profileSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Profile details are incomplete.', details: parsed.error.flatten() }, { status: 400 })
  }

  const supabase = createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    return NextResponse.json({ error: 'Sign in with a venue account to complete this profile.' }, { status: 401 })
  }

  const admin = createServiceRoleClient()
  const result = await updateVenueProfileFromCompleteForm(admin, {
    userId: user.id,
    token: parsed.data.opportunityToken ?? null,
    venueName: parsed.data.venueName,
    address: parsed.data.address,
    city: parsed.data.city,
    state: parsed.data.state,
    zipCode: parsed.data.zipCode,
    capacity: parsed.data.capacity,
    venueType: parsed.data.venueType ?? null,
    contactEmail: parsed.data.contactEmail ?? null,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }

  return NextResponse.json({
    success: true,
    redirectTo: result.redirectTo,
  })
}
