import { readFileSync } from 'fs'
import path from 'path'

const migration = readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20260625090000_restrict_discovery_venue_contact_fields.sql'),
  'utf8'
)

const discoverVenuesRoute = readFileSync(
  path.join(process.cwd(), 'app/api/planner/plans/[planId]/discover-venues/route.ts'),
  'utf8'
)

const approveBatchRoute = readFileSync(
  path.join(process.cwd(), 'app/api/planner/plans/[planId]/outreach/approve-batch/route.ts'),
  'utf8'
)

describe('discovery venue contact RLS contract', () => {
  it('revokes broad authenticated access to raw contact and extraction columns', () => {
    expect(migration).toContain('REVOKE SELECT ON public.discovery_venues FROM authenticated')
    expect(migration).toContain('GRANT SELECT (')
    expect(migration).toContain('contact_email')
    expect(migration).toContain('contact_phone')
    expect(migration).toContain('extracted_emails')
    expect(migration).toContain('organizer_provided_emails')
    expect(migration).toContain('website_extraction_status')
    expect(migration).toContain(') ON public.discovery_venues TO authenticated')
    expect(migration).toContain('GRANT ALL ON public.discovery_venues TO service_role')
  })

  it('defines a plan-scoped contact visibility predicate and filtered view', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.can_read_discovery_venue_contact')
    expect(migration).toContain("COALESCE(auth.jwt()->>'role', '') = 'service_role'")
    expect(migration).toContain('FROM public.plan_discovery_venue_candidates candidate')
    expect(migration).toContain('JOIN public.plans plan')
    expect(migration).toContain('AND plan.user_id = auth.uid()')
    expect(migration).toContain('CREATE OR REPLACE VIEW public.discovery_venues_with_contact')
    expect(migration).toContain('CASE WHEN public.can_read_discovery_venue_contact(v.id) THEN v.contact_email ELSE NULL END AS contact_email')
    expect(migration).toContain("CASE WHEN public.can_read_discovery_venue_contact(v.id) THEN v.extracted_emails ELSE '[]'::jsonb END AS extracted_emails")
    expect(migration).toContain('GRANT SELECT ON public.discovery_venues_with_contact TO authenticated')
  })

  it('routes host-facing contact reads through the filtered view', () => {
    expect(discoverVenuesRoute).toContain(".from('discovery_venues_with_contact')")
    expect(approveBatchRoute).toContain(".from('discovery_venues_with_contact')")
  })
})
