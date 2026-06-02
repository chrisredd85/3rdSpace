jest.mock('server-only', () => ({}))

import {
  buildDiscoveryVenueInsertFromLead,
  buildSupplyScoutLeadInsert,
  classifySupplyScoutLead,
  findDuplicateDiscoveryVenue,
  findDuplicateLead,
  hasSameNormalizedAddress,
  normalizeAddress,
  normalizeScoutText,
  type SupplyScoutLeadRow,
} from '@/lib/server/supply-scout'

describe('supply scout helpers', () => {
  it('normalizes addresses for duplicate checks', () => {
    expect(normalizeScoutText('The Midway & Gallery')).toBe('the midway and gallery')
    expect(normalizeAddress('900 Marin Street, San Francisco, CA 94124')).toBe('900 marin st 94124')
    expect(hasSameNormalizedAddress('900 Marin St, SF', '900 Marin Street, San Francisco, CA')).toBe(true)
  })

  it('classifies public and commercial booking likelihood from evidence tags', () => {
    expect(classifySupplyScoutLead({
      booking_signals: ['official_rental_page'],
      disqualifiers: [],
      source_url: 'https://sf.gov/example',
      website: null,
      evidence_summary: 'Official rental page lists bookable public rooms for community events.',
    })).toMatchObject({
      booking_likelihood: 'public_bookable',
    })

    expect(classifySupplyScoutLead({
      booking_signals: ['hosted_similar_event', 'bar_or_restaurant'],
      disqualifiers: [],
      source_url: 'https://example.com/event',
      website: 'https://venue.example',
      evidence_summary: 'Hosted a public founder mixer and has a private events page for large groups.',
    })).toMatchObject({
      booking_likelihood: 'commercial_likely_bookable',
    })

    expect(classifySupplyScoutLead({
      booking_signals: ['hosted_similar_event'],
      disqualifiers: ['private_home'],
      source_url: 'https://example.com/private-party',
      website: null,
      evidence_summary: 'The location appears to be a private residence.',
    })).toMatchObject({
      booking_likelihood: 'not_suitable',
    })
  })

  it('builds duplicate-aware lead inserts', () => {
    const insert = buildSupplyScoutLeadInsert({
      name: 'Public Works',
      address: '161 Erie Street, San Francisco, CA',
      city: 'San Francisco',
      state: 'CA',
      source_platform: 'posh',
      source_url: 'https://posh.vip/e/test',
      event_title: 'Warehouse social',
      event_type: 'social',
      evidence_summary: 'Public event page showed the address and similar nightlife programming.',
      booking_signals: ['hosted_similar_event', 'repeated_events'],
      disqualifiers: [],
      website: null,
      capacity_hint: 250,
      price_hint_cents_low: null,
      price_hint_cents_high: null,
      booking_likelihood: null,
      confidence: null,
      operator_notes: null,
    }, 'admin-user', { discoveryVenueId: 'existing-discovery-id' })

    expect(insert.review_status).toBe('duplicate')
    expect(insert.discovery_venue_id).toBe('existing-discovery-id')
    expect(insert.metadata).toMatchObject({
      supply_scout: {
        personal_research_session: true,
        duplicate_detected: true,
      },
    })
  })

  it('finds duplicate staged and discovery venues by normalized address', () => {
    const input = {
      name: 'Cafe Du Nord',
      address: '2174 Market Street, San Francisco, CA',
      city: 'San Francisco',
      state: 'CA',
      source_platform: 'eventbrite',
      evidence_summary: 'Event page exposed a public venue address.',
      booking_signals: [],
      disqualifiers: [],
    } as any

    expect(findDuplicateLead(input, [
      { id: 'lead-1', normalized_address: normalizeAddress('2174 Market St, SF'), review_status: 'needs_review' },
    ])?.id).toBe('lead-1')

    expect(findDuplicateDiscoveryVenue(input, [
      { id: 'venue-1', name: 'Cafe Du Nord', address: '2174 Market St, San Francisco, CA' },
    ])?.id).toBe('venue-1')
  })

  it('maps approved leads into discovery venue payloads', () => {
    const payload = buildDiscoveryVenueInsertFromLead(makeLead(), 'admin-user')

    expect(payload).toMatchObject({
      name: 'The Center SF',
      address: '548 Fillmore Street, San Francisco, CA',
      source: 'scrape',
      source_external_id: 'supply_scout:lead-1',
      metadata: {
        supply_scout: {
          lead_id: 'lead-1',
          review_status: 'approved',
          reviewed_by: 'admin-user',
        },
      },
    })
    expect(payload.vibe_tags).toEqual(expect.arrayContaining([
      'community_mixer',
      'commercial_likely_bookable',
      'source_partiful',
    ]))
  })
})

function makeLead(): SupplyScoutLeadRow {
  return {
    id: 'lead-1',
    name: 'The Center SF',
    address: '548 Fillmore Street, San Francisco, CA',
    normalized_name: 'the center sf',
    normalized_address: normalizeAddress('548 Fillmore Street, San Francisco, CA'),
    neighborhood: 'Lower Haight',
    city: 'San Francisco',
    state: 'CA',
    source_platform: 'partiful',
    source_url: 'https://partiful.com/e/test',
    event_title: 'Community mixer',
    event_type: 'community mixer',
    evidence_summary: 'Public event page shows the venue address and repeated community programming.',
    booking_signals: ['hosted_similar_event', 'private_events_page'],
    disqualifiers: [],
    website: 'https://thecentersf.com',
    capacity_hint: 80,
    price_hint_cents_low: null,
    price_hint_cents_high: null,
    booking_likelihood: 'commercial_likely_bookable',
    confidence: 0.81,
    review_status: 'needs_review',
    discovery_venue_id: null,
    duplicate_of_lead_id: null,
    created_by: 'admin-user',
    reviewed_by: null,
    metadata: {
      supply_scout: {
        personal_research_session: true,
      },
    },
    captured_at: '2026-06-01T12:00:00.000Z',
    reviewed_at: null,
    created_at: '2026-06-01T12:00:00.000Z',
    updated_at: '2026-06-01T12:00:00.000Z',
  }
}
