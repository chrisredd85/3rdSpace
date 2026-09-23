import { discoveryFieldSchemas, type DiscoveryKind, type DiscoveryValue } from './fields'
import { asRecord, readFieldProvenance, retentionOrigin, type FieldProvenance } from './provenance'

export type DiscoveryFieldState = {
  status: 'available'
  value: DiscoveryValue
  provenance: FieldProvenance
} | {
  status: 'unavailable'
  reason: 'missing' | 'invalid' | 'unresolved' | 'google_content'
}

/**
 * Dormant adapter over existing columns plus a separately supplied provenance map.
 * Legacy rows need no new database column. Missing evidence is explicitly unresolved;
 * source='google_places', approved status and equal values never reclassify a fact.
 */
export function readDiscoveryFields(
  kind: DiscoveryKind,
  input: unknown,
  fieldProvenance: unknown = undefined,
): Record<string, DiscoveryFieldState> {
  const row = asRecord(input) ?? {}
  const evidence = asRecord(fieldProvenance) ?? {}
  const fields: Record<string, DiscoveryFieldState> = {}
  for (const [field, schema] of Object.entries(discoveryFieldSchemas[kind])) {
    const value = row[field]
    if (value === null || value === undefined || value === '') {
      fields[field] = { status: 'unavailable', reason: 'missing' }
      continue
    }
    const parsed = schema.safeParse(value)
    if (!parsed.success) {
      fields[field] = { status: 'unavailable', reason: 'invalid' }
      continue
    }
    const provenance = readFieldProvenance(evidence[field])
    const origin = retentionOrigin(provenance)
    fields[field] = origin === 'independent'
      ? { status: 'available', value: parsed.data, provenance }
      : { status: 'unavailable', reason: origin === 'google_derived' ? 'google_content' : 'unresolved' }
  }
  return fields
}
