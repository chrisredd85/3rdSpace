export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getBuilderProfileId } from '@/lib/supabase/server-helpers'

const paramsSchema = z.object({
  eventId: z.string().uuid(),
  commitmentId: z.string().uuid(),
})

const commitmentPatchSchema = z.object({
  category: z.enum(['venue', 'vendor', 'staff', 'marketing', 'platform_fee', 'tax', 'other']).optional(),
  party_id: z.string().uuid().nullable().optional(),
  party_name: z.string().trim().min(1).nullable().optional(),
  description: z.string().trim().min(1).nullable().optional(),
  amount_cents: z.number().int().nonnegative().optional(),
  state: z.enum(['estimated', 'quoted', 'accepted', 'invoiced', 'paid', 'cancelled']).optional(),
  confidence: z.enum(['low', 'medium', 'high']).optional(),
  evidence_url: z.string().trim().min(1).nullable().optional(),
  evidence_type: z.enum(['contract', 'invoice', 'receipt', 'screenshot', 'none']).optional(),
  metadata: z.record(z.unknown()).optional(),
  paid_at: z.string().trim().min(1).nullable().optional(),
})

type PlannerDb = { from: (table: string) => any }

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ eventId: string; commitmentId: string }> }
) {
  try {
    const parsedParams = paramsSchema.safeParse((await context.params))
    if (!parsedParams.success) {
      return NextResponse.json({ error: 'Invalid commitment id' }, { status: 400 })
    }

    const accessError = await verifyEventAccess(parsedParams.data.eventId)
    if (accessError) return accessError

    const parsedBody = commitmentPatchSchema.safeParse(await request.json().catch(() => ({})))
    if (!parsedBody.success) {
      return NextResponse.json({ error: 'Invalid commitment payload' }, { status: 400 })
    }

    const patch = {
      ...parsedBody.data,
      updated_at: new Date().toISOString(),
    }
    if (parsedBody.data.state === 'paid' && !parsedBody.data.paid_at) {
      patch.paid_at = new Date().toISOString()
    }

    const admin = createServiceRoleClient() as unknown as PlannerDb
    const { data, error } = await admin
      .from('event_cost_commitments')
      .update(patch)
      .eq('id', parsedParams.data.commitmentId)
      .eq('event_id', parsedParams.data.eventId)
      .select('*')
      .single()

    if (error) throw new Error(error.message ?? 'Failed to update cost commitment')
    return NextResponse.json({ commitment: data })
  } catch (error) {
    console.error('[planner.event.commitment] Failed to update commitment', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update cost commitment' },
      { status: 500 }
    )
  }
}

async function verifyEventAccess(eventId: string) {
  const supabase = createClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  if (user.user_metadata?.user_type !== 'community_builder') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const { builderProfileId, error: builderError } = await getBuilderProfileId(supabase, user.id)
  if (builderError || !builderProfileId) {
    return NextResponse.json({ error: 'Builder profile not found' }, { status: 404 })
  }

  const db = supabase as unknown as PlannerDb
  const { data: event, error: eventError } = await db
    .from('events')
    .select('id')
    .eq('id', eventId)
    .eq('builder_id', builderProfileId)
    .maybeSingle()

  if (eventError) throw new Error(eventError.message ?? 'Failed to verify event access')
  if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 })
  return null
}
