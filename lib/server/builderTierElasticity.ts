import 'server-only'

import { resolveArchetypeKey } from '@/lib/planner/archetypes'

export interface TierSignal {
  tier_name: string
  tier_price_cents: number
  tickets_sold: number
  capacity: number | null
  sold_out: boolean
  days_to_first_sale: number | null
  days_to_sellout: number | null
  sellout_rank: number | null
}

export interface ElasticitySignal {
  archetype_key: string | null
  sample_size: number
  confidence: 'low' | 'medium' | 'high'
  tier_pattern:
    | 'premium_first'
    | 'budget_first'
    | 'middle_first'
    | 'proportional'
    | 'vip_dead'
    | 'unknown'
  velocity_vector: Array<{
    price_cents: number
    avg_days_to_sellout: number | null
    sellout_rate: number
  }>
  recommended_price_floor_cents: number | null
  recommended_price_ceiling_cents: number | null
  reasoning_for_agent: string
}

export type BuilderTierElasticityDb = {
  from: (table: string) => unknown
}

// TODO(tier-elasticity): Add time-of-day, day-of-week, lead-time, and geographic elasticity buckets.
// TODO(tier-elasticity): Add proactive pricing insight notifications when premium tiers repeatedly sell out.

type QueryBuilder = {
  select?: (columns: string) => QueryBuilder
  eq?: (column: string, value: unknown) => QueryBuilder
  in?: (column: string, values: unknown[]) => QueryBuilder
  gte?: (column: string, value: unknown) => QueryBuilder
  maybeSingle?: () => Promise<{ data: unknown; error: DbError | null }>
}

type DbError = {
  message?: string
  code?: string
}

type EventRow = Record<string, unknown> & { id: string }
type SalesRow = Record<string, unknown> & { event_id?: string }
type IntegrationRow = Record<string, unknown> & { event_id?: string }

type EventTierSignal = {
  eventId: string
  eventName: string
  tiers: TierSignal[]
}

type TierAccumulator = {
  tier_name: string
  tier_price_cents: number
  tickets_sold: number
  rows: SalesRow[]
  capacity: number | null
}

export async function summarizeBuilderTierElasticity(
  db: BuilderTierElasticityDb,
  builderId: string,
  opts: { archetype_key?: string; window_days?: number } = {}
): Promise<ElasticitySignal> {
  const archetypeKey = opts.archetype_key?.trim() || null
  const windowDays = opts.window_days && opts.window_days > 0 ? opts.window_days : 365
  const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString()
  const empty = buildElasticitySignal(archetypeKey, [])

  const events = await loadEvents(db, builderId)
  const matchingEvents = events.filter((event) => {
    if (!eventIsWithinWindow(event, cutoff)) return false
    if (!archetypeKey) return true
    return resolveEventArchetypeKey(event) === archetypeKey
  })
  if (matchingEvents.length === 0) return empty

  const eventIds = matchingEvents.map((event) => event.id)
  const [salesRows, integrationRows] = await Promise.all([
    loadSalesRows(db, eventIds, cutoff),
    loadIntegrationRows(db, eventIds),
  ])
  const eventsById = new Map(matchingEvents.map((event) => [event.id, event]))
  const integrationsByEventId = groupByEventId(integrationRows)
  const salesByEventId = groupByEventId(salesRows)
  const eventSignals = Array.from(salesByEventId.entries())
    .map(([eventId, rows]): EventTierSignal | null => {
      const event = eventsById.get(eventId)
      if (!event) return null

      const tiers = buildTierSignalsForEvent(
        event,
        rows,
        integrationsByEventId.get(eventId) ?? []
      )
      if (tiers.length === 0) return null

      return {
        eventId,
        eventName: readString(event.event_name) ?? 'Untitled event',
        tiers,
      }
    })
    .filter((signal): signal is EventTierSignal => signal !== null)

  return buildElasticitySignal(archetypeKey, eventSignals)
}

async function loadEvents(db: BuilderTierElasticityDb, builderId: string): Promise<EventRow[]> {
  const query = asQuery(db.from('events'))
    .select?.('id,event_name,event_type,event_date,created_at,builder_id')
    .eq?.('builder_id', builderId)

  const result = await executeQuery(query)
  if (result.error) {
    console.error('[builder.elasticity] Event lookup failed', result.error)
    return []
  }

  return Array.isArray(result.data) ? result.data.filter(hasStringId) : []
}

async function loadSalesRows(
  db: BuilderTierElasticityDb,
  eventIds: string[],
  cutoff: string
): Promise<SalesRow[]> {
  if (eventIds.length === 0) return []

  let query = asQuery(db.from('event_sales_data'))
    .select?.('event_id,ticket_quantity,is_refund,purchase_timestamp,created_at,ticket_type,ticket_tier_name,ticket_tier_category,ticket_price_cents,ticket_price,total_amount_cents,total_amount,raw_ticket_class_id')

  if (query?.in) query = query.in('event_id', eventIds)
  if (query?.gte) query = query.gte('purchase_timestamp', cutoff)

  const result = await executeQuery(query)
  if (result.error) {
    console.error('[builder.elasticity] Ticket tier lookup failed', result.error)
    return []
  }

  return Array.isArray(result.data) ? result.data.filter(isSalesRow) : []
}

async function loadIntegrationRows(
  db: BuilderTierElasticityDb,
  eventIds: string[]
): Promise<IntegrationRow[]> {
  if (eventIds.length === 0) return []

  let query = asQuery(db.from('external_event_integrations'))
    .select?.('id,event_id,config,integration_metadata,created_at')

  if (query?.in) query = query.in('event_id', eventIds)

  const result = await executeQuery(query)
  if (result.error) {
    console.error('[builder.elasticity] Integration metadata lookup failed', result.error)
    return []
  }

  return Array.isArray(result.data) ? result.data.filter(isIntegrationRow) : []
}

function buildTierSignalsForEvent(
  event: EventRow,
  rows: SalesRow[],
  integrations: IntegrationRow[]
): TierSignal[] {
  const listingDate = readString(event.created_at) ??
    integrations.map((integration) => readString(integration.created_at)).filter(Boolean)[0] ??
    rows.map((row) => readString(row.purchase_timestamp) ?? readString(row.created_at)).filter(Boolean).sort()[0] ??
    null
  const tierCapacities = mergeTierCapacities(integrations)
  const accumulators = new Map<string, TierAccumulator>()

  for (const row of rows) {
    if (row.is_refund === true) continue

    const ticketsSold = readNumber(row.ticket_quantity) ?? 0
    if (ticketsSold <= 0) continue

    const tierName = getTierName(row)
    const tierPriceCents = getTierPriceCents(row)
    const key = `${normalizeText(tierName)}:${tierPriceCents}`
    const existing = accumulators.get(key) ?? {
      tier_name: tierName,
      tier_price_cents: tierPriceCents,
      tickets_sold: 0,
      rows: [],
      capacity: readTierCapacity(tierCapacities, row, tierName, tierPriceCents),
    }
    existing.tickets_sold += ticketsSold
    existing.rows.push(row)
    accumulators.set(key, existing)
  }

  const tiers = Array.from(accumulators.values())
    .map((tier) => toTierSignal(tier, listingDate))
    .sort((first, second) => first.tier_price_cents - second.tier_price_cents)
  const soldOutTiers = tiers
    .filter((tier) => tier.days_to_sellout !== null)
    .sort((first, second) => (first.days_to_sellout ?? Number.POSITIVE_INFINITY) - (second.days_to_sellout ?? Number.POSITIVE_INFINITY))

  soldOutTiers.forEach((tier, index) => {
    tier.sellout_rank = index + 1
  })

  return tiers
}

function toTierSignal(tier: TierAccumulator, listingDate: string | null): TierSignal {
  const rows = [...tier.rows].sort((first, second) =>
    Date.parse(readString(first.purchase_timestamp) ?? readString(first.created_at) ?? '') -
    Date.parse(readString(second.purchase_timestamp) ?? readString(second.created_at) ?? '')
  )
  const firstSaleAt = rows.map((row) => readString(row.purchase_timestamp) ?? readString(row.created_at)).filter(Boolean)[0] ?? null
  const soldOutAt = findSelloutDate(rows, tier.capacity)
  const soldOut = tier.capacity !== null && tier.capacity > 0 && tier.tickets_sold >= tier.capacity

  return {
    tier_name: tier.tier_name,
    tier_price_cents: tier.tier_price_cents,
    tickets_sold: tier.tickets_sold,
    capacity: tier.capacity,
    sold_out: soldOut,
    days_to_first_sale: listingDate && firstSaleAt ? daysBetween(listingDate, firstSaleAt) : null,
    days_to_sellout: listingDate && soldOutAt ? daysBetween(listingDate, soldOutAt) : null,
    sellout_rank: null,
  }
}

function findSelloutDate(rows: SalesRow[], capacity: number | null): string | null {
  if (capacity === null || capacity <= 0) return null

  let runningTotal = 0
  for (const row of rows) {
    runningTotal += readNumber(row.ticket_quantity) ?? 0
    if (runningTotal >= capacity) {
      return readString(row.purchase_timestamp) ?? readString(row.created_at)
    }
  }

  return null
}

function buildElasticitySignal(
  archetypeKey: string | null,
  eventSignals: EventTierSignal[]
): ElasticitySignal {
  const sampleSize = eventSignals.length
  const velocityVector = buildVelocityVector(eventSignals)
  const prices = velocityVector.map((point) => point.price_cents).sort((first, second) => first - second)
  const tierPattern = determineTierPattern(eventSignals, velocityVector)
  const priceBand = buildRecommendedPriceBand(tierPattern, prices)
  const confidence = confidenceFor(sampleSize, tierPattern)

  return {
    archetype_key: archetypeKey,
    sample_size: sampleSize,
    confidence,
    tier_pattern: tierPattern,
    velocity_vector: velocityVector,
    recommended_price_floor_cents: priceBand.floor,
    recommended_price_ceiling_cents: priceBand.ceiling,
    reasoning_for_agent: buildReasoning(sampleSize, tierPattern, priceBand, velocityVector),
  }
}

function buildVelocityVector(eventSignals: EventTierSignal[]): ElasticitySignal['velocity_vector'] {
  const byPrice = new Map<number, { totalDays: number; daysCount: number; soldOutCount: number; eventCount: number }>()

  for (const eventSignal of eventSignals) {
    const seenPrices = new Set<number>()
    for (const tier of eventSignal.tiers) {
      const bucket = byPrice.get(tier.tier_price_cents) ?? {
        totalDays: 0,
        daysCount: 0,
        soldOutCount: 0,
        eventCount: 0,
      }
      if (!seenPrices.has(tier.tier_price_cents)) {
        bucket.eventCount += 1
        seenPrices.add(tier.tier_price_cents)
      }
      if (tier.sold_out) bucket.soldOutCount += 1
      if (tier.days_to_sellout !== null) {
        bucket.totalDays += tier.days_to_sellout
        bucket.daysCount += 1
      }
      byPrice.set(tier.tier_price_cents, bucket)
    }
  }

  return Array.from(byPrice.entries())
    .map(([priceCents, bucket]) => ({
      price_cents: priceCents,
      avg_days_to_sellout: bucket.daysCount > 0 ? roundToHundredth(bucket.totalDays / bucket.daysCount) : null,
      sellout_rate: bucket.eventCount > 0 ? roundToHundredth(bucket.soldOutCount / bucket.eventCount) : 0,
    }))
    .sort((first, second) => first.price_cents - second.price_cents)
}

function determineTierPattern(
  eventSignals: EventTierSignal[],
  velocityVector: ElasticitySignal['velocity_vector']
): ElasticitySignal['tier_pattern'] {
  const sampleSize = eventSignals.length
  if (sampleSize < 3 || velocityVector.length === 0) return 'unknown'

  const topTier = velocityVector[velocityVector.length - 1]
  if (sampleSize >= 4 && topTier && topTier.sellout_rate <= 0.2) return 'vip_dead'

  if (isProportional(velocityVector)) return 'proportional'

  const firstSellouts = eventSignals
    .map((eventSignal) => ({
      eventSignal,
      tier: eventSignal.tiers.find((tier) => tier.sellout_rank === 1) ?? null,
    }))
    .filter((item): item is { eventSignal: EventTierSignal; tier: TierSignal } => item.tier !== null)
  if (firstSellouts.length === 0) return 'unknown'

  const premiumFirstCount = firstSellouts.filter((item) => (
    item.tier.tier_price_cents === highestPrice(item.eventSignal.tiers)
  )).length
  const budgetFirstCount = firstSellouts.filter((item) => (
    item.tier.tier_price_cents === lowestPrice(item.eventSignal.tiers)
  )).length
  const middleFirstCount = firstSellouts.filter((item) => (
    isMiddleTier(item.tier, item.eventSignal.tiers)
  )).length

  if (topTier && premiumFirstCount / firstSellouts.length >= 0.6 && topTier.sellout_rate >= 0.6) {
    return 'premium_first'
  }
  if (budgetFirstCount / firstSellouts.length >= 0.6) return 'budget_first'
  if (middleFirstCount / firstSellouts.length >= 0.6) return 'middle_first'

  return 'unknown'
}

function isProportional(velocityVector: ElasticitySignal['velocity_vector']): boolean {
  const days = velocityVector
    .map((point) => point.avg_days_to_sellout)
    .filter((value): value is number => value !== null && value > 0)
  if (days.length < 2) return false

  const min = Math.min(...days)
  const max = Math.max(...days)
  return max - min <= max * 0.25
}

function buildRecommendedPriceBand(
  pattern: ElasticitySignal['tier_pattern'],
  prices: number[]
): { floor: number | null; ceiling: number | null } {
  if (prices.length === 0 || pattern === 'unknown') return { floor: null, ceiling: null }

  const lowest = prices[0] ?? 0
  const highest = prices[prices.length - 1] ?? lowest
  const median = percentile(prices, 0.5)

  if (pattern === 'premium_first') {
    return { floor: highest, ceiling: roundCents(highest * 1.2) }
  }
  if (pattern === 'budget_first') {
    return { floor: roundCents(lowest * 0.85), ceiling: median }
  }
  if (pattern === 'middle_first') {
    return { floor: median, ceiling: highest }
  }
  if (pattern === 'vip_dead') {
    return { floor: median, ceiling: roundCents((median + highest) / 2) }
  }
  if (pattern === 'proportional') {
    return { floor: lowest, ceiling: roundCents(highest * 1.05) }
  }

  return { floor: null, ceiling: null }
}

function buildReasoning(
  sampleSize: number,
  pattern: ElasticitySignal['tier_pattern'],
  priceBand: { floor: number | null; ceiling: number | null },
  velocityVector: ElasticitySignal['velocity_vector']
): string {
  if (sampleSize === 0 || pattern === 'unknown') {
    return 'Not enough tier-level ticket history to price from historical elasticity yet.'
  }

  const highest = velocityVector[velocityVector.length - 1]
  const lowest = velocityVector[0]
  const band = priceBand.floor !== null && priceBand.ceiling !== null
    ? `${formatCurrency(priceBand.floor)}-${formatCurrency(priceBand.ceiling)}`
    : 'the current archetype range'

  if (pattern === 'premium_first' && highest) {
    return `Across ${sampleSize} past events, your premium ${formatCurrency(highest.price_cents)} tier sold out fastest with a ${formatPercent(highest.sellout_rate)} sellout rate. Pushing price into ${band} is historically supported.`
  }
  if (pattern === 'budget_first' && lowest) {
    return `Across ${sampleSize} past events, the lowest ${formatCurrency(lowest.price_cents)} tier sold out first most often. Keep the recommended price band tighter around ${band}.`
  }
  if (pattern === 'middle_first') {
    return `Across ${sampleSize} past events, the middle tier moved fastest. Pricing in ${band} is the strongest historical fit.`
  }
  if (pattern === 'vip_dead' && highest) {
    return `Across ${sampleSize} past events, your top ${formatCurrency(highest.price_cents)} tier rarely sold out. Historically your top tier hasn't moved, so a tighter band around ${band} is safer.`
  }

  return `Across ${sampleSize} past events, ticket tiers moved at similar speed. Pricing within ${band} is historically balanced.`
}

function mergeTierCapacities(integrations: IntegrationRow[]): Map<string, number> {
  const capacities = new Map<string, number>()

  for (const integration of integrations) {
    collectTierCapacities(readRecord(integration.config), capacities)
    collectTierCapacities(readRecord(integration.integration_metadata), capacities)
  }

  return capacities
}

function collectTierCapacities(value: unknown, output: Map<string, number>) {
  if (Array.isArray(value)) {
    for (const item of value) collectTierCapacities(item, output)
    return
  }

  const record = readRecord(value)
  if (!record) return

  const directCapacity = readNumber(record.capacity ?? record.cap ?? record.quantity_total ?? record.total_quantity)
  const name = readString(record.name ?? record.tier_name ?? record.ticket_type ?? record.id)
  if (name && directCapacity !== null) {
    output.set(normalizeText(name), directCapacity)
  }

  for (const [key, item] of Object.entries(record)) {
    if (/tier_capacities|ticket_classes|ticket_types|tiers/i.test(key)) {
      collectTierCapacities(item, output)
      continue
    }

    const numberValue = readNumber(item)
    if (numberValue !== null) output.set(normalizeText(key), numberValue)
    else collectTierCapacities(item, output)
  }
}

function readTierCapacity(
  capacities: Map<string, number>,
  row: SalesRow,
  tierName: string,
  tierPriceCents: number
): number | null {
  const keys = [
    tierName,
    readString(row.ticket_type),
    readString(row.ticket_tier_name),
    readString(row.raw_ticket_class_id),
    String(tierPriceCents),
  ].filter((key): key is string => Boolean(key))

  for (const key of keys) {
    const capacity = capacities.get(normalizeText(key))
    if (capacity !== undefined) return capacity
  }

  return null
}

function getTierName(row: SalesRow): string {
  return readString(row.ticket_tier_name) ??
    readString(row.ticket_type) ??
    readString(row.raw_ticket_class_id) ??
    (readNumber(row.ticket_price_cents) ? formatCurrency(readNumber(row.ticket_price_cents) ?? 0) : 'General admission')
}

function getTierPriceCents(row: SalesRow): number {
  const directCents = readNumber(row.ticket_price_cents)
  if (directCents !== null) return Math.max(0, Math.round(directCents))

  const ticketPriceDollars = readNumber(row.ticket_price)
  if (ticketPriceDollars !== null) return Math.max(0, Math.round(ticketPriceDollars * 100))

  const quantity = readNumber(row.ticket_quantity) ?? 0
  const totalCents = readNumber(row.total_amount_cents)
  if (quantity > 0 && totalCents !== null) return Math.max(0, Math.round(totalCents / quantity))

  const totalDollars = readNumber(row.total_amount)
  if (quantity > 0 && totalDollars !== null) return Math.max(0, Math.round((totalDollars * 100) / quantity))

  return 0
}

function confidenceFor(
  sampleSize: number,
  pattern: ElasticitySignal['tier_pattern']
): ElasticitySignal['confidence'] {
  if (sampleSize >= 6 && pattern !== 'unknown') return 'high'
  if (sampleSize >= 3) return 'medium'
  return 'low'
}

function highestPrice(tiers: TierSignal[]): number | null {
  if (tiers.length === 0) return null
  return Math.max(...tiers.map((tier) => tier.tier_price_cents))
}

function lowestPrice(tiers: TierSignal[]): number | null {
  if (tiers.length === 0) return null
  return Math.min(...tiers.map((tier) => tier.tier_price_cents))
}

function isMiddleTier(tier: TierSignal, tiers: TierSignal[]): boolean {
  const sorted = [...tiers].sort((first, second) => first.tier_price_cents - second.tier_price_cents)
  if (sorted.length < 3) return false
  const index = sorted.findIndex((candidate) => candidate.tier_price_cents === tier.tier_price_cents)
  return index > 0 && index < sorted.length - 1
}

function groupByEventId<T extends { event_id?: string }>(rows: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const row of rows) {
    const eventId = readString(row.event_id)
    if (!eventId) continue
    map.set(eventId, [...(map.get(eventId) ?? []), row])
  }
  return map
}

function resolveEventArchetypeKey(event: Record<string, unknown>): string | null {
  return resolveArchetypeKey([
    event.archetype_key,
    event.event_type,
    event.event_name,
    event.title,
  ].map((value) => (typeof value === 'string' ? value : '')).join(' '))
}

function eventIsWithinWindow(event: Record<string, unknown>, cutoff: string): boolean {
  const date = readString(event.event_date) ?? readString(event.created_at)
  if (!date) return true
  return Date.parse(date) >= Date.parse(cutoff)
}

function daysBetween(start: string, end: string): number {
  const startMs = Date.parse(start)
  const endMs = Date.parse(end)
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return 0
  return Math.max(0, Math.round((endMs - startMs) / (24 * 60 * 60 * 1000)))
}

function percentile(sortedValues: number[], percentileValue: number): number {
  if (sortedValues.length === 0) return 0
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil(sortedValues.length * percentileValue) - 1))
  return sortedValues[index] ?? 0
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

function isIntegrationRow(value: unknown): value is IntegrationRow {
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
    const parsed = Number(value.replace(/[$,]/g, ''))
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function normalizeText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_/]+/g, ' ')
    .replace(/[^\w\s-]/g, ' ')
    .replace(/\s+/g, ' ')
}

function roundCents(value: number): number {
  return Math.round(value / 100) * 100
}

function roundToHundredth(value: number): number {
  return Math.round(value * 100) / 100
}

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(cents / 100)
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`
}
