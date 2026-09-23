import { readFieldProvenance, retentionOrigin } from '../provenance'

const evidence = (source = 'venue_site', extra: Record<string, unknown> = {}) => ({
  resolution: 'resolved', source, evidence_reference: 'evidence:capacity-page:1',
  collected_at: '2026-09-22T12:00:00Z', confidence: 0.8,
  confirmation_status: 'site_published', lineage: [], ...extra,
})

describe('dormant field provenance', () => {
  it('keeps acquisition, confidence and confirmation separate for identical facts', () => {
    const value = 60
    const website = { value, provenance: readFieldProvenance(evidence()) }
    const reply = { value, provenance: readFieldProvenance(evidence('outreach_reply', {
      evidence_reference: 'reply:1', confidence: 1, confirmation_status: 'venue_confirmed',
    })) }
    expect(website.value).toBe(reply.value)
    expect(website.provenance).toMatchObject({ source: 'venue_site', confidence: 0.8, confirmation_status: 'site_published' })
    expect(reply.provenance).toMatchObject({ source: 'outreach_reply', confidence: 1, confirmation_status: 'venue_confirmed' })
    expect(retentionOrigin(website.provenance)).toBe('independent')
    expect(retentionOrigin(reply.provenance)).toBe('independent')
  })

  it('propagates Google ancestry through mixed, nested estimates despite a claimed approval', () => {
    const google = evidence('google_places', { confirmation_status: 'venue_confirmed', host_approved: true })
    const intermediate = evidence('derived', { lineage: [{ field: 'types', provenance: google }] })
    const result = readFieldProvenance(evidence('derived', {
      confirmation_status: 'venue_confirmed',
      lineage: [{ field: 'capacity_hint', provenance: intermediate }, { field: 'layout', provenance: evidence() }],
    }))
    expect(retentionOrigin(result)).toBe('google_derived')
    expect(result).toMatchObject({ source: 'derived', confirmation_status: 'unconfirmed' })
    expect(JSON.stringify(result)).not.toContain('host_approved')
  })

  it('retains explicitly evidenced independent estimates without promoting confirmation', () => {
    const result = readFieldProvenance(evidence('derived', {
      confirmation_status: 'unconfirmed', confidence: 0,
      lineage: [{ field: 'room_dimensions', provenance: evidence('host_input') }],
    }))
    expect(retentionOrigin(result)).toBe('independent')
    expect(result).toMatchObject({ confidence: 0, confirmation_status: 'unconfirmed' })
  })

  it.each([undefined, null, {}, { source: 'manual_seed' }, evidence('derived'), evidence('unknown'),
    evidence('venue_site', { collected_at: 'yesterday' }), evidence('venue_site', { evidence_reference: '' }),
    evidence('venue_site', { confidence: 1.5 }), evidence('venue_site', { confirmation_status: 'approved' }),
  ])('keeps missing/malformed/unsupported provenance unresolved: %p', input => {
    expect(retentionOrigin(readFieldProvenance(input))).toBe('unresolved')
  })

  it('does not treat partial lineage as independent and terminates on cycles', () => {
    const partial = readFieldProvenance(evidence('derived', { lineage: [{ field: 'unknown', provenance: null }] }))
    expect(retentionOrigin(partial)).toBe('unresolved')
    const cyclic: Record<string, unknown> = evidence('derived')
    cyclic.lineage = [{ field: 'self', provenance: cyclic }]
    expect(retentionOrigin(readFieldProvenance(cyclic))).toBe('unresolved')
  })
})
