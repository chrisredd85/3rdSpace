export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import type { Json } from '@/lib/types'

const updateDraftSchema = z.object({
  subject: z.string().trim().max(300).optional(),
  bodyText: z.string().trim().min(1).max(8000),
})

interface RouteContext {
  params: {
    planId: string
    threadId: string
    messageId: string
  }
}

/**
 * Updates an unsent creator-reviewed outreach draft before Gmail send.
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  const supabase = createClient()
  const db = supabase as any
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  if (user.user_metadata?.user_type !== 'community_builder') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const parsed = updateDraftSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request body', details: parsed.error.flatten() as Json },
      { status: 400 }
    )
  }

  const { data: thread, error: threadError } = await db
    .from('outreach_threads')
    .select('id, channel')
    .eq('id', context.params.threadId)
    .eq('plan_id', context.params.planId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (threadError) {
    console.error('[outreach.draft] Thread lookup failed', threadError)
    return NextResponse.json({ error: 'Unable to load outreach thread' }, { status: 500 })
  }
  if (!thread) return NextResponse.json({ error: 'Outreach thread not found' }, { status: 404 })
  if (thread.channel === 'email' && !parsed.data.subject) {
    return NextResponse.json({ error: 'Email drafts require a subject' }, { status: 400 })
  }

  const { data, error: updateError } = await db
    .from('outreach_messages')
    .update({
      subject: parsed.data.subject ?? '',
      body_text: parsed.data.bodyText,
    })
    .eq('id', context.params.messageId)
    .eq('thread_id', context.params.threadId)
    .eq('direction', 'outbound')
    .is('sent_at', null)
    .select('*')
    .maybeSingle()

  if (updateError) {
    console.error('[outreach.draft] Draft update failed', updateError)
    return NextResponse.json({ error: 'Failed to update draft' }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'Editable draft not found' }, { status: 404 })

  return NextResponse.json({ message: data })
}
