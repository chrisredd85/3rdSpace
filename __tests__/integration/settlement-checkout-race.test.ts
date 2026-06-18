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
  ORGANIZER_ID,
  SETTLEMENT_RUN_ID,
  VENUE_ID,
  SettlementMemoryDb,
} from '@/test-utils/settlementCheckoutDb'

const mockGetStripeClient = getStripeClient as jest.Mock

function dbWithToken() {
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
  return db
}

describe('CHI settlement checkout race handling', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.SETTLEMENT_ACK_TOKEN_SECRET = 'test-secret'
  })

  it('returns an existing checkout session instead of creating a second one', async () => {
    const db = dbWithToken()
    db.rows.settlement_charges.push({
      id: 'charge-1',
      settlement_run_id: SETTLEMENT_RUN_ID,
      approval_id: APPROVAL_ID,
      organizer_id: ORGANIZER_ID,
      venue_id: VENUE_ID,
      amount_cents: 12000,
      platform_fee_cents: 0,
      organizer_payout_cents: 12000,
      currency: 'usd',
      status: 'checkout_created',
      stripe_checkout_session_id: 'cs_existing',
      checkout_url: 'https://checkout.stripe.test/existing',
      created_at: '2026-06-18T00:00:00Z',
    })

    const stripe = { checkout: { sessions: { create: jest.fn() } } }
    mockGetStripeClient.mockReturnValue(stripe)

    const result = await startSettlementCheckout(
      db as never,
      'settlement-token',
      new Request('https://www.3rdplace.io/api/venue/settlement/token/pay'),
    )

    expect(result.status).toBe(200)
    expect(result.body).toEqual({
      hosted_checkout_url: 'https://checkout.stripe.test/existing',
      charge_id: 'charge-1',
    })
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled()
  })

  it('returns a retryable conflict when another request is still creating Checkout', async () => {
    const db = dbWithToken()
    db.rows.settlement_charges.push({
      id: 'charge-1',
      settlement_run_id: SETTLEMENT_RUN_ID,
      approval_id: APPROVAL_ID,
      organizer_id: ORGANIZER_ID,
      venue_id: VENUE_ID,
      amount_cents: 12000,
      platform_fee_cents: 0,
      organizer_payout_cents: 12000,
      currency: 'usd',
      status: 'checkout_created',
      stripe_checkout_session_id: null,
      checkout_url: null,
      created_at: '2026-06-18T00:00:00Z',
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
      error: 'Checkout is being prepared. Try again.',
      code: 'checkout_in_progress',
    })
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled()
  })
})
