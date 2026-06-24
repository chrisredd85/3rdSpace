import 'server-only'

import { randomBytes } from 'crypto'
import { recalculateEventFinancials } from '@/lib/finance/calculate-event-financials'
import { upsertCommitment } from '@/lib/finance/costCommitments'
import { seedPlatformServiceFeeTermForEvent } from '@/lib/finance/revenueTerms'
import {
  EventbriteClient,
  tokenExpiresAt,
  type EventbriteAttendee,
  type EventbriteEvent,
  type EventbriteOrder,
  type EventbriteTokenSet,
} from '@/lib/integrations/eventbrite/client'
import {
  centsFromEventbriteCost,
  classifyTicketTier,
  majorAmountFromCents,
  normalizeCurrency,
} from '@/lib/server/ticket-normalization'
import { enqueueJob, type SupabaseJobClient } from '@/lib/server/job-queue'
import { decryptSecret, encryptSecret } from '@/lib/server/token-crypto'
import {
  deriveEventbritePlannerImportStatus,
  eventbriteBackfillUniqueKey,
  type EventbriteImportJobStatus,
  type EventbritePlannerImportStatus,
} from './importState'

type SupabaseAdminClient = any

export type EventbriteConnectionStatus = 'not_connected' | 'pending' | 'connected' | 'failed' | 'disabled'

export type EventbriteConnectionRow = {
  id: string
  builder_id: string
  platform: 'eventbrite'
  status: EventbriteConnectionStatus
  access_token_encrypted: string | null
  refresh_token_encrypted: string | null
  token_expires_at: string | null
  webhook_url: string | null
  webhook_secret_encrypted: string | null
  account_label?: string | null
  config: Record<string, unknown> | null
  last_connected_at: string | null
  last_error: string | null
  last_webhook_received_at?: string | null
  last_webhook_event_type?: string | null
}

export type EventbriteBackfillEventOption = {
  id: string
  name: string
  start: string | null
  end: string | null
  status: string
  url: string | null
  imported: boolean
  importStatus: EventbritePlannerImportStatus
  importStatusMessage: string | null
  preview: EventbriteImportedEventPreview | null
}

export type EventbriteImportedAttendeePreview = {
  id: string
  firstName: string | null
  lastName: string | null
  email: string | null
  ticketType: string | null
  checkedIn: boolean
  checkInTime: string | null
}

export type EventbriteImportedEventPreview = {
  eventId: string
  integrationId: string
  syncStatus: string | null
  lastSyncAt: string | null
  ticketsSold: number
  ticketsRefunded: number
  grossRevenueCents: number
  netRevenueCents: number
  attendeesImported: number | null
  checkedIn: number | null
  attendees: EventbriteImportedAttendeePreview[]
}

type EventbriteIntegrationRow = {
  id: string
  event_id: string
  external_event_id: string | null
}

type SyncSource = 'api_import' | 'webhook'

type SyncResult = {
  eventId: string
  integrationId: string
  externalEventId: string
  ordersImported: number
  attendeesImported: number
  salesImported: number
  feeCommitmentsImported: number
}

type WebhookProcessResult = {
  processed: boolean
  duplicate?: boolean
  connectionId: string | null
  eventId: string | null
  externalEventId: string | null
  webhookType: string | null
  ordersImported: number
  attendeesImported: number
  skippedReason?: string
}

export const EVENTBRITE_PLATFORM = 'eventbrite'

export function buildEventbriteWebhookUrl(origin: string, connectionId: string) {
  const url = new URL('/api/webhooks/eventbrite', origin)
  url.searchParams.set('connection', connectionId)
  return url.toString()
}

export function generateEventbriteWebhookSecret() {
  return randomBytes(32).toString('hex')
}

export async function loadEventbriteConnection(
  db: SupabaseAdminClient,
  builderId: string
): Promise<EventbriteConnectionRow | null> {
  const { data, error } = await db
    .from('builder_ticketing_connections')
    .select('id, builder_id, platform, status, access_token_encrypted, refresh_token_encrypted, token_expires_at, webhook_url, webhook_secret_encrypted, config, last_connected_at, last_error, last_webhook_received_at, last_webhook_event_type')
    .eq('builder_id', builderId)
    .eq('platform', EVENTBRITE_PLATFORM)
    .maybeSingle()

  if (error) throw new Error(error.message ?? 'Failed to load Eventbrite connection')
  return data as EventbriteConnectionRow | null
}

export function publicEventbriteConnectionState(connection: EventbriteConnectionRow | null) {
  return {
    status: normalizeConnectionStatus(connection),
    connected: Boolean(connection?.access_token_encrypted && connection.status === 'connected'),
    webhookUrl: connection?.webhook_url ?? null,
    hasWebhookSecret: Boolean(connection?.webhook_secret_encrypted),
    lastConnectedAt: connection?.last_connected_at ?? null,
    lastEventReceivedAt: connection?.last_webhook_received_at ?? null,
    lastWebhookEventType: connection?.last_webhook_event_type ?? null,
    lastError: connection?.last_error ?? null,
  }
}

export async function listEventbriteBackfillEvents(db: SupabaseAdminClient, builderId: string) {
  const connection = await requireConnectedEventbriteConnection(db, builderId)
  const client = createEventbriteClientForConnection(db, connection)
  const response = await client.listOwnedEvents()
  const eventIds = (response.events ?? []).map((event) => event.id).filter(Boolean)
  const [importedIds, jobStatuses, previews] = await Promise.all([
    loadImportedEventbriteEventIds(db, builderId, eventIds),
    loadLatestEventbriteBackfillJobStatuses(db, builderId, eventIds),
    loadEventbriteImportedEventPreviews(db, builderId, eventIds),
  ])

  return {
    connection: publicEventbriteConnectionState(connection),
    events: (response.events ?? []).map((event) => ({
      id: event.id,
      name: event.name?.text ?? 'Untitled Eventbrite event',
      start: event.start?.local ?? event.start?.utc ?? null,
      end: event.end?.local ?? event.end?.utc ?? null,
      status: event.status ?? 'unknown',
      url: event.url ?? null,
      imported: importedIds.has(event.id),
      importStatus: deriveEventbritePlannerImportStatus({
        imported: importedIds.has(event.id),
        latestJobStatus: jobStatuses.get(event.id) ?? null,
      }),
      importStatusMessage: importStatusMessage({
        imported: importedIds.has(event.id),
        latestJobStatus: jobStatuses.get(event.id) ?? null,
      }),
      preview: previews.get(event.id) ?? null,
    } satisfies EventbriteBackfillEventOption)),
  }
}

export async function queueSelectedEventbriteEventImports(input: {
  db: SupabaseAdminClient
  builderId: string
  userId: string
  eventbriteEventIds: string[]
}) {
  await requireConnectedEventbriteConnection(input.db, input.builderId)

  const uniqueIds = [...new Set(input.eventbriteEventIds.map((id) => id.trim()).filter(Boolean))].slice(0, 10)
  if (!uniqueIds.length) throw new Error('Select an Eventbrite event before importing')

  const jobs = []
  for (const eventbriteEventId of uniqueIds) {
    const job = await enqueueJob(input.db as unknown as SupabaseJobClient, {
      jobType: 'eventbrite.backfill.import',
      payload: {
        builderId: input.builderId,
        userId: input.userId,
        eventbriteEventIds: [eventbriteEventId],
      },
      uniqueKey: eventbriteBackfillUniqueKey(input.builderId, eventbriteEventId),
      maxAttempts: 3,
    })
    jobs.push(job)
  }

  return {
    queued: jobs.length,
    jobs,
  }
}

export async function runQueuedEventbriteBackfillImport(input: {
  db: SupabaseAdminClient
  builderId: string
  userId: string
  eventbriteEventIds: string[]
}) {
  return importSelectedEventbriteEvents(input)
}

export async function importSelectedEventbriteEvents(input: {
  db: SupabaseAdminClient
  builderId: string
  userId: string
  eventbriteEventIds: string[]
}) {
  const connection = await requireConnectedEventbriteConnection(input.db, input.builderId)
  const client = createEventbriteClientForConnection(input.db, connection)
  const uniqueIds = [...new Set(input.eventbriteEventIds.map((id) => id.trim()).filter(Boolean))].slice(0, 10)
  const results: SyncResult[] = []

  for (const eventbriteEventId of uniqueIds) {
    const eventbriteEvent = await client.getEvent(eventbriteEventId)
    const eventId = await upsertEventFromEventbrite(input.db, input.builderId, eventbriteEvent)
    await seedPlatformServiceFeeTermForEvent({
      supabase: input.db,
      orgId: input.builderId,
      eventId,
      platform: EVENTBRITE_PLATFORM,
    })
    const integrationId = await upsertEventbriteIntegration(input.db, {
      connection,
      eventId,
      eventbriteEvent,
      syncStatus: 'syncing',
    })
    const orders = await fetchAllOrders(client, eventbriteEvent.id)
    const syncResult = await syncEventbriteOrders(input.db, {
      builderId: input.builderId,
      eventId,
      integrationId,
      eventbriteEventId: eventbriteEvent.id,
      orders,
      source: 'api_import',
      action: 'backfill',
    })

    await input.db
      .from('external_event_integrations')
      .update({
        sync_status: 'completed',
        sync_error: null,
        last_sync_status: 'completed',
        last_sync_error: null,
        last_sync_at: new Date().toISOString(),
        last_attendance_count: syncResult.attendeesImported,
        total_tickets_sold: syncResult.salesImported,
        updated_at: new Date().toISOString(),
      } as never)
      .eq('id', integrationId)

    await recalculateEventFinancials(input.db, eventId)
    results.push(syncResult)
  }

  return {
    imported: results.length,
    results,
  }
}

export async function resolveEventbriteWebhookConnection(
  db: SupabaseAdminClient,
  searchParams: URLSearchParams
): Promise<EventbriteConnectionRow | null> {
  const connectionId = searchParams.get('connection') ?? searchParams.get('builderConnectionId')
  const builderId = searchParams.get('integration') ?? searchParams.get('builderId')
  let query = db
    .from('builder_ticketing_connections')
    .select('id, builder_id, platform, status, access_token_encrypted, refresh_token_encrypted, token_expires_at, webhook_url, webhook_secret_encrypted, config, last_connected_at, last_error, last_webhook_received_at, last_webhook_event_type')
    .eq('platform', EVENTBRITE_PLATFORM)

  if (connectionId) {
    query = query.eq('id', connectionId)
  } else if (builderId) {
    query = query.eq('builder_id', builderId)
  } else {
    return null
  }

  const { data, error } = await query.maybeSingle()
  if (error) throw new Error(error.message ?? 'Failed to load Eventbrite webhook connection')
  return data as EventbriteConnectionRow | null
}

export function getEventbriteWebhookSecret(connection: EventbriteConnectionRow | null) {
  if (connection?.webhook_secret_encrypted) {
    return decryptSecret(connection.webhook_secret_encrypted)
  }
  return process.env.EVENTBRITE_WEBHOOK_SECRET ?? null
}

export function getEventbriteWebhookAction(payload: Record<string, unknown>) {
  const action = readString(payload.action) ?? readString(payload.type) ?? null
  return action?.toLowerCase() ?? null
}

export function getEventbriteWebhookDeliveryId(payload: Record<string, unknown>, headers: Headers) {
  const headerId =
    headers.get('x-eventbrite-webhook-id') ??
    headers.get('x-eventbrite-event-id') ??
    headers.get('webhook-id')
  if (headerId) return headerId

  const action = getEventbriteWebhookAction(payload) ?? 'eventbrite'
  const apiUrl = readString(payload.api_url) ?? readString(payload.apiUrl)
  const id = readString(payload.id) ?? readString(payload.webhook_id) ?? readString(payload.delivery_id)
  return id ?? (apiUrl ? `${action}:${apiUrl}` : null)
}

export async function recordEventbriteWebhookReceipt(input: {
  db: SupabaseAdminClient
  connection: EventbriteConnectionRow | null
  payload: Record<string, unknown>
  headers: Headers
  deliveryId: string
}) {
  const { data: existing, error: existingError } = await input.db
    .from('event_webhook_events')
    .select('id, processed_at')
    .eq('platform', EVENTBRITE_PLATFORM)
    .eq('webhook_event_id', input.deliveryId)
    .maybeSingle()

  if (existingError) throw new Error(existingError.message ?? 'Failed to load webhook receipt')
  if (existing) return { id: existing.id as string, duplicate: true }

  const { data, error } = await input.db
    .from('event_webhook_events')
    .insert({
      platform: EVENTBRITE_PLATFORM,
      webhook_event_id: input.deliveryId,
      webhook_type: getEventbriteWebhookAction(input.payload),
      external_event_id: extractEventbriteEventIdFromWebhook(input.payload),
      payload: input.payload,
      headers: normalizeHeaders(input.headers),
      processing_error: null,
    } as never)
    .select('id')
    .single()

  if (error) throw new Error(error.message ?? 'Failed to record Eventbrite webhook')
  return { id: data.id as string, duplicate: false }
}

export async function processQueuedEventbriteWebhook(input: {
  db: SupabaseAdminClient
  connectionId: string
  deliveryId: string
  payload: Record<string, unknown>
}) : Promise<WebhookProcessResult> {
  const connection = await loadEventbriteConnectionById(input.db, input.connectionId)
  if (!connection) {
    return emptyWebhookResult(input, null, 'Eventbrite connection not found')
  }

  const action = getEventbriteWebhookAction(input.payload)
  await markEventbriteHeartbeat(input.db, connection, action)

  if (!action || !isSupportedWebhookAction(action)) {
    await markWebhookDeliveryProcessed(input.db, input.deliveryId, {
      processingError: 'Unsupported Eventbrite webhook action',
    })
    return emptyWebhookResult(input, connection, 'Unsupported Eventbrite webhook action')
  }

  const apiUrl = readString(input.payload.api_url) ?? readString(input.payload.apiUrl)
  if (!apiUrl) {
    await markWebhookDeliveryProcessed(input.db, input.deliveryId, { processingError: 'Missing api_url' })
    return emptyWebhookResult(input, connection, 'Missing api_url')
  }

  const client = createEventbriteClientForConnection(input.db, connection)

  try {
    if (action.startsWith('order.')) {
      const order = await client.getOrderByApiUrl(apiUrl)
      const eventbriteEventId = order.event_id ?? extractEventbriteEventIdFromWebhook(input.payload)
      if (!eventbriteEventId) {
        await markWebhookDeliveryProcessed(input.db, input.deliveryId, { processingError: 'Missing Eventbrite event id' })
        return emptyWebhookResult(input, connection, 'Missing Eventbrite event id')
      }

      const linked = await loadLinkedEventbriteIntegration(input.db, connection.builder_id, eventbriteEventId)
      if (!linked) {
        await quarantineEventbriteWebhook(input.db, connection, input.deliveryId, eventbriteEventId, action, input.payload)
        await markWebhookDeliveryProcessed(input.db, input.deliveryId, { processingError: 'No linked 3rdPlace event found' })
        return {
          ...emptyWebhookResult(input, connection, 'No linked 3rdPlace event found'),
          externalEventId: eventbriteEventId,
        }
      }

      const result = await syncEventbriteOrders(input.db, {
        builderId: connection.builder_id,
        eventId: linked.event_id,
        integrationId: linked.id,
        eventbriteEventId,
        orders: [order],
        source: 'webhook',
        action,
      })
      await recalculateEventFinancials(input.db, linked.event_id)
      await markWebhookDeliveryProcessed(input.db, input.deliveryId, {
        eventId: linked.event_id,
        integrationId: linked.id,
        externalEventId: eventbriteEventId,
      })
      return {
        processed: true,
        connectionId: connection.id,
        eventId: linked.event_id,
        externalEventId: eventbriteEventId,
        webhookType: action,
        ordersImported: result.ordersImported,
        attendeesImported: result.attendeesImported,
      }
    }

    const attendee = await client.getAttendeeByApiUrl(apiUrl)
    const eventbriteEventId = attendee.event_id ?? extractEventbriteEventIdFromWebhook(input.payload)
    if (!eventbriteEventId) {
      await markWebhookDeliveryProcessed(input.db, input.deliveryId, { processingError: 'Missing Eventbrite event id' })
      return emptyWebhookResult(input, connection, 'Missing Eventbrite event id')
    }

    const linked = await loadLinkedEventbriteIntegration(input.db, connection.builder_id, eventbriteEventId)
    if (!linked) {
      await quarantineEventbriteWebhook(input.db, connection, input.deliveryId, eventbriteEventId, action, input.payload)
      await markWebhookDeliveryProcessed(input.db, input.deliveryId, { processingError: 'No linked 3rdPlace event found' })
      return {
        ...emptyWebhookResult(input, connection, 'No linked 3rdPlace event found'),
        externalEventId: eventbriteEventId,
      }
    }

    await upsertAttendees(input.db, [mapEventbriteAttendee(linked.id, linked.event_id, eventbriteEventId, attendee)])
    await markWebhookDeliveryProcessed(input.db, input.deliveryId, {
      eventId: linked.event_id,
      integrationId: linked.id,
      externalEventId: eventbriteEventId,
    })
    return {
      processed: true,
      connectionId: connection.id,
      eventId: linked.event_id,
      externalEventId: eventbriteEventId,
      webhookType: action,
      ordersImported: 0,
      attendeesImported: 1,
    }
  } catch (error) {
    await markWebhookDeliveryProcessed(input.db, input.deliveryId, {
      processingError: error instanceof Error ? error.message : 'Eventbrite webhook processing failed',
    })
    throw error
  }
}

function createEventbriteClientForConnection(db: SupabaseAdminClient, connection: EventbriteConnectionRow) {
  if (!connection.access_token_encrypted) throw new Error('Eventbrite is not connected')

  const accessToken = decryptSecret(connection.access_token_encrypted)
  const refreshToken = connection.refresh_token_encrypted
    ? decryptSecret(connection.refresh_token_encrypted)
    : null

  return new EventbriteClient({
    accessToken,
    refreshToken,
    onRefresh: (tokens) => persistRefreshedTokens(db, connection, tokens),
  })
}

async function persistRefreshedTokens(
  db: SupabaseAdminClient,
  connection: EventbriteConnectionRow,
  tokens: EventbriteTokenSet
) {
  const encryptedAccessToken = encryptSecret(tokens.access_token)
  const encryptedRefreshToken = tokens.refresh_token
    ? encryptSecret(tokens.refresh_token)
    : connection.refresh_token_encrypted
  const expiresAt = tokenExpiresAt(tokens)

  await db
    .from('builder_ticketing_connections')
    .update({
      access_token_encrypted: encryptedAccessToken,
      refresh_token_encrypted: encryptedRefreshToken,
      token_expires_at: expiresAt,
      config: {
        ...(connection.config ?? {}),
        token_type: tokens.token_type ?? 'Bearer',
        scope: tokens.scope ?? connection.config?.scope ?? null,
        refreshed_at: new Date().toISOString(),
      },
      updated_at: new Date().toISOString(),
    } as never)
    .eq('id', connection.id)

  connection.access_token_encrypted = encryptedAccessToken
  connection.refresh_token_encrypted = encryptedRefreshToken
  connection.token_expires_at = expiresAt
}

async function requireConnectedEventbriteConnection(db: SupabaseAdminClient, builderId: string) {
  const connection = await loadEventbriteConnection(db, builderId)
  if (!connection?.access_token_encrypted || connection.status !== 'connected') {
    throw new Error('Connect Eventbrite before importing events')
  }
  return connection
}

async function loadEventbriteConnectionById(db: SupabaseAdminClient, connectionId: string) {
  const { data, error } = await db
    .from('builder_ticketing_connections')
    .select('id, builder_id, platform, status, access_token_encrypted, refresh_token_encrypted, token_expires_at, webhook_url, webhook_secret_encrypted, config, last_connected_at, last_error, last_webhook_received_at, last_webhook_event_type')
    .eq('id', connectionId)
    .eq('platform', EVENTBRITE_PLATFORM)
    .maybeSingle()

  if (error) throw new Error(error.message ?? 'Failed to load Eventbrite connection')
  return data as EventbriteConnectionRow | null
}

async function loadImportedEventbriteEventIds(db: SupabaseAdminClient, builderId: string, eventbriteEventIds: string[]) {
  if (!eventbriteEventIds.length) return new Set<string>()
  const { data, error } = await db
    .from('events')
    .select('eventbrite_event_id')
    .eq('builder_id', builderId)
    .in('eventbrite_event_id', eventbriteEventIds)

  if (error) throw new Error(error.message ?? 'Failed to load imported Eventbrite events')
  return new Set(
    ((data ?? []) as Array<{ eventbrite_event_id: string | null }>)
      .map((row) => row.eventbrite_event_id)
      .filter((id): id is string => Boolean(id))
  )
}

async function loadLatestEventbriteBackfillJobStatuses(
  db: SupabaseAdminClient,
  builderId: string,
  eventbriteEventIds: string[]
) {
  const keyToEventId = new Map(eventbriteEventIds.map((id) => [eventbriteBackfillUniqueKey(builderId, id), id]))
  if (!keyToEventId.size) return new Map<string, EventbriteImportJobStatus>()

  const { data, error } = await db
    .from('app_jobs')
    .select('unique_key, status, created_at')
    .in('unique_key', [...keyToEventId.keys()])
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message ?? 'Failed to load Eventbrite import jobs')

  const statuses = new Map<string, EventbriteImportJobStatus>()
  for (const row of ((data ?? []) as Array<{ unique_key: string | null; status: string | null }>)) {
    const eventbriteEventId = row.unique_key ? keyToEventId.get(row.unique_key) : null
    const status = normalizeImportJobStatus(row.status)
    if (eventbriteEventId && status && !statuses.has(eventbriteEventId)) {
      statuses.set(eventbriteEventId, status)
    }
  }

  return statuses
}

async function loadEventbriteImportedEventPreviews(
  db: SupabaseAdminClient,
  builderId: string,
  eventbriteEventIds: string[]
) {
  const previews = new Map<string, EventbriteImportedEventPreview>()
  if (!eventbriteEventIds.length) return previews

  const { data: eventRows, error: eventsError } = await db
    .from('events')
    .select('id, eventbrite_event_id')
    .eq('builder_id', builderId)
    .in('eventbrite_event_id', eventbriteEventIds)

  if (eventsError) throw new Error(eventsError.message ?? 'Failed to load imported Eventbrite event previews')

  const events = ((eventRows ?? []) as Array<{ id: string; eventbrite_event_id: string | null }>)
    .filter((event): event is { id: string; eventbrite_event_id: string } => Boolean(event.eventbrite_event_id))
  const eventIds = events.map((event) => event.id)
  if (!eventIds.length) return previews

  const [{ data: integrationRows, error: integrationsError }, { data: salesRows, error: salesError }] = await Promise.all([
    db
      .from('external_event_integrations')
      .select('id, event_id, external_event_id, sync_status, last_sync_at, last_attendance_count, total_checked_in')
      .eq('platform', EVENTBRITE_PLATFORM)
      .in('event_id', eventIds),
    db
      .from('event_sales_data')
      .select('event_id, ticket_quantity, total_amount_cents, fees_cents, is_refund')
      .in('event_id', eventIds),
  ])

  if (integrationsError) throw new Error(integrationsError.message ?? 'Failed to load Eventbrite integration previews')
  if (salesError) throw new Error(salesError.message ?? 'Failed to load Eventbrite sales previews')

  const integrations = ((integrationRows ?? []) as Array<{
    id: string
    event_id: string
    external_event_id: string | null
    sync_status: string | null
    last_sync_at: string | null
    last_attendance_count: number | null
    total_checked_in: number | null
  }>).filter((integration) => integration.external_event_id)
  const integrationIds = integrations.map((integration) => integration.id)
  const attendeesByIntegration = await loadAttendeePreviewsByIntegration(db, integrationIds)
  const salesByEventId = summarizeSalesByEventId(salesRows)
  const eventbriteIdByEventId = new Map(events.map((event) => [event.id, event.eventbrite_event_id]))

  for (const integration of integrations) {
    if (!integration.external_event_id) continue
    const sales = salesByEventId.get(integration.event_id) ?? emptyPreviewSales()
    const attendees = attendeesByIntegration.get(integration.id) ?? []
    previews.set(integration.external_event_id, {
      eventId: integration.event_id,
      integrationId: integration.id,
      syncStatus: integration.sync_status,
      lastSyncAt: integration.last_sync_at,
      ticketsSold: sales.ticketsSold,
      ticketsRefunded: sales.ticketsRefunded,
      grossRevenueCents: sales.grossRevenueCents,
      netRevenueCents: sales.netRevenueCents,
      attendeesImported: readInteger(integration.last_attendance_count) ?? attendees.length,
      checkedIn: readInteger(integration.total_checked_in) ?? attendees.filter((attendee) => attendee.checkedIn).length,
      attendees,
    })
  }

  for (const [eventId, eventbriteEventId] of eventbriteIdByEventId) {
    if (!previews.has(eventbriteEventId)) {
      const sales = salesByEventId.get(eventId) ?? emptyPreviewSales()
      previews.set(eventbriteEventId, {
        eventId,
        integrationId: '',
        syncStatus: null,
        lastSyncAt: null,
        ticketsSold: sales.ticketsSold,
        ticketsRefunded: sales.ticketsRefunded,
        grossRevenueCents: sales.grossRevenueCents,
        netRevenueCents: sales.netRevenueCents,
        attendeesImported: null,
        checkedIn: null,
        attendees: [],
      })
    }
  }

  return previews
}

async function loadAttendeePreviewsByIntegration(db: SupabaseAdminClient, integrationIds: string[]) {
  const attendeesByIntegration = new Map<string, EventbriteImportedAttendeePreview[]>()
  if (!integrationIds.length) return attendeesByIntegration

  const { data, error } = await db
    .from('imported_attendees')
    .select('id, integration_id, first_name, last_name, email, ticket_type, checked_in, check_in_time, created_at')
    .in('integration_id', integrationIds)
    .order('check_in_time', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) throw new Error(error.message ?? 'Failed to load Eventbrite attendee preview')

  for (const attendee of ((data ?? []) as Array<{
    id: string
    integration_id: string
    first_name: string | null
    last_name: string | null
    email: string | null
    ticket_type: string | null
    checked_in: boolean | null
    check_in_time: string | null
  }>)) {
    const current = attendeesByIntegration.get(attendee.integration_id) ?? []
    if (current.length >= 5) continue
    current.push({
      id: attendee.id,
      firstName: attendee.first_name,
      lastName: attendee.last_name,
      email: attendee.email,
      ticketType: attendee.ticket_type,
      checkedIn: Boolean(attendee.checked_in),
      checkInTime: attendee.check_in_time,
    })
    attendeesByIntegration.set(attendee.integration_id, current)
  }

  return attendeesByIntegration
}

function summarizeSalesByEventId(salesRows: unknown) {
  const salesByEventId = new Map<string, ReturnType<typeof emptyPreviewSales>>()

  for (const row of ((salesRows ?? []) as Array<{
    event_id: string | null
    ticket_quantity: number | null
    total_amount_cents: number | null
    fees_cents: number | null
    is_refund: boolean | null
  }>)) {
    if (!row.event_id) continue
    const current = salesByEventId.get(row.event_id) ?? emptyPreviewSales()
    const quantity = readInteger(row.ticket_quantity) ?? 0
    const totalCents = readInteger(row.total_amount_cents) ?? 0
    const feesCents = readInteger(row.fees_cents) ?? 0
    if (row.is_refund || quantity < 0) {
      current.ticketsRefunded += Math.abs(quantity)
    } else {
      current.ticketsSold += quantity
    }
    current.grossRevenueCents += totalCents
    current.netRevenueCents += totalCents - feesCents
    salesByEventId.set(row.event_id, current)
  }

  return salesByEventId
}

function emptyPreviewSales() {
  return {
    ticketsSold: 0,
    ticketsRefunded: 0,
    grossRevenueCents: 0,
    netRevenueCents: 0,
  }
}

function importStatusMessage(input: {
  imported: boolean
  latestJobStatus?: EventbriteImportJobStatus | null
}) {
  const status = deriveEventbritePlannerImportStatus(input)
  if (status === 'imported') return 'Imported data is available for planner analytics.'
  if (status === 'queued') return 'Import is queued and will run in the background.'
  if (status === 'running') return 'Import is running now.'
  if (status === 'failed') return 'Latest import attempt failed. Verify the event and queue it again.'
  return null
}

function normalizeImportJobStatus(value: string | null): EventbriteImportJobStatus | null {
  if (
    value === 'pending' ||
    value === 'running' ||
    value === 'succeeded' ||
    value === 'failed' ||
    value === 'dead'
  ) {
    return value
  }
  return null
}

async function upsertEventFromEventbrite(db: SupabaseAdminClient, builderId: string, eventbriteEvent: EventbriteEvent) {
  const fieldConfidence = buildEventFieldConfidence(eventbriteEvent)
  const dateParts = eventDateParts(eventbriteEvent)
  const { data: existing, error: existingError } = await db
    .from('events')
    .select('id, field_confidence')
    .eq('builder_id', builderId)
    .eq('eventbrite_event_id', eventbriteEvent.id)
    .maybeSingle()

  if (existingError) throw new Error(existingError.message ?? 'Failed to load Eventbrite event mapping')

  if (existing?.id) {
    const { error } = await db
      .from('events')
      .update({
        field_confidence: {
          ...((existing.field_confidence as Record<string, unknown> | null) ?? {}),
          eventbrite: fieldConfidence,
        },
        updated_at: new Date().toISOString(),
      } as never)
      .eq('id', existing.id)
    if (error) throw new Error(error.message ?? 'Failed to update Eventbrite event')
    return existing.id as string
  }

  const { data, error } = await db
    .from('events')
    .insert({
      builder_id: builderId,
      eventbrite_event_id: eventbriteEvent.id,
      event_name: eventbriteEvent.name?.text ?? 'Untitled Eventbrite event',
      event_type: 'other',
      event_description: eventbriteEvent.description?.text ?? null,
      description: eventbriteEvent.description?.text ?? null,
      expected_attendance: Number.isFinite(eventbriteEvent.capacity) ? eventbriteEvent.capacity : null,
      event_date: dateParts.date,
      start_time: dateParts.startTime,
      end_time: dateParts.endTime,
      duration_hours: dateParts.durationHours,
      status: mapEventbriteStatus(eventbriteEvent.status),
      is_recurring: false,
      budget: 0,
      field_confidence: { eventbrite: fieldConfidence },
    } as never)
    .select('id')
    .single()

  if (error) throw new Error(error.message ?? 'Failed to create 3rdPlace event from Eventbrite')
  return data.id as string
}

async function upsertEventbriteIntegration(db: SupabaseAdminClient, input: {
  connection: EventbriteConnectionRow
  eventId: string
  eventbriteEvent: EventbriteEvent
  syncStatus: 'syncing' | 'completed' | 'linked'
}) {
  const { data, error } = await db
    .from('external_event_integrations')
    .upsert(
      {
        event_id: input.eventId,
        platform: EVENTBRITE_PLATFORM,
        external_event_id: input.eventbriteEvent.id,
        external_event_url: input.eventbriteEvent.url ?? null,
        access_token_encrypted: input.connection.access_token_encrypted,
        refresh_token_encrypted: input.connection.refresh_token_encrypted,
        token_expires_at: input.connection.token_expires_at,
        webhook_url: input.connection.webhook_url,
        sync_status: input.syncStatus,
        sync_error: null,
        last_sync_status: input.syncStatus,
        last_sync_error: null,
        is_active: true,
        config: {
          account_connection_id: input.connection.id,
          connected_from_account: true,
          eventbrite_event: compactEventbriteEvent(input.eventbriteEvent),
        },
        updated_at: new Date().toISOString(),
      } as never,
      { onConflict: 'event_id,platform' }
    )
    .select('id')
    .single()

  if (error) throw new Error(error.message ?? 'Failed to upsert Eventbrite integration')
  return data.id as string
}

async function fetchAllOrders(client: EventbriteClient, eventbriteEventId: string) {
  const orders: EventbriteOrder[] = []
  let continuation: string | null | undefined
  let hasMore = true

  while (hasMore) {
    const page = await client.listEventOrders(eventbriteEventId, continuation)
    orders.push(...(page.orders ?? []))
    hasMore = Boolean(page.pagination?.has_more_items)
    continuation = page.pagination?.continuation ?? null
  }

  return orders
}

async function syncEventbriteOrders(db: SupabaseAdminClient, input: {
  builderId: string
  eventId: string
  integrationId: string
  eventbriteEventId: string
  orders: EventbriteOrder[]
  source: SyncSource
  action: string
}): Promise<SyncResult> {
  const sales = input.orders.map((order) => mapEventbriteOrderSale(input.integrationId, input.eventId, input.eventbriteEventId, order, input.source, input.action))
  const attendees = input.orders.flatMap((order) =>
    (order.attendees ?? []).map((attendee) =>
      mapEventbriteAttendee(input.integrationId, input.eventId, input.eventbriteEventId, {
        ...attendee,
        order_id: attendee.order_id ?? order.id,
        event_id: attendee.event_id ?? input.eventbriteEventId,
      })
    )
  )
  const feeCommitments = sales.filter((sale) => !sale.is_refund && sale.fees_cents > 0)

  await upsertSales(db, sales)
  await upsertAttendees(db, attendees)
  for (const sale of feeCommitments) {
    await upsertEventbritePlatformFeeCommitment(db, {
      builderId: input.builderId,
      eventId: input.eventId,
      eventbriteEventId: input.eventbriteEventId,
      sale,
      source: input.source,
    })
  }

  return {
    eventId: input.eventId,
    integrationId: input.integrationId,
    externalEventId: input.eventbriteEventId,
    ordersImported: input.orders.length,
    attendeesImported: attendees.length,
    salesImported: sales.length,
    feeCommitmentsImported: feeCommitments.length,
  }
}

function mapEventbriteOrderSale(
  integrationId: string,
  eventId: string,
  eventbriteEventId: string,
  order: EventbriteOrder,
  source: SyncSource,
  action: string
) {
  const attendees = order.attendees ?? []
  const isRefund = isRefundActionOrOrder(action, order)
  const quantity = Math.max(attendees.length, 1)
  const totalCents = readOrderGrossCents(order)
  const feesCents = readOrderFeeCents(order)
  const signedTotalCents = isRefund ? -Math.abs(totalCents) : totalCents
  const ticketPriceCents = quantity > 0 ? Math.round(Math.abs(totalCents) / quantity) : Math.abs(totalCents)
  const tierName = summarizeTierName(attendees)
  const orderId = `${eventbriteEventId}:${order.id}${isRefund ? ':refund' : ''}`
  const buyerName = order.name ?? ([order.first_name, order.last_name].filter(Boolean).join(' ') || null)

  return {
    integration_id: integrationId,
    event_id: eventId,
    order_id: orderId,
    platform: EVENTBRITE_PLATFORM,
    ticket_buyer_name: buyerName,
    ticket_buyer_email: order.email ?? null,
    ticket_quantity: isRefund ? -quantity : quantity,
    ticket_type: tierName,
    ticket_tier_name: tierName,
    ticket_tier_category: classifyTicketTier(tierName, ticketPriceCents),
    ticket_price: majorAmountFromCents(ticketPriceCents),
    ticket_price_cents: ticketPriceCents,
    total_amount: majorAmountFromCents(signedTotalCents) ?? 0,
    total_amount_cents: signedTotalCents,
    fees: majorAmountFromCents(feesCents) ?? 0,
    fees_cents: feesCents,
    currency: normalizeCurrency(order.costs?.gross?.currency ?? attendees[0]?.costs?.gross?.currency),
    discount_code: null,
    is_refund: isRefund,
    purchase_timestamp: order.created ?? order.changed ?? new Date().toISOString(),
    raw_ticket_class_id: summarizeTicketClassId(attendees),
    sales_channel: source === 'webhook' ? 'eventbrite_webhook' : 'eventbrite_backfill',
    source: source === 'webhook' ? 'eventbrite_webhook' : 'eventbrite_backfill',
    received_at: new Date().toISOString(),
    gross_cents: Math.max(signedTotalCents, 0),
    tier_name: tierName,
    raw_data: order as Record<string, unknown>,
  }
}

function mapEventbriteAttendee(
  integrationId: string,
  eventId: string,
  eventbriteEventId: string,
  attendee: EventbriteAttendee
) {
  const ticketPriceCents = centsFromEventbriteCost(attendee.costs?.gross)
  const tierName = attendee.ticket_class_name ?? 'Unknown'

  return {
    integration_id: integrationId,
    event_id: eventId,
    external_attendee_id: `${eventbriteEventId}:${attendee.id}`,
    first_name: attendee.profile?.first_name ?? null,
    last_name: attendee.profile?.last_name ?? null,
    email: attendee.profile?.email ?? null,
    ticket_type: tierName,
    ticket_class: attendee.status ?? null,
    ticket_tier_name: tierName,
    ticket_tier_category: classifyTicketTier(tierName, ticketPriceCents),
    order_id: attendee.order_id ? `${eventbriteEventId}:${attendee.order_id}` : null,
    checked_in: Boolean(attendee.checked_in),
    check_in_time: attendee.checked_in ? attendee.checked_in_at ?? null : null,
    check_in_method: attendee.check_in_method ?? null,
    ticket_price: majorAmountFromCents(ticketPriceCents),
    ticket_price_cents: ticketPriceCents,
    raw_ticket_class_id: attendee.ticket_class_id ?? null,
    raw_data: attendee as Record<string, unknown>,
  }
}

async function upsertSales(db: SupabaseAdminClient, sales: Array<Record<string, unknown>>) {
  if (!sales.length) return
  const { error } = await db
    .from('event_sales_data')
    .upsert(sales as never, { onConflict: 'event_id,platform,order_id' })
  if (error) throw new Error(error.message ?? 'Failed to upsert Eventbrite sales')
}

async function upsertAttendees(db: SupabaseAdminClient, attendees: Array<Record<string, unknown>>) {
  if (!attendees.length) return
  const { error } = await db
    .from('imported_attendees')
    .upsert(attendees as never, { onConflict: 'integration_id,external_attendee_id' })
  if (error) throw new Error(error.message ?? 'Failed to upsert Eventbrite attendees')
}

async function upsertEventbritePlatformFeeCommitment(db: SupabaseAdminClient, input: {
  builderId: string
  eventId: string
  eventbriteEventId: string
  sale: Record<string, any>
  source: SyncSource
}) {
  await upsertCommitment(db, {
    event_id: input.eventId,
    plan_id: null,
    org_id: input.builderId,
    category: 'platform_fee',
    party_id: null,
    party_name: 'Eventbrite',
    description: `Eventbrite platform fee for order ${input.sale.order_id}`,
    amount_cents: input.sale.fees_cents,
    state: 'paid',
    confidence: 'high',
    evidence_type: 'none',
    source: input.source,
    source_ref: `eventbrite:${input.sale.order_id}:platform_fee`,
    paid_at: input.sale.purchase_timestamp ?? input.sale.received_at,
    metadata: {
      platform: EVENTBRITE_PLATFORM,
      order_id: input.sale.order_id,
      external_event_id: input.eventbriteEventId,
      gross_cents: input.sale.gross_cents,
      fees_cents: input.sale.fees_cents,
      tier_name: input.sale.tier_name,
      received_at: input.sale.received_at,
    },
  })
}

async function loadLinkedEventbriteIntegration(
  db: SupabaseAdminClient,
  builderId: string,
  eventbriteEventId: string
): Promise<EventbriteIntegrationRow | null> {
  const { data: event, error: eventError } = await db
    .from('events')
    .select('id')
    .eq('builder_id', builderId)
    .eq('eventbrite_event_id', eventbriteEventId)
    .maybeSingle()

  if (eventError) throw new Error(eventError.message ?? 'Failed to load Eventbrite event mapping')
  if (!event?.id) return null

  const { data, error } = await db
    .from('external_event_integrations')
    .select('id, event_id, external_event_id')
    .eq('event_id', event.id)
    .eq('platform', EVENTBRITE_PLATFORM)
    .maybeSingle()

  if (error) throw new Error(error.message ?? 'Failed to load linked Eventbrite integration')
  return data as EventbriteIntegrationRow | null
}

async function quarantineEventbriteWebhook(
  db: SupabaseAdminClient,
  connection: EventbriteConnectionRow,
  deliveryId: string,
  eventbriteEventId: string,
  action: string,
  payload: Record<string, unknown>
) {
  const { error } = await db
    .from('unlinked_ticket_events')
    .upsert(
      {
        builder_id: connection.builder_id,
        platform: EVENTBRITE_PLATFORM,
        external_event_id: eventbriteEventId,
        webhook_event_id: deliveryId,
        webhook_type: action,
        payload,
        received_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as never,
      { onConflict: 'platform,builder_id,webhook_event_id' }
    )
  if (error) throw new Error(error.message ?? 'Failed to quarantine Eventbrite webhook')
}

async function markEventbriteHeartbeat(
  db: SupabaseAdminClient,
  connection: EventbriteConnectionRow,
  action: string | null
) {
  await db
    .from('builder_ticketing_connections')
    .update({
      status: 'connected',
      last_webhook_received_at: new Date().toISOString(),
      last_webhook_event_type: action,
      last_error: null,
      updated_at: new Date().toISOString(),
    } as never)
    .eq('id', connection.id)
}

async function markWebhookDeliveryProcessed(db: SupabaseAdminClient, deliveryId: string, input: {
  eventId?: string | null
  integrationId?: string | null
  externalEventId?: string | null
  processingError?: string | null
}) {
  await db
    .from('event_webhook_events')
    .update({
      event_id: input.eventId ?? null,
      integration_id: input.integrationId ?? null,
      external_event_id: input.externalEventId ?? null,
      processed_at: input.processingError ? null : new Date().toISOString(),
      processing_error: input.processingError ?? null,
    } as never)
    .eq('platform', EVENTBRITE_PLATFORM)
    .eq('webhook_event_id', deliveryId)
}

function emptyWebhookResult(
  input: { connectionId: string; payload: Record<string, unknown> },
  connection: EventbriteConnectionRow | null,
  skippedReason: string
): WebhookProcessResult {
  return {
    processed: false,
    connectionId: connection?.id ?? input.connectionId ?? null,
    eventId: null,
    externalEventId: extractEventbriteEventIdFromWebhook(input.payload),
    webhookType: getEventbriteWebhookAction(input.payload),
    ordersImported: 0,
    attendeesImported: 0,
    skippedReason,
  }
}

function isSupportedWebhookAction(action: string) {
  return [
    'order.placed',
    'order.updated',
    'order.refunded',
    'attendee.checked_in',
    'attendee.check_in',
    'attendee.updated',
  ].includes(action)
}

function extractEventbriteEventIdFromWebhook(payload: Record<string, unknown>) {
  const direct = readString(payload.event_id) ?? readString(payload.eventId)
  if (direct) return direct

  const apiUrl = readString(payload.api_url) ?? readString(payload.apiUrl)
  if (!apiUrl) return null
  const match = apiUrl.match(/\/events\/([^/?]+)\//)
  return match?.[1] ?? null
}

function readOrderGrossCents(order: EventbriteOrder) {
  const orderGross = centsFromEventbriteCost(order.costs?.gross)
  if (orderGross !== null) return orderGross
  return (order.attendees ?? []).reduce((sum, attendee) => sum + (centsFromEventbriteCost(attendee.costs?.gross) ?? 0), 0)
}

function readOrderFeeCents(order: EventbriteOrder) {
  const orderFee =
    (centsFromEventbriteCost(order.costs?.eventbrite_fee) ?? 0) +
    (centsFromEventbriteCost(order.costs?.payment_fee) ?? 0)
  if (orderFee > 0) return orderFee

  return (order.attendees ?? []).reduce((sum, attendee) => {
    return sum +
      (centsFromEventbriteCost(attendee.costs?.eventbrite_fee) ?? 0) +
      (centsFromEventbriteCost(attendee.costs?.payment_fee) ?? 0)
  }, 0)
}

function summarizeTierName(attendees: EventbriteAttendee[]) {
  const names = [...new Set(attendees.map((attendee) => attendee.ticket_class_name).filter(Boolean))]
  if (names.length === 1) return names[0] as string
  if (names.length > 1) return 'Mixed ticket classes'
  return 'General Admission'
}

function summarizeTicketClassId(attendees: EventbriteAttendee[]) {
  const ids = [...new Set(attendees.map((attendee) => attendee.ticket_class_id).filter(Boolean))]
  if (ids.length === 1) return ids[0] as string
  if (ids.length > 1) return 'mixed'
  return null
}

function isRefundActionOrOrder(action: string, order: EventbriteOrder) {
  const status = order.status?.toLowerCase() ?? ''
  return action === 'order.refunded' || /refund|refunded|cancel|cancelled|canceled|void|deleted/.test(status)
}

function buildEventFieldConfidence(eventbriteEvent: EventbriteEvent) {
  return {
    event_name: eventbriteEvent.name?.text ? 'high' : 'low',
    event_date: eventbriteEvent.start?.local || eventbriteEvent.start?.utc ? 'high' : 'low',
    start_time: eventbriteEvent.start?.local || eventbriteEvent.start?.utc ? 'high' : 'low',
    end_time: eventbriteEvent.end?.local || eventbriteEvent.end?.utc ? 'high' : 'low',
    expected_attendance: Number.isFinite(eventbriteEvent.capacity) ? 'medium' : 'low',
    event_type: 'low',
    source: 'eventbrite_backfill',
  }
}

function eventDateParts(eventbriteEvent: EventbriteEvent) {
  const start = parseDateTime(eventbriteEvent.start?.local ?? eventbriteEvent.start?.utc, 18)
  const end = parseDateTime(eventbriteEvent.end?.local ?? eventbriteEvent.end?.utc, start.hour + 3)
  const durationMs = Math.max(end.dateObject.getTime() - start.dateObject.getTime(), 60 * 60 * 1000)

  return {
    date: start.date,
    startTime: start.time,
    endTime: end.time,
    durationHours: Math.round((durationMs / 3_600_000) * 10) / 10,
  }
}

function parseDateTime(value: string | null | undefined, fallbackHour: number) {
  if (value?.includes('T')) {
    const [datePart, rawTime = ''] = value.split('T')
    const timePart = rawTime.replace(/Z$/, '').split(/[+-]/)[0]
    const dateObject = new Date(value.endsWith('Z') ? value : `${datePart}T${timePart}`)
    return {
      date: datePart,
      time: normalizeTime(timePart),
      hour: Number(timePart.slice(0, 2)) || fallbackHour,
      dateObject: Number.isFinite(dateObject.getTime()) ? dateObject : fallbackDate(fallbackHour),
    }
  }

  const fallback = fallbackDate(fallbackHour)
  return {
    date: fallback.toISOString().slice(0, 10),
    time: `${String(fallbackHour).padStart(2, '0')}:00:00`,
    hour: fallbackHour,
    dateObject: fallback,
  }
}

function normalizeTime(value: string) {
  const [hour = '18', minute = '00', second = '00'] = value.split(':')
  return `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}:${second.slice(0, 2).padStart(2, '0')}`
}

function fallbackDate(hour: number) {
  const date = new Date()
  date.setHours(hour, 0, 0, 0)
  return date
}

function mapEventbriteStatus(status: string | null | undefined) {
  const normalized = status?.toLowerCase() ?? ''
  if (normalized.includes('cancel')) return 'cancelled'
  if (normalized === 'ended') return 'completed'
  if (normalized === 'live' || normalized === 'started') return 'confirmed'
  return 'draft'
}

function compactEventbriteEvent(eventbriteEvent: EventbriteEvent) {
  return {
    id: eventbriteEvent.id,
    name: eventbriteEvent.name?.text ?? null,
    start: eventbriteEvent.start?.local ?? eventbriteEvent.start?.utc ?? null,
    end: eventbriteEvent.end?.local ?? eventbriteEvent.end?.utc ?? null,
    status: eventbriteEvent.status ?? null,
    url: eventbriteEvent.url ?? null,
  }
}

function normalizeConnectionStatus(connection: EventbriteConnectionRow | null): EventbriteConnectionStatus {
  if (!connection?.status) return 'not_connected'
  if (connection.access_token_encrypted && connection.status === 'connected') return 'connected'
  return connection.status
}

function normalizeHeaders(headers: Headers) {
  const normalized: Record<string, string> = {}
  headers.forEach((value, key) => {
    normalized[key] = value
  })
  return normalized
}

function readString(value: unknown) {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

function readInteger(value: unknown) {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null
  return value
}
