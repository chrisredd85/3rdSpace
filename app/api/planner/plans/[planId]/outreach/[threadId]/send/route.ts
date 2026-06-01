export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { sendOutreachDraft, OutreachSendError } from '@/lib/outreach/send'
import { createClient } from '@/lib/supabase/server'
import type { Json, PlannerApiErrorResponse } from '@/lib/types'

type PlannerDb = { from(table: string): any }
type PlannerAuth =
  | { db: PlannerDb; userId: string }
  | { response: NextResponse<PlannerApiErrorResponse> }

const sendDraftSchema = z.object({
  draftMessageId: z.string().uuid(),
})

interface RouteContext {
  params: {
    planId: string
    threadId: string
  }
}

/**
 * Sends an approved outreach draft through the creator's connected Gmail account.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const auth = await getPlannerAuth()
    if ('response' in auth) return auth.response

    const parsed = sendDraftSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.flatten() as Json },
        { status: 400 }
      )
    }

    const ownsPlan = await verifyOwnedPlan(auth.db, context.params.planId, auth.userId)
    if (!ownsPlan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

    const ownsThread = await verifyOwnedThread(auth.db, context.params.planId, context.params.threadId, auth.userId)
    if (!ownsThread) return NextResponse.json({ error: 'Outreach thread not found' }, { status: 404 })

    const result = await sendOutreachDraft({
      db: auth.db,
      threadId: context.params.threadId,
      draftMessageId: parsed.data.draftMessageId,
      userId: auth.userId,
    })
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof OutreachSendError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('[outreach.send.route] Unexpected send error', error)
    return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 })
  }
}

async function verifyOwnedThread(db: PlannerDb, planId: string, threadId: string, userId: string) {
  const { data, error } = await db
    .from('outreach_threads')
    .select('id')
    .eq('id', threadId)
    .eq('plan_id', planId)
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    console.error('[outreach.send.route] Thread lookup failed', error)
    return false
  }

  return Boolean(data)
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

async function verifyOwnedPlan(db: PlannerDb, planId: string, userId: string) {
  const { data, error } = await db
    .from('plans')
    .select('id')
    .eq('id', planId)
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    console.error('[outreach.send.route] Plan lookup failed', error)
    return false
  }

  return Boolean(data)
}
