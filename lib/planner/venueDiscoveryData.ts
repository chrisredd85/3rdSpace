import 'server-only'

import { readCents } from '@/lib/money'
import type { VenueDiscoveryCandidate, VenueSignalAggregate } from '@/lib/planner/venueDiscoveryRanker'

type PlannerDb = { from(table: string): any }

type VenueSignalRow = {
  discovery_venue_id: string | null
  venue_id: string | null
  event_type: string
  latency_seconds: number | null
}

const DISCOVERY_SELECT = `
  id,
  name,
  address,
  neighborhood,
  city,
  contact_email,
  website,
  capacity_seated,
  capacity_standing,
  capacity_cocktail,
  vibe_tags,
  price_hint_cents_low,
  price_hint_cents_high,
  is_claimed,
  claimed_venue_id,
  metadata,
  last_enriched_at,
  updated_at
`

const ONBOARDED_SELECT = `
  id,
  venue_name,
  city,
  standing_capacity,
  seated_capacity,
  hourly_rate,
  hourly_rate_cents,
  unique_features_tags,
  auto_approve_conditions,
  contact_email,
  is_claimed,
  updated_at
`

export async function loadVenueDiscoveryCandidates(input: {
  db: PlannerDb
  limit?: number
  includeOnboarded?: boolean
  includeDiscovery?: boolean
}): Promise<VenueDiscoveryCandidate[]> {
  const limit = Math.min(Math.max(input.limit ?? 80, 1), 150)
  const includeOnboarded = input.includeOnboarded ?? true
  const includeDiscovery = input.includeDiscovery ?? true
  const [onboardedRows, discoveryRows] = await Promise.all([
    includeOnboarded ? loadOnboardedVenues(input.db, limit) : Promise.resolve([]),
    includeDiscovery ? loadDiscoveryVenues(input.db, limit) : Promise.resolve([]),
  ])

  const venueIds = onboardedRows.map((venue) => venue.id)
  const discoveryVenueIds = discoveryRows.map((venue) => venue.id)
  const signals = await loadSignalAggregates(input.db, {
    venueIds,
    discoveryVenueIds,
  })

  return [
    ...onboardedRows.map((venue) => ({
      ...venue,
      signals: signals.venues.get(venue.id) ?? null,
    })),
    ...discoveryRows.map((venue) => ({
      ...venue,
      signals: signals.discovery.get(venue.id) ?? null,
    })),
  ]
}

async function loadOnboardedVenues(db: PlannerDb, limit: number): Promise<VenueDiscoveryCandidate[]> {
  const { data, error } = await db
    .from('venues')
    .select(ONBOARDED_SELECT)
    .eq('is_published', true)
    .order('updated_at', { ascending: false })
    .limit(limit)

  if (error) {
    console.error('[venueDiscoveryData] Failed to load onboarded venues', error)
    return []
  }

  return ((data ?? []) as Record<string, unknown>[]).map((venue) => {
    const autoApprove = readRecord(venue.auto_approve_conditions)
    const estimateCents = readCents(
      readNumber(venue.hourly_rate_cents),
      readNumber(venue.hourly_rate)
    )

    return {
      id: String(venue.id),
      source: 'onboarded',
      name: readString(venue.venue_name) ?? 'Onboarded venue',
      neighborhood: readString(autoApprove?.neighborhood),
      city: readString(venue.city),
      capacity_standing: readNumber(venue.standing_capacity),
      capacity_seated: readNumber(venue.seated_capacity),
      estimate_cents: estimateCents,
      vibe_tags: readStringArray(venue.unique_features_tags),
      contact_email: readString(venue.contact_email),
      website: null,
      metadata: {
        is_claimed: venue.is_claimed === true,
      },
    } satisfies VenueDiscoveryCandidate
  })
}

async function loadDiscoveryVenues(db: PlannerDb, limit: number): Promise<VenueDiscoveryCandidate[]> {
  const { data, error } = await db
    .from('discovery_venues')
    .select(DISCOVERY_SELECT)
    .eq('is_claimed', false)
    .order('updated_at', { ascending: false })
    .limit(limit)

  if (error) {
    console.error('[venueDiscoveryData] Failed to load discovery venues', error)
    return []
  }

  return ((data ?? []) as Record<string, unknown>[]).map((venue) => ({
    id: String(venue.id),
    source: 'discovery',
    name: readString(venue.name) ?? 'Discovery venue',
    neighborhood: readString(venue.neighborhood),
    city: readString(venue.city),
    capacity_seated: readNumber(venue.capacity_seated),
    capacity_standing: readNumber(venue.capacity_standing),
    capacity_cocktail: readNumber(venue.capacity_cocktail),
    price_hint_cents_low: readNumber(venue.price_hint_cents_low),
    price_hint_cents_high: readNumber(venue.price_hint_cents_high),
    vibe_tags: readStringArray(venue.vibe_tags),
    claimed_venue_id: readString(venue.claimed_venue_id),
    contact_email: readString(venue.contact_email),
    website: readString(venue.website),
    metadata: {
      address: readString(venue.address),
      last_enriched_at: readString(venue.last_enriched_at),
      ...(readRecord(venue.metadata) ?? {}),
    },
  } satisfies VenueDiscoveryCandidate))
}

async function loadSignalAggregates(db: PlannerDb, input: {
  venueIds: string[]
  discoveryVenueIds: string[]
}) {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const venues = new Map<string, VenueSignalAggregate>()
  const discovery = new Map<string, VenueSignalAggregate>()

  await Promise.all([
    hydrateSignals(db, 'venue_id', input.venueIds, since, venues),
    hydrateSignals(db, 'discovery_venue_id', input.discoveryVenueIds, since, discovery),
  ])

  return { venues, discovery }
}

async function hydrateSignals(
  db: PlannerDb,
  column: 'venue_id' | 'discovery_venue_id',
  ids: string[],
  since: string,
  target: Map<string, VenueSignalAggregate>
) {
  if (ids.length === 0) return
  const { data, error } = await db
    .from('discovery_venue_signals')
    .select('discovery_venue_id, venue_id, event_type, latency_seconds')
    .in(column, ids)
    .gte('created_at', since)

  if (error) {
    console.error('[venueDiscoveryData] Failed to load venue signals', error)
    return
  }

  for (const row of (data ?? []) as VenueSignalRow[]) {
    const id = column === 'venue_id' ? row.venue_id : row.discovery_venue_id
    if (!id) continue
    const existing = target.get(id) ?? emptySignals()
    if (row.event_type === 'email_sent') existing.emailsSent30d += 1
    if (row.event_type === 'reply_received') {
      existing.replies30d += 1
      existing.avgReplyLatencySeconds = updateAverage(
        existing.avgReplyLatencySeconds,
        row.latency_seconds,
        existing.replies30d
      )
    }
    if (row.event_type === 'booked') existing.bookings30d += 1
    if (row.event_type === 'declined') existing.declines30d += 1
    if (row.event_type === 'stale') existing.stale30d += 1
    target.set(id, existing)
  }
}

function emptySignals(): VenueSignalAggregate {
  return {
    emailsSent30d: 0,
    replies30d: 0,
    bookings30d: 0,
    declines30d: 0,
    stale30d: 0,
    avgReplyLatencySeconds: null,
  }
}

function updateAverage(current: number | null, value: number | null, count: number) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return current
  if (current === null || count <= 1) return value
  return Math.round(((current * (count - 1)) + value) / count)
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
}
