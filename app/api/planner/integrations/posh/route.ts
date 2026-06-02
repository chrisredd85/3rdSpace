export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  disconnectPosh,
  linkPoshEvent,
  loadPoshConnectionState,
  savePoshSecret,
} from '@/lib/integrations/poshLink'
import { createClient } from '@/lib/supabase/server'
import { getBuilderProfileId } from '@/lib/supabase/server-helpers'

const saveSecretSchema = z.object({
  secret: z.string().trim().min(8),
})

const linkEventSchema = z.object({
  action: z.literal('link_event'),
  event_id: z.string().uuid(),
  posh_event_id: z.string().trim().min(1),
})

type PlannerDb = { from: (table: string) => any }

type BuilderAuth =
  | { db: PlannerDb; userId: string; builderProfileId: string }
  | { response: NextResponse<{ error: string }> }

export async function GET() {
  try {
    const auth = await getAuthenticatedBuilder()
    if ('response' in auth) return auth.response

    const state = await loadPoshConnectionState(auth.db, auth.builderProfileId)
    return NextResponse.json(state)
  } catch (error) {
    console.error('[planner.posh] Failed to load Posh integration', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load Posh integration' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthenticatedBuilder()
    if ('response' in auth) return auth.response

    const body = await request.json().catch(() => ({}))
    const linkBody = linkEventSchema.safeParse(body)
    if (linkBody.success) {
      const state = await linkPoshEvent({
        db: auth.db,
        builderId: auth.builderProfileId,
        eventId: linkBody.data.event_id,
        poshEventId: linkBody.data.posh_event_id,
      })
      return NextResponse.json({ success: true, state })
    }

    const saveBody = saveSecretSchema.safeParse(body)
    if (!saveBody.success) {
      return NextResponse.json({ error: 'Paste a valid Posh-Secret.' }, { status: 400 })
    }

    await savePoshSecret({
      db: auth.db,
      userId: auth.userId,
      builderId: auth.builderProfileId,
      secret: saveBody.data.secret,
    })

    const state = await loadPoshConnectionState(auth.db, auth.builderProfileId)
    return NextResponse.json({ success: true, state })
  } catch (error) {
    console.error('[planner.posh] Failed to update Posh integration', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update Posh integration' },
      { status: 500 }
    )
  }
}

export async function DELETE() {
  try {
    const auth = await getAuthenticatedBuilder()
    if ('response' in auth) return auth.response

    await disconnectPosh({
      db: auth.db,
      userId: auth.userId,
      builderId: auth.builderProfileId,
    })

    const state = await loadPoshConnectionState(auth.db, auth.builderProfileId)
    return NextResponse.json({ success: true, state })
  } catch (error) {
    console.error('[planner.posh] Failed to disconnect Posh', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to disconnect Posh' },
      { status: 500 }
    )
  }
}

async function getAuthenticatedBuilder(): Promise<BuilderAuth> {
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
