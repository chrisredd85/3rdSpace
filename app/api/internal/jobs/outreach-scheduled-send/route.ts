export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { sendOutreachDraft } from '@/lib/outreach/send'
import { createServiceRoleClient } from '@/lib/supabase/server'

type OutreachDb = { from(table: string): any }

const THREAD_SELECT = `
  id,
  user_id,
  channel
`

/**
 * Dispatches due autonomous outreach messages after the required undo delay.
 */
export async function POST(request: NextRequest) {
  return runScheduledSendRequest(request)
}

export async function GET(request: NextRequest) {
  return runScheduledSendRequest(request)
}

async function runScheduledSendRequest(request: NextRequest) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const requestedLimit = Number(request.nextUrl.searchParams.get('limit') ?? '25')
  const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 25
  const admin = createServiceRoleClient() as unknown as OutreachDb
  const due = await loadDueMessages(admin, limit)
  const result = { checked: due.length, sent: 0, errors: 0, skipped: 0 }

  for (const row of due) {
    try {
      const thread = await loadThread(admin, row.thread_id)
      if (!thread) {
        result.skipped += 1
        continue
      }

      await sendOutreachDraft({
        db: admin,
        threadId: row.thread_id,
        draftMessageId: row.id,
        userId: thread.user_id,
        autonomous: true,
        skipScheduledDelay: true,
      })
      result.sent += 1
    } catch (error) {
      result.errors += 1
      console.error('[outreach-scheduled-send] Failed to dispatch scheduled outreach', {
        messageId: row.id,
        threadId: row.thread_id,
        error,
      })
    }
  }

  return NextResponse.json(result)
}

async function loadDueMessages(db: OutreachDb, limit: number) {
  const { data, error } = await db
    .from('outreach_messages')
    .select('id, thread_id, scheduled_send_at')
    .eq('direction', 'outbound')
    .eq('autonomy_status', 'scheduled')
    .is('sent_at', null)
    .is('cancelled_at', null)
    .lte('scheduled_send_at', new Date().toISOString())
    .order('scheduled_send_at', { ascending: true })
    .limit(limit)

  if (error) throw new Error(error.message)
  return (data ?? []) as Array<{ id: string; thread_id: string; scheduled_send_at: string }>
}

async function loadThread(db: OutreachDb, threadId: string) {
  const { data, error } = await db
    .from('outreach_threads')
    .select(THREAD_SELECT)
    .eq('id', threadId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return data as { id: string; user_id: string; channel: string } | null
}

function isAuthorizedCron(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return process.env.NODE_ENV !== 'production'

  const headerSecret = request.headers.get('x-cron-secret')
  const authHeader = request.headers.get('authorization')
  const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null
  return headerSecret === secret || bearer === secret
}
