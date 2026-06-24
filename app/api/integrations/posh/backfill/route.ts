export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'

import { loadPoshConnectionState } from '@/lib/integrations/poshLink'
import { createClient } from '@/lib/supabase/server'
import { getBuilderProfileId } from '@/lib/supabase/server-helpers'

type PlannerDb = { from: (table: string) => any }

export async function GET() {
  return loadBackfillStatus()
}

export async function POST() {
  return loadBackfillStatus()
}

async function loadBackfillStatus() {
  const auth = await getAuthenticatedBuilder()
  if ('response' in auth) return auth.response

  const state = await loadPoshConnectionState(auth.db, auth.builderProfileId)
  return NextResponse.json(
    {
      historical_data_available: false,
      status: state.status,
      message:
        'Connected Posh. Historical sales import is not available from the current Posh webhook-secret integration; baselines will populate from verified Posh webhook events going forward.',
      connection: {
        status: state.status,
        webhook_url: state.webhookUrl,
        last_event_received_at: state.lastEventReceivedAt,
      },
    },
    { status: 501 }
  )
}

async function getAuthenticatedBuilder(): Promise<
  | { db: PlannerDb; userId: string; builderProfileId: string }
  | { response: NextResponse<{ error: string }> }
> {
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

  return {
    db: supabase as unknown as PlannerDb,
    userId: user.id,
    builderProfileId,
  }
}
