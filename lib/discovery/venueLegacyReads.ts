import { asRecord } from './foundation/provenance'

export const VENUE_CONTENT_VERSION = 1
const generatedKeys = ['agent_cache', 'shopping_list', 'ranked_venues', 'venue_options', 'recommendations', 'recommendation_response', 'timeline', 'workspace_summary']

/** Called only after immutable snapshots have passed preserve-or-reject validation.
 * Unmarked generated prose has no provable origin; never feed it back into models.
 * Historical rows are not edited. Host input and commercial/consent records remain.
 */
export function readLegacyVenueContent(resource: string | undefined, input: unknown): unknown {
  if (Array.isArray(input)) return input.map(row => readLegacyVenueContent(resource, row))
  const row = asRecord(input)
  if (['templates', 'event_templates', 'template_runs'].includes(resource ?? '')) return readTemplateVenueReferences(input)
  if (!row || !['plans', 'plan_messages'].includes(resource ?? '')) return input
  const metadata = asRecord(row.metadata) ?? {}
  if (metadata.venue_content_version === VENUE_CONTENT_VERSION) return input
  const safeMetadata = { ...metadata }
  for (const key of generatedKeys) {
    // A signed record is already validated above and must remain byte-for-byte
    // unchanged. Removing it here could hide consent that an action still uses.
    if (!containsSignedSnapshot(safeMetadata[key])) delete safeMetadata[key]
  }
  if (resource === 'plan_messages' && row.role === 'user') return input
  return {
    ...row,
    metadata: safeMetadata,
    ...(resource === 'plan_messages' && typeof row.content === 'string'
      ? { content: 'Earlier generated content is unavailable pending source verification.' }
      : {}),
  }
}

/** New application writes only; invoke after reject validation, never on old reads. */
export function versionVenueContentWrite(resource: string | undefined, input: unknown): unknown {
  if (Array.isArray(input)) return input.map(row => versionVenueContentWrite(resource, row))
  const row = asRecord(input)
  if (!row || !['plans', 'plan_messages'].includes(resource ?? '')) return input
  // An operational PATCH without metadata cannot bless an existing generated cache.
  if (!('metadata' in row) && resource !== 'plan_messages') return input
  if (resource === 'plan_messages' && row.role !== 'agent' && row.role !== 'system') return input
  return { ...row, metadata: { ...(asRecord(row.metadata) ?? {}), venue_content_version: VENUE_CONTENT_VERSION } }
}

function containsSignedSnapshot(input: unknown, depth = 0): boolean {
  if (depth > 64) return true
  if (typeof input === 'string' && /^\s*[\[{]/.test(input)) {
    let parsed: unknown
    try { parsed = JSON.parse(input) } catch { return false }
    return containsSignedSnapshot(parsed, depth + 1)
  }
  if (Array.isArray(input)) return input.some(value => containsSignedSnapshot(value, depth + 1))
  const row = asRecord(input)
  if (!row) return false
  if ('snapshot_hash' in row || ('schema_version' in row && 'approval' in row && 'action' in row)) return true
  return Object.values(row).some(value => containsSignedSnapshot(value, depth + 1))
}

/** Legacy templates retain rebook IDs and commercial facts, never an unproved
 * discovery label. New evidence-bearing entries were validated by the caller.
 */
function readTemplateVenueReferences(input: unknown, selectedVenue = false, depth = 0): unknown {
  if (depth > 64) return null
  if (Array.isArray(input)) return input.map(value => readTemplateVenueReferences(value, false, depth + 1))
  const row = asRecord(input)
  if (!row) return input
  if ('snapshot_hash' in row || ('schema_version' in row && 'approval' in row && 'action' in row)) return input
  const isVenue = selectedVenue || row.type === 'venue' || row.target_type === 'venue'
  const evidence = asRecord(row.venue_data) ?? asRecord(asRecord(row.metadata)?.venue_data)
  const safe = Object.fromEntries(Object.entries(row).map(([key, value]) => [key,
    readTemplateVenueReferences(value, key === 'selected_venue', depth + 1),
  ]))
  if (isVenue && !evidence) {
    for (const key of ['external_name', 'name', 'reason', 'fit_score', 'fit_reason', 'address', 'website', 'google_rating', 'google_user_ratings_total', 'google_photo_names']) delete safe[key]
  }
  return safe
}
