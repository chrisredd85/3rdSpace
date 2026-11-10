import type { DurableDiscovery } from '@/lib/discovery/foundation/boundary'
import type { FieldProvenance } from '@/lib/discovery/foundation/provenance'

/** Seed a synthetic identity and an independently supplied host name through the real gateways. */
export function seedIndependentDiscoveryVenue(
  psql: (sql: string) => string,
  input: { placeId: string; name: string },
): { id: string; venueData: DurableDiscovery } {
  const literal = (value: string) => `'${value.replaceAll("'", "''")}'`
  const provenance: FieldProvenance = {
    resolution: 'resolved',
    source: 'host_input',
    evidence_reference: `fixture:${input.placeId}:host-name`,
    collected_at: '2026-09-23T00:00:00Z',
    confidence: null,
    confirmation_status: 'unconfirmed',
    lineage: [],
  }
  const row = JSON.parse(psql(`
    begin;
    set local role service_role;
    set local request.jwt.claim.role = 'service_role';
    select public.write_discovery_venue_independent_facts(
      (public.upsert_discovery_venue_identity(${literal(input.placeId)})->>'id')::uuid,
      ${literal(JSON.stringify({ name: input.name }))}::jsonb,
      ${literal(JSON.stringify({ name: provenance }))}::jsonb
    );
    commit;
  `)) as {
    id: string
    name: string
    source_external_id: string
    metadata: { field_provenance: { name: FieldProvenance } }
  }
  if (!row.id || row.name !== input.name || row.source_external_id !== input.placeId
    || row.metadata?.field_provenance?.name?.resolution !== 'resolved') {
    throw new Error('Independent venue fixture was not returned by the safe gateway')
  }
  return {
    id: row.id,
    // Copy the gateway's saved values/evidence, not a self-authorizing envelope.
    venueData: {
      schema_version: 1,
      identity: { kind: 'venue', id: row.id, place_id: row.source_external_id },
      values: { name: row.name },
      field_provenance: { name: row.metadata.field_provenance.name },
    },
  }
}
