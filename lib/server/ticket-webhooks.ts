import { createHmac, timingSafeEqual } from 'crypto'
import { recalculateEventFinancials } from '@/lib/finance/calculate-event-financials'
import { upsertCommitment } from '@/lib/finance/costCommitments'
import * as Sentry from '@sentry/nextjs'
import {
  markPoshHeartbeat,
  quarantineUnlinkedPoshEvent,
  resolvePoshEventLink,
} from '@/lib/integrations/poshLink'
import {
  centsFromMajorAmount,
  classifyTicketTier,
  normalizeCurrency,
  type TicketTierCategory,
} from '@/lib/server/ticket-normalization'
import { decryptSecret } from '@/lib/server/token-crypto'

type SupabaseAdminClient = any
type JsonObject = Record<string, any>

export type WebhookPlatform = 'posh' | 'luma' | 'partiful'

type IntegrationContext = {
  integrationId: string | null
  eventId: string | null
  builderId: string | null
  builderConnectionId: string | null
  externalEventId: string | null
  config: JsonObject
  staleWebhookSecret?: StaleWebhookSecretContext | null
}

type BuilderConnectionRow = {
  id: string
  builder_id?: string | null
  config?: JsonObject | null
  status?: string | null
  last_error?: string | null
  webhook_secret_encrypted?: string | null
}

type StaleWebhookSecretContext = {
  provider: WebhookPlatform
  builderConnectionId: string
  builderId: string | null
  reason: 'stale_secret'
}

type SalesPayload = {
  event_id: string
  integration_id: string | null
  order_id: string
  platform: WebhookPlatform
  ticket_buyer_name: string | null
  ticket_buyer_email: string | null
  ticket_quantity: number
  ticket_type: string | null
  ticket_tier_name: string | null
  ticket_tier_category: TicketTierCategory
  ticket_price: number | null
  ticket_price_cents: number | null
  total_amount: number
  total_amount_cents: number
  fees: number
  fees_cents: number
  currency: string
  discount_code: string | null
  is_refund: boolean
  purchase_timestamp: string | null
  raw_ticket_class_id: string | null
  sales_channel: string | null
  source?: string
  received_at?: string
  gross_cents?: number
  tier_name?: string
  raw_data: JsonObject
}

type ImportedAttendeePayload = {
  integration_id: string
  event_id: string
  external_attendee_id: string
  first_name: string | null
  last_name: string | null
  email: string | null
  ticket_type: string | null
  ticket_class: string | null
  ticket_tier_name: string | null
  ticket_tier_category: TicketTierCategory
  order_id: string | null
  checked_in: boolean
  check_in_time: string | null
  check_in_method: string | null
  ticket_price: number | null
  ticket_price_cents: number | null
  raw_ticket_class_id: string | null
  raw_data: JsonObject
}

export type ProcessWebhookResult = {
  processed: boolean
  integrationId: string | null
  eventId: string | null
  externalEventId: string | null
  webhookType: string | null
  salesUpserted: number
  attendeesUpserted: number
  skippedReason?: string
}

const POSH_REFUND_TYPES = new Set(['order_updated'])
const POSH_SALE_TYPES = new Set(['new_order', 'pending_order_actioned'])
const STALE_SECRET_ERROR = 'stale_encryption'

/**
 * Checks whether an unknown value is a plain JSON object.
 *
 * @param value - Unknown value from a webhook body.
 * @returns True when the value can be read as an object.
 */
function isObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

/**
 * Coerces primitive webhook values into a trimmed string.
 *
 * @param value - Raw webhook field.
 * @returns Trimmed string or null when empty/unsupported.
 */
function asString(value: unknown) {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

/**
 * Coerces primitive webhook values into a number.
 *
 * @param value - Raw webhook field.
 * @returns Finite number or null when not numeric.
 */
function asNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
    return Number(value)
  }
  return null
}

/**
 * Rounds a monetary amount to cents.
 *
 * @param value - Raw monetary calculation.
 * @returns Value rounded to two decimals.
 */
function roundMoney(value: number) {
  return Math.round(value * 100) / 100
}

/**
 * Reads a nested value from a JSON object using dot notation.
 *
 * @param source - JSON object to read.
 * @param path - Dot-separated path, such as `data.guest.email`.
 * @returns Value found at the path, or undefined.
 */
function getPath(source: JsonObject, path: string) {
  return path.split('.').reduce<unknown>((current, key) => {
    if (!isObject(current)) return undefined
    return current[key]
  }, source)
}

/**
 * Returns the first non-empty string found at any supplied JSON path.
 *
 * @param source - JSON object to read.
 * @param paths - Candidate dot paths in priority order.
 * @returns First string value found, or null.
 */
function firstString(source: JsonObject, paths: string[]) {
  for (const path of paths) {
    const value = asString(getPath(source, path))
    if (value) return value
  }
  return null
}

/**
 * Returns the first numeric value found at any supplied JSON path.
 *
 * @param source - JSON object to read.
 * @param paths - Candidate dot paths in priority order.
 * @returns First numeric value found, or null.
 */
function firstNumber(source: JsonObject, paths: string[]) {
  for (const path of paths) {
    const value = asNumber(getPath(source, path))
    if (value !== null) return value
  }
  return null
}

/**
 * Reads a monetary value that may be expressed as dollars or cents.
 *
 * @param source - JSON object to read.
 * @param dollarPaths - Candidate paths already expressed in dollars.
 * @param centPaths - Candidate paths expressed in cents.
 * @returns Dollar amount rounded to cents, or null.
 */
function firstMoney(source: JsonObject, dollarPaths: string[], centPaths: string[]) {
  const dollarValue = firstNumber(source, dollarPaths)
  if (dollarValue !== null) return roundMoney(dollarValue)

  const centValue = firstNumber(source, centPaths)
  if (centValue !== null) return roundMoney(centValue / 100)

  return null
}

/**
 * Splits a full name into a first/last pair for attendee records.
 *
 * @param name - Full buyer or guest name.
 * @returns First and last name fields, falling back to null.
 */
function splitName(name: string | null) {
  if (!name) return { firstName: null, lastName: null }
  const parts = name.trim().split(/\s+/)
  return {
    firstName: parts[0] ?? null,
    lastName: parts.length > 1 ? parts.slice(1).join(' ') : null,
  }
}

/**
 * Converts request headers into JSON for webhook delivery diagnostics.
 *
 * @param headers - Incoming request headers.
 * @returns Plain object copy of the headers.
 */
function normalizeHeaderObject(headers: Headers) {
  const normalized: JsonObject = {}
  headers.forEach((value, key) => {
    normalized[key] = value
  })
  return normalized
}

/**
 * Extracts the external Luma event id from known webhook payload shapes.
 *
 * @param payload - Raw Luma webhook payload.
 * @returns Luma event id when present.
 */
export function extractLumaExternalEventId(payload: JsonObject) {
  return firstString(payload, [
    'event_id',
    'data.event.api_id',
    'data.event.id',
    'data.event.event_id',
    'data.event_id',
    'data.event_api_id',
    'data.calendar_event.event.api_id',
    'data.calendar_event.event.id',
  ])
}

/**
 * Extracts the external Posh event id from known webhook payload shapes.
 *
 * @param payload - Raw Posh webhook payload.
 * @returns Posh event id when present.
 */
export function extractPoshExternalEventId(payload: JsonObject) {
  return firstString(payload, ['event_id'])
}

/**
 * Extracts the external Partiful event id from known webhook/import shapes.
 *
 * @param payload - Raw Partiful webhook payload.
 * @returns Partiful event id when present.
 */
export function extractPartifulExternalEventId(payload: JsonObject) {
  return firstString(payload, [
    'event_id',
    'partiful_event_id',
    'party_id',
    'data.event_id',
    'data.event.id',
    'data.party_id',
    'data.party.id',
    'event.id',
    'party.id',
  ])
}

/**
 * Extracts the webhook type discriminator from a payload.
 *
 * @param payload - Raw webhook payload.
 * @returns Provider event type, or null.
 */
export function getWebhookType(payload: JsonObject) {
  return firstString(payload, ['type'])
}

/**
 * Verifies the HMAC signature Luma includes on webhook requests.
 *
 * @param secret - Luma webhook secret for this endpoint.
 * @param signatureHeader - `Webhook-Signature` request header.
 * @param rawBody - Unparsed request body.
 * @returns True when the signature matches.
 */
export function verifyLumaSignature(secret: string, signatureHeader: string | null, rawBody: string) {
  if (!signatureHeader) return false

  const parts = Object.fromEntries(
    signatureHeader.split(',').map((part) => {
      const [key, ...rest] = part.split('=')
      return [key?.trim(), rest.join('=').trim()]
    })
  )

  if (!parts.t || !parts.v1) return false

  const expected = createHmac('sha256', secret)
    .update(`${parts.t}.${rawBody}`)
    .digest('hex')

  const expectedBuffer = Buffer.from(expected)
  const actualBuffer = Buffer.from(parts.v1)
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer)
}

/**
 * Verifies the static Posh secret header when configured.
 *
 * @param expectedSecret - Secret stored in integration config or env.
 * @param actualSecret - Incoming `Posh-Secret` request header.
 * @returns True when the secrets match.
 */
export function verifyPoshSecret(expectedSecret: string, actualSecret: string | null) {
  if (!actualSecret) return false

  const expectedBuffer = Buffer.from(expectedSecret)
  const actualBuffer = Buffer.from(actualSecret)
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer)
}

export function getConfiguredTicketWebhookSecret(context: IntegrationContext, fallbackSecret?: string) {
  return typeof context.config?.webhook_secret === 'string'
    ? context.config.webhook_secret
    : fallbackSecret
}

export function verifyConfiguredTicketWebhook(
  platform: WebhookPlatform,
  configuredSecret: string | undefined,
  headers: Headers,
  rawBody: string
) {
  if (!configuredSecret) return true

  if (platform === 'luma') {
    return verifyLumaSignature(configuredSecret, headers.get('webhook-signature'), rawBody)
  }

  if (platform === 'partiful') {
    return verifyPoshSecret(
      configuredSecret,
      headers.get('partiful-secret') ?? headers.get('x-partiful-secret')
    )
  }

  return verifyPoshSecret(configuredSecret, headers.get('posh-secret'))
}

export function isStaleWebhookSecretContext(context: IntegrationContext) {
  return context.staleWebhookSecret?.reason === 'stale_secret'
}

export function staleWebhookSecretResponse() {
  return {
    received: true,
    ignored: true,
    reason: 'stale_secret',
  }
}

/**
 * Finds the internal 3rdPlace event/integration associated with a webhook.
 *
 * Lookup priority is explicit `integrationId`, then provider event id, then
 * optional direct `eventId` query param for testing.
 *
 * @param admin - Service-role Supabase client.
 * @param platform - Ticketing platform name.
 * @param payload - Raw webhook payload.
 * @param searchParams - Request query parameters.
 * @returns Integration context used by webhook processors.
 */
export async function resolveIntegrationContext(
  admin: SupabaseAdminClient,
  platform: WebhookPlatform,
  payload: JsonObject,
  searchParams: URLSearchParams
): Promise<IntegrationContext> {
  const integrationId = searchParams.get('integrationId')
  const builderConnectionId = searchParams.get('builderConnectionId')
  const builderOrgIntegrationId = searchParams.get('integration')
  const eventId = searchParams.get('eventId')
  const externalEventId =
    platform === 'posh'
      ? extractPoshExternalEventId(payload)
      : platform === 'partiful'
        ? extractPartifulExternalEventId(payload)
        : extractLumaExternalEventId(payload)
  let builderConnectionConfig: JsonObject = {}
  let resolvedBuilderId: string | null = builderOrgIntegrationId

  if (builderConnectionId || builderOrgIntegrationId) {
    let connectionQuery = admin
      .from('builder_ticketing_connections')
      .select('id, builder_id, config, status, last_error, webhook_secret_encrypted')
      .eq('platform', platform)

    if (builderConnectionId) {
      connectionQuery = connectionQuery.eq('id', builderConnectionId)
    } else if (builderOrgIntegrationId) {
      connectionQuery = connectionQuery.eq('builder_id', builderOrgIntegrationId)
    }

    const { data, error } = await connectionQuery
      .maybeSingle()

    if (error) throw error
    const builderConnection = data as BuilderConnectionRow | null
    if (builderConnection) {
      resolvedBuilderId = builderConnection.builder_id ?? resolvedBuilderId
      builderConnectionConfig = {
        ...(builderConnection.config ?? {}),
      }

      if (builderConnection.status === 'setup_required' && builderConnection.last_error === STALE_SECRET_ERROR) {
        return {
          integrationId: null,
          eventId,
          builderId: builderConnection.builder_id ?? resolvedBuilderId,
          builderConnectionId: builderConnection.id,
          externalEventId,
          config: builderConnectionConfig,
          staleWebhookSecret: {
            provider: platform,
            builderConnectionId: builderConnection.id,
            builderId: builderConnection.builder_id ?? null,
            reason: 'stale_secret',
          },
        }
      }

      if (builderConnection.webhook_secret_encrypted) {
        try {
          builderConnectionConfig.webhook_secret = decryptSecret(builderConnection.webhook_secret_encrypted)
        } catch (error) {
          await markBuilderConnectionWebhookSecretStale(admin, {
            provider: platform,
            connectionId: builderConnection.id,
            builderId: builderConnection.builder_id ?? null,
            error,
          })

          return {
            integrationId: null,
            eventId,
            builderId: builderConnection.builder_id ?? resolvedBuilderId,
            builderConnectionId: builderConnection.id,
            externalEventId,
            config: builderConnectionConfig,
            staleWebhookSecret: {
              provider: platform,
              builderConnectionId: builderConnection.id,
              builderId: builderConnection.builder_id ?? null,
              reason: 'stale_secret',
            },
          }
        }
      }
    }
  }

  if (platform === 'posh' && externalEventId) {
    const link = await resolvePoshEventLink({
      db: admin,
      builderId: resolvedBuilderId,
      poshEventId: externalEventId,
    })
    resolvedBuilderId = link.builderId ?? resolvedBuilderId
    if (link.eventId) {
      return {
        integrationId: link.integrationId,
        eventId: link.eventId,
        builderId: resolvedBuilderId,
        builderConnectionId: builderConnectionId ?? null,
        externalEventId,
        config: builderConnectionConfig,
      }
    }
  }

  if (integrationId) {
    const { data, error } = await admin
      .from('external_event_integrations')
      .select('id, event_id, external_event_id, config')
      .eq('id', integrationId)
      .eq('platform', platform)
      .maybeSingle()

    if (error) throw error
    if (data) {
      return {
        integrationId: data.id,
        eventId: data.event_id,
        builderId: resolvedBuilderId,
        builderConnectionId: builderConnectionId ?? null,
        externalEventId: data.external_event_id ?? externalEventId,
        config: {
          ...builderConnectionConfig,
          ...(data.config ?? {}),
        },
      }
    }
  }

  if (externalEventId) {
    const { data, error } = await admin
      .from('external_event_integrations')
      .select('id, event_id, external_event_id, config')
      .eq('platform', platform)
      .eq('external_event_id', externalEventId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) throw error
    if (data) {
      return {
        integrationId: data.id,
        eventId: data.event_id,
        builderId: resolvedBuilderId,
        builderConnectionId: builderConnectionId ?? null,
        externalEventId: data.external_event_id ?? externalEventId,
        config: {
          ...builderConnectionConfig,
          ...(data.config ?? {}),
        },
      }
    }
  }

  return {
    integrationId: null,
    eventId,
    builderId: resolvedBuilderId,
    builderConnectionId: builderConnectionId ?? null,
    externalEventId,
    config: builderConnectionConfig,
  }
}

async function markBuilderConnectionWebhookSecretStale(
  admin: SupabaseAdminClient,
  input: {
    provider: WebhookPlatform
    connectionId: string
    builderId: string | null
    error: unknown
  }
) {
  const message = input.error instanceof Error ? input.error.message : String(input.error)
  console.error('[ticket-webhooks] Webhook secret decryption failed - likely stale ciphertext', {
    action: 'webhook_decryption_stale',
    provider: input.provider,
    table: 'builder_ticketing_connections',
    row_id: input.connectionId,
    builder_id: input.builderId,
    error: message,
  })
  Sentry.captureException(input.error, {
    tags: {
      action: 'webhook_decryption_stale',
      provider: input.provider,
    },
    extra: {
      table: 'builder_ticketing_connections',
      row_id: input.connectionId,
      builder_id: input.builderId,
    },
  })

  const now = new Date().toISOString()
  const update = {
    status: 'setup_required',
    last_error: STALE_SECRET_ERROR,
    updated_at: now,
  }

  const { error } = await admin
    .from('builder_ticketing_connections')
    .update(update as never)
    .eq('id', input.connectionId)

  if (error) {
    console.error('[ticket-webhooks] Failed to mark ticketing connection setup_required after stale secret', {
      provider: input.provider,
      row_id: input.connectionId,
      error: error.message,
    })
  }

  if (input.builderId) {
    const { error: providerError } = await admin
      .from('provider_connections')
      .update({
        status: 'setup_required',
        last_error: STALE_SECRET_ERROR,
        updated_at: now,
      } as never)
      .eq('builder_id', input.builderId)
      .eq('provider', input.provider)
      .is('plan_id', null)

    if (providerError) {
      console.warn('[ticket-webhooks] Failed to sync provider connection stale-secret state', {
        provider: input.provider,
        builder_id: input.builderId,
        error: providerError.message,
      })
    }

    await notifyBuilderWebhookSecretStale(admin, {
      provider: input.provider,
      builderId: input.builderId,
      connectionId: input.connectionId,
    })
  }
}

async function notifyBuilderWebhookSecretStale(
  admin: SupabaseAdminClient,
  input: {
    provider: WebhookPlatform
    builderId: string
    connectionId: string
  }
) {
  const { data: builder, error: builderError } = await admin
    .from('builder_profiles')
    .select('user_id')
    .eq('id', input.builderId)
    .maybeSingle()

  if (builderError || !builder?.user_id) {
    if (builderError) {
      console.warn('[ticket-webhooks] Failed to load builder for stale-secret notification', {
        builder_id: input.builderId,
        error: builderError.message,
      })
    }
    return
  }

  const userId = String(builder.user_id)
  const groupKey = `ticketing-stale-secret:${input.provider}:${input.connectionId}`
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { data: existing, error: existingError } = await admin
    .from('notifications')
    .select('id')
    .eq('user_id', userId)
    .eq('group_key', groupKey)
    .gte('created_at', cutoff)
    .limit(1)
    .maybeSingle()

  if (existingError) {
    console.warn('[ticket-webhooks] Failed to check stale-secret notification rate limit', {
      user_id: userId,
      provider: input.provider,
      error: existingError.message,
    })
    return
  }

  if (existing) return

  const providerLabel = labelTicketProvider(input.provider)
  const { error } = await admin.from('notifications').insert({
    user_id: userId,
    type: 'ticketing_reconnect_required',
    notification_type: 'ticketing_reconnect_required',
    title: `${providerLabel} needs reconnecting`,
    message: `We upgraded token security and need you to reconnect ${providerLabel} before ticketing data can sync again.`,
    action_url: '/planner/tickets',
    link_url: '/planner/tickets',
    group_key: groupKey,
    related_id: input.connectionId,
    metadata: {
      provider: input.provider,
      builder_id: input.builderId,
      connection_id: input.connectionId,
      reason: STALE_SECRET_ERROR,
    },
    created_at: new Date().toISOString(),
  } as never)

  if (error) {
    console.warn('[ticket-webhooks] Failed to insert stale-secret notification', {
      user_id: userId,
      provider: input.provider,
      error: error.message,
    })
  }
}

function labelTicketProvider(provider: WebhookPlatform) {
  if (provider === 'posh') return 'Posh'
  if (provider === 'luma') return 'Luma'
  return 'Partiful'
}

/**
 * Stores the raw webhook delivery for test/debug visibility.
 *
 * @param admin - Service-role Supabase client.
 * @param platform - Ticketing platform name.
 * @param payload - Raw webhook payload.
 * @param headers - Incoming request headers.
 * @param context - Resolved event/integration context.
 * @param processingError - Optional processing issue to persist.
 * @returns Stored delivery id when available.
 */
export async function recordWebhookDelivery(
  admin: SupabaseAdminClient,
  platform: WebhookPlatform,
  payload: JsonObject,
  headers: Headers,
  context: IntegrationContext,
  processingError?: string | null
) {
  const webhookId = getDeliveryId(platform, payload, headers)

  const { data, error } = await admin
    .from('event_webhook_events')
    .upsert(
      {
        platform,
        event_id: context.eventId,
        integration_id: context.integrationId,
        external_event_id: context.externalEventId,
        webhook_event_id: webhookId,
        webhook_type: getWebhookType(payload),
        payload,
        headers: normalizeHeaderObject(headers),
        processed_at: processingError ? null : new Date().toISOString(),
        processing_error: processingError ?? null,
      } as never,
      webhookId ? { onConflict: 'platform,webhook_event_id' } : undefined
    )
    .select('id')
    .maybeSingle()

  if (error) throw error
  return data?.id ?? null
}

/**
 * Builds a stable delivery id for idempotent webhook logging.
 *
 * @param platform - Ticketing platform name.
 * @param payload - Raw webhook payload.
 * @param headers - Incoming request headers.
 * @returns Provider/header id, or a derived id, or null.
 */
function getDeliveryId(platform: WebhookPlatform, payload: JsonObject, headers: Headers) {
  const headerId = headers.get('webhook-id')
  if (headerId) return headerId

  if (platform === 'posh') {
    const type = getWebhookType(payload) ?? 'unknown'
    const orderId = firstString(payload, ['order_number', 'tracking_link'])
    const updatedAt = firstString(payload, ['update_date', 'date_purchased'])
    const eventId = firstString(payload, ['event_id']) ?? 'posh'
    return orderId ? `${type}:${eventId}:${orderId}:${updatedAt ?? 'initial'}` : null
  }

  if (platform === 'partiful') {
    const type = getWebhookType(payload) ?? 'unknown'
    const eventId = extractPartifulExternalEventId(payload) ?? 'partiful'
    const recordId = firstString(payload, [
      'order_id',
      'ticket_id',
      'rsvp_id',
      'guest_id',
      'attendee_id',
      'data.order_id',
      'data.ticket_id',
      'data.rsvp_id',
      'data.guest.id',
      'data.attendee.id',
      'id',
    ])
    return recordId ? `${type}:${eventId}:${recordId}` : null
  }

  return firstString(payload, [
    'webhook_id',
    'id',
    'data.ticket.api_id',
    'data.ticket.id',
    'data.ticket_id',
    'data.guest.api_id',
    'data.guest.id',
    'data.api_id',
    'data.id',
  ])
}

/**
 * Maps Posh webhook shapes into the sales table payload.
 *
 * Supports both real Posh payloads (`new_order`, `order_updated`) and the
 * normalized payload shape documented for tests.
 *
 * @param context - Resolved event/integration context.
 * @param payload - Raw Posh webhook payload.
 * @returns Sales row payload or null when the event is non-financial.
 */
function mapPoshSale(context: IntegrationContext, payload: JsonObject): SalesPayload | null {
  if (!context.eventId) return null

  const type = asString(payload.type) ?? 'unknown'
  const action = asString(payload.action)
  const hasNormalizedOrder = Boolean(asString(payload.order_id))
  const isApprovedPendingOrder = type === 'pending_order_actioned' && action === 'approved'
  const isSale = type === 'new_order' || isApprovedPendingOrder || hasNormalizedOrder
  const isRefundUpdate =
    (POSH_REFUND_TYPES.has(type) || hasNormalizedOrder) &&
    (Boolean(payload.cancelled) ||
      Boolean(payload.refunded) ||
      Boolean(payload.disputed) ||
      asString(payload.refund_status) === 'completed' ||
      (asNumber(payload.partialRefund) ?? 0) > 0)

  if (!isSale && !isRefundUpdate) return null

  const items = Array.isArray(payload.items) ? payload.items.filter(isObject) : []
  const normalizedQuantity = Math.abs(asNumber(payload.ticket_quantity) ?? 0)
  const quantity = Math.max(items.length, normalizedQuantity, 1)
  const subtotal =
    asNumber(payload.subtotal) ??
    asNumber(payload.total_amount) ??
    items.reduce((sum, item) => sum + (asNumber(item.price) ?? 0), 0)
  const total = asNumber(payload.total) ?? asNumber(payload.total_amount) ?? subtotal
  const partialRefund = asNumber(payload.partialRefund) ?? 0
  const refundAmount = partialRefund > 0 ? partialRefund : total
  const externalEventId = asString(payload.event_id) ?? 'posh'
  const poshOrderId = asString(payload.order_id) ?? asString(payload.order_number) ?? asString(payload.tracking_link)
  const baseOrderId = poshOrderId
    ? `${externalEventId}:${poshOrderId}`
    : `${externalEventId}:${asString(payload.date_purchased) ?? Date.now()}`
  const orderId = isRefundUpdate ? `${baseOrderId}:refund` : baseOrderId
  const ticketType =
    asString(payload.ticket_type) ??
    (items.map((item) => asString(item.name)).filter(Boolean).join(', ') || null)
  const firstItemPrice = asNumber(payload.ticket_price) ?? (quantity === 1 ? asNumber(items[0]?.price) : null)
  const averageItemPrice = quantity > 0 && subtotal > 0 ? subtotal / quantity : null
  const ticketPrice = firstItemPrice ?? (averageItemPrice === null ? null : roundMoney(averageItemPrice))
  const totalAmount = roundMoney(isRefundUpdate ? -Math.abs(refundAmount) : total)
  const fees = isRefundUpdate ? 0 : roundMoney(asNumber(payload.fees) ?? Math.max(total - subtotal, 0))
  const ticketPriceCents = centsFromMajorAmount(ticketPrice)
  const totalAmountCents = centsFromMajorAmount(totalAmount) ?? 0
  const feesCents = centsFromMajorAmount(fees) ?? 0
  const ticketTierName = ticketType ?? 'Unknown'
  const buyerName = asString(payload.ticket_buyer_name) ?? [asString(payload.account_first_name), asString(payload.account_last_name)]
    .filter(Boolean)
    .join(' ')
    .trim()
  const receivedAt = new Date().toISOString()

  return {
    event_id: context.eventId,
    integration_id: context.integrationId,
    order_id: orderId,
    platform: 'posh',
    ticket_buyer_name: buyerName || null,
    ticket_buyer_email: asString(payload.ticket_buyer_email) ?? asString(payload.account_email),
    ticket_quantity: isRefundUpdate ? -quantity : quantity,
    ticket_type: ticketType,
    ticket_tier_name: ticketTierName,
    ticket_tier_category: classifyTicketTier(ticketTierName, ticketPriceCents),
    ticket_price: ticketPrice,
    ticket_price_cents: ticketPriceCents,
    total_amount: totalAmount,
    total_amount_cents: totalAmountCents,
    fees,
    fees_cents: feesCents,
    currency: normalizeCurrency(payload.currency),
    discount_code: asString(payload.discount_code) ?? asString(payload.promo_code),
    is_refund: isRefundUpdate,
    purchase_timestamp: asString(payload.purchase_timestamp) ?? asString(payload.date_purchased) ?? asString(payload.update_date),
    raw_ticket_class_id: asString(items[0]?.ticket_id) ?? asString(items[0]?.item_id) ?? asString(payload.ticket_class_id),
    sales_channel: asString(payload.sales_channel) ?? asString(payload.source) ?? asString(payload.platform),
    source: 'posh_webhook',
    received_at: receivedAt,
    gross_cents: Math.max(totalAmountCents, 0),
    tier_name: ticketTierName,
    raw_data: payload,
  }
}

/**
 * Maps Posh purchase payloads into one imported attendee record per ticket.
 *
 * @param context - Resolved event/integration context.
 * @param payload - Raw Posh webhook payload.
 * @returns Attendee payloads to upsert.
 */
function mapPoshAttendees(context: IntegrationContext, payload: JsonObject): ImportedAttendeePayload[] {
  if (!context.integrationId || !context.eventId) return []
  const hasNormalizedOrder = Boolean(asString(payload.order_id))
  if (!POSH_SALE_TYPES.has(asString(payload.type) ?? '') && !hasNormalizedOrder) return []
  if (asString(payload.type) === 'pending_order_actioned' && asString(payload.action) !== 'approved') return []

  const items = Array.isArray(payload.items) ? payload.items.filter(isObject) : []
  const buyerName = asString(payload.ticket_buyer_name) ?? [asString(payload.account_first_name), asString(payload.account_last_name)]
    .filter(Boolean)
    .join(' ')
    .trim()
  const { firstName, lastName } = splitName(buyerName)
  const externalEventId = asString(payload.event_id) ?? 'posh'
  const rawOrderId = asString(payload.order_id) ?? asString(payload.order_number) ?? asString(payload.tracking_link)
  const orderId = rawOrderId ? `${externalEventId}:${rawOrderId}` : null
  const normalizedQuantity = Math.max(Math.abs(asNumber(payload.ticket_quantity) ?? 0), 1)
  const attendeeItems = items.length > 0
    ? items
    : Array.from({ length: normalizedQuantity }, (_, index) => ({
        item_id: `${rawOrderId ?? 'order'}_${index}`,
        name: asString(payload.ticket_type),
        price: asNumber(payload.ticket_price),
      }))

  return attendeeItems.map((item, index) => ({
    integration_id: context.integrationId!,
    event_id: context.eventId!,
    external_attendee_id: `${orderId ?? asString(payload.date_purchased) ?? 'posh'}:${asString(item.item_id) ?? index}`,
    first_name: firstName,
    last_name: lastName,
    email: asString(payload.ticket_buyer_email) ?? asString(payload.account_email),
    ticket_type: asString(item.name),
    ticket_class: asString(item.name),
    ticket_tier_name: asString(item.name) ?? 'Unknown',
    ticket_tier_category: classifyTicketTier(asString(item.name), centsFromMajorAmount(asNumber(item.price))),
    order_id: orderId,
    checked_in: false,
    check_in_time: null,
    check_in_method: null,
    ticket_price: asNumber(item.price),
    ticket_price_cents: centsFromMajorAmount(asNumber(item.price)),
    raw_ticket_class_id: asString((item as JsonObject).ticket_id) ?? asString(item.item_id),
    raw_data: {
      order: payload,
      item,
    },
  }))
}

/**
 * Maps Luma webhook shapes into the sales table payload.
 *
 * Supports both Luma `ticket.registered` webhooks and the normalized payload
 * shape used for test payloads when full Luma fields are unavailable.
 *
 * @param context - Resolved event/integration context.
 * @param payload - Raw Luma webhook payload.
 * @param webhookId - Luma `Webhook-Id` header.
 * @returns Sales row payload or null when no ticket sale is present.
 */
function mapLumaSale(context: IntegrationContext, payload: JsonObject, webhookId: string | null): SalesPayload | null {
  const hasNormalizedOrder = Boolean(asString(payload.order_id))
  if (!context.eventId || (getWebhookType(payload) !== 'ticket.registered' && !hasNormalizedOrder)) return null

  const data = isObject(payload.data) ? payload.data : {}
  const ticketId =
    asString(payload.order_id) ??
    firstString(payload, [
      'data.ticket.api_id',
      'data.ticket.id',
      'data.ticket_id',
      'data.ticket_key',
      'data.api_id',
      'data.id',
    ]) ?? webhookId

  if (!ticketId) return null

  const ticketPrice = firstMoney(
    payload,
    [
      'ticket_price',
      'data.ticket.price',
      'data.ticket.amount',
      'data.ticket_type.price',
      'data.event_ticket_type.price',
      'data.price',
      'data.amount',
    ],
    [
      'data.ticket.cents',
      'data.ticket.price_cents',
      'data.ticket_type.cents',
      'data.event_ticket_type.cents',
      'data.price_cents',
      'data.amount_cents',
    ]
  )
  const totalAmount = firstMoney(
    payload,
    ['total_amount', 'data.total_amount', 'data.total', 'data.order.total_amount', 'data.order.total'],
    ['total_amount_cents', 'data.total_amount_cents', 'data.total_cents', 'data.order.total_amount_cents', 'data.order.total_cents']
  )
  const feeAmount = firstMoney(payload, ['fees', 'data.fees', 'data.fee'], ['fees_cents', 'data.fees_cents', 'data.fee_cents']) ?? 0
  const isRefund = asString(payload.refund_status) === 'completed'
  const signedQuantity = isRefund ? -Math.abs(asNumber(payload.ticket_quantity) ?? 1) : asNumber(payload.ticket_quantity) ?? 1
  const signedTotalAmount = isRefund ? -Math.abs(totalAmount ?? ticketPrice ?? 0) : totalAmount ?? ticketPrice ?? 0
  const ticketTierName = asString(payload.ticket_type) ?? firstString(payload, [
    'data.ticket_type.name',
    'data.event_ticket_type.name',
    'data.ticket.name',
    'data.ticket_type',
  ]) ?? 'Unknown'
  const ticketPriceCents = centsFromMajorAmount(ticketPrice)
  const totalAmountCents = centsFromMajorAmount(signedTotalAmount) ?? 0
  const receivedAt = new Date().toISOString()
  const buyerName = asString(payload.ticket_buyer_name) ?? firstString(payload, [
    'data.guest.name',
    'data.guest.full_name',
    'data.user.name',
    'data.buyer.name',
    'data.name',
  ])

  return {
    event_id: context.eventId,
    integration_id: context.integrationId,
    order_id: `${asString(payload.event_id) ?? context.externalEventId ?? 'luma'}:${ticketId}`,
    platform: 'luma',
    ticket_buyer_name: buyerName,
    ticket_buyer_email: asString(payload.ticket_buyer_email) ?? firstString(payload, [
      'data.guest.email',
      'data.user.email',
      'data.buyer.email',
      'data.email',
      'data.user_email',
    ]),
    ticket_quantity: signedQuantity,
    ticket_type: ticketTierName,
    ticket_tier_name: ticketTierName,
    ticket_tier_category: classifyTicketTier(ticketTierName, ticketPriceCents),
    ticket_price: ticketPrice,
    ticket_price_cents: ticketPriceCents,
    total_amount: signedTotalAmount,
    total_amount_cents: totalAmountCents,
    fees: feeAmount,
    fees_cents: centsFromMajorAmount(feeAmount) ?? 0,
    currency: normalizeCurrency(firstString(payload, ['currency', 'data.currency', 'data.ticket.currency', 'data.order.currency'])),
    discount_code: asString(payload.discount_code) ?? firstString(payload, [
      'data.coupon_info.code',
      'data.coupon.code',
      'data.discount_code',
      'data.order.coupon_info.code',
    ]),
    is_refund: isRefund,
    purchase_timestamp:
      asString(payload.purchase_timestamp) ??
      firstString(payload, ['data.registered_at', 'data.created_at', 'data.ticket.created_at']) ??
      new Date().toISOString(),
    raw_ticket_class_id: firstString(payload, [
      'data.ticket_type.api_id',
      'data.ticket_type.id',
      'data.event_ticket_type.api_id',
      'data.event_ticket_type.id',
      'data.ticket.ticket_type_id',
    ]),
    sales_channel: firstString(payload, ['data.source', 'data.channel', 'source', 'channel']),
    source: 'luma_webhook',
    received_at: receivedAt,
    gross_cents: Math.max(totalAmountCents, 0),
    tier_name: ticketTierName,
    raw_data: data,
  }
}

/**
 * Maps Luma guest/ticket payloads into imported attendee records.
 *
 * @param context - Resolved event/integration context.
 * @param payload - Raw Luma webhook payload.
 * @param webhookId - Luma `Webhook-Id` header.
 * @returns Attendee payload or null when no guest identity is present.
 */
function mapLumaAttendee(context: IntegrationContext, payload: JsonObject, webhookId: string | null): ImportedAttendeePayload | null {
  if (!context.integrationId || !context.eventId) return null
  const hasNormalizedOrder = Boolean(asString(payload.order_id))
  if (!['guest.registered', 'guest.updated', 'ticket.registered'].includes(getWebhookType(payload) ?? '') && !hasNormalizedOrder) return null

  const guestId =
    asString(payload.order_id) ??
    firstString(payload, [
      'data.guest.api_id',
      'data.guest.id',
      'data.guest_id',
      'data.api_id',
      'data.id',
      'data.ticket.guest_id',
    ]) ?? webhookId

  if (!guestId) return null

  const fullName = asString(payload.ticket_buyer_name) ?? firstString(payload, ['data.guest.name', 'data.guest.full_name', 'data.name'])
  const { firstName, lastName } = splitName(fullName)
  const approvalStatus = firstString(payload, ['data.approval_status', 'data.status'])

  return {
    integration_id: context.integrationId,
    event_id: context.eventId,
    external_attendee_id: `${asString(payload.event_id) ?? context.externalEventId ?? 'luma'}:${guestId}`,
    first_name: firstString(payload, ['data.guest.first_name', 'data.first_name']) ?? firstName,
    last_name: firstString(payload, ['data.guest.last_name', 'data.last_name']) ?? lastName,
    email: asString(payload.ticket_buyer_email) ?? firstString(payload, ['data.guest.email', 'data.email', 'data.user_email']),
    ticket_type: asString(payload.ticket_type) ?? firstString(payload, [
      'data.ticket_type.name',
      'data.event_ticket_type.name',
      'data.ticket.name',
      'data.ticket_type',
    ]),
    ticket_class: approvalStatus,
    ticket_tier_name: asString(payload.ticket_type) ?? firstString(payload, [
      'data.ticket_type.name',
      'data.event_ticket_type.name',
      'data.ticket.name',
      'data.ticket_type',
    ]) ?? 'Unknown',
    ticket_tier_category: classifyTicketTier(
      asString(payload.ticket_type) ?? firstString(payload, [
        'data.ticket_type.name',
        'data.event_ticket_type.name',
        'data.ticket.name',
        'data.ticket_type',
      ]),
      firstMoney(
        payload,
        ['ticket_price', 'data.ticket.price', 'data.ticket_type.price', 'data.event_ticket_type.price', 'data.price'],
        ['ticket_price_cents', 'data.ticket.price_cents', 'data.ticket_type.cents', 'data.event_ticket_type.cents', 'data.price_cents']
      ) === null
        ? null
        : centsFromMajorAmount(firstMoney(
            payload,
            ['ticket_price', 'data.ticket.price', 'data.ticket_type.price', 'data.event_ticket_type.price', 'data.price'],
            ['ticket_price_cents', 'data.ticket.price_cents', 'data.ticket_type.cents', 'data.event_ticket_type.cents', 'data.price_cents']
          ))
    ),
    order_id: asString(payload.order_id) ?? firstString(payload, ['data.order.id', 'data.order.api_id', 'data.ticket.order_id', 'data.ticket.id']),
    checked_in: Boolean(getPath(payload, 'data.checked_in_at') || getPath(payload, 'data.checked_in')),
    check_in_time: firstString(payload, ['data.checked_in_at']),
    check_in_method: null,
    ticket_price: firstMoney(
      payload,
      ['ticket_price', 'data.ticket.price', 'data.ticket_type.price', 'data.event_ticket_type.price', 'data.price'],
      ['ticket_price_cents', 'data.ticket.price_cents', 'data.ticket_type.cents', 'data.event_ticket_type.cents', 'data.price_cents']
    ),
    ticket_price_cents: centsFromMajorAmount(firstMoney(
      payload,
      ['ticket_price', 'data.ticket.price', 'data.ticket_type.price', 'data.event_ticket_type.price', 'data.price'],
      ['ticket_price_cents', 'data.ticket.price_cents', 'data.ticket_type.cents', 'data.event_ticket_type.cents', 'data.price_cents']
    )),
    raw_ticket_class_id: firstString(payload, [
      'data.ticket_type.api_id',
      'data.ticket_type.id',
      'data.event_ticket_type.api_id',
      'data.event_ticket_type.id',
      'data.ticket.ticket_type_id',
    ]),
    raw_data: isObject(payload.data) ? payload.data : payload,
  }
}

/**
 * Maps Partiful RSVP/ticket payloads into normalized ticket sales.
 *
 * Partiful integration starts as event-link and webhook import support, so this
 * accepts broad normalized field names in addition to likely RSVP shapes.
 */
function mapPartifulSale(context: IntegrationContext, payload: JsonObject, webhookId: string | null): SalesPayload | null {
  if (!context.eventId) return null

  const recordId = firstString(payload, [
    'order_id',
    'ticket_id',
    'rsvp_id',
    'guest_id',
    'attendee_id',
    'data.order_id',
    'data.ticket_id',
    'data.rsvp_id',
    'data.guest.id',
    'data.attendee.id',
  ]) ?? webhookId

  if (!recordId) return null

  const eventId = asString(payload.event_id) ?? context.externalEventId ?? extractPartifulExternalEventId(payload) ?? 'partiful'
  const status = firstString(payload, ['status', 'data.status', 'data.rsvp.status'])?.toLowerCase() ?? ''
  const type = getWebhookType(payload)?.toLowerCase() ?? ''
  const isRefund = /refund|cancel|declin|remove/.test(`${type} ${status}`)
  const quantity = Math.max(Math.abs(firstNumber(payload, ['ticket_quantity', 'quantity', 'data.quantity']) ?? 1), 1)
  const ticketPrice = firstMoney(
    payload,
    ['ticket_price', 'price', 'amount', 'data.ticket.price', 'data.price', 'data.amount'],
    ['ticket_price_cents', 'price_cents', 'amount_cents', 'data.ticket.price_cents', 'data.price_cents', 'data.amount_cents']
  )
  const totalAmount = firstMoney(
    payload,
    ['total_amount', 'total', 'data.total_amount', 'data.total'],
    ['total_amount_cents', 'total_cents', 'data.total_amount_cents', 'data.total_cents']
  ) ?? roundMoney((ticketPrice ?? 0) * quantity)
  const feeAmount = firstMoney(payload, ['fees', 'fee', 'data.fees', 'data.fee'], ['fees_cents', 'fee_cents', 'data.fees_cents', 'data.fee_cents']) ?? 0
  const ticketTierName = firstString(payload, [
    'ticket_tier_name',
    'ticket_type',
    'tier_name',
    'data.ticket_tier_name',
    'data.ticket_type',
    'data.ticket.name',
    'data.tier.name',
  ]) ?? (ticketPrice === 0 ? 'Free RSVP' : 'General Admission')
  const ticketPriceCents = centsFromMajorAmount(ticketPrice)
  const buyerName = asString(payload.ticket_buyer_name) ?? firstString(payload, [
    'data.guest.name',
    'data.guest.full_name',
    'data.attendee.name',
    'data.name',
  ])

  return {
    event_id: context.eventId,
    integration_id: context.integrationId,
    order_id: `${eventId}:${recordId}${isRefund ? ':refund' : ''}`,
    platform: 'partiful',
    ticket_buyer_name: buyerName,
    ticket_buyer_email: asString(payload.ticket_buyer_email) ?? firstString(payload, [
      'data.guest.email',
      'data.attendee.email',
      'data.email',
      'email',
    ]),
    ticket_quantity: isRefund ? -quantity : quantity,
    ticket_type: ticketTierName,
    ticket_tier_name: ticketTierName,
    ticket_tier_category: classifyTicketTier(ticketTierName, ticketPriceCents),
    ticket_price: ticketPrice,
    ticket_price_cents: ticketPriceCents,
    total_amount: isRefund ? -Math.abs(totalAmount) : totalAmount,
    total_amount_cents: centsFromMajorAmount(isRefund ? -Math.abs(totalAmount) : totalAmount) ?? 0,
    fees: isRefund ? 0 : feeAmount,
    fees_cents: isRefund ? 0 : centsFromMajorAmount(feeAmount) ?? 0,
    currency: normalizeCurrency(firstString(payload, ['currency', 'data.currency'])),
    discount_code: asString(payload.discount_code) ?? firstString(payload, ['promo_code', 'data.discount_code', 'data.promo_code']),
    is_refund: isRefund,
    purchase_timestamp:
      asString(payload.purchase_timestamp) ??
      firstString(payload, ['created_at', 'updated_at', 'data.created_at', 'data.updated_at']) ??
      new Date().toISOString(),
    raw_ticket_class_id: firstString(payload, ['ticket_class_id', 'tier_id', 'data.ticket.id', 'data.tier.id']),
    sales_channel: firstString(payload, ['sales_channel', 'source', 'data.source']) ?? 'partiful_import',
    raw_data: payload,
  }
}

/**
 * Maps Partiful RSVP/ticket payloads into imported attendee records.
 */
function mapPartifulAttendee(context: IntegrationContext, payload: JsonObject, webhookId: string | null): ImportedAttendeePayload | null {
  if (!context.integrationId || !context.eventId) return null

  const attendeeId = firstString(payload, [
    'attendee_id',
    'guest_id',
    'rsvp_id',
    'ticket_id',
    'order_id',
    'data.attendee.id',
    'data.guest.id',
    'data.rsvp_id',
    'data.ticket_id',
  ]) ?? webhookId

  if (!attendeeId) return null

  const fullName = asString(payload.ticket_buyer_name) ?? firstString(payload, [
    'data.guest.name',
    'data.guest.full_name',
    'data.attendee.name',
    'data.name',
  ])
  const { firstName, lastName } = splitName(fullName)
  const ticketPrice = firstMoney(
    payload,
    ['ticket_price', 'price', 'amount', 'data.ticket.price', 'data.price', 'data.amount'],
    ['ticket_price_cents', 'price_cents', 'amount_cents', 'data.ticket.price_cents', 'data.price_cents', 'data.amount_cents']
  )
  const ticketTierName = firstString(payload, [
    'ticket_tier_name',
    'ticket_type',
    'tier_name',
    'data.ticket_tier_name',
    'data.ticket_type',
    'data.ticket.name',
    'data.tier.name',
  ]) ?? (ticketPrice === 0 ? 'Free RSVP' : 'General Admission')

  return {
    integration_id: context.integrationId,
    event_id: context.eventId,
    external_attendee_id: `${asString(payload.event_id) ?? context.externalEventId ?? 'partiful'}:${attendeeId}`,
    first_name: firstString(payload, ['first_name', 'data.guest.first_name', 'data.attendee.first_name']) ?? firstName,
    last_name: firstString(payload, ['last_name', 'data.guest.last_name', 'data.attendee.last_name']) ?? lastName,
    email: asString(payload.ticket_buyer_email) ?? firstString(payload, [
      'email',
      'data.guest.email',
      'data.attendee.email',
      'data.email',
    ]),
    ticket_type: ticketTierName,
    ticket_class: firstString(payload, ['status', 'data.status', 'data.rsvp.status']),
    ticket_tier_name: ticketTierName,
    ticket_tier_category: classifyTicketTier(ticketTierName, centsFromMajorAmount(ticketPrice)),
    order_id: firstString(payload, ['order_id', 'data.order_id', 'ticket_id', 'data.ticket_id']),
    checked_in: Boolean(getPath(payload, 'checked_in') || getPath(payload, 'data.checked_in') || getPath(payload, 'data.checked_in_at')),
    check_in_time: firstString(payload, ['check_in_time', 'checked_in_at', 'data.checked_in_at']),
    check_in_method: firstString(payload, ['check_in_method', 'data.check_in_method']),
    ticket_price: ticketPrice,
    ticket_price_cents: centsFromMajorAmount(ticketPrice),
    raw_ticket_class_id: firstString(payload, ['ticket_class_id', 'tier_id', 'data.ticket.id', 'data.tier.id']),
    raw_data: isObject(payload.data) ? payload.data : payload,
  }
}

/**
 * Upserts sales rows idempotently by provider/order id.
 *
 * @param admin - Service-role Supabase client.
 * @param sales - Sales rows to upsert.
 */
async function upsertSales(admin: SupabaseAdminClient, sales: SalesPayload[]) {
  if (!sales.length) return

  const { error } = await admin
    .from('event_sales_data')
    .upsert(sales as never, { onConflict: 'event_id,platform,order_id' })

  if (error) throw error
}

async function upsertPoshPlatformFeeCommitment(
  admin: SupabaseAdminClient,
  context: IntegrationContext,
  sale: SalesPayload | null
) {
  if (!sale || sale.platform !== 'posh' || sale.is_refund || sale.fees_cents <= 0 || !context.eventId) return

  const builderId = context.builderId ?? await loadEventBuilderId(admin, context.eventId)
  if (!builderId) return

  await upsertCommitment(admin, {
    event_id: context.eventId,
    plan_id: null,
    org_id: builderId,
    category: 'platform_fee',
    party_id: null,
    party_name: 'Posh',
    description: `Posh platform fee for order ${sale.order_id}`,
    amount_cents: sale.fees_cents,
    state: 'paid',
    confidence: 'high',
    evidence_type: 'none',
    source: 'webhook',
    source_ref: `posh:${sale.order_id}:platform_fee`,
    paid_at: sale.purchase_timestamp ?? sale.received_at,
    metadata: {
      platform: 'posh',
      order_id: sale.order_id,
      external_event_id: context.externalEventId,
      integration_id: context.integrationId,
      gross_cents: sale.gross_cents ?? null,
      fees_cents: sale.fees_cents,
      tier_name: sale.tier_name ?? null,
      received_at: sale.received_at ?? null,
    },
  })
}

async function loadEventBuilderId(admin: SupabaseAdminClient, eventId: string) {
  const { data, error } = await admin
    .from('events')
    .select('builder_id')
    .eq('id', eventId)
    .maybeSingle()

  if (error) throw error
  return typeof data?.builder_id === 'string' ? data.builder_id : null
}

/**
 * Upserts imported attendees idempotently by integration/external attendee id.
 *
 * @param admin - Service-role Supabase client.
 * @param attendees - Attendee rows to upsert.
 */
async function upsertAttendees(admin: SupabaseAdminClient, attendees: ImportedAttendeePayload[]) {
  if (!attendees.length) return

  const { error } = await admin
    .from('imported_attendees')
    .upsert(attendees as never, { onConflict: 'integration_id,external_attendee_id' })

  if (error) throw error
}

/**
 * Processes a Posh webhook into sales, attendees, and financial summaries.
 *
 * @param admin - Service-role Supabase client.
 * @param payload - Raw Posh webhook payload.
 * @param context - Resolved event/integration context.
 * @returns Processing summary for logging/API response.
 */
export async function processPoshWebhook(
  admin: SupabaseAdminClient,
  payload: JsonObject,
  context: IntegrationContext
): Promise<ProcessWebhookResult> {
  const sale = mapPoshSale(context, payload)
  const attendees = mapPoshAttendees(context, payload)

  if (!context.eventId) {
    await quarantineUnlinkedPoshEvent({
      db: admin,
      builderId: context.builderId,
      poshEventId: context.externalEventId,
      webhookEventId: getDeliveryId('posh', payload, new Headers()),
      webhookType: getWebhookType(payload),
      payload,
    })

    return {
      processed: false,
      integrationId: context.integrationId,
      eventId: null,
      externalEventId: context.externalEventId,
      webhookType: getWebhookType(payload),
      salesUpserted: 0,
      attendeesUpserted: 0,
      skippedReason: 'No linked 3rdPlace event found',
    }
  }

  await upsertSales(admin, sale ? [sale] : [])
  await upsertPoshPlatformFeeCommitment(admin, context, sale)
  await upsertAttendees(admin, attendees)
  await recalculateEventFinancials(admin, context.eventId)

  return {
    processed: true,
    integrationId: context.integrationId,
    eventId: context.eventId,
    externalEventId: context.externalEventId,
    webhookType: getWebhookType(payload),
    salesUpserted: sale ? 1 : 0,
    attendeesUpserted: attendees.length,
  }
}

export async function recordPoshWebhookHeartbeat(
  admin: SupabaseAdminClient,
  context: IntegrationContext,
  payload: JsonObject
) {
  await markPoshHeartbeat({
    db: admin,
    builderId: context.builderId,
    webhookType: getWebhookType(payload),
  })
}

/**
 * Processes a Luma webhook into sales, attendees, and financial summaries.
 *
 * @param admin - Service-role Supabase client.
 * @param payload - Raw Luma webhook payload.
 * @param context - Resolved event/integration context.
 * @param webhookId - Luma `Webhook-Id` header.
 * @returns Processing summary for logging/API response.
 */
export async function processLumaWebhook(
  admin: SupabaseAdminClient,
  payload: JsonObject,
  context: IntegrationContext,
  webhookId: string | null
): Promise<ProcessWebhookResult> {
  const sale = mapLumaSale(context, payload, webhookId)
  const attendee = mapLumaAttendee(context, payload, webhookId)

  if (!context.eventId) {
    return {
      processed: false,
      integrationId: context.integrationId,
      eventId: null,
      externalEventId: context.externalEventId,
      webhookType: getWebhookType(payload),
      salesUpserted: 0,
      attendeesUpserted: 0,
      skippedReason: 'No linked 3rdPlace event found',
    }
  }

  await upsertSales(admin, sale ? [sale] : [])
  await upsertAttendees(admin, attendee ? [attendee] : [])
  await recalculateEventFinancials(admin, context.eventId)

  return {
    processed: true,
    integrationId: context.integrationId,
    eventId: context.eventId,
    externalEventId: context.externalEventId,
    webhookType: getWebhookType(payload),
    salesUpserted: sale ? 1 : 0,
    attendeesUpserted: attendee ? 1 : 0,
  }
}

/**
 * Processes a Partiful webhook into sales, attendees, and financial summaries.
 *
 * @param admin - Service-role Supabase client.
 * @param payload - Raw Partiful webhook payload.
 * @param context - Resolved event/integration context.
 * @param webhookId - Optional provider/header id.
 * @returns Processing summary for logging/API response.
 */
export async function processPartifulWebhook(
  admin: SupabaseAdminClient,
  payload: JsonObject,
  context: IntegrationContext,
  webhookId: string | null
): Promise<ProcessWebhookResult> {
  const sale = mapPartifulSale(context, payload, webhookId)
  const attendee = mapPartifulAttendee(context, payload, webhookId)

  if (!context.eventId) {
    return {
      processed: false,
      integrationId: context.integrationId,
      eventId: null,
      externalEventId: context.externalEventId,
      webhookType: getWebhookType(payload),
      salesUpserted: 0,
      attendeesUpserted: 0,
      skippedReason: 'No linked 3rdPlace event found',
    }
  }

  await upsertSales(admin, sale ? [sale] : [])
  await upsertAttendees(admin, attendee ? [attendee] : [])
  await recalculateEventFinancials(admin, context.eventId)

  return {
    processed: true,
    integrationId: context.integrationId,
    eventId: context.eventId,
    externalEventId: context.externalEventId,
    webhookType: getWebhookType(payload),
    salesUpserted: sale ? 1 : 0,
    attendeesUpserted: attendee ? 1 : 0,
  }
}

/**
 * Parses and validates raw webhook JSON.
 *
 * @param rawBody - Unparsed request body.
 * @returns Parsed object body.
 * @throws When the body is invalid JSON or not an object.
 */
export function parseWebhookJson(rawBody: string) {
  const parsed = JSON.parse(rawBody)
  if (!isObject(parsed)) {
    throw new Error('Webhook body must be a JSON object')
  }
  return parsed
}
