import 'server-only'

import { createServiceRoleClient } from '@/lib/supabase/server'
import {
  fetchEventbriteAttendeePage,
  getEventbriteAccessToken,
  type EventbriteIntegrationRow,
} from '@/lib/server/eventbrite'
import {
  centsFromEventbriteCost,
  classifyTicketTier,
  majorAmountFromCents,
  normalizeCurrency,
  type TicketTierCategory,
} from '@/lib/server/ticket-normalization'

type ImportedAttendeePayload = {
  integration_id: string
  event_id: string
  external_attendee_id: string
  first_name: string | null
  last_name: string | null
  email: string | null
  ticket_type: string | null
  ticket_tier_name: string | null
  ticket_tier_category: TicketTierCategory
  order_id: string | null
  checked_in: boolean
  check_in_time: string | null
  ticket_price_cents: number | null
  raw_ticket_class_id: string | null
  raw_data: Record<string, any>
}

type ImportedSalePayload = {
  integration_id: string
  event_id: string
  order_id: string
  platform: 'eventbrite'
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
  source: string
  received_at: string
  gross_cents: number
  tier_name: string
  raw_data: Record<string, any>
}

type EventbriteAttendeeInput = {
  id: string
  checked_in?: boolean | null
  checked_in_at?: string | null
  ticket_class_id?: string | null
  ticket_class_name?: string | null
  order_id?: string | null
  status?: string | null
  cancelled?: boolean | null
  canceled?: boolean | null
  refunded?: boolean | null
  voided?: boolean | null
  cancelled_at?: string | null
  canceled_at?: string | null
  refunded_at?: string | null
  created?: string | null
  changed?: string | null
  costs?: {
    gross?: Record<string, unknown> | null
    eventbrite_fee?: Record<string, unknown> | null
    payment_fee?: Record<string, unknown> | null
    tax?: Record<string, unknown> | null
  } | null
  profile?: {
    first_name?: string | null
    last_name?: string | null
    email?: string | null
  } | null
}

export function mapEventbriteAttendee(
  integrationId: string,
  eventId: string,
  attendee: EventbriteAttendeeInput
): ImportedAttendeePayload {
  const ticketPriceCents = centsFromEventbriteCost(attendee.costs?.gross)
  const tierName = attendee.ticket_class_name ?? 'Unknown'

  return {
    integration_id: integrationId,
    event_id: eventId,
    external_attendee_id: attendee.id,
    first_name: attendee.profile?.first_name ?? null,
    last_name: attendee.profile?.last_name ?? null,
    email: attendee.profile?.email ?? null,
    ticket_type: attendee.ticket_class_name ?? null,
    ticket_tier_name: tierName,
    ticket_tier_category: classifyTicketTier(tierName, ticketPriceCents),
    order_id: attendee.order_id ?? null,
    checked_in: Boolean(attendee.checked_in),
    check_in_time: attendee.checked_in ? attendee.checked_in_at ?? null : null,
    ticket_price_cents: ticketPriceCents,
    raw_ticket_class_id: attendee.ticket_class_id ?? null,
    raw_data: attendee as Record<string, any>,
  }
}

export function mapEventbriteSale(
  integrationId: string,
  eventId: string,
  attendee: EventbriteAttendeeInput
): ImportedSalePayload {
  const ticketPriceCents = centsFromEventbriteCost(attendee.costs?.gross) ?? 0
  const eventbriteFeeCents = centsFromEventbriteCost(attendee.costs?.eventbrite_fee) ?? 0
  const paymentFeeCents = centsFromEventbriteCost(attendee.costs?.payment_fee) ?? 0
  const feesCents = eventbriteFeeCents + paymentFeeCents
  const tierName = attendee.ticket_class_name ?? 'Unknown'
  const isRefund = isEventbriteRefundOrCancellation(attendee)
  const direction = isRefund ? -1 : 1
  const receivedAt = new Date().toISOString()
  const orderId = attendee.order_id
    ? `${attendee.order_id}:${attendee.id}`
    : `${eventId}:${attendee.id}`

  return {
    integration_id: integrationId,
    event_id: eventId,
    order_id: orderId,
    platform: 'eventbrite',
    ticket_buyer_name: [attendee.profile?.first_name, attendee.profile?.last_name].filter(Boolean).join(' ') || null,
    ticket_buyer_email: attendee.profile?.email ?? null,
    ticket_quantity: direction,
    ticket_type: attendee.ticket_class_name ?? null,
    ticket_tier_name: tierName,
    ticket_tier_category: classifyTicketTier(tierName, ticketPriceCents),
    ticket_price: majorAmountFromCents(ticketPriceCents),
    ticket_price_cents: ticketPriceCents,
    total_amount: majorAmountFromCents(ticketPriceCents * direction) ?? 0,
    total_amount_cents: ticketPriceCents * direction,
    fees: majorAmountFromCents(feesCents * direction) ?? 0,
    fees_cents: feesCents * direction,
    currency: normalizeCurrency((attendee.costs?.gross as Record<string, unknown> | null | undefined)?.currency),
    discount_code: null,
    is_refund: isRefund,
    purchase_timestamp: attendee.refunded_at ?? attendee.cancelled_at ?? attendee.canceled_at ?? attendee.created ?? attendee.changed ?? attendee.checked_in_at ?? null,
    raw_ticket_class_id: attendee.ticket_class_id ?? null,
    sales_channel: 'eventbrite_import',
    source: 'eventbrite_import',
    received_at: receivedAt,
    gross_cents: isRefund ? 0 : ticketPriceCents,
    tier_name: tierName,
    raw_data: attendee as Record<string, any>,
  }
}

function isEventbriteRefundOrCancellation(attendee: EventbriteAttendeeInput): boolean {
  const status = attendee.status?.toLowerCase() ?? ''
  return Boolean(
    attendee.refunded ||
      attendee.cancelled ||
      attendee.canceled ||
      attendee.voided ||
      attendee.refunded_at ||
      attendee.cancelled_at ||
      attendee.canceled_at ||
      /\b(refund|refunded|cancel|cancelled|canceled|void|voided|deleted)\b/i.test(status)
  )
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

async function upsertAttendeeChunks(
  admin: ReturnType<typeof createServiceRoleClient>,
  attendeeChunks: ImportedAttendeePayload[][]
) {
  const chunkGroups = chunk(attendeeChunks, 4)

  for (const chunkGroup of chunkGroups) {
    const results = await Promise.all(
      chunkGroup.map((attendeeChunk) =>
        admin.from('imported_attendees').upsert(attendeeChunk as never, {
          onConflict: 'integration_id,external_attendee_id',
        })
      )
    )

    const failedResult = results.find((result) => result.error)
    if (failedResult?.error) {
      throw failedResult.error
    }
  }
}

async function upsertSaleChunks(
  admin: ReturnType<typeof createServiceRoleClient>,
  saleChunks: ImportedSalePayload[][]
) {
  const chunkGroups = chunk(saleChunks, 4)

  for (const chunkGroup of chunkGroups) {
    const results = await Promise.all(
      chunkGroup.map((saleChunk) =>
        admin.from('event_sales_data').upsert(saleChunk as never, {
          onConflict: 'event_id,platform,order_id',
        })
      )
    )

    const failedResult = results.find((result) => result.error)
    if (failedResult?.error) {
      throw failedResult.error
    }
  }
}

export async function runEventbriteImport(
  admin: ReturnType<typeof createServiceRoleClient>,
  integrationId: string
) {
  let lockedIntegrationId: string | null = null

  try {
    const { data: integration, error: integrationError } = await admin
      .from('external_event_integrations')
      .select('id, event_id, external_event_id, access_token_encrypted, sync_status, config')
      .eq('id', integrationId)
      .eq('platform', 'eventbrite')
      .maybeSingle()

    if (integrationError) throw new Error(`Failed to load integration: ${integrationError.message}`)
    if (!integration) throw new Error('Integration not found')

    const typedIntegration = integration as EventbriteIntegrationRow
    if (!typedIntegration.external_event_id) {
      throw new Error('Event not linked to Eventbrite event')
    }

    const accessToken = getEventbriteAccessToken(typedIntegration)
    const { data: lock, error: lockError } = await admin
      .from('external_event_integrations')
      .update({
        sync_status: 'syncing',
        sync_error: null,
        last_sync_status: 'syncing',
        last_sync_error: null,
        updated_at: new Date().toISOString(),
      } as never)
      .eq('id', typedIntegration.id)
      .neq('sync_status', 'syncing')
      .select('id')
      .maybeSingle()

    if (lockError) throw new Error(`Failed to lock integration: ${lockError.message}`)
    if (!lock) throw new Error('An Eventbrite import is already running for this event.')

    lockedIntegrationId = typedIntegration.id

    const allAttendees: ImportedAttendeePayload[] = []
    const allSales: ImportedSalePayload[] = []
    let continuation: string | undefined
    let hasMore = true

    while (hasMore) {
      const response = await fetchEventbriteAttendeePage(accessToken, typedIntegration.external_event_id, continuation)
      const attendees = response.attendees ?? []

      attendees.forEach((attendee) => {
        allAttendees.push(mapEventbriteAttendee(typedIntegration.id, typedIntegration.event_id, attendee))
        allSales.push(mapEventbriteSale(typedIntegration.id, typedIntegration.event_id, attendee))
      })

      hasMore = Boolean(response.pagination?.has_more_items)
      continuation = response.pagination?.continuation ?? undefined
    }

    const checkedInCount = allAttendees.filter((attendee) => attendee.checked_in).length
    const { data: existingAttendees, error: existingError } = await admin
      .from('imported_attendees')
      .select('external_attendee_id')
      .eq('integration_id', typedIntegration.id)

    if (existingError) throw new Error(`Failed to load existing attendees: ${existingError.message}`)

    const existingIds = new Set(
      ((existingAttendees as Array<{ external_attendee_id: string }> | null) ?? []).map(
        (row) => row.external_attendee_id
      )
    )
    const imported = allAttendees.filter((attendee) => !existingIds.has(attendee.external_attendee_id)).length
    const updated = allAttendees.length - imported

    await upsertAttendeeChunks(admin, chunk(allAttendees, 100))
    await upsertSaleChunks(admin, chunk(allSales, 100))

    const { error: updateError } = await admin
      .from('external_event_integrations')
      .update({
        last_sync_at: new Date().toISOString(),
        sync_status: 'completed',
        sync_error: null,
        last_sync_status: 'completed',
        last_sync_error: null,
        total_checked_in: checkedInCount,
        last_attendance_count: allAttendees.length,
        updated_at: new Date().toISOString(),
      } as never)
      .eq('id', typedIntegration.id)

    if (updateError) throw new Error(`Failed to update sync status: ${updateError.message}`)

    lockedIntegrationId = null

    return {
      imported,
      updated,
      checked_in: checkedInCount,
      total: allAttendees.length,
      sales_imported: allSales.length,
      message: `Successfully imported ${allAttendees.length} attendees`,
    }
  } catch (error) {
    if (lockedIntegrationId) {
      await admin
        .from('external_event_integrations')
        .update({
          sync_status: 'failed',
          sync_error: error instanceof Error ? error.message : 'Import failed',
          last_sync_status: 'failed',
          last_sync_error: error instanceof Error ? error.message : 'Import failed',
          updated_at: new Date().toISOString(),
        } as never)
        .eq('id', lockedIntegrationId)
    }

    throw error
  }
}
