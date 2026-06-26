jest.mock('server-only', () => ({}))

import { detectPlanRevisionTrigger } from '@/lib/planner/planRevisions'

const materialPlan = {
  event_type: 'Networking mixer',
  guest_count: 40,
  budget_cap_cents: 500000,
  neighborhood: 'Downtown Oakland',
  date_window_start: '2026-07-10',
  date_window_end: '2026-07-10',
  status: 'ready',
}

describe('plan revision trigger detection', () => {
  it('detects negative food preferences after a plan has material state', () => {
    const trigger = detectPlanRevisionTrigger({
      plan: materialPlan,
      message: "Actually, no tacos. I don't want tacos for this event.",
    })

    expect(trigger).toEqual({
      type: 'negative_preference',
      field: 'excluded_cuisines',
      value: ['tacos'],
      source_message_excerpt: "Actually, no tacos. I don't want tacos for this event.",
    })
  })

  it('detects added vendor services that require rediscovery', () => {
    const trigger = detectPlanRevisionTrigger({
      plan: materialPlan,
      message: 'I also need flowers for the check-in table.',
    })

    expect(trigger).toEqual({
      type: 'vendor_stack_addition',
      field: 'service_type',
      value: 'florist',
      source_message_excerpt: 'I also need flowers for the check-in table.',
    })
  })

  it('detects removed vendor services', () => {
    const trigger = detectPlanRevisionTrigger({
      plan: materialPlan,
      message: 'We do not need a photographer anymore.',
    })

    expect(trigger).toEqual({
      type: 'vendor_stack_removal',
      field: 'service_type',
      value: 'photographer',
      source_message_excerpt: 'We do not need a photographer anymore.',
    })
  })

  it('detects positive vendor preferences', () => {
    const trigger = detectPlanRevisionTrigger({
      plan: materialPlan,
      message: 'Please prioritize local vendors that can deliver.',
    })

    expect(trigger).toEqual({
      type: 'positive_preference',
      field: 'vendor_attributes',
      value: 'Please prioritize local vendors that can deliver.',
      source_message_excerpt: 'Please prioritize local vendors that can deliver.',
    })
  })

  it('does not classify early intake as a revision before enough plan state exists', () => {
    const trigger = detectPlanRevisionTrigger({
      plan: {
        event_type: null,
        guest_count: null,
        budget_cap_cents: null,
        neighborhood: null,
        date_window_start: null,
        date_window_end: null,
        status: 'drafting',
      },
      message: 'I want tacos for 40 people.',
    })

    expect(trigger).toBeNull()
  })
})
