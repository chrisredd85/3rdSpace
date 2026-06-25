jest.mock('server-only', () => ({}))

import {
  createBuilderBillingPortalSession,
  createBuilderCheckoutSession,
  ensureStripeCustomerForBuilder,
  getBuilderBillingSummary,
  getBuilderStripePriceId,
} from '@/lib/billing/builder-billing'
import { getStripeClient } from '@/lib/stripe/connect'

jest.mock('@/lib/stripe/connect', () => ({
  getAppBaseUrl: jest.fn(() => 'https://3rdplace.test'),
  getStripeClient: jest.fn(),
}))

function createAdminMock() {
  const updates: Array<{ table: string; payload: unknown; filters: Array<[string, unknown]> }> = []

  return {
    updates,
    admin: {
      from: jest.fn((table: string) => ({
        update: jest.fn((payload: unknown) => {
          const entry = { table, payload, filters: [] as Array<[string, unknown]> }
          updates.push(entry)
          const query = {
            eq: jest.fn((column: string, value: unknown) => {
              entry.filters.push([column, value])
              return query
            }),
          }
          return query
        }),
      })),
    },
  }
}

const builder = {
  id: 'builder-1',
  user_id: 'user-1',
  name: 'QA Builder',
  stripe_customer_id: 'cus_existing',
}

describe('builder billing Stripe customer resolution', () => {
  const originalEnv = process.env

  beforeEach(() => {
    jest.clearAllMocks()
    process.env = { ...originalEnv }
  })

  afterAll(() => {
    process.env = originalEnv
  })

  it('reuses a stored Stripe customer when it exists in the active Stripe mode', async () => {
    const stripe = {
      customers: {
        retrieve: jest.fn().mockResolvedValue({ id: 'cus_existing' }),
        create: jest.fn(),
      },
    }
    ;(getStripeClient as jest.Mock).mockReturnValue(stripe)
    const { admin, updates } = createAdminMock()

    await expect(
      ensureStripeCustomerForBuilder({
        admin,
        builder,
        email: 'qa@example.com',
      })
    ).resolves.toBe('cus_existing')

    expect(stripe.customers.retrieve).toHaveBeenCalledWith('cus_existing')
    expect(stripe.customers.create).not.toHaveBeenCalled()
    expect(updates).toEqual([])
  })

  it('replaces a stored customer id that belongs to the other Stripe mode', async () => {
    const stripe = {
      customers: {
        retrieve: jest.fn().mockRejectedValue({
          code: 'resource_missing',
          message: "No such customer: 'cus_existing'; a similar object exists in test mode, but a live mode key was used to make this request.",
        }),
        create: jest.fn().mockResolvedValue({ id: 'cus_replacement' }),
      },
    }
    ;(getStripeClient as jest.Mock).mockReturnValue(stripe)
    const { admin, updates } = createAdminMock()

    await expect(
      ensureStripeCustomerForBuilder({
        admin,
        builder,
        email: 'qa@example.com',
      })
    ).resolves.toBe('cus_replacement')

    expect(stripe.customers.retrieve).toHaveBeenCalledWith('cus_existing')
    expect(stripe.customers.create).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'qa@example.com',
        name: 'QA Builder',
        metadata: {
          builder_id: 'builder-1',
          user_id: 'user-1',
        },
      })
    )
    expect(updates).toEqual([
      {
        table: 'builder_profiles',
        payload: expect.objectContaining({ stripe_customer_id: 'cus_replacement' }),
        filters: [['id', 'builder-1']],
      },
      {
        table: 'builder_subscriptions',
        payload: expect.objectContaining({ stripe_customer_id: 'cus_replacement' }),
        filters: [
          ['builder_id', 'builder-1'],
          ['stripe_customer_id', 'cus_existing'],
        ],
      },
    ])
  })

  it('creates checkout with the replacement customer when the stored one is stale', async () => {
    const stripe = {
      customers: {
        retrieve: jest.fn().mockRejectedValue({
          code: 'resource_missing',
          message: "No such customer: 'cus_existing'; a similar object exists in test mode, but a live mode key was used to make this request.",
        }),
        create: jest.fn().mockResolvedValue({ id: 'cus_replacement' }),
      },
      checkout: {
        sessions: {
          create: jest.fn().mockResolvedValue({ id: 'cs_test', url: 'https://checkout.stripe.test' }),
        },
      },
    }
    ;(getStripeClient as jest.Mock).mockReturnValue(stripe)
    const { admin } = createAdminMock()

    await createBuilderCheckoutSession({
      admin,
      request: new Request('https://3rdplace.test/planner/billing'),
      builder,
      userEmail: 'qa@example.com',
      type: 'pay_per_event',
    })

    expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: 'cus_replacement',
        mode: 'payment',
      }),
      expect.objectContaining({
        idempotencyKey: `builder_checkout_${builder.id}_pay_per_event`,
      })
    )
  })

  it('creates a Stripe billing portal session for the stored customer', async () => {
    const stripe = {
      customers: {
        retrieve: jest.fn().mockResolvedValue({ id: 'cus_existing' }),
        create: jest.fn(),
      },
      billingPortal: {
        sessions: {
          create: jest.fn().mockResolvedValue({
            id: 'bps_test',
            url: 'https://billing.stripe.test/session',
          }),
        },
      },
    }
    ;(getStripeClient as jest.Mock).mockReturnValue(stripe)
    const { admin } = createAdminMock()

    await expect(
      createBuilderBillingPortalSession({
        admin,
        request: new Request('https://3rdplace.test/planner/billing'),
        builder,
        userEmail: 'qa@example.com',
      })
    ).resolves.toEqual({
      id: 'bps_test',
      url: 'https://billing.stripe.test/session',
    })

    expect(stripe.billingPortal.sessions.create).toHaveBeenCalledWith({
      customer: 'cus_existing',
      return_url: 'https://3rdplace.test/planner/billing',
    })
  })

  it('accepts canonical and shorter Stripe price id environment names', () => {
    delete process.env.STRIPE_PRICE_PRO_MONTHLY
    process.env.STRIPE_PRICE_MONTHLY = 'price_short_monthly'

    expect(getBuilderStripePriceId('pro_monthly')).toBe('price_short_monthly')

    process.env.STRIPE_PRICE_PRO_MONTHLY = 'price_canonical_monthly'

    expect(getBuilderStripePriceId('pro_monthly')).toBe('price_canonical_monthly')
  })
})

describe('builder billing free tier summary', () => {
  it('grants two free events by default for new and legacy one-event profiles', () => {
    expect(getBuilderBillingSummary({
      ...builder,
      billing_tier: 'free_trial',
      subscription_status: 'trial',
      free_events_granted: null,
      free_events_used: 0,
      paid_event_credits: 0,
    }).freeEventsGranted).toBe(2)

    expect(getBuilderBillingSummary({
      ...builder,
      billing_tier: 'free_trial',
      subscription_status: 'trial',
      free_events_granted: 1,
      free_events_used: 0,
      paid_event_credits: 0,
    }).freeEventsGranted).toBe(2)
  })

  it('exposes camelCase and snake_case billing access fields', () => {
    const summary = getBuilderBillingSummary({
      ...builder,
      billing_tier: 'free_trial',
      subscription_status: 'trial',
      free_events_granted: 2,
      free_events_used: 1,
      paid_event_credits: 0,
    })

    expect(summary.freeEventsRemaining).toBe(1)
    expect(summary.free_events_remaining).toBe(1)
    expect(summary.isOnFreeTrial).toBe(true)
    expect(summary.is_on_free_trial).toBe(true)
    expect(summary.canCreateEvent).toBe(true)
    expect(summary.can_create_event).toBe(true)
  })
})
