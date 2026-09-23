/** @jest-environment node */
import { venueBoundaryFetch, VENUE_COPY_TABLES } from '@/lib/supabase/venueBoundaryFetch'
import { independentVenueEvidence, readSafeDiscoveryVenue } from '@/lib/discovery/venueRepository'
import { buildApprovalSnapshotV2, buildApprovalSnapshotHashV2, approvalRequiresReapproval, type ApprovalSnapshotInput } from '@/lib/planner/execution/reapproval'
import { createClient } from '@supabase/supabase-js'
import { recordStripeAccountDiscoveryFreshness } from '@/lib/discovery/freshness'
import { cascadeInvalidationForEntityChange } from '@/lib/discovery/cascadeInvalidation'
import { discoveryFieldSchemas } from '@/lib/discovery/foundation/fields'
jest.mock('@/lib/discovery/cascadeInvalidation',()=>({cascadeInvalidationForEntityChange:jest.fn().mockResolvedValue({})}))
const json=(value:unknown)=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}})
const canary={discovery_venue_id:'00000000-0000-0000-0000-000000000001',name:'GOOGLE_CANARY',website:'https://GOOGLE_CANARY.example',google_rating:4.8}
it.each([...VENUE_COPY_TABLES])('rejects mixed venue content before any durable %s write even flag-off',async table=>{
  process.env.GOOGLE_PLACES_VENUES_ENABLED='false'
  const transport=jest.fn().mockResolvedValue(json({}))
  await expect(venueBoundaryFetch(transport)(`https://db.example/rest/v1/${table}`,{method:'POST',body:JSON.stringify({metadata:{snapshot:canary}})})).rejects.toThrow('Venue persistence')
  expect(transport).not.toHaveBeenCalled()
})

const venueFactCanaries = {
 name: 'GOOGLE_NAME_CANARY', address: '941 GOOGLE_ADDRESS_CANARY Lane',
 neighborhood: 'GOOGLE_NEIGHBORHOOD_CANARY', city: 'GOOGLE_CITY_CANARY', state: 'GOOGLE_STATE_CANARY',
 lat: 37.731, lng: -122.731, contact_email: 'GOOGLE_EMAIL_CANARY@example.com', contact_phone: '+1-415-555-0198',
 website: 'https://GOOGLE_SITE_CANARY.example', instagram_handle: 'GOOGLE_SOCIAL_CANARY',
 capacity_seated: 73, capacity_standing: 137, capacity_cocktail: 173,
 inferred_capacity_seated: 47, inferred_capacity_standing: 147,
 vibe_tags: ['GOOGLE_VIBE_CANARY'], alcohol_policy: 'GOOGLE_POLICY_CANARY', av_available: false,
 parking_notes: 'GOOGLE_PARKING_CANARY', price_hint_cents_low: 73100, price_hint_cents_high: 137100,
 price_hint_note: 'GOOGLE_PRICE_ESTIMATE_CANARY',
} satisfies Record<keyof typeof discoveryFieldSchemas.venue, unknown>

it('exercises every declared venue fact in the one-field transport matrix', () => {
 expect(Object.keys(venueFactCanaries).sort()).toEqual(Object.keys(discoveryFieldSchemas.venue).sort())
})

it.each([
 ...Object.entries(venueFactCanaries),
 ['google_rating', 4.731],
 ['google_user_ratings_total', 731],
 ['google_types', ['GOOGLE_TYPES_CANARY']],
 ['price_level', 'PRICE_LEVEL_EXPENSIVE'],
 ['business_status', 'CLOSED_TEMPORARILY'],
 ['google_business_status', 'CLOSED_PERMANENTLY'],
 ['fit_score', 73.1],
 ['reason', 'GOOGLE_DERIVED_REASON_CANARY'],
])('rejects a lone unproven Google %s field through the real update transport', async (field, value) => {
  const transport = jest.fn().mockResolvedValue(new Response(null, { status: 204 }))
  const db = createClient('https://db.example', 'test-key', {
    global: { fetch: venueBoundaryFetch(transport) },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  // One restricted value per request: another forbidden field cannot hide a missing fence.
  const selectedVenue = { discovery_venue_id: canary.discovery_venue_id, source: 'google_places', [String(field)]: value }
  const update = { budget_cap_cents: 220000, metadata: { shopping_list: { selected_venue: selectedVenue } } }
  const before = JSON.stringify(update)
  await expect(db.from('plans').update(update).eq('id', 'plan-one').throwOnError()).rejects.toThrow('Venue persistence')
  expect(transport).not.toHaveBeenCalled()
  expect(JSON.stringify(update)).toBe(before)
})

it.each(['lat', 'lng', 'price_hint_cents_low', 'price_hint_cents_high', 'price_hint_note'] as const)(
 'preserves independently evidenced %s through transport but rejects identical Google ancestry', async field => {
  const evidence = independentVenueEvidence('host_input', `fixture:host:${field}`)
  const value = venueFactCanaries[field]
  const safe = readSafeDiscoveryVenue({ id: canary.discovery_venue_id, source: 'google_places', [field]: value,
    metadata: { field_provenance: { [field]: evidence } } })
  const selectedVenue = { discovery_venue_id: canary.discovery_venue_id, source: 'google_places',
    [field]: value, venue_data: safe.venue_data, price_cents: 175000, consent: true }
  const transport = jest.fn().mockImplementation(async () => new Response(null, { status: 204 }))
  const guarded = venueBoundaryFetch(transport)
  const db = createClient('https://db.example', 'test-key', { global: { fetch: guarded },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
  const update = { metadata: { shopping_list: { selected_venue: selectedVenue } } }
  await expect(db.from('plans').update(update).eq('id', 'plan-one').throwOnError()).resolves.toMatchObject({ error: null })
  expect(JSON.parse(transport.mock.calls[0][1].body)).toEqual({
    metadata: { ...update.metadata, venue_content_version: 1 },
  })
  transport.mockClear()
  const google = JSON.parse(JSON.stringify(update))
  google.metadata.shopping_list.selected_venue.venue_data.field_provenance[field].source = 'google_places'
  await expect(db.from('plans').update(google).eq('id', 'plan-one').throwOnError()).rejects.toThrow()
  expect(transport).not.toHaveBeenCalled()
  expect(selectedVenue.venue_data.field_provenance[field]).toEqual(evidence)
 })

it.each([
 ['displayName', { text: 'GOOGLE_DISPLAY_CANARY' }],
 ['formattedAddress', 'GOOGLE_FORMATTED_ADDRESS_CANARY'],
 ['websiteUri', 'https://GOOGLE_WEBSITE_URI_CANARY.example'],
 ['nationalPhoneNumber', '+1 415 555 0187'],
 ['userRatingCount', 187],
 ['primaryType', 'GOOGLE_PRIMARY_TYPE_CANARY'],
 ['googleMapsUri', 'https://maps.google.com/GOOGLE_MAPS_CANARY'],
 ['attributions', [{ provider: 'GOOGLE_ATTRIBUTION_CANARY', providerUri: 'https://credit.example' }]],
 ['businessStatus', 'CLOSED_TEMPORARILY'],
 ['priceLevel', 'PRICE_LEVEL_EXPENSIVE'],
 ['location', { latitude: 37.731, longitude: -122.731 }],
])('rejects raw Google %s directly and in nested venue metadata before transport', async (field, value) => {
  for (const content of [{ [String(field)]: value }, { metadata: { provider_payload: { [String(field)]: value } } }]) {
    const transport = jest.fn().mockResolvedValue(new Response(null, { status: 204 }))
    const guarded = venueBoundaryFetch(transport)
    const body = { metadata: { selected_venue: { discovery_venue_id: canary.discovery_venue_id, source: 'google_places', ...content } } }
    await expect(guarded('https://db.example/rest/v1/plans', { method: 'PATCH', body: JSON.stringify(body) })).rejects.toThrow()
    expect(transport).not.toHaveBeenCalled()
  }
})

it.each([
 ['name', 'GOOGLE_NESTED_NAME_CANARY'],
 ['website', 'https://GOOGLE_NESTED_WEBSITE_CANARY.example'],
 ['capacity_seated', 731],
])('rejects nested venue metadata %s without independent evidence', async (field, value) => {
  const transport = jest.fn().mockResolvedValue(new Response(null, { status: 204 }))
  const row = { discovery_venue_id: canary.discovery_venue_id, source: 'google_places',
    metadata: { nested: [{ [String(field)]: value }] } }
  await expect(venueBoundaryFetch(transport)('https://db.example/rest/v1/plans', {
    method: 'PATCH', body: JSON.stringify({ metadata: { selected_venue: row } }),
  })).rejects.toThrow('Venue persistence')
  expect(transport).not.toHaveBeenCalled()
})

it('retains matching independent nested venue facts without inheriting into host, commercial or vendor contexts', async () => {
  const facts = { name: 'Independent hall', website: 'https://hall.example', capacity_seated: 60 }
  const safe = readSafeDiscoveryVenue({ id: canary.discovery_venue_id, ...facts, metadata: {
    field_provenance: Object.fromEntries(Object.keys(facts).map(field => [field, independentVenueEvidence('host_input', `fixture:${field}`)])),
  } })
  const row = { discovery_venue_id: canary.discovery_venue_id, venue_data: safe.venue_data, metadata: {
    nested: [{ ...facts }],
    plan: { neighborhood: 'Host requested Oakland', name: 'Host dinner' },
    quote_terms: { name: 'Independent quote', price_cents: 175000, capacity_seated: 50 },
    vendor: { type: 'vendor', name: 'Separate vendor', website: 'https://vendor.example', metadata: { displayName: { text: 'C2 unchanged' } } },
  } }
  const body = { metadata: { selected_venue: row } }
  const transport = jest.fn().mockImplementation(async () => json(body))
  const response = await venueBoundaryFetch(transport)('https://db.example/rest/v1/plans', { method: 'PATCH', body: JSON.stringify(body) })
  expect(JSON.parse(transport.mock.calls[0][1].body).metadata.selected_venue).toEqual(row)
  expect((await response.json()).metadata.selected_venue).toEqual(row)
  const wrong = JSON.parse(JSON.stringify(body))
  wrong.metadata.selected_venue.metadata.nested[0].name = 'GOOGLE_NESTED_NAME_CANARY'
  transport.mockClear()
  await expect(venueBoundaryFetch(transport)('https://db.example/rest/v1/plans', { method: 'PATCH', body: JSON.stringify(wrong) })).rejects.toThrow('.name')
  expect(transport).not.toHaveBeenCalled()
})

it('removes raw provider aliases from nested metadata reads without modifying the retained source', async () => {
  const { venue } = canonicalQuote()
  const row = { discovery_venue_id: venue.id, venue_data: venue.venue_data,
    metadata: { nested: [{ displayName: { text: 'GOOGLE_READ_CANARY' }, googleMapsUri: 'https://maps.google.com/GOOGLE_READ_CANARY' }] } }
  const before = JSON.stringify(row)
  const response = await venueBoundaryFetch(jest.fn().mockResolvedValue(json(row)))('https://db.example/rest/v1/plans')
  expect(JSON.stringify(await response.json())).not.toContain('GOOGLE_READ_CANARY')
  expect(JSON.stringify(row)).toBe(before)
})

it('fences RPC arguments as well as ordinary table writes',async()=>{
 const transport=jest.fn();await expect(venueBoundaryFetch(transport)('https://db.example/rest/v1/rpc/apply_plan_revision_atomic',{method:'POST',body:JSON.stringify({p_snapshot:canary})})).rejects.toThrow();expect(transport).not.toHaveBeenCalled()
})
it('projects legacy snapshots to references on reads and uses no-store end to end',async()=>{
 const transport=jest.fn().mockImplementation(async()=>json({metadata:canary}));const response=await venueBoundaryFetch(transport)('https://db.example/rest/v1/plans');
 expect(JSON.stringify(await response.json())).not.toContain('GOOGLE_CANARY');expect(transport.mock.calls[0][1].cache).toBe('no-store');expect(response.headers.get('CDN-Cache-Control')).toBe('no-store')
})
it('pauses ambiguous immutable approval snapshots instead of mutating their hash',async()=>{
 const transport=jest.fn().mockImplementation(async()=>json({snapshot_hash:'signed',snapshot_json:canary}));await expect(venueBoundaryFetch(transport)('https://db.example/rest/v1/approvals')).rejects.toThrow()
})
it('preserves independently received cents and consent in a successful transport',async()=>{
 const input={amount_cents:70000,consent:true,quote_terms:{price_cents:70000},discovery_venue_id:'venue-one'}
 const transport=jest.fn().mockImplementation(async()=>json(input));const response=await venueBoundaryFetch(transport)('https://db.example/rest/v1/venue_bookings',{method:'POST',body:JSON.stringify(input)});expect(await response.json()).toEqual(input)
})

it('never rewrites an approval snapshot returned inside an RPC response',async()=>{
 const input={approval:{snapshot_hash:'signed',snapshot_json:canary}}
 const transport=jest.fn().mockImplementation(async()=>json(input))
 await expect(venueBoundaryFetch(transport)('https://db.example/rest/v1/rpc/stage_plan_quote_booking',{method:'POST',body:'{}'})).rejects.toThrow()
})
it('rejects an unresolved field-history copy before it reaches the database',async()=>{
 const transport=jest.fn()
 await expect(venueBoundaryFetch(transport)('https://db.example/rest/v1/discovery_field_changes',{method:'POST',body:JSON.stringify({entity_type:'discovery_venue',field_name:'name',new_value:'GOOGLE_CANARY'})})).rejects.toThrow()
 expect(transport).not.toHaveBeenCalled()
})

function canonicalQuote() {
 const evidence=independentVenueEvidence('venue_site','https://example.com/events','2026-09-23T00:00:00Z')
 const venue=readSafeDiscoveryVenue({id:canary.discovery_venue_id,source_external_id:'place-one',name:'Independent hall',contact_email:'events@example.com',metadata:{venue_boundary_version:1,field_provenance:{name:evidence,contact_email:evidence}}})
 const payload={kind:'canonical_quote_booking',quote_kind:'venue',target_type:'discovery_venue',target_id:venue.id,target_name:venue.name,venue_data:venue.venue_data,price_cents:175000,quote_terms:{conditions:['72-hour cancellation'],quoted_price_cents:175000}}
 const input={plan:{event_type:'dinner',guest_count:60,budget_cap_cents:220000,neighborhood:'Host requested Oakland',date_window_start:'2026-10-03',date_window_end:'2026-10-03',ticketed:true,ticketing_model:'paid',food_responsibility:'host',profit_goal_cents:70000},approval:{action_label:'Approve booking request with Independent hall',provider:venue.name,delivery_email:venue.contact_email,requested_amount_cents:175000,price_cents:175000,notes:'The agreed rental is $1,750.'},action:{action_type:'concierge_queue',target_type:'discovery_venue',target_id:venue.id,amount_cents:175000,payload_json:payload},payload} as ApprovalSnapshotInput
 return {venue,input,record:{snapshot_json:buildApprovalSnapshotV2(input),snapshot_hash:buildApprovalSnapshotHashV2(input),snapshot_schema_version:2,consent:true}}
}

it('preserves real signed quote consent inside a legacy generated message while hiding unverified prose',async()=>{
 const {input,record}=canonicalQuote()
 const stored={id:'message-one',role:'agent',content:'UNVERIFIED_LEGACY_PROSE',metadata:{recommendation_response:JSON.stringify({approval:record})}}
 const transport=jest.fn().mockImplementation(async()=>json(stored))
 const response=await venueBoundaryFetch(transport)('https://db.example/rest/v1/plan_messages')
 const projected=await response.json()
 expect(projected.content).toBe('Earlier generated content is unavailable pending source verification.')
 expect(projected.metadata.recommendation_response).toBe(stored.metadata.recommendation_response)
 expect(JSON.parse(projected.metadata.recommendation_response).approval).toEqual(record)
 expect(approvalRequiresReapproval({...input,storedSnapshotHash:record.snapshot_hash,storedSnapshotVersion:2})).toBe(false)
 expect(stored.content).toBe('UNVERIFIED_LEGACY_PROSE')
})

it.each(['plan_messages','rpc/read_plan'])('rejects ambiguous nested signed snapshots from %s before returning them',async resource=>{
 const {record}=canonicalQuote()
 record.snapshot_json.counterparty.display_name='GOOGLE_CANARY'
 const transport=jest.fn().mockImplementation(async()=>json({metadata:{approval:record}}))
 await expect(venueBoundaryFetch(transport)(`https://db.example/rest/v1/${resource}`)).rejects.toThrow('display_name')
 expect(record.snapshot_json.counterparty.display_name).toBe('GOOGLE_CANARY')
})

it('keeps Gmail workflow state and trusted recipients through the actual table transport',async()=>{
 const {venue}=canonicalQuote()
 const thread={id:'thread-one',discovery_venue_id:venue.id,target_name:venue.name,target_email:venue.contact_email,channel:'email',state:'awaiting_reply',channel_strategy:{source:'gmail_approved_outreach',venue_data:venue.venue_data}}
 const transport=jest.fn().mockImplementation(async()=>json(thread))
 const response=await venueBoundaryFetch(transport)('https://db.example/rest/v1/outreach_threads',{method:'POST',body:JSON.stringify(thread)})
 expect(JSON.parse(transport.mock.calls[0][1].body)).toEqual(thread)
 expect(await response.json()).toEqual(thread)
})

it('versions validated new agent messages while preserving nested snapshot hashes',async()=>{
 const {record}=canonicalQuote()
 const message={role:'agent',content:'Approve the agreed rental.',metadata:{approval:record}}
 const transport=jest.fn().mockImplementation(async(_input,init)=>json(JSON.parse(init.body)))
 const request=new Request('https://db.example/rest/v1/plan_messages',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(message)})
 const response=await venueBoundaryFetch(transport)(request)
 const written=JSON.parse(transport.mock.calls[0][1].body)
 expect(written).toEqual({...message,metadata:{...message.metadata,venue_content_version:1}})
 expect(written.metadata.approval).toEqual(record)
 expect(await response.json()).toEqual(written)
 expect(await request.json()).toEqual(message)
})

it.each([
 ['rpc/apply_plan_revision_atomic','POST',{p_plan:{metadata:{},budget_cap_cents:220000}}],
 ['plans','PATCH',{status:'executing'}],
 ['plan_messages','PATCH',{metadata:{read:true}}],
])('does not bless unrelated or operational %s writes',async(resource,method,body)=>{
 const transport=jest.fn().mockImplementation(async()=>new Response(null,{status:204,headers:{'content-type':'application/json'}}))
 const response=await venueBoundaryFetch(transport)(`https://db.example/rest/v1/${resource}`,{method:method as string,body:JSON.stringify(body)})
 expect(JSON.parse(transport.mock.calls[0][1].body)).toEqual(body)
 expect(response.status).toBe(204)
})

it('allows real Stripe venue freshness through Supabase transport and keeps the invalidation cascade',async()=>{
 process.env.GOOGLE_PLACES_VENUES_ENABLED='false'
 const transport=jest.fn().mockImplementation(async(_url,init)=>json(init?.method==='POST'?{id:'change-one'}:[]))
 const guarded=venueBoundaryFetch(transport)
 const db=createClient('https://db.example','test-key',{global:{fetch:guarded},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}})
 const result=await recordStripeAccountDiscoveryFreshness({admin:db,entityType:'discovery_venue',entityId:canary.discovery_venue_id,accountId:'acct_123',eventId:'evt_123',previousStatus:'active',nextStatus:'restricted',account:{charges_enabled:false,payouts_enabled:false,capabilities:{card_payments:'inactive'},requirements:{disabled_reason:'requirements.past_due'}} as any,shouldCascade:true})
 expect(result).toEqual({inserted:true,cascaded:true})
 const write=transport.mock.calls.find(([,init])=>init?.method==='POST')
 expect(write).toBeDefined()
 const row=JSON.parse(write![1].body)
 expect(row).toMatchObject({entity_type:'discovery_venue',field_name:'stripe_connect_status',source:'stripe_account_event',old_value:'active',new_value:'restricted'})
 expect(cascadeInvalidationForEntityChange).toHaveBeenCalledWith(expect.objectContaining({entityType:'discovery_venue',changedField:'stripe_connect_status',newValue:'restricted'}))
 const reader=venueBoundaryFetch(jest.fn().mockImplementation(async()=>json({...row,id:'change-one'})))
 expect(await (await reader('https://db.example/rest/v1/discovery_change_log')).json()).toEqual({...row,id:'change-one'})

 for(const mutation of [{field_name:'name',new_value:'GOOGLE_CANARY'},{source:'google_places'},{new_value:'GOOGLE_CANARY'},{source_evidence:JSON.stringify({account_id:'acct_123',event_id:'evt_123',name:'GOOGLE_CANARY'})}]){
  transport.mockClear()
  await expect(guarded('https://db.example/rest/v1/discovery_change_log',{method:'POST',body:JSON.stringify({...row,...mutation})})).rejects.toThrow('unresolved_history')
  expect(transport).not.toHaveBeenCalled()
 }
})

it('isolates an unsafe historical approval message while retaining unrelated chat and signed consent',async()=>{
 const {record}=canonicalQuote()
 const unsafe=JSON.parse(JSON.stringify(record))
 unsafe.snapshot_json.counterparty.display_name='GOOGLE_CANARY'
 const host={id:'host-one',plan_id:'plan-one',role:'user',content:'Keep the agreed date.',message_type:'text',metadata:null,created_at:'2026-09-23T00:00:00Z'}
 const good={id:'good-one',plan_id:'plan-one',role:'agent',content:'Review the independent quote.',message_type:'approval_request',metadata:{venue_content_version:1,approval:record},created_at:'2026-09-23T00:01:00Z'}
 const bad={id:'bad-one',plan_id:'plan-one',role:'agent',content:'GOOGLE_CANARY',message_type:'approval_request',metadata:{approval:unsafe,available_actions:['approve']},created_at:'2026-09-23T00:02:00Z'}
 const rows=[host,bad,good]
 const before=JSON.stringify(rows)
 const transport=jest.fn().mockImplementation(async()=>json(rows))
 const response=await venueBoundaryFetch(transport)('https://db.example/rest/v1/plan_messages?plan_id=eq.plan-one')
 const result=await response.json()
 expect(result[0]).toEqual(host)
 expect(result[2]).toEqual(good)
 expect(result[1]).toEqual({id:bad.id,plan_id:bad.plan_id,role:bad.role,created_at:bad.created_at,content:'Earlier generated content is unavailable pending source verification.',message_type:'status_update',metadata:{venue_content_unavailable:true,reason:'source_verification_required'}})
 expect(JSON.stringify(result)).not.toContain('GOOGLE_CANARY')
 expect(response.headers.get('X-3rdPlace-Unavailable-Records')).toBe('1')
 expect(JSON.stringify(rows)).toBe(before)
})

it.each(['approvals','agent_actions','venue_bookings'])('excludes only rejected %s list rows without altering any valid signed record',async resource=>{
 const {record}=canonicalQuote()
 const valid={id:'independent-one',status:'approved',amount_cents:175000,...record}
 const bad={...JSON.parse(JSON.stringify(valid)),id:'bad-one'}
 bad.snapshot_json.counterparty.display_name='GOOGLE_CANARY'
 const badEvidence={...JSON.parse(JSON.stringify(valid)),id:'bad-evidence'}
 badEvidence.snapshot_json.action.payload_json.venue_data.field_provenance.name.source='google_places'
 const rows=[bad,valid,badEvidence]
 const before=JSON.stringify(rows)
 const response=await venueBoundaryFetch(jest.fn().mockImplementation(async()=>json(rows)))(`https://db.example/rest/v1/${resource}?plan_id=eq.plan-one`)
 expect(await response.text()).toBe(JSON.stringify([valid]))
 expect(response.headers.get('X-3rdPlace-Unavailable-Records')).toBe('2')
 expect(JSON.stringify(rows)).toBe(before)
})

it.each(['approvals?id=eq.bad-one','agent_actions?id=eq.bad-one','venue_bookings?id=eq.bad-one','rpc/read_plan'])('keeps targeted or RPC array reads fail-closed for %s',async resource=>{
 const {record}=canonicalQuote()
 record.snapshot_json.counterparty.display_name='GOOGLE_CANARY'
 const transport=jest.fn().mockImplementation(async()=>json([record]))
 await expect(venueBoundaryFetch(transport)(`https://db.example/rest/v1/${resource}`)).rejects.toThrow('display_name')
})

it('does not turn an unrelated projection failure into an unavailable record',async()=>{
 const failure=new TypeError('Unrelated parser failure')
 const row={id:'one',role:'user',content:'My event',get schema_version(){throw failure}}
 const response=json([])
 response.json=jest.fn().mockResolvedValue([row])
 const transport=jest.fn().mockResolvedValue(response)
 await expect(venueBoundaryFetch(transport)('https://db.example/rest/v1/plan_messages')).rejects.toBe(failure)
})

it('does not isolate unsafe array results from a write that already returned',async()=>{
 const {record}=canonicalQuote()
 record.snapshot_json.counterparty.display_name='GOOGLE_CANARY'
 const transport=jest.fn().mockImplementation(async()=>json([record]))
 await expect(venueBoundaryFetch(transport)('https://db.example/rest/v1/approvals',{method:'PATCH',body:JSON.stringify({status:'approved'})})).rejects.toThrow('display_name')
})
