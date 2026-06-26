/**
 * Syncs one approved outreach thread from Gmail into the planner inbox model.
 * Uses gmail.readonly only after the host has connected Gmail.
 */
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import {
  GmailConnectionRequiredError,
  syncGmailOutreachThread,
} from '@/lib/outreach/gmailApprovalFlow'
import { createClient } from '@/lib/supabase/server'

type PlannerDb = { from: (table: string) => any }

interface RouteContext {
  params: Promise<{
    threadId: string
  }>
}

export async function POST(_request: Request, context: RouteContext) {
  try {
    const auth = await getCreatorAuth()
    if ('response' in auth) return auth.response

    const result = await syncGmailOutreachThread(auth.db, {
      userId: auth.userId,
      threadId: (await context.params).threadId,
    })

    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof GmailConnectionRequiredError) {
      return NextResponse.json({ error: error.message, gmail_required: true }, { status: 409 })
    }

    console.error('[planner.outreach.gmail-approval.sync] Failed', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to sync Gmail thread' },
      { status: 500 }
    )
  }
}

async function getCreatorAuth(): Promise<
  | { db: PlannerDb; userId: string }
  | { response: NextResponse<{ error: string }> }
> {
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
