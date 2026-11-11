import { asRecord, readFieldProvenance, retentionOrigin } from './foundation/provenance'
import { createTransientDiscovery, serializeDiscovery, type DurableDiscovery } from './foundation/boundary'
import { discoveryFieldSchemas } from './foundation/fields'

const liveKeys = new Set(['googleLive', 'google_live', 'google_live_overlays', 'vendor_google_overlay'])
const googleKeys = new Set(['google_rating', 'google_user_rating_count', 'google_price_level', 'business_status', 'place_types', 'photos', 'google_primary_type', 'displayName', 'formattedAddress', 'websiteUri', 'nationalPhoneNumber', 'userRatingCount', 'primaryType', 'googleMapsUri', 'attributions', 'businessStatus', 'priceLevel', 'location'])
const factKeys = new Set([...Object.keys(discoveryFieldSchemas.vendor), 'vendor_name', 'target_name', 'display_name', 'external_name', 'provider', 'email', 'target_email', 'delivery_email', 'contact_phone', 'address', 'rating', 'review_count', 'fit_score', 'match_score', 'reason', 'reasoning', 'notes', 'description', 'pros', 'cons'])
const independentContexts = new Set(['vendor_data', 'vendor_derivation', 'field_provenance', 'quote_terms', 'requested_terms', 'plan', 'consent'])
const derivedKeys = new Set(['fit_score', 'match_score', 'reason', 'reasoning', 'notes', 'description', 'pros', 'cons'])
export class VendorPersistenceError extends Error {
  readonly code = 'VENDOR_CONTENT_NOT_DURABLE'
  constructor(readonly path: string) { super(`Vendor persistence rejected at ${path}`); this.name = 'VendorPersistenceError' }
}
function isDiscoveryVendor(row: Record<string, unknown>) {
  return asRecord(row.identity)?.kind === 'vendor' || row.entity_type === 'discovery_vendor' || row.target_type === 'discovery_vendor'
    || typeof row.discovery_vendor_id === 'string' || typeof row.discoveryVendorId === 'string'
    || (row.source === 'discovery' && (row.kind === 'vendor' || row.type === 'vendor'))
    || Boolean(row.vendor_data || asRecord(row.metadata)?.vendor_data)
}
function readEnvelope(input: unknown): DurableDiscovery {
  const row = asRecord(input), identity = asRecord(row?.identity)
  if (row?.schema_version !== 1 || identity?.kind !== 'vendor') throw new VendorPersistenceError('vendor_data')
  if (Object.keys(row).some(key => !['schema_version', 'identity', 'values', 'field_provenance'].includes(key))
    || Object.keys(identity).some(key => !['kind', 'id', 'place_id'].includes(key))) throw new VendorPersistenceError('vendor_data.shape')
  const safe = serializeDiscovery(createTransientDiscovery({ identity: { kind: 'vendor', id: String(identity.id ?? ''), place_id: typeof identity.place_id === 'string' ? identity.place_id : null }, values: row.values, field_provenance: row.field_provenance, googleLive: row.googleLive }), 'reject')
  if (stable(row) !== stable(safe)) throw new VendorPersistenceError('vendor_data.shape')
  return safe
}
function stable(value: unknown): string {
  const ordered = (item: unknown): unknown => Array.isArray(item) ? item.map(ordered) : asRecord(item) ? Object.fromEntries(Object.entries(asRecord(item)!).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, ordered(child)])) : item
  return JSON.stringify(ordered(value))
}
function localEnvelope(row: Record<string, unknown>) {
  const value = row.vendor_data ?? asRecord(row.metadata)?.vendor_data ?? asRecord(row.payload_json)?.vendor_data ?? asRecord(row.channel_strategy)?.vendor_data
  return value == null ? null : readEnvelope(value)
}
function signedEnvelope(row: Record<string, unknown>) {
  const snapshot = asRecord(row.snapshot_json) ?? row
  const action = asRecord(snapshot.action)
  return action ? localEnvelope(action) : null
}
function immutable(row: Record<string, unknown>) {
  return row.snapshot_json != null && ('snapshot_hash' in row || 'snapshot_schema_version' in row)
    || row.schema_version === 2 && Boolean(row.approval && row.action && row.plan)
}
function keyFor(key: string) {
  if (['vendor_name', 'target_name', 'display_name', 'external_name', 'provider'].includes(key)) return 'name'
  if (['email', 'target_email', 'delivery_email'].includes(key)) return 'contact_email'
  if (key === 'contact_phone') return 'phone'
  if (key === 'address') return 'formatted_address'
  return key
}
function matchingIdentity(row: Record<string, unknown>, evidence: DurableDiscovery) {
  const id = row.discovery_vendor_id ?? row.discoveryVendorId ?? (row.target_type === 'discovery_vendor' ? row.target_id : null)
  return (id == null || id === evidence.identity.id)
    && (typeof row.source_external_id !== 'string' || evidence.identity.place_id === null || row.source_external_id === evidence.identity.place_id)
}
function independentDerivation(row: Record<string, unknown>, evidence: DurableDiscovery | null) {
  const p = readFieldProvenance(row.vendor_derivation ?? asRecord(row.metadata)?.vendor_derivation)
  return Boolean(evidence && p.resolution === 'resolved' && p.source === 'derived' && retentionOrigin(p) === 'independent' && p.lineage.length
    && p.lineage.every(parent => JSON.stringify(parent.provenance) === JSON.stringify(evidence.field_provenance[parent.field])))
}
function operational(row: Record<string, unknown>, key: string, value: unknown) {
  if (key === 'state' && row.channel === 'email') return ['draft', 'awaiting_reply', 'in_negotiation', 'confirmed', 'declined', 'stale', 'cancelled', 'awaiting_creator_review'].includes(String(value))
  if (key === 'description' && row.action_type === 'concierge_queue' && asRecord(row.payload_json)?.kind === 'canonical_quote_booking') return value === 'Prepare booking from accepted vendor quote'
  return ['name', 'target_name', 'provider'].includes(key) && value === 'Vendor contact'
}

/** Discovery-only. Independent catalog records are a separate contract. */
export function assertDurableVendorContent(input: unknown, path = '$', depth = 0, inherited: DurableDiscovery | null = null, vendorContext = false, signedMember = false): void {
  if (depth > 64) throw new VendorPersistenceError(path)
  if (typeof input === 'string' && /^\s*[\[{]/.test(input)) {
    let parsed: unknown
    try { parsed = JSON.parse(input) } catch { return }
    assertDurableVendorContent(parsed, `${path}.[serialized]`, depth + 1, inherited, vendorContext); return
  }
  if (Array.isArray(input)) { input.forEach((value, i) => assertDurableVendorContent(value, `${path}.${i}`, depth + 1, inherited, vendorContext)); return }
  const row = asRecord(input)
  if (!row) return
  for (const key of liveKeys) if (row[key] != null && (!asRecord(row[key]) || Object.keys(asRecord(row[key])!).length)) throw new VendorPersistenceError(`${path}.${key}`)
  if (row.schema_version === 1 && asRecord(row.identity)?.kind === 'vendor') { readEnvelope(row); return }
  const safe = localEnvelope(row) ?? (immutable(row) ? signedEnvelope(row) : null) ?? inherited
  const context = isDiscoveryVendor(row) || vendorContext
  if (safe && !matchingIdentity(row, safe)) throw new VendorPersistenceError(`${path}.identity`)
  const derived = independentDerivation(row, safe)
  if (context) for (const [key, value] of Object.entries(row)) {
    if (signedMember && !['provider', 'display_name', 'name', 'target_name', 'delivery_email', 'action_label'].includes(key)) continue
    if (value == null || value === '' || Array.isArray(value) && !value.length) continue
    if (googleKeys.has(key)) throw new VendorPersistenceError(`${path}.${key}`)
    if (factKeys.has(key) && !operational(row, key, value) && !(derived && derivedKeys.has(key))
      && (!safe || JSON.stringify(safe.values[keyFor(key)]) !== JSON.stringify(value))) throw new VendorPersistenceError(`${path}.${key}`)
    if (key === 'action_label' && safe && value !== `Approve booking request with ${safe.values.name}`) throw new VendorPersistenceError(`${path}.${key}`)
  }
  const signed = immutable(row) ? signedEnvelope(row) : null
  for (const [key, value] of Object.entries(row)) {
    const separate = independentContexts.has(key)
    const signedChild = signed && ['approval', 'counterparty', 'action'].includes(key)
    const carry = !separate && (key === 'metadata' || vendorContext || Boolean(signedChild))
    assertDurableVendorContent(value, `${path}.${key}`, depth + 1, carry ? safe : null, carry && (context || Boolean(signedChild)), Boolean(signedChild))
  }
}

/** Read projection only. Never rewrite a signed record or delete historical storage. */
export function readSafeVendorSnapshot<T>(input: T): T { return project(input, 0).value as T }
function project(input: unknown, depth: number, inherited: DurableDiscovery | null = null, context = false): { value: unknown; removed: boolean } {
  if (depth > 64) return { value: null, removed: true }
  if (typeof input === 'string' && /^\s*[\[{]/.test(input)) {
    let parsed: unknown
    try { parsed = JSON.parse(input) } catch { return { value: input, removed: false } }
    const result = project(parsed, depth + 1, inherited, context)
    return { value: result.removed ? JSON.stringify(result.value) : input, removed: result.removed }
  }
  if (Array.isArray(input)) { const rows = input.map(value => project(value, depth + 1, inherited, context)); return { value: rows.map(row => row.value), removed: rows.some(row => row.removed) } }
  const row = asRecord(input)
  if (!row) return { value: input, removed: false }
  if (immutable(row)) { assertDurableVendorContent(row); return { value: input, removed: false } }
  if (row.schema_version === 1 && asRecord(row.identity)?.kind === 'vendor') {
    try { return { value: readEnvelope(row), removed: false } } catch { return { value: { schema_version: 1, identity: row.identity, values: {}, field_provenance: {} }, removed: true } }
  }
  let safe = inherited, removed = false
  try { safe = localEnvelope(row) ?? inherited; if (safe && !matchingIdentity(row, safe)) safe = null } catch { safe = null; removed = true }
  const vendor = isDiscoveryVendor(row) || context, derived = independentDerivation(row, safe)
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    if (liveKeys.has(key) || vendor && googleKeys.has(key)) { removed ||= value != null; continue }
    if (vendor && factKeys.has(key)) {
      if (operational(row, key, value) || derived && derivedKeys.has(key)) result[key] = value
      else if (safe && keyFor(key) in safe.values) result[key] = safe.values[keyFor(key)]
      else { result[key] = null; removed ||= value != null }
      continue
    }
    const carry = !independentContexts.has(key) && (key === 'metadata' || context)
    const child = project(value, depth + 1, carry ? safe : null, carry && vendor)
    result[key] = child.value; removed ||= child.removed
  }
  if (removed && row.role !== 'user') for (const key of ['content', 'summary', 'message', 'raw_model_output']) if (typeof result[key] === 'string') result[key] = null
  return { value: result, removed }
}

export function withIndependentVendorDerivation<T extends object>(input: T, value: unknown): T {
  const safe = readEnvelope(value)
  const lineage = Object.entries(safe.field_provenance).map(([field, provenance]) => ({ field, provenance }))
  if (!lineage.length) throw new VendorPersistenceError('vendor_derivation.empty_lineage')
  const result = { ...input, vendor_data: safe, vendor_derivation: { resolution: 'resolved', source: 'derived', evidence_reference: `discovery_vendor:${safe.identity.id}:independent_projection`, collected_at: new Date().toISOString(), confidence: null, confirmation_status: 'unconfirmed', lineage } }
  assertDurableVendorContent(result)
  return result
}
