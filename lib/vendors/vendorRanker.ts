import type { EventArchetypeConfig, ServiceType, VendorStackItem } from '@/lib/planner/archetypes/types'
import type { Plan } from '@/lib/types'
import {
  passesVendorGates,
  readMoneyCents,
  readString,
  readStringArray,
  toDbVendorServiceTypes,
  type GateResult,
  type Vendor,
  type Venue,
} from '@/lib/vendors/vendorGates'
import {
  scoreVendor,
  type BuilderVendorHistory,
  type VendorMetrics,
  type VendorScoreBreakdown,
  type VenueVendorHistory,
} from '@/lib/vendors/vendorScoring'

export interface RankedVendor {
  vendor_id: string
  name: string
  service_type: ServiceType
  necessity: VendorStackItem['necessity']
  service_note: string | null
  base_rate_cents: number
  total_score: number
  user_facing_intro: string
  score_breakdown: VendorScoreBreakdown
  gate_warnings: GateResult['failed']
  response_p50_minutes: number | null
  prior_events_with_builder: number
}

export interface VendorRankerResult {
  by_service_type: Record<string, RankedVendor[]>
  estimated_total_cost_cents: number
  skipped_stack_items: Array<{ service_type: ServiceType; reason: string }>
}

export type VendorRankerDb = {
  from: (table: string) => VendorRankerQuery
}

type VendorRankerQuery = PromiseLike<{ data: unknown; error: { message?: string } | null }> & {
  select: (columns?: string) => VendorRankerQuery
  eq: (field: string, value: unknown) => VendorRankerQuery
  in?: (field: string, values: unknown[]) => VendorRankerQuery
  gte?: (field: string, value: unknown) => VendorRankerQuery
  lte?: (field: string, value: unknown) => VendorRankerQuery
  order: (field: string, options?: Record<string, unknown>) => VendorRankerQuery
  limit: (count: number) => VendorRankerQuery
}

type VendorBookingRow = Record<string, unknown> & {
  vendor_id?: string | null
  organizer_id?: string | null
  status?: string | null
  created_at?: string | null
  responded_at?: string | null
  booking_date?: string | null
  confirmed_date?: string | null
  cancelled_at?: string | null
}

const VENDOR_SELECT_COLUMNS = `
  id,
  name,
  vendor_type,
  service_type,
  bio,
  regions_served,
  service_area,
  pricing_model,
  hourly_rate,
  base_rate,
  per_person_rate,
  average_rating,
  rating,
  review_count,
  total_bookings,
  total_gigs,
  compatible_features,
  services_offered,
  availability_notes,
  is_claimed,
  is_admin_seeded,
  is_published
`

export async function rankVendorsForPlan(
  plan: Plan,
  chosenVenue: Venue | null,
  archetype: EventArchetypeConfig,
  db: VendorRankerDb,
  opts: { perStackItem?: number } = {}
): Promise<VendorRankerResult> {
  const perStackItem = opts.perStackItem ?? 3
  const byServiceType: Record<string, RankedVendor[]> = {}
  const skippedStackItems: VendorRankerResult['skipped_stack_items'] = []
  let alreadyPickedVendorCostCents = 0
  let estimatedTotalCostCents = 0
  const venueCostCents = estimateVenueCostCents(chosenVenue)

  for (const stackItem of archetype.vendor_stack) {
    const remainingBudgetCents = getRemainingBudgetCents(plan, venueCostCents, alreadyPickedVendorCostCents)
    const vendors = await loadVendorCandidates(db, stackItem.service_type)
    const vendorIds = vendors.map((vendor) => vendor.id)
    const [availabilityByVendor, bookingRows] = await Promise.all([
      loadManualAvailability(db, vendorIds, getPlanDateWindow(plan)),
      loadVendorBookings(db, vendorIds),
    ])
    const context = buildContextMaps(plan, chosenVenue, vendors, bookingRows)
    const gated = vendors.flatMap((vendor) => {
      const normalizedVendor = {
        ...vendor,
        service_type: stackItem.service_type,
        manual_availability_blocks: availabilityByVendor.get(vendor.id) ?? [],
      }
      const gates = passesVendorGates(normalizedVendor, plan, archetype, chosenVenue, stackItem, remainingBudgetCents)
      return gates.passes ? [{ vendor: normalizedVendor, gates }] : []
    })

    if (gated.length === 0) {
      if (stackItem.necessity === 'required') {
        skippedStackItems.push({ service_type: stackItem.service_type, reason: 'no_eligible_vendors' })
      }
      byServiceType[stackItem.service_type] = []
      continue
    }

    const medianCents = median(gated.map(({ vendor }) => readMoneyCents(vendor.base_rate ?? vendor.hourly_rate)).filter(isNumber))
    const ranked = gated
      .map(({ vendor, gates }) => {
        const builderHistory = context.builderHistoryByVendorId.get(vendor.id) ?? emptyBuilderHistory()
        const vendorMetrics = context.metricsByVendorId.get(vendor.id) ?? fallbackVendorMetrics(vendor)
        const venueVendorHistory = context.venueVendorHistoryByVendorId.get(vendor.id) ?? { cobooking_count: 0 }
        const scoreBreakdown = scoreVendor(vendor, plan, archetype, chosenVenue, stackItem, {
          builderHistory,
          venueVendorHistory,
          vendorMetrics,
          priceBandMedianCents: medianCents,
        })

        return toRankedVendor(vendor, stackItem, scoreBreakdown, gates, builderHistory)
      })
      .sort(compareRankedVendors)
      .slice(0, perStackItem)

    byServiceType[stackItem.service_type] = ranked

    const topVendor = ranked[0]
    if (
      topVendor &&
      (stackItem.necessity === 'required' || stackItem.necessity === 'recommended') &&
      topVendor.base_rate_cents <= getRemainingBudgetCents(plan, venueCostCents, alreadyPickedVendorCostCents)
    ) {
      alreadyPickedVendorCostCents += topVendor.base_rate_cents
      estimatedTotalCostCents += topVendor.base_rate_cents
    }
  }

  return {
    by_service_type: byServiceType,
    estimated_total_cost_cents: estimatedTotalCostCents,
    skipped_stack_items: skippedStackItems,
  }
}

async function loadVendorCandidates(db: VendorRankerDb, serviceType: ServiceType): Promise<Vendor[]> {
  const serviceTypes = toDbVendorServiceTypes(serviceType)
  let query = db
    .from('vendor_profiles')
    .select(VENDOR_SELECT_COLUMNS)
    .eq('is_published', true)

  if (typeof query.in === 'function') {
    query = query.in('service_type', serviceTypes)
  }

  const { data, error } = await query
    .order('base_rate', { ascending: true, nullsFirst: false })
    .limit(100)

  if (error) {
    console.error('[vendor.rank] Vendor candidate lookup error', error)
    return []
  }

  return readRows(data)
    .filter((row) => {
      const rowServiceType = readString(row.service_type ?? row.vendor_type)
      return serviceTypes.includes(rowServiceType ?? '')
    })
    .filter((row): row is Vendor => typeof row.id === 'string' && row.id.length > 0)
}

async function loadManualAvailability(
  db: VendorRankerDb,
  vendorIds: string[],
  dates: string[]
): Promise<Map<string, Array<{ date: string; status: string | null }>>> {
  const byVendorId = new Map<string, Array<{ date: string; status: string | null }>>()
  if (vendorIds.length === 0 || dates.length === 0) return byVendorId

  let query = db.from('vendor_availability').select('vendor_id, date, status')
  if (typeof query.in === 'function') query = query.in('vendor_id', vendorIds)

  const { data, error } = await query.limit(500)
  if (error) {
    console.error('[vendor.rank] Vendor availability lookup error', error)
    return byVendorId
  }

  const dateSet = new Set(dates)
  for (const row of readRows(data)) {
    const vendorId = readString(row.vendor_id)
    const date = readString(row.date)
    if (!vendorId || !date || !dateSet.has(date)) continue
    const current = byVendorId.get(vendorId) ?? []
    current.push({ date, status: readString(row.status) })
    byVendorId.set(vendorId, current)
  }

  return byVendorId
}

async function loadVendorBookings(db: VendorRankerDb, vendorIds: string[]): Promise<VendorBookingRow[]> {
  if (vendorIds.length === 0) return []
  let query = db
    .from('vendor_bookings')
    .select('vendor_id, organizer_id, status, created_at, responded_at, booking_date, confirmed_date, cancelled_at')

  if (typeof query.in === 'function') query = query.in('vendor_id', vendorIds)

  const { data, error } = await query.limit(1000)
  if (error) {
    console.error('[vendor.rank] Vendor booking history lookup error', error)
    return []
  }

  return readRows(data) as VendorBookingRow[]
}

function buildContextMaps(
  plan: Plan,
  chosenVenue: Venue | null,
  vendors: Vendor[],
  bookingRows: VendorBookingRow[]
) {
  const rowsByVendorId = groupByVendorId(bookingRows)
  const builderHistoryByVendorId = new Map<string, BuilderVendorHistory>()
  const metricsByVendorId = new Map<string, VendorMetrics>()
  const venueVendorHistoryByVendorId = new Map<string, VenueVendorHistory>()

  for (const vendor of vendors) {
    const rows = rowsByVendorId.get(vendor.id) ?? []
    builderHistoryByVendorId.set(vendor.id, buildBuilderHistory(rows, plan.user_id))
    metricsByVendorId.set(vendor.id, buildVendorMetrics(vendor, rows))
    venueVendorHistoryByVendorId.set(vendor.id, {
      cobooking_count: Array.isArray(chosenVenue?.preferred_vendor_ids) && chosenVenue?.preferred_vendor_ids.includes(vendor.id) ? 1 : 0,
    })
  }

  return {
    builderHistoryByVendorId,
    metricsByVendorId,
    venueVendorHistoryByVendorId,
  }
}

function buildBuilderHistory(rows: VendorBookingRow[], userId: string): BuilderVendorHistory {
  const builderRows = rows.filter((row) => row.organizer_id === userId)
  const lastBookingAt = builderRows
    .map((row) => readString(row.confirmed_date ?? row.booking_date ?? row.created_at))
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null

  return {
    bookings_with_vendor: builderRows.length,
    last_booking_at: lastBookingAt,
  }
}

function buildVendorMetrics(vendor: Vendor, rows: VendorBookingRow[]): VendorMetrics {
  const acceptedRows = rows.filter((row) => ['accepted', 'confirmed', 'complete', 'completed', 'paid'].includes(normalizeStatus(row.status)))
  const completedRows = rows.filter((row) => ['complete', 'completed', 'paid'].includes(normalizeStatus(row.status)))
  const responseMinutes = rows
    .map(getResponseMinutes)
    .filter(isNumber)
    .sort((first, second) => first - second)
  const lastMinuteCancels = rows.filter(isLastMinuteCancel).length
  const fallbackBookings = readNumber(vendor.total_bookings ?? vendor.total_gigs) ?? 0

  return {
    response_p50_minutes: responseMinutes.length > 0 ? responseMinutes[Math.floor(responseMinutes.length / 2)] ?? null : null,
    completion_rate: acceptedRows.length > 0 ? completedRows.length / acceptedRows.length : 0.85,
    last_minute_cancels_90d: lastMinuteCancels,
    bookings_count: Math.max(rows.length, fallbackBookings),
  }
}

function toRankedVendor(
  vendor: Vendor,
  stackItem: VendorStackItem,
  scoreBreakdown: VendorScoreBreakdown,
  gates: GateResult,
  builderHistory: BuilderVendorHistory
): RankedVendor {
  const baseRateCents = readMoneyCents(vendor.base_rate ?? vendor.hourly_rate) ?? 0

  return {
    vendor_id: vendor.id,
    name: readString(vendor.name ?? vendor.business_name) ?? 'Vendor',
    service_type: stackItem.service_type,
    necessity: stackItem.necessity,
    service_note: stackItem.notes ?? null,
    base_rate_cents: baseRateCents,
    total_score: scoreBreakdown.total,
    user_facing_intro: buildVendorIntro(vendor, stackItem, scoreBreakdown),
    score_breakdown: scoreBreakdown,
    gate_warnings: gates.failed,
    response_p50_minutes: scoreBreakdown.tie_breaker_signals.response_p50_minutes,
    prior_events_with_builder: builderHistory.bookings_with_vendor,
  }
}

function compareRankedVendors(first: RankedVendor, second: RankedVendor): number {
  return (
    second.total_score - first.total_score ||
    second.score_breakdown.tie_breaker_signals.bookings_count - first.score_breakdown.tie_breaker_signals.bookings_count ||
    compareNullableMinutes(first.response_p50_minutes, second.response_p50_minutes) ||
    first.base_rate_cents - second.base_rate_cents ||
    first.name.localeCompare(second.name)
  )
}

function buildVendorIntro(vendor: Vendor, stackItem: VendorStackItem, scoreBreakdown: VendorScoreBreakdown): string {
  const serviceLabel = stackItem.service_type.replace(/_/g, ' ')
  const specialization = readStringArray(vendor.specializations)[0] ?? readStringArray(vendor.compatible_features)[0]
  const priceLabel = scoreBreakdown.price_band.details.label
  if (specialization) {
    return `${readString(vendor.name) ?? 'This vendor'} is a strong ${serviceLabel} fit with ${specialization} experience and ${String(priceLabel).replace(/_/g, ' ')} pricing.`
  }

  return `${readString(vendor.name) ?? 'This vendor'} is a ${scoreBreakdown.total}-score ${serviceLabel} fit with ${String(priceLabel).replace(/_/g, ' ')} pricing.`
}

function getRemainingBudgetCents(plan: Plan, venueCostCents: number, alreadyPickedVendorCostCents: number): number {
  const budget = plan.budget_cap_cents ?? 0
  if (budget <= 0) return Number.MAX_SAFE_INTEGER / 4
  return Math.max(0, budget - venueCostCents - alreadyPickedVendorCostCents)
}

function estimateVenueCostCents(venue: Venue | null): number {
  if (!venue) return 0
  const baseRate = readMoneyCents(venue.base_rate ?? venue.hourly_rate)
  if (baseRate === null) return 0
  const minimumHours = readNumber(venue.minimum_hours) ?? 1
  if (venue.hourly_rate !== undefined && venue.base_rate === undefined) return baseRate * Math.max(1, minimumHours)
  return baseRate
}

function getPlanDateWindow(plan: Plan): string[] {
  const start = readString(plan.date_window_start)
  const end = readString(plan.date_window_end)
  if (!start && !end) return []
  if (!start || !end || start === end) return [start ?? end].filter((date): date is string => Boolean(date))

  const dates: string[] = []
  const cursor = new Date(`${start}T00:00:00Z`)
  const last = new Date(`${end}T00:00:00Z`)
  while (Number.isFinite(cursor.getTime()) && Number.isFinite(last.getTime()) && cursor <= last && dates.length < 31) {
    dates.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return dates
}

function groupByVendorId(rows: VendorBookingRow[]): Map<string, VendorBookingRow[]> {
  const grouped = new Map<string, VendorBookingRow[]>()
  for (const row of rows) {
    const vendorId = readString(row.vendor_id)
    if (!vendorId) continue
    const current = grouped.get(vendorId) ?? []
    current.push(row)
    grouped.set(vendorId, current)
  }
  return grouped
}

function fallbackVendorMetrics(vendor: Vendor): VendorMetrics {
  return {
    response_p50_minutes: null,
    completion_rate: 0.85,
    last_minute_cancels_90d: 0,
    bookings_count: readNumber(vendor.total_bookings ?? vendor.total_gigs) ?? 0,
  }
}

function emptyBuilderHistory(): BuilderVendorHistory {
  return {
    bookings_with_vendor: 0,
    last_booking_at: null,
  }
}

function getResponseMinutes(row: VendorBookingRow): number | null {
  const createdAt = readString(row.created_at)
  const respondedAt = readString(row.responded_at)
  if (!createdAt || !respondedAt) return null
  const createdTime = new Date(createdAt).getTime()
  const respondedTime = new Date(respondedAt).getTime()
  if (!Number.isFinite(createdTime) || !Number.isFinite(respondedTime) || respondedTime < createdTime) return null
  return Math.round((respondedTime - createdTime) / (60 * 1000))
}

function isLastMinuteCancel(row: VendorBookingRow): boolean {
  if (normalizeStatus(row.status) !== 'cancelled') return false
  const cancelledAt = readString(row.cancelled_at)
  const bookingDate = readString(row.confirmed_date ?? row.booking_date)
  if (!cancelledAt || !bookingDate) return false
  const cancelledTime = new Date(cancelledAt).getTime()
  const bookingTime = new Date(`${bookingDate}T00:00:00Z`).getTime()
  if (!Number.isFinite(cancelledTime) || !Number.isFinite(bookingTime)) return false
  const daysBefore = (bookingTime - cancelledTime) / (24 * 60 * 60 * 1000)
  return daysBefore >= 0 && daysBefore <= 7 && Date.now() - cancelledTime <= 90 * 24 * 60 * 60 * 1000
}

function normalizeStatus(value: unknown): string {
  return readString(value)?.toLowerCase().replace(/\s+/g, '_') ?? ''
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((first, second) => first - second)
  const midpoint = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[midpoint] ?? null
  return Math.round(((sorted[midpoint - 1] ?? 0) + (sorted[midpoint] ?? 0)) / 2)
}

function compareNullableMinutes(first: number | null, second: number | null): number {
  if (first === null && second === null) return 0
  if (first === null) return 1
  if (second === null) return -1
  return first - second
}

function readRows(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object' && !Array.isArray(row))
    : []
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function isNumber(value: number | null): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}
