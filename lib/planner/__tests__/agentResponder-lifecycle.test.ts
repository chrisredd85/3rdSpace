import { determineNextResponse } from '@/lib/planner/agentResponder'
import type { Plan } from '@/lib/types'

describe('agent responder canonical plan lifecycle', () => {
  it('keeps booked plans in active execution instead of restarting recommendations', () => {
    const response = determineNextResponse(makePlan('booked'), [])

    expect(response.message_type).toBe('status_update')
    expect(response.metadata).toEqual(expect.objectContaining({ state: 'executing' }))
  })

  it.each(['completed', 'complete'] as const)('treats %s as a terminal completed plan', (status) => {
    const response = determineNextResponse(makePlan(status), [])

    expect(response.message_type).toBe('status_update')
    expect(response.metadata).toEqual(expect.objectContaining({ state: 'complete' }))
  })
})

function makePlan(status: Plan['status']): Plan {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    user_id: '22222222-2222-4222-8222-222222222222',
    title: 'Founder dinner',
    event_type: 'Founder/operator dinner',
    status,
    guest_count: 40,
    budget_cap_cents: 500000,
    neighborhood: 'Oakland',
    date_window_start: '2026-08-20',
    date_window_end: '2026-08-20',
    ticketed: false,
    profit_goal_cents: null,
    notes: null,
    metadata: {},
    created_at: '2026-07-09T12:00:00.000Z',
    updated_at: '2026-07-09T12:00:00.000Z',
  }
}
