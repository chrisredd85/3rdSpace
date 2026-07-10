import {
  completeExternalCheckoutHandoff,
  executeExternalCheckoutHandoff,
  normalizeExternalCheckoutUrl,
  prepareExternalCheckoutHandoff,
  readExternalCheckoutHandoffEvidence,
  readExternalCheckoutUrl,
} from '../externalCheckout'

const ACTION_ID = '550e8400-e29b-41d4-a716-446655440001'
const PLAN_ID = '550e8400-e29b-41d4-a716-446655440002'
const APPROVAL_ID = '550e8400-e29b-41d4-a716-446655440003'
const USER_ID = '550e8400-e29b-41d4-a716-446655440004'
const SNAPSHOT_HASH = 'a'.repeat(64)

describe('external checkout execution handler', () => {
  it('normalizes only valid credential-free HTTPS URLs', () => {
    expect(normalizeExternalCheckoutUrl(' https://tickets.example/checkout?id=1 '))
      .toBe('https://tickets.example/checkout?id=1')
    expect(() => normalizeExternalCheckoutUrl('http://tickets.example/checkout')).toThrow(/HTTPS/)
    expect(() => normalizeExternalCheckoutUrl('https://user:secret@tickets.example/checkout')).toThrow(/credentials/)
    expect(() => normalizeExternalCheckoutUrl('not a url')).toThrow(/valid HTTPS URL/)
  })

  it('reads historical aliases but produces canonical durable handoff evidence', () => {
    expect(readExternalCheckoutUrl({ url: 'https://legacy.example/checkout' }))
      .toBe('https://legacy.example/checkout')
    expect(readExternalCheckoutUrl({ checkout_url: 'https://legacy.example/checkout-2' }))
      .toBe('https://legacy.example/checkout-2')

    const prepared = prepareExternalCheckoutHandoff({
      action: makeAction({ payload_json: { url: 'https://legacy.example/checkout' } }),
      approval: makeApproval(),
      now: new Date('2026-07-09T20:00:00.000Z'),
    })

    expect(prepared).toEqual(expect.objectContaining({ actionStatus: 'executing' }))
    expect(readExternalCheckoutHandoffEvidence(prepared.resultMetadata)).toEqual({
      status: 'ready',
      external_url: 'https://legacy.example/checkout',
      approval_id: APPROVAL_ID,
      snapshot_hash: SNAPSHOT_HASH,
      unlocked_at: '2026-07-09T20:00:00.000Z',
      completion_confirmation_required: true,
    })
  })

  it('persists ready evidence through the shared-dispatch contract without an external call', async () => {
    const maybeSingle = jest.fn().mockResolvedValue({ data: { id: ACTION_ID }, error: null })
    const select = jest.fn(() => ({ maybeSingle }))
    const eqStatus = jest.fn(() => ({ select }))
    const eqPlan = jest.fn(() => ({ eq: eqStatus }))
    const eqId = jest.fn(() => ({ eq: eqPlan }))
    const update = jest.fn(() => ({ eq: eqId }))
    const db = { from: jest.fn(() => ({ update })) }

    const result = await executeExternalCheckoutHandoff({
      db,
      action: makeAction(),
      approval: makeApproval(),
      plan: { id: PLAN_ID, user_id: USER_ID },
      actorId: USER_ID,
      now: new Date('2026-07-09T20:00:00.000Z'),
    })

    expect(result.disposition).toBe('executing')
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      result_metadata: expect.objectContaining({ execution_mode: 'external_checkout' }),
    }))
    expect(eqId).toHaveBeenCalledWith('id', ACTION_ID)
    expect(eqPlan).toHaveBeenCalledWith('plan_id', PLAN_ID)
    expect(eqStatus).toHaveBeenCalledWith('status', 'executing')
  })

  it('completes ready evidence without changing its approved identity', () => {
    const prepared = prepareExternalCheckoutHandoff({
      action: makeAction(),
      approval: makeApproval(),
      now: new Date('2026-07-09T20:00:00.000Z'),
    })
    const completed = completeExternalCheckoutHandoff({
      resultMetadata: prepared.resultMetadata,
      confirmedBy: USER_ID,
      now: new Date('2026-07-09T20:05:00.000Z'),
    })

    expect(completed.evidence).toEqual(expect.objectContaining({
      status: 'completed',
      external_url: 'https://tickets.example/checkout',
      approval_id: APPROVAL_ID,
      snapshot_hash: SNAPSHOT_HASH,
      confirmed_by: USER_ID,
      confirmation_source: 'host',
      completed_at: '2026-07-09T20:05:00.000Z',
    }))
  })
})

function makeAction(overrides: Record<string, unknown> = {}) {
  return {
    id: ACTION_ID,
    plan_id: PLAN_ID,
    action_type: 'external_checkout' as const,
    approval_id: APPROVAL_ID,
    payload_json: { external_url: 'https://tickets.example/checkout' },
    result_metadata: {},
    ...overrides,
  }
}

function makeApproval() {
  return {
    id: APPROVAL_ID,
    agent_action_id: ACTION_ID,
    status: 'authorized' as const,
    snapshot_hash: SNAPSHOT_HASH,
  }
}
