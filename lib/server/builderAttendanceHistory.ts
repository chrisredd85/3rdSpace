import 'server-only'

import { resolveArchetypeKey } from '@/lib/planner/archetypes'

export interface BuilderAttendanceSummary {
  builder_id: string
  archetype_key: string | null
  sample_size: number
  avg_tickets_sold: number
  median_tickets_sold: number
  p75_tickets_sold: number
  p95_tickets_sold: number
  last_event_at: string | null
  confidence: 'low' | 'medium' | 'high'
}

export interface BuilderAttendanceEvent {
  id: string
  name: string
  tickets_sold: number
  archetype_key: string | null
  date: string | null
}

export type BuilderAttendanceDb = {
  from: (table: string) => unknown
}

// TODO(attendance-calibration): Bucket builder history by season so summer mixers and winter events do not flatten into one signal.
// TODO(attendance-calibration): Add ticket-tier sellout analysis to feed price elasticity into the Economics Agent.
// TODO(attendance-calibration): Add RSVP-to-attended conversion once free imported_attendees data has reliable attendance status.
// TODO(attendance-calibration): Add cross-builder archetype baselines to help cold-start new community builders.

type QueryBuilder = {
  select?: (columns: string) => QueryBuilder
  eq?: (column: string, value: unknown) => QueryBuilder
  in?: (column: string, values: unknown[]) => QueryBuilder
  gte?: (column: string, value: unknown) => QueryBuilder
  order?: (column: string, options?: Record<string, unknown>) => QueryBuilder
  limit?: (count: number) => QueryBuilder
  maybeSingle?: () => Promise<{ data: unknown; error: DbError | null }>
}

type DbError = {
  message?: string
  code?: string
}

type EventRow = Record<string, unknown> & {
  id: string
}

type SalesRow = Record<string, unknown> & {
  event_id?: string
}

type AttendeeRow = Record<string, unknown> & {
  event_id?: string
}

export async function summarizeBuilderAttendance(
  db: BuilderAttendanceDb,
  builderId: string,
  opts: { archetype_key?: string; window_days?: number } = {}
): Promise<BuilderAttendanceSummary> {
  const result = await loadBuilderAttendance(db, builderId, opts)
  return result.summary
}

export async function listBuilderAttendanceEvents(
  db: BuilderAttendanceDb,
  builderId: string,
  opts: { archetype_key?: string; window_days?: number; limit?: number } = {}
): Promise<BuilderAttendanceEvent[]> {
  const result = await loadBuilderAttendance(db, builderId, opts)
  return result.events.slice(0, opts.limit ?? 5)
}

export async function getBuilderProfileIdForUser(
  db: BuilderAttendanceDb,
  userId: string
): Promise<string | null> {
  const query = asQuery(db.from('builder_profiles'))
    .select?.('id')
    .eq?.('user_id', userId)

  const result = await query?.maybeSingle?.()
  if (!result || result.error) return null

  const id = readString(readRecord(result.data)?.id)
  return id
}

async function loadBuilderAttendance(
  db: BuilderAttendanceDb,
  builderId: string,
  opts: { archetype_key?: string; window_days?: number } = {}
): Promise<{ summary: BuilderAttendanceSummary; events: BuilderAttendanceEvent[] }> {
  const archetypeKey = opts.archetype_key?.trim() || null
  const windowDays = opts.window_days && opts.window_days > 0 ? opts.window_days : 365
  const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString()
  const empty = buildSummary(builderId, archetypeKey, [], null)

  const events = await loadEvents(db, builderId)
  if (events.length === 0) return { summary: empty, events: [] }

  const matchingEvents = events.filter((event) => {
    if (!eventIsWithinWindow(event, cutoff)) return false
    if (!archetypeKey) return true
    return resolveEventArchetypeKey(event) === archetypeKey
  })
  if (matchingEvents.length === 0) return { summary: empty, events: [] }

  const eventIds = matchingEvents.map((event) => event.id)
  const [salesRows, attendeeRows] = await Promise.all([
    loadSalesRows(db, eventIds, cutoff),
    loadAttendeeRows(db, eventIds),
  ])
  const ticketTotalsByEvent = aggregateTicketSales(salesRows, cutoff)
  const attendeeTotalsByEvent = aggregateImportedAttendees(attendeeRows)
  const attendanceEvents = matchingEvents
    .map((event): BuilderAttendanceEvent | null => {
      const ticketsSold = ticketTotalsByEvent.get(event.id) ?? attendeeTotalsByEvent.get(event.id) ?? 0
      if (ticketsSold <= 0) return null

      return {
        id: event.id,
        name: readString(event.event_name) ?? readString(event.title) ?? 'Untitled event',
        tickets_sold: ticketsSold,
        archetype_key: resolveEventArchetypeKey(event),
        date: readEventDate(event, salesRows),
      }
    })
    .filter((event): event is BuilderAttendanceEvent => event !== null)
    .sort((first, second) => Date.parse(second.date ?? '') - Date.parse(first.date ?? ''))

  const lastEventAt = attendanceEvents[0]?.date ?? null
  return {
    summary: buildSummary(builderId, archetypeKey, attendanceEvents.map((event) => event.tickets_sold), lastEventAt),
    events: attendanceEvents,
  }
}

async function loadEvents(db: BuilderAttendanceDb, builderId: string): Promise<EventRow[]> {
  const query = asQuery(db.from('events'))
    .select?.('id,event_name,event_type,event_date,created_at,builder_id')
    .eq?.('builder_id', builderId)

  const result = await executeQuery(query)
  if (result.error) {
    console.error('[builder.attendance] Event history lookup failed', result.error)
    return []
  }

  return Array.isArray(result.data) ? result.data.filter(hasStringId) : []
}

async function loadSalesRows(
  db: BuilderAttendanceDb,
  eventIds: string[],
  cutoff: string
): Promise<SalesRow[]> {
  if (eventIds.length === 0) return []

  let query = asQuery(db.from('event_sales_data'))
    .select?.('event_id,ticket_quantity,is_refund,purchase_timestamp,created_at')

  if (query?.in) query = query.in('event_id', eventIds)
  if (query?.gte) query = query.gte('purchase_timestamp', cutoff)

  const result = await executeQuery(query)
  if (result.error) {
    console.error('[builder.attendance] Ticket sales lookup failed', result.error)
    return []
  }

  return Array.isArray(result.data) ? result.data.filter(isSalesRow) : []
}

async function loadAttendeeRows(
  db: BuilderAttendanceDb,
  eventIds: string[]
): Promise<AttendeeRow[]> {
  if (eventIds.length === 0) return []

  let query = asQuery(db.from('imported_attendees'))
    .select?.('event_id,created_at,updated_at')

  if (query?.in) query = query.in('event_id', eventIds)

  const result = await executeQuery(query)
  if (result.error) {
    console.error('[builder.attendance] Imported attendee lookup failed', result.error)
    return []
  }

  return Array.isArray(result.data) ? result.data.filter(isAttendeeRow) : []
}

function aggregateTicketSales(rows: SalesRow[], cutoff: string): Map<string, number> {
  const totals = new Map<string, number>()
  const cutoffMs = Date.parse(cutoff)

  for (const row of rows) {
    const eventId = readString(row.event_id)
    if (!eventId) continue
    if (row.is_refund === true) continue

    const purchasedAt = readString(row.purchase_timestamp)
    if (purchasedAt && Date.parse(purchasedAt) < cutoffMs) continue

    const quantity = readNumber(row.ticket_quantity) ?? 0
    if (quantity <= 0) continue
    totals.set(eventId, (totals.get(eventId) ?? 0) + quantity)
  }

  return totals
}

function aggregateImportedAttendees(rows: AttendeeRow[]): Map<string, number> {
  const totals = new Map<string, number>()

  for (const row of rows) {
    const eventId = readString(row.event_id)
    if (!eventId) continue
    totals.set(eventId, (totals.get(eventId) ?? 0) + 1)
  }

  return totals
}

function buildSummary(
  builderId: string,
  archetypeKey: string | null,
  values: number[],
  lastEventAt: string | null
): BuilderAttendanceSummary {
  const sorted = [...values].filter((value) => value > 0).sort((first, second) => first - second)
  const sampleSize = sorted.length

  if (sampleSize === 0) {
    return {
      builder_id: builderId,
      archetype_key: archetypeKey,
      sample_size: 0,
      avg_tickets_sold: 0,
      median_tickets_sold: 0,
      p75_tickets_sold: 0,
      p95_tickets_sold: 0,
      last_event_at: null,
      confidence: 'low',
    }
  }

  return {
    builder_id: builderId,
    archetype_key: archetypeKey,
    sample_size: sampleSize,
    avg_tickets_sold: roundToHundredth(sorted.reduce((sum, value) => sum + value, 0) / sampleSize),
    median_tickets_sold: percentile(sorted, 0.5),
    p75_tickets_sold: percentile(sorted, 0.75),
    p95_tickets_sold: percentile(sorted, 0.95),
    last_event_at: lastEventAt,
    confidence: confidenceFor(sampleSize),
  }
}

function percentile(sortedValues: number[], percentileValue: number): number {
  if (sortedValues.length === 0) return 0
  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil(sortedValues.length * percentileValue) - 1)
  )
  return sortedValues[index] ?? 0
}

function confidenceFor(sampleSize: number): BuilderAttendanceSummary['confidence'] {
  if (sampleSize >= 8) return 'high'
  if (sampleSize >= 3) return 'medium'
  return 'low'
}

function resolveEventArchetypeKey(event: Record<string, unknown>): string | null {
  return resolveArchetypeKey([
    event.archetype_key,
    event.event_type,
    event.event_name,
    event.title,
  ].map((value) => (typeof value === 'string' ? value : '')).join(' '))
}

function readEventDate(event: Record<string, unknown>, salesRows: SalesRow[]): string | null {
  const date = readString(event.event_date) ?? readString(event.created_at)
  if (date) return date

  const eventId = readString(event.id)
  if (!eventId) return null

  return salesRows
    .filter((row) => readString(row.event_id) === eventId)
    .map((row) => readString(row.purchase_timestamp) ?? readString(row.created_at))
    .filter((value): value is string => Boolean(value))
    .sort((first, second) => Date.parse(second) - Date.parse(first))[0] ?? null
}

function eventIsWithinWindow(event: Record<string, unknown>, cutoff: string): boolean {
  const date = readString(event.event_date) ?? readString(event.created_at)
  if (!date) return true
  return Date.parse(date) >= Date.parse(cutoff)
}

function asQuery(value: unknown): QueryBuilder {
  return value as QueryBuilder
}

async function executeQuery(query: QueryBuilder | undefined): Promise<{ data: unknown; error: DbError | null }> {
  if (!query) return { data: null, error: { message: 'Missing query builder' } }
  const maybeThenable = query as unknown as { then?: unknown }
  if (typeof maybeThenable.then === 'function') {
    return await (query as unknown as PromiseLike<{ data: unknown; error: DbError | null }>)
  }
  return { data: null, error: { message: 'Query builder is not awaitable' } }
}

function hasStringId(value: unknown): value is EventRow {
  const row = readRecord(value)
  return typeof row?.id === 'string' && row.id.trim().length > 0
}

function isSalesRow(value: unknown): value is SalesRow {
  const row = readRecord(value)
  return typeof row?.event_id === 'string'
}

function isAttendeeRow(value: unknown): value is AttendeeRow {
  const row = readRecord(value)
  return typeof row?.event_id === 'string'
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  return null
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function roundToHundredth(value: number): number {
  return Math.round(value * 100) / 100
}
