import { normalizeVenue } from '@/lib/venues/venue-adapter'
import {
  buildVenueNightlyRateReconciliation,
  estimateVenueRentalCents,
  readVenueRentalRateCents,
  VENUE_NIGHTLY_RATE_AUTHORITY_KEY,
} from '@/lib/venues/venueRateUnits'

describe('venue nightly-rate reconciliation', () => {
  it('round-trips an existing triple-written row through a new authoritative nightly save', () => {
    const existing = {
      id: 'venue-1',
      venue_name: 'Reconciled Hall',
      hourly_rate_cents: 350_000,
      daily_rate_cents: 350_000,
      price_per_night_cents: 350_000,
      auto_approve_conditions: { neighborhood: 'Mission' },
    }
    const update = buildVenueNightlyRateReconciliation({
      pricePerNightDollars: 95.5,
      existing,
    })
    const saved = { ...existing, ...update }

    expect(update).toEqual({
      price_per_night_cents: 9550,
      hourly_rate_cents: null,
      daily_rate_cents: null,
      auto_approve_conditions: {
        neighborhood: 'Mission',
        [VENUE_NIGHTLY_RATE_AUTHORITY_KEY]: true,
      },
    })
    expect(readVenueRentalRateCents(saved)).toBe(9550)
    expect(estimateVenueRentalCents(saved)).toBe(9550)
    expect(normalizeVenue(saved)).toEqual(expect.objectContaining({
      hourly_rate_cents: null,
      daily_rate: 9550,
      daily_rate_cents: 9550,
      price_per_night_cents: 9550,
    }))
  })

  it('preserves ambiguous legacy fields but makes the explicitly saved nightly rate win', () => {
    const existing = {
      hourly_rate_cents: 35_000,
      daily_rate_cents: 120_000,
      price_per_night_cents: 100_000,
      auto_approve_conditions: { commercial_terms_supported: ['flat_rental'] },
    }
    const update = buildVenueNightlyRateReconciliation({
      pricePerNightDollars: 95.5,
      existing,
    })
    const saved = { ...existing, ...update }

    expect(update).not.toHaveProperty('hourly_rate_cents')
    expect(update).not.toHaveProperty('daily_rate_cents')
    expect(saved.hourly_rate_cents).toBe(35_000)
    expect(saved.daily_rate_cents).toBe(120_000)
    expect(readVenueRentalRateCents(saved)).toBe(9550)
    expect(estimateVenueRentalCents(saved, 8)).toBe(9550)
  })

  it('keeps untouched historical rows on the legacy precedence path', () => {
    expect(estimateVenueRentalCents({
      hourly_rate_cents: 20_000,
      daily_rate_cents: 100_000,
      price_per_night_cents: 95_500,
      minimum_hours: 4,
    })).toBe(80_000)
  })

  it('does not erase duplicate history when no replacement nightly rate is supplied', () => {
    const update = buildVenueNightlyRateReconciliation({
      pricePerNightDollars: null,
      existing: {
        hourly_rate_cents: 350_000,
        daily_rate_cents: 350_000,
        price_per_night_cents: 350_000,
      },
    })

    expect(update).not.toHaveProperty('hourly_rate_cents')
    expect(update).not.toHaveProperty('daily_rate_cents')
    expect(update.price_per_night_cents).toBeNull()
    expect(update.auto_approve_conditions[VENUE_NIGHTLY_RATE_AUTHORITY_KEY]).toBe(false)
  })
})
