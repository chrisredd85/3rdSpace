import 'server-only'

import type { DiscoveryEntityType } from '@/lib/discovery/cascadeInvalidation'

export type DiscoveryNotificationDbClient = {
  from: (table: string) => any
}

export async function recordDiscoveryNotificationIfAllowed(input: {
  db: DiscoveryNotificationDbClient
  userId: string
  entityType: DiscoveryEntityType
  entityId: string
  source: string
  notificationType: string
  now?: Date
}) {
  const now = input.now ?? new Date()
  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()

  const { data: recent, error: recentError } = await input.db
    .from('discovery_notification_log')
    .select('id')
    .eq('user_id', input.userId)
    .eq('entity_type', input.entityType)
    .eq('entity_id', input.entityId)
    .eq('source', input.source)
    .eq('notification_type', input.notificationType)
    .gt('sent_at', cutoff)
    .limit(1)

  if (recentError) {
    console.error('[discovery.freshness] notification_rate_limit_lookup_failed', recentError)
    return false
  }

  if (Array.isArray(recent) && recent.length > 0) return false

  const { error } = await input.db.from('discovery_notification_log').insert({
    user_id: input.userId,
    entity_type: input.entityType,
    entity_id: input.entityId,
    source: input.source,
    notification_type: input.notificationType,
    sent_at: now.toISOString(),
  })

  if (error) {
    console.error('[discovery.freshness] notification_rate_limit_insert_failed', error)
    return false
  }

  return true
}
