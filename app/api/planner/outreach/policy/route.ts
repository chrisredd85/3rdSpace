export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createNextPolicyVersion } from '@/lib/outreach/autonomy'
import { loadLatestOutreachPolicy } from '@/lib/outreach/policyGate'
import { createClient } from '@/lib/supabase/server'
import type { Json, OutreachPolicyAction, PlannerApiErrorResponse } from '@/lib/types'

type PlannerDb = { from(table: string): any }
type PlannerAuth =
  | { db: PlannerDb; userId: string }
  | { response: NextResponse<PlannerApiErrorResponse> }

const policyActionSchema = z.enum([
  'ask_for_quote',
  'send_follow_up',
  'accept_quote_under_cap',
  'schedule_walkthrough',
  'first_contact',
  'reply_to_needs_info',
  'reply_to_price_quote',
  'escalate_channel',
])

const policyUpdateSchema = z.object({
  maxUnattendedBudgetCents: z.number().int().min(0).optional(),
  allowedAutonomousActions: z.array(policyActionSchema).optional(),
  quietHoursStartLocal: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).nullable().optional(),
  quietHoursEndLocal: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).nullable().optional(),
  maxInquiriesPerEvent: z.number().int().min(0).optional(),
  maxFollowupsPerThread: z.number().int().min(0).optional(),
  blacklistedVenueIds: z.array(z.string().uuid()).optional(),
  blacklistedKeywords: z.array(z.string().min(1).max(80)).optional(),
  requireApprovalForFirstContact: z.boolean().optional(),
  irreversibleAutonomousActions: z.array(policyActionSchema).optional(),
})

export async function GET() {
  try {
    const auth = await getPlannerAuth()
    if ('response' in auth) return auth.response

    const policy = await loadLatestOutreachPolicy(auth.db, auth.userId)
    return NextResponse.json({
      policy: policy ?? {
        user_id: auth.userId,
        version: 0,
        max_unattended_budget_cents: 0,
        allowed_autonomous_actions: [],
        quiet_hours_start_local: null,
        quiet_hours_end_local: null,
        max_inquiries_per_event: 0,
        max_followups_per_thread: 0,
        blacklisted_venue_ids: [],
        blacklisted_keywords: [],
        require_approval_for_first_contact: true,
        irreversible_autonomous_actions: [],
        trust_level: 0,
      },
    })
  } catch (error) {
    console.error('[outreach.policy.route] GET failed', error)
    return NextResponse.json({ error: 'Unable to load outreach autonomy policy' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await getPlannerAuth()
    if ('response' in auth) return auth.response

    const parsed = policyUpdateSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.flatten() as Json },
        { status: 400 }
      )
    }

    const policy = await createNextPolicyVersion(auth.db, auth.userId, {
      max_unattended_budget_cents: parsed.data.maxUnattendedBudgetCents,
      allowed_autonomous_actions: parsed.data.allowedAutonomousActions as OutreachPolicyAction[] | undefined,
      quiet_hours_start_local: parsed.data.quietHoursStartLocal,
      quiet_hours_end_local: parsed.data.quietHoursEndLocal,
      max_inquiries_per_event: parsed.data.maxInquiriesPerEvent,
      max_followups_per_thread: parsed.data.maxFollowupsPerThread,
      blacklisted_venue_ids: parsed.data.blacklistedVenueIds,
      blacklisted_keywords: parsed.data.blacklistedKeywords,
      require_approval_for_first_contact: parsed.data.requireApprovalForFirstContact,
      irreversible_autonomous_actions: parsed.data.irreversibleAutonomousActions as OutreachPolicyAction[] | undefined,
    })

    return NextResponse.json({ policy })
  } catch (error) {
    console.error('[outreach.policy.route] POST failed', error)
    return NextResponse.json({ error: 'Unable to update outreach autonomy policy' }, { status: 500 })
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
