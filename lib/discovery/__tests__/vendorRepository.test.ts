import { readSafeDiscoveryVendor, independentVendorEvidence, vendorActionEnvelope, writeVendorFacts, upsertVendorProfileIdentity } from '../vendorRepository'
import { assertDurableVendorContent, readSafeVendorSnapshot } from '../vendorPersistence'
import { serializePlannerStorage, readPlannerStorage } from '../venueBrowserStorage'
import { safeVenueTelemetry, serializeVenueDurable } from '../venuePersistence'
const id = '10000000-0000-4000-8000-000000000001'
const p = independentVendorEvidence('venue_site', 'https://example.com/contact', '2026-11-10T12:00:00Z')
const row = { id, source: 'google_places', source_external_id: 'place-one', name: 'Independent vendor', service_type: 'dj', google_rating: 5,
  organizer_provided_email: 'rescue@example.com', extracted_emails: [{ email: 'book@example.com', source_path: '/contact', extracted_at: '2026-11-10T12:00:00Z', confidence: 0.9, is_likely_booking_contact: true, source: 'business_website', source_url: 'https://example.com/contact' }],
  field_provenance: { name: p, service_type: p, extracted_emails: p, organizer_provided_email: independentVendorEvidence('host_input', `host:${id}`) } }

describe('C2 vendor independent facts', () => {
  it('legacy Google listing fields remain unavailable without field evidence', () => {
    const vendor = readSafeDiscoveryVendor({ ...row, field_provenance: {} })
    expect(vendor.name).toBeNull(); expect(vendor.service_type).toBeNull(); expect(vendor.extracted_emails).toEqual([])
    expect(vendor.vendor_data.values).toEqual({}); expect(vendor.google_rating).toBeNull()
  })
  it('equal values retain distinct origins; approval cannot relabel a Google ancestor', () => {
    const vendor = readSafeDiscoveryVendor({ ...row, field_provenance: { ...row.field_provenance, name: { ...p, source: 'google_places', confirmation_status: 'venue_confirmed' } } })
    expect(vendor.name).toBeNull(); expect(vendor.service_type).toBe('dj')
    expect(readSafeDiscoveryVendor(row).name).toBe('Independent vendor')
  })
  it('normalizes a legacy prefixed Place ID without changing internal identity', () => {
    const vendor=readSafeDiscoveryVendor({...row,source_external_id:'places/place-one'})
    expect(vendor.id).toBe(id);expect(vendor.source_external_id).toBe('place-one')
    expect(vendor.vendor_data.identity.place_id).toBe('place-one')
  })

  it('known zero money stays zero and absent money stays unknown', () => {
    const vendor = readSafeDiscoveryVendor({ ...row, inferred_minimum_cents: 0, field_provenance: { ...row.field_provenance, inferred_minimum_cents: p } })
    expect(vendor.inferred_minimum_cents).toBe(0); expect(vendor.inferred_package_rate_cents).toBeNull()
  })
  it('keeps only typed independent contacts and binds the selected rescue email', () => {
    const vendor = readSafeDiscoveryVendor(row)
    expect(vendorActionEnvelope(vendor, 'rescue@example.com').values.contact_email).toBe('rescue@example.com')
    expect(vendorActionEnvelope(vendor, 'book@example.com').values.contact_email).toBe('book@example.com')
    expect(vendorActionEnvelope(vendor, 'stranger@example.com').values.contact_email).toBeUndefined()
    expect(readSafeDiscoveryVendor({ ...row, extracted_emails: [{ email: 'book@example.com', googleLive: 'canary' }] }).extracted_emails).toEqual([])
  })
  it.each([
    { extracted_at: undefined }, { source_path: 'contact' }, { confidence: undefined },
    { is_likely_booking_contact: undefined }, { label: 'not an email field' },
    { source_url: 'https://user:password@example.com/contact' }, { source_url: 'https://example.com/ contact' },
  ])('rejects contacts that the SQL gateway rejects: %p', async invalid => {
    const values = { extracted_emails: [{ ...row.extracted_emails[0], ...invalid }] }
    const db = { rpc: jest.fn() }
    expect(readSafeDiscoveryVendor({ ...row, ...values }).extracted_emails).toEqual([])
    await expect(writeVendorFacts(db, id, values, { extracted_emails: p })).rejects.toThrow()
    expect(db.rpc).not.toHaveBeenCalled()
  })

  it('rejects mixed facts before invoking the writer and preserves the existing profile identity path', async () => {
    const db = { rpc: jest.fn().mockResolvedValue({ data: row, error: null }) }
    await expect(writeVendorFacts(db,id,{ name:'canary' },{})).rejects.toThrow()
    expect(db.rpc).not.toHaveBeenCalled()
    await upsertVendorProfileIdentity(db,id)
    expect(db.rpc).toHaveBeenCalledWith('upsert_discovery_vendor_identity',{ p_vendor_profile_id:id })
  })
  it('keeps contact origin constraints aligned with the SQL gateway', async () => {
    const db = { rpc: jest.fn() }
    const host = independentVendorEvidence('host_input', `host:${id}`)
    expect(readSafeDiscoveryVendor({ ...row, field_provenance: { ...row.field_provenance, extracted_emails: host, organizer_provided_email: p } }).extracted_emails).toEqual([])
    expect(readSafeDiscoveryVendor({ ...row, field_provenance: { ...row.field_provenance, organizer_provided_email: p } }).organizer_provided_email).toBeNull()
    await expect(writeVendorFacts(db, id, { extracted_emails: row.extracted_emails }, { extracted_emails: host })).rejects.toThrow('contact evidence')
    await expect(writeVendorFacts(db, id, { organizer_provided_email: 'book@example.com' }, { organizer_provided_email: p })).rejects.toThrow('Host evidence')
    expect(db.rpc).not.toHaveBeenCalled()
  })
  it('safe envelope survives shared serialization; Google siblings and mismatched identity fail', () => {
    const vendor = readSafeDiscoveryVendor(row)
    const payload = { discovery_vendor_id:id, name:vendor.name, service_type:vendor.service_type, vendor_data:vendor.vendor_data }
    expect(serializeVenueDurable(payload)).toEqual(payload)
    expect(()=>assertDurableVendorContent({ ...payload, name:'GOOGLE_CANARY' })).toThrow()
    expect(()=>assertDurableVendorContent({ ...payload, discovery_vendor_id:'different' })).toThrow()
    expect(()=>assertDurableVendorContent({ ...payload, google_rating:5 })).toThrow()
  })
  it('rejects hidden Google fields in envelope, evidence and ordinary inherited metadata', () => {
    const safe=readSafeDiscoveryVendor(row).vendor_data
    expect(()=>assertDurableVendorContent({...safe,google_rating:5})).toThrow()
    expect(()=>assertDurableVendorContent({...safe,field_provenance:{...safe.field_provenance,hidden:'GOOGLE_CANARY'}})).toThrow()
    for(const metadata of [{website:'https://google-derived.example'},{google_rating:5}]) {
      expect(()=>assertDurableVendorContent({discovery_vendor_id:id,vendor_data:safe,metadata})).toThrow()
    }
    expect(readSafeDiscoveryVendor({...row,extracted_emails:[{email:'book@example.com',source_path:{hidden:'GOOGLE_CANARY'}}]}).extracted_emails).toEqual([])
  })

  it('keeps vendor Google content out of browser and telemetry copies while retaining independent identity', () => {
    const unsafe = { discovery_vendor_id: id, name: 'GOOGLE_CANARY', google_rating: 5 }
    expect(() => serializePlannerStorage({ metadata: { vendor: unsafe } })).toThrow()
    expect(safeVenueTelemetry({ id, model: 'mock', duration_ms: 9, payload: unsafe })).toEqual({ id, model: 'mock', duration_ms: 9 })
    const restored = readPlannerStorage({ title: 'Host title', venue_storage_version: 1, metadata: { vendor: unsafe }, messages: [{ role: 'agent', content: 'GOOGLE_CANARY' }, { role: 'user', content: 'Host intent' }] })
    expect(restored.title).toBe('Host title')
    expect(restored.messages).toEqual([{ role: 'user', content: 'Host intent' }])
    expect(JSON.stringify(restored)).not.toContain('GOOGLE_CANARY')
  })
  it('projects legacy display but refuses to alter signed snapshots', () => {
    const legacy = { discovery_vendor_id:id, name:'GOOGLE_CANARY', service_type:'dj', quote_terms:{price_cents:700} }
    expect(readSafeVendorSnapshot(legacy)).toEqual({ ...legacy, name:null, service_type:null })
    expect(()=>readSafeVendorSnapshot({ snapshot_hash:'hash', snapshot_json:{ schema_version:2, plan:{}, approval:{provider:'GOOGLE_CANARY'}, action:{target_type:'discovery_vendor',target_id:id,payload_json:legacy} } })).toThrow()
  })
})
