export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { claimVenueOpportunityForUser } from '@/lib/venues/venueOpportunityRecovery'

export const runtime = 'nodejs'

type RouteContext = {
  params: {
    token: string
  }
}

/**
 * Claims a token-gated venue opportunity for the authenticated venue owner.
 */
export async function POST(_request: NextRequest, context: RouteContext) {
  const supabase = createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    return NextResponse.json({ error: 'Sign in with a venue account to claim this opportunity.' }, { status: 401 })
  }

  const admin = createServiceRoleClient()
  const result = await claimVenueOpportunityForUser(admin, {
    token: context.params.token,
    userId: user.id,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }

  return NextResponse.json({
    success: true,
    redirectTo: result.redirectTo,
  })
}
