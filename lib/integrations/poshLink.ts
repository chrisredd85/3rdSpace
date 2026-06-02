import 'server-only'

import { seedPlatformServiceFeeTermForEvent, seedPlatformServiceFeeTermsForOrg } from '@/lib/finance/revenueTerms'
import { encryptSecret } from '@/lib/server/token-crypto'
import { tryUpsertProviderConnection } from '@/lib/server/provider-connections'

type SupabaseLike = {
  from: (table: string) => QueryBuilder
}

type QueryResult = {
  data: unknown
  error: QueryError | null
}

type QueryBuilder = PromiseLike<QueryResult> & {
  select: (columns?: string) => QueryBuilder
  eq: (column: string, value: unknown) => QueryBuilder
  is?: (column: string, value: unknown) => QueryBuilder
  in: (column: string, values: unknown[]) => QueryBuilder
  order: (column: string, options?: Record<string, unknown>) => QueryBuilder
  limit: (count: number) => QueryBuilder
  maybeSingle: () => Promise<QueryResult>
  single: () => Promise<QueryResult>
  insert: (values: unknown) => QueryBuilder
  upsert: (values: unknown, options?: Record<string, unknown>) => QueryBuilder
  update: (values: unknown) => QueryBuilder
}

type QueryError = {
  message?: string
}

export type PoshConnectionStatus = 'not_connected' | 'awaiting_test' | 'connected'

export type PoshConnectionState = {
  orgId: string
  status: PoshConnectionStatus
  webhookUrl: string
  lastEventReceivedAt: string | null
  lastWebhookEventType: string | null
  unlinkedEvents: PoshUnlinkedTicketEvent[]
  events: PoshEventOption[]
}

export type PoshUnlinkedTicketEvent = {
  id: string
  external_event_id: string
  webhook_type: string | null
  received_at: string
  linked_event_id: string | null
  payload_preview: Record<string, unknown>
}

export type PoshEventOption = {
  id: string
  event_name: string
  event_date: string | null
  posh_event_id: string | null
}

export type PoshEventLink = {
  eventId: string | null
  integrationId: string | null
  builderId: string | null
}

const POSH_PLATFORM = 'posh'
const DEFAULT_POSH_WEBHOOK_ORIGIN = 'https://www.3rdplace.io'

export function buildPoshWebhookUrl(builderId: string) {
  const url = new URL('/api/webhooks/posh', DEFAULT_POSH_WEBHOOK_ORIGIN)
  url.searchParams.set('integration', builderId)
  return url.toString()
}

export async function loadPoshConnectionState(
  db: SupabaseLike,
  builderId: string
): Promise<PoshConnectionState> {
  const [connection, events, unlinkedEvents] = await Promise.all([
    loadBuilderPoshConnection(db, builderId),
    loadBuilderEvents(db, builderId),
    loadUnlinkedTicketEvents(db, builderId),
  ])

  return {
    orgId: builderId,
    status: normalizeStatus(readString(connection?.status), readString(connection?.webhook_secret_encrypted)),
    webhookUrl: buildPoshWebhookUrl(builderId),
    lastEventReceivedAt: readString(connection?.last_webhook_received_at) ?? readString(connection?.last_connected_at),
    lastWebhookEventType: readString(connection?.last_webhook_event_type),
    events,
    unlinkedEvents,
  }
}

export async function savePoshSecret(input: {
  db: SupabaseLike
  userId: string
  builderId: string
  secret: string
}) {
  const encryptedSecret = encryptSecret(input.secret.trim())
  const webhookUrl = buildPoshWebhookUrl(input.builderId)
  const existing = await loadBuilderPoshConnection(input.db, input.builderId)
  const config = {
    ...readRecord(existing?.config),
    has_webhook_secret: true,
    posh_org_integration_id: input.builderId,
    posh_webhook_url: webhookUrl,
  }

  const { data, error } = await input.db
    .from('builder_ticketing_connections')
    .upsert(
      {
        builder_id: input.builderId,
        platform: POSH_PLATFORM,
        status: 'awaiting_test',
        webhook_url: webhookUrl,
        webhook_secret_encrypted: encryptedSecret,
        config,
        last_error: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'builder_id,platform' }
    )
    .select?.('id, platform, status, webhook_url, last_connected_at, last_webhook_received_at, last_webhook_event_type, config')
    .single?.() ?? { data: null, error: { message: 'Invalid Posh connection query' } }

  if (error) throw new Error(error.message ?? 'Failed to save Posh connection')

  await tryUpsertProviderConnection(input.db as never, {
    userId: input.userId,
    builderId: input.builderId,
    provider: POSH_PLATFORM,
    status: 'pending',
    encryptedCredentials: { webhook_secret: encryptedSecret },
    externalAccountId: input.builderId,
    webhookUrl,
    config,
  })

  await seedPlatformServiceFeeTermsForOrg({
    supabase: input.db,
    orgId: input.builderId,
    platform: POSH_PLATFORM,
  })

  return data
}

export async function disconnectPosh(input: {
  db: SupabaseLike
  userId: string
  builderId: string
}) {
  const now = new Date().toISOString()
  const { data, error } = await input.db
    .from('builder_ticketing_connections')
    .update({
      status: 'not_connected',
      webhook_secret_encrypted: null,
      last_connected_at: null,
      last_webhook_received_at: null,
      last_webhook_event_type: null,
      webhook_url: buildPoshWebhookUrl(input.builderId),
      config: {
        has_webhook_secret: false,
        posh_org_integration_id: input.builderId,
      },
      updated_at: now,
    })
    .eq?.('builder_id', input.builderId)
    .eq?.('platform', POSH_PLATFORM)
    .select?.('id, platform, status, webhook_url, last_connected_at, last_webhook_received_at, last_webhook_event_type, config')
    .maybeSingle?.() ?? { data: null, error: { message: 'Invalid Posh disconnect query' } }

  if (error) throw new Error(error.message ?? 'Failed to disconnect Posh')

  await tryUpsertProviderConnection(input.db as never, {
    userId: input.userId,
    builderId: input.builderId,
    provider: POSH_PLATFORM,
    status: 'disabled',
    encryptedCredentials: {},
    externalAccountId: input.builderId,
    webhookUrl: buildPoshWebhookUrl(input.builderId),
    config: { has_webhook_secret: false },
  })

  return data
}

export async function linkPoshEvent(input: {
  db: SupabaseLike
  builderId: string
  eventId: string
  poshEventId: string
}) {
  const poshEventId = input.poshEventId.trim()
  if (!poshEventId) throw new Error('Missing Posh event id')

  const { data: event, error: eventError } = await input.db
    .from('events')
    .select?.('id, builder_id, event_name')
    .eq?.('id', input.eventId)
    .eq?.('builder_id', input.builderId)
    .maybeSingle?.() ?? { data: null, error: { message: 'Invalid event lookup query' } }

  if (eventError) throw new Error(eventError.message ?? 'Failed to verify event')
  if (!event) throw new Error('Event not found')

  const now = new Date().toISOString()
  const { error: updateError } = await input.db
    .from('events')
    .update?.({
      posh_event_id: poshEventId,
      updated_at: now,
    })
    .eq?.('id', input.eventId) ?? { error: { message: 'Invalid event update query' } }

  if (updateError) throw new Error(updateError.message ?? 'Failed to link Posh event')

  await input.db
    .from('external_event_integrations')
    .upsert?.(
      {
        event_id: input.eventId,
        platform: POSH_PLATFORM,
        external_event_id: poshEventId,
        external_event_url: null,
        is_active: true,
        sync_status: 'linked',
        last_sync_status: 'linked',
        config: {
          linked_from: 'posh_connect_wizard',
          builder_id: input.builderId,
        },
        updated_at: now,
      },
      { onConflict: 'event_id,platform' }
    )

  await input.db
    .from('unlinked_ticket_events')
    .update?.({
      linked_event_id: input.eventId,
      linked_at: now,
      updated_at: now,
    })
    .eq?.('builder_id', input.builderId)
    .eq?.('platform', POSH_PLATFORM)
    .eq?.('external_event_id', poshEventId)

  await seedPlatformServiceFeeTermForEvent({
    supabase: input.db,
    orgId: input.builderId,
    eventId: input.eventId,
    platform: POSH_PLATFORM,
  })

  return loadPoshConnectionState(input.db, input.builderId)
}

export async function resolvePoshEventLink(input: {
  db: SupabaseLike
  builderId: string | null
  poshEventId: string | null
}): Promise<PoshEventLink> {
  if (!input.poshEventId) {
    return { eventId: null, integrationId: null, builderId: input.builderId }
  }

  let eventQuery = input.db
    .from('events')
    .select?.('id, builder_id, posh_event_id')
    .eq?.('posh_event_id', input.poshEventId)

  if (input.builderId && eventQuery?.eq) {
    eventQuery = eventQuery.eq('builder_id', input.builderId)
  }

  const { data: event, error: eventError } = await eventQuery
    ?.limit?.(1)
    .maybeSingle?.() ?? { data: null, error: null }

  if (eventError) throw new Error(eventError.message ?? 'Failed to resolve Posh event link')
  const eventRecord = readRecord(event)
  const eventId = readString(eventRecord?.id)
  const builderId = readString(eventRecord?.builder_id) ?? input.builderId
  if (!eventId) return { eventId: null, integrationId: null, builderId }

  const { data: integration, error: integrationError } = await input.db
    .from('external_event_integrations')
    .select?.('id')
    .eq?.('event_id', eventId)
    .eq?.('platform', POSH_PLATFORM)
    .limit?.(1)
    .maybeSingle?.() ?? { data: null, error: null }

  if (integrationError) throw new Error(integrationError.message ?? 'Failed to resolve Posh integration link')

  return {
    eventId,
    builderId,
    integrationId: readString(readRecord(integration)?.id),
  }
}

export async function markPoshHeartbeat(input: {
  db: SupabaseLike
  builderId: string | null
  webhookType: string | null
  receivedAt?: string
}) {
  if (!input.builderId) return

  const now = input.receivedAt ?? new Date().toISOString()
  const existing = await loadBuilderPoshConnection(input.db, input.builderId)
  const config = {
    ...readRecord(existing?.config),
    posh_last_seen_at: now,
    posh_last_event_type: input.webhookType,
  }

  const { error } = await input.db
    .from('builder_ticketing_connections')
    .upsert?.(
      {
        builder_id: input.builderId,
        platform: POSH_PLATFORM,
        status: 'connected',
        webhook_url: buildPoshWebhookUrl(input.builderId),
        last_connected_at: now,
        last_webhook_received_at: now,
        last_webhook_event_type: input.webhookType,
        config,
        updated_at: now,
      },
      { onConflict: 'builder_id,platform' }
    ) ?? { error: { message: 'Invalid heartbeat query' } }

  if (error) throw new Error(error.message ?? 'Failed to update Posh heartbeat')
}

export async function quarantineUnlinkedPoshEvent(input: {
  db: SupabaseLike
  builderId: string | null
  poshEventId: string | null
  webhookEventId: string | null
  webhookType: string | null
  payload: Record<string, unknown>
  receivedAt?: string
}) {
  if (!input.builderId || !input.poshEventId) return null

  const row = {
    builder_id: input.builderId,
    platform: POSH_PLATFORM,
    external_event_id: input.poshEventId,
    webhook_event_id: input.webhookEventId,
    webhook_type: input.webhookType,
    payload: input.payload,
    received_at: input.receivedAt ?? new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }

  const query = input.webhookEventId
    ? input.db.from('unlinked_ticket_events').upsert?.(row, { onConflict: 'platform,builder_id,webhook_event_id' })
    : input.db.from('unlinked_ticket_events').insert?.(row)

  const { data, error } = await query?.select?.('id').maybeSingle?.() ?? { data: null, error: null }
  if (error) throw new Error(error.message ?? 'Failed to quarantine unlinked Posh event')
  return data
}

async function loadBuilderPoshConnection(db: SupabaseLike, builderId: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await db
    .from('builder_ticketing_connections')
    .select?.('id, status, webhook_url, webhook_secret_encrypted, config, last_connected_at, last_webhook_received_at, last_webhook_event_type')
    .eq?.('builder_id', builderId)
    .eq?.('platform', POSH_PLATFORM)
    .maybeSingle?.() ?? { data: null, error: null }

  if (error) throw new Error(error.message ?? 'Failed to load Posh connection')
  return readRecord(data)
}

async function loadBuilderEvents(db: SupabaseLike, builderId: string): Promise<PoshEventOption[]> {
  const { data, error } = await db
    .from('events')
    .select?.('id, event_name, event_date, posh_event_id')
    .eq?.('builder_id', builderId)
    .order?.('event_date', { ascending: false })
    .limit?.(50) ?? { data: null, error: null }

  if (error) throw new Error(error.message ?? 'Failed to load builder events')
  return ((data ?? []) as Array<Record<string, unknown>>).map((event) => ({
    id: String(event.id),
    event_name: readString(event.event_name) ?? 'Untitled event',
    event_date: readString(event.event_date),
    posh_event_id: readString(event.posh_event_id),
  }))
}

async function loadUnlinkedTicketEvents(db: SupabaseLike, builderId: string): Promise<PoshUnlinkedTicketEvent[]> {
  let query = db
    .from('unlinked_ticket_events')
    .select('id, external_event_id, webhook_type, received_at, linked_event_id, payload')
    .eq('builder_id', builderId)
    .eq('platform', POSH_PLATFORM)

  if (typeof query.is === 'function') {
    query = query.is('linked_event_id', null)
  }

  const { data, error } = await query
    .order('received_at', { ascending: false })
    .limit(25)

  if (error) throw new Error(error.message ?? 'Failed to load unlinked Posh events')
  return ((data ?? []) as Array<Record<string, unknown>>)
    .filter((row) => readString(row.linked_event_id) === null)
    .map((row) => ({
      id: String(row.id),
      external_event_id: readString(row.external_event_id) ?? '',
      webhook_type: readString(row.webhook_type),
      received_at: readString(row.received_at) ?? new Date().toISOString(),
      linked_event_id: readString(row.linked_event_id),
      payload_preview: previewPayload(readRecord(row.payload)),
    }))
}

function normalizeStatus(status: string | null, encryptedSecret: string | null): PoshConnectionStatus {
  if (status === 'connected') return 'connected'
  if (status === 'awaiting_test' || encryptedSecret) return 'awaiting_test'
  return 'not_connected'
}

function previewPayload(payload: Record<string, unknown> | null) {
  if (!payload) return {}
  return Object.fromEntries(
    Object.entries(payload)
      .filter(([key]) => ['type', 'event_id', 'order_id', 'order_number', 'total', 'total_amount', 'fees'].includes(key))
      .slice(0, 8)
  )
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}
