jest.mock('server-only', () => ({}))

jest.mock('@/lib/planner/catalogRanker', () => ({
  rankCatalogPartners: jest.fn(() => ({
    recommendations: [{ partner_id: 'venue-1', score: 87 }],
    rejected: [],
  })),
}))

import {
  buildDefaultOutreachBody,
  buildDiscoveryCandidateResponses,
  buildDiscoveryVenueInsert,
  resolveDiscoveryVenueContact,
  type DiscoveryVenueRow,
  type PlanDiscoveryVenueCandidateRow,
} from '@/lib/server/places-outreach'
import type { Plan } from '@/lib/types'

describe('places outreach helpers', () => {
  it('uses organizer-provided emails before extracted emails', () => {
    const contact = resolveDiscoveryVenueContact({
      contact_email: null,
      organizer_provided_emails: [
        { email: 'events@old.example', provided_at: '2026-06-01T00:00:00.000Z' },
        { email: 'booking@moongate.example', provided_at: '2026-06-02T00:00:00.000Z' },
      ],
      extracted_emails: [{ email: 'info@moongate.example', confidence: 0.95, is_likely_booking_contact: true }],
      website: 'https://moongate.example',
    } as DiscoveryVenueRow)

    expect(contact).toEqual({
      email: 'booking@moongate.example',
      source: 'organizer_provided',
      confidence: 'high',
      status: 'ready_to_reach_out',
    })
  })

  it('stores sanitized Google Places photos on discovery venue inserts', () => {
    const insert = buildDiscoveryVenueInsert({
      id: 'places/moongate',
      displayName: { text: 'Moongate Lounge' },
      formattedAddress: '123 Mission St, San Francisco, CA',
      primaryType: 'bar',
      types: ['bar', 'establishment'],
      businessStatus: 'OPERATIONAL',
      websiteUri: 'https://moongate.example',
      photos: [
        {
          name: 'places/moongate/photos/photo-1',
          heightPx: 900,
          widthPx: 1200,
          authorAttributions: [{ displayName: 'Moongate Lounge', uri: 'https://maps.example/photo' }],
        },
        { name: '', heightPx: 1, widthPx: 1 },
      ],
    }, {
      request: {
        textQuery: 'happy hour bars in Mission',
        maxResultCount: 8,
        languageCode: 'en',
        regionCode: 'US',
        includePureServiceAreaBusinesses: false,
      },
      searchQuery: 'happy hour bars in Mission',
      neighborhood: 'Mission',
    })

    expect(insert.name).toBe('Moongate Lounge')
    expect(insert.source).toBe('google_places')
    expect(insert.source_external_id).toBe('places/moongate')
    expect(insert.photos).toEqual([{
      name: 'places/moongate/photos/photo-1',
      heightPx: 900,
      widthPx: 1200,
      authorAttributions: [{ displayName: 'Moongate Lounge', uri: 'https://maps.example/photo' }],
    }])
  })

  it('builds response candidates with proxied photo urls and ready contact status', () => {
    const responses = buildDiscoveryCandidateResponses(fakePlan(), [{
      candidate: {
        id: 'candidate-1',
        plan_id: 'plan-1',
        discovery_venue_id: 'venue-1',
        searched_by_user_id: 'user-1',
        search_query: 'happy hour bars',
        archetype_id: 'happy_hour',
        neighborhood: 'Mission',
        fit_score: null,
        status: 'candidate',
        dismissed_at: null,
        places_request_json: {},
        outreach_approval_created_at: null,
        created_at: '2026-06-18T00:00:00.000Z',
        updated_at: '2026-06-18T00:00:00.000Z',
      } as PlanDiscoveryVenueCandidateRow,
      venue: {
        id: 'venue-1',
        name: 'Moongate Lounge',
        address: '123 Mission St',
        neighborhood: 'Mission',
        city: 'San Francisco',
        state: 'CA',
        contact_email: null,
        contact_phone: '(415) 555-0100',
        website: 'https://moongate.example',
        organizer_provided_emails: [{ email: 'booking@moongate.example' }],
        extracted_emails: [],
        website_extraction_status: 'successful',
        photos: [{ name: 'places/moongate/photos/photo-1', authorAttributions: [{ displayName: 'Moongate Lounge' }] }],
        google_rating: 4.8,
        google_user_ratings_total: 99,
        metadata: {},
      } as DiscoveryVenueRow,
    }])

    expect(responses[0]).toMatchObject({
      discovery_venue_id: 'venue-1',
      name: 'Moongate Lounge',
      contact_email: 'booking@moongate.example',
      contact_status: 'ready_to_reach_out',
      fit_score: 87,
      photo_urls: ['/api/planner/discovery-venues/venue-1/photo/0'],
    })
  })

  it('uses place-name placeholders and CHI-safe incentive language in the default template', () => {
    const body = buildDefaultOutreachBody()

    expect(body).toContain('Hi {{place_name}},')
    expect(body).toContain('community host incentives')
    expect(body).toContain('{{sender_email}}')
    expect(body).not.toContain('{{venue_name}}')
    expect(body).not.toMatch(/kickback|rev share|revenue share|bar split/i)
  })
})

function fakePlan(): Plan {
  return {
    id: 'plan-1',
    user_id: 'user-1',
    title: 'Happy hour plan',
    event_type: 'happy_hour',
    status: 'ready',
    guest_count: 40,
    budget_cap_cents: 500000,
    neighborhood: 'Mission',
    date_window_start: null,
    date_window_end: null,
    ticketed: false,
    ticketing_model: 'rsvp',
    food_responsibility: 'venue',
    venue_terms: null,
    agent_action: null,
    profit_goal_cents: null,
    notes: null,
    metadata: {},
    created_at: '2026-06-18T00:00:00.000Z',
    updated_at: '2026-06-18T00:00:00.000Z',
  } as Plan
}
