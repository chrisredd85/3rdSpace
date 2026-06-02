export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { computeEventActuals } from '@/lib/finance/eventActuals'
import {
  buildRevenueTermBasisFromActuals,
  deleteRevenueTerm,
  listRevenueTerms,
  summarizeRevenueTermImpacts,
  upsertRevenueTerm,
  revenueTermAppliesToSchema,
  revenueTermConfidenceSchema,
  revenueTermSourceSchema,
  revenueTermTypeSchema,
} from '@/lib/finance/revenueTerms'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getBuilderProfileId } from '@/lib/supabase/server-helpers'

const paramsSchema = z.object({
  eventId: z.string().uuid(),
})

const termWriteSchema = z.object({
  id: z.string().uuid().optional(),
  term_type: revenueTermTypeSchema,
  rate: z.number().nonnegative().nullable().optional(),
  flat_cents: z.number().int().nonnegative().nullable().optional(),
  applies_to: revenueTermAppliesToSchema,
  party_id: z.string().uuid().nullable().optional(),
  party_name: z.string().trim().min(1).nullable().optional(),
  notes: z.string().trim().min(1).nullable().optional(),
  confidence: revenueTermConfidenceSchema.default('low'),
  source: revenueTermSourceSchema.default('manual'),
}).refine(
  (term) => term.rate !== null && term.rate !== undefined || term.flat_cents !== null && term.flat_cents !== undefined,
  { message: 'Revenue terms need a rate or flat amount' }
)

const deleteSchema = z.object({
  id: z.string().uuid(),
})

type PlannerDb = { from: (table: string) => any }

type EventAccess =
  | { db: PlannerDb; admin: PlannerDb; builderProfileId: string; event: { id: string; builder_id: string } }
  | { response: NextResponse<{ error: string }> }

export async function GET(
  _request: NextRequest,
  context: { params: { eventId: string } }
) {
  try {
    const parsedParams = paramsSchema.safeParse(context.params)
    if (!parsedParams.success) {
      return NextResponse.json({ error: 'Invalid event id' }, { status: 400 })
    }

    const access = await getEventAccess(parsedParams.data.eventId)
    if ('response' in access) return access.response

    const [terms, actuals] = await Promise.all([
      listRevenueTerms(access.admin, access.event.id),
      computeEventActuals(access.admin, access.event.id),
    ])
    const basis = buildRevenueTermBasisFromActuals(actuals)
    const summary = summarizeRevenueTermImpacts(terms, basis)

    return NextResponse.json({
      terms,
      impacts: summary.impacts,
      summary,
      actuals: {
        gross_revenue_cents: actuals.gross_revenue_cents,
        refunds_cents: actuals.refunds_cents,
        platform_fees_cents: actuals.platform_fees_cents,
        taxes_collected_cents: actuals.taxes_collected_cents,
        net_revenue_cents: actuals.net_revenue_cents,
        tickets_sold: actuals.tickets_sold,
        tickets_refunded: actuals.tickets_refunded,
        tickets_checked_in: actuals.tickets_checked_in,
      },
    })
  } catch (error) {
    console.error('[planner.event.revenue-terms] Failed to load terms', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load revenue terms' },
      { status: 500 }
    )
  }
}

export async function POST(
  request: NextRequest,
  context: { params: { eventId: string } }
) {
  return writeTerm(request, context, 'create')
}

export async function PATCH(
  request: NextRequest,
  context: { params: { eventId: string } }
) {
  return writeTerm(request, context, 'update')
}

export async function DELETE(
  request: NextRequest,
  context: { params: { eventId: string } }
) {
  try {
    const parsedParams = paramsSchema.safeParse(context.params)
    if (!parsedParams.success) {
      return NextResponse.json({ error: 'Invalid event id' }, { status: 400 })
    }

    const access = await getEventAccess(parsedParams.data.eventId)
    if ('response' in access) return access.response

    const requestUrl = new URL(request.url)
    const rawBody = await request.json().catch(() => ({}))
    const parsedBody = deleteSchema.safeParse({
      id: requestUrl.searchParams.get('termId') ?? rawBody.id,
    })
    if (!parsedBody.success) {
      return NextResponse.json({ error: 'Invalid revenue term id' }, { status: 400 })
    }

    await deleteRevenueTerm({
      supabase: access.admin,
      eventId: access.event.id,
      termId: parsedBody.data.id,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[planner.event.revenue-terms] Failed to delete term', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete revenue term' },
      { status: 500 }
    )
  }
}

async function writeTerm(
  request: NextRequest,
  context: { params: { eventId: string } },
  mode: 'create' | 'update'
) {
  try {
    const parsedParams = paramsSchema.safeParse(context.params)
    if (!parsedParams.success) {
      return NextResponse.json({ error: 'Invalid event id' }, { status: 400 })
    }

    const access = await getEventAccess(parsedParams.data.eventId)
    if ('response' in access) return access.response

    const parsedBody = termWriteSchema.safeParse(await request.json().catch(() => ({})))
    if (!parsedBody.success || (mode === 'update' && !parsedBody.data.id)) {
      return NextResponse.json({ error: 'Invalid revenue term payload' }, { status: 400 })
    }

    const term = await upsertRevenueTerm(access.admin, {
      ...parsedBody.data,
      event_id: access.event.id,
      org_id: access.builderProfileId,
    })

    return NextResponse.json({ term }, { status: mode === 'create' ? 201 : 200 })
  } catch (error) {
    console.error('[planner.event.revenue-terms] Failed to write term', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save revenue term' },
      { status: 500 }
    )
  }
}

async function getEventAccess(eventId: string): Promise<EventAccess> {
  const supabase = createClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return { response: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) }
  }

  if (user.user_metadata?.user_type !== 'community_builder') {
    return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 403 }) }
  }

  const { builderProfileId, error: builderError } = await getBuilderProfileId(supabase, user.id)
  if (builderError || !builderProfileId) {
    return { response: NextResponse.json({ error: 'Builder profile not found' }, { status: 404 }) }
  }

  const db = supabase as unknown as PlannerDb
  const { data: event, error: eventError } = await db
    .from('events')
    .select('id, builder_id')
    .eq('id', eventId)
    .eq('builder_id', builderProfileId)
    .maybeSingle()

  if (eventError) throw new Error(eventError.message ?? 'Failed to verify event access')
  if (!event) {
    return { response: NextResponse.json({ error: 'Event not found' }, { status: 404 }) }
  }

  return {
    db,
    admin: createServiceRoleClient() as unknown as PlannerDb,
    builderProfileId,
    event: event as { id: string; builder_id: string },
  }
}
