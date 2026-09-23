import { stageCanonicalQuoteBooking } from '@/lib/planner/execution/canonicalQuoteBooking'
import { independentVenueEvidence } from '@/lib/discovery/venueRepository'
import type { Plan } from '@/lib/types'

const plan = {
  id: 'plan-1',
  user_id: 'actor-1',
  status: 'drafting',
  materialized_event_id: null,
  date_window_start: '2026-08-01',
  date_window_end: '2026-08-01',
} as unknown as Plan

function venueResponseQuery(dealModel: string) {
  const query = {
    select: jest.fn(),
    eq: jest.fn(),
    maybeSingle: jest.fn().mockResolvedValue({
      data: {
        id: 'response-1',
        plan_id: plan.id,
        discovery_venue_id: 'discovery-venue-1',
        classification: 'quote_received',
        classification_confidence: 1,
        quoted_price_cents: null,
        quoted_deal_model: dealModel,
        availability_confirmed: true,
        capacity_confirmed: 100,
        conditions: [],
        raw_response_excerpt: 'Venue described a share model without a quoted price.',
        extracted_at: '2026-07-12T00:00:00.000Z',
      },
      error: null,
    }),
  }
  query.select.mockReturnValue(query)
  query.eq.mockReturnValue(query)
  return query
}

describe('canonical quote booking price evidence', () => {
  it.each([
    'revenue_share',
    'bar_revenue_share',
    'ticket_revenue_share',
  ])('fails closed before staging an unpriced %s response', async (dealModel) => {
    const responseQuery = venueResponseQuery(dealModel)
    // C1 hydrates independent identity separately from the owned quote response.
    // Permit that read while still rejecting every write and an unpriced quote.
    const venueQuery = {
      select: jest.fn(),
      eq: jest.fn(),
      maybeSingle: jest.fn().mockResolvedValue({
        data: {
          id: 'discovery-venue-1',
          name: 'Test Venue',
          source_external_id: 'fixture-price-evidence',
          metadata: {
            venue_boundary_version: 1,
            field_provenance: {
              name: independentVenueEvidence('host_input', 'fixture:host-venue-name'),
            },
          },
        },
        error: null,
      }),
    }
    venueQuery.select.mockReturnValue(venueQuery)
    venueQuery.eq.mockReturnValue(venueQuery)
    const rpc = jest.fn()
    const from = jest.fn((table: string) => {
      if (table === 'discovery_venues_safe') return venueQuery
      if (table !== 'venue_outreach_responses') {
        throw new Error(`unexpected write or lookup: ${table}`)
      }
      return responseQuery
    })

    await expect(stageCanonicalQuoteBooking({
      db: { from, rpc },
      plan,
      actorId: plan.user_id,
      quoteKind: 'venue',
      responseId: 'response-1',
    })).rejects.toThrow('canonical_quote_booking_price_required')

    expect(rpc).not.toHaveBeenCalled()
    expect(from).toHaveBeenCalledTimes(2)
    expect(responseQuery.eq).toHaveBeenCalledWith('plan_id', plan.id)
    expect(venueQuery.eq).toHaveBeenCalledWith('id', 'discovery-venue-1')
    expect(from).not.toHaveBeenCalledWith('agent_actions')
    expect(from).not.toHaveBeenCalledWith('approvals')
  })
})
