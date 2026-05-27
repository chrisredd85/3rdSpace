import { normalizeVenue, toVenueRowUpdate } from '@/lib/venues/venue-adapter'

describe('venue adapter money units', () => {
  it('prefers canonical cents columns and converts legacy dollar fields explicitly', () => {
    expect(normalizeVenue({
      id: 'venue-1',
      venue_name: 'Cents Hall',
      hourly_rate_cents: 35000,
      hourly_rate: 999,
      per_head_kickback_cents: 300,
      per_head_kickback_amount: 99,
      deposit_amount_cents: 50000,
      deposit_amount: 100,
    }).hourly_rate).toBe(35000)

    const legacy = normalizeVenue({
      id: 'venue-2',
      venue_name: 'Legacy Hall',
      hourly_rate: 350,
      per_head_kickback_amount: 3,
      deposit_amount: 500,
    })

    expect(legacy.hourly_rate).toBe(35000)
    expect(legacy.per_head_kickback_amount).toBe(300)
    expect(legacy.deposit_amount).toBe(50000)
  })

  it('writes canonical cents columns for venue money updates', () => {
    expect(toVenueRowUpdate({
      hourly_rate_cents: 35000,
      daily_rate_cents: 120000,
      per_head_kickback_cents: 300,
      deposit_amount_cents: 50000,
    })).toEqual(expect.objectContaining({
      hourly_rate_cents: 35000,
      daily_rate_cents: 120000,
      per_head_kickback_cents: 300,
      deposit_amount_cents: 50000,
    }))
  })
})
