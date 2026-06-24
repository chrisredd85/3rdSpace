export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'

import { createServiceRoleClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const expectedSecret = process.env.CRON_SECRET
  const authorization = request.headers.get('authorization')

  if (!expectedSecret || authorization !== `Bearer ${expectedSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const startedAt = Date.now()
  try {
    const admin = createServiceRoleClient()
    const { data, error } = await (admin as any)
      .rpc('refresh_projection_baselines')
      .maybeSingle()

    if (error) throw new Error(error.message ?? 'Failed to refresh projection baselines')

    return NextResponse.json({
      ok: true,
      duration_ms: Date.now() - startedAt,
      organizer_rows: Number(data?.organizer_rows ?? 0),
      archetype_rows: Number(data?.archetype_rows ?? 0),
    })
  } catch (error) {
    console.error('[baselines.refresh] Cron failed', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Baseline refresh failed' },
      { status: 500 }
    )
  }
}
