jest.mock('server-only', () => ({}))

jest.mock('@sentry/nextjs', () => ({
  addBreadcrumb: jest.fn(),
  captureException: jest.fn(),
}))

jest.mock('@/lib/email', () => ({
  sendEmailNotification: jest.fn(),
}))

jest.mock('@/lib/finance/chi-rate-trueup', () => ({
  updateChiRateFromSettlement: jest.fn(),
}))

jest.mock('@/lib/stripe/connect', () => ({
  getAppBaseUrl: jest.fn(() => 'https://www.3rdplace.io'),
  getStripeClient: jest.fn(),
  isConnectedStripeAccountBlocked: jest.fn(),
}))

import { resolveDisputedSettlement } from '@/lib/finance/settlement-checkout'
import {
  SETTLEMENT_RUN_ID,
  SettlementMemoryDb,
} from '@/test-utils/settlementCheckoutDb'

describe('settlement admin audit attribution', () => {
  it('writes settlement and admin audit rows when an admin resolves a dispute', async () => {
    const db = new SettlementMemoryDb()
    db.rows.settlement_runs[0].status = 'disputed'
    db.rows.settlement_runs[0].dispute_reason = 'Venue disputed attendance count.'

    const result = await resolveDisputedSettlement(db as never, SETTLEMENT_RUN_ID, {
      actor: { id: 'admin-1', type: 'admin' },
      reason: 'Reviewed ticketing export and venue notes.',
    })

    expect(result.status).toBe(200)
    expect(db.rows.settlement_runs[0].status).toBe('awaiting_organizer_review')
    expect(db.rows.settlement_audit_log).toHaveLength(1)
    expect(db.rows.settlement_audit_log[0]).toMatchObject({
      entity_type: 'settlement_run',
      entity_id: SETTLEMENT_RUN_ID,
      action: 'admin_resolved',
      actor_id: 'admin-1',
      actor_type: 'admin',
      reason: 'Reviewed ticketing export and venue notes.',
    })
    expect(db.rows.admin_audit_log).toHaveLength(1)
    expect(db.rows.admin_audit_log[0]).toMatchObject({
      admin_user_id: 'admin-1',
      action: 'dispute_resolved',
      entity_type: 'settlement_run',
      entity_id: SETTLEMENT_RUN_ID,
      reason: 'Reviewed ticketing export and venue notes.',
    })
  })
})
