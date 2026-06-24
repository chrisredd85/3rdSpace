import fs from 'fs'
import path from 'path'

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20260624012000_add_discovery_venue_capacity_inference.sql'
)

describe('discovery venue capacity inference migration', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8')

  it('adds additive capacity inference columns and admin review state', () => {
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS inferred_capacity_standing INTEGER')
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS inferred_capacity_seated INTEGER')
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS capacity_inference_confidence REAL')
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS capacity_inference_source_quote TEXT')
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS capacity_inference_model VARCHAR(64)')
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS capacity_inference_extracted_at TIMESTAMPTZ')
    expect(sql).toContain("capacity_inference_admin_status VARCHAR(20) DEFAULT 'pending'")
    expect(sql).toContain("CHECK (capacity_inference_admin_status IN ('pending', 'approved', 'rejected', 'edited'))")
  })

  it('indexes pending review rows and capacity inference jobs without changing RLS', () => {
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_discovery_venues_capacity_admin')
    expect(sql).toContain("WHERE capacity_inference_admin_status = 'pending'")
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_app_jobs_infer_venue_capacity')
    expect(sql).toContain("WHERE job_type = 'infer_venue_capacity'")
    expect(sql).not.toMatch(/DISABLE ROW LEVEL SECURITY/i)
    expect(sql).not.toMatch(/DROP TABLE/i)
  })
})
