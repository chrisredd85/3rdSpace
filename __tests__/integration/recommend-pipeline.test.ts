jest.mock('server-only', () => ({}))

jest.mock('@/lib/ai/agents', () => ({
  runAgent: jest.fn(),
}))

jest.mock('@/lib/ai/agents/venueMatchingAgent', () => ({
  venueMatchingAgentDefinition: { agentName: 'venue_matching', model: 'gpt-4o' },
  runVenueMatchingAgent: jest.fn(),
}))

jest.mock('@/lib/ai/agents/economicsAgent', () => ({
  economicsAgentDefinition: { agentName: 'economics', model: 'gpt-4o-mini' },
  runEconomicsAgent: jest.fn(),
}))

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
  createServiceRoleClient: jest.fn(),
}))

jest.mock('next/server', () => ({
  NextResponse: {
    json: (data: unknown, init?: ResponseInit) => {
      const headers = new Headers(init?.headers)
      headers.set('content-type', 'application/json')
      return new Response(JSON.stringify(data), {
        ...init,
        status: init?.status ?? 200,
        headers,
      })
    },
  },
}))

import {
  GooglePlacesApiError,
  clearGooglePlacesRateLimit,
  searchGooglePlacesText,
} from '@/lib/server/google-places-client'
import { resolvePlacesIntent } from '@/lib/server/places-archetype-intent'
import { buildPlacesSearchAreas, classifyPlacesSearchFailure } from '@/lib/server/places-recommendation-helpers'
import { rankCatalogPartners } from '@/lib/planner/catalogRanker'
import { archetypeFor } from '@/lib/planner/archetypes'

describe('recommendation pipeline regressions', () => {
  beforeEach(() => {
    clearGooglePlacesRateLimit()
  })

  it('normalizes multi-area Oakland phrases before Places discovery', () => {
    expect(buildPlacesSearchAreas('Downtown or Uptown Oakland')).toEqual([
      'downtown oakland',
      'uptown oakland',
    ])
  })

  it('maps happy-hour and mixer intent to bar-first Places traversal', () => {
    const intent = resolvePlacesIntent('networking mixer')

    expect(intent.primary_types).toEqual(['bar', 'brewery', 'cocktail_bar', 'restaurant'])
    expect(intent.cluster_label).toBe('food_drink')
  })

  it('classifies Places quota failures separately while preserving fallback behavior', () => {
    expect(classifyPlacesSearchFailure(new GooglePlacesApiError(429, 'quota exceeded'))).toBe('quota_or_rate_limited')
    expect(classifyPlacesSearchFailure(new GooglePlacesApiError(500, 'upstream failed'))).toBe('api_error')
    expect(classifyPlacesSearchFailure(new Error('fetch failed: timeout'))).toBe('network_or_timeout')
  })

  it('filters malformed and closed Places payload rows without throwing', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(new Response(JSON.stringify({
      places: [
        { id: '', displayName: { text: 'Missing ID' }, businessStatus: 'OPERATIONAL' },
        { id: 'places/no-name', displayName: {}, businessStatus: 'OPERATIONAL' },
        { id: 'places/closed', displayName: { text: 'Closed Venue' }, businessStatus: 'CLOSED_PERMANENTLY' },
        { id: 'places/open', displayName: { text: 'Open Lounge' }, businessStatus: 'OPERATIONAL' },
      ],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    const result = await searchGooglePlacesText({
      apiKey: 'google-key',
      textQuery: 'bars in Uptown Oakland',
      neighborhood: 'Uptown Oakland',
      fetchImpl,
      sleep: async () => undefined,
      now: () => 0,
    })

    expect(result.places).toEqual([
      expect.objectContaining({ id: 'places/open', displayName: { text: 'Open Lounge' } }),
    ])
  })

  it('keeps unknown-capacity venues eligible as a soft-penalty pass-through', () => {
    const result = rankCatalogPartners({
      plan: {
        event_type: 'networking_mixer',
        guest_count: 40,
        neighborhood: 'Oakland',
      },
      archetype: archetypeFor('networking_mixer'),
      venues: [{
        id: 'venue-unknown',
        name: 'Unknown Capacity Bar',
        city: 'Oakland',
        neighborhood: 'Uptown Oakland',
        venue_type: 'bar',
        unique_features_tags: ['bar'],
        capacity: null,
      }],
      vendors: [],
      limit: 1,
      venueLimit: 1,
      vendorLimit: 0,
    })

    expect(result.recommendations).toHaveLength(1)
    expect(result.recommendations[0]).toMatchObject({
      partner_id: 'venue-unknown',
      capacity: null,
      capacity_known: false,
    })
  })

  it('hard-filters venues only when known or trusted capacity is below projected attendance', () => {
    const result = rankCatalogPartners({
      plan: {
        event_type: 'networking_mixer',
        guest_count: 80,
        neighborhood: 'Oakland',
      },
      archetype: archetypeFor('networking_mixer'),
      venues: [{
        id: 'venue-small',
        name: 'Tiny Bar',
        city: 'Oakland',
        neighborhood: 'Uptown Oakland',
        venue_type: 'bar',
        unique_features_tags: ['bar'],
        capacity_standing: 25,
      }],
      vendors: [],
      limit: 1,
      venueLimit: 1,
      vendorLimit: 0,
    })

    expect(result.recommendations).toHaveLength(0)
    expect(result.rejected[0].blocking_issues.join(' ')).toContain('Capacity 25')
  })
})
