jest.mock('server-only', () => ({}))

import { generateMilestoneTemplate } from '@/lib/events/milestoneTemplates'
import type { EventPlan } from '@/lib/ai/types'

const currentDate = new Date('2026-05-07T12:00:00Z')

const eventPlan: EventPlan = {
  event_name: 'Founder dinner',
  expected_attendance: 60,
  city: 'SF',
  venue_type: 'restaurant',
  budget: 600000,
  event_date: '2026-06-06',
  monetization_model: 'ticketed',
  headcount_min: 50,
  headcount_max: 70,
  ticket_price_target: 12500,
  profit_goal: 150000,
}

describe('generateMilestoneTemplate', () => {
  it('returns required planning milestones with venue confirmation blocking', () => {
    const result = generateMilestoneTemplate({
      event_plan: eventPlan,
      event_date: '2026-06-06',
      confirmed_venue_bookings: [],
      confirmed_vendor_bookings: [],
      venue_requirements: [],
    }, currentDate)

    expect(result.impossible_timeline).toBe(false)
    expect(result.planning_milestones).toEqual(expect.arrayContaining([
      expect.objectContaining({
        title: 'Confirm venue booking',
        category: 'booking',
        is_blocking: true,
      }),
      expect.objectContaining({ title: 'Pay venue deposit' }),
      expect.objectContaining({ title: 'Confirm vendor bookings' }),
      expect.objectContaining({ title: 'Launch tickets or RSVP page' }),
      expect.objectContaining({ title: 'Send first promo push' }),
      expect.objectContaining({ title: 'Confirm final headcount' }),
      expect.objectContaining({ title: 'Run day-before check' }),
      expect.objectContaining({ title: 'Setup window' }),
      expect.objectContaining({ title: 'Doors open' }),
      expect.objectContaining({ title: 'Programming starts' }),
      expect.objectContaining({ title: 'Teardown and venue closeout' }),
    ]))
    expect(result.dependency_warnings).toContain(
      'Venue confirmation is missing and blocks deposit, setup, and day-of logistics.'
    )
  })

  it('marks timelines under 7 days as impossible and explains why', () => {
    const result = generateMilestoneTemplate({
      event_plan: { ...eventPlan, event_date: '2026-05-10' },
      event_date: '2026-05-10',
      confirmed_venue_bookings: [],
      confirmed_vendor_bookings: [],
      venue_requirements: [],
    }, currentDate)

    expect(result.impossible_timeline).toBe(true)
    expect(result.dependency_warnings).toEqual(expect.arrayContaining([
      'Event date is 3 days away, so critical milestones may not be completable before the event.',
      'Venue confirmation is missing and blocks deposit, setup, and day-of logistics.',
      'Vendor bookings are missing and may block food, AV, entertainment, or staffing plans.',
    ]))
  })

  it('adds blocking venue requirement milestones', () => {
    const result = generateMilestoneTemplate({
      event_plan: eventPlan,
      event_date: '2026-06-06',
      confirmed_venue_bookings: [{
        id: 'venue-booking-1',
        event_id: 'event-1',
        venue_id: 'venue-1',
        status: 'confirmed',
        quoted_price: 250000,
      }],
      confirmed_vendor_bookings: [],
      venue_requirements: [{
        id: 'requirement-1',
        venue_id: 'venue-1',
        requirement_type: 'coi',
        is_required: true,
        description: 'Certificate of insurance',
        minimum_liability_coverage: 1000000,
        requires_additional_insured: true,
        custom_question: null,
      }],
    }, currentDate)

    expect(result.planning_milestones).toContainEqual(expect.objectContaining({
      title: 'Complete venue requirement: Certificate of insurance',
      category: 'compliance',
      is_blocking: true,
    }))
    expect(result.dependency_warnings).toContain(
      'Venue requirement needs completion: Certificate of insurance.'
    )
  })
})
