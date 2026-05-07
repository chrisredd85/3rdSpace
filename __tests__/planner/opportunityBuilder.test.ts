import {
  buildOpportunityBriefDraft,
  buildSendToVenuesApprovalDraft,
  rankOpportunityTargets,
} from '@/lib/planner/opportunityBuilder'
import type { Plan, PlanMessage } from '@/lib/types'

const basePlan: Plan = {
  id: 'plan-1',
  user_id: 'user-1',
  title: 'Day party plan',
  event_type: 'day party',
  status: 'ready',
  guest_count: 90,
  budget_cap_cents: 900_000,
  neighborhood: 'Mission',
  date_window_start: '2026-06-10',
  date_window_end: '2026-06-10',
  ticketed: true,
  profit_goal_cents: null,
  notes: null,
  created_at: '2026-05-05T00:00:00.000Z',
  updated_at: '2026-05-05T00:00:00.000Z',
}

const summaryMessage: PlanMessage = {
  id: 'message-1',
  plan_id: 'plan-1',
  role: 'agent',
  content: 'Summary',
  message_type: 'confirmation_card',
  metadata: {
    summary: {
      event_type: 'day party',
      guest_count: 90,
      area: 'Mission',
      budget_cents: 900_000,
      must_haves: ['outdoor', 'DJ', 'bar'],
      date_window_start: '2026-06-10',
      date_window_end: '2026-06-10',
      event_components: [
        {
          label: 'day party',
          role: 'primary',
          archetype: 'social',
          requirements: ['music', 'bar'],
        },
      ],
    },
  },
  created_at: '2026-05-05T00:00:00.000Z',
}

describe('opportunityBuilder', () => {
  it('builds an opportunity brief from the latest confirmation summary', () => {
    const brief = buildOpportunityBriefDraft(basePlan, [summaryMessage], 'user-1')

    expect(brief.title).toBe('day party opportunity')
    expect(brief.guest_count).toBe(90)
    expect(brief.neighborhood).toBe('Mission')
    expect(brief.budget_cents).toBe(900_000)
    expect(brief.must_haves).toEqual(['outdoor', 'DJ', 'bar'])
    expect(brief.deposit_target_cents).toBe(180_000)
  })

  it('ranks venues by capacity, budget, requirements, and concierge fallback', () => {
    const brief = buildOpportunityBriefDraft(basePlan, [summaryMessage], 'user-1')
    const targets = rankOpportunityTargets({
      brief,
      venues: [
        {
          id: 'venue-1',
          venue_name: 'Mission Patio Club',
          city: 'Mission',
          standing_capacity: 140,
          hourly_rate: 60_000,
          minimum_hours: 4,
          unique_features_tags: ['outdoor', 'DJ', 'bar'],
          is_claimed: true,
          is_published: true,
        },
        {
          id: 'venue-2',
          venue_name: 'Tiny Room',
          city: 'Mission',
          standing_capacity: 40,
          hourly_rate: 20_000,
          is_claimed: true,
          is_published: true,
        },
        {
          id: 'venue-3',
          venue_name: 'Unclaimed Loft',
          city: 'Mission',
          standing_capacity: 125,
          hourly_rate: 55_000,
          minimum_hours: 4,
          unique_features_tags: ['outdoor', 'bar'],
          is_claimed: false,
          is_admin_seeded: true,
          is_published: true,
        },
      ],
      vendors: [],
    })

    expect(targets.map((target) => target.name)).toContain('Mission Patio Club')
    expect(targets.map((target) => target.name)).not.toContain('Tiny Room')
    expect(targets.find((target) => target.name === 'Unclaimed Loft')?.route_to_concierge).toBe(true)
  })

  it('creates a Send to venues approval draft with proposed deposit exposure', () => {
    const brief = buildOpportunityBriefDraft(basePlan, [summaryMessage], 'user-1')
    const targets = rankOpportunityTargets({
      brief,
      venues: [
        {
          id: 'venue-1',
          venue_name: 'Mission Patio Club',
          city: 'Mission',
          standing_capacity: 140,
          hourly_rate: 60_000,
          minimum_hours: 4,
          unique_features_tags: ['outdoor', 'DJ', 'bar'],
          is_claimed: true,
          is_published: true,
        },
      ],
      vendors: [
        {
          id: 'vendor-1',
          name: 'Zero Proof Bar Co',
          vendor_type: 'Bartender',
          service_type: 'bartending',
          regions_served: 'Mission',
          base_rate: 80_000,
          compatible_features: ['bar'],
          is_claimed: false,
          is_published: true,
        },
      ],
    })
    const approval = buildSendToVenuesApprovalDraft(targets, brief)

    expect(approval.action_label).toBe('Send to venues')
    expect(approval.venue_count).toBe(1)
    expect(approval.vendor_count).toBe(1)
    expect(approval.concierge_count).toBe(1)
    expect(approval.requested_amount_cents).toBeGreaterThan(0)
    expect(approval.package_details).toMatch(/No charge is made now/)
  })
})
