/**
 * API route for managing custom cost line items on a planner plan.
 *
 * Purpose:
 * - PUT replaces the entire custom_costs array stored in plan metadata.
 *
 * Custom costs are persisted as JSON inside the plan's `metadata` column,
 * under the key `custom_costs`. No new table is required.
 */
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import type { Json, PlannerApiErrorResponse } from '@/lib/types'

type PlannerDb = { from: (table: string) => any }
type PlannerAuth =
  | { db: PlannerDb; userId: string }
  | { response: NextResponse<PlannerApiErrorResponse> }

const customCostSchema = z.object({
  id: z.string().uuid(),
  label: z.string().trim().min(1).max(200),
  amount: z.number().positive().finite(),
  created_at: z.string(),
})

const putCustomCostsSchema = z.object({
  custom_costs: z.array(customCostSchema).max(100),
})

interface RouteContext {
  params: Promise<{
    planId: string
  }>
}

/**
 * Replaces the custom_costs array for a plan, persisting it in plan metadata.
 */
export async function PUT(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse<{ ok: true } | PlannerApiErrorResponse>> {
  try {
    const auth = await getPlannerAuth()
    if ('response' in auth) return auth.response

    const parsed = putCustomCostsSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: null },
        { status: 400 }
      )
    }

    const plan = await loadOwnedPlan(auth.db, (await context.params).planId, auth.userId)
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

    const currentMetadata = readRecord(plan.metadata) ?? {}
    const nextMetadata: Json = {
      ...currentMetadata,
      custom_costs: parsed.data.custom_costs,
    } as Json

    const { error } = await auth.db
      .from('plans')
      .update({ metadata: nextMetadata })
      .eq('id', plan.id)
      .eq('user_id', auth.userId)

    if (error) {
      console.error('[custom-costs] plan metadata update error:', error)
      return NextResponse.json({ error: 'Failed to save custom costs' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[custom-costs] unexpected error:', error)
    return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 })
  }
}

async function getPlannerAuth(): Promise<PlannerAuth> {
  const supabase = createClient()
  const db = supabase as unknown as PlannerDb
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    return { response: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) }
  }

  if (user.user_metadata?.user_type !== 'community_builder') {
    return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 403 }) }
  }

  return { db, userId: user.id }
}

async function loadOwnedPlan(db: PlannerDb, planId: string, userId: string) {
  const { data, error } = await db
    .from('plans')
    .select('id, user_id, metadata')
    .eq('id', planId)
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    console.error('[custom-costs] plan lookup error:', error)
    return null
  }

  return (data as { id: string; user_id: string; metadata: unknown } | null) ?? null
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return null
}
