jest.mock('server-only', () => ({}))

jest.mock('@sentry/nextjs', () => ({
  addBreadcrumb: jest.fn(),
  captureException: jest.fn(),
}))

jest.mock('@/lib/email', () => ({
  sendEmailNotification: jest.fn().mockResolvedValue({ sent: true }),
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

jest.mock('@/lib/server/settlement-token-rate-limit', () => ({
  enforceSettlementTokenRateLimit: jest.fn(),
}))

jest.mock('@/lib/supabase/server', () => ({
  createServiceRoleClient: jest.fn(),
}))

import {
  disputeSettlementFromVenueToken,
  getVenueSettlementTokenState,
  handleSettlementCheckoutCompleted,
  hashSettlementToken,
  verifyVenueSettlementToken,
} from '@/lib/finance/settlement-checkout'
import { enforceSettlementTokenRateLimit } from '@/lib/server/settlement-token-rate-limit'
import { createServiceRoleClient } from '@/lib/supabase/server'
import {
  APPROVAL_ID,
  ORGANIZER_ID,
  SETTLEMENT_RUN_ID,
  VENUE_ID,
  SettlementMemoryDb,
} from '@/test-utils/settlementCheckoutDb'

import { POST as paySettlement } from '@/app/api/venue/settlement/[token]/pay/route'
import { GET as getSettlementTokenStatus } from '@/app/api/venue/settlement/[token]/status/route'

const TEST_SECRET = 'test-settlement-secret-32-characters'
const mockRateLimit = enforceSettlementTokenRateLimit as jest.Mock
const mockCreateServiceRoleClient = createServiceRoleClient as jest.Mock

if (typeof Response.json !== 'function') {
  Object.defineProperty(Response, 'json', {
    configurable: true,
    value: (body: unknown, init?: ResponseInit) =>
      new Response(JSON.stringify(body), {
        ...init,
        headers: {
          'content-type': 'application/json',
          ...(init?.headers ?? {}),
        },
      }),
  })
}

function dbWithSettlementToken(rawToken = 'settlement-token') {
  const db = new SettlementMemoryDb()
  db.rows.venue_settlement_tokens.push({
    id: 'token-1',
    settlement_run_id: SETTLEMENT_RUN_ID,
    token_hash: hashSettlementToken(rawToken),
    venue_email: 'venue@example.com',
    expires_at: '2099-01-01T00:00:00Z',
    first_viewed_at: null,
    revoked_at: null,
  })
  return db
}

function withNodeEnv<T>(value: string, callback: () => T): T {
  const original = process.env.NODE_ENV
  Object.defineProperty(process.env, 'NODE_ENV', {
    value,
    configurable: true,
  })
  try {
    return callback()
  } finally {
    Object.defineProperty(process.env, 'NODE_ENV', {
      value: original,
      configurable: true,
    })
  }
}

describe('settlement token hardening', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.SETTLEMENT_ACK_TOKEN_SECRET = TEST_SECRET
    mockRateLimit.mockResolvedValue({ limited: false })
  })

  afterEach(() => {
    process.env.SETTLEMENT_ACK_TOKEN_SECRET = TEST_SECRET
  })

  it('revokes settlement tokens after successful checkout completion', async () => {
    const db = dbWithSettlementToken()
    db.rows.settlement_runs[0].status = 'awaiting_venue_payment'
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
      stripe_checkout_session_id: 'cs_test',
      stripe_payment_intent_id: null,
      stripe_transfer_id: null,
      stripe_connected_account_id: 'acct_builder',
      checkout_url: 'https://checkout.stripe.test/session',
      paid_at: null,
      failed_at: null,
      trueup_processed_at: null,
      failure_reason: null,
      created_at: '2026-06-18T00:00:00Z',
    })

    const result = await handleSettlementCheckoutCompleted(db as never, {
      id: 'cs_test',
      metadata: { kind: 'chi_settlement', settlement_charge_id: 'charge-1' },
      payment_intent: 'pi_test',
    } as never)

    expect(result).toMatchObject({ handled: true, charge_id: 'charge-1' })
    expect(db.rows.settlement_charges[0]).toMatchObject({
      status: 'paid',
      stripe_payment_intent_id: 'pi_test',
      paid_at: expect.any(String),
    })
    expect(db.rows.venue_settlement_tokens[0].revoked_at).toEqual(expect.any(String))
    await expect(verifyVenueSettlementToken(db as never, 'settlement-token')).resolves.toBeNull()
    await expect(getVenueSettlementTokenState(db as never, 'settlement-token')).resolves.toBe('revoked')
  })

  it('revokes settlement tokens after a venue dispute', async () => {
    const db = dbWithSettlementToken()

    const result = await disputeSettlementFromVenueToken(db as never, 'settlement-token', 'Amount is wrong')

    expect(result).toEqual({ status: 200, body: { status: 'disputed' } })
    expect(db.rows.settlement_runs[0]).toMatchObject({
      status: 'disputed',
      dispute_reason: 'Amount is wrong',
    })
    expect(db.rows.venue_settlement_tokens[0].revoked_at).toEqual(expect.any(String))
    await expect(verifyVenueSettlementToken(db as never, 'settlement-token')).resolves.toBeNull()
  })

  it('returns 410 for a revoked settlement token status check', async () => {
    const db = dbWithSettlementToken()
    db.rows.venue_settlement_tokens[0].revoked_at = '2026-06-18T01:00:00Z'
    mockCreateServiceRoleClient.mockReturnValue(db)

    const response = await getSettlementTokenStatus(
      new Request('https://www.3rdplace.io/api/venue/settlement/settlement-token/status') as never,
      { params: { token: 'settlement-token' } },
    )

    expect(response.status).toBe(410)
    await expect(getVenueSettlementTokenState(db as never, 'settlement-token')).resolves.toBe('revoked')
  })

  it('returns 429 with Retry-After when a settlement payment token is rate limited', async () => {
    mockRateLimit.mockResolvedValueOnce({
      limited: true,
      response: new Response(
        JSON.stringify({ error: 'Too many settlement link requests.', code: 'settlement_token_rate_limited' }),
        {
          status: 429,
          headers: {
            'Retry-After': '60',
            'content-type': 'application/json',
          },
        },
      ),
    })

    const response = await paySettlement(
      new Request('https://www.3rdplace.io/api/venue/settlement/settlement-token/pay', {
        method: 'POST',
        headers: { 'x-forwarded-for': '203.0.113.9' },
      }) as never,
      { params: { token: 'settlement-token' } },
    )

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('60')
    expect(mockCreateServiceRoleClient).not.toHaveBeenCalled()
  })

  it('rate limits settlement token status checks before loading service role data', async () => {
    mockRateLimit.mockResolvedValueOnce({
      limited: true,
      response: new Response(
        JSON.stringify({ error: 'Too many settlement link requests.', code: 'settlement_token_rate_limited' }),
        {
          status: 429,
          headers: {
            'Retry-After': '30',
            'content-type': 'application/json',
          },
        },
      ),
    })

    const response = await getSettlementTokenStatus(
      new Request('https://www.3rdplace.io/api/venue/settlement/settlement-token/status') as never,
      { params: { token: 'settlement-token' } },
    )

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('30')
    expect(mockCreateServiceRoleClient).not.toHaveBeenCalled()
  })

  it('requires SETTLEMENT_ACK_TOKEN_SECRET in production', () => {
    const originalSecret = process.env.SETTLEMENT_ACK_TOKEN_SECRET
    delete process.env.SETTLEMENT_ACK_TOKEN_SECRET

    try {
      withNodeEnv('production', () => {
        expect(() => hashSettlementToken('settlement-token')).toThrow(
          'SETTLEMENT_ACK_TOKEN_SECRET required in production'
        )
      })
    } finally {
      process.env.SETTLEMENT_ACK_TOKEN_SECRET = originalSecret
    }
  })

  it('rejects SETTLEMENT_ACK_TOKEN_SECRET values shorter than 32 characters', () => {
    const originalSecret = process.env.SETTLEMENT_ACK_TOKEN_SECRET
    process.env.SETTLEMENT_ACK_TOKEN_SECRET = 'too-short'

    try {
      expect(() => hashSettlementToken('settlement-token')).toThrow(
        'SETTLEMENT_ACK_TOKEN_SECRET must be at least 32 chars'
      )
    } finally {
      process.env.SETTLEMENT_ACK_TOKEN_SECRET = originalSecret
    }
  })
})
