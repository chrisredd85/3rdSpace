import { independentVenueEvidence, readSafeDiscoveryVenue, writeVenueFacts, upsertVenueIdentity } from '../venueRepository'
import { assertDurableVenueContent, readSafeVenueSnapshot, serializeVenueDurable, withIndependentVenueDerivation } from '../venuePersistence'
import { readPlannerStorage, serializePlannerStorage } from '../venueBrowserStorage'
import { dedupeVenueIdentity } from '@/lib/venues/venueIdentity'
import { buildApprovalSnapshotV2, buildApprovalSnapshotHashV2, approvalRequiresReapproval } from '@/lib/planner/execution/reapproval'
const id = '00000000-0000-0000-0000-000000000001'
const evidence = independentVenueEvidence('venue_site', 'https://example.com/events', '2026-09-23T00:00:00Z')
const safe = () => readSafeDiscoveryVenue({ id, source:'google_places', source_external_id:'place-one', name:'Independent hall', contact_email:'events@example.com', metadata:{venue_boundary_version:1,field_provenance:{name:evidence,contact_email:evidence}} })

describe('C1 independent venue boundary', () => {
  it('keeps independent equal-valued facts but masks all Google or unknown ancestry, even approved', () => {
    const row = safe()
    expect(row.name).toBe('Independent hall')
    expect(readSafeDiscoveryVenue({id,name:'Independent hall',metadata:{approved:true}}).name).toBeNull()
    expect(readSafeDiscoveryVenue({id,name:'Independent hall',metadata:{field_provenance:{name:{...evidence,source:'derived',lineage:[{field:'name',provenance:{...evidence,source:'google_places'}}]}}}}).name).toBeNull()
    expect(row.venue_data.field_provenance.name).toEqual(evidence)
  })
  it('rejects a mixed write before the first RPC and writes identity only', async () => {
    const rpc = jest.fn().mockResolvedValue({ data:{id,source_external_id:'place-one'},error:null })
    await expect(writeVenueFacts({rpc}, id, {name:'GOOGLE_CANARY'}, {name:{...evidence,source:'google_places'}})).rejects.toThrow('Non-durable')
    expect(rpc).not.toHaveBeenCalled()
    await upsertVenueIdentity({rpc}, 'place-one')
    expect(rpc).toHaveBeenCalledWith('upsert_discovery_venue_identity',{p_place_id:'place-one'})
  })
  it('preserves independent contacts, money and IDs across durable adapters', () => {
    const row=safe()
    const payload={discovery_venue_id:id,name:row.name,venue_data:row.venue_data,price_cents:70000,consent:true}
    expect(serializeVenueDurable(payload)).toEqual(payload)
    expect(()=>serializeVenueDurable({...payload,name:'GOOGLE_CANARY'})).toThrow()
    expect(()=>serializeVenueDurable({...payload,google_live:{name:'GOOGLE_CANARY'}})).toThrow()
    expect(()=>assertDurableVenueContent(JSON.stringify({discovery_venue_id:id,name:'GOOGLE_CANARY'}))).toThrow()
  })
  it('makes historical unsafe copies unavailable without editing their stored source', () => {
    const legacy={content:'GOOGLE_CANARY',metadata:{ranked_venues:[{source:'google_places',name:'GOOGLE_CANARY',website:'https://provider.example',place_id:'place-one',discovery_venue_id:id}]}}
    const result=readSafeVenueSnapshot(legacy)
    expect(JSON.stringify(result)).not.toContain('GOOGLE_CANARY')
    expect(JSON.stringify(result)).not.toContain('provider.example')
    expect(legacy.content).toBe('GOOGLE_CANARY')
    expect(result.metadata.ranked_venues[0].discovery_venue_id).toBe(id)
  })
  it('versions both browser payloads and cannot revive old names with a partial merge', () => {
    const old={plan:{id:'plan-one',selected_venue:{source:'google_places',name:'GOOGLE_CANARY',place_id:'place-one',discovery_venue_id:id}},messages:[{role:'agent',content:'GOOGLE_CANARY'},{role:'user',content:'My event'}]}
    const next=serializePlannerStorage({...readPlannerStorage(old),savedAt:'today'})
    expect(next.venue_storage_version).toBe(1)
    expect(JSON.stringify(next)).not.toContain('GOOGLE_CANARY')
    expect(next.messages).toEqual([{role:'user',content:'My event'}])
    expect(()=>serializePlannerStorage({google_live_overlays:{[id]:{name:'GOOGLE_CANARY'}}})).toThrow()
  })
  it('dedupes by Place ID and explicit links, never shared names/city, and preserves rooms', () => {
    const rows=[{id:'a',google_place_id:'one',venue_name:'Same',city:'SF'}, {id:'b',google_place_id:'two',venue_name:'Same',city:'SF'}, {id:'c',google_place_id:'one',venue_name:'Renamed',city:'SF'}, {id:'room1',google_place_id:'one',room_id:'small'}, {id:'room2',google_place_id:'one',room_id:'large'}]
    expect(dedupeVenueIdentity(rows).map(row=>row.id)).toEqual(['a','b','room1','room2'])
    expect(dedupeVenueIdentity([{id:'catalog1'},{id:'discovery1',claimed_venue_id:'catalog1'}])).toHaveLength(1)
  })

  it('preserves a real canonical quote snapshot and its hash while keeping host geography separate', () => {
    const venue = safe()
    const payload = {
      kind: 'canonical_quote_booking', quote_kind: 'venue', quote_response_id: 'reply-1',
      target_type: 'discovery_venue', target_id: id, target_name: venue.name, venue_data: venue.venue_data, service_type: 'venue_rental',
      requested_amount_cents: 175000, price_cents: 175000, event_date: '2026-10-03',
      quote_terms: { conditions: ['72-hour cancellation'], quoted_price_cents: 175000, raw_response_excerpt: 'The agreed rental is $1,750.' },
    }
    const plan = { event_type: 'dinner', guest_count: 60, budget_cap_cents: 220000, neighborhood: 'Host requested Oakland', date_window_start: '2026-10-03', date_window_end: '2026-10-03', ticketed: true, ticketing_model: 'paid', food_responsibility: 'host', profit_goal_cents: 70000 }
    const approval = { action_label: 'Approve booking request with Independent hall', provider: venue.name, delivery_email: venue.contact_email, requested_amount_cents: 175000, price_cents: 175000, notes: payload.quote_terms.raw_response_excerpt }
    const action = { action_type: 'concierge_queue' as const, target_type: 'discovery_venue', target_id: id, amount_cents: 175000, payload_json: payload, provider: venue.name, description: 'Prepare booking from accepted venue quote' }
    const input = { plan, approval, action, payload } as any
    const snapshot = buildApprovalSnapshotV2(input)
    const hash = buildApprovalSnapshotHashV2(input)
    const record = { ...approval, snapshot_json: snapshot, snapshot_hash: hash, snapshot_schema_version: 2 }
    expect(() => assertDurableVenueContent(action)).not.toThrow()
    expect(serializeVenueDurable(record)).toEqual(record)
    expect(readSafeVenueSnapshot({ metadata: { approval: record } })).toEqual({ metadata: { approval: record } })
    expect(approvalRequiresReapproval({ ...input, storedSnapshotHash: hash, storedSnapshotVersion: 2 })).toBe(false)
    const wrongLabel = JSON.parse(JSON.stringify(record))
    wrongLabel.snapshot_json.counterparty.display_name = 'RAW_GOOGLE_LABEL'
    expect(() => assertDurableVenueContent(wrongLabel)).toThrow('Venue persistence')
    expect(() => assertDurableVenueContent({ ...payload, target_name: 'RAW_GOOGLE_LABEL' })).toThrow('target_name')
    const wrongRecipient = JSON.parse(JSON.stringify(record))
    wrongRecipient.snapshot_json.counterparty.delivery_email = 'unverified@example.com'
    expect(() => assertDurableVenueContent(wrongRecipient)).toThrow('delivery_email')
    expect(record.snapshot_hash).toBe(hash)
  })

  it('preserves Gmail thread state and independent recipients without treating state as an address', () => {
    const venue = safe()
    const thread = { id: 'thread-1', discovery_venue_id: id, target_type: 'venue', target_name: venue.name, target_email: venue.contact_email, state: 'awaiting_reply', needs_attention: false, channel: 'email', channel_strategy: { source: 'gmail_approved_outreach', venue_data: venue.venue_data } }
    expect(serializeVenueDurable(thread)).toEqual(thread)
    expect(readSafeVenueSnapshot(thread)).toEqual(thread)
    expect(() => serializeVenueDurable({ ...thread, target_name: 'RAW_GOOGLE_LABEL' })).toThrow()
    expect(() => serializeVenueDurable({ ...thread, discovery_venue_id: 'different-venue' })).toThrow('venue_identity')
  })

  it('preserves independent commercial fields when hiding an unresolved legacy venue label', () => {
    const record = { discovery_venue_id: id, name: 'RAW_GOOGLE_LABEL', price_cents: 175000, currency: 'usd', consent: true, status: 'confirmed', quote_terms: { quoted_price_cents: 175000, conditions: ['72-hour cancellation'] } }
    expect(readSafeVenueSnapshot(record)).toEqual({ ...record, name: null })
    expect(record.name).toBe('RAW_GOOGLE_LABEL')
  })

  it('rejects ambiguous signed snapshots even inside serialized JSON and never strips their data', () => {
    const signed = { snapshot_hash: 'consented-hash', snapshot_json: { discovery_venue_id: id, name: 'RAW_GOOGLE_LABEL' } }
    expect(() => readSafeVenueSnapshot({ metadata: { approval: signed } })).toThrow('Venue persistence')
    expect(() => readSafeVenueSnapshot({ metadata: JSON.stringify(signed) })).toThrow('Venue persistence')
    expect(() => serializeVenueDurable({ snapshot_hash: 'signed', snapshot_json: { image: 'places/place-one/photos/token' } })).toThrow('immutable_photo')
    expect(signed.snapshot_json.name).toBe('RAW_GOOGLE_LABEL')
  })

  it('preserves evidence-bearing recommendation and template copies, with lineage tied to those facts', () => {
    const venue=safe()
    const metadata=withIndependentVenueDerivation({fit_score:90,reason:'Meets the independently confirmed requirements.'},venue.venue_data)
    const row={id:'recommendation-one',type:'venue',reference_id:id,external_name:venue.name,price_cents:175000,notes:'Meets the independently confirmed requirements.',metadata}
    expect(serializeVenueDurable(row)).toEqual(row)
    expect(readSafeVenueSnapshot(row)).toEqual(row)
    expect(()=>serializeVenueDurable({...row,external_name:'GOOGLE_CANARY'})).toThrow('external_name')
    expect(()=>serializeVenueDurable({...row,reference_id:'different-venue'})).toThrow('venue_identity')
    const wrongLineage=JSON.parse(JSON.stringify(row))
    wrongLineage.metadata.venue_derivation.lineage[0].provenance.evidence_reference='https://different.example'
    expect(()=>serializeVenueDurable(wrongLineage)).toThrow('venue_derivation')
    const catalog={id:'catalog-recommendation',type:'venue',reference_id:'native-catalog-venue',external_name:'Partner-entered venue',price_cents:175000}
    expect(serializeVenueDurable(catalog)).toEqual(catalog)
  })
})
