import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260709176000_harden_canonical_vendor_claim_binding.sql'),
  'utf8',
)

describe('canonical vendor claim binding migration', () => {
  it('keeps ambiguous legacy links intact while creating one unique claim authority', () => {
    expect(migration).toContain('CREATE TABLE public.discovery_vendor_claims')
    expect(migration).toContain('discovery_vendor_id UUID PRIMARY KEY')
    expect(migration).toContain('vendor_profile_id UUID NOT NULL UNIQUE')
    expect(migration).toContain('HAVING COUNT(*) = 1')
    expect(migration).toContain('ON CONFLICT DO NOTHING')
    expect(migration).not.toMatch(/DELETE\s+FROM\s+public\.vendor_profiles/i)
    expect(migration).not.toMatch(/SET\s+discovery_vendor_id\s*=\s*NULL/i)
  })

  it('blocks browser claim writes and exposes only the locked service command', () => {
    expect(migration).toContain('vendor_profile_discovery_claim_requires_service_command')
    expect(migration).toContain('vendor_profile_discovery_claim_is_immutable')
    expect(migration).toContain('vendor_profile_discovery_claim_legacy_collision')
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.bind_discovery_vendor_claim(')
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.bind_discovery_vendor_claim\([\s\S]+?SECURITY DEFINER/,
    )
    expect(migration).toMatch(
      /FROM public\.vendor_profiles AS profile[\s\S]+?profile\.id = p_vendor_profile_id[\s\S]+?FOR UPDATE;/,
    )
    expect(migration).toMatch(
      /FROM public\.discovery_vendors AS vendor[\s\S]+?vendor\.id = p_discovery_vendor_id[\s\S]+?FOR UPDATE;/,
    )
    expect(migration).toContain('bind_discovery_vendor_claim_rebind_forbidden')
    expect(migration).toContain('bind_discovery_vendor_claim_collision')
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.bind_discovery_vendor_claim(UUID, UUID, UUID)',
    )
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.bind_discovery_vendor_claim(UUID, UUID, UUID)\n  TO service_role;',
    )
  })

  it('freezes the physical partner before booking insertion', () => {
    expect(migration).toContain('CREATE TABLE public.canonical_booking_partner_bindings')
    expect(migration).toContain('agent_action_id UUID NOT NULL UNIQUE')
    expect(migration).toContain('approval_id UUID NOT NULL UNIQUE')
    expect(migration).toContain('approval_snapshot_hash TEXT NOT NULL')
    expect(migration).toContain('canonical_booking_partner_binding_is_immutable')
    expect(migration).toContain('CREATE TRIGGER a_freeze_venue_booking_partner_binding_trigger')
    expect(migration).toContain('CREATE TRIGGER a_freeze_vendor_booking_partner_binding_trigger')
    expect(migration).toContain('PERFORM public.ensure_canonical_booking_partner_binding(')
  })

  it('uses the frozen binding for provenance and exact lifecycle replay', () => {
    expect(migration).toContain('JOIN public.canonical_booking_partner_bindings AS binding')
    expect(migration).toContain('binding.discovery_partner_id = action_row.target_id')
    expect(migration).toContain('binding.physical_partner_id = p_partner_id')
    expect(migration).not.toContain(
      "vendor_profile.discovery_vendor_id::TEXT = action_row.payload_json ->> 'target_id'",
    )
    expect(migration).toContain('confirm_canonical_booking_pre_frozen_binding')
    expect(migration).toContain('decline_canonical_bookings_pre_frozen_binding')
    expect(migration).toContain('cancel_executing_canonical_quote_booking_pre_frozen_binding')
    expect(migration.match(/PERFORM public\.assert_canonical_booking_partner_binding\(/g)).toHaveLength(3)
  })

  it('keeps both authority tables outside browser grants', () => {
    expect(migration).toContain('ALTER TABLE public.discovery_vendor_claims ENABLE ROW LEVEL SECURITY')
    expect(migration).toContain(
      'REVOKE ALL ON TABLE public.discovery_vendor_claims FROM PUBLIC, anon, authenticated',
    )
    expect(migration).toContain(
      'ALTER TABLE public.canonical_booking_partner_bindings ENABLE ROW LEVEL SECURITY',
    )
    expect(migration).toContain(
      'REVOKE ALL ON TABLE public.canonical_booking_partner_bindings FROM PUBLIC, anon, authenticated',
    )
    expect(migration).toContain(
      'GRANT SELECT ON TABLE public.discovery_vendor_claims TO service_role',
    )
    expect(migration).toContain(
      'GRANT SELECT ON TABLE public.canonical_booking_partner_bindings TO service_role',
    )
    expect(migration).toMatch(
      /REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER\s+ON TABLE public\.discovery_vendor_claims FROM service_role/,
    )
    expect(migration).toMatch(
      /REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER\s+ON TABLE public\.canonical_booking_partner_bindings FROM service_role/,
    )
    expect(migration).not.toMatch(
      /GRANT\s+(?:[A-Z]+,\s*)*INSERT(?:,\s*[A-Z]+)*\s+ON TABLE public\.(?:discovery_vendor_claims|canonical_booking_partner_bindings)\s+TO service_role/i,
    )
  })
})
