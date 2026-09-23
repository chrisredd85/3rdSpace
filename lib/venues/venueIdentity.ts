/** Stable provider identity; presentation never merges businesses or distinct rooms. */
export function venueIdentity(row: Record<string, unknown>): string | null {
  const str = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null
  const nativeId = str(row.id) ?? str(row.venue_id)
  if (row.venue_identity_kind === 'catalog' && nativeId) return `catalog:${nativeId}`
  const room = str(row.room_id)
  const claimed = str(row.claimed_venue_id)
  if (room) return `room:${claimed ?? str(row.google_place_id) ?? str(row.source_external_id) ?? ''}:${room}`
  // An explicit catalog link may unify the same independently registered partner.
  if (claimed) return `catalog:${claimed}`
  const place = str(row.google_place_id) ?? str(row.source_external_id) ?? str(row.place_id)
  if (place) return `place:${place.replace(/^places\//, '')}`
  const id = str(row.id) ?? str(row.venue_id)
  return id ? `catalog:${id}` : null
}
export function dedupeVenueIdentity<T extends object>(rows: T[]): T[] {
  const output: T[] = []
  const indexByKey = new Map<string, number>()
  for (const row of rows) {
    const record = row as Record<string, unknown>
    const key = venueIdentity(record)
    if (!key) { output.push(row); continue }
    const existingIndex = indexByKey.get(key)
    if (existingIndex === undefined) { indexByKey.set(key, output.length); output.push(row); continue }
    // A claimed discovery alias must not replace its independent catalog record.
    if (key === `catalog:${record.id}` && !record.claimed_venue_id) output[existingIndex] = row
  }
  return output
}
