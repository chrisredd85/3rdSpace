import { asRecord } from '@/lib/discovery/foundation/provenance'

/** Operational retirement marker, not provenance or a ban on the venue identity. */
export function isUnavailableRecommendation(input: unknown): boolean {
  const metadata = asRecord(asRecord(input)?.metadata)
  return metadata?.venue_content_unavailable === true
    && metadata.unavailable_code === 'legacy_discovery_evidence_missing'
}

/** GET-only projection. Never apply this to a committed mutation receipt. */
export function readRecommendationAvailability(input: unknown): unknown {
  if (!isUnavailableRecommendation(input)) return input
  const row = asRecord(input)!
  return {
    id: row.id,
    plan_id: row.plan_id,
    type: row.type,
    reference_id: row.reference_id,
    // Transient read status only; the persisted lifecycle is not changed here.
    status: 'unavailable',
    metadata: {
      venue_content_unavailable: true,
      unavailable_code: 'legacy_discovery_evidence_missing',
    },
  }
}
