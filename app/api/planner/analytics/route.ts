export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import {
  buildMobileAnalyticsReadModel,
  type PlannerDb,
} from '@/lib/planner/mobileReadModels'
import { createClient } from '@/lib/supabase/server'
import { getBuilderProfileId } from '@/lib/supabase/server-helpers'

/**
 * Returns cross-event mobile analytics using deterministic aggregates only.
 * No LLM call is made for the recommendation copy.
 */
export async function GET() {
  try {
    const supabase = createClient()
    const db = supabase as unknown as PlannerDb
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    if (user.user_metadata?.user_type !== 'community_builder') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const { builderProfileId, error: builderError } = await getBuilderProfileId(supabase, user.id)
    if (builderError || !builderProfileId) {
      return NextResponse.json({ error: 'Builder profile not found' }, { status: 403 })
    }

    return NextResponse.json(await buildMobileAnalyticsReadModel(db, builderProfileId))
  } catch (error) {
    console.error('[mobile.planner.analytics] GET failed', error)
    return NextResponse.json({ error: 'Unable to load planner analytics' }, { status: 500 })
  }
}
