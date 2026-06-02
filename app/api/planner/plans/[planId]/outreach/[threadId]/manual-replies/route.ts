export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { loadOwnedOutreachThread, logInboundChannelReply } from '@/lib/outreach/inbound'
import { createClient } from '@/lib/supabase/server'
import type { Json } from '@/lib/types'

type PlannerDb = { from(table: string): any }

const manualReplySchema = z.object({
  bodyText: z.string().trim().min(1).max(8000),
  receivedAt: z.string().datetime().optional(),
})

interface RouteContext {
  params: {
    planId: string
    threadId: string
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const supabase = createClient()
    const db = supabase as unknown as PlannerDb
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser()

    if (error || !user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    if (user.user_metadata?.user_type !== 'community_builder') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const parsed = manualReplySchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.flatten() as Json },
        { status: 400 }
      )
    }

    const thread = await loadOwnedOutreachThread({
      db,
      planId: context.params.planId,
      threadId: context.params.threadId,
      userId: user.id,
    })
    if (!thread) return NextResponse.json({ error: 'Outreach thread not found' }, { status: 404 })

    const result = await logInboundChannelReply({
      db,
      thread,
      channel: thread.channel,
      bodyText: parsed.data.bodyText,
      receivedAt: parsed.data.receivedAt,
      manual: true,
    })

    return NextResponse.json(result)
  } catch (error) {
    console.error('[outreach.manual-reply] Failed to log manual reply', error)
    return NextResponse.json({ error: 'Could not log reply' }, { status: 500 })
  }
}
