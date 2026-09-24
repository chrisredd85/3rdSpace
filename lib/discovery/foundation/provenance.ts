/** Gate A provenance contract, activated for venue acquisition by C1. */
export type DiscoveryFactSource = 'google_places' | 'venue_site' | 'host_input' | 'outreach_reply' | 'derived'
export type DiscoveryConfirmation = 'unconfirmed' | 'site_published' | 'venue_confirmed'

export type FieldProvenance = {
  resolution: 'resolved'
  source: DiscoveryFactSource
  /** Reference to independently acquired evidence, never the evidence body. */
  evidence_reference: string
  collected_at: string
  confidence: number | null
  confirmation_status: DiscoveryConfirmation
  /** Evidence graph contains references/provenance, never copied input values. */
  lineage: Array<{ field: string; provenance: FieldProvenance }>
} | {
  resolution: 'unresolved'
  reason: 'missing' | 'invalid' | 'unknown_lineage'
}

export type RetentionOrigin = 'independent' | 'google_derived' | 'unresolved'

const sources: readonly string[] = ['google_places', 'venue_site', 'host_input', 'outreach_reply', 'derived']
const confirmations: readonly string[] = ['unconfirmed', 'site_published', 'venue_confirmed']

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/** Strictly parse evidence; row-level source, approval and equal values are not evidence. */
export function readFieldProvenance(input: unknown, depth = 0): FieldProvenance {
  if (input === undefined || input === null) return { resolution: 'unresolved', reason: 'missing' }
  const row = asRecord(input)
  if (!row || depth > 16) return { resolution: 'unresolved', reason: 'invalid' }
  if (row.resolution === 'unresolved') {
    return {
      resolution: 'unresolved',
      reason: row.reason === 'missing' || row.reason === 'unknown_lineage' ? row.reason : 'invalid',
    }
  }
  if (
    row.resolution !== 'resolved' || typeof row.source !== 'string' || !sources.includes(row.source) ||
    !nonempty(row.evidence_reference) || !nonempty(row.collected_at) ||
    !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(row.collected_at) ||
    !Number.isFinite(Date.parse(row.collected_at)) ||
    typeof row.confirmation_status !== 'string' || !confirmations.includes(row.confirmation_status) || !Array.isArray(row.lineage) ||
    (row.confidence !== null && row.confidence !== undefined &&
      (typeof row.confidence !== 'number' || !Number.isFinite(row.confidence) || row.confidence < 0 || row.confidence > 1))
  ) return { resolution: 'unresolved', reason: 'invalid' }

  const lineage: Array<{ field: string; provenance: FieldProvenance }> = []
  for (const rawParent of row.lineage) {
    const parent = asRecord(rawParent)
    if (!parent || !nonempty(parent.field)) return { resolution: 'unresolved', reason: 'unknown_lineage' }
    lineage.push({ field: parent.field, provenance: readFieldProvenance(parent.provenance, depth + 1) })
  }
  if (row.source === 'derived' && lineage.length === 0) {
    return { resolution: 'unresolved', reason: 'unknown_lineage' }
  }
  const parsed: FieldProvenance = {
    resolution: 'resolved',
    source: row.source as DiscoveryFactSource,
    evidence_reference: row.evidence_reference,
    collected_at: row.collected_at,
    confidence: typeof row.confidence === 'number' ? row.confidence : null,
    confirmation_status: row.confirmation_status as DiscoveryConfirmation,
    lineage,
  }
  // Even a claimed venue confirmation cannot erase Google acquisition ancestry.
  if (retentionOrigin(parsed) === 'google_derived') parsed.confirmation_status = 'unconfirmed'
  return parsed
}

export function retentionOrigin(provenance: FieldProvenance): RetentionOrigin {
  if (provenance.resolution === 'unresolved') return 'unresolved'
  if (provenance.source === 'google_places') return 'google_derived'
  const origins = provenance.lineage.map(parent => retentionOrigin(parent.provenance))
  if (origins.includes('google_derived')) return 'google_derived'
  if (origins.includes('unresolved') || (provenance.source === 'derived' && origins.length === 0)) return 'unresolved'
  return 'independent'
}
