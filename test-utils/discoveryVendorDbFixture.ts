import type { DurableDiscovery } from '@/lib/discovery/foundation/boundary'
import type { FieldProvenance } from '@/lib/discovery/foundation/provenance'

/** Save synthetic host-supplied vendor facts through the real service-role gateways. */
export function seedIndependentDiscoveryVendor(
  psql: (sql: string) => string,
  input: { placeId: string; name: string; serviceType: string },
): { id: string; vendorData: DurableDiscovery } {
  const literal = (value: string) => `'${value.replaceAll("'", "''")}'`
  const evidence = (field: string): FieldProvenance => ({
    resolution: 'resolved', source: 'host_input',
    evidence_reference: `fixture:${input.placeId}:host-${field}`,
    collected_at: '2026-11-10T00:00:00Z', confidence: null,
    confirmation_status: 'unconfirmed', lineage: [],
  })
  const row = JSON.parse(psql(`
    begin;
    set local role service_role;
    set local request.jwt.claim.role = 'service_role';
    select public.write_discovery_vendor_independent_facts(
      (public.upsert_discovery_vendor_identity(${literal(input.placeId)}, null)->>'id')::uuid,
      ${literal(JSON.stringify({ name: input.name, service_type: input.serviceType }))}::jsonb,
      ${literal(JSON.stringify({ name: evidence('name'), service_type: evidence('service-type') }))}::jsonb
    );
    commit;
  `)) as {
    id: string; name: string; service_type: string; source_external_id: string
    field_provenance: { name: FieldProvenance; service_type: FieldProvenance }
  }
  if (!row.id || row.name !== input.name || row.service_type !== input.serviceType
    || row.source_external_id !== input.placeId
    || row.field_provenance?.name?.resolution !== 'resolved'
    || row.field_provenance?.service_type?.resolution !== 'resolved') {
    throw new Error('Independent vendor fixture was not returned by the safe gateway')
  }
  return {
    id: row.id,
    // Use the gateway's persisted facts/evidence, not a self-authorizing envelope.
    vendorData: {
      schema_version: 1,
      identity: { kind: 'vendor', id: row.id, place_id: row.source_external_id },
      values: { name: row.name, service_type: row.service_type },
      field_provenance: { name: row.field_provenance.name, service_type: row.field_provenance.service_type },
    },
  }
}
