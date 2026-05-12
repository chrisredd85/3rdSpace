jest.mock('server-only', () => ({}))

import { archetypeFor } from '@/lib/planner/archetypes'
import { applyArchetypeDefaultFills, buildPlanVendorStack } from '@/lib/planner/recommendVendorStack'
import type { Plan } from '@/lib/types'

function planWithSignals(signals: Record<string, unknown>): Plan {
  return {
    id: 'plan-1',
    user_id: 'user-1',
    title: 'Plan',
    event_type: 'Founder/operator dinner',
    status: 'drafting',
    guest_count: 20,
    budget_cap_cents: null,
    neighborhood: 'Hayes Valley',
    date_window_start: '2026-05-20',
    date_window_end: '2026-05-20',
    ticketed: false,
    ticketing_model: 'rsvp',
    food_responsibility: null,
    venue_terms: null,
    agent_action: null,
    profit_goal_cents: null,
    notes: null,
    metadata: { matching_signals: signals },
    created_at: '2026-05-11T00:00:00Z',
    updated_at: '2026-05-11T00:00:00Z',
  }
}

describe('plan vendor stack inference', () => {
  it('adds a required DJ when a dinner plan asks for music', () => {
    const stack = buildPlanVendorStack(archetypeFor('founder dinner'), planWithSignals({ music_format: 'dj' }))

    expect(stack.find((item) => item.service_type === 'dj')?.necessity).toBe('required')
  })

  it('removes catering when the venue handles food', () => {
    const stack = buildPlanVendorStack(archetypeFor('launch'), planWithSignals({ catering_style: 'venue_handles' }))

    expect(stack.find((item) => item.service_type === 'catering')).toBeUndefined()
  })

  it('adds videography when photo/video priority is both', () => {
    const stack = buildPlanVendorStack(archetypeFor('dinner'), planWithSignals({ photo_video_priority: 'both' }))

    expect(stack.find((item) => item.service_type === 'photographer')?.necessity).toBe('required')
    expect(stack.find((item) => item.service_type === 'videographer')?.necessity).toBe('required')
  })

  it('hydrates default fills without overwriting explicit plan signals', () => {
    const archetype = archetypeFor('panel')
    const plan = planWithSignals({ stage_required: false })
    const hydrated = applyArchetypeDefaultFills(plan, archetype)
    const signals = (hydrated.metadata as Record<string, Record<string, unknown>>).matching_signals

    expect(signals.stage_required).toBe(false)
    expect(signals.mics_count).toBe(2)
  })
})
