import { readFileSync } from 'fs'
import path from 'path'

describe('marketplace money cents migration', () => {
  const migration = readFileSync(
    path.join(process.cwd(), 'supabase/migrations/20260527000001_normalize_marketplace_money_cents.sql'),
    'utf8'
  )

  it('adds canonical cents columns for vendor transactions', () => {
    expect(migration).toContain('amount_cents integer')
    expect(migration).toContain('platform_fee_cents integer')
    expect(migration).toContain('stripe_fee_cents integer')
    expect(migration).toContain('vendor_payout_cents integer')
    expect(migration).toContain('ROUND(amount * 100)::integer')
    expect(migration).toContain('sync_vendor_transaction_money_units')
  })

  it('adds canonical cents columns for venue pricing and kickbacks', () => {
    expect(migration).toContain('hourly_rate_cents integer')
    expect(migration).toContain('daily_rate_cents integer')
    expect(migration).toContain('price_per_night_cents integer')
    expect(migration).toContain('deposit_amount_cents integer')
    expect(migration).toContain('per_head_kickback_cents')
    expect(migration).toContain('sync_venue_money_units')
  })
})
