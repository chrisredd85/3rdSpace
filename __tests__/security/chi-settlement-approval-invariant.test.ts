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
  isConnectedStripeAccountBlocked: jest.fn((status: string | null | undefined) =>
    status === 'restricted' || status === 'disabled'
  ),
}))

import { hashSettlementToken, startSettlementCheckout } from '@/lib/finance/settlement-checkout'
import { getStripeClient } from '@/lib/stripe/connect'
import {
  SETTLEMENT_RUN_ID,
  SettlementMemoryDb,
} from '@/test-utils/settlementCheckoutDb'

const mockGetStripeClient = getStripeClient as jest.Mock

describe('CHI settlement approval invariant', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.SETTLEMENT_ACK_TOKEN_SECRET = 'test-settlement-secret-32-characters'
  })

  it('does not create Stripe Checkout without an authorized settlement approval', async () => {
    const db = new SettlementMemoryDb()
    db.rows.approvals = []
    db.rows.venue_settlement_tokens.push({
      id: 'token-1',
      settlement_run_id: SETTLEMENT_RUN_ID,
      token_hash: hashSettlementToken('settlement-token'),
      venue_email: 'venue@example.com',
      expires_at: '2099-01-01T00:00:00Z',
      first_viewed_at: null,
      revoked_at: null,
    })

    const stripe = { checkout: { sessions: { create: jest.fn() } } }
    mockGetStripeClient.mockReturnValue(stripe)

    const result = await startSettlementCheckout(
      db as never,
      'settlement-token',
      new Request('https://www.3rdplace.io/api/venue/settlement/token/pay'),
    )

    expect(result.status).toBe(409)
    expect(result.body).toEqual({
      error: 'Organizer approval is required before payment',
      code: 'approval_required',
    })
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled()
    expect(db.rows.settlement_charges).toHaveLength(0)
  })
})
