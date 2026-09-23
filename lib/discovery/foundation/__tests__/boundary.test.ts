import { createTransientDiscovery, serializeDiscovery, NonDurableDiscoveryContentError } from '../boundary'
import { readDiscoveryFields } from '../reader'

const evidence = (source = 'venue_site', extra: Record<string, unknown> = {}) => ({
  resolution: 'resolved', source, evidence_reference: 'evidence:1', collected_at: '2026-09-22T12:00:00Z',
  confidence: null, confirmation_status: 'unconfirmed', lineage: [], ...extra,
})
const identity = { kind: 'venue' as const, id: 'stable-internal-id', place_id: 'stable-place-id' }

describe('isolated discovery serializer and compatible reader', () => {
  it('strips Google overlays and ancestry while retaining independently sourced identical values and identity', () => {
    const input = createTransientDiscovery({
      identity,
      googleLive: { displayName: 'Google business', photos: [{ name: 'do-not-persist' }] },
      values: { name: 'Same name', address: 'Same name', capacity_seated: 60, contact_phone: 'secret-google-phone' },
      field_provenance: {
        name: evidence(), address: evidence('google_places'),
        capacity_seated: evidence('derived', { lineage: [{ field: 'type', provenance: evidence('google_places') }] }),
        contact_phone: evidence('google_places'),
      },
    })
    const result = serializeDiscovery(input, 'strip')
    expect(result.identity).toEqual(identity)
    expect(result.values).toEqual({ name: 'Same name' })
    expect(Object.keys(result.field_provenance)).toEqual(['name'])
    const json = JSON.stringify(result)
    for (const forbidden of ['Google business', 'do-not-persist', 'secret-google-phone', 'googleLive', 'capacity_seated']) {
      expect(json).not.toContain(forbidden)
    }
    expect(input.values).toMatchObject({ capacity_seated: 60 })
  })

  it('rejects by default and does not echo restricted content into the error', () => {
    const input = createTransientDiscovery({ identity, values: { name: 'PRIVATE GOOGLE VALUE' }, field_provenance: { name: evidence('google_places') } })
    expect(() => serializeDiscovery(input)).toThrow(NonDurableDiscoveryContentError)
    expect(() => serializeDiscovery(input)).toThrow('Non-durable discovery fields: name')
    try { serializeDiscovery(input) } catch (error) { expect(String(error)).not.toContain('PRIVATE GOOGLE VALUE') }
    expect(() => serializeDiscovery(createTransientDiscovery({ identity, googleLive: {} }))).toThrow('googleLive')
  })

  it('blocks accidental direct JSON serialization of the transient container', () => {
    expect(() => JSON.stringify(createTransientDiscovery({ identity, googleLive: { rating: 5 } }))).toThrow('explicit durable serializer')
  })

  it('owns a frozen snapshot so later value/evidence mutation cannot re-source a fact', () => {
    const values = { name: 'Independent name', vibe_tags: ['published'] }
    const provenance = { name: evidence(), vibe_tags: evidence() }
    const input = createTransientDiscovery({ identity, values, field_provenance: provenance })
    values.name = 'Copied Google name'
    values.vibe_tags.push('Copied Google type')
    provenance.name.source = 'google_places'
    expect(serializeDiscovery(input).values).toEqual({ name: 'Independent name', vibe_tags: ['published'] })
    expect(Object.isFrozen(input.values)).toBe(true)
    expect(Object.isFrozen(input.field_provenance)).toBe(true)
    expect(Object.isFrozen(input.identity)).toBe(true)
  })

  it('allows only declared columns, rejecting arbitrary JSON and stripping unknown evidence keys', () => {
    const input = createTransientDiscovery({
      identity,
      values: { name: 'Independent name', metadata: { google_rating: 5 }, photos: ['old-name'], 'Google content as key': true },
      field_provenance: { name: evidence('host_input', { raw_response: { name: 'Google payload' } }), metadata: evidence('host_input') },
    })
    expect(() => serializeDiscovery(input)).toThrow('[unrecognized field]')
    const result = serializeDiscovery(input, 'strip')
    expect(result.values).toEqual({ name: 'Independent name' })
    expect(JSON.stringify(result)).not.toMatch(/Google payload|Google content as key|raw_response|google_rating|old-name/)
  })

  it('does not treat legacy row source or approval as field evidence; handles both row types without error', () => {
    for (const kind of ['venue', 'vendor'] as const) {
      const fields = readDiscoveryFields(kind, { id: 'legacy', name: 'Legacy business', source: 'claimed', approved: true })
      expect(fields.name).toEqual({ status: 'unavailable', reason: 'unresolved' })
      expect(fields.website).toEqual({ status: 'unavailable', reason: 'missing' })
    }
    expect(() => readDiscoveryFields('venue', null)).not.toThrow()
  })

  it('preserves legitimate zero and false, rejects malformed quantities, and does not invent missing values', () => {
    const fields = readDiscoveryFields('venue', { capacity_seated: 0, av_available: false, price_hint_cents_low: 0.5 }, {
      capacity_seated: evidence(), av_available: evidence(), price_hint_cents_low: evidence(),
    })
    expect(fields.capacity_seated).toMatchObject({ status: 'available', value: 0 })
    expect(fields.av_available).toMatchObject({ status: 'available', value: false })
    expect(fields.price_hint_cents_low).toEqual({ status: 'unavailable', reason: 'invalid' })
    expect(fields.price_hint_cents_high).toEqual({ status: 'unavailable', reason: 'missing' })
  })

  it('serializes vendor existing columns with independent evidence and drops unresolved legacy fields', () => {
    const result = serializeDiscovery(createTransientDiscovery({
      identity: { ...identity, kind: 'vendor' },
      values: { name: 'Unknown origin', service_type: 'catering', inferred_package_rate_cents: 70000 },
      field_provenance: { service_type: evidence('host_input'), inferred_package_rate_cents: evidence('derived', {
        lineage: [{ field: 'published_package', provenance: evidence() }],
      }) },
    }), 'strip')
    expect(result.values).toEqual({ service_type: 'catering', inferred_package_rate_cents: 70000 })
    expect(result.identity.kind).toBe('vendor')
  })

  it('never retains Google coordinates; independently evidenced coordinates remain eligible', () => {
    const result = serializeDiscovery(createTransientDiscovery({ identity,
      values: { lat: 37.8, lng: -122.4 }, field_provenance: { lat: evidence('google_places'), lng: evidence('host_input') },
    }), 'strip')
    expect(result.values).toEqual({ lng: -122.4 })
  })
})
