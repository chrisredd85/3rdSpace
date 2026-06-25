export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'

import { logChiTrueupDailySummary } from '@/lib/finance/chi-rate-trueup'
import { createServiceRoleClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const expectedSecret = process.env.CRON_SECRET
  const authorization = request.headers.get('authorization')

  if (!expectedSecret || authorization !== `Bearer ${expectedSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const summary = await logChiTrueupDailySummary(createServiceRoleClient() as any)
    return NextResponse.json({ ok: true, summary })
  } catch (error) {
    console.error('[chi-trueup.summary] Cron failed', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'CHI true-up summary failed' },
      { status: 500 },
    )
  }
}
