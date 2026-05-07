/**
 * Demo reset route — wipes all plans, messages, and approvals for the demo
 * account and re-inserts the seed conversation so the next demo starts fresh.
 *
 * Protected by DEMO_MODE.  Requires a valid demo-user session cookie so only
 * someone who is already signed in as the demo account can trigger the reset
 * (prevents random external callers from wiping the DB).
 *
 * POST /api/demo/reset
 * Returns { ok: true, plan_id } on success.
 */
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { PLAN_MESSAGE_SELECT_COLUMNS, PLAN_SELECT_COLUMNS } from '@/lib/planner/dbSelects'
import type { Plan, PlanMessage } from '@/lib/types'

const DEMO_EMAIL = 'demo@3rdspace.com'

// ── Seed data ────────────────────────────────────────────────────────────────

const SEED_PLAN = {
  title: 'SF Tech Week Mixer — 120 founders & investors',
  event_type: 'Mixer',
  status: 'drafting' as const,
  guest_count: 120,
  budget_cap_cents: 1200000, // $12,000
  neighborhood: 'SOMA',
  date_window_start: '2025-10-13',
  date_window_end: '2025-10-18',
  ticketed: true,
  ticketing_model: 'free',
  notes: 'SF Tech Week side event. Rooftop preferred. A/V + catering needed.',
}

const SEED_MESSAGES: Array<{
  role: 'user' | 'agent'
  content: string
  message_type: 'text' | 'confirmation_card' | 'recommendation' | 'approval_request' | 'status_update'
  metadata: Record<string, unknown>
}> = [
  {
    role: 'user',
    content: 'I want to host a rooftop mixer for 120 founders and investors during SF Tech Week. Budget around $12k.',
    message_type: 'text',
    metadata: {},
  },
  {
    role: 'agent',
    content:
      "Perfect — a rooftop mixer for 120 during Tech Week is a natural fit. I've captured the key details. Let me confirm a few things so I can start pulling venue options:\n\n• **Dates**: Oct 13–18 (Tech Week window)\n• **Budget**: $12,000 all-in\n• **Guest count**: 120\n• **Neighborhood**: SOMA area preferred?\n\nWhat day within that window works best — are you flexible, or targeting a specific night?",
    message_type: 'confirmation_card',
    metadata: {
      plan_updates: {
        event_type: 'Mixer',
        guest_count: 120,
        budget_cap_cents: 1200000,
        date_window_start: '2025-10-13',
        date_window_end: '2025-10-18',
        neighborhood: 'SOMA',
      },
    },
  },
  {
    role: 'user',
    content: 'Wednesday the 15th is ideal. Free entry, no tickets needed.',
    message_type: 'text',
    metadata: {},
  },
  {
    role: 'agent',
    content:
      "Got it — Wednesday Oct 15, free-admission rooftop mixer. I've updated the plan and I'm pulling three venue options now.\n\nBefore I send inquiries, a couple of quick questions:\n1. **Catering**: open bar only, or food too?\n2. **A/V**: DJ, ambient music, or just PA for speeches?",
    message_type: 'text',
    metadata: {
      plan_updates: {
        date_window_start: '2025-10-15',
        date_window_end: '2025-10-15',
        ticketed: false,
      },
    },
  },
  {
    role: 'user',
    content: 'Open bar + light bites. DJ for the evening.',
    message_type: 'text',
    metadata: {},
  },
  {
    role: 'agent',
    content:
      "Great. I've sent inquiry briefs to three SOMA rooftops that fit the headcount and budget — **The Battery Rooftop**, **Bespoke SF**, and **150 Hooper**. Typical response time is 24–48 hours.\n\nWhile we wait, I've drafted a hold request for The Battery (highest availability signal). Want me to place a soft hold so they don't book out from under us?",
    message_type: 'recommendation',
    metadata: {
      recommendations: [
        {
          type: 'venue',
          external_name: 'The Battery Rooftop',
          price_cents: 480000,
          notes: 'Rooftop terrace, 150-person cap, full bar service, DJ-ready setup',
          is_best_fit: true,
          rank: 1,
        },
        {
          type: 'venue',
          external_name: 'Bespoke SF',
          price_cents: 420000,
          notes: 'Flexible tech-forward space, 120-person outdoor deck, AV included',
          is_best_fit: false,
          rank: 2,
        },
        {
          type: 'venue',
          external_name: '150 Hooper',
          price_cents: 380000,
          notes: 'Industrial outdoor space, 100–200 pax, affordable day-of rate',
          is_best_fit: false,
          rank: 3,
        },
      ],
    },
  },
  {
    role: 'user',
    content: 'Yes — go ahead and place a soft hold on The Battery.',
    message_type: 'text',
    metadata: {},
  },
  {
    role: 'agent',
    content:
      "I need your approval before contacting The Battery to place the hold. This does **not** charge anything — it's a 48-hour courtesy hold so they reserve the date for us.\n\n**Hold request details:**\n- Venue: The Battery Rooftop\n- Date: Wednesday, Oct 15, 2025\n- Package: Rooftop buyout (6pm–midnight)\n- Estimated cost: $4,800\n- No payment due until you confirm\n\nApprove this hold request to proceed?",
    message_type: 'approval_request',
    metadata: {
      approval: {
        id: 'seed-approval-1',
        action_label: 'Venue soft hold — The Battery Rooftop',
        provider: 'The Battery SF',
        event_date: '2025-10-15',
        price_cents: 480000,
        requested_amount_cents: 0,
        refund_terms: '48-hour courtesy hold, no charge',
        status: 'pending',
      },
    },
  },
]

// ─────────────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (process.env.NEXT_PUBLIC_DEMO_MODE !== 'true') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Verify the caller is the demo user
  const userClient = createClient()
  const { data: { user }, error: userError } = await userClient.auth.getUser()

  if (userError || !user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  if (user.email !== DEMO_EMAIL) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const admin = createServiceRoleClient()

  try {
    // ── Wipe existing demo data ───────────────────────────────────────────────
    // Delete plans — cascades to plan_messages, approvals, recommendations, etc.
    const { error: deleteError } = await (admin as any)
      .from('plans')
      .delete()
      .eq('user_id', user.id)

    if (deleteError) {
      console.error('[demo/reset] Failed to delete plans:', deleteError)
      return NextResponse.json({ error: 'Failed to reset demo data' }, { status: 500 })
    }

    // ── Re-seed plan ──────────────────────────────────────────────────────────
    const { data: planData, error: planError } = await (admin as any)
      .from('plans')
      .insert({ ...SEED_PLAN, user_id: user.id })
      .select(PLAN_SELECT_COLUMNS)
      .single()

    if (planError || !planData) {
      console.error('[demo/reset] Failed to insert seed plan:', planError)
      return NextResponse.json({ error: 'Failed to seed plan' }, { status: 500 })
    }

    const plan = planData as Plan
    const now = Date.now()

    // ── Re-seed messages ──────────────────────────────────────────────────────
    const messageInserts = SEED_MESSAGES.map((msg, index) => ({
      plan_id: plan.id,
      role: msg.role,
      content: msg.content,
      message_type: msg.message_type,
      metadata: msg.metadata,
      created_at: new Date(now - (SEED_MESSAGES.length - index) * 60_000).toISOString(),
    }))

    const { data: messagesData, error: messagesError } = await (admin as any)
      .from('plan_messages')
      .insert(messageInserts)
      .select(PLAN_MESSAGE_SELECT_COLUMNS)

    if (messagesError) {
      console.error('[demo/reset] Failed to insert seed messages:', messagesError)
      return NextResponse.json({ error: 'Failed to seed messages' }, { status: 500 })
    }

    const messages = (messagesData ?? []) as PlanMessage[]

    // ── Seed a real approval record linked to the approval_request message ────
    const approvalMsg = messages.find((m) => m.message_type === 'approval_request')
    if (approvalMsg) {
      await (admin as any).from('approvals').insert({
        plan_id: plan.id,
        action_label: 'Venue soft hold — The Battery Rooftop',
        provider: 'The Battery SF',
        event_date: '2025-10-15',
        price_cents: 480000,
        requested_amount_cents: 0,
        refund_terms: '48-hour courtesy hold, no charge',
        status: 'pending',
      })
    }

    return NextResponse.json({ ok: true, plan_id: plan.id })
  } catch (error) {
    console.error('[demo/reset] Unexpected error:', error)
    return NextResponse.json({ error: 'Unexpected error' }, { status: 500 })
  }
}
