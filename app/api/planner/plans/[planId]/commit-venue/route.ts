export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { PLAN_SELECT_COLUMNS } from '@/lib/planner/dbSelects'
import { recomputePlanDerivedState } from '@/lib/planner/recomputeDerivedState'
import { createClient } from '@/lib/supabase/server'
import type { Json, Plan } from '@/lib/types'

type PlannerDb = { from: (table: string) => any }

interface RouteContext {
  params: Promise<{
    planId: string
  }>
}

const commitVenueSchema = z.object({
  discovery_venue_id: z.string().uuid(),
  quoted_price_cents: z.number().int().nonnegative().nullable().optional(),
  quoted_deal_model: z.string().trim().min(1).nullable().optional(),
  quoted_terms: z.record(z.unknown()).default({}),
})

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await getCreatorAuth()
  if ('response' in auth) return auth.response

  const body = await request.json().catch(() => null)
  const parsed = commitVenueSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid venue commitment payload', issues: parsed.error.flatten() }, { status: 400 })
  }

  const plan = await loadOwnedPlan(auth.db, (await context.params).planId, auth.userId)
  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

  const committedAt = new Date().toISOString()
  const metadata = readRecord(plan.metadata) ?? {}
  const committedVenue = {
    discovery_venue_id: parsed.data.discovery_venue_id,
    quoted_price_cents: parsed.data.quoted_price_cents ?? null,
    quoted_deal_model: parsed.data.quoted_deal_model ?? null,
    quoted_terms: parsed.data.quoted_terms,
    committed_at: committedAt,
  }
  const nextMetadata = {
    ...metadata,
    committed_venue: committedVenue,
    accepted_quote_state: {
      ...(readRecord(metadata.accepted_quote_state) ?? {}),
      venue: committedVenue,
      updated_at: committedAt,
    },
  }

  const { data, error } = await auth.db
    .from('plans')
    .update({
      committed_venue_id: parsed.data.discovery_venue_id,
      committed_venue_quoted_price_cents: parsed.data.quoted_price_cents ?? null,
      committed_venue_quoted_deal_model: parsed.data.quoted_deal_model ?? null,
      committed_venue_quoted_terms: parsed.data.quoted_terms as Json,
      committed_venue_at: committedAt,
      metadata: nextMetadata as Json,
    })
    .eq('id', (await context.params).planId)
    .eq('user_id', auth.userId)
    .select(PLAN_SELECT_COLUMNS)
    .single()

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'Failed to commit venue quote' }, { status: 500 })
  }

  await auth.db
    .from('plan_discovery_venue_candidates')
    .update({ status: 'superseded' })
    .eq('plan_id', (await context.params).planId)
    .neq('discovery_venue_id', parsed.data.discovery_venue_id)
    .in('status', ['candidate', 'approval_created'])

  const planId = (await context.params).planId
  await insertStatusMessage(auth.db, planId, 'Committed venue quote for planning. Other venue outreach was marked superseded, not cancelled.')
  await recomputePlanDerivedState({ supabase: auth.db, planId, trigger: 'commit_changed' })
  const refreshedPlan = await loadOwnedPlan(auth.db, planId, auth.userId)
  return NextResponse.json({ plan: refreshedPlan ?? data })
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const auth = await getCreatorAuth()
  if ('response' in auth) return auth.response

  const plan = await loadOwnedPlan(auth.db, (await context.params).planId, auth.userId)
  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

  const metadata = readRecord(plan.metadata) ?? {}
  const acceptedQuoteState = readRecord(metadata.accepted_quote_state) ?? {}
  const nextMetadata = {
    ...metadata,
    committed_venue: null,
    accepted_quote_state: {
      ...acceptedQuoteState,
      venue: null,
      updated_at: new Date().toISOString(),
    },
  }

  const { data, error } = await auth.db
    .from('plans')
    .update({
      committed_venue_id: null,
      committed_venue_quoted_price_cents: null,
      committed_venue_quoted_deal_model: null,
      committed_venue_quoted_terms: null,
      committed_venue_at: null,
      metadata: nextMetadata as Json,
    })
    .eq('id', (await context.params).planId)
    .eq('user_id', auth.userId)
    .select(PLAN_SELECT_COLUMNS)
    .single()

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'Failed to cancel venue commitment' }, { status: 500 })
  }

  const planId = (await context.params).planId
  await insertStatusMessage(auth.db, planId, 'Cancelled accepted venue quote. The brief returned to comparison mode.')
  await recomputePlanDerivedState({ supabase: auth.db, planId, trigger: 'cancel_commit' })
  const refreshedPlan = await loadOwnedPlan(auth.db, planId, auth.userId)
  return NextResponse.json({ plan: refreshedPlan ?? data })
}

async function getCreatorAuth(): Promise<
  | { db: PlannerDb; userId: string }
  | { response: NextResponse<{ error: string }> }
> {
  const supabase = createClient()
  const db = supabase as unknown as PlannerDb
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return { response: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) }
  if (user.user_metadata?.user_type !== 'community_builder') {
    return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 403 }) }
  }
  return { db, userId: user.id }
}

async function loadOwnedPlan(db: PlannerDb, planId: string, userId: string): Promise<Plan | null> {
  const { data, error } = await db
    .from('plans')
    .select(PLAN_SELECT_COLUMNS)
    .eq('id', planId)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data as Plan | null
}

async function insertStatusMessage(db: PlannerDb, planId: string, content: string) {
  await db.from('plan_messages').insert({
    plan_id: planId,
    role: 'system',
    content,
    message_type: 'status_update',
    metadata: { kind: 'accepted_quote_state' } as Json,
  })
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}
