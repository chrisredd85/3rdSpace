export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  getOpportunityResponseContext,
  markOpportunityViewed,
  submitOpportunityResponse,
} from '@/lib/opportunities/tokenValidate'
import { createServiceRoleClient } from '@/lib/supabase/server'
import type { Json } from '@/lib/types'
import { handleAcceptedVenueOpportunityRecovery } from '@/lib/venues/venueOpportunityRecovery'

interface RouteContext {
  params: {
    token: string
  }
}

const responseSchema = z.object({
  action: z.enum(['accept', 'decline', 'counter']),
  notes: z.string().trim().max(2000).nullable().optional(),
  quotedAmountCents: z.number().int().nonnegative().nullable().optional(),
  contactName: z.string().trim().max(160).nullable().optional(),
  loadInTime: z.string().trim().max(160).nullable().optional(),
  address: z.string().trim().max(240).nullable().optional(),
  parkingNotes: z.string().trim().max(1000).nullable().optional(),
}).strict()

/**
 * Loads a public opportunity response context by magic-link token.
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const admin = createServiceRoleClient()
    const responseContext = await getOpportunityResponseContext(admin, context.params.token)
    if (!responseContext) return NextResponse.json({ error: 'Response link not found' }, { status: 404 })

    await markOpportunityViewed(admin, responseContext)
    return NextResponse.json({ opportunity: responseContext })
  } catch (error) {
    console.error('Opportunity response GET error:', error)
    return NextResponse.json({ error: 'Unable to load response link' }, { status: 500 })
  }
}

/**
 * Applies an accept, decline, or counter response from a magic-link token.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const parsed = responseSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid response body', details: parsed.error.flatten() as Json },
        { status: 400 }
      )
    }

    const admin = createServiceRoleClient()
    const responseContext = await getOpportunityResponseContext(admin, context.params.token)
    if (!responseContext) return NextResponse.json({ error: 'Response link not found' }, { status: 404 })
    if (responseContext.isExpired) return NextResponse.json({ error: 'Response link expired' }, { status: 410 })

    const invite = await submitOpportunityResponse(admin, responseContext, parsed.data)
    const recovery =
      responseContext.kind === 'venue' && parsed.data.action === 'accept'
        ? await handleAcceptedVenueOpportunityRecovery(admin, context.params.token)
        : null

    return NextResponse.json({
      kind: responseContext.kind,
      status: invite.status,
      invite,
      recovery: recovery
        ? {
            status: recovery.status,
          }
        : null,
    })
  } catch (error) {
    console.error('Opportunity response POST error:', error)
    return NextResponse.json({ error: 'Unable to save response' }, { status: 500 })
  }
}
