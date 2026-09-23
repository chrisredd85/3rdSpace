import { readLegacyVenueContent, versionVenueContentWrite } from '../venueLegacyReads'

it('does not recycle opaque unversioned model prose, while host messages stay intact', () => {
  const agent = { id: 'old', role: 'agent', content: 'GOOGLE_CANARY', metadata: { recommendation_response: { label: 'GOOGLE_CANARY' }, action_id: 'action-one' } }
  expect(JSON.stringify(readLegacyVenueContent('plan_messages', agent))).not.toContain('GOOGLE_CANARY')
  expect(readLegacyVenueContent('plan_messages', agent)).toMatchObject({ id: 'old', metadata: { action_id: 'action-one' } })
  const user = { ...agent, role: 'user', content: 'My event requirements' }
  expect(readLegacyVenueContent('plan_messages', user)).toBe(user)
  expect(agent.content).toBe('GOOGLE_CANARY')
})
it('masks unverified generated plan artifacts while retaining integer cents and intent', () => {
  const row = { id: 'plan', budget_cap_cents: 220000, neighborhood: 'Mission', metadata: { agent_cache: { summary: 'GOOGLE_CANARY' }, shopping_list: [{ name: 'GOOGLE_CANARY' }], ticket_price_target_cents: 2000 } }
  expect(readLegacyVenueContent('plans', row)).toEqual({ ...row, metadata: { ticket_price_target_cents: 2000 } })
})
it('versions only new mutable metadata and never rewrites a nested signed record', () => {
  const signed = { snapshot_hash: 'original', snapshot_json: { amount_cents: 70000 } }
  const row = { role: 'agent', content: 'Independent result', metadata: { approval: signed } }
  const next = versionVenueContentWrite('plan_messages', row)
  expect(next).toMatchObject({ metadata: { venue_content_version: 1, approval: signed } })
  expect(readLegacyVenueContent('plan_messages', next)).toBe(next)
  expect(versionVenueContentWrite('plans', { status: 'approved' })).toEqual({ status: 'approved' })
  expect(versionVenueContentWrite('approvals', signed)).toBe(signed)
})

it('keeps template rebook IDs and cents while unproved venue presentation becomes unavailable', () => {
  const original = { name: 'Host playbook', shopping_list: {
    selected_venue: { id: 'rec-1', reference_id: 'partner-1', external_name: 'GOOGLE_CANARY', price_cents: 50000, fit_score: 92 },
    recommendations: [{ type: 'venue', reference_id: 'partner-1', external_name: 'GOOGLE_CANARY', price_cents: 50000 }],
    approval: { snapshot_hash: 'original', amount_cents: 50000 },
  } }
  const result = readLegacyVenueContent('templates', original)
  expect(JSON.stringify(result)).not.toContain('GOOGLE_CANARY')
  expect(result).toMatchObject({ name: 'Host playbook', shopping_list: {
    selected_venue: { id: 'rec-1', reference_id: 'partner-1', price_cents: 50000 },
    recommendations: [{ type: 'venue', reference_id: 'partner-1', price_cents: 50000 }],
    approval: original.shopping_list.approval,
  } })
})
