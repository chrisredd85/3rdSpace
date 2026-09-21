import { parseDollarsToCents, readCents, type VenueNightlyRateCents } from '@/lib/money'

export const VENUE_NIGHTLY_RATE_AUTHORITY_KEY = 'nightly_rate_cents_authoritative'

type VenueRateRow = Record<string, unknown>

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function readPositiveCents(
  centsValue: number | string | null | undefined,
  legacyDollarValue?: number | string | null
) {
  const value = readCents(centsValue, legacyDollarValue)
  return value !== null && value > 0 ? value : null
}

/** True only after an explicit nightly-rate save marks that field authoritative. */
export function hasAuthoritativeVenueNightlyRate(row: VenueRateRow): boolean {
  const conditions = readRecord(row.auto_approve_conditions)
  return conditions[VENUE_NIGHTLY_RATE_AUTHORITY_KEY] === true &&
    readPositiveCents(
      row.price_per_night_cents as number | string | null | undefined,
      row.price_per_night as number | string | null | undefined
    ) !== null
}

/**
 * Reconciles a venue's explicit nightly-rate save with the old triple-write.
 * Exact duplicates of the prior nightly value are safe to clear. Differing
 * hourly/daily values are preserved as potentially intentional history, while
 * the authority marker ensures the newly confirmed nightly value wins readers.
 */
export function buildVenueNightlyRateReconciliation(input: {
  pricePerNightDollars: number | string | null | undefined
  existing?: VenueRateRow | null
}) {
  const existing = input.existing ?? {}
  const previousNightlyCents = readPositiveCents(
    existing.price_per_night_cents as number | string | null | undefined,
    existing.price_per_night as number | string | null | undefined
  )
  const previousHourlyCents = readPositiveCents(
    existing.hourly_rate_cents as number | string | null | undefined,
    existing.hourly_rate as number | string | null | undefined
  )
  const previousDailyCents = readPositiveCents(
    existing.daily_rate_cents as number | string | null | undefined,
    existing.daily_rate as number | string | null | undefined
  )
  const parsedNightlyRateCents = parseDollarsToCents(input.pricePerNightDollars)
  const nightlyRateCents = parsedNightlyRateCents !== null && parsedNightlyRateCents > 0
    ? parsedNightlyRateCents as VenueNightlyRateCents
    : null
  const conditions = readRecord(existing.auto_approve_conditions)
  const update: {
    price_per_night_cents: VenueNightlyRateCents | null
    hourly_rate_cents?: null
    daily_rate_cents?: null
    auto_approve_conditions: Record<string, unknown>
  } = {
    price_per_night_cents: nightlyRateCents,
    auto_approve_conditions: {
      ...conditions,
      [VENUE_NIGHTLY_RATE_AUTHORITY_KEY]: nightlyRateCents !== null,
    },
  }

  if (
    nightlyRateCents !== null &&
    previousNightlyCents !== null &&
    previousHourlyCents === previousNightlyCents
  ) {
    update.hourly_rate_cents = null
  }
  if (
    nightlyRateCents !== null &&
    previousNightlyCents !== null &&
    previousDailyCents === previousNightlyCents
  ) {
    update.daily_rate_cents = null
  }

  return update
}

/** Resolves the stored rate field while honoring an explicitly confirmed nightly rate. */
export function readVenueRentalRateCents(row: VenueRateRow): number | null {
  const nightlyRate = readPositiveCents(
    row.price_per_night_cents as number | string | null | undefined,
    row.price_per_night as number | string | null | undefined
  )
  if (hasAuthoritativeVenueNightlyRate(row)) return nightlyRate

  return readPositiveCents(
    row.hourly_rate_cents as number | string | null | undefined,
    row.hourly_rate as number | string | null | undefined
  ) ?? readPositiveCents(
    row.daily_rate_cents as number | string | null | undefined,
    row.daily_rate as number | string | null | undefined
  ) ?? nightlyRate
}

/** Resolves a booking estimate, multiplying only a genuine hourly rate. */
export function estimateVenueRentalCents(
  row: VenueRateRow,
  durationHours?: number | null
): number | null {
  if (hasAuthoritativeVenueNightlyRate(row)) return readVenueRentalRateCents(row)

  const hourlyRate = readPositiveCents(
    row.hourly_rate_cents as number | string | null | undefined,
    row.hourly_rate as number | string | null | undefined
  )
  if (hourlyRate !== null) {
    const storedMinimumHours = Number(row.minimum_hours)
    const minimumHours = Number.isFinite(storedMinimumHours) && storedMinimumHours > 0
      ? storedMinimumHours
      : 0
    const requestedHours = typeof durationHours === 'number' && Number.isFinite(durationHours)
      ? durationHours
      : 4
    return Math.round(hourlyRate * Math.max(minimumHours, requestedHours, 1))
  }

  return readPositiveCents(
    row.daily_rate_cents as number | string | null | undefined,
    row.daily_rate as number | string | null | undefined
  ) ?? readPositiveCents(
    row.price_per_night_cents as number | string | null | undefined,
    row.price_per_night as number | string | null | undefined
  )
}
