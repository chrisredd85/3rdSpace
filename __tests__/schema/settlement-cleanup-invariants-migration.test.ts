import fs from 'fs'
import path from 'path'

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20260624017000_add_settlement_cleanup_invariants.sql'
)

describe('settlement cleanup invariants migration', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8')

  it('enforces USD-only settlement charges', () => {
    expect(sql).toContain('ADD CONSTRAINT settlement_charges_currency_check')
    expect(sql).toContain("CHECK (currency = 'usd')")
  })

  it('enforces zero 3rdPlace platform fee and full organizer payout', () => {
    expect(sql).toContain('ADD CONSTRAINT settlement_charges_zero_platform_fee_check')
    expect(sql).toContain('platform_fee_cents = 0')
    expect(sql).toContain('organizer_payout_cents = amount_cents')
  })
})
