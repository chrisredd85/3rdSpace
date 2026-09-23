import { readSafeVenueSnapshot, serializeVenueDurable, VENUE_STORAGE_VERSION } from './venuePersistence'
import { asRecord } from './foundation/provenance'

export function serializePlannerStorage<T extends object>(input: T): T & { venue_storage_version: number } {
  return { ...serializeVenueDurable(input), venue_storage_version: VENUE_STORAGE_VERSION }
}
export function readPlannerStorage<T>(input: T): T {
  const safe = readSafeVenueSnapshot(input)
  const row = asRecord(safe)
  if (!row || row.venue_storage_version === VENUE_STORAGE_VERSION) return safe
  // Older browser blobs lack an acquisition contract. Restore intent and IDs,
  // then reload server truth; never give their agent prose a new origin label.
  if (Array.isArray(row.messages)) row.messages = row.messages.filter(message => asRecord(message)?.role === 'user')
  const plan = asRecord(row.plan)
  if (plan) {
    for (const key of ['agent_cache', 'recommendation_response', 'ranked_venues', 'venue_options']) delete plan[key]
    const metadata = asRecord(plan.metadata)
    if (metadata) for (const key of ['agent_cache', 'recommendation_response', 'shopping_list']) delete metadata[key]
  }
  return safe
}
