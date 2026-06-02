jest.mock('server-only', () => ({}))

import {
  buildDiscoveryVenueClaimUrl,
  createDiscoveryVenueClaimToken,
  verifyDiscoveryVenueClaimToken,
} from '@/lib/outreach/discoveryClaimTokens'

describe('discovery venue claim tokens', () => {
  beforeEach(() => {
    process.env.DISCOVERY_CLAIM_TOKEN_SECRET = 'test-secret'
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com'
  })

  it('round-trips a signed discovery venue token', () => {
    const token = createDiscoveryVenueClaimToken({
      discoveryVenueId: 'venue-123',
      now: 1_000,
    })

    expect(verifyDiscoveryVenueClaimToken(token, 1_500)).toEqual({
      discovery_venue_id: 'venue-123',
      exp: 1_000 + 60 * 60 * 24 * 30,
    })
  })

  it('rejects expired or tampered tokens', () => {
    const token = createDiscoveryVenueClaimToken({
      discoveryVenueId: 'venue-123',
      now: 1_000,
    })

    expect(verifyDiscoveryVenueClaimToken(token, 1_000 + 60 * 60 * 24 * 31)).toBeNull()
    expect(verifyDiscoveryVenueClaimToken(`${token}tampered`, 1_500)).toBeNull()
  })

  it('builds a claim URL with the signed token', () => {
    const url = buildDiscoveryVenueClaimUrl({ discoveryVenueId: 'venue-123' })

    expect(url).toMatch(/^https:\/\/app\.example\.com\/v\/venue-123\/claim\?token=/)
    const token = new URL(url).searchParams.get('token')
    expect(token).toBeTruthy()
    expect(verifyDiscoveryVenueClaimToken(String(token), 1_500)?.discovery_venue_id).toBe('venue-123')
  })
})
