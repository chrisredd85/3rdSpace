import { createTransientDiscovery, serializeDiscovery, type DurableDiscovery } from './foundation/boundary'
import { discoveryFieldSchemas } from './foundation/fields'
import { asRecord, readFieldProvenance, retentionOrigin, type FieldProvenance } from './foundation/provenance'
import { readDiscoveryFields } from './foundation/reader'
import type { Database } from '@/lib/types/database-generated'

export const SAFE_VENDOR_TABLE = 'discovery_vendors_safe' as const
export const VENDOR_BOUNDARY_VERSION = 1 as const
export type SafeDiscoveryVendor = Omit<Database['public']['Tables']['discovery_vendors']['Row'], 'name' | 'service_type'> & {
  name: string | null
  service_type: string | null
  field_provenance: Record<string, FieldProvenance>
  vendor_data: DurableDiscovery
}
type Result = { data: unknown; error: { message?: string; code?: string } | null }
export type VendorRpcClient = { rpc(name: string, args: Record<string, unknown>): PromiseLike<Result> }
const arrays = ['extracted_emails', 'extracted_contact_forms'] as const
export const VENDOR_OPERATIONAL_FIELDS = new Set([
  'website_extraction_status', 'website_extraction_attempts', 'website_extraction_attempted_at',
  'rate_inference_admin_status', 'rate_inference_extracted_at', 'last_refreshed_at',
  'last_places_refresh_at', 'last_meaningful_change_at', 'data_freshness_status',
])
const identityFields = ['id', 'source', 'source_external_id', 'created_at', 'updated_at'] as const

/** Legacy values remain unavailable until field evidence exists. Approval is not origin. */
export function readSafeDiscoveryVendor(input: unknown): SafeDiscoveryVendor {
  const row = asRecord(input) ?? {}
  const evidence = asRecord(row.field_provenance) ?? {}
  const fields = readDiscoveryFields('vendor', row, evidence)
  const result: Record<string, unknown> = {}
  const values: Record<string, unknown> = {}
  const provenance: Record<string, FieldProvenance> = {}
  for (const key of identityFields) result[key] = row[key] ?? null
  if (row.source === 'google_places') {
    const candidate = typeof row.google_place_id === 'string' ? row.google_place_id : typeof row.source_external_id === 'string' ? row.source_external_id.replace(/^places\//, '') : null
    result.source_external_id = candidate && /^[a-zA-Z0-9_-]{1,255}$/.test(candidate) ? candidate : null
  }
  for (const [key, state] of Object.entries(fields)) {
    const available = state.status === 'available' && (key !== 'organizer_provided_email' || state.provenance.resolution === 'resolved' && state.provenance.source === 'host_input')
    result[key] = available ? state.value : null
    if (available) { values[key] = state.value; provenance[key] = state.provenance }
  }
  for (const key of arrays) {
    const p = readFieldProvenance(evidence[key])
    result[key] = []
    if (retentionOrigin(p) === 'independent' && p.resolution === 'resolved' && p.source === 'venue_site' && Array.isArray(row[key])) {
      try { validateVendorContacts(key, row[key]); result[key] = row[key]; provenance[key] = p } catch { /* Legacy malformed contacts are unavailable. */ }
    }
  }
  for (const key of VENDOR_OPERATIONAL_FIELDS) result[key] = row[key] ?? null
  Object.assign(result, {
    google_place_id: row.source === 'google_places' ? result.source_external_id ?? null : null,
    google_rating: null, google_user_rating_count: null, google_price_level: null,
    business_status: null, place_types: [], photos: [], website_extraction_metadata: {},
    rate_inference_confidence: null, rate_inference_source_quote: null, rate_inference_model: null,
    field_provenance: provenance,
  })
  result.vendor_data = serializeDiscovery(createTransientDiscovery({
    identity: { kind: 'vendor', id: String(row.id ?? ''), place_id: row.source === 'google_places' && typeof result.source_external_id === 'string' ? result.source_external_id : null },
    values, field_provenance: Object.fromEntries(Object.entries(provenance).filter(([key]) => key in discoveryFieldSchemas.vendor)),
  }), 'reject')
  return result as SafeDiscoveryVendor
}

/** Trusted server acquisition only; never accept browser-provided evidence labels. */
export function independentVendorEvidence(source: 'host_input' | 'venue_site' | 'outreach_reply', reference: string, collectedAt = new Date().toISOString()): FieldProvenance {
  return { resolution: 'resolved', source, evidence_reference: reference, collected_at: collectedAt, confidence: null,
    confirmation_status: source === 'venue_site' ? 'site_published' : source === 'outreach_reply' ? 'venue_confirmed' : 'unconfirmed', lineage: [] }
}

export async function upsertVendorIdentity(db: VendorRpcClient, placeId: string) {
  if (!/^[a-zA-Z0-9_-]{1,255}$/.test(placeId)) throw new Error('Invalid vendor Place ID')
  return safeResult(await db.rpc('upsert_discovery_vendor_identity', { p_place_id: placeId }))
}
export async function upsertVendorProfileIdentity(db: VendorRpcClient, profileId: string) {
  if (!/^[a-f0-9-]{36}$/i.test(profileId)) throw new Error('Invalid vendor profile ID')
  return safeResult(await db.rpc('upsert_discovery_vendor_identity', { p_vendor_profile_id: profileId }))
}

export async function writeVendorFacts(db: VendorRpcClient, id: string, values: Record<string, unknown>, provenance: Record<string, unknown>, operations: Record<string, unknown> = {}) {
  const scalars = Object.fromEntries(Object.entries(values).filter(([key]) => !(arrays as readonly string[]).includes(key)))
  serializeDiscovery(createTransientDiscovery({ identity: { kind: 'vendor', id, place_id: null }, values: scalars, field_provenance: provenance }), 'reject')
  for (const key of arrays) {
    if (!(key in values)) continue
    const evidence = readFieldProvenance(provenance[key])
    if (retentionOrigin(evidence) !== 'independent' || evidence.resolution !== 'resolved' || evidence.source !== 'venue_site') throw new Error('Independent vendor contact evidence required')
    validateVendorContacts(key, values[key])
  }
  if ('organizer_provided_email' in values) {
    const evidence = readFieldProvenance(provenance.organizer_provided_email)
    if (evidence.resolution !== 'resolved' || evidence.source !== 'host_input') throw new Error('Host evidence required for organizer contact')
  }
  for (const key of Object.keys(operations)) if (!VENDOR_OPERATIONAL_FIELDS.has(key)) throw new Error(`Unsupported vendor operation: ${key}`)
  return safeResult(await db.rpc('write_discovery_vendor_independent_facts', {
    p_vendor_id: id, p_values: values, p_field_provenance: provenance, p_operational: operations,
  }))
}
function safeResult(result: Result): { data: SafeDiscoveryVendor | null; error: Result['error'] } {
  if (result.error) return { data: null, error: { message: 'Vendor boundary operation failed', code: result.error.code } }
  return { data: result.data ? readSafeDiscoveryVendor(result.data) : null, error: null }
}
function validateVendorContacts(kind: typeof arrays[number], input: unknown): asserts input is Record<string, unknown>[] {
  if (!Array.isArray(input)) throw new Error('Invalid vendor contacts')
  const allowed = new Set(['email', 'url', 'label', 'confidence', 'source_path', 'extracted_at', 'is_likely_booking_contact', 'source', 'source_url', 'evidence_kind'])
  for (const value of input) {
    const row = asRecord(value)
    if (!row || Object.keys(row).some(key => !allowed.has(key))) throw new Error('Invalid vendor contact evidence')
    for (const key of ['email', 'url', 'label', 'source_path', 'extracted_at', 'source', 'source_url', 'evidence_kind']) {
      if (row[key] !== undefined && typeof row[key] !== 'string') throw new Error('Invalid vendor contact metadata')
    }
    if (typeof row.source_path !== 'string' || !row.source_path.startsWith('/')) throw new Error('Invalid vendor contact path')
    if (typeof row.extracted_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(row.extracted_at)) throw new Error('Invalid vendor contact time')
    if (typeof row.confidence !== 'number' || !Number.isFinite(row.confidence) || row.confidence < 0 || row.confidence > 1) throw new Error('Invalid vendor contact confidence')
    if (typeof row.is_likely_booking_contact !== 'boolean') throw new Error('Invalid vendor contact classification')
    if (row.evidence_kind !== undefined && !['observed_form', 'contact_link'].includes(String(row.evidence_kind))) throw new Error('Invalid vendor contact kind')
    if (row.source !== undefined && row.source !== 'business_website') throw new Error('Invalid vendor contact source')
    if (row.source_url !== undefined) {
      validateContactUrl(row.source_url)
    }
    if (kind === 'extracted_emails' && ('url' in row || 'label' in row || typeof row.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email))) throw new Error('Invalid vendor email')
    if (kind === 'extracted_contact_forms') {
      if ('email' in row || typeof row.label !== 'string') throw new Error('Invalid vendor contact form')
      validateContactUrl(row.url)
    }
  }
}

/** Match the SQL contact predicate, including the no-credentials constraint. */
function validateContactUrl(value: unknown): void {
  if (typeof value !== 'string' || !/^https?:\/\/[^\s]+$/.test(value)
    || /^https?:\/\/([^/?#]+)/.exec(value)?.[1].includes('@')) throw new Error('Invalid vendor contact URL')
}

export function vendorActionEnvelope(row: SafeDiscoveryVendor, email?: string): DurableDiscovery {
  const result: DurableDiscovery = { ...row.vendor_data, values: { ...row.vendor_data.values }, field_provenance: { ...row.vendor_data.field_provenance } }
  if (!email || result.values.contact_email === email) return result
  if (row.organizer_provided_email === email && retentionOrigin(readFieldProvenance(row.field_provenance.organizer_provided_email)) === 'independent') {
    result.values.contact_email = email
    result.field_provenance.contact_email = row.field_provenance.organizer_provided_email
  } else if (Array.isArray(row.extracted_emails) && row.extracted_emails.some(value => asRecord(value)?.email === email)
    && retentionOrigin(readFieldProvenance(row.field_provenance.extracted_emails)) === 'independent') {
    result.values.contact_email = email
    result.field_provenance.contact_email = row.field_provenance.extracted_emails
  }
  return result
}
