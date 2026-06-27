jest.mock('server-only', () => ({}))

import {
  normalizeVendorServiceType,
  resolveDiscoveryVendorRate,
  searchPlacesForVendor,
  type DiscoveryVendorRow,
} from '@/lib/server/places-vendor-search'
import { clearGooglePlacesRateLimit } from '@/lib/server/google-places-client'

describe('places vendor search helpers', () => {
  beforeEach(() => {
    clearGooglePlacesRateLimit()
    jest.restoreAllMocks()
  })

  it('normalizes planner vendor stack service types into Places vendor services', () => {
    expect(normalizeVendorServiceType('photography')).toBe('photographer')
    expect(normalizeVendorServiceType('av_tech')).toBe('av_production')
    expect(normalizeVendorServiceType('decor')).toBe('decor')
    expect(normalizeVendorServiceType('security')).toBe('security')
    expect(normalizeVendorServiceType('boat charter')).toBe('yacht_charter')
    expect(normalizeVendorServiceType('rooftop')).toBe('rooftop_buyout')
    expect(normalizeVendorServiceType('unknown_service')).toBeNull()
  })

  it('searches special supply with location bias instead of strict neighborhood restriction', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      places: [{
        id: 'places/yacht',
        displayName: { text: 'Bay Charter Co' },
        formattedAddress: 'Pier 3, San Francisco, CA',
        businessStatus: 'OPERATIONAL',
        websiteUri: 'https://charter.example',
      }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    const admin = createVendorSearchDb()

    const result = await searchPlacesForVendor({
      serviceType: 'yacht_charter',
      areas: ['Oakland'],
      admin,
      apiKey: 'google-key',
      planId: 'plan-1',
      searchedByUserId: 'user-1',
      plan: {
        event_city: 'Oakland',
        special_supply_radius_miles: 100,
      },
    })

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(result.places_requests[0].locationBias?.circle.radius).toBe(160_000)
    expect(result.places_requests[0].locationRestriction).toBeUndefined()
    expect(result.vendors[0]).toEqual(expect.objectContaining({
      name: 'Bay Charter Co',
      data_freshness_status: 'fresh',
    }))
    expect(admin.rows.plan_discovery_vendor_candidates).toHaveLength(1)
  })

  it('uses high-confidence inferred package rates as estimates', () => {
    const vendor = {
      id: 'vendor-1',
      name: 'Moongate Photo',
      service_type: 'photographer',
      inferred_package_rate_cents: 180000,
      inferred_hourly_rate_cents: 50000,
      inferred_minimum_cents: null,
      rate_inference_confidence: 0.76,
      rate_inference_admin_status: 'pending',
    } as DiscoveryVendorRow

    expect(resolveDiscoveryVendorRate(vendor)).toEqual({
      cents: 180000,
      confidenceLabel: 'estimated',
      confidence: 0.76,
    })
  })

  it('marks missing discovery vendor rates as TBD', () => {
    const vendor = {
      id: 'vendor-2',
      name: 'Unknown AV',
      service_type: 'av_production',
    } as DiscoveryVendorRow

    expect(resolveDiscoveryVendorRate(vendor)).toEqual({
      cents: null,
      confidenceLabel: 'rate_tbd',
      confidence: null,
    })
  })
})

function createVendorSearchDb() {
  const rows: Record<string, any[]> = {
    discovery_vendors: [],
    plan_discovery_vendor_candidates: [],
  }
  return {
    rows,
    from(table: string) {
      return {
        upsert(payload: any) {
          const inserts = Array.isArray(payload) ? payload : [payload]
          if (table === 'discovery_vendors') {
            const withIds = inserts.map((insert, index) => ({ id: `vendor-${index + 1}`, ...insert }))
            rows[table].push(...withIds)
            return {
              select() {
                return {
                  async single() {
                    return { data: withIds[0], error: null }
                  },
                }
              },
            }
          }
          rows[table].push(...inserts)
          return Promise.resolve({ data: inserts, error: null })
        },
      }
    },
  }
}
