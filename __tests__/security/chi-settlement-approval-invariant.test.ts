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

import {
  ensureSettlementApproval,
  hashSettlementToken,
  startSettlementCheckout,
} from '@/lib/finance/settlement-checkout'
import {
  buildApprovalSnapshotHashV2,
  buildApprovalSnapshotV2,
} from '@/lib/planner/execution/reapproval'
import { getStripeClient } from '@/lib/stripe/connect'
import {
  EVENT_ID,
  ORGANIZER_ID,
  PLAN_ID,
  SETTLEMENT_RUN_ID,
  SettlementMemoryDb,
  VENUE_ID,
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

  it('persists an exactly recomputable V2 snapshot for a settlement approval', async () => {
    const db = new SettlementMemoryDb()
    db.rows.approvals = []
    const run = db.rows.settlement_runs[0]
    const venue = db.rows.venues[0]
    const event = db.rows.events[0]
    const plan = {
      ...db.rows.plans[0],
      event_type: 'happy_hour',
      guest_count: 40,
      budget_cap_cents: 50_000,
      neighborhood: 'Mission',
      date_window_start: '2026-07-01',
      date_window_end: '2026-07-01',
      ticketed: false,
      ticketing_model: 'rsvp',
      food_responsibility: 'venue',
      profit_goal_cents: null,
    }
    db.rows.plans[0] = plan

    await ensureSettlementApproval(db as never, {
      run: run as never,
      organizerId: ORGANIZER_ID,
      context: {
        run,
        venue,
        event,
        organizer: { id: ORGANIZER_ID, email: 'organizer@example.com' },
        venueOwner: { id: '77777777-7777-4777-8777-777777777777', email: 'owner@example.com' },
        plan,
      } as never,
    })

    const approval = db.rows.approvals[0]
    const action = db.rows.agent_actions[0]
    expect(approval).toEqual(expect.objectContaining({
      plan_id: PLAN_ID,
      settlement_run_id: SETTLEMENT_RUN_ID,
      snapshot_schema_version: 2,
      requested_amount_cents: 12_000,
      delivery_email: 'venue@example.com',
    }))
    expect(action).toEqual(expect.objectContaining({
      plan_id: PLAN_ID,
      target_id: SETTLEMENT_RUN_ID,
      payload_json: expect.objectContaining({ event_id: EVENT_ID, venue_id: VENUE_ID }),
    }))
    const snapshotInput = { plan, approval, action, payload: action.payload_json }
    expect(approval.snapshot_hash).toBe(buildApprovalSnapshotHashV2(snapshotInput as any))
    expect(approval.snapshot_json).toEqual(buildApprovalSnapshotV2(snapshotInput as any))
  })
})
