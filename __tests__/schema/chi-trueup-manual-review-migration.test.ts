import fs from 'fs'
import path from 'path'

const migration = fs.readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20260624014000_add_chi_trueup_manual_review.sql'),
  'utf8',
)

describe('CHI true-up manual review migration', () => {
  it('creates an additive manual-review table with integer-cent rate fields', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.chi_trueup_manual_review')
    expect(migration).toContain('current_rate_cents INTEGER NOT NULL')
    expect(migration).toContain('proposed_rate_cents INTEGER NOT NULL')
    expect(migration).toContain('applied_rate_cents INTEGER')
    expect(migration).toContain('CONSTRAINT chi_trueup_manual_review_current_rate_check CHECK (current_rate_cents >= 0)')
    expect(migration).toContain('CONSTRAINT chi_trueup_manual_review_proposed_rate_check CHECK (proposed_rate_cents >= 0)')
  })

  it('adds movement observability to rate history without dropping existing data', () => {
    expect(migration).toContain('ALTER TABLE public.chi_rate_history')
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS movement_pct REAL')
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS movement_bucket TEXT')
    expect(migration).not.toMatch(/\bDROP\s+(TABLE|COLUMN)\b/i)
  })

  it('enables RLS and keeps service-role management explicit', () => {
    expect(migration).toContain('ALTER TABLE public.chi_trueup_manual_review ENABLE ROW LEVEL SECURITY')
    expect(migration).toContain('CREATE POLICY "Service role manages CHI true-up manual review"')
    expect(migration).toContain('CREATE POLICY "Organizers read own CHI true-up reviews"')
    expect(migration).toContain('GRANT ALL ON public.chi_trueup_manual_review TO service_role')
  })
})
