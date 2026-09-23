import { createTransientDiscovery, serializeDiscovery, type DurableDiscovery } from './foundation/boundary'
import { discoveryFieldSchemas } from './foundation/fields'
import { asRecord, readFieldProvenance, retentionOrigin, type FieldProvenance } from './foundation/provenance'
import { readDiscoveryFields } from './foundation/reader'
import type { Database, Json } from '@/lib/types/database-generated'

export const VENUE_BOUNDARY_VERSION = 1 as const
export const SAFE_VENUE_TABLE = 'discovery_venues_safe' as const
export type SafeDiscoveryVenue = Omit<Database['public']['Tables']['discovery_venues']['Row'], 'name' | 'city' | 'state'> & {
  name: string | null; city: string | null; state: string | null
  venue_data: DurableDiscovery
}
type Result = { data: unknown; error: { message?: string; code?: string } | null }
export type VenueRpcClient = { rpc(name: string, args: Record<string, unknown>): PromiseLike<Result> }
const arrays = ['extracted_emails', 'extracted_contact_forms', 'organizer_provided_emails'] as const
const operational = new Set([
  'website_extraction_status', 'website_extraction_attempts', 'website_extraction_attempted_at',
  'last_enriched_at', 'last_verified_at', 'organizer_rescue_count', 'last_rescue_at',
  'capacity_inference_admin_status', 'capacity_inference_extracted_at',
])
const identityFields = ['id', 'source_external_id', 'claimed_venue_id', 'is_claimed', 'created_at', 'updated_at']

/** Compatible safe read. Row-level source or organizer approval never supplies field evidence. */
export function readSafeDiscoveryVenue(input: unknown): SafeDiscoveryVenue {
  const row = asRecord(input) ?? {}
  const metadata = asRecord(row.metadata) ?? {}
  const evidence = asRecord(metadata.field_provenance) ?? {}
  const fields = readDiscoveryFields('venue', row, evidence)
  const values: Record<string, unknown> = {}
  const provenance: Record<string, FieldProvenance> = {}
  const result: Record<string, unknown> = {}
  for (const key of identityFields) result[key] = row[key] ?? null
  if (typeof result.source_external_id === 'string') result.source_external_id = result.source_external_id.replace(/^places\//, '')
  result.source = row.source === 'google_places' ? 'google_places' : row.source ?? 'unknown'
  for (const [key, state] of Object.entries(fields)) {
    result[key] = state.status === 'available' ? state.value : null
    if (state.status === 'available') { values[key] = state.value; provenance[key] = state.provenance }
  }
  for (const key of arrays) {
    const p = readFieldProvenance(evidence[key])
    result[key] = retentionOrigin(p) === 'independent' && Array.isArray(row[key]) ? row[key] : []
    if (retentionOrigin(p) === 'independent') provenance[key] = p
  }
  for (const key of operational) result[key] = row[key] ?? null
  // Provider presentation and derived facts are never restored from legacy rows.
  Object.assign(result, {
    google_rating: null, google_user_ratings_total: null, business_status: null,
    google_photo_names: [], photos: [], opening_hours_json: {}, website_extraction_metadata: {},
    capacity_inference_confidence: null, capacity_inference_model: null, capacity_inference_source_quote: null,
    last_meaningful_change_at: null, last_places_refresh_at: null, data_freshness_status: 'unknown',
    metadata: { venue_boundary_version: VENUE_BOUNDARY_VERSION, field_provenance: provenance },
  })
  const scalarEvidence = Object.fromEntries(Object.entries(provenance).filter(([key]) => key in discoveryFieldSchemas.venue))
  result.venue_data = serializeDiscovery(createTransientDiscovery({
    identity: { kind: 'venue', id: String(row.id ?? ''), place_id: typeof result.source_external_id === 'string' ? result.source_external_id : null },
    values, field_provenance: scalarEvidence,
  }), 'reject')
  return result as SafeDiscoveryVenue
}

/** The caller must be a trusted acquisition path, never a browser-submitted provenance map. */
export function independentVenueEvidence(source: 'host_input' | 'venue_site' | 'outreach_reply', reference: string, collectedAt = new Date().toISOString()): FieldProvenance {
  return { resolution: 'resolved', source, evidence_reference: reference, collected_at: collectedAt,
    confidence: null, confirmation_status: source === 'venue_site' ? 'site_published' : source === 'outreach_reply' ? 'venue_confirmed' : 'unconfirmed', lineage: [] }
}

export async function upsertVenueIdentity(db: VenueRpcClient, placeId: string) {
  if (!placeId.trim() || /[\s/]/.test(placeId)) throw new Error('Invalid venue Place ID')
  return safeResult(await db.rpc('upsert_discovery_venue_identity', { p_place_id: placeId }))
}

export async function writeVenueFacts(db: VenueRpcClient, id: string, values: Record<string, unknown>, provenance: Record<string, unknown>, operations: Record<string, unknown> = {}) {
  const scalars = Object.fromEntries(Object.entries(values).filter(([key]) => !(arrays as readonly string[]).includes(key)))
  serializeDiscovery(createTransientDiscovery({ identity: { kind: 'venue', id, place_id: null }, values: scalars, field_provenance: provenance }), 'reject')
  for (const key of arrays) {
    if (!(key in values)) continue
    if (!Array.isArray(values[key]) || retentionOrigin(readFieldProvenance(provenance[key])) !== 'independent') throw new Error(`Independent venue evidence required: ${key}`)
    validateContactArray(key, values[key] as unknown[])
  }
  for (const key of Object.keys(operations)) if (!operational.has(key)) throw new Error(`Unsupported venue operation: ${key}`)
  return safeResult(await db.rpc('write_discovery_venue_independent_facts', {
    p_venue_id: id, p_values: values as Json, p_field_provenance: provenance as Json, p_operational: operations as Json,
  }))
}
function safeResult(result: Result): { data: SafeDiscoveryVenue | null; error: Result['error'] } {
  if (result.error) return { data: null, error: { message: 'Venue boundary operation failed', code: result.error.code } }
  return { data: result.data ? readSafeDiscoveryVenue(result.data) : null, error: null }
}
function validateContactArray(kind: typeof arrays[number], items: unknown[]) {
  const allowed = kind === 'organizer_provided_emails'
    ? ['email', 'provided_by_user_id', 'provided_at', 'source']
    : ['email', 'url', 'label', 'confidence', 'source_path', 'extracted_at', 'is_likely_booking_contact', 'source', 'source_url', 'evidence_kind']
  for (const item of items) {
    const record = asRecord(item)
    if (!record || Object.keys(record).some(key => !allowed.includes(key))) throw new Error('Invalid venue contact evidence')
  }
}

/** A trusted safe row can supply an action's selected contact without copying any Google presentation. */
export function venueActionEnvelope(row: SafeDiscoveryVenue, email?: string): DurableDiscovery {
  const result: DurableDiscovery = { ...row.venue_data, values: { ...row.venue_data.values }, field_provenance: { ...row.venue_data.field_provenance } }
  if (email && result.values.contact_email !== email) {
    const evidence = asRecord(asRecord(row.metadata)?.field_provenance) ?? {}
    for (const key of ['organizer_provided_emails', 'extracted_emails'] as const) {
      const contacts = Array.isArray(row[key]) ? row[key] : []
      if (contacts.some(entry => asRecord(entry)?.email === email) && retentionOrigin(readFieldProvenance(evidence[key])) === 'independent') {
        result.values.contact_email = email
        result.field_provenance.contact_email = readFieldProvenance(evidence[key])
        break
      }
    }
  }
  return result
}
