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
  APPROVAL_ID,
  SETTLEMENT_RUN_ID,
  SettlementMemoryDb,
} from '@/test-utils/settlementCheckoutDb'

const mockGetStripeClient = getStripeClient as jest.Mock

describe('CHI settlement checkout flow', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.SETTLEMENT_ACK_TOKEN_SECRET = 'test-secret'
  })

  it('creates a Stripe Checkout session only after approval and records the session', async () => {
    const db = new SettlementMemoryDb()
    db.rows.venue_settlement_tokens.push({
      id: 'token-1',
      settlement_run_id: SETTLEMENT_RUN_ID,
      token_hash: hashSettlementToken('settlement-token'),
      venue_email: 'venue@example.com',
      expires_at: '2099-01-01T00:00:00Z',
      first_viewed_at: null,
      revoked_at: null,
    })

    const stripe = {
      checkout: {
        sessions: {
          create: jest.fn().mockResolvedValue({
            id: 'cs_test',
            url: 'https://checkout.stripe.test/session',
          }),
        },
      },
    }
    mockGetStripeClient.mockReturnValue(stripe)

    const result = await startSettlementCheckout(
      db as never,
      'settlement-token',
      new Request('https://www.3rdplace.io/api/venue/settlement/token/pay'),
    )

    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({
      hosted_checkout_url: 'https://checkout.stripe.test/session',
    })
    expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'payment',
        payment_method_types: ['card', 'us_bank_account'],
        payment_intent_data: expect.objectContaining({
          application_fee_amount: 0,
          transfer_data: {
            destination: 'acct_builder',
            amount: 12000,
          },
          metadata: expect.objectContaining({
            kind: 'chi_settlement',
            settlement_run_id: SETTLEMENT_RUN_ID,
            approval_id: APPROVAL_ID,
          }),
        }),
      }),
      { idempotencyKey: `chi_settlement_checkout_${SETTLEMENT_RUN_ID}_12000` },
    )
    expect(db.rows.settlement_charges[0]).toMatchObject({
      settlement_run_id: SETTLEMENT_RUN_ID,
      approval_id: APPROVAL_ID,
      platform_fee_cents: 0,
      organizer_payout_cents: 12000,
      stripe_checkout_session_id: 'cs_test',
      checkout_url: 'https://checkout.stripe.test/session',
    })
    expect(db.rows.settlement_runs[0].status).toBe('awaiting_venue_payment')
  })
})
