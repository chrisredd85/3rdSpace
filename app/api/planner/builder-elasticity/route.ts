export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  summarizeBuilderTierElasticity,
  type BuilderTierElasticityDb,
} from '@/lib/server/builderTierElasticity'
import { getBuilderProfileIdForUser } from '@/lib/server/builderAttendanceHistory'
import { createClient } from '@/lib/supabase/server'
import type { Json, PlannerApiErrorResponse } from '@/lib/types'

const builderElasticityQuerySchema = z.object({
  archetype_key: z.string().trim().min(1).optional(),
  window_days: z.coerce.number().int().min(1).max(3650).optional(),
})

export async function GET(
  request: NextRequest
): Promise<NextResponse<unknown | PlannerApiErrorResponse>> {
  try {
    const supabase = createClient()
    const db = supabase as unknown as BuilderTierElasticityDb
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser()

    if (error || !user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const params = builderElasticityQuerySchema.safeParse({
      archetype_key: request.nextUrl.searchParams.get('archetype_key') ?? undefined,
      window_days: request.nextUrl.searchParams.get('window_days') ?? undefined,
    })
    if (!params.success) {
      return NextResponse.json(
        { error: 'Invalid query parameters', details: params.error.flatten() as Json },
        { status: 400 }
      )
    }

    const builderId = await getBuilderProfileIdForUser(db, user.id)
    if (!builderId) {
      return NextResponse.json(
        {
          archetype_key: params.data.archetype_key ?? null,
          sample_size: 0,
          confidence: 'low',
          tier_pattern: 'unknown',
          velocity_vector: [],
          recommended_price_floor_cents: null,
          recommended_price_ceiling_cents: null,
          reasoning_for_agent: 'Not enough tier-level ticket history to price from historical elasticity yet.',
        },
        { headers: { 'Cache-Control': 'private, max-age=120' } }
      )
    }

    const signal = await summarizeBuilderTierElasticity(db, builderId, {
      archetype_key: params.data.archetype_key,
      window_days: params.data.window_days,
    })

    return NextResponse.json(signal, {
      headers: { 'Cache-Control': 'private, max-age=120' },
    })
  } catch (error) {
    console.error('[planner.builder-elasticity] GET error', error)
    return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 })
  }
}
