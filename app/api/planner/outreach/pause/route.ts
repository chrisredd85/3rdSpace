export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { pauseCreatorOutreachAgent } from '@/lib/outreach/autonomy'
import { createClient } from '@/lib/supabase/server'
import type { PlannerApiErrorResponse } from '@/lib/types'

type PlannerDb = { from(table: string): any }
type PlannerAuth =
  | { db: PlannerDb; userId: string }
  | { response: NextResponse<PlannerApiErrorResponse> }

export async function POST() {
  try {
    const auth = await getPlannerAuth()
    if ('response' in auth) return auth.response

    const result = await pauseCreatorOutreachAgent({ db: auth.db, userId: auth.userId })
    return NextResponse.json(result)
  } catch (error) {
    console.error('[outreach.pause.route] Failed to pause agent', error)
    return NextResponse.json({ error: 'Unable to pause outreach agent' }, { status: 500 })
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
