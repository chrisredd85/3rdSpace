import {
  validateExecutableApprovalEvidence,
  validatePaymentApprovalForExecution,
  type PaymentApprovalRow,
} from '../paymentApproval'

const baseApproval: PaymentApprovalRow = {
  id: 'approval-1',
  plan_id: 'plan-1',
  status: 'authorized',
  authorized_by: 'user-1',
  authorized_at: '2026-01-01T00:00:00.000Z',
  requested_amount_cents: 120000,
  authorized_amount_cents: null,
  price_cents: null,
  expires_at: null,
  snapshot_hash: 'snapshot-hash-1',
}

describe('validateExecutableApprovalEvidence', () => {
  it.each([
    ['missing actor', { authorized_by: null }],
    ['blank actor', { authorized_by: '   ' }],
    ['missing authorization time', { authorized_at: null }],
    ['blank authorization time', { authorized_at: '   ' }],
    ['invalid authorization time', { authorized_at: 'not-a-timestamp' }],
    ['missing snapshot', { snapshot_hash: null }],
    ['empty snapshot', { snapshot_hash: '' }],
    ['blank snapshot', { snapshot_hash: '   ' }],
  ])('rejects %s', (_label, patch) => {
    expect(validateExecutableApprovalEvidence({ ...baseApproval, ...patch })).toEqual({
      ok: false,
      status: 409,
      code: 'APPROVAL_EVIDENCE_MISSING',
      error: 'Approval is missing authorization evidence. Review the latest terms and approve again.',
    })
  })

  it('rejects expired evidence', () => {
    expect(validateExecutableApprovalEvidence(
      { ...baseApproval, expires_at: '2026-01-01T00:00:00.000Z' },
      new Date('2026-01-02T00:00:00.000Z')
    )).toEqual({
      ok: false,
      status: 409,
      code: 'APPROVAL_EXPIRED',
      error: 'Approval expired. Review the latest terms and approve again.',
    })
  })

  it('accepts complete, unexpired evidence', () => {
    expect(validateExecutableApprovalEvidence(
      { ...baseApproval, expires_at: '2026-01-03T00:00:00.000Z' },
      new Date('2026-01-02T00:00:00.000Z')
    )).toEqual({ ok: true })
  })
})

describe('validatePaymentApprovalForExecution', () => {
  it('accepts a current authorized approval for the exact cents amount', () => {
    expect(validatePaymentApprovalForExecution({
      approval: baseApproval,
      expectedPlanId: 'plan-1',
      expectedAmountCents: 120000,
    })).toEqual({ ok: true, approvedAmountCents: 120000 })
  })

  it('rejects missing or non-executable approvals', () => {
    expect(validatePaymentApprovalForExecution({
      approval: null,
      expectedAmountCents: 120000,
    })).toMatchObject({ ok: false, status: 422, code: 'APPROVAL_MISSING' })

    expect(validatePaymentApprovalForExecution({
      approval: { ...baseApproval, status: 'rejected' },
      expectedAmountCents: 120000,
    })).toMatchObject({ ok: false, status: 422, code: 'APPROVAL_NOT_EXECUTABLE' })
  })

  it('requires re-approval when the amount or plan changed', () => {
    expect(validatePaymentApprovalForExecution({
      approval: baseApproval,
      expectedPlanId: 'other-plan',
      expectedAmountCents: 120000,
    })).toMatchObject({ ok: false, status: 404, code: 'APPROVAL_PLAN_MISMATCH' })

    expect(validatePaymentApprovalForExecution({
      approval: baseApproval,
      expectedPlanId: 'plan-1',
      expectedAmountCents: 125000,
    })).toMatchObject({ ok: false, status: 409, code: 'APPROVAL_AMOUNT_MISMATCH' })

    expect(validatePaymentApprovalForExecution({
      approval: { ...baseApproval, status: 're_approval_required' },
      expectedAmountCents: 120000,
    })).toMatchObject({ ok: false, status: 409, code: 'APPROVAL_STALE_REAPPROVE_REQUIRED' })
  })

  it('rejects expired approvals and unsafe cents values', () => {
    expect(validatePaymentApprovalForExecution({
      approval: { ...baseApproval, expires_at: '2026-01-01T00:00:00.000Z' },
      expectedAmountCents: 120000,
      now: new Date('2026-01-02T00:00:00.000Z'),
    })).toMatchObject({ ok: false, status: 409, code: 'APPROVAL_EXPIRED' })

    expect(validatePaymentApprovalForExecution({
      approval: baseApproval,
      expectedAmountCents: 12.5,
    })).toMatchObject({ ok: false, status: 422, code: 'UNSAFE_CENTS_VALUE' })
  })

  it.each([
    ['missing actor', { authorized_by: null }],
    ['missing authorization time', { authorized_at: null }],
    ['null snapshot', { snapshot_hash: null }],
    ['blank snapshot', { snapshot_hash: '   ' }],
  ])('rejects executable approval with %s before amount validation', (_label, patch) => {
    expect(validatePaymentApprovalForExecution({
      approval: { ...baseApproval, ...patch },
      expectedAmountCents: 120000,
    })).toMatchObject({
      ok: false,
      status: 409,
      code: 'APPROVAL_EVIDENCE_MISSING',
    })
  })

  it('requires approval counterparty to match the linked action target or payload', () => {
    expect(validatePaymentApprovalForExecution({
      approval: {
        ...baseApproval,
        agent_action: {
          id: 'action-1',
          target_type: 'vendor_transaction',
          target_id: 'transaction-1',
          payload_json: {},
        },
      },
      expectedAmountCents: 120000,
      expectedCounterparty: {
        targetType: 'vendor_transaction',
        targetId: 'transaction-1',
      },
    })).toMatchObject({ ok: true })

    expect(validatePaymentApprovalForExecution({
      approval: {
        ...baseApproval,
        agent_action: {
          id: 'action-1',
          payload_json: { platform_fee_transaction_id: 'platform-1' },
        },
      },
      expectedAmountCents: 120000,
      expectedCounterparty: {
        targetType: 'platform_fee_transaction',
        targetId: 'platform-1',
        payloadKeys: ['platform_fee_transaction_id'],
      },
    })).toMatchObject({ ok: true })

    expect(validatePaymentApprovalForExecution({
      approval: {
        ...baseApproval,
        agent_action: {
          id: 'action-1',
          target_type: 'vendor_transaction',
          target_id: 'transaction-2',
          payload_json: {},
        },
      },
      expectedAmountCents: 120000,
      expectedCounterparty: {
        targetType: 'vendor_transaction',
        targetId: 'transaction-1',
      },
    })).toMatchObject({ ok: false, status: 409, code: 'APPROVAL_COUNTERPARTY_MISMATCH' })
  })
})
