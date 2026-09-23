export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { recalculateEventFinancials } from '@/lib/finance/calculate-event-financials'
import { buildFieldConfidence } from '@/lib/integrations/csv/parse'
import { classifyTicketTier, majorAmountFromCents } from '@/lib/server/ticket-normalization'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getBuilderProfileId } from '@/lib/supabase/server-helpers'

type SupabaseAdminClient = any
type ImportRow = Record<string, unknown>
type ImportDomain = 'sales' | 'attendees' | 'check_ins'

const finalizeSchema = z.object({
  event: z.object({
    event_name: z.string().trim().min(1).optional(),
    event_date: z.string().trim().min(1).optional(),
    start_time: z.string().trim().min(1).optional(),
    end_time: z.string().trim().min(1).optional(),
    expected_attendance: z.number().int().nonnegative().optional().nullable(),
    description: z.string().trim().optional().nullable(),
  }).optional(),
  gap_fill: z.object({
    tickets_sold: z.number().int().nonnegative().optional().nullable(),
    gross_revenue_cents: z.number().int().nonnegative().optional().nullable(),
    refunds_cents: z.number().int().nonnegative().optional().nullable(),
    checked_in_count: z.number().int().nonnegative().optional().nullable(),
  }).optional(),
})

type BuilderAuth =
  | { builderProfileId: string }
  | { response: NextResponse<{ error: string }> }

type ImportSession = {
  id: string
  builder_id: string
  event_id: string | null
  source: 'posh' | 'eventbrite' | 'luma' | 'partiful' | 'other'
  event_url: string | null
  payload: Record<string, any>
}

export async function POST(request: NextRequest, props: { params: Promise<{ importId: string }> }) {
  const params = await props.params;
  try {
    const auth = await getAuthenticatedBuilder()
    if ('response' in auth) return auth.response

    const body = finalizeSchema.parse(await request.json().catch(() => ({})))
    const admin = createServiceRoleClient() as SupabaseAdminClient
    const session = await loadSession(admin, params.importId, auth.builderProfileId)
    if (!session?.event_id) return NextResponse.json({ error: 'Import session not found' }, { status: 404 })

    const payload = session.payload ?? {}
    const detailAttendees: ImportRow[] = payload.attendees ?? []
    const detailSales: ImportRow[] = payload.sales ?? []
    const syntheticAttendees = buildSyntheticAttendees(session, body.gap_fill)
    const syntheticSales = buildSyntheticSales(session, body.gap_fill)
    // Re-finalizing can encounter aggregates written by an earlier request.
    // Check the same event-wide population that financial recalculation reads.
    const [existingSales, existingAttendees] = await Promise.all([
      loadExistingImportRows(admin, 'event_sales_data', session.event_id),
      loadExistingImportRows(admin, 'imported_attendees', session.event_id),
    ])
    const conflictingDomains = findConflictingDomains(
      [...existingSales, ...detailSales, ...syntheticSales],
      [...existingAttendees, ...detailAttendees, ...syntheticAttendees]
    )

    if (conflictingDomains.length > 0) {
      const labels = conflictingDomains.map((domain) => domain === 'check_ins' ? 'check-ins' : domain)
      return NextResponse.json({
        code: 'IMPORT_SOURCE_CONFLICT',
        conflicting_domains: conflictingDomains,
        error: `Overlapping import sources for ${labels.join(', ')}. Choose one authoritative source per affected domain: itemized CSV rows or screenshot/manual totals. Start a new import using only the chosen sources. Nothing was saved by this finalization.`,
      }, { status: 409 })
    }

    const eventPatch = buildEventPatch(payload.event ?? {}, body.event ?? {})
    await updateEvent(admin, session.event_id, eventPatch)

    const integrationId = await upsertIntegration(admin, session)
    const attendees = withIntegration([...detailAttendees, ...syntheticAttendees], integrationId, session.event_id)
    const sales = withIntegration([...detailSales, ...syntheticSales], integrationId, session.event_id)

    if (attendees.length > 0) {
      const { error } = await admin
        .from('imported_attendees')
        .upsert(attendees as never, { onConflict: 'integration_id,external_attendee_id' })
      if (error) throw new Error(error.message ?? 'Failed to write attendee rows')
    }

    if (sales.length > 0) {
      const { error } = await admin
        .from('event_sales_data')
        .upsert(sales as never, { onConflict: 'event_id,platform,order_id' })
      if (error) throw new Error(error.message ?? 'Failed to write sales rows')
    }

    await recalculateEventFinancials(admin, session.event_id)

    const finalizedPayload = {
      ...payload,
      finalized: {
        attendees_written: attendees.length,
        sales_written: sales.length,
        finalized_at: new Date().toISOString(),
      },
      gap_fill: body.gap_fill ?? {},
    }
    const { error: sessionError } = await admin
      .from('event_import_sessions')
      .update({
        payload: finalizedPayload,
        status: 'finalized',
        finalized_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as never)
      .eq('id', session.id)

    if (sessionError) throw new Error(sessionError.message ?? 'Failed to finalize import session')

    return NextResponse.json({
      eventId: session.event_id,
      importId: session.id,
      attendeesWritten: attendees.length,
      salesWritten: sales.length,
      redirectUrl: `/planner/events/${session.event_id}/report`,
    })
  } catch (error) {
    console.error('[planner.events.import.finalize] Finalize failed', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Event import finalize failed' },
      { status: 500 }
    )
  }
}

async function getAuthenticatedBuilder(): Promise<BuilderAuth> {
  const supabase = createClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return { response: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) }
  }

  if (user.user_metadata?.user_type !== 'community_builder') {
    return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 403 }) }
  }

  const { builderProfileId, error: builderError } = await getBuilderProfileId(supabase, user.id)
  if (builderError || !builderProfileId) {
    return { response: NextResponse.json({ error: 'Builder profile not found' }, { status: 404 }) }
  }

  return { builderProfileId }
}

async function loadSession(db: SupabaseAdminClient, importId: string, builderId: string) {
  const { data, error } = await db
    .from('event_import_sessions')
    .select('id, builder_id, event_id, source, event_url, payload')
    .eq('id', importId)
    .eq('builder_id', builderId)
    .maybeSingle()

  if (error) throw new Error(error.message ?? 'Failed to load import session')
  return data as ImportSession | null
}

async function loadExistingImportRows(
  db: SupabaseAdminClient,
  table: 'event_sales_data' | 'imported_attendees',
  eventId: string
): Promise<ImportRow[]> {
  const rows: ImportRow[] = []
  const columns = table === 'imported_attendees' ? 'raw_data, checked_in' : 'raw_data'
  while (true) {
    const { data, error } = await db
      .from(table)
      .select(columns)
      .eq('event_id', eventId)
      .order('id', { ascending: true })
      .range(rows.length, rows.length + 999)
    if (error) throw new Error(error.message ?? 'Unable to verify existing import sources')
    const page = (data ?? []) as ImportRow[]
    if (page.length === 0) return rows
    rows.push(...page)
    // Continue until an empty page, even if the server caps responses below 1,000.
  }
}

function findConflictingDomains(sales: ImportRow[], attendees: ImportRow[]): ImportDomain[] {
  const conflicts: ImportDomain[] = []
  if (hasMixedRepresentations(sales)) conflicts.push('sales')
  // A synthetic check-in also creates an attendee, even when detailed attendees
  // have no positive check-in flags. It cannot safely be added to that roster.
  if (hasMixedRepresentations(attendees)) conflicts.push('attendees')
  if (hasMixedRepresentations(attendees.filter((row) => row.checked_in === true))) conflicts.push('check_ins')
  return conflicts
}

function hasMixedRepresentations(rows: ImportRow[]): boolean {
  // Aggregate provenance is not evidence that the underlying populations are
  // disjoint. Unmarked rows are treated as detail; IDs never reconcile totals.
  const isAggregate = (row: ImportRow) => {
    const rawData = row.raw_data
    return typeof rawData === 'object' && rawData !== null && !Array.isArray(rawData)
      && (rawData as Record<string, unknown>).aggregate_row === true
  }
  return rows.some(isAggregate) && rows.some((row) => !isAggregate(row))
}

async function updateEvent(
  db: SupabaseAdminClient,
  eventId: string,
  patch: Record<string, unknown>
) {
  const { error } = await db
    .from('events')
    .update({
      ...patch,
      updated_at: new Date().toISOString(),
    } as never)
    .eq('id', eventId)

  if (error) throw new Error(error.message ?? 'Failed to update event')
}

async function upsertIntegration(db: SupabaseAdminClient, session: ImportSession) {
  const { data, error } = await db
    .from('external_event_integrations')
    .upsert(
      {
        event_id: session.event_id,
        platform: session.source,
        external_event_url: session.event_url,
        sync_status: 'completed',
        sync_error: null,
        last_sync_status: 'completed',
        last_sync_error: null,
        last_sync_at: new Date().toISOString(),
        is_active: true,
        config: {
          import_session_id: session.id,
          import_mode: 'event_import_wizard',
          source: session.source,
        },
        updated_at: new Date().toISOString(),
      } as never,
      { onConflict: 'event_id,platform' }
    )
    .select('id')
    .single()

  if (error) throw new Error(error.message ?? 'Failed to create import integration')
  return (data as { id: string }).id
}

function buildEventPatch(baseEvent: Record<string, unknown>, override: Record<string, unknown>) {
  const eventName = readString(override.event_name) ?? readString(baseEvent.event_name) ?? 'Imported event'
  const eventDate = readString(override.event_date) ?? readString(baseEvent.event_date) ?? new Date().toISOString().slice(0, 10)
  const startTime = normalizeTime(readString(override.start_time) ?? readString(baseEvent.start_time) ?? '18:00:00')
  const endTime = normalizeTime(readString(override.end_time) ?? readString(baseEvent.end_time) ?? '21:00:00')
  const expectedAttendance = readNumber(override.expected_attendance) ?? readNumber(baseEvent.expected_attendance)
  const description = readString(override.description) ?? readString(baseEvent.description)
  const fieldConfidence = {
    ...((baseEvent.field_confidence as Record<string, unknown> | undefined) ?? {}),
    ...buildFieldConfidence(
      Object.keys(override).filter((key) => override[key] !== null && override[key] !== undefined),
      'high',
      'manual_gap_fill'
    ),
  }

  return {
    event_name: eventName,
    event_date: eventDate,
    start_time: startTime,
    end_time: endTime,
    duration_hours: durationHours(startTime, endTime),
    expected_attendance: expectedAttendance,
    event_description: description,
    description,
    field_confidence: fieldConfidence,
  }
}

function withIntegration(rows: Array<Record<string, unknown>>, integrationId: string, eventId: string) {
  return rows.map((row) => ({
    ...row,
    integration_id: integrationId,
    event_id: eventId,
  }))
}

function buildSyntheticAttendees(
  session: ImportSession,
  gapFill?: z.infer<typeof finalizeSchema>['gap_fill']
) {
  const checkedInCount =
    readNumber(session.payload?.screenshot_extraction?.checked_in_count) ??
    readNumber(gapFill?.checked_in_count)
  if (!checkedInCount || checkedInCount <= 0 || !session.event_id) return []

  return Array.from({ length: checkedInCount }).map((_, index) => ({
    event_id: session.event_id,
    external_attendee_id: `${session.source}:aggregate-checkin:${session.id}:${index + 1}`,
    first_name: null,
    last_name: null,
    email: null,
    ticket_type: 'Aggregate check-in',
    ticket_class: null,
    ticket_tier_name: 'Aggregate check-in',
    ticket_tier_category: 'ga',
    order_id: null,
    checked_in: true,
    check_in_time: null,
    check_in_method: session.payload?.screenshot_extraction?.checked_in_count ? 'screenshot_import' : 'manual_gap_fill',
    ticket_price: null,
    ticket_price_cents: null,
    raw_ticket_class_id: null,
    raw_data: {
      import_session_id: session.id,
      aggregate_row: true,
      source: session.source,
    },
    field_confidence: {
      checked_in: session.payload?.screenshot_extraction?.field_confidence?.checked_in_count ?? {
        confidence: 'medium',
        source: 'manual_gap_fill',
      },
    },
  }))
}

function buildSyntheticSales(
  session: ImportSession,
  gapFill?: z.infer<typeof finalizeSchema>['gap_fill']
) {
  if (!session.event_id) return []
  const screenshot = session.payload?.screenshot_extraction ?? {}
  const ticketsSold = readNumber(screenshot.tickets_sold) ?? readNumber(gapFill?.tickets_sold)
  const grossRevenueCents = readNumber(screenshot.gross_revenue_cents) ?? readNumber(gapFill?.gross_revenue_cents)
  const refundsCents = readNumber(screenshot.refunds_cents) ?? readNumber(gapFill?.refunds_cents) ?? 0
  const fieldConfidence = screenshot.field_confidence ?? {}
  const rows: Array<Record<string, unknown>> = []

  if (ticketsSold || grossRevenueCents) {
    const quantity = Math.max(ticketsSold ?? 1, 1)
    const totalCents = grossRevenueCents ?? 0
    const tierName = 'Aggregate tickets'
    rows.push({
      event_id: session.event_id,
      order_id: `${session.source}:aggregate-sale:${session.id}`,
      platform: session.source,
      ticket_buyer_name: null,
      ticket_buyer_email: null,
      ticket_quantity: quantity,
      ticket_type: tierName,
      ticket_tier_name: tierName,
      ticket_tier_category: classifyTicketTier(tierName, totalCents > 0 ? Math.round(totalCents / quantity) : null),
      ticket_price: majorAmountFromCents(totalCents > 0 ? Math.round(totalCents / quantity) : null),
      ticket_price_cents: totalCents > 0 ? Math.round(totalCents / quantity) : null,
      total_amount: majorAmountFromCents(totalCents) ?? 0,
      total_amount_cents: totalCents,
      fees: 0,
      fees_cents: 0,
      currency: 'usd',
      discount_code: null,
      is_refund: false,
      purchase_timestamp: null,
      raw_ticket_class_id: null,
      sales_channel: screenshot.tickets_sold || screenshot.gross_revenue_cents ? `${session.source}_screenshot_import` : `${session.source}_manual_gap_fill`,
      source: screenshot.tickets_sold || screenshot.gross_revenue_cents ? 'screenshot_import' : 'manual_gap_fill',
      received_at: new Date().toISOString(),
      gross_cents: totalCents,
      tier_name: tierName,
      raw_data: { import_session_id: session.id, aggregate_row: true, source: session.source },
      field_confidence: {
        tickets_sold: fieldConfidence.tickets_sold ?? { confidence: 'medium', source: 'manual_gap_fill' },
        gross_revenue_cents: fieldConfidence.gross_revenue_cents ?? { confidence: 'medium', source: 'manual_gap_fill' },
      },
    })
  }

  if (refundsCents > 0) {
    rows.push({
      event_id: session.event_id,
      order_id: `${session.source}:aggregate-refund:${session.id}`,
      platform: session.source,
      ticket_buyer_name: null,
      ticket_buyer_email: null,
      ticket_quantity: 0,
      ticket_type: 'Aggregate refund',
      ticket_tier_name: 'Aggregate refund',
      ticket_tier_category: 'ga',
      ticket_price: majorAmountFromCents(refundsCents),
      ticket_price_cents: refundsCents,
      total_amount: majorAmountFromCents(-refundsCents) ?? 0,
      total_amount_cents: -refundsCents,
      fees: 0,
      fees_cents: 0,
      currency: 'usd',
      discount_code: null,
      is_refund: true,
      purchase_timestamp: null,
      raw_ticket_class_id: null,
      sales_channel: screenshot.refunds_cents ? `${session.source}_screenshot_import` : `${session.source}_manual_gap_fill`,
      source: screenshot.refunds_cents ? 'screenshot_import' : 'manual_gap_fill',
      received_at: new Date().toISOString(),
      gross_cents: 0,
      tier_name: 'Aggregate refund',
      raw_data: { import_session_id: session.id, aggregate_row: true, source: session.source },
      field_confidence: {
        refunds_cents: fieldConfidence.refunds_cents ?? { confidence: 'medium', source: 'manual_gap_fill' },
      },
    })
  }

  return rows
}

function durationHours(startTime: string, endTime: string) {
  const start = timeToMinutes(startTime)
  const end = timeToMinutes(endTime)
  return Math.round((Math.max(end - start, 60) / 60) * 10) / 10
}

function timeToMinutes(value: string) {
  const [hour = '0', minute = '0'] = value.split(':')
  return (Number(hour) || 0) * 60 + (Number(minute) || 0)
}

function normalizeTime(value: string) {
  const [hour = '18', minute = '00', second = '00'] = value.split(':')
  return `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}:${second.slice(0, 2).padStart(2, '0')}`
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
  return null
}
