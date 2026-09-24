import { readSafeDiscoveryVenue } from './venueRepository'
import { asRecord, readFieldProvenance, retentionOrigin } from './foundation/provenance'
import { createTransientDiscovery, serializeDiscovery, NonDurableDiscoveryContentError } from './foundation/boundary'
import { containsGooglePhotoData, stripGooglePhotoData } from './googlePhotoPersistence'
import { discoveryFieldSchemas } from './foundation/fields'

export const VENUE_STORAGE_VERSION = 1
const liveKeys = new Set(['googleLive', 'google_live', 'google_live_overlays', 'venue_google_overlay'])
const providerKeys = new Set(['google_rating', 'google_user_ratings_total', 'google_types', 'places_all_types', 'google_primary_type', 'places_price_level', 'google_business_status', 'business_status', 'google_photo_names', 'google_photos', 'opening_hours_json', 'photo_reference', 'displayName', 'formattedAddress', 'websiteUri', 'nationalPhoneNumber', 'userRatingCount', 'primaryType', 'googleMapsUri', 'attributions', 'businessStatus', 'priceLevel', 'location'])
const referenceKeys = new Set(['id', 'discovery_venue_id', 'place_id', 'google_place_id', 'source_external_id', 'claimed_venue_id', 'room_id', 'parent_place_id', 'plan_id', 'candidate_id', 'selected', 'dismissed_at', 'created_at', 'updated_at'])
const presentationKeys = new Set([...Object.keys(discoveryFieldSchemas.venue), 'name', 'venue_name', 'target_name', 'display_name', 'external_name', 'provider', 'address', 'formatted_address', 'neighborhood', 'city', 'state', 'email', 'target_email', 'delivery_email', 'contact_email', 'phone', 'contact_phone', 'website', 'rating', 'review_count', 'price_level', 'types', 'lat', 'lng', 'photos', 'description', 'notes', 'reason', 'reasoning', 'fit_score', 'match_score', 'event_fit_score', 'cluster_key', 'subspace_label'])
const derivedKeys = new Set(['fit_score', 'match_score', 'event_fit_score', 'reason', 'reasoning', 'notes', 'description'])
const copyTextKeys = new Set(['content', 'message', 'summary', 'notes', 'reasoning', 'raw_model_output'])
const businessKeys = new Set(['kind', 'quote_kind', 'quote_response_id', 'booking_slot', 'target_id', 'status', 'currency', 'amount_cents', 'price_cents', 'requested_amount_cents', 'authorized_amount_cents', 'event_date', 'service_type', 'quoted_deal_model', 'quote_terms', 'requested_terms', 'consent', 'route_to_admin_queue', 'execution_mode', 'requires_event_materialization', 'outbound_message_sent', 'channel', 'channel_strategy', 'state', 'needs_attention', 'follow_up_count', 'last_event_at', 'last_inbound_at', 'last_outbound_at', 'next_action_at'])

export class VenuePersistenceError extends Error {
  readonly code = 'VENUE_CONTENT_NOT_DURABLE'
  constructor(readonly path: string) { super(`Venue persistence rejected at ${path}`); this.name = 'VenuePersistenceError' }
}
function isVenueProvider(row: Record<string, unknown>): boolean {
  const identity = asRecord(row.identity)
  const venueData = asRecord(row.venue_data ?? asRecord(row.metadata)?.venue_data)
  if (asRecord(venueData?.identity)?.kind === 'venue') return true
  if (identity?.kind === 'venue' || row.entity_type === 'discovery_venue' || row.target_type === 'discovery_venue' ||
    typeof row.discovery_venue_id === 'string' || typeof row.discoveryVenueId === 'string') return true
  if (row.entity_type === 'discovery_vendor' || row.kind === 'vendor' || row.vendor_id || row.service_type) return false
  return row.source === 'google_places' || row.source === 'discovery' ||
    typeof row.google_place_id === 'string' || typeof row.place_id === 'string' ||
    (typeof row.id === 'string' && /^discovery[_:-]/.test(row.id))
}
function envelope(input: unknown) {
  const row = asRecord(input)
  const identity = asRecord(row?.identity)
  if (row?.schema_version !== 1 || identity?.kind !== 'venue') throw new VenuePersistenceError('venue_data')
  return serializeDiscovery(createTransientDiscovery({
    identity: { kind: 'venue', id: String(identity.id ?? ''), place_id: typeof identity.place_id === 'string' ? identity.place_id : null },
    values: row.values, field_provenance: row.field_provenance, googleLive: row.googleLive,
  }), 'reject')
}

type VenueEnvelope = ReturnType<typeof envelope>
type VenueMetadataContext = { safe: VenueEnvelope | null; derived: boolean }
const separateContextKeys = new Set(['venue_data', 'venue_derivation', 'field_provenance', 'plan', 'quote_terms', 'requested_terms', 'booking_slot', 'consent'])
function isVendorContext(row: Record<string, unknown>): boolean {
  return row.entity_type === 'discovery_vendor' || row.target_type === 'discovery_vendor'
    || row.kind === 'vendor' || row.type === 'vendor' || Boolean(row.vendor_id || row.service_type)
}
function childMetadataContext(key: string, provider: boolean, context: VenueMetadataContext | null, inherited: VenueMetadataContext | null) {
  // Evidence field labels, host intent and commercial terms are separate contracts.
  if (separateContextKeys.has(key)) return null
  return (provider && key === 'metadata') || inherited ? context : null
}
function localEnvelope(row: Record<string, unknown>): VenueEnvelope | null {
  // Only explicit, existing consent/thread structures carry sibling evidence.
  const input = row.venue_data ?? asRecord(row.metadata)?.venue_data ?? asRecord(row.payload_json)?.venue_data ?? asRecord(row.channel_strategy)?.venue_data
  return input == null ? null : envelope(input)
}
function snapshotEnvelope(row: Record<string, unknown>): VenueEnvelope | null {
  if (row.schema_version !== 2 || !asRecord(row.plan) || !asRecord(row.approval) || !asRecord(row.action)) return null
  return localEnvelope(asRecord(row.action)!)
}
function factKeyFor(key: string): string {
  if (['name', 'venue_name', 'target_name', 'display_name', 'external_name', 'provider'].includes(key)) return 'name'
  if (['email', 'target_email', 'delivery_email'].includes(key)) return 'contact_email'
  if (key === 'phone') return 'contact_phone'
  if (key === 'formatted_address') return 'address'
  return key
}
function isOperationalPresentation(row: Record<string, unknown>, key: string, value: unknown): boolean {
  if (key === 'state' && (row.channel === 'email' || asRecord(row.channel_strategy)?.source === 'gmail_approved_outreach')) {
    return ['draft', 'awaiting_reply', 'in_negotiation', 'confirmed', 'declined', 'stale', 'cancelled', 'awaiting_creator_review'].includes(String(value))
  }
  return key === 'description' && row.action_type === 'concierge_queue'
    && asRecord(row.payload_json)?.kind === 'canonical_quote_booking'
    && value === 'Prepare booking from accepted venue quote'
}
function assertEnvelopeIdentity(row: Record<string, unknown>, safe: VenueEnvelope, path: string) {
  const id = row.discovery_venue_id ?? row.discoveryVenueId ?? (row.target_type === 'discovery_venue' ? row.target_id : null) ?? (row.type === 'venue' ? row.reference_id : null)
  if (id != null && id !== safe.identity.id) throw new VenuePersistenceError(`${path}.venue_identity`)
  const placeId = row.place_id ?? row.google_place_id ?? row.source_external_id
  if (typeof placeId === 'string' && placeId.replace(/^places\//, '') !== safe.identity.place_id?.replace(/^places\//, '')) throw new VenuePersistenceError(`${path}.place_identity`)
}
function hasImmutableSnapshot(row: Record<string, unknown>) {
  return (row.snapshot_json != null && ('snapshot_hash' in row || 'snapshot_schema_version' in row))
    || (row.schema_version === 2 && asRecord(row.plan) !== null && asRecord(row.approval) !== null && asRecord(row.action) !== null)
}

function hasIndependentDerivation(row: Record<string, unknown>, safe: VenueEnvelope): boolean {
  const input = row.venue_derivation ?? asRecord(row.metadata)?.venue_derivation
  if (input == null) return false
  const provenance = readFieldProvenance(input)
  return provenance.resolution === 'resolved' && provenance.source === 'derived'
    && retentionOrigin(provenance) === 'independent' && provenance.lineage.length > 0
    && provenance.lineage.every(parent => parent.field in safe.field_provenance
      && JSON.stringify(parent.provenance) === JSON.stringify(safe.field_provenance[parent.field]))
}

/** Stripe account status is independently received operational state, not a place fact. */
function isStripeStatusHistory(row: Record<string, unknown>): boolean {
  if (row.entity_type !== 'discovery_venue' || row.source !== 'stripe_account_event' || row.field_name !== 'stripe_connect_status'
    || typeof row.entity_id !== 'string' || !row.entity_id || row.confidence !== 1 || row.applied !== true
    || typeof row.applied_at !== 'string' || !Number.isFinite(Date.parse(row.applied_at))) return false
  const statuses = ['pending', 'pending_onboarding', 'onboarding_started', 'capabilities_pending', 'active', 'complete', 'restricted', 'disabled']
  if (![row.old_value, row.new_value].every(value => value === null || statuses.includes(String(value)))) return false
  const keys = new Set(['entity_type', 'entity_id', 'source', 'field_name', 'old_value', 'new_value', 'confidence', 'source_evidence', 'applied', 'applied_at', 'id', 'created_at', 'actor_id', 'cascade_impact', 'review_notes', 'reviewed_by'])
  if (Object.keys(row).some(key => !keys.has(key)) || ['actor_id', 'cascade_impact', 'review_notes', 'reviewed_by'].some(key => row[key] != null)) return false
  let evidence: Record<string, unknown> | null
  try { evidence = typeof row.source_evidence === 'string' ? asRecord(JSON.parse(row.source_evidence)) : null } catch { return false }
  if (!evidence || Object.keys(evidence).some(key => !['account_id', 'event_id', 'charges_enabled', 'payouts_enabled', 'capabilities', 'requirements'].includes(key))) return false
  return typeof evidence.account_id === 'string' && /^acct_[A-Za-z0-9]+$/.test(evidence.account_id)
    && typeof evidence.event_id === 'string' && /^evt_[A-Za-z0-9]+$/.test(evidence.event_id)
    && typeof evidence.charges_enabled === 'boolean' && typeof evidence.payouts_enabled === 'boolean'
    && (evidence.capabilities === null || asRecord(evidence.capabilities) !== null)
    && (evidence.requirements === null || asRecord(evidence.requirements) !== null)
}

/** Reject mixed writes atomically. This validates structure/evidence, never guesses origin from a business name. */
export function assertDurableVenueContent(value: unknown, path = '$', depth = 0, siblingEvidence: VenueEnvelope | null = null, metadataContext: VenueMetadataContext | null = null): void {
  if (depth > 64) throw new VenuePersistenceError(path)
  if (typeof value === 'string') {
    if (/^\s*[\[{]/.test(value)) {
      let parsed: unknown
      try { parsed = JSON.parse(value) } catch { return }
      assertDurableVenueContent(parsed, `${path}.[serialized]`, depth + 1, null, metadataContext)
    }
    return
  }
  if (Array.isArray(value)) { value.forEach((item, i) => assertDurableVenueContent(item, `${path}.${i}`, depth + 1, null, metadataContext)); return }
  const row = asRecord(value)
  if (!row) return
  if (hasImmutableSnapshot(row) && containsGooglePhotoData(row)) throw new VenuePersistenceError(`${path}.immutable_photo`)
  for (const key of liveKeys) if (row[key] != null && (!asRecord(row[key]) || Object.keys(asRecord(row[key])!).length)) throw new VenuePersistenceError(`${path}.${key}`)
  if (row.schema_version === 1 && asRecord(row.identity)?.kind === 'venue') { envelope(row); return }
  if (row.entity_type === 'discovery_venue' && 'field_name' in row && !row.venue_data && !isStripeStatusHistory(row)) throw new VenuePersistenceError(`${path}.unresolved_history`)
  if (isVendorContext(row)) metadataContext = null
  const provider = isVenueProvider(row) || metadataContext !== null
  const signedEvidence = siblingEvidence ?? (hasImmutableSnapshot(row) ? snapshotEnvelope(asRecord(row.snapshot_json) ?? row) : null)
  const safe = localEnvelope(row) ?? metadataContext?.safe ?? signedEvidence
  const ownDerivation = row.venue_derivation ?? asRecord(row.metadata)?.venue_derivation
  const derived = Boolean(safe && (ownDerivation != null ? hasIndependentDerivation(row, safe) : metadataContext?.derived))
  if (provider || signedEvidence) {
    if (safe) assertEnvelopeIdentity(row, safe, path)
    if (safe && (row.venue_derivation != null || asRecord(row.metadata)?.venue_derivation != null) && !derived) throw new VenuePersistenceError(`${path}.venue_derivation`)
    for (const [key, entry] of Object.entries(row)) {
      if (!provider && !['provider', 'display_name', 'target_name', 'venue_name', 'name', 'delivery_email', 'action_label'].includes(key)) continue
      if (!provider && key === 'action_label' && entry != null && safe) {
        if (entry !== `Approve booking request with ${safe.values.name}`) throw new VenuePersistenceError(`${path}.${key}`)
        continue
      }
      if (providerKeys.has(key) && entry != null && entry !== '' && (!Array.isArray(entry) || entry.length)) throw new VenuePersistenceError(`${path}.${key}`)
      if (presentationKeys.has(key) && entry != null && entry !== '' && (!Array.isArray(entry) || entry.length)) {
        if (isOperationalPresentation(row, key, entry)) continue
        if (['Venue contact', 'Gmail'].includes(String(entry)) && ['name', 'target_name', 'provider'].includes(key)) continue
        if (derived && derivedKeys.has(key)) continue
        const factKey = factKeyFor(key)
        if (!safe || JSON.stringify(safe.values[factKey]) !== JSON.stringify(entry)) throw new VenuePersistenceError(`${path}.${key}`)
      }
    }
  }
  const snapshotEvidence = snapshotEnvelope(row)
  for (const [key, item] of Object.entries(row)) {
    // Host plan intent and quote terms do not inherit the venue's address/name context.
    const context = snapshotEvidence && ['approval', 'counterparty', 'action'].includes(key) ? snapshotEvidence : null
    assertDurableVenueContent(item, `${path}.${key}`, depth + 1, context,
      childMetadataContext(key, provider, { safe, derived }, metadataContext))
  }
}

export function serializeVenueDurable<T>(value: T): T {
  assertDurableVenueContent(value)
  return stripGooglePhotoData(value)
}

/** Legacy read projection only: old content is not deleted and cannot be copied forward. */
export function readSafeVenueSnapshot<T>(value: T): T {
  return project(value, 0).value as T
}
function project(input: unknown, depth: number, metadataContext: VenueMetadataContext | null = null): { value: unknown; removed: boolean } {
  if (depth > 64) return { value: null, removed: true }
  if (typeof input === 'string' && /^\s*[\[{]/.test(input)) {
    let decoded: unknown
    try { decoded = JSON.parse(input) } catch { return { value: input, removed: false } }
    const parsed = project(decoded, depth + 1, metadataContext)
    return parsed.removed ? { value: JSON.stringify(parsed.value), removed: true } : { value: input, removed: false }
  }
  if (Array.isArray(input)) {
    const children = input.map(item => project(item, depth + 1, metadataContext))
    return { value: children.map(child => child.value), removed: children.some(child => child.removed) }
  }
  const row = asRecord(input)
  if (!row) return { value: input, removed: false }
  if (isVendorContext(row)) metadataContext = null
  if (hasImmutableSnapshot(row)) {
    assertDurableVenueContent(row, '$', 0, null, metadataContext)
    if (containsGooglePhotoData(row)) throw new VenuePersistenceError('immutable_snapshot.photo')
    return { value: input, removed: false }
  }
  if (isStripeStatusHistory(row)) { assertDurableVenueContent(row); return { value: input, removed: false } }
  if (typeof row.id === 'string' && 'source_external_id' in row && asRecord(row.metadata)?.venue_boundary_version === 1) {
    return { value: readSafeDiscoveryVenue(row), removed: false }
  }
  if (row.schema_version === 1 && asRecord(row.identity)?.kind === 'venue') {
    try { return { value: envelope(row), removed: false } } catch { return { value: { schema_version: 1, identity: row.identity, values: {}, field_provenance: {} }, removed: true } }
  }
  let removed = false
  let safe: ReturnType<typeof envelope> | null = null
  try { safe = localEnvelope(row) ?? metadataContext?.safe ?? null; if (safe) assertEnvelopeIdentity(row, safe, '$') } catch { safe = null; removed = true }
  const provider = isVenueProvider(row) || metadataContext !== null
  const ownDerivation = row.venue_derivation ?? asRecord(row.metadata)?.venue_derivation
  const derived = Boolean(safe && (ownDerivation != null ? hasIndependentDerivation(row, safe) : metadataContext?.derived))
  const output: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    if (liveKeys.has(key) || (provider && providerKeys.has(key))) { removed ||= value != null; continue }
    if (provider && presentationKeys.has(key)) {
      const factKey = factKeyFor(key)
      if (isOperationalPresentation(row, key, value)) output[key] = value
      else if (safe && derivedKeys.has(key) && derived) output[key] = value
      else if (safe && factKey in safe.values) output[key] = safe.values[factKey]
      else if (['Venue contact', 'Gmail'].includes(String(value)) && ['name', 'target_name', 'provider'].includes(key)) output[key] = value
      else { removed ||= value != null; output[key] = null }
      continue
    }
    if (provider && key === 'metadata' && !safe) { output[key] = { venue_boundary_version: 1 }; removed ||= Object.keys(asRecord(value) ?? {}).length > 0; continue }
    const child = project(value, depth + 1, childMetadataContext(key, provider, { safe, derived }, metadataContext))
    output[key] = child.value; removed ||= child.removed
  }
  // A model's legacy prose alongside a mixed snapshot cannot be given a new origin label.
  if (removed && row.role !== 'user') for (const key of copyTextKeys) if (typeof output[key] === 'string') output[key] = null
  if (provider && !safe) {
    for (const key of Object.keys(output)) if (!referenceKeys.has(key) && !businessKeys.has(key) && !['source', 'entity_type', 'target_type', 'venue_data'].includes(key) && !presentationKeys.has(key)) delete output[key]
  }
  return { value: stripGooglePhotoData(output), removed }
}

/** Operational telemetry keeps IDs/counts/status only whenever a mixed venue payload is encountered. */
export function safeVenueTelemetry<T>(value: T): T {
  try { assertDurableVenueContent(value); return value } catch (error) {
    if (!(error instanceof VenuePersistenceError || error instanceof NonDurableDiscoveryContentError)) throw error
    const row = asRecord(value) ?? {}
    return Object.fromEntries(Object.entries(row).filter(([key, item]) =>
      /^(?:id|.*_id|status|.*_count|.*_ms|duration_ms|model|agent_name|prompt_tokens|completion_tokens)$/.test(key) &&
      (item === null || ['string', 'number', 'boolean'].includes(typeof item)))) as T
  }
}

/** Only call after computing from independent inputs; never attach this to a Google overlay. */
export function withIndependentVenueDerivation<T extends object>(value: T, input: unknown): T {
  const safe = envelope(input)
  const lineage = Object.entries(safe.field_provenance).map(([field, provenance]) => ({ field, provenance }))
  if (!lineage.length) throw new VenuePersistenceError('venue_derivation.empty_lineage')
  const result = { ...value, venue_data: safe, venue_derivation: {
    resolution: 'resolved', source: 'derived', evidence_reference: `discovery_venue:${safe.identity.id}:independent_projection`,
    collected_at: new Date().toISOString(), confidence: null, confirmation_status: 'unconfirmed', lineage,
  } }
  assertDurableVenueContent(result)
  return result
}
