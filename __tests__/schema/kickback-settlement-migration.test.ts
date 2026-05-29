import fs from 'fs'
import path from 'path'

const migration = fs.readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20260527000002_kickback_settlement.sql'),
  'utf8'
)

describe('kickback settlement migration', () => {
  it('allows planner-linked settlement rows without legacy event rows', () => {
    expect(migration).toContain('ALTER COLUMN event_id DROP NOT NULL')
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS plan_id uuid')
    expect(migration).toContain('FOREIGN KEY (plan_id) REFERENCES public.plans(id) ON DELETE SET NULL')
    expect(migration).toContain('idx_event_kickback_agreements_plan_status')
  })

  it('moves kickback payment uniqueness from event to agreement', () => {
    expect(migration).toContain('DROP INDEX IF EXISTS public.idx_kickback_payments_event_unique')
    expect(migration).toContain('CREATE UNIQUE INDEX IF NOT EXISTS idx_kickback_payments_agreement_unique')
    expect(migration).toContain('ON public.kickback_payments(agreement_id)')
    expect(migration).toContain('ON CONFLICT (agreement_id)')
    expect(migration).not.toContain('ON CONFLICT (event_id)')
  })

  it('adds invoice settlement, compliance, and refund columns in cents', () => {
    for (const column of [
      'amount_cents',
      'settlement_method',
      'stripe_invoice_id',
      'invoice_hosted_url',
      'due_date',
      'processing_fee_cents',
      'builder_payout_cents',
      'paid_at',
      'refund_amount_cents',
      'stripe_refund_id',
    ]) {
      expect(migration).toContain(column)
    }

    expect(migration).toContain("'pending_venue_approval'")
    expect(migration).toContain("'invoice_sent'")
    expect(migration).toContain("'refund_requested'")
    expect(migration).toContain("'refunded_partial'")
  })

  it('creates private proof buckets without direct upload policies', () => {
    expect(migration).toContain("'event-reports'")
    expect(migration).toContain("'venue-spend-reports'")
    expect(migration).toContain('10485760')
    expect(migration).toContain('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    expect(migration).not.toMatch(/CREATE POLICY[\s\S]+storage\.objects/i)
  })
})
