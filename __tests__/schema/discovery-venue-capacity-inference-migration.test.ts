import { readFileSync } from 'fs'
import path from 'path'

const migration = readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20260624012000_add_discovery_venue_capacity_inference.sql'),
  'utf8'
)

const generatedTypes = readFileSync(
  path.join(process.cwd(), 'lib/types/database-generated.ts'),
  'utf8'
)

describe('discovery venue capacity inference migration', () => {
  it('adds one-time inferred capacity fields to discovery venues', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS inferred_capacity_standing INTEGER')
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS inferred_capacity_seated INTEGER')
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS capacity_inference_confidence REAL')
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS capacity_inference_source_quote TEXT')
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS capacity_inference_model VARCHAR(64)')
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS capacity_inference_extracted_at TIMESTAMPTZ')
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS capacity_inference_admin_status VARCHAR(20) DEFAULT 'pending'")
  })

  it('guards inferred capacity ranges and admin status values', () => {
    expect(migration).toContain('discovery_venues_inferred_capacity_standing_check')
    expect(migration).toContain('inferred_capacity_standing IS NULL OR inferred_capacity_standing >= 0')
    expect(migration).toContain('discovery_venues_inferred_capacity_seated_check')
    expect(migration).toContain('inferred_capacity_seated IS NULL OR inferred_capacity_seated >= 0')
    expect(migration).toContain('discovery_venues_capacity_inference_confidence_check')
    expect(migration).toContain('capacity_inference_confidence >= 0 AND capacity_inference_confidence <= 1')
    expect(migration).toContain("capacity_inference_admin_status IN ('pending', 'approved', 'rejected', 'edited')")
  })

  it('indexes admin review and uninferred backfill queues', () => {
    expect(migration).toContain('idx_discovery_venues_capacity_admin')
    expect(migration).toContain("WHERE capacity_inference_admin_status = 'pending'")
    expect(migration).toContain('idx_discovery_venues_capacity_uninferred')
    expect(migration).toContain('WHERE capacity_inference_extracted_at IS NULL')
  })

  it('updates generated discovery venue types for runtime queries', () => {
    for (const column of [
      'inferred_capacity_standing: number | null',
      'inferred_capacity_seated: number | null',
      'capacity_inference_confidence: number | null',
      'capacity_inference_source_quote: string | null',
      'capacity_inference_model: string | null',
      'capacity_inference_extracted_at: string | null',
      'capacity_inference_admin_status: string | null',
    ]) {
      expect(generatedTypes).toContain(column)
    }
  })
})
