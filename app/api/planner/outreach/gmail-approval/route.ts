/**
 * Planner-owned Gmail outreach approval flow.
 *
 * Settings only connects or disconnects Gmail. This route creates a normal
 * planner approval card for reviewed outbound outreach, so the host explicitly
 * approves before any Gmail send occurs.
 */
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  createOrReuseGmailOutreachApproval,
  GmailConnectionRequiredError,
  loadGmailApprovalState,
} from '@/lib/outreach/gmailApprovalFlow'
import { createClient } from '@/lib/supabase/server'

type PlannerDb = { from: (table: string) => any }

const targetSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(254),
})

const createApprovalSchema = z.object({
  targets: z.array(targetSchema).min(1).max(3),
  subject: z.string().trim().min(3).max(180),
  bodyText: z.string().trim().min(20).max(4000),
})

export async function GET() {
  try {
    const auth = await getCreatorAuth()
    if ('response' in auth) return auth.response

    return NextResponse.json(await loadGmailApprovalState(auth.db, auth.userId))
  } catch (error) {
    console.error('[planner.outreach.gmail-approval] GET failed', error)
    return NextResponse.json({ error: 'Failed to load Gmail outreach approvals' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await getCreatorAuth()
    if ('response' in auth) return auth.response

    const parsed = createApprovalSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const result = await createOrReuseGmailOutreachApproval(auth.db, {
      userId: auth.userId,
      targets: parsed.data.targets,
      subject: parsed.data.subject,
      bodyText: parsed.data.bodyText,
    })

    return NextResponse.json({
      plan_id: result.plan.id,
      approval_id: result.approval.id,
      approval_message_id: result.approvalMessageId,
      redirect_url: result.redirectUrl,
    })
  } catch (error) {
    if (error instanceof GmailConnectionRequiredError) {
      return NextResponse.json({ error: error.message, gmail_required: true }, { status: 409 })
    }

    console.error('[planner.outreach.gmail-approval] POST failed', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create Gmail outreach approval' },
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
