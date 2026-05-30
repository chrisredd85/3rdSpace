import { readFileSync } from 'fs'
import path from 'path'

const migration = readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20260530000000_venue_payment_transactions.sql'),
  'utf8'
)

const generatedTypes = readFileSync(
  path.join(process.cwd(), 'lib/types/database-generated.ts'),
  'utf8'
)

const constraintMigration = readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20260530000001_venue_payment_transactions_constraints.sql'),
  'utf8'
)

describe('venue payment transactions migration', () => {
  it('creates the venue rental payment ledger with required ownership anchors', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.venue_payment_transactions')
    expect(migration).toContain('plan_id uuid NOT NULL REFERENCES public.plans(id) ON DELETE RESTRICT')
    expect(migration).toContain('venue_booking_id uuid REFERENCES public.venue_bookings(id) ON DELETE SET NULL')
    expect(migration).toContain('builder_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT')
    expect(migration).toContain('venue_id uuid NOT NULL REFERENCES public.venues(id) ON DELETE RESTRICT')
    expect(migration).toContain('venue_owner_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT')
  })

  it('stores all monetary values in cents with approved bounds and USD only', () => {
    expect(migration).toContain('amount_cents integer NOT NULL')
    expect(migration).toContain('processing_fee_cents integer NOT NULL DEFAULT 0')
    expect(migration).toContain('application_fee_cents integer NOT NULL DEFAULT 0')
    expect(migration).toContain('venue_payout_cents integer NOT NULL')
    expect(migration).toContain('CHECK (amount_cents >= 50 AND amount_cents <= 5000000)')
    expect(migration).toContain("CHECK (currency = 'usd')")
  })

  it('uses the approved Phase 2 status and payment method sets', () => {
    for (const status of [
      'pending_builder_payment',
      'checkout_created',
      'paid',
      'refund_requested',
      'refund_approved',
      'refunded_partial',
      'refunded_full',
      'cancelled',
      'failed',
    ]) {
      expect(migration).toContain(`'${status}'`)
    }

    expect(migration).not.toContain("'transfer_complete'")
    expect(migration).toContain("payment_method_type IN ('card', 'us_bank_account')")
    expect(migration).toContain('transfer_completed_at timestamptz')
  })

  it('adds idempotency and Stripe lookup indexes', () => {
    expect(migration).toContain('idx_venue_payment_transactions_plan_booking_unique')
    expect(migration).toContain('ON public.venue_payment_transactions(plan_id, venue_booking_id)')
    expect(migration).toContain('WHERE venue_booking_id IS NOT NULL')
    expect(migration).toContain('idx_venue_payment_transactions_checkout_session_unique')
    expect(migration).toContain('idx_venue_payment_transactions_payment_intent_unique')
    expect(migration).toContain('idx_venue_payment_transactions_transfer_unique')
  })

  it('enables RLS, read policies, service-role management, and updated_at maintenance', () => {
    expect(migration).toContain('ALTER TABLE public.venue_payment_transactions ENABLE ROW LEVEL SECURITY')
    expect(migration).toContain('"Builders can read own venue payment transactions"')
    expect(migration).toContain('"Venue owners can read own venue payment transactions"')
    expect(migration).toContain('"Service role can manage venue payment transactions"')
    expect(migration).toContain('FOR ALL')
    expect(migration).toContain('auth.jwt()->>\'role\' = \'service_role\'')
    expect(migration).toContain('CREATE TRIGGER update_venue_payment_transactions_updated_at')
    expect(migration).toContain('EXECUTE FUNCTION public.update_updated_at_column()')
  })

  it('regenerates the database type contract for the new ledger table', () => {
    expect(generatedTypes).toContain('venue_payment_transactions: {')
    expect(generatedTypes).toContain('amount_cents: number')
    expect(generatedTypes).toContain('processing_fee_cents: number')
    expect(generatedTypes).toContain('stripe_checkout_session_id: string | null')
    expect(generatedTypes).toContain('stripe_transfer_reversal_id: string | null')
    expect(generatedTypes).toContain('venue_payment_transactions_venue_booking_id_fkey')
    expect(generatedTypes).toContain('referencedRelation: "venue_bookings"')
  })

  it('tightens payout and refund invariants before checkout writes rows', () => {
    expect(constraintMigration).toContain('venue_payment_transactions_payout_lte_amount_check')
    expect(constraintMigration).toContain('CHECK (venue_payout_cents <= amount_cents)')
    expect(constraintMigration).toContain('ALTER COLUMN payment_method_type SET NOT NULL')
    expect(constraintMigration).toContain('DROP CONSTRAINT IF EXISTS venue_payment_transactions_refund_amount_cents_check')
    expect(constraintMigration).toContain('refund_amount_cents >= 0 AND refund_amount_cents <= amount_cents')
  })
})
