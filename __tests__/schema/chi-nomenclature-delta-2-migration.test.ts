import { readFileSync } from 'fs'
import path from 'path'

const additiveMigration = readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20260618013000_chi_nomenclature_additive_phase.sql'),
  'utf8'
)

const cleanupMigration = readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20260618013100_chi_nomenclature_drop_sync.sql'),
  'utf8'
)

describe('CHI nomenclature delta.2 migrations', () => {
  it('adds CHI-named event revenue term values without dropping legacy values', () => {
    expect(additiveMigration).toContain("'venue_chi'")
    expect(additiveMigration).toContain("'vendor_consumption_share'")
    expect(additiveMigration).toContain("'venue_kickback'")
    expect(additiveMigration).toContain("'vendor_rev_share'")
    expect(additiveMigration).not.toContain('DROP TABLE')
    expect(additiveMigration).not.toContain('ALTER TABLE public.kickback_payments RENAME')
  })

  it('adds and backfills canonical consumption-share flags', () => {
    expect(additiveMigration).toContain('ADD COLUMN IF NOT EXISTS is_legacy_consumption_share boolean')
    expect(additiveMigration).toContain('SET is_legacy_consumption_share = is_legacy_revenue_share')
    expect(additiveMigration).toContain('is_legacy_consumption_share IS DISTINCT FROM is_legacy_revenue_share')
  })

  it('keeps the CHI payments read model compatible during the cutover', () => {
    expect(additiveMigration).toContain('CREATE OR REPLACE VIEW public.community_host_incentive_payments')
    expect(additiveMigration).toContain('settlement.is_legacy_consumption_share')
    expect(additiveMigration).toContain('settlement.is_legacy_revenue_share')
  })

  it('removes temporary sync triggers only after mismatch assertions', () => {
    expect(cleanupMigration).toContain('DROP TRIGGER IF EXISTS sync_chi_agreements_consumption_share_flag')
    expect(cleanupMigration).toContain('DROP TRIGGER IF EXISTS sync_chi_settlements_consumption_share_flag')
    expect(cleanupMigration).toContain('Cannot drop CHI agreement sync trigger with mismatched flags')
    expect(cleanupMigration).toContain('Cannot drop CHI settlement sync trigger with mismatched flags')
  })
})
