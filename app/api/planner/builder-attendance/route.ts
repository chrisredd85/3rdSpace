export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  getBuilderProfileIdForUser,
  listBuilderAttendanceEvents,
  summarizeBuilderAttendance,
  type BuilderAttendanceDb,
} from '@/lib/server/builderAttendanceHistory'
import { createClient } from '@/lib/supabase/server'
import type { Json, PlannerApiErrorResponse } from '@/lib/types'

const builderAttendanceQuerySchema = z.object({
  archetype_key: z.string().trim().min(1).optional(),
  window_days: z.coerce.number().int().min(1).max(3650).optional(),
})

export async function GET(
  request: NextRequest
): Promise<NextResponse<Record<string, unknown> | PlannerApiErrorResponse>> {
  try {
    const supabase = createClient()
    const db = supabase as unknown as BuilderAttendanceDb
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser()

    if (error || !user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const params = builderAttendanceQuerySchema.safeParse({
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
      const emptySummary = {
        builder_id: user.id,
        archetype_key: params.data.archetype_key ?? null,
        sample_size: 0,
        avg_tickets_sold: 0,
        median_tickets_sold: 0,
        p75_tickets_sold: 0,
        p95_tickets_sold: 0,
        last_event_at: null,
        confidence: 'low',
      }
      return NextResponse.json(
        { ...emptySummary, events: [] },
        { headers: { 'Cache-Control': 'private, max-age=120' } }
      )
    }

    const opts = {
      archetype_key: params.data.archetype_key,
      window_days: params.data.window_days,
    }
    const [summary, events] = await Promise.all([
      summarizeBuilderAttendance(db, builderId, opts),
      listBuilderAttendanceEvents(db, builderId, { ...opts, limit: 5 }),
    ])

    return NextResponse.json(
      { ...summary, events },
      { headers: { 'Cache-Control': 'private, max-age=120' } }
    )
  } catch (error) {
    console.error('[planner.builder-attendance] GET error', error)
    return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 })
  }
}
