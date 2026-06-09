import { validatePaymentApprovalForExecution, type PaymentApprovalRow } from '../paymentApproval'

const baseApproval: PaymentApprovalRow = {
  id: 'approval-1',
  plan_id: 'plan-1',
  status: 'authorized',
  requested_amount_cents: 120000,
  authorized_amount_cents: null,
  price_cents: null,
  expires_at: null,
}

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
    })).toMatchObject({ ok: false, status: 422 })

    expect(validatePaymentApprovalForExecution({
      approval: { ...baseApproval, status: 'rejected' },
      expectedAmountCents: 120000,
    })).toMatchObject({ ok: false, status: 422 })
  })

  it('requires re-approval when the amount or plan changed', () => {
    expect(validatePaymentApprovalForExecution({
      approval: baseApproval,
      expectedPlanId: 'other-plan',
      expectedAmountCents: 120000,
    })).toMatchObject({ ok: false, status: 404 })

    expect(validatePaymentApprovalForExecution({
      approval: baseApproval,
      expectedPlanId: 'plan-1',
      expectedAmountCents: 125000,
    })).toMatchObject({ ok: false, status: 409 })
  })

  it('rejects expired approvals and unsafe cents values', () => {
    expect(validatePaymentApprovalForExecution({
      approval: { ...baseApproval, expires_at: '2026-01-01T00:00:00.000Z' },
      expectedAmountCents: 120000,
      now: new Date('2026-01-02T00:00:00.000Z'),
    })).toMatchObject({ ok: false, status: 409 })

    expect(validatePaymentApprovalForExecution({
      approval: baseApproval,
      expectedAmountCents: 12.5,
    })).toMatchObject({ ok: false, status: 422 })
  })
})
