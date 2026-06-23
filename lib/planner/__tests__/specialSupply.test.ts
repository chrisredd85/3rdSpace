jest.mock('server-only', () => ({}))

import {
  buildSpecialSupplySearchQuery,
  detectSpecialSupplyFromText,
  mergeSpecialSupplyMetadata,
  pickSpecialSupplyIntakeQuestion,
  readEventComplexityFromMetadata,
  readPlanSpecialSupply,
} from '@/lib/planner/specialSupply'
import type { Plan } from '@/lib/types'

function planWithMetadata(metadata: Record<string, unknown>): Plan {
  return {
    id: 'plan-1',
    user_id: 'user-1',
    title: 'Special plan',
    event_type: 'Party',
    status: 'drafting',
    guest_count: 150,
    budget_cap_cents: null,
    neighborhood: 'San Francisco',
    date_window_start: '2026-07-20',
    date_window_end: '2026-07-20',
    ticketed: true,
    ticketing_model: 'ticketed',
    food_responsibility: null,
    venue_terms: null,
    agent_action: null,
    profit_goal_cents: null,
    notes: null,
    metadata,
    created_at: '2026-06-22T00:00:00Z',
    updated_at: '2026-06-22T00:00:00Z',
  }
}

describe('special supply exception workflow', () => {
  it('detects yacht parties as quote-required special supply', () => {
    const detection = detectSpecialSupplyFromText('I want to run a 150 person yacht party from a marina')

    expect(detection?.kind).toBe('yacht_charter')
    expect(detection?.event_complexity).toBe('special_supply_required')
    expect(detection?.pack.candidateStatusLabel).toBe('Unverified charter lead - quote required')
  })

  it.each([
    ['warehouse party', 'warehouse_party'],
    ['mansion dinner', 'private_estate'],
    ['outdoor park event', 'outdoor_park'],
    ['rooftop buyout', 'rooftop_buyout'],
  ])('detects %s as %s', (text, kind) => {
    expect(detectSpecialSupplyFromText(text)?.kind).toBe(kind)
  })

  it('does not tag standard dinners as special supply', () => {
    expect(detectSpecialSupplyFromText('Founder dinner for 24 in Hayes Valley')).toBeNull()
  })

  it('merges event complexity, quote requirements, and matching signals into metadata', () => {
    const metadata = mergeSpecialSupplyMetadata({
      matching_signals: { vibe: 'upscale' },
    }, 'Ticketed yacht party for 150 people')

    expect(readEventComplexityFromMetadata(metadata)).toBe('special_supply_required')
    expect(readPlanSpecialSupply(planWithMetadata(metadata ?? {}))?.quote_required).toBe(true)
    expect(metadata?.event_requirements).toMatchObject({
      special_supply_kind: 'yacht_charter',
      verified_quote_required: true,
    })
    expect(metadata?.matching_signals).toMatchObject({
      vibe: 'upscale',
      special_supply_kind: 'yacht_charter',
      verified_quote_required: true,
    })
  })

  it('asks the specialized intake pack before quote scouting', () => {
    const metadata = mergeSpecialSupplyMetadata({}, 'Yacht party') ?? {}
    const plan = {
      ...planWithMetadata(metadata),
      neighborhood: null,
      guest_count: null,
      date_window_start: null,
      date_window_end: null,
    }

    expect(pickSpecialSupplyIntakeQuestion(plan, 'yacht party')).toBe('Which city, marina, or boarding location should I scout from?')
    expect(pickSpecialSupplyIntakeQuestion({
      ...plan,
      neighborhood: 'San Francisco',
    }, 'yacht party in San Francisco')).toBe('What is the hard guest cap the charter needs to support?')
  })

  it('builds a special-supply search query instead of generic venue matching', () => {
    const metadata = mergeSpecialSupplyMetadata({}, 'Need a rooftop buyout') ?? {}

    expect(buildSpecialSupplySearchQuery(planWithMetadata(metadata))).toBe('rooftop event venue in San Francisco')
  })
})
