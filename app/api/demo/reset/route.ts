export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { PLAN_MESSAGE_SELECT_COLUMNS, PLAN_SELECT_COLUMNS } from '@/lib/planner/dbSelects'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import type { Plan } from '@/lib/types'
import type { Database as GeneratedDatabase } from '@/lib/types/database-generated'

const DEMO_EMAIL = 'demo@3rdspace.com'

const seedPlan = {
  title: 'SF Tech Week Mixer',
  event_type: 'Mixer',
  status: 'drafting' as const,
  guest_count: 120,
  budget_cap_cents: 1200000,
  neighborhood: 'SOMA',
  date_window_start: '2026-06-15',
  date_window_end: '2026-06-15',
  ticketed: false,
  ticketing_model: 'free RSVP',
  food_responsibility: 'Open bar and light bites',
  venue_terms: null,
  agent_action: null,
  notes: 'Demo planner session. Rooftop preferred. A/V and DJ needed.',
}

const seedMessages = [
  {
    role: 'user',
    content: 'I want to host a rooftop mixer for 120 founders and investors during SF Tech Week. Budget around $12k.',
    message_type: 'text',
    metadata: {},
  },
  {
    role: 'agent',
    content:
      'Perfect. I captured a 120-person SF Tech Week mixer in SOMA with a $12,000 budget. I still need the date, food and drink plan, and ticketing model before I recommend holds.',
    message_type: 'confirmation_card',
    metadata: {
      summary: {
        event_type: 'Mixer',
        guest_count: 120,
        budget_cents: 1200000,
        area: 'SOMA',
        date: 'Need date',
        ticketing_model: 'Need ticketing model',
        food_responsibility: 'Need food model',
      },
    },
  },
  {
    role: 'user',
    content: 'June 15 works. Free RSVP, open bar and light bites, and a DJ for the evening.',
    message_type: 'text',
    metadata: {},
  },
  {
    role: 'agent',
    content:
      'Got it. The demo plan is ready to compare venue options. I would start with SOMA rooftops and event floors that can handle 120 guests, DJ setup, and hosted bar service.',
    message_type: 'recommendation',
    metadata: {
      recommendations: [
        {
          type: 'venue',
          external_name: 'The Loft at SOMA',
          price_cents: 480000,
          notes: 'Flexible capacity, bar-friendly, and DJ-ready.',
          is_best_fit: true,
          rank: 1,
        },
      ],
    },
  },
]

/**
 * Resets the authenticated demo account back to a seeded planner session.
 */
export async function POST(): Promise<NextResponse> {
  if (process.env.NEXT_PUBLIC_DEMO_MODE !== 'true') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const supabase = createClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  if (user.email !== DEMO_EMAIL) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const admin = createServiceRoleClient() as unknown as SupabaseClient<GeneratedDatabase>

  try {
    const { error: deleteError } = await admin
      .from('plans')
      .delete()
      .eq('user_id', user.id)

    if (deleteError) {
      console.error('[demo.reset] failed to delete demo plans', deleteError)
      return NextResponse.json({ error: 'Failed to reset demo data' }, { status: 500 })
    }

    const { data: planData, error: planError } = await admin
      .from('plans')
      .insert({ ...seedPlan, user_id: user.id })
      .select(PLAN_SELECT_COLUMNS)
      .single()

    if (planError || !planData) {
      console.error('[demo.reset] failed to seed demo plan', planError)
      return NextResponse.json({ error: 'Failed to seed demo plan' }, { status: 500 })
    }

    const plan = planData as Plan
    const now = Date.now()
    const messageInserts = seedMessages.map((message, index) => ({
      plan_id: plan.id,
      role: message.role,
      content: message.content,
      message_type: message.message_type,
      metadata: message.metadata,
      created_at: new Date(now - (seedMessages.length - index) * 60_000).toISOString(),
    }))

    const { error: messagesError } = await admin
      .from('plan_messages')
      .insert(messageInserts)
      .select(PLAN_MESSAGE_SELECT_COLUMNS)

    if (messagesError) {
      console.error('[demo.reset] failed to seed demo messages', messagesError)
      return NextResponse.json({ error: 'Failed to seed demo messages' }, { status: 500 })
    }

    return NextResponse.json({ data: { plan_id: plan.id } })
  } catch (error) {
    console.error('[demo.reset] unexpected error', error)
    return NextResponse.json({ error: 'Unexpected error' }, { status: 500 })
  }
}
