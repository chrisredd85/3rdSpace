import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260709175000_harden_prompt8_confirmation_side_effects.sql'),
  'utf8',
)
const invoiceSource = readFileSync(
  join(process.cwd(), 'lib/invoices/vendor-invoices.ts'),
  'utf8',
)

describe('Prompt 8 confirmation side-effect hardening', () => {
  it('reserves exactly one automatic invoice generation key per booking', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS booking_generation_key UUID')
    expect(migration).toContain('vendor_invoices_generation_key_matches_booking')
    expect(migration).toContain('CREATE UNIQUE INDEX IF NOT EXISTS vendor_invoices_booking_generation_unique')
    expect(migration).toContain('WHERE booking_generation_key IS NOT NULL')
  })

  it('uses the booking id for automatic generation and reconciles a concurrent winner', () => {
    expect(invoiceSource).toContain('generationKey: params.bookingId')
    expect(invoiceSource).toContain("insertError.code === '23505'")
    expect(invoiceSource).toContain(".eq('booking_generation_key', params.generationKey)")
  })
})
