import 'server-only'

import type { DiscoveryVenueSignalType, OutreachThread } from '@/lib/types'

type OutreachSignalDb = { from(table: string): any }

/**
 * Records response-history signals for venue discovery ranking.
 */
export async function insertVenueDiscoverySignal(input: {
  db: OutreachSignalDb
  thread: Pick<OutreachThread, 'id' | 'target_type' | 'target_id' | 'target_source' | 'discovery_venue_id'>
  eventType: DiscoveryVenueSignalType
  latencySeconds?: number | null
}) {
  if (input.thread.target_type !== 'venue') return

  const targetSource = input.thread.target_source ?? 'onboarded'
  const discoveryVenueId =
    input.thread.discovery_venue_id ??
    (targetSource === 'discovery' ? input.thread.target_id : null)
  const venueId = targetSource === 'onboarded' ? input.thread.target_id : null

  if (!discoveryVenueId && !venueId) return

  const { error } = await input.db
    .from('discovery_venue_signals')
    .insert({
      discovery_venue_id: discoveryVenueId,
      venue_id: venueId,
      event_type: input.eventType,
      thread_id: input.thread.id,
      latency_seconds: input.latencySeconds ?? null,
    })

  if (error) {
    console.error('[outreach.discoverySignals] Failed to insert venue signal', error)
  }
}

export function getReplyLatencySeconds(thread: Pick<OutreachThread, 'last_outbound_at'>, receivedAt: string) {
  if (!thread.last_outbound_at) return null
  const latencyMs = Date.parse(receivedAt) - Date.parse(thread.last_outbound_at)
  if (!Number.isFinite(latencyMs) || latencyMs < 0) return null
  return Math.round(latencyMs / 1000)
}
