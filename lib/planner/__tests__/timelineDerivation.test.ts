/**
 * Tests for lib/planner/timelineDerivation.ts
 *
 * Verifies the status derivation logic for each milestone type under the full
 * set of planner message states (no hold, phase-2 hold active, outreach
 * approved).
 */

import { deriveMilestoneStatuses, type DerivationAgentAction } from '../timelineDerivation'
import type { PlanMessage } from '@/lib/types/planner'
import type { PlanningMilestone } from '@/lib/events/milestoneTemplates'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function msg(overrides: Partial<PlanMessage>): PlanMessage {
  return {
    id: 'msg-1',
    plan_id: 'plan-1',
    role: 'agent',
    content: '',
    message_type: 'text',
    metadata: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  } as PlanMessage
}

function phase2RecMsg(id = 'rec-phase2'): PlanMessage {
  return msg({
    id,
    message_type: 'recommendation',
    metadata: { phase: 'vendors' },
  })
}

function outreachApprovalMsg(status: string, id = 'approval-1'): PlanMessage {
  return msg({
    id,
    message_type: 'approval_request',
    metadata: {
      kind: 'venue_outreach',
      status,
      approval: { status },
    },
  })
}

function holdAction(status: string, id = `hold-${status}`, venueName = 'The Valencia Room'): DerivationAgentAction {
  return {
    id,
    action_type: 'hold_request',
    status,
    payload_json: { venue_name: venueName },
    created_at: '2026-05-01T12:00:00.000Z',
  }
}

function confirmedHoldAction(id = 'hold-confirmed', venueName = 'The Valencia Room'): DerivationAgentAction {
  return {
    ...holdAction('complete', id, venueName),
    result_metadata: {
      admin_task_outcome: {
        outcome: 'hold_confirmed',
        hold_reference: 'hold-ref-1',
      },
    },
  }
}

function milestone(overrides: Partial<PlanningMilestone> & Pick<PlanningMilestone, 'title' | 'category'>): PlanningMilestone {
  return {
    due_date: '2099-12-31', // far future = not overdue by default
    is_blocking: true,
    ...overrides,
  }
}

const plan = { ticketed: false, ticketing_model: null }

// ─── Venue confirmation ───────────────────────────────────────────────────────

describe('venue confirmation milestone', () => {
  const venueConfirm = milestone({ title: 'Confirm venue booking', category: 'booking' })

  it('is blocked when no venue hold', () => {
    const [derived] = deriveMilestoneStatuses(plan, [], [venueConfirm])
    expect(derived.status).toBe('blocked')
    expect(derived.blocker_tab).toBe('recommendations')
  })

  it('is still blocked when only a phase-2 rec exists', () => {
    const [derived] = deriveMilestoneStatuses(plan, [phase2RecMsg()], [venueConfirm])
    expect(derived.status).toBe('blocked')
  })

  it('is awaiting_venue_response when a hold request is pending', () => {
    const [derived] = deriveMilestoneStatuses(plan, [phase2RecMsg()], [venueConfirm], [holdAction('pending')])
    expect(derived.status).toBe('awaiting_venue_response')
    expect(derived.awaiting_venue_name).toBe('The Valencia Room')
    expect(derived.blocker_reason).toBe('Awaiting The Valencia Room')
  })

  it('is still awaiting_venue_response when the hold request is approved but not confirmed', () => {
    const [derived] = deriveMilestoneStatuses(plan, [], [venueConfirm], [holdAction('approved')])
    expect(derived.status).toBe('awaiting_venue_response')
  })

  it('is in_progress only when operator completion records hold_confirmed', () => {
    const [derived] = deriveMilestoneStatuses(plan, [], [venueConfirm], [confirmedHoldAction()])
    expect(derived.status).toBe('in_progress')
  })

  it('does not treat a generic complete action as proof of an active hold', () => {
    const [derived] = deriveMilestoneStatuses(plan, [], [venueConfirm], [holdAction('complete')])
    expect(derived.status).toBe('blocked')
  })

  it('is overdue when past due and no hold', () => {
    const pastDue = { ...venueConfirm, due_date: '2020-01-01' }
    const [derived] = deriveMilestoneStatuses(plan, [], [pastDue])
    expect(derived.status).toBe('overdue')
  })
})

// ─── Vendor confirmation ──────────────────────────────────────────────────────

describe('vendor confirmation milestone', () => {
  const vendorConfirm = milestone({ title: 'Confirm vendor bookings', category: 'booking' })

  it('is blocked when no venue hold (no outreach)', () => {
    const [derived] = deriveMilestoneStatuses(plan, [], [vendorConfirm])
    expect(derived.status).toBe('blocked')
    expect(derived.blocker_tab).toBe('recommendations')
  })

  it('is blocked (approve outreach) when hold exists but no outreach approval', () => {
    const [derived] = deriveMilestoneStatuses(plan, [phase2RecMsg()], [vendorConfirm], [confirmedHoldAction()])
    expect(derived.status).toBe('blocked')
    expect(derived.blocker_tab).toBe('approvals')
  })

  it('is awaiting_venue_response when a vendor milestone has only a pending venue hold', () => {
    const [derived] = deriveMilestoneStatuses(plan, [phase2RecMsg()], [vendorConfirm], [holdAction('pending')])
    expect(derived.status).toBe('awaiting_venue_response')
    expect(derived.awaiting_venue_name).toBe('The Valencia Room')
  })

  it('is in_progress when outreach is approved', () => {
    const [derived] = deriveMilestoneStatuses(
      plan,
      [phase2RecMsg(), outreachApprovalMsg('authorized')],
      [vendorConfirm],
      [confirmedHoldAction()]
    )
    expect(derived.status).toBe('in_progress')
  })

  it('blocker_msg_id points to the outreach approval msg when blocked on approvals', () => {
    const [derived] = deriveMilestoneStatuses(
      plan,
      [phase2RecMsg(), outreachApprovalMsg('pending', 'outreach-msg-id')],
      [vendorConfirm],
      [confirmedHoldAction()]
    )
    expect(derived.status).toBe('blocked')
    expect(derived.blocker_msg_id).toBe('outreach-msg-id')
  })

  it('is overdue with blocker_tab=recommendations when past due, no hold', () => {
    const pastDue = { ...vendorConfirm, due_date: '2020-01-01' }
    const [derived] = deriveMilestoneStatuses(plan, [], [pastDue])
    expect(derived.status).toBe('overdue')
    expect(derived.blocker_tab).toBe('recommendations')
  })
})

// ─── Payment / deposit ────────────────────────────────────────────────────────

describe('payment milestone', () => {
  const depositMilestone = milestone({ title: 'Pay venue deposit', category: 'payment' })

  it('is blocked when no venue hold', () => {
    const [derived] = deriveMilestoneStatuses(plan, [], [depositMilestone])
    expect(derived.status).toBe('blocked')
  })

  it('is in_progress when hold exists', () => {
    const [derived] = deriveMilestoneStatuses(plan, [], [depositMilestone], [confirmedHoldAction()])
    expect(derived.status).toBe('in_progress')
  })

  it('is awaiting_venue_response when deposit is waiting on a pending hold request', () => {
    const [derived] = deriveMilestoneStatuses(plan, [phase2RecMsg()], [depositMilestone], [holdAction('pending')])
    expect(derived.status).toBe('awaiting_venue_response')
  })
})

// ─── Day-of milestones ────────────────────────────────────────────────────────

describe('day-of milestones', () => {
  it('pending for future day-of milestone', () => {
    const setup = milestone({ title: 'Setup window', category: 'day-of', due_date: '2099-01-01' })
    const [derived] = deriveMilestoneStatuses(plan, [], [setup])
    expect(derived.status).toBe('pending')
    expect(derived.blocker_tab).toBeUndefined()
  })

  it('overdue for past day-of milestone', () => {
    const teardown = milestone({ title: 'Teardown', category: 'day-of', due_date: '2020-01-01' })
    const [derived] = deriveMilestoneStatuses(plan, [], [teardown])
    expect(derived.status).toBe('overdue')
  })
})

// ─── Ticketing ────────────────────────────────────────────────────────────────

describe('ticketing milestone', () => {
  it('is pending when plan is not ticketed', () => {
    const ticketing = milestone({ title: 'Launch tickets or RSVP page', category: 'ticketing' })
    const [derived] = deriveMilestoneStatuses(plan, [], [ticketing])
    expect(derived.status).toBe('pending')
  })

  it('is in_progress when plan is ticketed with a model', () => {
    const ticketing = milestone({ title: 'Launch tickets or RSVP page', category: 'ticketing' })
    const ticketedPlan = { ticketed: true, ticketing_model: 'paid_admission' }
    const [derived] = deriveMilestoneStatuses(ticketedPlan, [], [ticketing])
    expect(derived.status).toBe('in_progress')
  })
})

// ─── Misc / default ───────────────────────────────────────────────────────────

describe('default milestones', () => {
  it('future marketing milestone is pending with no blocker', () => {
    const promo = milestone({ title: 'Send first promo push', category: 'marketing' })
    const [derived] = deriveMilestoneStatuses(plan, [], [promo])
    expect(derived.status).toBe('pending')
    expect(derived.blocker_tab).toBeUndefined()
  })

  it('past marketing milestone is overdue', () => {
    const promo = milestone({ title: 'Send first promo push', category: 'marketing', due_date: '2020-01-01' })
    const [derived] = deriveMilestoneStatuses(plan, [], [promo])
    expect(derived.status).toBe('overdue')
  })

  it('returns multiple milestones in input order', () => {
    const milestones = [
      milestone({ title: 'Confirm venue booking', category: 'booking' }),
      milestone({ title: 'Confirm vendor bookings', category: 'booking' }),
      milestone({ title: 'Send first promo push', category: 'marketing' }),
    ]
    const derived = deriveMilestoneStatuses(plan, [phase2RecMsg()], milestones, [holdAction('approved')])
    expect(derived).toHaveLength(3)
    expect(derived[0].title).toBe('Confirm venue booking')
    expect(derived[1].title).toBe('Confirm vendor bookings')
    expect(derived[2].title).toBe('Send first promo push')
  })
})
