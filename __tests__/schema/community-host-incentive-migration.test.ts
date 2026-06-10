import { readFileSync } from 'fs'
import path from 'path'

const migration = readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20260609000000_add_community_host_incentive_foundation.sql'),
  'utf8'
)

describe('community host incentive foundation migration', () => {
  it('creates CHI agreement and settlement tables alongside legacy tables', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.community_host_incentive_agreements')
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.community_host_incentive_settlements')
    expect(migration).not.toContain('ALTER TABLE public.event_kickback_agreements RENAME')
    expect(migration).not.toContain('ALTER TABLE public.kickback_payments RENAME')
  })

  it('stores money as integer cents with non-negative constraints', () => {
    for (const column of [
      'per_head_rate_cents integer',
      'fixed_amount_cents integer',
      'base_amount_cents integer',
      'payout_floor_cents integer',
      'payout_cap_cents integer',
      'organizer_payout_cents integer NOT NULL',
    ]) {
      expect(migration).toContain(column)
    }

    expect(migration).toContain('CHECK (organizer_payout_cents >= 0)')
    expect(migration).not.toMatch(/numeric\([^)]*\).*_cents/i)
  })

  it('requires venue approval fields before approved settlement states', () => {
    expect(migration).toContain('community_host_incentive_agreements_approval_fields_check')
    expect(migration).toContain('community_host_incentive_agreements_approved_status_check')
    expect(migration).toContain("status NOT IN ('approved', 'active', 'completed')")
  })

  it('enables RLS and limits direct writes to service role', () => {
    expect(migration).toContain('ALTER TABLE public.community_host_incentive_agreements ENABLE ROW LEVEL SECURITY')
    expect(migration).toContain('ALTER TABLE public.community_host_incentive_settlements ENABLE ROW LEVEL SECURITY')
    expect(migration).toContain('Participants can read CHI agreements')
    expect(migration).toContain('Participants can read CHI settlements')
    expect(migration).toContain('Service role can manage CHI agreements')
    expect(migration).toContain('Service role can manage CHI settlements')
    expect(migration).not.toContain('FOR INSERT\n  TO authenticated')
    expect(migration).not.toContain('FOR UPDATE\n  TO authenticated')
  })
})
