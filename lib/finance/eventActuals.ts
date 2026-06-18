import {
  applyRevenueTermsToActuals,
  buildRevenueTermBasisFromActuals,
  calculateRevenueTermImpact,
  listRevenueTerms,
  type RevenueTerm,
} from '@/lib/finance/revenueTerms'
import { isVendorConsumptionShareTerm } from '@/lib/finance/chi-nomenclature-sync'

export type ActualsConfidence = 'low' | 'medium' | 'high'

export type EventActuals = {
  gross_revenue_cents: number
  refunds_cents: number
  platform_fees_cents: number
  taxes_collected_cents: number
  net_revenue_cents: number
  tickets_sold: number
  tickets_refunded: number
  tickets_checked_in: number | null
  tier_breakdown: Array<{
    tier_name: string
    sold: number
    gross_cents: number
    sellout_pct: number | null
  }>
  velocity: {
    last_24h_cents: number
    last_7d_cents: number
    since_launch_cents: number
    projected_sellout_at: string | null
  }
  data_sources: string[]
  confidence: {
    revenue: ActualsConfidence
    attendance: ActualsConfidence
  }
  last_event_at: string | null
}

export type EventPnL = {
  revenue: EventActuals
  costs: {
    estimated_cents: number
    committed_cents: number
    paid_cents: number
  }
  net: {
    conservative_cents: number
    expected_cents: number
    optimistic_cents: number
  }
  breakeven: {
    tickets_needed: number
    tickets_to_go: number
    crossed_at: string | null
  }
  margin_pct: number
  rev_share_adjustments: Array<{
    party_name: string
    type: string
    amount_cents: number
  }>
  terms_conflict: boolean
}

type SupabaseLikeClient = {
  from: (table: string) => unknown
}

type QueryBuilder = {
  select?: (columns?: string) => QueryBuilder
  eq?: (column: string, value: unknown) => QueryBuilder
  order?: (column: string, options?: Record<string, unknown>) => QueryBuilder
  maybeSingle?: () => Promise<{ data: unknown; error: QueryError | null }>
  then?: unknown
}

type QueryError = {
  message?: string
}

type EventRow = {
  expected_attendance?: unknown
  expected_attendance_max?: unknown
}

type SalesRow = {
  platform?: string | null
  source?: string | null
  ticket_quantity?: unknown
  ticket_type?: string | null
  ticket_tier_name?: string | null
  tier_name?: string | null
  total_amount?: unknown
  total_amount_cents?: unknown
  gross_cents?: unknown
  fees?: unknown
  fees_cents?: unknown
  is_refund?: boolean | null
  purchase_timestamp?: string | null
  received_at?: string | null
  created_at?: string | null
  updated_at?: string | null
  raw_data?: unknown
  field_confidence?: unknown
}

type AttendeeRow = {
  checked_in?: boolean | null
  check_in_time?: string | null
  check_in_method?: string | null
  created_at?: string | null
  updated_at?: string | null
  raw_data?: unknown
  field_confidence?: unknown
}

type CostCommitmentRow = {
  amount_cents?: unknown
  category?: string | null
  party_id?: string | null
  party_name?: string | null
  state?: string | null
}

type RevenueMovement = {
  cents: number
  tickets: number
  at: string | null
}

const HOURS_IN_7_DAYS = 24 * 7
const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
const HIGH_REVENUE_SOURCES = new Set([
  'csv_import',
  'api_import',
  'webhook',
  'posh_webhook',
  'eventbrite_webhook',
  'luma_webhook',
  'partiful_webhook',
])
const MEDIUM_REVENUE_SOURCES = new Set(['screenshot_import'])

/**
 * Computes immutable event revenue and attendance actuals from imported sales
 * and check-in rows. The output intentionally stays in integer cents so agents
 * can narrate numbers without owning arithmetic.
 */
export async function computeEventActuals(
  supabase: SupabaseLikeClient,
  eventId: string
): Promise<EventActuals> {
  const [event, salesRows, attendeeRows, revenueTerms, barRevenueCents] = await Promise.all([
    loadEvent(supabase, eventId),
    loadSalesRows(supabase, eventId),
    loadAttendeeRows(supabase, eventId),
    loadRevenueTerms(supabase, eventId),
    loadReportedBarRevenueCents(supabase, eventId),
  ])

  return buildEventActuals(event, salesRows, attendeeRows, revenueTerms, barRevenueCents, new Date())
}

/**
 * Computes actual P&L from event actuals and event_cost_commitments.
 *
 * Cost buckets are mutually exclusive here:
 * - estimated: estimated/quoted
 * - committed: accepted/invoiced
 * - paid: paid
 */
export async function computeEventPnL(
  supabase: SupabaseLikeClient,
  eventId: string
): Promise<EventPnL> {
  const [event, salesRows, attendeeRows, commitmentRows, revenueTerms, barRevenueCents] = await Promise.all([
    loadEvent(supabase, eventId),
    loadSalesRows(supabase, eventId),
    loadAttendeeRows(supabase, eventId),
    loadCostCommitments(supabase, eventId),
    loadRevenueTerms(supabase, eventId),
    loadReportedBarRevenueCents(supabase, eventId),
  ])
  const revenue = buildEventActuals(event, salesRows, attendeeRows, revenueTerms, barRevenueCents, new Date())
  const termCostAdjustments = buildTermCostAdjustments({
    revenue,
    revenueTerms,
    commitmentRows,
    barRevenueCents,
  })
  const costs = summarizeCosts(commitmentRows, termCostAdjustments.committed_cents)
  const committedCostBasis = costs.paid_cents + costs.committed_cents
  const expectedCostBasis = committedCostBasis + costs.estimated_cents
  const optimisticCostBasis = costs.paid_cents
  const breakeven = computeBreakeven({
    salesRows,
    ticketsSold: Math.max(revenue.tickets_sold - revenue.tickets_refunded, 0),
    netRevenueCents: revenue.net_revenue_cents,
    costBasisCents: expectedCostBasis,
  })
  const expectedNetCents = revenue.net_revenue_cents - expectedCostBasis

  return {
    revenue,
    costs,
    net: {
      conservative_cents: revenue.net_revenue_cents - committedCostBasis,
      expected_cents: expectedNetCents,
      optimistic_cents: revenue.net_revenue_cents - optimisticCostBasis,
    },
    breakeven,
    margin_pct: revenue.net_revenue_cents > 0
      ? roundRatio((expectedNetCents / revenue.net_revenue_cents) * 100)
      : 0,
    rev_share_adjustments: termCostAdjustments.rev_share_adjustments,
    terms_conflict: termCostAdjustments.terms_conflict,
  }
}

function buildEventActuals(
  event: EventRow | null,
  salesRows: SalesRow[],
  attendeeRows: AttendeeRow[],
  revenueTerms: RevenueTerm[],
  barRevenueCents: number,
  now: Date
): EventActuals {
  const capacity = resolveCapacity(event)
  const sourceSet = new Set<string>()
  const revenueConfidences: ActualsConfidence[] = []
  const lastEventCandidates: string[] = []
  const tiers = new Map<string, { tier_name: string; sold: number; gross_cents: number; capacity: number | null }>()
  const movements: RevenueMovement[] = []

  let grossRevenueCents = 0
  let refundsCents = 0
  let platformFeesCents = 0
  let taxesCollectedCents = 0
  let ticketsSold = 0
  let ticketsRefunded = 0

  for (const row of salesRows) {
    const isRefund = Boolean(row.is_refund)
    const quantity = Math.abs(readInteger(row.ticket_quantity) ?? 0)
    const signedMovementCents = getSalesVelocityCents(row)
    const timestamp = getSalesTimestamp(row)
    const source = normalizeSource(row.source, row.platform)

    if (source) sourceSet.add(source)
    revenueConfidences.push(readRowRevenueConfidence(row, source))
    if (timestamp) lastEventCandidates.push(timestamp)
    movements.push({ cents: signedMovementCents, tickets: isRefund ? 0 : quantity, at: timestamp })

    if (isRefund) {
      refundsCents += getRefundCents(row)
      ticketsRefunded += quantity
      continue
    }

    const grossCents = getGrossCents(row)
    const feeCents = Math.max(getFeeCents(row), 0)
    const taxCents = Math.max(getTaxCents(row), 0)
    const tierName = getTierName(row)
    const tier = tiers.get(tierName) ?? {
      tier_name: tierName,
      sold: 0,
      gross_cents: 0,
      capacity: readTierCapacity(row),
    }

    tier.sold += quantity
    tier.gross_cents += grossCents
    tier.capacity = tier.capacity ?? readTierCapacity(row)
    tiers.set(tierName, tier)

    grossRevenueCents += grossCents
    platformFeesCents += feeCents
    taxesCollectedCents += taxCents
    ticketsSold += quantity
  }

  const attendeeSummary = summarizeAttendance(attendeeRows)
  for (const source of attendeeSummary.sources) sourceSet.add(source)
  for (const timestamp of attendeeSummary.lastEventCandidates) lastEventCandidates.push(timestamp)

  const netRevenueCents = grossRevenueCents - refundsCents - platformFeesCents - taxesCollectedCents
  const velocity = computeVelocity({
    movements,
    ticketsSold,
    capacity,
    now,
  })

  const actuals = {
    gross_revenue_cents: grossRevenueCents,
    refunds_cents: refundsCents,
    platform_fees_cents: platformFeesCents,
    taxes_collected_cents: taxesCollectedCents,
    net_revenue_cents: netRevenueCents,
    tickets_sold: ticketsSold,
    tickets_refunded: ticketsRefunded,
    tickets_checked_in: attendeeSummary.ticketsCheckedIn,
    tier_breakdown: Array.from(tiers.values())
      .sort((first, second) => first.tier_name.localeCompare(second.tier_name))
      .map((tier) => ({
        tier_name: tier.tier_name,
        sold: tier.sold,
        gross_cents: tier.gross_cents,
        sellout_pct: tier.capacity && tier.capacity > 0
          ? roundRatio(tier.sold / tier.capacity)
          : null,
      })),
    velocity,
    data_sources: Array.from(sourceSet).sort(),
    confidence: {
      revenue: summarizeConfidence(revenueConfidences),
      attendance: attendeeSummary.confidence,
    },
    last_event_at: maxIsoTimestamp(lastEventCandidates),
  }

  return applyRevenueTermsToActuals(actuals, revenueTerms, {
    bar_revenue_cents: barRevenueCents,
  })
}

async function loadEvent(supabase: SupabaseLikeClient, eventId: string): Promise<EventRow | null> {
  const query = asQuery(supabase.from('events'))
    .select?.('expected_attendance, expected_attendance_max')
    .eq?.('id', eventId)
  const result = query?.maybeSingle ? await query.maybeSingle() : await executeQuery(query)

  if (result.error) throw new Error(result.error.message ?? 'Failed to load event')
  return readRecord(result.data) as EventRow | null
}

async function loadSalesRows(supabase: SupabaseLikeClient, eventId: string): Promise<SalesRow[]> {
  let query = asQuery(supabase.from('event_sales_data'))
    .select?.([
      'platform',
      'source',
      'ticket_quantity',
      'ticket_type',
      'ticket_tier_name',
      'tier_name',
      'total_amount',
      'total_amount_cents',
      'gross_cents',
      'fees',
      'fees_cents',
      'is_refund',
      'purchase_timestamp',
      'received_at',
      'created_at',
      'updated_at',
      'raw_data',
      'field_confidence',
    ].join(', '))
    .eq?.('event_id', eventId)

  if (query?.order) query = query.order('purchase_timestamp', { ascending: true, nullsFirst: false })
  const result = await executeQuery(query)

  if (result.error) throw new Error(result.error.message ?? 'Failed to load event sales data')
  return (Array.isArray(result.data) ? result.data : []) as SalesRow[]
}

async function loadAttendeeRows(supabase: SupabaseLikeClient, eventId: string): Promise<AttendeeRow[]> {
  let query = asQuery(supabase.from('imported_attendees'))
    .select?.([
      'checked_in',
      'check_in_time',
      'check_in_method',
      'created_at',
      'updated_at',
      'raw_data',
      'field_confidence',
    ].join(', '))
    .eq?.('event_id', eventId)

  if (query?.order) query = query.order('created_at', { ascending: true })
  const result = await executeQuery(query)

  if (result.error) throw new Error(result.error.message ?? 'Failed to load imported attendees')
  return (Array.isArray(result.data) ? result.data : []) as AttendeeRow[]
}

async function loadCostCommitments(
  supabase: SupabaseLikeClient,
  eventId: string
): Promise<CostCommitmentRow[]> {
  let query = asQuery(supabase.from('event_cost_commitments'))
    .select?.('amount_cents, category, party_id, party_name, state')
    .eq?.('event_id', eventId)

  if (query?.order) query = query.order('created_at', { ascending: true })
  const result = await executeQuery(query)

  if (result.error) throw new Error(result.error.message ?? 'Failed to load event cost commitments')
  return (Array.isArray(result.data) ? result.data : []) as CostCommitmentRow[]
}

async function loadRevenueTerms(supabase: SupabaseLikeClient, eventId: string): Promise<RevenueTerm[]> {
  try {
    return await listRevenueTerms(supabase, eventId)
  } catch (error) {
    if (isMissingTableError(error)) return []
    throw error
  }
}

async function loadReportedBarRevenueCents(supabase: SupabaseLikeClient, eventId: string) {
  let query = asQuery(supabase.from('event_kickback_agreements'))
    .select?.('reported_revenue_cents, revenue_extracted_value_cents')
    .eq?.('event_id', eventId)

  if (query?.order) query = query.order('updated_at', { ascending: false })
  const result = await executeQuery(query)
  if (result.error) {
    if (/does not exist|schema cache|column/i.test(result.error.message ?? '')) return 0
    throw new Error(result.error.message ?? 'Failed to load reported bar revenue')
  }

  return (Array.isArray(result.data) ? result.data : []).reduce((max, row) => {
    const record = readRecord(row)
    return Math.max(
      max,
      readInteger(record?.reported_revenue_cents) ?? 0,
      readInteger(record?.revenue_extracted_value_cents) ?? 0
    )
  }, 0)
}

function resolveCapacity(event: EventRow | null) {
  return readInteger(event?.expected_attendance) ?? readInteger(event?.expected_attendance_max)
}

function getGrossCents(row: SalesRow) {
  const total = readInteger(row.gross_cents) ??
    readInteger(row.total_amount_cents) ??
    moneyToCents(row.total_amount)
  return Math.max(total ?? 0, 0)
}

function getRefundCents(row: SalesRow) {
  const total = readInteger(row.total_amount_cents) ??
    moneyToCents(row.total_amount) ??
    readInteger(row.gross_cents)
  return Math.abs(total ?? 0)
}

function getFeeCents(row: SalesRow) {
  return readInteger(row.fees_cents) ?? moneyToCents(row.fees) ?? 0
}

function getTaxCents(row: SalesRow) {
  const rawData = readRecord(row.raw_data)
  if (!rawData) return 0

  return firstCentsFromPaths(rawData, [
    ['taxes_collected_cents', 'tax_collected_cents', 'tax_amount_cents', 'tax_cents', 'sales_tax_cents'],
    ['taxes_collected', 'tax_collected', 'tax_amount', 'tax', 'sales_tax'],
  ]) ?? 0
}

function getSalesVelocityCents(row: SalesRow) {
  if (row.is_refund) return -getRefundCents(row)
  return getGrossCents(row)
}

function getSalesTimestamp(row: SalesRow) {
  return firstIsoTimestamp([
    row.purchase_timestamp,
    row.received_at,
    row.updated_at,
    row.created_at,
  ])
}

function getTierName(row: SalesRow) {
  return normalizeText(row.ticket_tier_name) ??
    normalizeText(row.tier_name) ??
    normalizeText(row.ticket_type) ??
    'General Admission'
}

function readTierCapacity(row: SalesRow) {
  const rawData = readRecord(row.raw_data)
  if (!rawData) return null

  return firstNumberFromPaths(rawData, [
    'capacity',
    'cap',
    'quantity_total',
    'total_quantity',
    'ticket_quantity_total',
    'ticket_class.capacity',
    'ticket_class.quantity_total',
    'ticket_class.total_quantity',
    'tier.capacity',
    'tier.quantity_total',
    'tier.total_quantity',
  ])
}

function summarizeAttendance(rows: AttendeeRow[]) {
  if (rows.length === 0) {
    return {
      ticketsCheckedIn: null,
      confidence: 'low' as ActualsConfidence,
      sources: [] as string[],
      lastEventCandidates: [] as string[],
    }
  }

  const sources = new Set<string>()
  const confidences: ActualsConfidence[] = []
  const lastEventCandidates: string[] = []
  let checkedInCount = 0

  for (const row of rows) {
    const source = normalizeText(row.check_in_method) ?? inferSourceFromRawData(row.raw_data) ?? 'attendee_import'
    const timestamp = firstIsoTimestamp([row.check_in_time, row.updated_at, row.created_at])

    if (source) sources.add(source)
    if (timestamp) lastEventCandidates.push(timestamp)
    if (row.checked_in) checkedInCount += 1
    confidences.push(readFieldConfidence(row.field_confidence, ['checked_in', 'check_in_time']) ?? confidenceFromSource(source))
  }

  return {
    ticketsCheckedIn: checkedInCount,
    confidence: summarizeConfidence(confidences),
    sources: Array.from(sources),
    lastEventCandidates,
  }
}

function computeVelocity(input: {
  movements: RevenueMovement[]
  ticketsSold: number
  capacity: number | null
  now: Date
}): EventActuals['velocity'] {
  const nowMs = input.now.getTime()
  const hourBuckets = new Map<number, { cents: number; tickets: number }>()
  let sinceLaunchCents = 0

  for (const movement of input.movements) {
    sinceLaunchCents += movement.cents
    const atMs = movement.at ? Date.parse(movement.at) : Number.NaN
    if (!Number.isFinite(atMs) || atMs > nowMs || nowMs - atMs > 7 * DAY_MS) continue
    const hour = Math.floor(atMs / HOUR_MS) * HOUR_MS
    const bucket = hourBuckets.get(hour) ?? { cents: 0, tickets: 0 }
    bucket.cents += movement.cents
    bucket.tickets += movement.tickets
    hourBuckets.set(hour, bucket)
  }

  const last24hStart = nowMs - DAY_MS
  let last24hCents = 0
  let last7dCents = 0
  let last7dTickets = 0

  for (const [hour, bucket] of hourBuckets) {
    last7dCents += bucket.cents
    last7dTickets += bucket.tickets
    if (hour >= last24hStart) last24hCents += bucket.cents
  }

  const hourlyTicketRate = last7dTickets / HOURS_IN_7_DAYS
  const remainingCapacity = input.capacity === null ? null : Math.max(input.capacity - input.ticketsSold, 0)
  const projectedSelloutAt =
    remainingCapacity !== null && remainingCapacity > 0 && hourlyTicketRate > 0
      ? new Date(nowMs + (remainingCapacity / hourlyTicketRate) * HOUR_MS).toISOString()
      : null

  return {
    last_24h_cents: last24hCents,
    last_7d_cents: last7dCents,
    since_launch_cents: sinceLaunchCents,
    projected_sellout_at: projectedSelloutAt,
  }
}

function summarizeCosts(rows: CostCommitmentRow[], additionalCommittedCents = 0): EventPnL['costs'] {
  const totals = rows.reduce<EventPnL['costs']>(
    (totals, row) => {
      const amountCents = Math.max(readInteger(row.amount_cents) ?? 0, 0)
      if (amountCents <= 0) return totals

      if (row.state === 'estimated' || row.state === 'quoted') {
        totals.estimated_cents += amountCents
      } else if (row.state === 'accepted' || row.state === 'invoiced') {
        totals.committed_cents += amountCents
      } else if (row.state === 'paid') {
        totals.paid_cents += amountCents
      }

      return totals
    },
    { estimated_cents: 0, committed_cents: 0, paid_cents: 0 }
  )

  totals.committed_cents += Math.max(Math.round(additionalCommittedCents), 0)
  return totals
}

function buildTermCostAdjustments(input: {
  revenue: EventActuals
  revenueTerms: RevenueTerm[]
  commitmentRows: CostCommitmentRow[]
  barRevenueCents: number
}) {
  const basis = buildRevenueTermBasisFromActuals(input.revenue, input.barRevenueCents)
  const adjustments: EventPnL['rev_share_adjustments'] = []
  let committedCents = 0
  let termsConflict = false

  for (const term of input.revenueTerms) {
    if (!isVendorConsumptionShareTerm(term.term_type) && term.term_type !== 'venue_minimum_spend') continue

    const impact = calculateRevenueTermImpact(term, basis)
    if (impact.amount_cents <= 0) continue

    const category = isVendorConsumptionShareTerm(term.term_type) ? 'vendor' : 'venue'
    const matchingManualAmount = sumMatchingCommitmentAmount(input.commitmentRows, {
      category,
      partyId: impact.party_id,
      partyName: impact.party_name,
    })

    if (isVendorConsumptionShareTerm(term.term_type) && matchingManualAmount > 0) {
      termsConflict = true
    }

    const additionalCents = Math.max(impact.amount_cents - matchingManualAmount, 0)
    committedCents += additionalCents
    adjustments.push({
      party_name: impact.party_name ?? (isVendorConsumptionShareTerm(term.term_type) ? 'Vendor consumption share' : 'Venue minimum spend'),
      type: term.term_type,
      amount_cents: impact.amount_cents,
    })
  }

  return {
    committed_cents: committedCents,
    rev_share_adjustments: adjustments,
    terms_conflict: termsConflict,
  }
}

function sumMatchingCommitmentAmount(
  rows: CostCommitmentRow[],
  input: { category: string; partyId: string | null; partyName: string | null }
) {
  return rows.reduce((sum, row) => {
    if (row.state === 'cancelled' || row.category !== input.category) return sum
    if (!isSameParty(row, input)) return sum
    return sum + Math.max(readInteger(row.amount_cents) ?? 0, 0)
  }, 0)
}

function isSameParty(row: CostCommitmentRow, input: { partyId: string | null; partyName: string | null }) {
  if (input.partyId && row.party_id === input.partyId) return true
  const rowName = normalizeComparableText(row.party_name)
  const inputName = normalizeComparableText(input.partyName)
  return Boolean(rowName && inputName && rowName === inputName)
}

function computeBreakeven(input: {
  salesRows: SalesRow[]
  ticketsSold: number
  netRevenueCents: number
  costBasisCents: number
}): EventPnL['breakeven'] {
  if (input.costBasisCents <= 0) {
    return {
      tickets_needed: 0,
      tickets_to_go: 0,
      crossed_at: firstSalesTimestamp(input.salesRows),
    }
  }

  const averageNetPerTicket = input.ticketsSold > 0
    ? Math.floor(input.netRevenueCents / input.ticketsSold)
    : 0
  const ticketsNeeded = averageNetPerTicket > 0
    ? Math.ceil(input.costBasisCents / averageNetPerTicket)
    : 0
  let runningNetCents = 0
  let crossedAt: string | null = null

  for (const row of [...input.salesRows].sort(compareSalesRowsByTimestamp)) {
    const timestamp = getSalesTimestamp(row)
    runningNetCents += getSalesContributionCents(row)
    if (!crossedAt && runningNetCents >= input.costBasisCents) {
      crossedAt = timestamp
      break
    }
  }

  return {
    tickets_needed: ticketsNeeded,
    tickets_to_go: Math.max(ticketsNeeded - input.ticketsSold, 0),
    crossed_at: crossedAt,
  }
}

function getSalesContributionCents(row: SalesRow) {
  if (row.is_refund) return -getRefundCents(row)
  return getGrossCents(row) - getFeeCents(row) - getTaxCents(row)
}

function firstSalesTimestamp(rows: SalesRow[]) {
  const sorted = rows
    .map(getSalesTimestamp)
    .filter((value): value is string => Boolean(value))
    .sort()
  return sorted[0] ?? null
}

function compareSalesRowsByTimestamp(first: SalesRow, second: SalesRow) {
  return (getSalesTimestamp(first) ?? '').localeCompare(getSalesTimestamp(second) ?? '')
}

function readRowRevenueConfidence(row: SalesRow, source: string | null) {
  return readFieldConfidence(row.field_confidence, [
    'gross_revenue_cents',
    'total_amount_cents',
    'total_amount',
    'refunds_cents',
    'fees_cents',
  ]) ?? confidenceFromSource(source)
}

function summarizeConfidence(confidences: ActualsConfidence[]): ActualsConfidence {
  if (confidences.length === 0) return 'low'
  if (confidences.every((confidence) => confidence === 'high')) return 'high'
  if (confidences.some((confidence) => confidence === 'high' || confidence === 'medium')) return 'medium'
  return 'low'
}

function confidenceFromSource(source: string | null): ActualsConfidence {
  if (!source) return 'low'
  if (HIGH_REVENUE_SOURCES.has(source)) return 'high'
  if (MEDIUM_REVENUE_SOURCES.has(source)) return 'medium'
  if (source.includes('webhook') || source.includes('csv') || source.includes('api')) return 'high'
  if (source.includes('screenshot')) return 'medium'
  return 'low'
}

function readFieldConfidence(value: unknown, fields: string[]) {
  const record = readRecord(value)
  if (!record) return null

  for (const field of fields) {
    const entry = readRecord(record[field])
    const confidence = normalizeText(entry?.confidence)
    if (confidence === 'high' || confidence === 'medium' || confidence === 'low') return confidence
  }

  return null
}

function normalizeSource(source: unknown, platform: unknown) {
  return normalizeText(source) ?? (normalizeText(platform) ? `${normalizeText(platform)}_sales` : null)
}

function inferSourceFromRawData(value: unknown) {
  const rawData = readRecord(value)
  return normalizeText(rawData?.source)
}

function readInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value)
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Math.round(Number(value))
  return null
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
  return null
}

function moneyToCents(value: unknown) {
  const number = readNumber(value)
  return number === null ? null : Math.round(number * 100)
}

function normalizeText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function normalizeComparableText(value: unknown) {
  return normalizeText(value)?.toLowerCase().replace(/\s+/g, ' ') ?? null
}

function isMissingTableError(error: unknown) {
  const message = error instanceof Error ? error.message : ''
  return /event_revenue_terms|does not exist|schema cache/i.test(message)
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function firstNumberFromPaths(record: Record<string, unknown>, paths: string[]) {
  for (const path of paths) {
    const value = readNumber(readPath(record, path))
    if (value !== null) return value
  }
  return null
}

function firstCentsFromPaths(record: Record<string, unknown>, [centPaths, majorPaths]: [string[], string[]]) {
  for (const path of centPaths) {
    const value = readInteger(readPath(record, path))
    if (value !== null) return value
  }

  for (const path of majorPaths) {
    const value = moneyToCents(readPath(record, path))
    if (value !== null) return value
  }

  return null
}

function readPath(record: Record<string, unknown>, path: string) {
  return path.split('.').reduce<unknown>((current, key) => {
    const currentRecord = readRecord(current)
    return currentRecord ? currentRecord[key] : undefined
  }, record)
}

function firstIsoTimestamp(values: Array<string | null | undefined>) {
  for (const value of values) {
    if (!value) continue
    const time = Date.parse(value)
    if (Number.isFinite(time)) return new Date(time).toISOString()
  }
  return null
}

function maxIsoTimestamp(values: string[]) {
  return values
    .map((value) => Date.parse(value))
    .filter(Number.isFinite)
    .sort((first, second) => second - first)
    .map((value) => new Date(value).toISOString())[0] ?? null
}

function roundRatio(value: number) {
  return Math.round(value * 10000) / 10000
}

function asQuery(value: unknown): QueryBuilder {
  return value as QueryBuilder
}

async function executeQuery(query: QueryBuilder | undefined): Promise<{ data: unknown; error: QueryError | null }> {
  if (!query) return { data: null, error: { message: 'Invalid Supabase query' } }
  if ('then' in query && typeof query.then === 'function') {
    return query as unknown as Promise<{ data: unknown; error: QueryError | null }>
  }
  return { data: null, error: { message: 'Supabase query cannot be executed' } }
}
