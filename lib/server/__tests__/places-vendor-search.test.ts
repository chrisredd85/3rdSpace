jest.mock('server-only', () => ({}))

import { buildDiscoveryVendorInsert, normalizeVendorServiceType, resolveDiscoveryVendorRate, scoreDiscoveryVendorFit, searchPlacesForVendor, type DiscoveryVendorRow } from '@/lib/server/places-vendor-search'
import { clearGooglePlacesRateLimit, GOOGLE_VENUE_TEXT_SEARCH_FIELD_MASK } from '@/lib/server/google-places-client'
import { independentVendorEvidence, readSafeDiscoveryVendor } from '@/lib/discovery/vendorRepository'
import { createVendorDetailsContext } from '@/lib/server/vendor-places-details'

const evidence = independentVendorEvidence('venue_site', 'https://partner.example/services', '2026-11-10T00:00:00Z')
function safeVendor(id: string, values: Record<string, unknown>) {
  return readSafeDiscoveryVendor({ id: `vendor-${id}`, source: 'google_places', source_external_id: id, ...values,
    field_provenance: Object.fromEntries(Object.keys(values).map(key => [key, evidence])) })
}
function json(value: unknown) { return new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } }) }
function createDb(existing: DiscoveryVendorRow[] = [], profiles: unknown[] = [], availability: unknown[] = []) {
  const writes: Record<string, unknown[]> = { identity: [], candidates: [] }
  return {
    writes,
    async rpc(name: string, args: Record<string, unknown>) {
      expect(name).toBe('upsert_discovery_vendor_identity')
      expect(Object.keys(args)).toEqual(['p_place_id'])
      writes.identity.push(args)
      return { data: existing.find(row => row.source_external_id === args.p_place_id) ?? { id: `vendor-${args.p_place_id}`, source: 'google_places', source_external_id: args.p_place_id }, error: null }
    },
    from(table: string) {
      expect(table).not.toBe('discovery_vendors')
      let data: unknown[] = table === 'discovery_vendors_safe' ? existing : table === 'vendor_profiles' ? profiles : table === 'vendor_availability' ? availability : []
      const query = { select: () => query, eq: () => query,
        in: (field: string, values: unknown[]) => { data = data.filter(row => values.includes((row as Record<string, unknown>)[field])); return query },
        or: (filter: string) => {
          const conditions = [...filter.matchAll(/(source_external_id|google_place_id)\.in\.\(([^)]+)\)/g)]
          data = data.filter(row => conditions.some(([, field, values]) => values.split(',').includes(String((row as Record<string, unknown>)[field]))))
          return query
        }, gte: () => query, lte: () => query,
        then: (resolve: (result: { data: unknown[]; error: null }) => unknown) => Promise.resolve(resolve({ data, error: null })),
        upsert: async (rows: unknown[]) => { expect(table).toBe('plan_discovery_vendor_candidates'); writes.candidates.push(...rows); return { error: null } } }
      return query
    },
  }
}

describe('vendor staged discovery', () => {
  beforeEach(() => { clearGooglePlacesRateLimit(); process.env.GOOGLE_PLACES_VENDORS_ENABLED = 'true' })
  afterEach(() => { jest.restoreAllMocks(); delete process.env.GOOGLE_PLACES_VENDORS_ENABLED })
  it('normalizes service intent without claiming it as a business fact', () => {
    expect(normalizeVendorServiceType('photography')).toBe('photographer')
    expect(normalizeVendorServiceType('av_tech')).toBe('av_production')
    expect(normalizeVendorServiceType('boat charter')).toBe('yacht_charter')
    expect(normalizeVendorServiceType('unknown')).toBeNull()
    expect(buildDiscoveryVendorInsert({ id: 'places/business' })).toEqual({ source: 'google_places', source_external_id: 'business' })
  })
  it('keeps acquisition off independently of the venue flag, with no provider call or write', async () => {
    delete process.env.GOOGLE_PLACES_VENDORS_ENABLED
    process.env.GOOGLE_PLACES_VENUES_ENABLED = 'true'
    const spy = jest.spyOn(global, 'fetch')
    const db = createDb()
    expect((await searchPlacesForVendor({ serviceType: 'catering', areas: ['Oakland'], admin: db, apiKey: 'fake' })).vendors).toEqual([])
    expect(spy).not.toHaveBeenCalled(); expect(db.writes.identity).toEqual([])
    delete process.env.GOOGLE_PLACES_VENUES_ENABLED
  })
  it.each([['catering', true], ['dj_music', true], ['yacht_charter', false], ['mansion_rental', false]])('uses explicit service-area policy for %s', async (serviceType, mobile) => {
    const spy = jest.spyOn(global, 'fetch').mockImplementation(async (url) => json(String(url).includes('searchText')
      ? { places: [{ id: 'places/mobile', displayName: { text: 'Transient business' }, websiteUri: 'https://must-not-be-pro.json', rating: 5 }] }
      : { id: 'mobile', displayName: { text: 'Fresh business' }, websiteUri: 'https://partner.example' }))
    const db = createDb()
    const result = await searchPlacesForVendor({ serviceType, areas: ['Oakland'], admin: db, apiKey: 'fake', planId: 'plan', plan: { event_city: 'Oakland' } })
    const request = JSON.parse(String(spy.mock.calls[0][1]?.body))
    expect(request.includePureServiceAreaBusinesses).toBe(mobile)
    expect(request.maxResultCount).toBe(20)
    expect(spy.mock.calls[0][1]?.headers).toMatchObject({ 'X-Goog-FieldMask': GOOGLE_VENUE_TEXT_SEARCH_FIELD_MASK })
    expect(result.vendors[0].name).toBeNull()
    expect(result.vendors[0].service_type).toBeNull()
    expect(result.live[0].place.displayName?.text).toBe('Fresh business')
    expect(JSON.stringify(db.writes)).not.toMatch(/Transient business|Fresh business|websiteUri|rating|formattedAddress|photos/)
    expect(db.writes.candidates[0]).toMatchObject({ fit_score: null, service_type: serviceType })
    for (const call of spy.mock.calls) expect(call[1]?.cache).toBe('no-store')
    if (!mobile) { expect(request.locationBias.circle.radius).toBe(160000); expect(request.locationRestriction).toBeUndefined() }
  })
  it('scores the entire unique pool before cap; never hydrates duplicate or rejected IDs', async () => {
    const rows = [safeVendor('expensive', { name: 'Price conflict', service_type: 'catering', inferred_package_rate_cents: 90000 }),
      safeVendor('fit', { name: 'Independent choice', service_type: 'catering', inferred_package_rate_cents: 5000 })]
    const spy = jest.spyOn(global, 'fetch').mockImplementation(async (url) => String(url).includes('searchText') ? json({ places: [
      { id: 'expensive', rating: 5 }, { id: 'unknown', rating: 5 }, { id: 'fit', rating: 1 }, { id: 'places/fit', rating: 5 },
    ] }) : json({ id: 'fit', displayName: { text: 'Transient Google title' } }))
    const db = createDb(rows)
    const result = await searchPlacesForVendor({ serviceType: 'catering', areas: ['Oakland'], admin: db, apiKey: 'fake', maxResults: 1, remainingBudgetCents: 10000 })
    expect(result.vendors.map(row => row.id)).toEqual(['vendor-fit'])
    expect(spy).toHaveBeenCalledTimes(2)
    expect(String(spy.mock.calls[1][0]).endsWith('/fit')).toBe(true)
    expect(db.writes.identity).toEqual([{ p_place_id: 'fit' }])
  })
  it('does not restore the Pro result after fresh Details finds a closed or wrong business', async () => {
    const spy = jest.spyOn(global, 'fetch').mockImplementation(async url => String(url).includes('searchText')
      ? json({ places: [{ id: 'closed' }, { id: 'wrong' }] })
      : String(url).endsWith('/closed') ? json({ id: 'closed', businessStatus: 'CLOSED_PERMANENTLY' }) : json({ id: 'replacement' }))
    const db = createDb()
    const result = await searchPlacesForVendor({ serviceType: 'catering', areas: ['Oakland'], admin: db, apiKey: 'fake' })
    expect(result).toMatchObject({ vendors: [], live: [], unavailable: true })
    expect(db.writes.identity).toEqual([]); expect(spy).toHaveBeenCalledTimes(3)
  })

  it('does not make absence of a storefront, price, date or format into a conflict', () => {
    const fit = scoreDiscoveryVendorFit({ serviceType: 'catering', plan: { event_city: 'Oakland', date_window_start: '2026-12-01' } })
    expect(fit).toEqual({ eligible: true, score: 50, unknown: ['service', 'price', 'date', 'format'], conflicts: [] })
  })
  it('rejects independently known budget/date conflicts and keeps hourly/minimum distinct', () => {
    const vendor = safeVendor('v', { service_type: 'catering', inferred_hourly_rate_cents: 5000, inferred_minimum_cents: 15000 })
    expect(scoreDiscoveryVendorFit({ vendor, serviceType: 'catering', remainingBudgetCents: 10000,
      plan: { date_window_start: '2026-12-01' }, linkedProfile: { blockedDates: ['2026-12-01'] } })).toMatchObject({ eligible: false, conflicts: ['budget', 'date'], unknown: expect.arrayContaining(['price']) })
    expect(scoreDiscoveryVendorFit({ vendor, serviceType: 'catering', remainingBudgetCents: 20000 }).eligible).toBe(true)
  })
  it('uses explicit claim-linked availability/format before Details; a blocked linked candidate is discarded', async () => {
    const db = createDb([safeVendor('blocked', { name: 'Busy', service_type: 'catering' })],
      [{ id: 'profile', discovery_vendor_id: 'vendor-blocked', compatible_features: ['dinner'] }], [{ vendor_id: 'profile', date: '2026-12-01', status: 'blocked' }])
    const spy = jest.spyOn(global, 'fetch').mockResolvedValue(json({ places: [{ id: 'blocked' }] }))
    const result = await searchPlacesForVendor({ serviceType: 'catering', areas: ['Oakland'], admin: db, apiKey: 'fake', plan: { date_window_start: '2026-12-01', event_type: 'dinner' } })
    expect(result.vendors).toEqual([]); expect(spy).toHaveBeenCalledTimes(1)
  })
  it.each(['prefixed', 'separate-id'])('retains known budget and date conflicts from a legacy %s identity', async (shape) => {
    const vendor = { ...safeVendor('legacy', { name: 'Busy vendor', service_type: 'catering', inferred_package_rate_cents: 15000 }),
      source_external_id: shape === 'prefixed' ? 'places/legacy' : 'old-provider-key', google_place_id: shape === 'prefixed' ? null : 'legacy' }
    const db = createDb([vendor], [{ id: 'profile', discovery_vendor_id: vendor.id }], [{ vendor_id: 'profile', date: '2026-12-01', status: 'blocked' }])
    const spy = jest.spyOn(global, 'fetch').mockResolvedValue(json({ places: [{ id: 'legacy' }] }))
    const result = await searchPlacesForVendor({ serviceType: 'catering', areas: ['Oakland'], admin: db, apiKey: 'fake',
      remainingBudgetCents: 10000, plan: { date_window_start: '2026-12-01' } })
    expect(result.vendors).toEqual([])
    expect(db.writes.identity).toEqual([])
    expect(spy).toHaveBeenCalledTimes(1)
  })
  it('shares a deadline across service searches instead of creating a new budget for each', async () => {
    let now = 0
    const context = createVendorDetailsContext({ now: () => now, fetchImpl: jest.fn(async () => { now = 20001; return json({ places: [] }) }) as typeof fetch })
    const db = createDb()
    await searchPlacesForVendor({ serviceType: 'catering', areas: ['Oakland'], admin: db, apiKey: 'fake', context })
    const result = await searchPlacesForVendor({ serviceType: 'photographer', areas: ['Oakland'], admin: db, apiKey: 'fake', context })
    expect(context.fetchImpl).toHaveBeenCalledTimes(1); expect(result.unavailable).toBe(true)
  })
  it('preserves high-confidence package estimates and independently published prices', () => {
    expect(resolveDiscoveryVendorRate({ inferred_package_rate_cents: 180000, inferred_hourly_rate_cents: 50000, inferred_minimum_cents: null,
      rate_inference_confidence: 0.76, rate_inference_admin_status: 'pending' })).toEqual({ cents: 180000, confidenceLabel: 'estimated', confidence: 0.76 })
    expect(resolveDiscoveryVendorRate(safeVendor('published', { inferred_package_rate_cents: 180000 }))).toMatchObject({ cents: 180000, confidenceLabel: 'estimated' })
  })

  it('retains legitimate zero and unknown rates as different inputs', () => {
    expect(resolveDiscoveryVendorRate({ inferred_package_rate_cents: 0, inferred_minimum_cents: null, inferred_hourly_rate_cents: null,
      rate_inference_admin_status: 'approved', rate_inference_confidence: null })).toMatchObject({ cents: 0, confidenceLabel: 'estimated' })
    expect(resolveDiscoveryVendorRate({} as DiscoveryVendorRow)).toMatchObject({ cents: null, confidenceLabel: 'rate_tbd' })
  })
})
